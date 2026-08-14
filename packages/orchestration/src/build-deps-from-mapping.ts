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
import {
  buildGraphMailSourceFrom,
  buildImapSourceFrom,
  withGraphFallback,
} from './mail-source-factory';

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

  return buildGraphMailSourceFrom(
    sourceConfig,
    { clientId, clientSecret, refreshToken },
    throttleLimiter,
  );
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
  // The per-customer Entra app registration (0037 T6, ADR-0006's row-14
  // model): when the credential store carries tenantId + clientId +
  // clientSecret — what the managed create path encrypts for an 'oauth2'
  // source — and no direct credential, mint XOAUTH2 tokens at connect time
  // via the same MsalTokenProvider the Graph path uses. A static accessToken
  // or password, when present, keeps winning: those are the pre-existing
  // contracts and a token that works needs no minting.
  const appRegistration =
    credentials.tenantId &&
    credentials.clientId &&
    (credentials.clientSecret || credentials.refreshToken)
      ? {
          tenantId: credentials.tenantId,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          refreshToken: credentials.refreshToken,
        }
      : undefined;
  if (!accessToken && !password && !appRegistration) {
    throw new Error(
      'IMAP source credentials must include an OAuth2 access token, a password, or an Entra ' +
        'app registration (tenantId + clientId + clientSecret) for the client-credentials flow',
    );
  }

  const tokenProvider =
    !accessToken && !password && appRegistration
      ? createTokenProvider({
          tokenEndpoint: `https://login.microsoftonline.com/${appRegistration.tenantId}/oauth2/v2.0/token`,
          clientId: appRegistration.clientId,
          clientSecret: appRegistration.clientSecret,
          refreshToken: appRegistration.refreshToken,
          tenantId: appRegistration.tenantId,
          // MsalTokenProvider runs client-credentials whenever clientSecret is
          // set, and app-only tokens must ask for the resource-wide .default
          // scope; the named IMAP scope form is only valid for the delegated
          // (refresh-token) flow.
          scope: appRegistration.clientSecret
            ? 'https://outlook.office365.com/.default'
            : 'https://outlook.office.com/IMAP.AccessAsUser.All',
        })
      : undefined;

  const imap = buildImapSourceFrom(
    sourceConfig,
    {
      accessToken,
      password,
      // authType must follow which credential is actually present — hardcoding
      // XOAUTH2 here silently drops a configured password and IMAP servers
      // reject the resulting empty XOAUTH2 attempt with "No supported
      // authentication method(s)". A token provider counts as an XOAUTH2
      // credential: ImapFlowSource mints from it at connect time when no static
      // token is given.
      //
      // NOTE this derivation is NOT shared with the self-host edition, which
      // decides from the mapping's DECLARED auth kind rather than from what is
      // present. Both are defensible — a config file states intent, a credential
      // store only has contents — and reconciling them is a behaviour change,
      // not a refactor. See `ResolvedImapAuth` and workplan 0041.
      authType: accessToken || tokenProvider ? ('XOAUTH2' as const) : ('LOGIN' as const),
      tokenProvider,
    },
    throttleLimiter,
  );

  // The runtime IMAP-disabled fallback (workplan 0023 T3, ADR-0006): tenantId is
  // the signal, since the Graph token endpoint needs it and plain IMAP does not.
  // The rule for WHEN to wrap is shared with the self-host edition — see
  // `withGraphFallback`.
  return withGraphFallback(
    imap,
    {
      tenantId: credentials.tenantId,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
    },
    throttleLimiter,
  );
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
