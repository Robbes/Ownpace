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
  DEFAULT_CONCURRENCY,
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
  InProcessByteBudget,
  imapDownloadPlan,
} from '@openmig/shared';
import {
  createTokenProvider,
  type ImapByteMeter,
} from '@openmig/connectors';
import { PgLedger } from '@openmig/ledger';
import { PgCursorStore } from '@openmig/ledger';
import { createPgDb, type PgDatabase } from '@openmig/ledger';
import {
  type DavEndpoint,
  buildCalendarSource,
  buildCalendarTarget,
  buildTaskSource,
  buildTaskTarget,
  buildContactSource,
  buildFileSource,
} from './dav-factories.ts';
import { buildContactTargetFor, contactTargetProtocol } from './contact-target-factory.ts';
import { buildFileTargetFor, fileTargetProtocol } from './file-target-factory.ts';
import {
  ENV_GOOGLE_CREDENTIAL_NAMES,
  buildGoogleDriveSourceFrom,
} from './drive-source-factory.ts';
import { ENV_GMAIL_CREDENTIAL_NAMES, buildGmailSourceFrom } from './gmail-source-factory.ts';
import {
  ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES,
  ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES,
  buildGoogleCalendarDavSourceFrom,
  buildGoogleContactsDavSourceFrom,
} from './google-dav-source-factory.ts';
import {
  ENV_DROPBOX_CREDENTIAL_NAMES,
  buildDropboxSourceFrom,
} from './dropbox-source-factory.ts';
import { ENV_BOX_CREDENTIAL_NAMES, buildBoxSourceFrom } from './box-source-factory.ts';
import {
  buildGraphCalendarSourceFrom,
  buildGraphTodoSourceFrom,
  buildGraphContactsSourceFrom,
  buildGraphDriveSourceFrom,
  graphEntraCredsFromEnv,
} from './graph-domain-source-factory.ts';
import { withClose, type WithClose } from './deps-lifecycle.ts';
import { schedulingRecorder } from './target-scheduling.ts';
import {
  buildGraphMailSourceFrom,
  buildImapSourceFrom,
  withGraphFallback,
} from './mail-source-factory.ts';
import { buildJmapTargetFrom, buildImapDavTargetFrom } from './mail-target-factory.ts';

/**
 * Items in flight per collection when the config does not say.
 *
 * Re-exported rather than re-declared. This used to be its own `= 4` with a
 * comment saying it "matches `DEFAULT_CONCURRENCY` in @openmig/core — kept in
 * step deliberately, so the managed and self-host paths do not quietly disagree
 * about how hard they push a customer's server". Nothing kept it in step, and
 * `build-deps-from-mapping.ts` — the MANAGED path — did not even use this one:
 * it had a bare `?? 4` of its own. Hard rule 5 says the editions do not differ,
 * so the value now comes from one module and the promise is an import.
 *
 * Override with `concurrency` per mapping or per domain.
 */
export { DEFAULT_CONCURRENCY };

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
      'Example: postgres://user:password@localhost:5432/ownpace'
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

  // The daily DOWNLOAD meter for the mail source's endpoint (workplan 0090
  // T3) — same decision rule as the managed edition (`imapDownloadPlan`,
  // hard rule 5), in-process state: on the appliance one process is the
  // whole service. One honest residue rides with that and is recorded in
  // the workplan: a restart forgets the day's count, so the window restarts
  // conservative-side-out only in the sense that nothing OVER-counts —
  // headroom under the ceiling is the mitigation until somebody wires this
  // to the appliance's own durable store.
  const downloadPlan = imapDownloadPlan(
    mailSource.type === 'gmail'
      ? 'imap.gmail.com'
      : mailSource.type === 'imap-oauth2'
        ? mailSource.host
        : undefined,
    config.domains?.mail?.throttleConfig?.downloadBytesPerDay,
  );
  const byteMeter: ImapByteMeter | undefined = downloadPlan
    ? {
        budget: new InProcessByteBudget({ bytesPerDay: downloadPlan.bytesPerDay }),
        tenantId: config.tenantId,
        provider: downloadPlan.provider,
      }
    : undefined;

  // Build source connector from config
  const source = buildSourceConnector(mailSource, throttleLimiter, byteMeter);

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
      ...(config.targetFolderPrefix !== undefined
        ? { targetFolderPrefix: config.targetFolderPrefix }
        : {}),
      // The same meter the connector spends, handed to the loop as its gate
      // (0090 T4): one instance, so the state the gate reads is the state the
      // fetches moved.
      ...(byteMeter ? { downloadMeter: byteMeter } : {}),
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
function buildSourceConnector(sourceConfig: MappingConfig['source'], throttleLimiter?: ThrottleLimiter, byteMeter?: ImapByteMeter): SourceConnector {
  switch (sourceConfig.type) {
    case 'imap-oauth2':
      return buildImapSource(sourceConfig, throttleLimiter, byteMeter);
    case 'graph-mail':
      // No byteMeter: 0090's verified ceiling belongs to Gmail's IMAP
      // endpoint, and inventing one for Graph would be the plan's own
      // warning realised.
      return buildGraphMailSource(sourceConfig, throttleLimiter);
    case 'gmail':
      // The env-specific half only: read the three GOOGLE_* variables and hand
      // off. The refusal naming missing ones lives in the shared factory, so
      // both editions refuse in the same words (rule 5).
      return buildGmailSourceFrom(
        sourceConfig.user,
        {
          clientId: process.env[ENV_GMAIL_CREDENTIAL_NAMES.clientId],
          clientSecret: process.env[ENV_GMAIL_CREDENTIAL_NAMES.clientSecret],
          refreshToken: process.env[ENV_GMAIL_CREDENTIAL_NAMES.refreshToken],
          // Domain-wide delegation (ADR-0033): a key here selects the
          // JWT-bearer flow; the mapping's user is the impersonated subject.
          serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
        },
        ENV_GMAIL_CREDENTIAL_NAMES,
        undefined,
        byteMeter,
      );

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
 *
 * This function is now only the ENV-SPECIFIC half: read the variables, refuse
 * naming them. The construction it hands off to is shared with the managed
 * edition (`mail-source-factory.ts`, workplan 0041) — the two were byte-
 * identical from the mailbox refusal onward, and a fix to one was silently not
 * a fix to the other.
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

  return buildGraphMailSourceFrom(
    sourceConfig,
    { clientId, clientSecret, refreshToken },
    throttleLimiter,
  );
}

/**
 * Build an IMAP source connector.
 */
function buildImapSource(sourceConfig: MappingConfig['source'], throttleLimiter?: ThrottleLimiter, byteMeter?: ImapByteMeter): SourceConnector {
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

  const resolvedAuth = {
      accessToken: sourceConfig.auth.kind === 'xoauth2'
        ? process.env[sourceConfig.auth.tokenFromEnv]
        : undefined,
      password: sourceConfig.auth.kind === 'login'
        ? process.env[sourceConfig.auth.passwordFromEnv]
        : undefined,
    // authType must follow the configured auth kind — ImapSource.connect() branches on it
    // to decide xoauth2 vs password auth; hardcoding XOAUTH2 here silently dropped LOGIN
    // credentials (the password was never even read) and IMAP servers rejected the
    // resulting empty XOAUTH2 attempt with "No supported authentication method(s)".
    //
    // NOTE this derivation is NOT shared with the managed edition, which decides
    // from which credential is actually present rather than from the declared
    // kind. Both are defensible and reconciling them is a behaviour change; see
    // `ResolvedImapAuth` in mail-source-factory.ts and workplan 0041.
    authType: sourceConfig.auth.kind === 'xoauth2' ? ('XOAUTH2' as const) : ('LOGIN' as const),
    tokenProvider: tokenProviderConfig ? createTokenProvider(tokenProviderConfig) : undefined,
  };

  const imap = buildImapSourceFrom(sourceConfig, resolvedAuth, throttleLimiter, byteMeter);

  // The runtime IMAP-disabled fallback (workplan 0023 T3, ADR-0006): OAUTH2_TENANT_ID
  // is the signal, since graph needs it for the token endpoint and plain IMAP does
  // not. The rule for WHEN to wrap now lives in one place, shared with the managed
  // edition — it was written twice and an edition changing its mind about, say,
  // accepting a refresh token would have silently disagreed with the other about
  // when a mailbox gets a second chance.
  return withGraphFallback(
    imap,
    {
      tenantId: process.env.OAUTH2_TENANT_ID,
      clientId: process.env.OAUTH2_CLIENT_ID,
      clientSecret: process.env.OAUTH2_CLIENT_SECRET,
      refreshToken: process.env.OAUTH2_REFRESH_TOKEN,
    },
    throttleLimiter,
  );
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

      return buildJmapTargetFrom(targetConfig, password);
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

      return buildImapDavTargetFrom(targetConfig, password);
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
/**
 * Tasks (workplan 0113). The same shapes calendar uses — a task IS a calendar
 * object on the wire — differing only in which component the source asks for
 * and which key space the ledger writes.
 */
export function buildDomainDeps(
  config: MappingConfig,
  domain: 'task',
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
  domain: 'calendar' | 'contact' | 'file' | 'task',
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
  // Every refusal below happens AFTER the ledger is open — a domain that is not
  // enabled, an endpoint missing credentials, and since 0042 T5 a Drive source
  // with no OAuth values. Each one used to leak the pool it had just opened;
  // an appliance retrying a misconfigured mapping on its schedule leaks one per
  // attempt until Postgres refuses connections and the FAILURE looks like the
  // database is down. The managed builder has had this guard since it was
  // written (`build-deps-from-mapping.ts`); this is the same one.
  try {
    return buildDomainDepsWithLedger(config, domain, { ledger, cursors, closable });
  } catch (err) {
    void closable.close();
    throw err;
  }
}

function buildDomainDepsWithLedger(
  config: MappingConfig,
  domain: 'calendar' | 'contact' | 'file' | 'task',
  opened: { ledger: PgLedger; cursors: PgCursorStore; closable: { close: () => Promise<void> } },
): WithClose<{
  tenantId: TenantId;
  mappingId: MappingId;
  source: CalendarSource | ContactSource | FileSource;
  target: CalendarTargetWriter | ContactTargetWriter | FileTargetWriter;
  ledger: Ledger;
  cursors?: CursorStore;
  concurrency?: number;
}> {
  const { ledger, cursors, closable } = opened;

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
    case 'task':
      domainConfig = config.domains?.tasks;
      break;
  }

  if (!domainConfig?.enabled) {
    throw new Error(`Domain ${domain} is not enabled in config`);
  }

  // The mapping's merged limiter (see DomainConfig.throttleConfig): now
  // enforced on the DAV/file sources too, not only handed to mail (0050).
  const domainThrottleLimiter = buildThrottleLimiter(config);
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
  // Calendar only (0105 T0): measure-and-record what the target will DO with
  // the objects the pass writes, before the first of them lands.
  let recordTargetScheduling: (() => Promise<void>) | undefined;
  switch (domain) {
    case 'calendar': {
      // Google Calendar (workplan 0045) is CalDAV with OAuth: the same
      // connector, aimed at Google's fixed principal, on a Bearer token
      // minted from env credentials — so it must not ride the endpoint
      // resolver, which would demand a password Google does not take.
      source =
        sourceConfig.type === 'graph-calendar'
          ? // The Graph calendar connector, wired at last (workplan 0054):
            // the same Entra registration graph-mail reads from the
            // environment; a config that reached the DAV resolver instead
            // used to throw about a URL it could never have.
            buildGraphCalendarSourceFrom(
              sourceConfig,
              graphEntraCredsFromEnv(),
              domainThrottleLimiter,
            )
          : sourceConfig.type === 'google-calendar'
          ? buildGoogleCalendarDavSourceFrom(
              sourceConfig.user,
              {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                refreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
                serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
              },
              ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES,
            )
          : buildCalendarSource(davEndpoint(sourceConfig, 'caldav', 'source'), domainThrottleLimiter);
      const calendarTargetEndpoint = davEndpoint(targetConfig, 'caldav', 'target');
      target = buildCalendarTarget(calendarTargetEndpoint, targetDeps);
      // The verdict, recorded before the mapping's first calendar write
      // (0105 T0) — measured on the SAME endpoint the writer just got.
      recordTargetScheduling = schedulingRecorder(calendarTargetEndpoint, targetDeps);
      break;
    }
    case 'contact': {
      // Google Contacts (workplan 0045): CardDAV with OAuth, same argument.
      source =
        sourceConfig.type === 'graph-contacts'
          ? buildGraphContactsSourceFrom(
              sourceConfig,
              graphEntraCredsFromEnv(),
              domainThrottleLimiter,
            )
          : sourceConfig.type === 'google-contacts'
          ? buildGoogleContactsDavSourceFrom(
              sourceConfig.user,
              {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                refreshToken: process.env.GOOGLE_CONTACTS_REFRESH_TOKEN,
                serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
              },
              ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES,
            )
          : buildContactSource(davEndpoint(sourceConfig, 'carddav', 'source'), domainThrottleLimiter);
      // Contacts can go over JMAP where the target speaks it (0031 T2). The
      // config already expresses it: `TargetConfig` is a union that includes
      // `JmapTarget`, so a contacts domain naming `type: 'jmap'` needs no new
      // field — only a builder that stops insisting on CardDAV.
      const protocol = contactTargetProtocol(targetConfig.type);
      target = buildContactTargetFor(
        protocol,
        davEndpoint(targetConfig, protocol === 'jmap' ? 'jmap' : 'carddav', 'target'),
        targetDeps,
      );
      break;
    }
    case 'file': {
      // Google Drive is a file source that is not DAV (workplan 0042 T5):
      // Google withdrew WebDAV years ago, so it cannot ride the endpoint
      // resolver below — it has no url/user/password to resolve. Credentials
      // come from the environment, named the way an appliance operator sets
      // them; the refusal for a missing one lives in the shared factory.
      source =
        sourceConfig.type === 'dropbox'
          ? // Dropbox (workplan 0055): same env-half pattern as every OAuth
            // source — read the variables, hand off; the refusal naming the
            // missing ones lives in the shared factory (rule 5).
            buildDropboxSourceFrom(sourceConfig, {
              appKey: process.env[ENV_DROPBOX_CREDENTIAL_NAMES.appKey],
              appSecret: process.env[ENV_DROPBOX_CREDENTIAL_NAMES.appSecret],
              refreshToken: process.env[ENV_DROPBOX_CREDENTIAL_NAMES.refreshToken],
            })
          : sourceConfig.type === 'box'
          ? // Box (workplan 0056): the Client Credentials Grant — no refresh
            // token (Box rotates them); the subject rides the mapping config.
            buildBoxSourceFrom(sourceConfig, {
              clientId: process.env[ENV_BOX_CREDENTIAL_NAMES.clientId],
              clientSecret: process.env[ENV_BOX_CREDENTIAL_NAMES.clientSecret],
              subjectUserId: sourceConfig.userId,
            })
          : sourceConfig.type === 'graph-drive'
          ? // OneDrive/SharePoint (workplan 0054): the orphaned connector's
            // first production call site.
            buildGraphDriveSourceFrom(
              sourceConfig,
              graphEntraCredsFromEnv(),
              domainThrottleLimiter,
            )
          : sourceConfig.type === 'google-drive'
          ? buildGoogleDriveSourceFrom(
              sourceConfig,
              {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
                serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
                // Drive has no user parameter; under DWD the mapping states
                // its subject as `source.user` (ADR-0033).
                subject: sourceConfig.user,
              },
              ENV_GOOGLE_CREDENTIAL_NAMES,
            )
          : buildFileSource(davEndpoint(sourceConfig, 'webdav', 'source'), domainThrottleLimiter);
      // Files can go over JMAP where the target speaks it (0031 T3). The
      // config already expresses it: `TargetConfig` is a union that includes
      // `JmapTarget`, so a files domain naming `type: 'jmap'` needs no new
      // field — only a builder that stops insisting on WebDAV.
      const protocol = fileTargetProtocol(targetConfig.type);
      target = buildFileTargetFor(
        protocol,
        davEndpoint(targetConfig, protocol === 'jmap' ? 'jmap' : 'webdav', 'target'),
        targetDeps,
      );
      break;
    }
    case 'task': {
      // A task is a calendar object on the wire, so this is the calendar
      // branch with two differences and no third: the SOURCE is told to serve
      // VTODO (so it lists only collections carrying tasks and yields only
      // tasks — 0113 T3b), and there is no scheduling verdict to record,
      // because a to-do list invites nobody and RFC 6638 has nothing to say
      // about it.
      //
      // No Google branch either: Google's CalDAV supports neither VTODO nor
      // VJOURNAL (its own developer guide), so there is no Google task source
      // to build. A `google` account never reaches here — `task` is not one of
      // the faces PROVIDER_ACCOUNT_DOMAINS gives it.
      //
      // And ONE Graph branch (workplan 0114 T9): Microsoft To Do is a task face
      // that is not a CalDAV collection, so a `graph-todo` source is the
      // calendar branch's `graph-calendar` sibling — the same Entra
      // registration from the environment, the connector building the VTODO.
      source =
        sourceConfig.type === 'graph-todo'
          ? buildGraphTodoSourceFrom(sourceConfig, graphEntraCredsFromEnv(), domainThrottleLimiter)
          : buildTaskSource(davEndpoint(sourceConfig, 'caldav', 'source'), domainThrottleLimiter);
      target = buildTaskTarget(davEndpoint(targetConfig, 'caldav', 'target'), targetDeps);
      break;
    }
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
      ...(config.targetFolderPrefix !== undefined
        ? { targetFolderPrefix: config.targetFolderPrefix }
        : {}),
      ...(recordTargetScheduling ? { recordTargetScheduling } : {}),
    },
    closable,
  );
}

/** Resolve a file-config DAV endpoint (url/user + env-based credential) for a factory. */
function davEndpoint(
  cfg: SourceConfig | TargetConfig,
  expected: 'caldav' | 'carddav' | 'webdav' | 'jmap',
  role: 'source' | 'target',
): DavEndpoint {
  if (cfg.type !== expected) {
    throw new Error(`Expected ${expected} ${role}, got ${(cfg as { type: string }).type}`);
  }
  // `url` for the DAV shapes, `baseUrl` for `JmapTarget`. Read both rather than
  // adding a second near-identical resolver: everything below — the auth kind,
  // the env indirection, the refusal to build a connector with empty
  // credentials — is the same question whichever protocol asked it.
  const c = cfg as {
    url?: string;
    baseUrl?: string;
    user: string;
    auth: { kind: string; passwordFromEnv?: string; tokenFromEnv?: string };
  };
  const url = c.url ?? c.baseUrl;
  if (!url) {
    throw new Error(`${expected} ${role} config has neither a url nor a baseUrl`);
  }
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
  return { url, username: c.user, password };
}
