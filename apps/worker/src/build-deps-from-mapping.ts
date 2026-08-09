// Copyright 2026 OpenHands Agent (Apache-2.0)
// Build dependencies from database-stored connections with encrypted credentials.
// Used by Trigger.dev jobs to construct real source/target connectors.

import { Pool } from 'pg';
import { eq, and } from 'drizzle-orm';

import {
  type ReconcileDeps,
  type MappingConfig,
  type SourceConnector,
  type TargetWriter,
  type ThrottleLimiter,
  type ThrottleConfigMapping,
  createThrottleLimiterFromMapping,
  type TenantId,
  type MappingId,
  type SourceConfig,
  type TargetConfig,
  DEFAULT_CONCURRENCY,
} from '@openmig/shared';
import { connection as connectionTable } from '@openmig/ledger';
import {
  ImapFlowSource,
  GraphMailSource,
  MailSourceWithGraphFallback,
  createTokenProvider,
  ImapFlowDavMailTarget,
  type ImapDavTargetConfig,
} from '@openmig/connectors';
import { JmapTargetWriter } from '@openmig/connectors';
import type { CalendarSyncDeps, ContactSyncDeps, FileSyncDeps } from '@openmig/core';
import {
  buildCalendarSource,
  buildCalendarTarget,
  buildContactSource,
  buildFileSource,
} from './dav-factories';
import { davEndpointFromCreds, fileEndpointFromCreds } from './dav-endpoint';
import { buildContactTargetFor, contactTargetProtocol } from './contact-target-factory';
import { buildFileTargetFor, fileTargetProtocol } from './file-target-factory';
import { PgLedger, PgCursorStore, createPgDb, withTenant } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { mailboxMapping } from '@openmig/ledger';
import { withClose, type WithClose } from './deps-lifecycle';

/**
 * Build dependencies from database-stored connections with encrypted credentials.
 * 
 * This is the job-oriented version that:
 * 1. Loads the source and target connections from the database (with RLS)
 * 2. Decrypts credentials using the secret store
 * 3. Constructs the same ReconcileDeps as buildDeps()
 * 
 * SECURITY: All database operations are wrapped in withTenant() to enforce
 * row-level security. The tenantId must come from an authenticated request.
 * 
 * @param pool - PostgreSQL pool
 * @param tenantId - The tenant ID (from authenticated API request)
 * @param mappingId - The mapping ID to track (not used for config loading)
 * @returns ReconcileDeps with real source/target connectors
 * @throws Error if tenantId is missing, connections not found, or credentials unavailable
 */
export async function buildDepsFromMapping(
  pool: Pool,
  tenantId: string,
  mappingId: string
): Promise<WithClose<ReconcileDeps>> {
  // SECURITY: Fail closed if tenantId is missing or invalid
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId is required and must be a valid UUID');
  }

  // Validate mapping exists and belongs to tenant (RLS-enforced)
  // Use TEST_DATABASE_URL for integration tests, fall back to DATABASE_URL
  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or TEST_DATABASE_URL must be set');
  }
  const db = createPgDb(databaseUrl);
  const mappings = await db.select()
    .from(mailboxMapping)
    .where(
      and(
        eq(mailboxMapping.tenantId, tenantId),
        eq(mailboxMapping.id, mappingId)
      )
    );

  if (mappings.length === 0) {
    throw new Error('Mapping not found or access denied');
  }

  // Load connections and credentials WITHIN tenant context (RLS enforced)
  const { sourceConfig, targetConfig, sourceCredentials, targetCredentials } = await withTenant(pool, tenantId, async (txDb) => {
    // Load source connection (RLS-enforced)
    const sourceConnections = await txDb.select()
      .from(connectionTable)
      .where(
        and(
          eq(connectionTable.tenantId, tenantId),
          eq(connectionTable.role, 'source')
        )
      );
    
    if (sourceConnections.length === 0) {
      throw new Error(`Source connection not found for tenant: ${tenantId}`);
    }
    
    const sourceConnection = sourceConnections[0]!;
    
    // Load target connection (RLS-enforced)
    const targetConnections = await txDb.select()
      .from(connectionTable)
      .where(
        and(
          eq(connectionTable.tenantId, tenantId),
          eq(connectionTable.role, 'target')
        )
      );
    
    if (targetConnections.length === 0) {
      throw new Error(`Target connection not found for tenant: ${tenantId}`);
    }
    
    const targetConnection = targetConnections[0]!;
    
    // Parse connector configs from the connection config JSONB
    const sourceConfig = sourceConnection.config as unknown as SourceConfig;
    const targetConfig = targetConnection.config as unknown as TargetConfig;
    
    // Decrypt source credentials
    let sourceCredentials: Record<string, string>;
    if (sourceConnection.secretRef) {
      sourceCredentials = SecretStore.decryptCredentials(sourceConnection.secretRef);
    } else {
      // Fallback: credentials stored in config (unencrypted - for migration/testing only)
      const configObj = sourceConnection.config as Record<string, unknown>;
      if (configObj.credentials && typeof configObj.credentials === 'object') {
        sourceCredentials = configObj.credentials as Record<string, string>;
      } else {
        throw new Error('Source connection has no credentials');
      }
    }
    
    // Decrypt target credentials
    let targetCredentials: Record<string, string>;
    if (targetConnection.secretRef) {
      targetCredentials = SecretStore.decryptCredentials(targetConnection.secretRef);
    } else {
      const configObj = targetConnection.config as Record<string, unknown>;
      if (configObj.credentials && typeof configObj.credentials === 'object') {
        targetCredentials = configObj.credentials as Record<string, string>;
      } else {
        throw new Error('Target connection has no credentials');
      }
    }
    
    return {
      sourceConfig,
      targetConfig,
      sourceCredentials,
      targetCredentials,
    };
  });
  
  // Build the MappingConfig from source/target configs
  const mappingConfig: MappingConfig = {
    tenantId,
    mappingId,
    source: sourceConfig,
    target: targetConfig,
  };
  
  // Build throttle limiter from mapping config
  // Extract throttle configs from domains if present
  const throttleConfigMapping: ThrottleConfigMapping = {};
  if (mappingConfig.domains) {
    for (const [domainName, domainConfig] of Object.entries(mappingConfig.domains)) {
      if (domainConfig?.throttleConfig) {
        throttleConfigMapping[domainName] = domainConfig.throttleConfig;
      }
    }
  }
  const throttleLimiter = Object.keys(throttleConfigMapping).length > 0
    ? createThrottleLimiterFromMapping(throttleConfigMapping)
    : undefined;
  
  // Build source connector with decrypted credentials
  const source = buildSourceConnectorFromCredentials(
    mappingConfig.source,
    sourceCredentials,
    throttleLimiter
  );
  
  // Build target writer with decrypted credentials
  const target = buildTargetWriterFromCredentials(mappingConfig.target, targetCredentials);
  
  // Create ledger and cursor store
  const ledger = new PgLedger(db);
  const cursors = new PgCursorStore(db);

  // Attach close() so the caller releases the pool after the pass (never leak it).
  return withClose(
    {
      tenantId: tenantId as ReconcileDeps['tenantId'],
      mappingId: mappingId as ReconcileDeps['mappingId'],
      source,
      target,
      ledger,
      cursors,
      // The shared default, not a literal. This path is the MANAGED edition's,
      // and its `?? 4` was written independently of the three other copies of
      // the same number — so retuning the default anywhere else would have left
      // the managed service pushing customers' servers at a different rate from
      // the appliance, with nothing to say so (hard rule 5).
      concurrency: mappingConfig.concurrency ?? DEFAULT_CONCURRENCY,
    },
    db,
  );
}

/** Load source + target connection config/credentials/kind for a tenant (RLS-enforced). */
async function loadDomainConnections(
  pool: Pool,
  tenantId: string,
): Promise<{
  source: { config: Record<string, unknown>; creds: Record<string, string>; kind: string };
  target: { config: Record<string, unknown>; creds: Record<string, string>; kind: string };
}> {
  return withTenant(pool, tenantId, async (txDb) => {
    const load = async (role: 'source' | 'target') => {
      const rows = await txDb
        .select()
        .from(connectionTable)
        .where(and(eq(connectionTable.tenantId, tenantId), eq(connectionTable.role, role)));
      const conn = rows[0];
      if (!conn) {
        throw new Error(`${role} connection not found for tenant: ${tenantId}`);
      }
      const config = (conn.config ?? {}) as Record<string, unknown>;
      let creds: Record<string, string>;
      if (conn.secretRef) {
        creds = SecretStore.decryptCredentials(conn.secretRef);
      } else if (config.credentials && typeof config.credentials === 'object') {
        creds = config.credentials as Record<string, string>;
      } else {
        throw new Error(`${role} connection has no credentials`);
      }
      return { config, creds, kind: conn.kind };
    };
    return { source: await load('source'), target: await load('target') };
  });
}

/**
 * Build domain-specific sync dependencies from database-stored connections.
 *
 * Mail delegates to buildDepsFromMapping (IMAP/JMAP). Calendar/contact/file build
 * the native DAV source connectors + engine target writers from the stored
 * connection config + decrypted credentials — credentials are passed directly
 * (never via env) so the managed path is per-tenant safe. RLS-enforced.
 */
export function buildDomainDepsFromMapping(pool: Pool, tenantId: string, mappingId: string, domain: 'mail'): Promise<WithClose<ReconcileDeps>>;
export function buildDomainDepsFromMapping(pool: Pool, tenantId: string, mappingId: string, domain: 'calendar'): Promise<WithClose<CalendarSyncDeps>>;
export function buildDomainDepsFromMapping(pool: Pool, tenantId: string, mappingId: string, domain: 'contact'): Promise<WithClose<ContactSyncDeps>>;
export function buildDomainDepsFromMapping(pool: Pool, tenantId: string, mappingId: string, domain: 'file'): Promise<WithClose<FileSyncDeps>>;
export async function buildDomainDepsFromMapping(
  pool: Pool,
  tenantId: string,
  mappingId: string,
  domain: 'mail' | 'calendar' | 'contact' | 'file',
): Promise<WithClose<ReconcileDeps | CalendarSyncDeps | ContactSyncDeps | FileSyncDeps>> {
  if (domain === 'mail') {
    return buildDepsFromMapping(pool, tenantId, mappingId);
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or TEST_DATABASE_URL must be set');
  }
  const db = createPgDb(databaseUrl);
  // If anything below throws before we hand pool ownership to the caller (via
  // withClose), release the pool here so a failed build never leaks it.
  try {
    const ledger = new PgLedger(db);
    const cursors = new PgCursorStore(db);
    const tId = tenantId as TenantId;
    const mId = mappingId as MappingId;

    const { source: src, target: tgt } = await loadDomainConnections(pool, tenantId);
    const common = { tenantId: tId, mappingId: mId, ledger, cursors };
    const targetDeps = { ledger, tenantId: tId, mappingId: mId };
    const srcEndpoint = davEndpointFromCreds('source', src.config, src.creds);
    const tgtEndpoint = davEndpointFromCreds('target', tgt.config, tgt.creds);

    // Attach close() so the caller releases the pool after the pass (never leak it).
    if (domain === 'calendar') {
      return withClose(
        {
          ...common,
          source: buildCalendarSource(srcEndpoint),
          target: buildCalendarTarget(tgtEndpoint, targetDeps),
        } satisfies CalendarSyncDeps,
        db,
      );
    }
    if (domain === 'contact') {
      return withClose(
        {
          ...common,
          source: buildContactSource(srcEndpoint),
          // Contacts can go over JMAP where the target speaks it (0031 T2).
          // Read off the connection's own `kind`, which has allowed `jmap`
          // since the 0001 baseline, so this needs no migration and no new
          // config field. Anything else stays on CardDAV, which is what every
          // existing mapping is and must remain.
          target: buildContactTargetFor(
            contactTargetProtocol(tgt.kind),
            tgtEndpoint,
            targetDeps,
          ),
        } satisfies ContactSyncDeps,
        db,
      );
    }
    const fileSrcEndpoint = fileEndpointFromCreds('source', src.config, src.creds, src.kind);
    const fileTgtEndpoint = fileEndpointFromCreds('target', tgt.config, tgt.creds, tgt.kind);
    return withClose(
      {
        ...common,
        source: buildFileSource(fileSrcEndpoint),
        // Files can go over JMAP where the target speaks it (0031 T3). Read
        // off the connection's own `kind`, which has allowed `jmap` since the
        // 0001 baseline, so this needs no migration and no new config field.
        // Anything else stays on WebDAV, which is what every existing mapping
        // is and must remain.
        target: buildFileTargetFor(fileTargetProtocol(tgt.kind), fileTgtEndpoint, targetDeps),
      } satisfies FileSyncDeps,
      db,
    );
  } catch (err) {
    await db.close();
    throw err;
  }
}

/**
 * Build source connector from config and decrypted credentials.
 * Supports imap-oauth2 (whose auth carries EITHER an OAuth2 token (O365) OR a
 * plain password (any other IMAP server, e.g. a self-hosted Stalwart) — see
 * SourceAuth in @openmig/shared; both handled below) and graph-mail (workplan
 * 0023 T2 — ADR-0006's IMAP-disabled fallback, token credentials from the
 * connection's encrypted credential store).
 *
 * Exported for unit tests: the branch-per-type and its refusals are the
 * behavior worth pinning, and they need no database to prove.
 */
export function buildSourceConnectorFromCredentials(
  sourceConfig: SourceConfig,
  credentials: Record<string, string>,
  throttleLimiter?: ThrottleLimiter
): SourceConnector {
  if (sourceConfig.type === 'graph-mail') {
    return buildGraphMailSourceFromCredentials(sourceConfig, credentials, throttleLimiter);
  }
  if (sourceConfig.type !== 'imap-oauth2') {
    throw new Error(`buildDepsFromMapping only supports imap-oauth2 and graph-mail mail sources, got: ${sourceConfig.type}`);
  }

  return buildImapSourceFromCredentials(sourceConfig, credentials, throttleLimiter);
}

/**
 * Build the Graph mail source from the connection's decrypted credentials
 * (managed edition — the appliance's env-var equivalent lives in
 * build-deps.ts). Same two flows: a refreshToken credential selects the
 * delegated Mail.Read flow; otherwise clientSecret selects client-credentials
 * with .default. Missing credentials refuse AT BUILD TIME with the field
 * named — a token provider that cannot mint tokens would otherwise fail
 * mid-pass with a far less useful error (rule 9).
 */
function buildGraphMailSourceFromCredentials(
  sourceConfig: SourceConfig & { type: 'graph-mail' },
  credentials: Record<string, string>,
  throttleLimiter?: ThrottleLimiter
): SourceConnector {
  const clientId = credentials.clientId;
  const clientSecret = credentials.clientSecret;
  const refreshToken = credentials.refreshToken;

  if (!clientId) {
    throw new Error('graph-mail source credentials must include clientId (the Entra app registration id)');
  }
  if (!clientSecret && !refreshToken) {
    throw new Error(
      'graph-mail source credentials must include clientSecret (client-credentials flow) or refreshToken (delegated flow)',
    );
  }

  // A mailbox address is a /users/{address} read, and that is ONLY possible
  // under the client-credentials (application-permission) flow. With a refresh
  // token present the token provider asks for a delegated token, Graph answers
  // 403 on /users, and the operator is left reading an access-denied error
  // that says nothing about the cause. Refuse here instead, naming the fix
  // (hard rule 9).
  if (sourceConfig.mailbox !== undefined && refreshToken) {
    throw new Error(
      `graph-mail source: mailbox "${sourceConfig.mailbox}" names another user's ` +
        'mailbox, which requires application permissions (the client-credentials ' +
        'flow), but OAUTH2_REFRESH_TOKEN is set — that is the DELEGATED flow and ' +
        'can only read the signed-in user (/me). Unset OAUTH2_REFRESH_TOKEN and ' +
        'set OAUTH2_CLIENT_SECRET, having granted admin consent — see ' +
        'docs/o365-application-access.md — or remove the mailbox to read /me.',
    );
  }

  const tokenProvider = createTokenProvider({
    tokenEndpoint: `https://login.microsoftonline.com/${sourceConfig.tenantId}/oauth2/v2.0/token`,
    clientId,
    clientSecret,
    refreshToken,
    tenantId: sourceConfig.tenantId,
    scope: refreshToken
      ? 'https://graph.microsoft.com/Mail.Read offline_access'
      : 'https://graph.microsoft.com/.default',
  });

  return new GraphMailSource(tokenProvider, sourceConfig.tenantId, {
    baseUrl: sourceConfig.baseUrl,
    throttleLimiter,
    // Unset means /me, which is what every delegated mapping does. An address
    // makes this a /users/{address} read — the shared-mailbox path (0027 T0),
    // and it only works under the client-credentials flow above.
    ...(sourceConfig.mailbox === undefined ? {} : { mailbox: sourceConfig.mailbox }),
  });
}

/**
 * Build an IMAP source from credentials — OAuth2 access token or plain
 * password, whichever the decrypted credentials actually carry.
 */
function buildImapSourceFromCredentials(
  sourceConfig: SourceConfig,
  credentials: Record<string, string>,
  throttleLimiter?: ThrottleLimiter
): SourceConnector {
  if (sourceConfig.type !== 'imap-oauth2') {
    throw new Error(`Expected imap-oauth2, got: ${(sourceConfig as { type: string }).type}`);
  }

  const accessToken = credentials.accessToken || credentials.oauth2_token;
  const password = credentials.password;
  if (!accessToken && !password) {
    throw new Error('IMAP source credentials must include either an OAuth2 access token or a password');
  }

  const imapConfig = {
    host: sourceConfig.host,
    port: sourceConfig.port,
    // TLS unless the mapping says otherwise. Was `port === 993` -- a literal
    // port comparison, so an IMAPS server on any other port got a CLEARTEXT
    // socket. See ImapTlsSetting in packages/shared/src/config.ts for why the
    // default is true rather than a guess: being wrong this way costs a
    // connection error, being wrong the other way puts a password on the wire.
    tls: sourceConfig.tls ?? true,
    // Certificate verification rides beside the tls flag, same default, same
    // asymmetry argument -- see ImapTlsVerifySetting. Undefined here lets the
    // connector's own `?? true` be the single place the default lives.
    rejectUnauthorized: sourceConfig.tlsVerify,
    auth: {
      user: sourceConfig.user,
      accessToken,
      password,
    },
    // authType must follow which credential is actually present — hardcoding
    // XOAUTH2 here silently drops a configured password and IMAP servers
    // reject the resulting empty XOAUTH2 attempt with "No supported
    // authentication method(s)" (same bug class build-deps.ts's buildImapSource
    // already fixed for the self-host path; see its comment).
    authType: accessToken ? ('XOAUTH2' as const) : ('LOGIN' as const),
    throttleLimiter,
  };

  // CUT OVER TO `imapflow` on 2026-08-06 (workplan 0032 T3). Same evidence as
  // the self-host path in `build-deps.ts` — see the longer note there.
  const imap = new ImapFlowSource(imapConfig);

  // The runtime IMAP-disabled fallback (workplan 0023 T3, ADR-0006): when the
  // connection's credential store ALSO carries Graph-capable credentials —
  // tenantId is the signal, since the Graph token endpoint needs it and plain
  // IMAP does not — wrap the source so an auth-refused mailbox is probed over
  // Graph instead of dead-ending the run. Lazy: IMAP-working mailboxes never
  // touch these credentials.
  const graphTenantId = credentials.tenantId;
  const hasGraphCreds =
    graphTenantId && credentials.clientId && (credentials.clientSecret || credentials.refreshToken);
  if (hasGraphCreds) {
    return new MailSourceWithGraphFallback(imap, () =>
      buildGraphMailSourceFromCredentials(
        { type: 'graph-mail', tenantId: graphTenantId },
        credentials,
        throttleLimiter,
      ),
    );
  }

  return imap;
}

/**
 * Build target writer from config and decrypted credentials.
 */
function buildTargetWriterFromCredentials(
  targetConfig: TargetConfig,
  credentials: Record<string, string>
): TargetWriter {
  switch (targetConfig.type) {
    case 'jmap': {
      const password = credentials.password || credentials.token || credentials.api_key;
      if (!password) {
        throw new Error('JMAP target password/token not found in credentials');
      }

      const jmapConfig = {
        baseUrl: targetConfig.baseUrl,
        username: targetConfig.user,
        password,
      };

      return new JmapTargetWriter(jmapConfig);
    }

    case 'imap-dav': {
      const password = credentials.password || credentials.access_token;
      if (!password) {
        throw new Error('IMAP/DAV target password not found in credentials');
      }

      const imapConfig: ImapDavTargetConfig = {
        host: targetConfig.host,
        port: targetConfig.port,
        // Same rule as the source above; see ImapTlsSetting.
        tls: targetConfig.tls ?? true,
        rejectUnauthorized: targetConfig.tlsVerify,
        username: targetConfig.user,
        password,
      };

      // CUT OVER on 2026-08-06 (workplan 0032 T3). See `build-deps.ts`.
      return new ImapFlowDavMailTarget(imapConfig);
    }

    default:
      throw new Error(`Unsupported target type: ${(targetConfig as { type: string }).type}`);
  }
}
