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
  type FileSource,
  DEFAULT_CONCURRENCY,
  parseGoogleDriveSource,
  log,
} from '@openmig/shared';
import { connection as connectionTable, mailbox as mailboxTable } from '@openmig/ledger';
import {
  createTokenProvider,
} from '@openmig/connectors';
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
import {
  GOOGLE_DRIVE_CONNECTION_KIND,
  STORED_GOOGLE_CREDENTIAL_NAMES,
  buildGoogleDriveSourceFrom,
} from './drive-source-factory';
import { STORED_GMAIL_CREDENTIAL_NAMES, buildGmailSourceFrom } from './gmail-source-factory';
import { PgLedger, PgCursorStore, createPgDb, withTenant } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { mailboxMapping } from '@openmig/ledger';
import { withClose, type WithClose } from './deps-lifecycle';
import {
  STORED_CREDENTIAL_NAMES,
  buildGraphMailSourceFrom,
  buildImapSourceFrom,
  withGraphFallback,
} from './mail-source-factory';
import { buildJmapTargetFrom, buildImapDavTargetFrom } from './mail-target-factory';

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
    // THE MAPPING'S OWN connections, mailbox → connection (RLS-enforced), with
    // the tenant-role row only as a logged fallback for legacy rows whose
    // mailboxes carry no connection id. "The tenant's first source row" was
    // survivable while a tenant could only hold one; the moment the wizard can
    // also create a `google_drive` source connection, an unordered first row
    // can be the wrong PROVIDER, and the mail pass would open Drive
    // credentials and refuse — nondeterministically, by planner mood.
    const viaMailbox = async (mailboxId: string | null) => {
      if (!mailboxId) return undefined;
      const rows = await txDb
        .select()
        .from(connectionTable)
        .innerJoin(mailboxTable, eq(mailboxTable.connectionId, connectionTable.id))
        .where(and(eq(mailboxTable.id, mailboxId), eq(connectionTable.tenantId, tenantId)));
      return rows[0]?.connection;
    };
    const byRole = async (role: 'source' | 'target') => {
      const rows = await txDb
        .select()
        .from(connectionTable)
        .where(and(eq(connectionTable.tenantId, tenantId), eq(connectionTable.role, role)));
      if (rows[0]) {
        log.warn(
          `[deps] mapping ${mappingId}: its ${role} mailbox names no connection; falling back ` +
            `to the tenant's first ${role} connection row. Fine for a single-connection ` +
            'tenant; ambiguous the moment there are two.',
        );
      }
      return rows[0];
    };

    const mapping = mappings[0]!;
    const sourceConnection =
      (await viaMailbox(mapping.sourceMailboxId)) ?? (await byRole('source'));
    if (!sourceConnection) {
      throw new Error(`Source connection not found for tenant: ${tenantId}`);
    }
    const targetConnection =
      (await viaMailbox(mapping.targetMailboxId)) ?? (await byRole('target'));
    if (!targetConnection) {
      throw new Error(`Target connection not found for tenant: ${tenantId}`);
    }
    
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
      ...(mappings[0]!.targetFolderPrefix
        ? { targetFolderPrefix: mappings[0]!.targetFolderPrefix }
        : {}),
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

/**
 * Load source + target connection config/credentials/kind — THE MAPPING'S OWN
 * connections, resolved mapping → mailbox → connection (RLS-enforced).
 *
 * It used to take the tenant's first row per role, with no ORDER BY. One
 * mapping per tenant made that look correct; the moment a tenant has two —
 * mail from O365 and files from Google Drive is the shape that forced this —
 * "first" is whichever row the planner returns, and a pass could open the
 * WRONG PROVIDER'S credentials. The mapping has named its connections since
 * the 0001 baseline (via its mailboxes); this finally reads them.
 *
 * The tenant-role row remains as a FALLBACK, not a preference: legacy rows
 * created before mailboxes carried a connection id would otherwise stop
 * building at all, and a fallback that only fires when the mapping cannot
 * answer is exactly as safe as what every one of those tenants runs today.
 */
async function loadDomainConnections(
  pool: Pool,
  tenantId: string,
  mappingId: string,
): Promise<{
  source: { config: Record<string, unknown>; creds: Record<string, string>; kind: string };
  target: { config: Record<string, unknown>; creds: Record<string, string>; kind: string };
  targetFolderPrefix?: string;
}> {
  return withTenant(pool, tenantId, async (txDb) => {
    const mappingRows = await txDb
      .select({
        sourceMailboxId: mailboxMapping.sourceMailboxId,
        targetMailboxId: mailboxMapping.targetMailboxId,
        targetFolderPrefix: mailboxMapping.targetFolderPrefix,
      })
      .from(mailboxMapping)
      .where(and(eq(mailboxMapping.tenantId, tenantId), eq(mailboxMapping.id, mappingId)));
    const mapping = mappingRows[0];
    if (!mapping) {
      throw new Error(`Mapping not found or access denied: ${mappingId}`);
    }

    const load = async (role: 'source' | 'target') => {
      const mailboxId = role === 'source' ? mapping.sourceMailboxId : mapping.targetMailboxId;
      let conn;
      if (mailboxId) {
        const viaMapping = await txDb
          .select()
          .from(connectionTable)
          .innerJoin(mailboxTable, eq(mailboxTable.connectionId, connectionTable.id))
          .where(and(eq(mailboxTable.id, mailboxId), eq(connectionTable.tenantId, tenantId)));
        conn = viaMapping[0]?.connection;
      }
      if (!conn) {
        const rows = await txDb
          .select()
          .from(connectionTable)
          .where(and(eq(connectionTable.tenantId, tenantId), eq(connectionTable.role, role)));
        conn = rows[0];
        if (conn) {
          log.warn(
            `[deps] mapping ${mappingId}: its ${role} mailbox names no connection; falling ` +
              `back to the tenant's first ${role} connection row. Fine for a ` +
              'single-connection tenant; ambiguous the moment there are two.',
          );
        }
      }
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
    return {
      source: await load('source'),
      target: await load('target'),
      ...(mapping.targetFolderPrefix ? { targetFolderPrefix: mapping.targetFolderPrefix } : {}),
    };
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

    const {
      source: src,
      target: tgt,
      targetFolderPrefix,
    } = await loadDomainConnections(pool, tenantId, mappingId);
    const common = { tenantId: tId, mappingId: mId, ledger, cursors };
    const targetDeps = { ledger, tenantId: tId, mappingId: mId };

    // DAV endpoints are resolved INSIDE the branches that are DAV-shaped, not
    // hoisted above them. Hoisting was a live bug, not a style point: a
    // `google_drive` source has OAuth credentials and no username/password, so
    // the eager source resolution threw "missing credentials" before the file
    // branch — the one that knows how to build a Drive source — could run at
    // all. The managed Drive path was wired (T5) and unreachable.
    // Attach close() so the caller releases the pool after the pass (never leak it).
    if (domain === 'calendar') {
      return withClose(
        {
          ...common,
          source: buildCalendarSource(davEndpointFromCreds('source', src.config, src.creds)),
          target: buildCalendarTarget(
            davEndpointFromCreds('target', tgt.config, tgt.creds),
            targetDeps,
          ),
        } satisfies CalendarSyncDeps,
        db,
      );
    }
    if (domain === 'contact') {
      return withClose(
        {
          ...common,
          source: buildContactSource(davEndpointFromCreds('source', src.config, src.creds)),
          // Contacts can go over JMAP where the target speaks it (0031 T2).
          // Read off the connection's own `kind`, which has allowed `jmap`
          // since the 0001 baseline, so this needs no migration and no new
          // config field. Anything else stays on CardDAV, which is what every
          // existing mapping is and must remain.
          target: buildContactTargetFor(
            contactTargetProtocol(tgt.kind),
            davEndpointFromCreds('target', tgt.config, tgt.creds),
            targetDeps,
          ),
        } satisfies ContactSyncDeps,
        db,
      );
    }
    const fileSource = buildFileSourceFromConnection(src);
    const fileTgtEndpoint = fileEndpointFromCreds('target', tgt.config, tgt.creds, tgt.kind);
    return withClose(
      {
        ...common,
        source: fileSource,
        ...(targetFolderPrefix ? { targetFolderPrefix } : {}),
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
 * Choose and build the FILE source a stored connection describes (0042 T5).
 *
 * Two providers, and the difference is not a URL — it is whether the connection
 * has a URL at all. Google withdrew WebDAV support years ago, so a Drive
 * connection has no url/username/password to resolve; handing it to
 * `fileEndpointFromCreds` would refuse it for missing credentials that do not
 * exist for this provider, and never look at the OAuth ones it does have.
 *
 * The stored `config` blob is untyped JSON, so it goes through the SAME
 * validator the appliance's mapping file does. Hard rule 5: a
 * `nativeFilePolicy` one edition refuses must not be one the other accepts and
 * silently ignores.
 *
 * Exported for unit tests, on the precedent of
 * `buildSourceConnectorFromCredentials` below: the branch and its refusals are
 * the behaviour worth pinning, and they need no database to prove.
 */
export function buildFileSourceFromConnection(src: {
  config: Record<string, unknown>;
  creds: Record<string, string>;
  kind: string;
}): FileSource {
  if (src.kind === GOOGLE_DRIVE_CONNECTION_KIND) {
    return buildGoogleDriveSourceFrom(
      parseGoogleDriveSource(src.config),
      src.creds,
      STORED_GOOGLE_CREDENTIAL_NAMES,
    );
  }
  return buildFileSource(fileEndpointFromCreds('source', src.config, src.creds, src.kind));
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
  if (sourceConfig.type === 'gmail') {
    // The credential-store half only: name the stored fields and hand off. The
    // refusal for missing ones lives in the shared factory, so both editions
    // refuse in the same words (rule 5) — here in the stored-credential
    // vocabulary a managed operator can act on, not env-var names.
    return buildGmailSourceFrom(sourceConfig.user, credentials, STORED_GMAIL_CREDENTIAL_NAMES);
  }
  if (sourceConfig.type !== 'imap-oauth2') {
    throw new Error(`buildDepsFromMapping only supports imap-oauth2, graph-mail and gmail mail sources, got: ${sourceConfig.type}`);
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
    // STORED_CREDENTIAL_NAMES, not the env-var names: a managed operator edits
    // the connection's credentials and has no OAUTH2_* variables to unset. The
    // refusal used to tell them to, which is advice they could not act on.
    { clientId, clientSecret, refreshToken, naming: STORED_CREDENTIAL_NAMES },
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
 *
 * Exported for unit tests, for the same reason
 * `buildSourceConnectorFromCredentials` above is: the branch-per-type and its
 * refusals are the behaviour worth pinning, and they need no database to prove.
 *
 * It was NOT exported until now, and the consequence was invisible: this suite
 * had no target coverage at all, so breaking the managed target construction
 * failed nothing. Found while collapsing it onto the shared builder (workplan
 * 0041 T3) — the mutation check the workplan asks for is what surfaced it.
 */
export function buildTargetWriterFromCredentials(
  targetConfig: TargetConfig,
  credentials: Record<string, string>
): TargetWriter {
  switch (targetConfig.type) {
    case 'jmap': {
      const password = credentials.password || credentials.token || credentials.api_key;
      if (!password) {
        throw new Error('JMAP target password/token not found in credentials');
      }

      return buildJmapTargetFrom(targetConfig, password);
    }

    case 'imap-dav': {
      const password = credentials.password || credentials.access_token;
      if (!password) {
        throw new Error('IMAP/DAV target password not found in credentials');
      }

      return buildImapDavTargetFrom(targetConfig, password);
    }

    default:
      throw new Error(`Unsupported target type: ${(targetConfig as { type: string }).type}`);
  }
}
