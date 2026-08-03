// Copyright 2026 OpenHands Agent (Apache-2.0)
// Dependency bundle builder for the worker.
// Wires together: Postgres ledger, IMAP source, JMAP target, cursor store.
// Implements the full ReconcileDeps for runShadowPass.

import {
  type ReconcileDeps,
  type MappingConfig,
  type SourceConnector,
  type TargetWriter,
  type TokenProviderConfig,
  ThrottleLimiter,
  type ThrottleConfig,
  createThrottleLimiterFromMapping,
  type TenantId,
  type MappingId,
  type Ledger,
  type CursorStore,
  type MigrationStatusStore as _MigrationStatusStore,
  type CalendarSource,
  type CalendarTargetWriter,
  type ContactSource,
  type ContactTargetWriter,
  type FileSource,
  type FileTargetWriter,
  type SourceConfig,
  type TargetConfig,
} from '@openmig/shared';
import {
  ImapSource,
  GraphMailSource,
  MailSourceWithGraphFallback,
  ImapDavMailTarget,
  type ImapDavTargetConfig,
  createTokenProvider,
} from '@openmig/connectors';
import { JmapTargetWriter } from '@openmig/connectors';
import { PgLedger } from '@openmig/ledger';
import { PgCursorStore } from '@openmig/ledger';
import { createPgDb, type PgDatabase } from '@openmig/ledger';
import {
  type DavEndpoint,
  buildCalendarSource,
  buildCalendarTarget,
  buildContactSource,
  buildContactTarget,
  buildFileSource,
  buildFileTarget,
} from './dav-factories';
import { withClose, type WithClose } from './deps-lifecycle';

/**
 * Items in flight per collection when the config does not say. Matches
 * `DEFAULT_CONCURRENCY` in @openmig/core — kept in step deliberately, so the
 * managed and self-host paths do not quietly disagree about how hard they push
 * a customer's server. Override with `concurrency` per mapping or per domain.
 */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Ledger connections per domain pass.
 *
 * Domain lanes run in parallel now, so a mapping can hold one of these pools
 * per lane rather than one at a time. The sync loop only ever has `concurrency`
 * items in flight and each does one ledger operation at a time, so a handful of
 * connections is all a pass can use — and capping it keeps several lanes across
 * several mappings well clear of Postgres's connection limit.
 */
const LEDGER_POOL_MAX = DEFAULT_CONCURRENCY + 2;

/**
 * A ledger the CALLER already owns, for a process that has one.
 *
 * The builders below default to opening their own `pg.Pool` from
 * `DATABASE_URL`, which is right for the managed worker: it is stateless, a
 * pass is a job, and the pool dies with it.
 *
 * It is wrong for the self-host appliance on PGlite, and wrong in a way that
 * looked like it worked. PGlite is Postgres compiled to WASM running
 * **in-process** — there is no address to connect to and no second connection
 * to open — so a builder that reaches for `DATABASE_URL` is not talking to the
 * appliance's database at all. On the container path it silently opened a
 * SECOND pool to the same server and behaved; with the Postgres service gone it
 * failed on the first ledger query of every domain with
 * `getaddrinfo ENOTFOUND postgres`, which is how this was found.
 *
 * Pass this and the builder uses the handle instead of opening one — and its
 * `close()` becomes a no-op, because the caller owns the lifetime. Closing an
 * injected handle after a pass would take the appliance's whole database down
 * with it.
 */
export interface LedgerOptions {
  /** A drizzle handle bound to the caller's database. Not closed by the builder. */
  readonly ledgerDb?: PgDatabase;
}

/**
 * The ledger + cursor store a pass runs against, plus whatever needs closing.
 *
 * One place, so the two builders cannot drift on the part that decides which
 * database the work lands in.
 */
function openLedger(options: LedgerOptions | undefined): {
  db: PgDatabase;
  ledger: PgLedger;
  cursors: PgCursorStore;
  closable: { close: () => Promise<void> };
} {
  const provided = options?.ledgerDb;
  if (provided) {
    return {
      db: provided,
      ledger: new PgLedger(provided),
      cursors: new PgCursorStore(provided),
      // The caller's, not ours. See LedgerOptions.
      closable: { close: async () => {} },
    };
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Example: postgres://user:password@localhost:5432/openmig'
    );
  }
  // Fail rather than connect to whatever DATABASE_URL happens to name. On the
  // PGlite appliance that variable is still set — compose merges maps key by
  // key, so an override cannot remove what the base file declares — and reading
  // it means a pass writes its ledger somewhere other than the database the
  // appliance migrated and serves. Silent divergence beats a crash only until
  // somebody looks at the data.
  if (process.env.SELFHOST_PERSISTENCE === 'pglite') {
    throw new Error(
      'The appliance is running on PGlite, so a pass cannot open its own ' +
      'Postgres pool — it must be given the appliance\'s ledger handle ' +
      '(`ledgerDb`). This is a wiring bug, not a configuration one.',
    );
  }

  const db = createPgDb(databaseUrl, LEDGER_POOL_MAX);
  return { db, ledger: new PgLedger(db), cursors: new PgCursorStore(db), closable: db };
}

/**
 * Build the complete dependency bundle for a shadow pass.
 * This wires together all the components needed for the worker to run.
 */
export async function buildDeps(
  config: MappingConfig,
  options?: LedgerOptions,
): Promise<WithClose<ReconcileDeps>> {
  const { ledger, cursors, closable } = openLedger(options);

  // Build throttle limiter from domain configuration
  const throttleLimiter = buildThrottleLimiter(config);

  // The mail domain uses its per-domain config (`domains.mail`) when present,
  // else the top-level source/target (see resolveMailConfig).
  const { source: mailSource, target: mailTarget, concurrency } = resolveMailConfig(config);

  // Build source connector from config
  const source = buildSourceConnector(mailSource, throttleLimiter);

  // Build target writer from config
  const target = buildTargetWriter(mailTarget);

  // Attach close() so the caller releases the pool after the pass (never leak it).
  return withClose(
    {
      tenantId: config.tenantId as unknown as ReconcileDeps['tenantId'],
      mappingId: config.mappingId as unknown as ReconcileDeps['mappingId'],
      source,
      target,
      ledger,
      cursors,
      concurrency,
      ...(config.onCollision ? { onCollision: config.onCollision } : {}),
      // Absent leaves the default (trash + junk) in place, which is what almost
      // every owner wants. An explicit [] means "migrate everything", which is
      // legitimate for anyone who treats Deleted Items as an archive.
      ...(config.excludeSpecialUse !== undefined
        ? { excludeSpecialUse: config.excludeSpecialUse }
        : {}),
    },
    closable,
  );
}

/**
 * The effective mail source/target/concurrency for a mapping: the per-domain
 * `domains.mail` config when the mapping provides one, falling back to the
 * top-level `source`/`target`. Previously the top-level was always used, so a
 * `domains.mail.source`/`target` was silently ignored; a top-level-only mapping
 * is unaffected. Pure — exported for unit testing.
 */
export function resolveMailConfig(config: MappingConfig): {
  source: SourceConfig;
  target: TargetConfig;
  concurrency: number;
} {
  const mail = config.domains?.mail;
  return {
    source: mail?.source ?? config.source,
    target: mail?.target ?? config.target,
    concurrency: mail?.concurrency ?? config.concurrency ?? DEFAULT_CONCURRENCY,
  };
}

/**
 * Build a throttle limiter from the mapping configuration.
 * Uses per-domain throttle config if available, otherwise uses defaults.
 */
function buildThrottleLimiter(config: MappingConfig): ThrottleLimiter | undefined {
  // If we have domain-specific throttle configs, create a limiter from them
  if (config.domains) {
    const throttleConfigMapping: Record<string, Partial<ThrottleConfig>> = {};
    
    // Collect throttle configs from all domains
    for (const [domainName, domainConfig] of Object.entries(config.domains)) {
      if (domainConfig?.throttleConfig) {
        // Use the domain name as the key for the throttle config
        throttleConfigMapping[domainName] = domainConfig.throttleConfig;
      }
    }
    
    // If we have any throttle configs, create a limiter
    if (Object.keys(throttleConfigMapping).length > 0) {
      return createThrottleLimiterFromMapping(throttleConfigMapping);
    }
  }
  
  // Return undefined if no throttle config is specified
  return undefined;
}

/**
 * Build a source connector from the mapping config.
 * Supports imap-oauth2 (TokenProvider for automatic token refresh) and
 * graph-mail (workplan 0023 T2 — ADR-0006's IMAP-disabled fallback).
 * Note: For graph-calendar and graph-contacts, use separate build functions.
 */
function buildSourceConnector(sourceConfig: MappingConfig['source'], throttleLimiter?: ThrottleLimiter): SourceConnector {
  switch (sourceConfig.type) {
    case 'imap-oauth2':
      return buildImapSource(sourceConfig, throttleLimiter);
    case 'graph-mail':
      return buildGraphMailSource(sourceConfig, throttleLimiter);

    default:
      throw new Error(`Unsupported source type for ReconcileDeps: ${(sourceConfig as {type: string}).type}. Use buildGraphCalendarSource or buildGraphContactsSource for graph cal/contact sources.`);
  }
}

/**
 * Build the Graph mail source (workplan 0023 T2).
 *
 * Token credentials come from the same OAUTH2_* env vars the IMAP XOAUTH2
 * path already reads — but here they are REQUIRED: there is no static-token
 * fallback (a Graph token expires within the first long pass), and
 * constructing the source without a working token provider would fail later
 * and less clearly. Fail at build time, naming the variable (rule 9).
 *
 * Two flows, chosen by what is set: OAUTH2_REFRESH_TOKEN -> delegated
 * refresh-token flow scoped to Mail.Read; otherwise OAUTH2_CLIENT_SECRET ->
 * client-credentials with .default (application permissions — needs admin
 * consent plus an Application Access Policy, ADR-0006).
 */
function buildGraphMailSource(sourceConfig: MappingConfig['source'], throttleLimiter?: ThrottleLimiter): SourceConnector {
  if (sourceConfig.type !== 'graph-mail') {
    throw new Error(`Expected graph-mail source, got: ${sourceConfig.type}`);
  }

  const clientId = process.env.OAUTH2_CLIENT_ID;
  const clientSecret = process.env.OAUTH2_CLIENT_SECRET;
  const refreshToken = process.env.OAUTH2_REFRESH_TOKEN;

  if (!clientId) {
    throw new Error('graph-mail source: OAUTH2_CLIENT_ID is not set (the Entra app registration id)');
  }
  if (!clientSecret && !refreshToken) {
    throw new Error(
      'graph-mail source: set OAUTH2_CLIENT_SECRET (client-credentials flow) or OAUTH2_REFRESH_TOKEN (delegated flow)',
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
 * Build an IMAP source connector.
 */
function buildImapSource(sourceConfig: MappingConfig['source'], throttleLimiter?: ThrottleLimiter): SourceConnector {
  if (sourceConfig.type !== 'imap-oauth2') {
    throw new Error(`Expected imap-oauth2 source, got: ${sourceConfig.type}`);
  }
  
  // Build TokenProvider if we have OAuth2 credentials configured
  let tokenProviderConfig: TokenProviderConfig | undefined;
  
  if (sourceConfig.auth.kind === 'xoauth2') {
    // Check if we have additional OAuth2 configuration for token provider
    // This would typically come from environment variables or config
    const tenantId = process.env.OAUTH2_TENANT_ID;
    const clientId = process.env.OAUTH2_CLIENT_ID;
    const clientSecret = process.env.OAUTH2_CLIENT_SECRET;
    const refreshToken = process.env.OAUTH2_REFRESH_TOKEN;
    
    // Only create TokenProvider if we have the necessary credentials
    if (tenantId && clientId) {
      tokenProviderConfig = {
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId,
        clientSecret,
        tenantId,
        scope: 'https://outlook.office.com/IMAP.AccessAsUser.All',
        refreshToken,
      };
    }
  }

  const imapConfig = {
    host: sourceConfig.host,
    port: sourceConfig.port,
    tls: sourceConfig.port === 993, // Use TLS for IMAPS (matches the target-side rule below)
    auth: {
      user: sourceConfig.user,
      accessToken: sourceConfig.auth.kind === 'xoauth2'
        ? process.env[sourceConfig.auth.tokenFromEnv]
        : undefined,
      password: sourceConfig.auth.kind === 'login'
        ? process.env[sourceConfig.auth.passwordFromEnv]
        : undefined,
    },
    // authType must follow the configured auth kind — ImapSource.connect() branches on it
    // to decide xoauth2 vs password auth; hardcoding XOAUTH2 here silently dropped LOGIN
    // credentials (the password was never even read) and IMAP servers rejected the
    // resulting empty XOAUTH2 attempt with "No supported authentication method(s)".
    authType: sourceConfig.auth.kind === 'xoauth2' ? ('XOAUTH2' as const) : ('LOGIN' as const),
    tokenProvider: tokenProviderConfig ? createTokenProvider(tokenProviderConfig) : undefined,
    throttleLimiter, // Pass throttle limiter if available
  };

  const imap = new ImapSource(imapConfig);

  // The runtime IMAP-disabled fallback (workplan 0023 T3, ADR-0006): when the
  // env ALSO carries Graph-capable credentials — OAUTH2_TENANT_ID is the
  // signal, since graph needs it for the token endpoint and plain IMAP does
  // not — wrap the source so an auth-refused mailbox is probed over Graph
  // instead of dead-ending the run. Construction is LAZY inside the wrapper:
  // a mapping whose IMAP works never touches these credentials.
  const graphTenantId = process.env.OAUTH2_TENANT_ID;
  const hasGraphCreds =
    graphTenantId &&
    process.env.OAUTH2_CLIENT_ID &&
    (process.env.OAUTH2_CLIENT_SECRET || process.env.OAUTH2_REFRESH_TOKEN);
  if (hasGraphCreds) {
    return new MailSourceWithGraphFallback(imap, () =>
      buildGraphMailSource({ type: 'graph-mail', tenantId: graphTenantId }, throttleLimiter),
    );
  }

  return imap;
}

// NOTE: Microsoft Graph calendar/contacts sources are not wired into the
// file-config path (imap-oauth2 + graph-mail for mail, caldav/carddav/webdav
// for the DAV domains). The previous `_buildGraph*` scaffolding here was dead
// code; supporting Graph cal/contact sources is a future feature, tracked
// separately. `buildSourceConnector` throws a clear "Unsupported source type"
// until then. (graph-mail joined in workplan 0023 T2 — ADR-0006's fallback.)

/**
 * Build a target writer from the mapping config.
 * Supports both JMAP and IMAP/DAV target types.
 */
function buildTargetWriter(targetConfig: MappingConfig['target']): TargetWriter {
  switch (targetConfig.type) {
    case 'jmap': {
      // For JMAP targets, we need to determine the password based on auth type
      // - basic: password from environment variable
      // - bearer: we use the token as password (JMAP library accepts it)
      let password: string;
      if (targetConfig.auth.kind === 'basic') {
        password = process.env[targetConfig.auth.passwordFromEnv] ?? '';
      } else if (targetConfig.auth.kind === 'bearer') {
        // For bearer token auth, we use the token as the password
        password = process.env[targetConfig.auth.tokenFromEnv] ?? '';
      } else {
        throw new Error(`Unsupported JMAP auth kind: ${(targetConfig.auth as {kind: string}).kind}`);
      }

      if (!password) {
        throw new Error(
          `JMAP target password/token not found in environment: ` +
          `check ${targetConfig.auth.kind === 'basic' 
            ? targetConfig.auth.passwordFromEnv 
            : targetConfig.auth.tokenFromEnv}`
        );
      }

      const jmapConfig = {
        baseUrl: targetConfig.baseUrl,
        username: targetConfig.user,
        password,
      };

      return new JmapTargetWriter(jmapConfig);
    }

    case 'imap-dav': {
      // For IMAP/DAV targets, get password from environment
      // Auth can be 'login' (password) or 'xoauth2' (access token)
      let password: string;
      if (targetConfig.auth.kind === 'login') {
        password = process.env[targetConfig.auth.passwordFromEnv] ?? '';
      } else if (targetConfig.auth.kind === 'xoauth2') {
        password = process.env[targetConfig.auth.tokenFromEnv] ?? '';
      } else {
        throw new Error(`Unsupported IMAP/DAV auth kind: ${(targetConfig.auth as {kind: string}).kind}`);
      }
      
      if (!password) {
        throw new Error(
          `IMAP/DAV target credentials not found in environment: ` +
          `check ${targetConfig.auth.kind === 'login' 
            ? targetConfig.auth.passwordFromEnv 
            : targetConfig.auth.tokenFromEnv}`
        );
      }

      const imapConfig: ImapDavTargetConfig = {
        host: targetConfig.host,
        port: targetConfig.port,
        tls: targetConfig.port === 993, // Use TLS for IMAPS
        username: targetConfig.user,
        password,
      };

      return new ImapDavMailTarget(imapConfig);
    }

    default: {
      throw new Error(`Unsupported target type: ${(targetConfig as {type: string}).type}`);
    }
  }
}

/**
 * Build domain-specific dependencies for DAV syncs (calendar, contacts, files).
 * This creates the appropriate source and target for the given domain.
 */
export function buildDomainDeps(
  config: MappingConfig,
  domain: 'calendar',
  options?: LedgerOptions,
): WithClose<{
  tenantId: TenantId;
  mappingId: MappingId;
  source: CalendarSource;
  target: CalendarTargetWriter;
  ledger: Ledger;
  cursors?: CursorStore;
  concurrency?: number;
}>;
export function buildDomainDeps(
  config: MappingConfig,
  domain: 'contact',
  options?: LedgerOptions,
): WithClose<{
  tenantId: TenantId;
  mappingId: MappingId;
  source: ContactSource;
  target: ContactTargetWriter;
  ledger: Ledger;
  cursors?: CursorStore;
  concurrency?: number;
}>;
export function buildDomainDeps(
  config: MappingConfig,
  domain: 'file',
  options?: LedgerOptions,
): WithClose<{
  tenantId: TenantId;
  mappingId: MappingId;
  source: FileSource;
  target: FileTargetWriter;
  ledger: Ledger;
  cursors?: CursorStore;
  concurrency?: number;
}>;
export function buildDomainDeps(
  config: MappingConfig,
  domain: 'calendar' | 'contact' | 'file',
  options?: LedgerOptions,
): WithClose<{
  tenantId: TenantId;
  mappingId: MappingId;
  source: CalendarSource | ContactSource | FileSource;
  target: CalendarTargetWriter | ContactTargetWriter | FileTargetWriter;
  ledger: Ledger;
  cursors?: CursorStore;
  concurrency?: number;
}> {
  const { ledger, cursors, closable } = openLedger(options);

  // Get domain config
  let domainConfig;
  switch (domain) {
    case 'calendar':
      domainConfig = config.domains?.calendar;
      break;
    case 'contact':
      domainConfig = config.domains?.contacts;
      break;
    case 'file':
      domainConfig = config.domains?.files;
      break;
  }

  if (!domainConfig?.enabled) {
    throw new Error(`Domain ${domain} is not enabled in config`);
  }

  // Build source connector based on domain type
  const sourceConfig = domainConfig.source;
  const targetConfig = domainConfig.target;
  const tenantId = config.tenantId as TenantId;
  const mappingId = config.mappingId as MappingId;
  const targetDeps = { ledger, tenantId, mappingId };

  // Build the real native DAV connectors from the file config + env-resolved
  // credentials (shared with the managed DB path via dav-factories).
  let source: CalendarSource | ContactSource | FileSource;
  let target: CalendarTargetWriter | ContactTargetWriter | FileTargetWriter;
  switch (domain) {
    case 'calendar':
      source = buildCalendarSource(davEndpoint(sourceConfig, 'caldav', 'source'));
      target = buildCalendarTarget(davEndpoint(targetConfig, 'caldav', 'target'), targetDeps);
      break;
    case 'contact':
      source = buildContactSource(davEndpoint(sourceConfig, 'carddav', 'source'));
      target = buildContactTarget(davEndpoint(targetConfig, 'carddav', 'target'), targetDeps);
      break;
    case 'file':
      source = buildFileSource(davEndpoint(sourceConfig, 'webdav', 'source'));
      target = buildFileTarget(davEndpoint(targetConfig, 'webdav', 'target'), targetDeps);
      break;
  }

  return withClose(
    {
      tenantId,
      mappingId,
      source,
      target,
      ledger,
      cursors,
      concurrency: domainConfig.concurrency ?? config.concurrency ?? DEFAULT_CONCURRENCY,
      ...(config.onCollision ? { onCollision: config.onCollision } : {}),
      // Absent leaves the default (trash + junk) in place, which is what almost
      // every owner wants. An explicit [] means "migrate everything", which is
      // legitimate for anyone who treats Deleted Items as an archive.
      ...(config.excludeSpecialUse !== undefined
        ? { excludeSpecialUse: config.excludeSpecialUse }
        : {}),
    },
    closable,
  );
}

/** Resolve a file-config DAV endpoint (url/user + env-based credential) for a factory. */
function davEndpoint(
  cfg: SourceConfig | TargetConfig,
  expected: 'caldav' | 'carddav' | 'webdav',
  role: 'source' | 'target',
): DavEndpoint {
  if (cfg.type !== expected) {
    throw new Error(`Expected ${expected} ${role}, got ${(cfg as { type: string }).type}`);
  }
  const c = cfg as { url: string; user: string; auth: { kind: string; passwordFromEnv?: string; tokenFromEnv?: string } };
  const envName =
    c.auth.kind === 'login' || c.auth.kind === 'basic'
      ? c.auth.passwordFromEnv
      : c.auth.kind === 'xoauth2'
        ? c.auth.tokenFromEnv
        : undefined;
  if (!envName) {
    throw new Error(`Unsupported ${expected} ${role} auth kind: ${c.auth.kind}`);
  }
  const password = process.env[envName];
  if (!password) {
    throw new Error(`${expected} ${role} credential env var ${envName} is not set`);
  }
  return { url: c.url, username: c.user, password };
}
