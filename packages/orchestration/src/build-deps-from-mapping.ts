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
  DEFAULT_THROTTLE_CONFIG,
  imapDownloadPlan,
  type TenantId,
  type MappingId,
  type SourceConfig,
  type TargetConfig,
  type FileSource,
  DEFAULT_CONCURRENCY,
  parseGoogleDriveSource,
  withDeploymentDropboxClient, withDeploymentGoogleClient,
  microsoftTenant,
  log,
} from '@openmig/shared';
import { isGoogleGrantKind } from './account-qualification.ts';
import { connection as connectionTable, mailbox as mailboxTable, PgByteBudget, PgRateBudget } from '@openmig/ledger';
import {
  createTokenProvider,
  type ImapByteMeter,
} from '@openmig/connectors';
import type { CalendarSyncDeps, ContactSyncDeps, FileSyncDeps } from '@openmig/core';
import {
  buildCalendarSource,
  buildCalendarTarget,
  buildTaskSource,
  buildTaskTarget,
  buildContactSource,
  buildFileSource,
} from './dav-factories.ts';
import { davEndpointFromCreds, fileEndpointFromCreds } from './dav-endpoint.ts';
import { schedulingRecorder } from './target-scheduling.ts';
import { buildContactTargetFor, contactTargetProtocol } from './contact-target-factory.ts';
import { buildFileTargetFor, fileTargetProtocol } from './file-target-factory.ts';
import {
  STORED_GOOGLE_CREDENTIAL_NAMES,
  buildGoogleDriveSourceFrom,
} from './drive-source-factory.ts';
import {
  DROPBOX_CONNECTION_KIND,
  STORED_DROPBOX_CREDENTIAL_NAMES,
  buildDropboxSourceFrom,
} from './dropbox-source-factory.ts';
import {
  STORED_BOX_CREDENTIAL_NAMES,
  buildBoxSourceFrom,
} from './box-source-factory.ts';
import { STORED_GMAIL_CREDENTIAL_NAMES, buildGmailSourceFrom } from './gmail-source-factory.ts';
import {
  STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
  buildGoogleCalendarDavSourceFrom,
  buildGoogleContactsDavSourceFrom,
} from './google-dav-source-factory.ts';
import {
  STORED_GRAPH_FIELD_NAMING,
  buildGraphCalendarSourceFrom,
  buildGraphContactsSourceFrom,
  buildGraphDriveSourceFrom,
  type GraphDomainEndpoint,
  type GraphEntraCredsAsFound,
} from './graph-domain-source-factory.ts';
import { sourceFaceBuilder, type SourceFaceBuilder } from './source-face-builders.ts';
import { publishedEndpoint, isProviderAccountKind } from '@openmig/shared';
import { PgLedger, PgCursorStore, createPgDb, withTenant } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { mailboxMapping } from '@openmig/ledger';
import { withClose, type WithClose } from './deps-lifecycle.ts';
import {
  STORED_CREDENTIAL_NAMES,
  buildGraphMailSourceFrom,
  buildImapSourceFrom,
  withGraphFallback,
} from './mail-source-factory.ts';
import { buildJmapTargetFrom, buildImapDavTargetFrom } from './mail-target-factory.ts';

/**
 * The mapping's OWN credentials merged over the connection's, key by key
 * (workplan 0108 T4, migration 0032).
 *
 * One function because there are two credential paths — `buildDepsFromMapping`
 * for mail and `loadDomainConnections` for calendar, contacts and files — and
 * a migrator's grant that worked for their mail but not their calendar would
 * be a bug found by a customer rather than by us.
 *
 * **Which half wins, and why.** The client id and secret belong to the account
 * OWNER and are configured once on a connection that several mappings may
 * share. The refresh token belongs to the person being migrated and is true of
 * one mapping only. So the mapping's keys win where it has them, and the
 * connection's stand everywhere else — which means an owner rotating their
 * client secret does not invalidate anybody's grant, and a migrator re-granting
 * does not touch anybody else's mapping.
 *
 * Target credentials are never merged: nothing grants a target through a link,
 * and a function that silently accepted `'target'` would be a place for that to
 * start happening by accident.
 */
function mergeMappingCredentials(
  role: 'source' | 'target',
  connectionCreds: Record<string, string>,
  mappingSecretRef: string | null | undefined,
): Record<string, string> {
  if (role !== 'source' || !mappingSecretRef) return connectionCreds;
  return { ...connectionCreds, ...SecretStore.decryptCredentials(mappingSecretRef) };
}

/**
 * Every credential a SOURCE has, in priority order (ADR-0041, owner decision
 * 2026-09-01 — option B).
 *
 * Three layers now, lowest first:
 *
 *   1. the DEPLOYMENT'S own Google client, where it configured one and this
 *      connection is a Google one;
 *   2. the connection's stored credentials;
 *   3. the migrator's own grant for this mapping (0108 T4).
 *
 * The new layer is the bottom one, and it is a FALLBACK rather than an
 * override for the reason ADR-0041 exists: a customer who registered their own
 * Google application and typed its credentials keeps using it, and a
 * deployment-wide default that quietly replaced theirs would take that choice
 * away.
 *
 * **THE KIND GATE IS LOAD-BEARING, not tidiness.** `clientId` and
 * `clientSecret` are shared key names: Dropbox stores its App key and App
 * secret under exactly those, and Box its own client pair. Filling them in for
 * any connection that lacked them would hand Google's application credentials
 * to a Dropbox row, which then fails at Dropbox with an error naming nothing
 * useful. `isGoogleGrantKind` already enumerates the kinds whose credentials
 * are a Google OAuth client — the same list the qualification exchanges tokens
 * for — so this reads it rather than keeping a second one.
 *
 * ONE FUNCTION FOR BOTH PATHS, like the merge it wraps: the mail path and
 * `loadDomainConnections` both come through here, and a client that worked for
 * somebody's calendar and not their mail is a bug a customer finds.
 */
function sourceCredentialsFor(
  kind: string,
  role: 'source' | 'target',
  connectionCreds: Record<string, string>,
  mappingSecretRef: string | null | undefined,
): Record<string, string> {
  return mergeMappingCredentials(
    role,
    // The deployment's own Dropbox app fills a Dropbox row the same way
    // Google's fills a Google one (2026-09-02), kind-gated for the same
    // reason: the two share the key names and must never share the values.
    withDeploymentDropboxClient(
      kind === DROPBOX_CONNECTION_KIND,
      withDeploymentGoogleClient(isGoogleGrantKind(kind), connectionCreds),
    ),
    mappingSecretRef,
  );
}

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

    // Decrypt source credentials
    let sourceCredentials: Record<string, string>;
    if (sourceConnection.secretRef) {
      sourceCredentials = SecretStore.decryptCredentials(sourceConnection.secretRef);
    } else {
      // Fallback: credentials stored in config (unencrypted - for migration/testing only)
      const configObj = sourceConnection.config as Record<string, unknown>;
      if (configObj.credentials && typeof configObj.credentials === 'object') {
        sourceCredentials = configObj.credentials as Record<string, string>;
      } else if (mapping.sourceSecretRef) {
        // A mapping whose only credentials are its migrator's: the connection
        // carries the owner's client and nothing else, or nothing at all.
        sourceCredentials = {};
      } else {
        throw new Error('Source connection has no credentials');
      }
    }
    // The migrator's own grant wins, key by key (workplan 0108 T4). Same
    // function the per-domain path uses, so a grant cannot work for somebody's
    // mail and not their calendar.
    sourceCredentials = sourceCredentialsFor(
      sourceConnection.kind,
      'source',
      sourceCredentials,
      mapping.sourceSecretRef,
    );
    
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

    // The mail TargetConfig is resolved BY KIND at this one seam (0106 T4b):
    // a protocol row's config already IS the writer's shape, while the
    // `soverin` ACCOUNT row stores its mail face as mailHost/mailPort —
    // turned into the imap-dav shape here, or refused naming the missing
    // field. Kind resolves protocol at the edge and nowhere downstream (the
    // #597 guard).
    const targetConfig = mailTargetConfigFromConnection(
      targetConnection.kind,
      targetConnection.config as Record<string, unknown>,
      targetCredentials,
    );

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
  // The STORED per-mapping choice (migration 0017) answers first: this
  // edition's create path never writes `domains`, so until that column
  // existed the limiter parameter was armed and never fed. The shape is the
  // appliance's `throttleConfig`, validated by the shared parser at create.
  const storedThrottle = mappings[0]?.throttleConfig as
    | Partial<import('@openmig/shared').ThrottleConfig>
    | null
    | undefined;
  // The budget the WHOLE SERVICE shares for this tenant and provider, not just
  // this pass (workplan 0082 T5). Trigger.dev runs each pass in its own
  // process, so an in-process bucket was one private copy of the limit per
  // concurrent pass — against a provider quota that is singular, because SAD
  // §13 specifies one multi-tenant Entra app for every customer.
  const sharedBudget = new PgRateBudget(db, {
    requestsPerSecond:
      storedThrottle?.requestsPerSecond ?? DEFAULT_THROTTLE_CONFIG.requestsPerSecond,
  });
  // Built unconditionally now, where it used to be skipped when no throttle
  // config was stored. "No custom limits" never meant "no limits" — it meant
  // the defaults, and the defaults are what the shared budget enforces.
  const throttleLimiter = storedThrottle
    ? createThrottleLimiterFromMapping({ mapping: storedThrottle }, {}, sharedBudget)
    : createThrottleLimiterFromMapping(throttleConfigMapping, {}, sharedBudget);

  // The daily DOWNLOAD meter for the mail source's endpoint (workplan 0090
  // T3). Which endpoints get one is `imapDownloadPlan`'s decision — keyed by
  // HOST, so a plain imap-oauth2 connection pointed at imap.gmail.com is
  // metered exactly like the gmail kind, and any other server gets no
  // invented cap. Pg-backed for the same reason as the rate budget above:
  // the ceiling belongs to the tenant's account at the provider, and every
  // runner spends against the one row.
  //
  // The ACCOUNT kind's mail face IS Gmail's IMAP endpoint (workplan 0106 T3b),
  // so it gets the same meter and must: 0090's ceiling belongs to Google's
  // server, not to the row shape that reached it. Leaving `google` out here
  // would have been the quiet version of this change — a mail migration that
  // works, spends against an unmetered budget, and gets the account locked out
  // exactly where the single-purpose kind would have refused first.
  const imapHost =
    mappingConfig.source.type === 'gmail' || mappingConfig.source.type === 'google'
      ? 'imap.gmail.com'
      : mappingConfig.source.type === 'imap-oauth2'
        ? mappingConfig.source.host
        : undefined;
  const downloadPlan = imapDownloadPlan(imapHost, storedThrottle?.downloadBytesPerDay);
  const byteMeter: ImapByteMeter | undefined = downloadPlan
    ? {
        budget: new PgByteBudget(db, { bytesPerDay: downloadPlan.bytesPerDay }),
        tenantId,
        provider: downloadPlan.provider,
      }
    : undefined;

  // Build source connector with decrypted credentials
  const source = buildSourceConnectorFromCredentials(
    mappingConfig.source,
    sourceCredentials,
    throttleLimiter,
    byteMeter
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
      // The same meter the connector spends, handed to the loop as its gate
      // (0090 T4): one instance, one row, so the state the gate reads is the
      // state every runner's fetches moved.
      ...(byteMeter ? { downloadMeter: byteMeter } : {}),
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
        sourceConfigOverride: mailboxMapping.sourceConfigOverride,
        targetConfigOverride: mailboxMapping.targetConfigOverride,
        sourceSecretRef: mailboxMapping.sourceSecretRef,
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
      /**
       * The connection's config, with this mapping's own answers merged OVER
       * it (migration 0021).
       *
       * A shared connection says as whom we sign in; the mapping says whose
       * data and where — a Box subject, a Drive root folder, a Dropbox root
       * path. Without this merge, reusing a connection silently inherited its
       * root, so "same account, different folder" needed a duplicate
       * connection holding the same secret twice.
       *
       * Override-over-connection, key by key: an absent key keeps whatever the
       * connection said, so nothing changes for the mappings that have no
       * override (every one created before this).
       */
      const override = (role === 'source'
        ? mapping.sourceConfigOverride
        : mapping.targetConfigOverride) as Record<string, unknown> | null;
      const config = {
        ...((conn.config ?? {}) as Record<string, unknown>),
        ...(override ?? {}),
      };
      let creds: Record<string, string>;
      if (conn.secretRef) {
        creds = SecretStore.decryptCredentials(conn.secretRef);
      } else if (config.credentials && typeof config.credentials === 'object') {
        creds = config.credentials as Record<string, string>;
      } else if (role === 'source' && mapping.sourceSecretRef) {
        // A mapping whose ONLY credentials are its migrator's — the connection
        // was created for the link flow and never carried a secret of its own.
        creds = {};
      } else {
        throw new Error(`${role} connection has no credentials`);
      }
      return {
        config,
        creds: sourceCredentialsFor(conn.kind, role, creds, mapping.sourceSecretRef),
        kind: conn.kind,
      };
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
/** Tasks: the calendar shapes, because on the wire a task IS a calendar object (0113). */
export function buildDomainDepsFromMapping(pool: Pool, tenantId: string, mappingId: string, domain: 'task'): Promise<WithClose<CalendarSyncDeps>>;
export async function buildDomainDepsFromMapping(
  pool: Pool,
  tenantId: string,
  mappingId: string,
  domain: 'mail' | 'calendar' | 'contact' | 'file' | 'task',
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
      const calendarTargetEndpoint = davEndpointFromCreds('target', tgt.config, tgt.creds);
      return withClose(
        {
          ...common,
          // Off the builder TABLE, not a kind comparison and no longer a
          // two-way condition (0106 T3b's rule, 0114 T5a's mechanism): the
          // seam asks which builder speaks for this row's calendar face and
          // the answer is a name. A provider arriving is a row there, and a
          // provider MISSING from there is a failing guard rather than a
          // silent fall-through to DAV.
          source: buildCalendarSourceFromConnection(src),
          target: buildCalendarTarget(calendarTargetEndpoint, targetDeps),
          // The verdict, recorded before the mapping's first calendar write
          // (0105 T0) — measured on the SAME endpoint the writer just got.
          recordTargetScheduling: schedulingRecorder(calendarTargetEndpoint, targetDeps),
        } satisfies CalendarSyncDeps,
        db,
      );
    }
    if (domain === 'task') {
      // The calendar branch with two differences and no third: the source is
      // told to serve VTODO (0113 T3b), and there is no scheduling verdict —
      // a to-do list invites nobody, so RFC 6638 has nothing to say about it.
      //
      // No Google branch: Google's CalDAV supports neither VTODO nor VJOURNAL
      // (its own developer guide), and `task` is not one of the faces
      // PROVIDER_ACCOUNT_DOMAINS gives a `google` account — so a Google source
      // never reaches here.
      return withClose(
        {
          ...common,
          source: buildTaskSourceFromConnection(src),
          target: buildTaskTarget(davEndpointFromCreds('target', tgt.config, tgt.creds), targetDeps),
        } satisfies CalendarSyncDeps,
        db,
      );
    }
    if (domain === 'contact') {
      return withClose(
        {
          ...common,
          // The calendar seam's argument, verbatim, over the contact face.
          source: buildContactSourceFromConnection(src),
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
 * Choose and build the CALENDAR source a stored connection describes.
 *
 * Three builders and no fall-through. `google-dav` is CalDAV with OAuth — the
 * stored Google client and refresh token mint Bearer tokens, and the fixed
 * principal URL is derived from the config's `user`, so it must not ride the
 * credential resolver (no password exists to resolve). `graph-calendar` is the
 * same shape over Entra, reachable from a stored connection since 0114 T5a and
 * from the appliance's environment since 0054. `dav` is the protocol row every
 * connection was before either.
 *
 * Exported for unit tests, on the precedent of
 * `buildFileSourceFromConnection`: the choice and its refusal are the
 * behaviour worth pinning, and they need no database to prove.
 */
export function buildCalendarSourceFromConnection(src: {
  config: Record<string, unknown>;
  creds: Record<string, string>;
  kind: string;
}): ReturnType<typeof buildCalendarSource> {
  const builder = sourceFaceBuilder(src.kind, 'calendar');
  switch (builder) {
    case 'google-dav':
      return buildGoogleCalendarDavSourceFrom(
        String((src.config as { user?: unknown }).user ?? ''),
        src.creds,
        STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
      );
    case 'graph-calendar':
      return buildGraphCalendarSourceFrom(
        graphEndpointFromConnection(src),
        graphCredsFromConnection(src.creds),
        undefined,
        STORED_GRAPH_FIELD_NAMING,
      );
    case 'dav':
      return buildCalendarSource(
        davEndpointFromCreds('source', src.config, src.creds, src.kind, 'calendar'),
      );
    default:
      throw faceHasNoBuilder('calendar', src.kind, builder);
  }
}

/**
 * The calendar builder's sibling over the TASK face (workplan 0115 T4).
 *
 * Extracted from the inline `domain === 'task'` branch so every face a
 * provider account claims has exactly one entry point — which is what
 * `a-face-no-account-can-actually-build` needs in order to ask its question
 * about all five, rather than about the four that happened to be exported.
 *
 * `dav` and nothing else, deliberately. A to-do list IS a calendar collection
 * declaring VTODO (RFC 4791 §5.2.3, 0113 T5), so there is no Google branch
 * (its CalDAV serves neither VTODO nor VJOURNAL, per its own guide) and no
 * Graph branch (To Do is not CalDAV — 0114 T9). A kind whose task face
 * resolves to anything else is a defect, and this refuses by name rather than
 * falling through.
 */
export function buildTaskSourceFromConnection(src: {
  config: Record<string, unknown>;
  creds: Record<string, string>;
  kind: string;
}): ReturnType<typeof buildTaskSource> {
  const builder = sourceFaceBuilder(src.kind, 'task');
  if (builder !== 'dav') throw faceHasNoBuilder('task', src.kind, builder);
  return buildTaskSource(davEndpointFromCreds('source', src.config, src.creds, src.kind, 'task'));
}

/** The calendar builder's sibling over the contact face — same three, same rule. */
export function buildContactSourceFromConnection(src: {
  config: Record<string, unknown>;
  creds: Record<string, string>;
  kind: string;
}): ReturnType<typeof buildContactSource> {
  const builder = sourceFaceBuilder(src.kind, 'contact');
  switch (builder) {
    case 'google-dav':
      return buildGoogleContactsDavSourceFrom(
        String((src.config as { user?: unknown }).user ?? ''),
        src.creds,
        STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
      );
    case 'graph-contacts':
      return buildGraphContactsSourceFrom(
        graphEndpointFromConnection(src),
        graphCredsFromConnection(src.creds),
        undefined,
        STORED_GRAPH_FIELD_NAMING,
      );
    case 'dav':
      return buildContactSource(
        davEndpointFromCreds('source', src.config, src.creds, src.kind, 'contact'),
      );
    default:
      throw faceHasNoBuilder('contact', src.kind, builder);
  }
}

/**
 * The Entra endpoint a STORED connection describes (0114 T5a).
 *
 * `tenantId` is read from the credentials first and the config second, and
 * falls back to the deployment's authority — `common` unless an operator said
 * otherwise. That order is deliberate: a connection carrying its own Entra
 * registration carries its own directory with it (T1's rule, and the reason a
 * caller's `tenantId` is never replaced by the deployment's), while a
 * connection that took the grant button has no tenant of its own to name.
 *
 * NO `mailbox`. A stored connection reaches Graph with a delegated refresh
 * token, and `/users/{address}` is only readable under application
 * permissions — the factory refuses the combination, in a sentence written
 * for exactly this. Reading the signed-in user's own store is what a consent
 * button grants and all a `microsoft` account row ever means.
 */
function graphEndpointFromConnection(src: {
  config: Record<string, unknown>;
  creds: Record<string, string>;
}): GraphDomainEndpoint {
  const cfg = src.config as { tenantId?: unknown; baseUrl?: unknown };
  const tenantId =
    (src.creds.tenantId ?? '').trim() ||
    String(cfg.tenantId ?? '').trim() ||
    microsoftTenant();
  const baseUrl = typeof cfg.baseUrl === 'string' ? cfg.baseUrl : undefined;
  return { tenantId, ...(baseUrl === undefined ? {} : { baseUrl }) };
}

/** The three values the Entra flows are chosen by, under the stored names. */
function graphCredsFromConnection(creds: Record<string, string>): GraphEntraCredsAsFound {
  return {
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refreshToken: creds.refreshToken,
  };
}

/**
 * The refusal for a face resolved to a builder that cannot serve it.
 *
 * The `default` arm of each seam below, and deliberately a THROW rather than a
 * fall-through to DAV. A fall-through is what this task exists to remove: it
 * does the wrong work and reports success, and the person who finds out is a
 * customer mid-migration. This refuses at BUILD time and names both halves of
 * the disagreement, so the fix — a row in `ACCOUNT_FACE_BUILDERS` or a face
 * withdrawn from `PROVIDER_ACCOUNT_DOMAINS` — is legible from the message.
 *
 * `scripts/a-face-a-provider-account-cannot-build.unit.test.ts` is what makes
 * this unreachable in practice; this is what happens if it ever is not.
 */
function faceHasNoBuilder(domain: string, kind: string, builder: SourceFaceBuilder): Error {
  return new Error(
    `connection kind "${kind}" resolves its ${domain} face to the "${builder}" builder, which ` +
      `does not build ${domain} sources. Either ACCOUNT_FACE_BUILDERS names the wrong builder ` +
      `for ${kind}.${domain}, or PROVIDER_ACCOUNT_DOMAINS claims a face this provider cannot serve`,
  );
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
  const builder = sourceFaceBuilder(src.kind, 'file');
  switch (builder) {
    case 'graph-drive':
      // OneDrive from a stored connection (0114 T5a) — the face that existed
      // in `build-deps.ts` from the appliance's environment and had no managed
      // caller at all.
      return buildGraphDriveSourceFrom(
        graphEndpointFromConnection(src),
        graphCredsFromConnection(src.creds),
        undefined,
        STORED_GRAPH_FIELD_NAMING,
      );
    case 'dropbox':
      // Dropbox (workplan 0055): stored under the shared trio keys, mapped to
      // Dropbox's own words by the naming (see the factory).
      return buildDropboxSourceFrom(
        { rootPath: (src.config as { rootPath?: string }).rootPath },
        {
          appKey: src.creds[STORED_DROPBOX_CREDENTIAL_NAMES.appKey],
          appSecret: src.creds[STORED_DROPBOX_CREDENTIAL_NAMES.appSecret],
          refreshToken: src.creds[STORED_DROPBOX_CREDENTIAL_NAMES.refreshToken],
        },
        STORED_DROPBOX_CREDENTIAL_NAMES,
      );
    case 'box': {
      // Box (workplan 0056): client id + secret from the stored credentials;
      // the SUBJECT user id rides the source config — one subject per mapping,
      // never a secret (see the factory).
      const cfg = src.config as { userId?: string; rootFolderId?: string };
      return buildBoxSourceFrom(
        { ...(cfg.rootFolderId === undefined ? {} : { rootFolderId: cfg.rootFolderId }) },
        {
          clientId: src.creds[STORED_BOX_CREDENTIAL_NAMES.clientId],
          clientSecret: src.creds[STORED_BOX_CREDENTIAL_NAMES.clientSecret],
          subjectUserId: cfg.userId,
        },
        STORED_BOX_CREDENTIAL_NAMES,
      );
    }
    case 'google-drive':
      // The ACCOUNT kind's file face is Drive (workplan 0106 T3b), reached
      // with the same OAuth trio under the same stored names as the
      // single-purpose row — one arm, not two.
      //
      // `parseGoogleDriveSource` reads the blob rather than trusting it and
      // does NOT require `type`, because a stored connection carries its
      // provider in its own `kind` column: an account row's
      // `{ type: 'google', user }` comes back as a Drive source rooted at My
      // Drive, which is what an account with no folder chosen means.
      return buildGoogleDriveSourceFrom(
        parseGoogleDriveSource(src.config),
        src.creds,
        STORED_GOOGLE_CREDENTIAL_NAMES,
      );
    case 'dav':
      return buildFileSource(fileEndpointFromCreds('source', src.config, src.creds, src.kind));
    default:
      throw faceHasNoBuilder('file', src.kind, builder);
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
/**
 * Where an ACCOUNT KIND's mail face connects — a rule, not a lookup.
 *
 * Exported and pure so the rule can be ASSERTED rather than only observed not
 * to throw: aiming IMAP at the wrong host builds perfectly well and fails at
 * connect, which is the shape of failure this product treats as worst.
 *
 * `mailHost` first, and that is the whole point. An account kind holds ONE row
 * for several faces, so its DAV host and its IMAP host both live in it —
 * `soverin` stores `host: caldav.soverin.net` beside `mailHost:
 * imap.soverin.net` (0106 T4b). Reading `host` for the mail face would send
 * IMAP to the calendar service. Then the published endpoint, for a kind whose
 * hosts nobody types (`apple`). Then the generic `host`, for a row that
 * carries only one.
 */
export function accountMailEndpoint(
  kind: string,
  config: object,
): { host: string; port: number } {
  const stored = config as {
    host?: unknown;
    port?: unknown;
    mailHost?: unknown;
    mailPort?: unknown;
  };
  const published = publishedEndpoint(kind, 'email');
  const host =
    String(stored.mailHost ?? '').trim() || published?.host || String(stored.host ?? '').trim();
  if (!host) {
    throw new Error(
      `A '${kind}' mail source has no IMAP host: the connection stores neither mailHost nor ` +
        'host, and no published endpoint is known for this kind. Add one to PROVIDER_ENDPOINTS, ' +
        'or store a host on the connection.',
    );
  }
  return { host, port: Number(stored.mailPort ?? published?.port ?? stored.port ?? 993) };
}

export function buildSourceConnectorFromCredentials(
  sourceConfig: SourceConfig,
  credentials: Record<string, string>,
  throttleLimiter?: ThrottleLimiter,
  byteMeter?: ImapByteMeter
): SourceConnector {
  if (sourceConfig.type === 'graph-mail') {
    // No byteMeter: 0090's verified ceiling belongs to Gmail's IMAP endpoint,
    // and inventing one for Graph would be the plan's own warning realised.
    return buildGraphMailSourceFromCredentials(sourceConfig, credentials, throttleLimiter);
  }
  if (sourceFaceBuilder(sourceConfig.type, 'email') === 'graph-mail') {
    // THE ACCOUNT KIND'S MAIL FACE (0114 T5a), and one branch rather than two
    // for the same reason the Gmail arm below takes `google` alongside
    // `gmail`: a `microsoft` row's mail is Graph mail against `/me/messages`,
    // under the same three stored credentials, so a second builder differing
    // only in the string it matched would be the #597 defect again.
    //
    // Read off the FACE TABLE rather than compared to `'microsoft'`. This is
    // the seam that made the point: `PROVIDER_ACCOUNT_DOMAINS.microsoft`
    // claimed `email`, `ACCOUNT_FACE_BUILDERS` answered `graph-mail`, and this
    // function still refused with "only supports imap-oauth2, graph-mail,
    // gmail and google mail sources, got: microsoft" — a table nothing reads
    // is the same defect one level up.
    //
    // NEVER a `mailbox`. A delegated token reads the signed-in user's own
    // store; `/users/{address}` needs application permissions, and the factory
    // refuses the combination in a sentence written for exactly that.
    return buildGraphMailSourceFromCredentials(
      {
        type: 'graph-mail',
        tenantId:
          (credentials.tenantId ?? '').trim() ||
          String((sourceConfig as { tenantId?: unknown }).tenantId ?? '').trim() ||
          microsoftTenant(),
      },
      credentials,
      throttleLimiter,
    );
  }
  if (sourceConfig.type === 'gmail' || sourceConfig.type === 'google') {
    // The credential-store half only: name the stored fields and hand off. The
    // refusal for missing ones lives in the shared factory, so both editions
    // refuse in the same words (rule 5) — here in the stored-credential
    // vocabulary a managed operator can act on, not env-var names.
    //
    // THE ACCOUNT KIND ARRIVES HERE TOO (workplan 0106 T3b). Its mail face is
    // Gmail over IMAP with XOAUTH2 — the same endpoint, the same transport,
    // and the same three stored credentials, because
    // `STORED_GMAIL_CREDENTIAL_NAMES` and the DAV naming are the same names.
    // So this is one branch and not two: a second builder differing only in
    // the string it matched is the #597 defect, and the account row would
    // drift away from the single-purpose one the first time either changed.
    //
    // NOT GATED ON `GOOGLE_ACCOUNT_SCOPE_CLASS`, deliberately. That
    // declaration decides which consent this deployment is willing to BUILD
    // and which ticks the create door accepts (ADR-0041) — it is a gate on
    // making a mapping, not on running one. Reading it here would mean an
    // operator unsetting a variable silently breaks migrations that already
    // exist and already hold a grant, which is a worse failure than the one it
    // would prevent: the grant is the authority, and Google refuses a token
    // that never carried the scope.
    return buildGmailSourceFrom(
      sourceConfig.user,
      credentials,
      STORED_GMAIL_CREDENTIAL_NAMES,
      undefined,
      byteMeter,
    );
  }
  if (isProviderAccountKind(sourceConfig.type) && sourceFaceBuilder(sourceConfig.type, 'email') === 'imap') {
    // AN ACCOUNT KIND WHOSE MAIL FACE IS PLAIN IMAP (workplan 0115 T4).
    //
    // Off the face table, like the Graph arm above, and for the same reason:
    // `apple` claims `email`, the table answers `imap`, and this function used
    // to refuse it with "only supports imap-oauth2, graph-mail, gmail and
    // google mail sources, got: apple" — verbatim the sentence 0114 T5a hit
    // for `microsoft`, from the same cause one provider later.
    //
    // The IMAP builder below already accepts a plain password; all it insists
    // on is the config SHAPE. So the host and port come from the published
    // endpoints (nobody types Apple's — see `PROVIDER_ENDPOINTS`), the address
    // from the row, and the credential from the store. A kind that reaches
    // here with no published endpoint and no stored host refuses by name
    // rather than connecting to nothing.
    const { host, port } = accountMailEndpoint(sourceConfig.type, sourceConfig);
    return buildImapSourceFromCredentials(
      {
        type: 'imap-oauth2',
        host,
        port,
        user: String((sourceConfig as { user?: unknown }).user ?? credentials.username ?? ''),
      } as SourceConfig,
      credentials,
      throttleLimiter,
      byteMeter,
    );
  }
  if (sourceConfig.type !== 'imap-oauth2') {
    throw new Error(`buildDepsFromMapping only supports imap-oauth2, graph-mail, gmail and google mail sources, got: ${sourceConfig.type}`);
  }

  return buildImapSourceFromCredentials(sourceConfig, credentials, throttleLimiter, byteMeter);
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
  throttleLimiter?: ThrottleLimiter,
  byteMeter?: ImapByteMeter
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
    byteMeter,
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
 * A stored connection row's config, as the mail path's TargetConfig
 * (0106 T4b) — the ONE seam where connection KIND resolves the mail
 * protocol.
 *
 * A protocol row (`jmap`, `imap`) already stores the writer's shape, `type`
 * discriminant included, and passes through untouched. The `soverin` ACCOUNT
 * row stores its DAV faces in url/host+port and its mail face — when the
 * person stored one — in `mailHost`/`mailPort`; here that face becomes the
 * imap-dav shape `buildTargetWriterFromCredentials` already speaks, so
 * nothing downstream learns the kind exists. An account with NO stored mail
 * server refuses by field name rather than guessing a host from the
 * provider's name (the never-guess rule): the create door demands the field
 * when email is ticked, and this refusal catches the reused-connection path
 * the create door cannot see into.
 *
 * `mailPort` is read tolerantly (the connections probe route carries values
 * as strings) and defaults to 993 — the same IMAPS default the imap kind's
 * own door uses.
 */
export function mailTargetConfigFromConnection(
  kind: string,
  config: Record<string, unknown>,
  credentials: Record<string, string>,
): TargetConfig {
  if (kind !== 'soverin') {
    if (typeof config.type === 'string' && config.type !== '') {
      return config as unknown as TargetConfig;
    }
    // A ROW STORED WITHOUT ITS TYPE (the Connections door before 2026-09-03
    // built a target's config from the fields alone, so the kind never
    // reached it): the owner's first reused IMAP target made the writer switch
    // throw "Unsupported target type: undefined" at discovery. The kind names
    // the protocol, so the shape the wizard's door would have stored is
    // derived here — at the one seam where kind resolves protocol — and the
    // user comes from the credential the row signs in with, as soverin's
    // does. DAV protocol kinds have no mail face; they pass through and the
    // switch refuses them by name, as before.
    if (kind === 'jmap') {
      const scheme = config.useSsl === false ? 'http' : 'https';
      return {
        ...config,
        type: 'jmap',
        baseUrl: `${scheme}://${String(config.host ?? '')}:${String(config.port ?? (scheme === 'https' ? 443 : 80))}`,
        user: String(config.user ?? credentials.username ?? ''),
      } as unknown as TargetConfig;
    }
    if (kind === 'imap') {
      return {
        ...config,
        type: 'imap-dav',
        tls: config.useSsl !== false,
        user: String(config.user ?? credentials.username ?? ''),
      } as unknown as TargetConfig;
    }
    return config as unknown as TargetConfig;
  }
  const mailHost = typeof config.mailHost === 'string' ? config.mailHost.trim() : '';
  if (!mailHost) {
    throw new Error(
      'This soverin connection stores no mail server, so its mail face cannot be built: ' +
        "config.mailHost is missing. Add the account's IMAP host to the connection (your " +
        'provider’s account settings page names it) — the calendar and contact faces are ' +
        'unaffected.',
    );
  }
  const portRaw = Number(config.mailPort);
  return {
    type: 'imap-dav',
    host: mailHost,
    port: Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 993,
    // Same asymmetry rule as every IMAP door: TLS unless said otherwise.
    tls: config.useSsl !== false,
    user: String(config.user ?? credentials.username ?? ''),
  } as unknown as TargetConfig;
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
