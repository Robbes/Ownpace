// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Self-host appliance entrypoint (workplan 0010 T2).
 *
 * On startup: apply ledger migrations (advisory-locked) → load the mapping
 * configs from a directory → ensure each mapping's DB records exist and kick off
 * a read-only, body-free pre-sync discovery pass (workplan 0013 T7) → schedule
 * only mappings already 'active' with the in-process croner scheduler
 * (single-flight, so an overrunning pass never overlaps itself). A paused (draft)
 * mapping waits for the operator to green-light it on the React confirm screen
 * (`GET /` redirects to it; `POST /mappings/:id/start`). Also serves `GET /healthz`,
 * `GET /status`, the verify pair (`POST /verify/start` + `GET /verify/report`),
 * `GET /scope-manifest`, and `GET /discovery` on localhost, plus the React operating UI
 * under `GET /ui` (ADR-0026 — mounted on a prefix because the JSON routes already own
 * /deletions, /moves and /failures, which are also screen names). Graceful shutdown
 * stops the schedules, lets in-flight passes settle, and closes the server.
 *
 * Single-tenant, no managed dependencies: this file (and its transitive imports)
 * must never pull in Trigger.dev, billing, or RLS — self-host loads none of it
 * (hard rule 5). It reuses the worker's `runAllDomains` (shared, not forked).
 */

import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { runMigrations, createPgDb, createPgliteDb, pgDriver, PgMigrationStatusStore, PgDiscoveryStore, PgDecisionStore, PgPolicyPresetStore, PgGroupDefStore, PgLedger, PgCursorStore, RunStore, withTenant } from '@openmig/ledger';
// Import the in-process scheduler directly (NOT the package index, which
// re-exports the Trigger.dev client) so self-host never loads managed code —
// hard rule 5.
import { InProcessScheduler } from '@openmig/scheduler/in-process';
import {
  runAllDomains,
  discoverAllDomains,
  verifyMapping,
  applyMappingDeletion,
  applyMappingRelocation,
} from '@openmig/orchestration';
import { SCOPE_MANIFEST, DELETION_CONFIRMATIONS, buildCompletionReport, buildDomainStatusReports, renderCompletionReportMarkdown } from '@openmig/shared';
// The operating contract (ADR-0026): the queue shapes and the operator-facing
// prose that goes with them, shared with the UI and the managed edition so the
// three cannot drift apart in the explanations that stop somebody destroying
// data by accident.
import {
  DECISION_EFFECTS,
  MAPPING_LIFECYCLES,
  REPORTING_CLOSED,
  FAILURE_GUIDANCE,
  MOVES_MEANING,
  MOVE_GUIDANCE,
  DELETIONS_MEANING,
  DELETION_GUIDANCE,
  setupStepsFor,
  summariseSetup,
} from '@openmig/shared';
import type {
  ApplyDeletionsFlag,
  VerificationRunReport,
  VerifyStartResponse,
  TenantId,
  MappingId,
  ScheduleHandle,
  DiscoveryRecord,
  FailureAction,
  MappingLifecycle,
  FailuresQueue,
  MovesQueue,
  DeletionsQueue,
  FinishAccepted,
  VerificationResult,
} from '@openmig/shared';
import { loadConfigDir, uuidFromString, type LoadedMapping } from './config-dir';
import { buildStatusReport, type MappingStatusInput } from './status';
import { startTransition, finishTransition } from './lifecycle';
import { serveUi, UI_MOUNT } from './static-ui';
import { createVerifyRunner } from './verify-run';
import {
  log,
  permissionsNotDiscoverable,
  type PermissionListing,
  type ShareGrantRow,
} from '@openmig/shared';
import {
  buildGoogleDriveSourceFrom,
  ENV_GOOGLE_CREDENTIAL_NAMES,
} from '@openmig/orchestration/drive-source-factory';
import { renderMetrics, METRICS_CONTENT_TYPE } from '@openmig/shared';
import {
  createFailureStreakGate,
  renderEvent,
  renderDigest,
  digestSchedule,
  type Notifier,
  type NotificationEvent,
  type MappingAttention,
  type DigestCadence,
} from '@openmig/shared';
import {
  notifierFromEnv,
  createTokenProvider,
  listTenantMailboxes,
  listMailEnabledGroups,
  listImapGroups,
  groupsNotEnumerable,
  mailboxDelegations,
  resolveUserDriveId,
  scanCalendarPermissions,
  scanDrivePermissions,
  directoryNotEnumerable,
  directoryAvailability,
  driveSharingAvailability,
  createNextcloudUserShare,
  type HttpClient,
} from '@openmig/connectors';
import {
  runNewMailboxDetection,
  runGroupDiscovery,
  renderGroupRunbook,
  runPermissionInventory,
  assertMappingPattern,
  resolveMappingPattern,
  sharedAddressAnswer,
  resolveCoverage,
  coverageIncompleteReason,
  buildIdentity,
  applyShareGrant,
  markShareGrant,
  refreshShareGrants,
  summariseShareGrants,
} from '@openmig/core';

/** Graph speaks plain JSON over fetch; the detector needs nothing more. */
const detectorHttpClient: HttpClient = {
  async request({ url, method, headers }) {
    const res = await fetch(url, { method, headers });
    return { status: res.status, body: await res.text(), headers: {} };
  },
};
import {
  collectAttention as collectAttentionFrom,
  collectTenantAttention,
} from './digest-collect';

const DEFAULT_CONFIG_DIR = '/data/config';

/**
 * The role served requests run as, so that RLS is actually in force.
 *
 * The appliance connects as the database owner (container path) or as
 * `postgres` (PGlite path). Postgres exempts both from row security — a
 * superuser always, an owner unless the table is `FORCE`d — so until this
 * existed, every policy in the baseline was created, granted and bypassed.
 * `withTenant()` drops to this role transaction-locally; migrations, which
 * create the roles and the policies, still run as the owner.
 *
 * Not configurable, and no escape hatch: `app_user` is created by our own
 * `0001_baseline.sql`, so it exists in any database this appliance migrated. If
 * it has been dropped, `SET LOCAL ROLE` fails loudly — which is the right
 * outcome, because the alternative is serving with tenant isolation silently
 * switched off (hard rule 9).
 */
const SERVING_ROLE = 'app_user';
const DEFAULT_SCHEDULE = '*/15 * * * *'; // every 15 minutes if a mapping omits one

/**
 * Ensure all necessary database records exist for a mapping.
 * Creates connection, mailbox, and mailbox_mapping records if they don't exist.
 * This is needed because migration_status has FK constraints on mailbox_mapping.
 * 
 * NOTE: The client passed in should already have app.current_tenant set.
 */
async function ensureMappingRecords(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  tenantId: string,
  mailboxMappingId: string,
  sourceUser: string,
  targetUser: string,
  /** §14.1's pattern, when this mapping is a shared address (0027 T3). */
  pattern?: string,
) {
  log.debug(`[selfhost] ensuring mapping records for ${mailboxMappingId}...`);
  
    // 1. Ensure connection records exist (source and target)
    const sourceConnectionId = uuidFromString(`${tenantId}:source:imap`);
    const targetConnectionId = uuidFromString(`${tenantId}:target:jmap`);

    // Insert source connection (ignore if exists)
    await client.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [sourceConnectionId, tenantId, 'source', 'imap', 'Source IMAP', JSON.stringify({ type: 'imap', host: 'stalwart', port: 143, security: 'none' }), 'connected']
    );
    log.debug(`[selfhost] ensured source connection ${sourceConnectionId}`);

    // Insert target connection (ignore if exists)
    await client.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [targetConnectionId, tenantId, 'target', 'jmap', 'Target JMAP', JSON.stringify({ type: 'jmap', host: 'stalwart', port: 8080, security: 'none' }), 'connected']
    );
    log.debug(`[selfhost] ensured target connection ${targetConnectionId}`);

    // 2. Ensure mailbox records exist (source and target)
    const sourceMailboxId = uuidFromString(`${tenantId}:mailbox:source:${sourceUser}`);
    const targetMailboxId = uuidFromString(`${tenantId}:mailbox:target:${targetUser}`);

    // Insert source mailbox (ignore if exists)
    await client.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [sourceMailboxId, tenantId, sourceConnectionId, sourceUser, 'user', sourceUser, sourceUser, 'active']
    );
    log.debug(`[selfhost] ensured source mailbox ${sourceMailboxId}`);

    // Insert target mailbox (ignore if exists)
    await client.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [targetMailboxId, tenantId, targetConnectionId, targetUser, 'user', targetUser, targetUser, 'active']
    );
    log.debug(`[selfhost] ensured target mailbox ${targetMailboxId}`);

    // 3. Ensure mailbox_mapping record exists (ignore if exists)
    await client.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, pattern)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET pattern = EXCLUDED.pattern`,
      // 0013 T7: created PAUSED (draft) — only scheduled after the operator confirms in the UI.
      // `pattern` is the one column refreshed on conflict (0027 T3): a config
      // file that gained `source.mailbox` since the last boot describes a
      // shared mailbox now, and the row has to say so. Nothing else is
      // touched — `status` in particular is the appliance's own record of
      // what the operator confirmed, not the config file's to reset.
      [mailboxMappingId, tenantId, sourceMailboxId, targetMailboxId, 'mirror', 'paused', pattern ?? null]
    );
    log.debug(`[selfhost] ensured mailbox_mapping ${mailboxMappingId}`);
}

export interface SelfhostOptions {
  readonly databaseUrl?: string;
  /**
   * Which persistence backend to run on (workplan 0015 T1 / 0016).
   *
   * `postgres` (default) connects to a server with `DATABASE_URL`, as this
   * appliance always has. `pglite` runs Postgres **in-process** — compiled to
   * WASM, no service, no port, no `initdb`, no `DATABASE_URL` — which is what
   * makes a native Windows installer possible at all: it removes the last
   * native dependency the appliance had.
   *
   * Same SQL, same migrations, same schema, same RLS policies either way
   * (ADR-0023). The server goes away, not Postgres.
   */
  readonly persistence?: 'postgres' | 'pglite';
  /** Where PGlite keeps its data. Ignored unless `persistence` is `pglite`. */
  readonly pgliteDataDir?: string;
  readonly configDir?: string;
  readonly port?: number;
  readonly host?: string;
  /**
   * Where the built operating UI lives (ADR-0026).
   *
   * Defaults to `apps/web/dist-selfhost` resolved from this module, which is
   * where `pnpm --filter @openmig/web build:selfhost` puts it and where the
   * image copies it. Absent is not fatal: the appliance serves its JSON either
   * way and `/ui` explains how to build it.
   */
  readonly uiDir?: string;
  /**
   * Where the migration SQL lives.
   *
   * Defaults to `packages/ledger/migrations` resolved from the ledger module,
   * which is right for a checkout and right for the container image. It is
   * WRONG for a bundled appliance: bundling collapses the package layout, so
   * `import.meta.url` no longer points inside `packages/ledger` and the
   * relative walk lands somewhere arbitrary. The packaging script stages the
   * SQL next to the bundle and passes this explicitly (workplan 0015 T3).
   */
  readonly migrationsDir?: string;
}

export interface SelfhostHandle {
  readonly port: number;
  /**
   * The notification channel this appliance booted with (workplan 0030 T1) —
   * a real sender when SMTP is configured, an honest no-op that says why when
   * it is not. Exposed rather than hidden in the closure because the events
   * that will call it (0030 T2/T3) live outside `start()`, and because a test
   * can then assert which of the two an environment produces without sending
   * anything.
   */
  readonly notifier: Notifier;
  stop(): Promise<void>;
}

/** Start the appliance. Returns a handle for graceful shutdown (used by tests too). */
export async function start(options: SelfhostOptions = {}): Promise<SelfhostHandle> {
  const persistence =
    options.persistence ?? (process.env.SELFHOST_PERSISTENCE === 'pglite' ? 'pglite' : 'postgres');
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  // Only the server path needs a URL. PGlite is a directory, not an address —
  // demanding one would be the last thing tying the appliance to a running
  // Postgres after every query became portable.
  if (persistence === 'postgres' && !databaseUrl) {
    throw new Error('DATABASE_URL is required (or set SELFHOST_PERSISTENCE=pglite)');
  }
  const pgliteDataDir =
    options.pgliteDataDir ?? process.env.SELFHOST_PGLITE_DIR ?? '/data/pglite';
  const configDir = options.configDir ?? process.env.CONFIG_DIR ?? DEFAULT_CONFIG_DIR;
  const port = options.port ?? Number(process.env.PORT ?? 8080);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  // Resolved from this module rather than from cwd: the appliance is started by
  // an installer, a service manager or `docker run`, none of which promise a
  // working directory.
  const uiDir =
    options.uiDir ??
    process.env.SELFHOST_UI_DIR ??
    fileURLToPath(new URL('../../web/dist-selfhost', import.meta.url));

  // 1. Build the persistence backend, then self-migrate under the advisory lock
  //    (which refuses to start if the DB is newer than this build understands).
  //
  //    The migration runs through the SAME driver the appliance then serves
  //    with. That matters for PGlite specifically: it is one connection, and
  //    the baseline is a pg_dump whose preamble sets `row_security = off`. The
  //    driver re-asserts it per acquire for exactly that reason.
  const persistenceBackend =
    persistence === 'pglite'
      ? await createPgliteDb({ dataDir: pgliteDataDir, role: SERVING_ROLE })
      : (() => {
          const pgDb = createPgDb(databaseUrl!);
          return {
            db: pgDb,
            driver: pgDriver(pgDb.$pool, { role: SERVING_ROLE }),
            close: () => pgDb.close(),
          };
        })();
  log.info(
    `[selfhost] persistence: ${persistence}` +
      (persistence === 'pglite' ? ` (${pgliteDataDir})` : ''),
  );
  log.info('[selfhost] applying migrations…');
  await runMigrations({
    driver: persistenceBackend.driver,
    migrationsDir: options.migrationsDir ?? process.env.SELFHOST_MIGRATIONS_DIR,
  });

  // 2. Load and validate the mapping configs.
  const mappings = loadConfigDir(configDir);
  // §14.1's pattern, checked before anything is scheduled (0027 T3). A mapping
  // that declares `shared_s` without naming the mailbox would read `/me` —
  // whoever the stored credentials belong to — and copy the wrong mailbox into
  // the shared target, reporting success. Refused at boot, with the fix.
  for (const m of mappings) assertMappingPattern(m.config);
  log.info(`[selfhost] loaded ${mappings.length} mapping(s) from ${configDir}`);

  // 3. Wire the status store + scheduler.
  const db = persistenceBackend.db;
  const statusStore = new PgMigrationStatusStore(db);
  const discoveryStore = new PgDiscoveryStore(db);
  // The failure queue's two reads and two writes (§11.2's "actions required").
  const ledger = new PgLedger(db);
  const cursorStore = new PgCursorStore(db);
  /**
   * The appliance's own ledger, handed to every worker entry point it calls.
   *
   * Without it those builders open their OWN `pg.Pool` from `DATABASE_URL`,
   * which is right for the managed worker and wrong here twice over. On the
   * container path it quietly opened a second pool to the same server and
   * looked fine. On PGlite there is no server to open a pool TO — it runs
   * in-process — so every ledger query of every domain died with
   * `getaddrinfo ENOTFOUND postgres`, and `SELFHOST_PERSISTENCE=pglite` turned
   * out to have wired only the half of the appliance that reads.
   */
  const ledgerOptions = { ledgerDb: db };
  const scheduler = new InProcessScheduler();
  const handles: ScheduleHandle[] = [];
  // config mappingIds currently scheduled (only 'active' mappings run — 0013 T7).
  /** jobId -> its live schedule handle, so ONE mapping can be unscheduled.
   * `handles` stays the shutdown list; ScheduleHandle exposes only stop(), so a
   * separate map is the only way to find the right one. */
  const scheduled = new Map<string, ScheduleHandle>();

  // 3b. The notification channel (workplan 0030 T1).
  //
  // Built from the environment, because who gets told is an APPLIANCE-wide
  // fact rather than a per-mapping one, and because the appliance already
  // takes its secrets that way (`.env`, gitignored — hard rule 3). Rule 5
  // holds: this is the owner's own SMTP server, not a managed dependency.
  //
  // The state is announced at startup either way. An owner who believes they
  // will be emailed when the channel is off is worse off than one who knows
  // it is off, and `readNotifierConfig` names the missing variables when the
  // configuration is half-done — the case where somebody plainly tried.
  // Built the same way the managed worker builds it (0030 T4): both editions
  // read the same variables and fall back to the same honest no-op, so
  // "notifications are on" cannot mean two different things.
  const channel = notifierFromEnv(process.env, (m) => log.warn(m));
  const notifierConfig = channel.config;
  const notifier: Notifier = channel.notifier;
  log.info(`[selfhost] ${channel.announcement}`);

  /** One outage, one email — never one per failed pass (0030 T2). */
  const failureStreak = createFailureStreakGate();
  const notifyLocale = channel.locale;

  /**
   * Send an event, or do nothing when there is nothing to say.
   *
   * A failed SEND must never take down the thing it was reporting on: a
   * migration that finished is still finished if the email about it bounced.
   * So the error is logged loudly here (rule 9 — it is not swallowed, it is
   * reported) and not rethrown into a sync pass or an operator's request.
   */
  const tell = async (event: NotificationEvent | undefined): Promise<void> => {
    if (!event) return;
    try {
      await notifier.notify(renderEvent(event, notifyLocale));
    } catch (err) {
      log.error(
        `[notify] could not send "${event.kind}":`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  const byId = (c: { mappingId: string }): LoadedMapping => {
    const found = mappings.find((m) => m.config.mappingId === c.mappingId);
    // Cannot happen — the list the collector walks IS this list — but a
    // non-null assertion here would be exactly the silent lie rule 9 is about.
    if (!found) throw new Error(`no configured mapping with id ${c.mappingId}`);
    return found;
  };

  /**
   * What is waiting on a person right now (workplan 0030 T3).
   *
   * The RULES live in `digest-collect.ts`, where they are tested without a
   * database — a `done` mapping skipped before its reads, a failed read
   * becoming a blind spot rather than a zero, the decision count taken once
   * per tenant. What is here is the wiring: the same ledger calls and the
   * same filters the queue endpoints use, deliberately, because a digest that
   * counted differently from the screen it points at would send somebody to
   * look for four things and show them three.
   */
  /**
   * Built once and shared, so the mapping collector and the tenant-level one
   * (0043 T4) read through exactly the same seams. Two definitions would be two
   * things free to drift, which is the shape 0041 spent three commits removing.
   */
  const collectDeps = (cadence: DigestCadence = 'daily'): Parameters<typeof collectAttentionFrom>[0] => ({
      mappings: mappings.map((m) => ({
        mappingId: m.config.mappingId,
        tenantId: m.config.tenantId,
      })),
      status: (c) => mappingStatus(byId(c)),
      listDeletions: (c) =>
        ledger.listDeletions(
          byId(c).config.tenantId as TenantId,
          byId(c).mailboxMappingId as MappingId,
        ),
      listMoves: (c) =>
        ledger.listMoves(
          byId(c).config.tenantId as TenantId,
          byId(c).mailboxMappingId as MappingId,
        ),
      listFailures: (c) =>
        ledger.listFailures(
          byId(c).config.tenantId as TenantId,
          byId(c).mailboxMappingId as MappingId,
        ),
      // The digest window: what happened since the LAST summary of this
      // cadence. Counted from the audit rows core writes per auto-applied
      // relocation (ADR-0031, workplan 0048) — same source managed counts.
      countAutoApplied: async (c) => {
        // Since the last digest that ACTUALLY went out (recorded per send);
        // the cadence-sized window is only the first-ever/unreadable fallback.
        const fallback = new Date(
          Date.now() - (cadence === 'weekly' ? 7 : 1) * 24 * 60 * 60 * 1000,
        ).toISOString();
        const since =
          (await ledger.latestAuditEventAt(byId(c).config.tenantId as TenantId, {
            actor: 'system:digest',
            action: `digest_sent_${cadence}`,
          })) ?? fallback;
        return ledger.countAuditEvents(byId(c).config.tenantId as TenantId, {
          actor: 'system:auto-apply',
          action: 'auto_apply_relocation',
          since,
          mappingId: byId(c).config.mappingId,
        });
      },
      // Open checklist rows, from the same table the Sharing screen reads
      // (ADR-0032) — the digest and the page cannot disagree.
      countSharingOpen: async (c) =>
        (
          await ledger.listShareGrants(
            byId(c).config.tenantId as TenantId,
            byId(c).mailboxMappingId as MappingId,
          )
        ).filter((g) => g.state === 'open').length,
      countPendingDecisions: async (tenantId) =>
        (await new PgDecisionStore(db).list(tenantId as TenantId, { status: 'pending' })).length,
  });

  const collectAttention = (cadence: DigestCadence = 'daily'): Promise<MappingAttention[]> =>
    collectAttentionFrom(collectDeps(cadence));

  /** Send one digest, or nothing at all when nothing is waiting (0030 T3). */
  const sendDigest = async (cadence: DigestCadence): Promise<void> => {
    try {
      // A tenant-level decision (a newly-discovered mailbox, say) belongs to
      // the organisation, not to a mapping — so an appliance whose migrations
      // are all `done` used to have nowhere to carry it and sent nothing.
      // Asked for only when no mapping reported, mirroring managed exactly:
      // with live mappings the decisions already ride on the first one, and
      // counting them twice would tell the owner there are twice as many.
      const attention = await collectAttention(cadence);
      const tenant = attention.length === 0 ? await collectTenantAttention(collectDeps()) : undefined;
      const message = renderDigest(attention, notifyLocale, cadence, tenant);
      if (!message) {
        // The rule that makes this channel worth reading: no email at all.
        log.info(`[notify] ${cadence} digest: nothing needs attention — not sending`);
        return;
      }
      await notifier.notify(message);
      log.info(`[notify] ${cadence} digest sent`);
      // Recorded AFTER the send, per tenant, so the next window starts here —
      // a failure to record only widens the window back to cadence-sized.
      for (const t of [...new Set(mappings.map((m) => m.config.tenantId))]) {
        try {
          await ledger.recordAuditEvent(t as TenantId, {
            actor: 'system:digest',
            action: `digest_sent_${cadence}`,
          });
        } catch (err) {
          log.error(
            `[notify] recording the ${cadence} digest send time failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      log.error(
        `[notify] ${cadence} digest failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  };


  // Helper to run a function with tenant context set for RLS
  const withTenantContext = async <T>(
    tenantId: string,
    fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>
  ): Promise<T> => {
    // Through the seam, not `$pool`: PGlite has no pool, and this is the only
    // other place the appliance took a raw connection.
    const client = await persistenceBackend.driver.acquire();
    try {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
      return await fn(client as unknown as { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> });
    } finally {
      client.release();
    }
  };

  // Ensure the tenant + connection/mailbox/mailbox_mapping records for a mapping (idempotent).
  // migration_status and migration_discovery both FK mailbox_mapping, so this must run before
  // either a sync pass or a discovery pass.
  const ensureRecordsFor = async (m: LoadedMapping) => {
    await withTenantContext(m.config.tenantId as string, async (client) => {
      // Ensure tenant exists before running (idempotent)
      await client.query(
        `INSERT INTO tenant (id, name, status, settings)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [m.config.tenantId, `Tenant ${m.config.tenantId.slice(0, 8)}`, 'active', '{}']
      );
      // Ensure all necessary database records exist (connection, mailbox, mailbox_mapping)
      const sourceUser = m.config.source.type === 'imap-oauth2' ? m.config.source.user : 'unknown';
      const targetUser = m.config.target.type === 'jmap' ? m.config.target.user : 'unknown';
      await ensureMappingRecords(
        client,
        m.config.tenantId as string,
        m.mailboxMappingId,
        sourceUser,
        targetUser,
        // §14.1's pattern, from what the mapping declares or its source
        // implies (0027 T3). `mailbox_mapping.pattern` has been settable
        // since ledger v1 and written by nothing until now.
        resolveMappingPattern(m.config),
      );
    });
  };

  // Read the current mailbox_mapping status.
  //
  // Narrowed to `MappingLifecycle` rather than returned as a bare string,
  // because the operating contract (ADR-0026) branches on it: a UI hides the
  // decision queues for 'paused' and closes reporting for 'done'. The database
  // already guarantees the four values — `mailbox_mapping_status_check` in the
  // baseline — so anything else means that constraint was bypassed, and hard
  // rule 9 says surface that rather than quietly coerce it to a status that
  // happens to type-check. A MISSING row is a different thing and keeps its
  // documented 'paused' default: the mapping is configured but not yet started.
  const mappingStatus = async (m: LoadedMapping): Promise<MappingLifecycle> =>
    withTenantContext(m.config.tenantId as string, async (client) => {
      const { rows } = await client.query(
        `SELECT status FROM mailbox_mapping WHERE id = $1`,
        [m.mailboxMappingId],
      );
      const row = rows[0] as { status?: string } | undefined;
      if (row?.status === undefined) return 'paused';
      if (!MAPPING_LIFECYCLES.includes(row.status as MappingLifecycle)) {
        throw new Error(
          `[selfhost] ${m.config.mappingId}: mailbox_mapping.status is '${row.status}', which is ` +
            `not one of ${MAPPING_LIFECYCLES.join(', ')}. The database CHECK constraint should ` +
            `make this impossible; refusing to guess what the migration's state is.`,
        );
      }
      return row.status as MappingLifecycle;
    });

  /** Stop scheduling a mapping, so a finished migration stops syncing at once. */
  const unscheduleMapping = (m: LoadedMapping) => {
    const handle = scheduled.get(m.config.mappingId);
    if (!handle) return;
    handle.stop();
    scheduled.delete(m.config.mappingId);
    // Left in `handles` on purpose: that array is the shutdown list, and croner's
    // stop() is idempotent, so a second stop at shutdown costs nothing.
    log.info(`[selfhost] unscheduled ${m.config.mappingId}`);
  };

  const runMapping = (m: LoadedMapping) => async () => {
    try {
      // Re-read the status EVERY pass, not just at startup.
      //
      // Startup decided what to schedule, but a mapping can be finished (or
      // paused) while the process keeps running — by the finish endpoint below,
      // or by an operator touching the database directly. Without this check a
      // mapping marked done went on syncing until the next restart, which makes
      // "finished" mean nothing until someone reboots the appliance.
      const currentStatus = await mappingStatus(m);
      if (currentStatus !== 'active') {
        log.info(
          `[selfhost] ${m.config.mappingId} is '${currentStatus}', not 'active' — skipping this ` +
            'pass and unscheduling.',
        );
        unscheduleMapping(m);
        return;
      }

      log.info(`[selfhost] ${m.config.mappingId}: starting pass...`);
      await ensureRecordsFor(m);

      // Use the mailbox_mapping ID (not the config mappingId) for migration_status
      const configWithCorrectMappingId = {
        ...m.config,
        mappingId: m.mailboxMappingId,
      };

      log.info(`[selfhost] ${m.config.mappingId}: running domains...`);

      // One `run` row per pass so /status and the run history reflect what
      // actually executed. Opened before the pass so a crash leaves a `running`
      // row rather than no trace. Bookkeeping is best-effort throughout: it must
      // never abort the sync it describes.
      const tenantId = configWithCorrectMappingId.tenantId as TenantId;
      const mappingId = configWithCorrectMappingId.mappingId as MappingId;
      let runId: string | null = null;
      try {
        runId = await withTenant(persistenceBackend.driver, tenantId, async (tdb) =>
          new RunStore(tdb).startRun({ tenantId, mappingId, kind: 'incremental', trigger: 'schedule' }),
        );
      } catch (err) {
        log.error(`[selfhost] ${m.config.mappingId}: failed to open run row:`, err instanceof Error ? err.message : err);
      }

      const results = await runAllDomains(configWithCorrectMappingId, statusStore, ledgerOptions);
      const created = results.reduce((n, r) => n + r.created, 0);
      // Disabled domains report placeholder zeros so status pollers see every
      // domain -- but they did not RUN, and every did-this-pass-fail decision
      // below divides by the domains that did. With them counted, a mapping
      // with any disabled domain (i.e. every real mapping) could never reach
      // "all failed": the run row said `succeeded` over a total failure and
      // the 0030 outage email could never fire. One variable feeds all three
      // consumers so they cannot drift apart again.
      const ran = results.filter((r) => !r.disabled);
      const failures = ran.filter((r) => r.error);

      if (runId) {
        const id = runId;
        try {
          await withTenant(persistenceBackend.driver, tenantId, async (tdb) => {
            const runs = new RunStore(tdb);
            for (const r of ran) {
              // Failures carry the real message verbatim (hard rule 9).
              // Disabled domains are skipped: "0 created" lines for domains
              // this mapping does not have are noise wearing an info level.
              if (r.error) {
                await runs.logEvent(tenantId, id, 'error', `${r.domain} sync failed: ${r.error}`, { domain: r.domain });
              } else {
                await runs.logEvent(tenantId, id, 'info',
                  `${r.domain}: ${r.created} created, ${r.skipped} skipped`,
                  { domain: r.domain, created: r.created, skipped: r.skipped });
              }
            }
            await runs.finishRun(id, failures.length > 0 && failures.length === ran.length ? 'failed' : 'succeeded', {
              itemsProcessed: ran.reduce((n, r) => n + r.created + r.skipped, 0),
              errors: failures.length,
            });
          });
        } catch (err) {
          log.error(`[selfhost] ${m.config.mappingId}: failed to close run row:`, err instanceof Error ? err.message : err);
        }
      }

      // "pass complete (0 created)" was ALL this said, on a pass whose email
      // domain had just failed outright — real output, Windows, 2026-08-09:
      //
      //   [Worker] email sync failed: JMAP target password/token not found ...
      //   [selfhost] ...: pass complete (0 created)
      //
      // Read on its own, the second line says the pass finished and there was
      // nothing to copy. The run row and /status both had it right; the log,
      // which is the artefact an operator actually pastes back, did not. Hard
      // rule 9: the failure has to survive in the place people read.
      log.info(
        `[selfhost] ${m.config.mappingId}: pass complete (${created} created` +
          (failures.length > 0
            ? `, ${failures.length} domain(s) FAILED: ${failures.map((r) => r.domain).join(', ')}`
            : '') +
          ')',
      );

      // A pass in which EVERY domain failed is the mapping failing, and the
      // same definition the run row uses — a partly failed pass is per-item
      // trouble that the queues already report to a person. The gate makes
      // this one email per outage rather than one per minute (0030 T2).
      const allFailed = ran.length > 0 && ran.every((r) => r.error);
      await tell(
        failureStreak.record(
          m.config.mappingId,
          allFailed ? 'failed' : 'ok',
          results.find((r) => r.error)?.error,
        ),
      );
    } catch (err) {
      // Surface, never swallow (hard rule 9). The scheduler keeps running.
      log.error(`[selfhost] ${m.config.mappingId}: pass failed:`, err instanceof Error ? err.message : err);
      // A pass that threw outright never produced results, and is as failed
      // as a pass can be.
      await tell(
        failureStreak.record(
          m.config.mappingId,
          'failed',
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  };

  // Schedule a mapping's recurring sync (idempotent — guards the `scheduled` set so an
  // operator confirming twice never double-schedules).
  const scheduleMapping = (m: LoadedMapping) => {
    if (scheduled.has(m.config.mappingId)) return;
    const cron = m.config.schedule?.cron ?? DEFAULT_SCHEDULE;
    const handle = scheduler.schedule(m.config.mappingId, cron, runMapping(m));
    handles.push(handle);
    scheduled.set(m.config.mappingId, handle);
    log.info(`[selfhost] scheduled ${m.config.mappingId} (${cron})`);
  };

  // Startup: ensure records, fire read-only discovery in the background, and schedule
  // only mappings that are already 'active'. Paused (draft) mappings wait for the operator
  // to confirm on the page (0013 T7).
  for (const m of mappings) {
    await ensureRecordsFor(m);

    const configWithCorrectMappingId = { ...m.config, mappingId: m.mailboxMappingId };
    // Best-effort, non-blocking: discovery counts populate as the source is scanned.
    void discoverAllDomains(
      configWithCorrectMappingId,
      discoveryStore,
      m.config.tenantId as TenantId,
      m.mailboxMappingId as MappingId,
      ledgerOptions,
    ).catch((err) => {
      log.error(
        `[selfhost] ${m.config.mappingId}: discovery failed:`,
        err instanceof Error ? err.message : err,
      );
    });

    const status = await mappingStatus(m);
    if (status === 'active') {
      scheduleMapping(m);
      // ADR-0020's on-startup half (0026 T1 item 5): an ACTIVE mapping whose
      // ledger holds zero rows is the lost-ledger shape — active means the
      // owner pressed start, so a sync has (normally) run before. Detection
      // only, said loudly; the doorway is the worker CLI's `reindex` command.
      // A first pass that simply has not finished yet also matches, which is
      // why this warns instead of acting.
      try {
        const rows = await withTenantContext(m.config.tenantId, async (client) => {
          const res = await client.query('SELECT count(*)::int AS n FROM item WHERE mapping_id = $1', [
            m.mailboxMappingId,
          ]);
          return (res.rows[0] as { n?: number } | undefined)?.n ?? 0;
        });
        const warning = lostLedgerWarning(m.config.mappingId, rows);
        if (warning) log.warn(`[selfhost] ${warning}`);
      } catch (err) {
        // The check must never take the appliance down; the failed check is
        // itself said out loud (rule 9), not swallowed into silence.
        log.warn(
          `[selfhost] ${m.config.mappingId}: could not check the ledger for the lost-ledger ` +
            `warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      log.info(`[selfhost] ${m.config.mappingId} is '${status}' — awaiting confirm at /`);
    }
  }

  // 3c. The digest schedule (workplan 0030 T3).
  //
  // Through the same `Scheduler` seam the syncs use (croner here, hard rule
  // 5), so a digest cannot outlive a shutdown any more than a pass can.
  // Morning local time on purpose: a summary that lands at 03:00 is read
  // twelve hours late, and the whole point is reaching somebody before their
  // day starts. Weekly goes out on Monday for the same reason.
  //
  // Nothing is scheduled when notifications are off, rather than scheduling a
  // job that would discover that every morning and do nothing.
  for (const { cadence, cron } of digestSchedule(notifierConfig)) {
    const handle = scheduler.schedule(`digest-${cadence}`, cron, () => sendDigest(cadence));
    handles.push(handle);
    log.info(`[selfhost] ${cadence} digest scheduled (${cron})`);
  }

  // 3d. Drift detection (workplan 0028 T2).
  //
  // The appliance's half of the detector. Every rule is in `@openmig/core` and
  // tested without a database; what is here is the wiring — the token, the
  // store, the notifier and the schedule — exactly as on managed.
  //
  // Coverage comes from the MAPPING FILES here, not the ledger: an appliance's
  // mappings ARE its config, and `resolveCoverage` reads the address out of an
  // IMAP `user` or a Graph `mailbox`. A mapping that states neither is
  // reported as unstated, and the tenant raises nothing that run — announcing
  // a mailbox somebody is already migrating would teach the owner the queue is
  // wrong, which is worse than saying nothing.
  const detectDrift = async (): Promise<void> => {
    // Grouped by tenant: the directory is a tenant-level fact, and the
    // decision belongs to the tenant rather than to any one mapping.
    const byTenant = new Map<string, LoadedMapping[]>();
    for (const m of mappings) {
      const list = byTenant.get(m.config.tenantId) ?? [];
      list.push(m);
      byTenant.set(m.config.tenantId, list);
    }

    for (const [tenantId, tenantMappings] of byTenant) {
      const coverage = resolveCoverage(
        tenantMappings.map((m) => ({ mappingId: m.config.mappingId, source: m.config.source })),
      );
      // The Graph tenant, from whichever mapping has a Graph source. An
      // appliance migrating only IMAP has none, which is a legitimate
      // configuration and not an error.
      const graphSource = tenantMappings
        .map((m) => m.config.source)
        .find((src) => src.type.startsWith('graph-')) as { tenantId?: string } | undefined;

      try {
        const summary = await runNewMailboxDetection({
          tenantId: tenantId as TenantId,
          listDirectory: async () => {
            const available = directoryAvailability(process.env, graphSource?.tenantId);
            if (!available.ok) {
              return { kind: 'not_enumerable', reason: directoryNotEnumerable(available.reason) };
            }
            const tokenProvider = createTokenProvider({
              tokenEndpoint: `https://login.microsoftonline.com/${graphSource!.tenantId!}/oauth2/v2.0/token`,
              clientId: available.clientId,
              clientSecret: available.clientSecret,
              tenantId: graphSource!.tenantId!,
              scope: 'https://graph.microsoft.com/.default',
            });
            return listTenantMailboxes(
              async () => (await tokenProvider.getToken()).accessToken,
              detectorHttpClient,
              { applicationPermissions: true },
            );
          },
          coveredAddresses: async () => coverage.addresses,
          coverageIncomplete: async () =>
            coverage.unstated.length > 0 ? coverageIncompleteReason(coverage.unstated) : undefined,
          dismissedAddresses: async () =>
            (await new PgDecisionStore(db).list(tenantId as TenantId, { status: 'dismissed' }))
              .filter((d) => d.category === 'new_mailbox')
              .map((d) => d.subjectKey)
              .filter((k): k is string => Boolean(k)),
          raise: async (input) => {
            const { created, decision } = await new PgDecisionStore(db).raise(input);
            return { created, id: decision.id };
          },

          // The tenant's standing answer, if it expressed one (0028 T5).
          presetAction: () =>
            new PgPolicyPresetStore(db).get(tenantId as TenantId, 'new_mailbox'),
          autoResolve: async (decisionId, input) => {
            await new PgDecisionStore(db).autoResolve(tenantId as TenantId, decisionId, {
              closedBy: 'policy_preset',
              preset: { category: 'new_mailbox', action: 'auto' },
              subject: input.subjectKey,
            });
          },
          // `tell` already logs a failed send loudly without rethrowing, which
          // is rule 4: the decision is in the queue whatever the email did.
          onRaised: async (input) =>
            tell({ kind: 'decision_raised', summary: input.summary }),
          warn: (m) => log.warn(m),
          error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
        });
        if (summary.raised > 0 || summary.alreadyPending > 0) {
          log.info(
            `[detect] ${tenantId}: ${summary.raised} raised, ${summary.alreadyPending} already pending`,
          );
        }
      } catch (err) {
        // A detection pass must never take the appliance down; the failure is
        // said out loud (rule 9) rather than swallowed.
        log.error(
          `[detect] ${tenantId}: the detection pass failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };

  // 07:00 local, an hour before the digest — a mailbox found this morning is
  // in the summary the owner reads rather than waiting a day.
  {
    const handle = scheduler.schedule('drift-detect', '0 7 * * *', detectDrift);
    handles.push(handle);
    log.info('[selfhost] drift detection scheduled (0 7 * * *)');
  }

  // 3e. Shared-address discovery (workplan 0027 T1).
  //
  // The appliance's half. Same shape as 3d and the same division of labour:
  // every rule is in `@openmig/core`, what is here is the token, the store and
  // the schedule.
  //
  // An appliance with only IMAP mappings IS visited, and gets `listImapGroups()`
  // — which always answers "I cannot look", with the reason. That path used to
  // `continue` past such a tenant, which meant an IMAP-only operator saw
  // nothing about shared addresses in the log at all: no rows, no warning, no
  // reason. Silence and "you have none" are the same output, which is the
  // failure hard rule 9 exists to prevent, and it is why the drift detector
  // warns every run rather than once. Running the pass with a refusing reader
  // produces exactly that warning through `runGroupDiscovery`'s own blind-spot
  // rule, and writes nothing.
  const discoverGroups = async (): Promise<void> => {
    // Grouped by tenant, like drift detection: the directory is a
    // tenant-level fact.
    const byTenant = new Map<string, LoadedMapping[]>();
    for (const m of mappings) {
      const list = byTenant.get(m.config.tenantId) ?? [];
      list.push(m);
      byTenant.set(m.config.tenantId, list);
    }

    for (const [tenantId, tenantMappings] of byTenant) {
      const graphSource = tenantMappings
        .map((m) => m.config.source)
        .find((src) => src.type.startsWith('graph-')) as { tenantId?: string } | undefined;

      if (!graphSource?.tenantId) {
        // No directory to ask. Say so — every run — rather than skipping.
        await runGroupDiscovery({
          tenantId: tenantId as TenantId,
          sourceConnectionId: '',
          listGroups: async () => listImapGroups(),
          record: async () => {
            throw new Error('unreachable: a refusing reader yields no groups to record');
          },
          warn: (m) => log.warn(m),
          error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
        });
        continue;
      }

      // `group_def.source_connection_id` is NOT NULL and references
      // `connection`. The appliance's mappings are files, so the row is
      // derived deterministically from the Graph tenant — the same id every
      // run, which is what makes the group upsert converge (rule 1).
      const sourceConnectionId = uuidFromString(
        `${tenantId}:source:graph:${graphSource.tenantId}`,
      );
      try {
        await withTenantContext(tenantId, async (client) => {
          await client.query(
            `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
             VALUES ($1, $2, 'source', 'o365', 'Source Microsoft 365', $3, 'connected')
             ON CONFLICT (id) DO NOTHING`,
            [sourceConnectionId, tenantId, JSON.stringify({ tenantId: graphSource.tenantId })],
          );
        });

        const summary = await runGroupDiscovery({
          tenantId: tenantId as TenantId,
          sourceConnectionId,
          listGroups: async () => {
            const available = directoryAvailability(process.env, graphSource.tenantId);
            if (!available.ok) {
              return { kind: 'not_enumerable', reason: groupsNotEnumerable(available.reason) };
            }
            const tokenProvider = createTokenProvider({
              tokenEndpoint: `https://login.microsoftonline.com/${graphSource.tenantId!}/oauth2/v2.0/token`,
              clientId: available.clientId,
              clientSecret: available.clientSecret,
              tenantId: graphSource.tenantId!,
              scope: 'https://graph.microsoft.com/.default',
            });
            return listMailEnabledGroups(
              async () => (await tokenProvider.getToken()).accessToken,
              detectorHttpClient,
              { applicationPermissions: true },
            );
          },
          record: async (input) => {
            const { created } = await new PgGroupDefStore(db).upsert(tenantId as TenantId, input);
            return { created };
          },
          // The S-or-D question, for an address the source did not classify
          // (workplan 0028 T3). `shared_address_pattern` is the second
          // category the decision queue was scoped to carry.
          raise: async (input) => {
            const { created, decision } = await new PgDecisionStore(db).raise(input);
            return { created, id: decision.id };
          },
          // `tell` already logs a failed send loudly without rethrowing.
          onRaised: async (input) => tell({ kind: 'decision_raised', summary: input.summary }),
          warn: (m) => log.warn(m),
          error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
        });

        if (summary.discovered > 0 || summary.unclassified > 0) {
          log.info(
            `[groups] ${tenantId}: ${summary.discovered} discovered, ${summary.known} known, ` +
              `${summary.unclassified} still to classify`,
          );
        }
      } catch (err) {
        // A discovery pass must never take the appliance down; the failure is
        // said out loud (rule 9) rather than swallowed.
        log.error(
          `[groups] ${tenantId}: the discovery pass failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };

  // 06:30 local, before both the drift detector and the digest — a shared
  // address found this morning is in the summary the owner reads.
  {
    const handle = scheduler.schedule('group-discovery', '30 6 * * *', discoverGroups);
    handles.push(handle);
    log.info('[selfhost] shared-address discovery scheduled (30 6 * * *)');
  }

  // 4. Local status/health + confirm server.
  /**
   * The verification run (workplan 0017 T2): state machine in verify-run.ts,
   * scan here — it is the entrypoint that knows the mappings and the ledger.
   */
  const verifyRunner = createVerifyRunner(async () => {
    const reports: Record<string, VerificationResult> = {};
    for (const m of mappings) {
      reports[m.config.mappingId] = await verifyMapping(
        { ...m.config, mappingId: m.mailboxMappingId } as typeof m.config,
        ledgerOptions,
      );
    }
    // The §20 gate is the slow one — minutes against a real target — and the
    // owner who started it has long since closed the tab. Told once per run,
    // per mapping, on the transition to a finished report (0030 T2). Only a
    // PASS counts as passed: WARN is not a green light, and saying so in the
    // one email somebody reads about it would be the worst place to blur it.
    for (const [mappingId, report] of Object.entries(reports)) {
      await tell({
        kind: 'verification_finished',
        mappingId,
        passed: report.overallStatus === 'PASS',
      });
    }
    return reports;
  });

  const server = createServer(async (req, res) => {
    try {
      // The operating UI (ADR-0026), under /ui so it cannot collide with the
      // JSON routes below — several of which share a name with one of its
      // screens. Returns false for anything outside the mount, so this can
      // never shadow an endpoint by accident.
      if (await serveUi(req, res, { rootDir: uiDir })) return;

      // The appliance's landing page is the React confirm screen (ADR-0026).
      //
      // This used to render `confirm-page.ts` — 135 lines of hand-rolled HTML
      // that were the appliance's only UI. Folding it into the React app is the
      // last piece of that ADR: the counts table and the scope manifest existed
      // TWICE, in two languages, and had already drifted. One redirect is what
      // is left of it.
      if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
        res.writeHead(302, { location: `${UI_MOUNT}/confirm` });
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/healthz') {
        return sendJson(res, 200, { status: 'ok' });
      }
      // What build is this? Same trust posture as /healthz: localhost-bound
      // by default, and the body is a version + commit, nothing else.
      if (req.method === 'GET' && req.url === '/version') {
        return sendJson(res, 200, buildIdentity());
      }
      // Prometheus scrape target (§18 names Grafana/LGTM; §19 wants per-tenant
      // dashboards). Plain text, not JSON, and deliberately unauthenticated in
      // the same way /healthz is: the appliance binds to localhost by default
      // (SELFHOST_BIND), and the body carries counts and durations only — no
      // addresses, no folder names (§17).
      if (req.method === 'GET' && req.url === '/metrics') {
        res.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
        res.end(renderMetrics());
        return;
      }
      if (req.method === 'GET' && req.url === '/scope-manifest') {
        return sendJson(res, 200, SCOPE_MANIFEST);
      }
      if (req.method === 'GET' && req.url === '/status') {
        const inputs: MappingStatusInput[] = [];
        for (const m of mappings) {
          const statuses = await statusStore.getStatus(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          // Counted here rather than left to /failures, because /status is what
          // anyone watching a migration actually polls. A run with items stuck
          // in the queue must not look identical to one with none.
          const failures = await ledger.listFailures(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          inputs.push({
            mappingId: m.config.mappingId,
            migrationStatus: await mappingStatus(m),
            statuses,
            failures,
          });
        }
        // The channel's state travels with the status an owner already polls.
        // Before this it existed only as a `log.info` at boot, which meant a
        // quiet inbox and a switched-off channel were indistinguishable to
        // anyone not reading container logs (0043 T3). The reason is the
        // channel's own words — `readNotifierConfig` distinguishes nothing-set
        // from half-set and names the missing variables, which is the whole
        // point of showing it (rule 9).
        return sendJson(
          res,
          200,
          buildStatusReport(inputs, {
            enabled: notifierConfig.enabled,
            ...(notifierConfig.enabled ? {} : { reason: notifierConfig.reason }),
          }),
        );
      }
      // The §20 verification gate, in its two forms (workplan 0017 T2).
      //
      // The start + poll pair is the contract both editions converge on: the
      // scan takes minutes against every enabled domain's target, and a page
      // must be able to begin it and come back rather than hold a request open.
      // POST starts (idempotently — a second start while running JOINS the run,
      // the same shape as POST .../start's `activated: false`); GET reports one
      // of four states and never triggers anything, so the Verify screen stays
      // a page rather than a trapdoor.
      if (req.method === 'POST' && req.url === '/verify/start') {
        await drain(req);
        // 202 for "began work", 200 for "was already under way" — the body
        // carries the running report either way, so a client polls from here.
        const outcome: VerifyStartResponse = verifyRunner.start();
        return sendJson(res, outcome.started ? 202 : 200, outcome);
      }
      if (req.method === 'GET' && req.url === '/verify/report') {
        return sendJson(res, 200, verifyRunner.current() satisfies VerificationRunReport);
      }
      // There is deliberately no synchronous `GET /verify` any more (0019 T6).
      // It survived exactly the one release 0017 T2 promised: PR #200 moved
      // the e2e gate onto the pair above, the first post-merge run was green
      // through it, and nothing in the repo called it since. A route that
      // holds one HTTP request open for a whole target scan is the shape the
      // pair exists to end.
      // The failure queue: what could not be migrated, why, and how many times
      // we tried. This is the INSIGHT half of §11.2's decision queue — the
      // actions are the two POSTs below.
      //
      // Deliberately keyed by natural-key HASH rather than the natural key. A
      // file's natural key is its path, which §17 treats as personal data, and
      // this body may be piped into a ticket or a chat. The hash is all the
      // two actions need.
      if (req.method === 'GET' && req.url === '/failures') {
        const out: Record<string, FailuresQueue> = {};
        for (const m of mappings) {
          const mStatus = await mappingStatus(m);
          const failures = await ledger.listFailures(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          out[m.config.mappingId] = {
            // A finished migration keeps its history but stops nagging: the queues
            // below are what WAS outstanding when it ended, not work still to do.
            migrationStatus: mStatus,
            ...(mStatus === 'done' ? { reportingClosed: REPORTING_CLOSED } : {}),
            // Split rather than left for the reader to filter: they are
            // different situations. One is still being worked on; the other is
            // waiting on a person and will otherwise never move.
            needsDecision: failures.filter((f) => f.needsDecision),
            retrying: failures.filter((f) => !f.needsDecision),
            howToResolve: FAILURE_GUIDANCE,
          };
        }
        return sendJson(res, 200, out);
      }
      // The move queue: items the owner relocated on the SOURCE after the
      // migration started, which the target has not followed. The other half of
      // §11.2's decision queue — /failures is "could not be copied", this is
      // "copied, but the source has since put it somewhere else".
      //
      // Nothing here has been acted on. §11.1 leaves topology to the owner, and
      // making the target match would mean removing the copy from where it
      // currently sits — the delete half of a move, which hard rule 2 forbids
      // outright. So the queue is insight plus one decision: leave it.
      //
      // `from`/`to` ARE folder paths, unlike everything keyed by hash above.
      // They have to be: "12 items moved" that cannot say where is not a queue
      // anyone can act on. §17 keeps paths out of METRIC labels, which is a
      // different store with different retention; this is the operator's own
      // status surface, the same place `lastError` already goes.
      if (req.method === 'GET' && req.url === '/moves') {
        const out: Record<string, MovesQueue> = {};
        for (const m of mappings) {
          const mStatus = await mappingStatus(m);
          const all = await ledger.listMoves(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          out[m.config.mappingId] = {
            // A finished migration keeps its history but stops nagging: the queues
            // below are what WAS outstanding when it ended, not work still to do.
            migrationStatus: mStatus,
            ...(mStatus === 'done' ? { reportingClosed: REPORTING_CLOSED } : {}),
            // Split, as with failures: one still wants a person, the other has
            // already had one.
            open: all.filter((mv) => !mv.acknowledgedAt),
            acknowledged: all.filter((mv) => mv.acknowledgedAt),
            whatThisMeans: MOVES_MEANING,
            howToResolve: MOVE_GUIDANCE,
          };
        }
        return sendJson(res, 200, out);
      }
      // The deletions queue: items the SOURCE no longer has, which the target
      // still holds. The third arm of §11.2's decision queue — /failures is
      // "could not be copied", /moves is "the source put it somewhere else",
      // this is "the source no longer has it at all".
      //
      // NOTHING HERE HAS BEEN REMOVED BY DEFAULT. §11.1 says deletions are
      // never auto-propagated and hard rule 2 forbids the tool deleting on its
      // own; neither says the owner may not decide, and `apply` below is that
      // decision made explicit, one item at a time, gated on this mapping
      // having `allowApplyDeletions: true` and on the evidence being positive
      // (never on an absence, however many passes it has repeated).
      //
      // `evidence` is the field to read first, because the two kinds are
      // different in kind and not in degree:
      //
      //   - 'reported' — the source SAID SO. A CalDAV/CardDAV server answers an
      //     incremental poll with the objects it has removed (RFC 6578), and
      //     those arrive confirmed on sight. Nothing about a second pass would
      //     make the server's own 404 truer.
      //   - 'trashed' — the owner PUT IT IN THE BIN, and it is still sitting
      //     there. Also confirmed on sight: we are looking at the item in a
      //     folder whose role is `\Trash`, which is the old system's own record
      //     that the person deleted it. This is the only evidence mail has.
      //   - 'inferred' — we STOPPED SEEING IT. An absence seen once has innocent
      //     explanations — a folder briefly missing from discovery, a throttled
      //     listing, a connector having a bad ten minutes — so the item is
      //     watched until it has vanished from several CONSECUTIVE complete scans
      //     before anyone is asked about it. This is all the file domain has.
      if (req.method === 'GET' && req.url === '/deletions') {
        const out: Record<string, DeletionsQueue> = {};
        for (const m of mappings) {
          const mStatus = await mappingStatus(m);
          const all = await ledger.listDeletions(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
          out[m.config.mappingId] = {
            // A finished migration keeps its history but stops nagging: the queues
            // below are what WAS outstanding when it ended, not work still to do.
            migrationStatus: mStatus,
            ...(mStatus === 'done' ? { reportingClosed: REPORTING_CLOSED } : {}),
            confirmed: all.filter((d) => d.confirmed && !d.acknowledgedAt),
            // Not yet worth acting on, shown so the queue is not a black box.
            watching: all.filter((d) => !d.confirmed && !d.acknowledgedAt),
            acknowledged: all.filter((d) => d.acknowledgedAt),
            whatThisMeans: DELETIONS_MEANING,
            howToResolve: DELETION_GUIDANCE,
          };
        }
        return sendJson(res, 200, out);
      }
      // What shared-address discovery found (workplan 0027 T4). Same shape
      // and same words as managed (ADR-0026): one operating UI.
      //
      // An empty list is NOT "this organisation has no shared addresses" —
      // an IMAP source cannot enumerate groups at all, and a Graph source
      // without application permissions cannot either. The screen's empty
      // state carries that sentence (rule 9); this route just reports rows.
      if (req.method === 'GET' && req.url === '/shared-addresses') {
        const store = new PgGroupDefStore(db);
        const addresses = [];
        for (const t of [...new Set(mappings.map((m) => m.config.tenantId))]) {
          addresses.push(...(await store.list(t as TenantId)));
        }
        return sendJson(res, 200, { addresses });
      }
      // The two §14.2 scans for one mailbox, resolved from what this
      // appliance's mappings actually configure (workplan 0029 T1/T5) — used
      // by the permission report below AND by the sharing queue's rescan
      // (ADR-0032), so the queue can never know more or less than the report.
      const inventoryScansFor = (mailbox: string) => {
        // The Graph tenant, from whichever mapping has a Graph source. An
        // appliance migrating only IMAP has none, which is a legitimate
        // configuration — every category then says so.
        const graphSource = mappings
          .map((m) => m.config.source)
          .find((src) => src.type.startsWith('graph-')) as { tenantId?: string } | undefined;
        // A Google Drive mapping (workplan 0029, the Google half): its
        // outbound shares are readable with the scope the pass already uses —
        // same env credential names, no extra consent decision.
        const hasGoogleDriveSource = mappings.some((m) => m.config.source.type === 'google-drive');
        const available = directoryAvailability(process.env, graphSource?.tenantId);
        const scanOptions = { applicationPermissions: true } as const;
        const driveSharing = driveSharingAvailability(process.env);
        const graphToken = () => {
          const provider = createTokenProvider({
            tokenEndpoint: `https://login.microsoftonline.com/${graphSource!.tenantId!}/oauth2/v2.0/token`,
            clientId: (available as { clientId: string }).clientId,
            clientSecret: (available as { clientSecret: string }).clientSecret,
            tenantId: graphSource!.tenantId!,
            scope: 'https://graph.microsoft.com/.default',
          });
          return async () => (await provider.getToken()).accessToken;
        };
        return {
          scanCalendars: async (): Promise<PermissionListing> =>
            available.ok
              ? scanCalendarPermissions(mailbox, graphToken(), detectorHttpClient, scanOptions)
              : hasGoogleDriveSource && !graphSource
                ? {
                    // A Google appliance would otherwise get a Graph-worded
                    // reason about an app registration it never had.
                    kind: 'not_discoverable' as const,
                    reason: permissionsNotDiscoverable(
                      'Google Calendar sharing is not yet read by this tool — the Drive ' +
                        'scan covers files only. Capture calendar sharing by hand before cutover',
                    ),
                  }
                : { kind: 'not_discoverable' as const, reason: available.reason },
          scanDrive: async (): Promise<PermissionListing> => {
            if (hasGoogleDriveSource) {
              // Same factory and env names as a pass; a refusal (missing
              // variable, bad consent) arrives verbatim as the blind spot.
              try {
                const source = buildGoogleDriveSourceFrom(
                  {},
                  {
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
                  },
                  ENV_GOOGLE_CREDENTIAL_NAMES,
                ) as unknown as { listOwnedShareGrants(): Promise<PermissionListing> };
                return await source.listOwnedShareGrants();
              } catch (err) {
                return {
                  kind: 'not_discoverable' as const,
                  reason: permissionsNotDiscoverable(
                    err instanceof Error ? err.message : String(err),
                  ),
                };
              }
            }
            // The consent decision answers before the credentials do; see
            // `drive-sharing-availability.ts` for why a 403 is the wrong
            // sentence to give somebody here.
            if (!driveSharing.ok)
              return { kind: 'not_discoverable' as const, reason: driveSharing.reason };
            if (!available.ok)
              return { kind: 'not_discoverable' as const, reason: available.reason };
            const token = graphToken();
            const drive = await resolveUserDriveId(
              mailbox,
              token,
              detectorHttpClient,
              scanOptions,
            );
            if (!drive.ok) return { kind: 'not_discoverable' as const, reason: drive.reason };
            return scanDrivePermissions(drive.id, token, detectorHttpClient, scanOptions);
          },
        };
      };
      // The target's share capability for one mapping (ADR-0032 §3-4):
      // Nextcloud behind the `webdav` target speaks OCS; nothing else does
      // yet, and undefined makes `applyShareGrant` refuse with the
      // protocol-gap sentence. The target notifies the grantee itself —
      // that is the point.
      const nextcloudCapabilityFor = (
        m: (typeof mappings)[number],
        granteeOverride: string | undefined,
      ) => {
        const t = m.config.domains?.files?.target ?? m.config.target;
        if (!t || t.type !== 'webdav') return undefined;
        const passwordFromEnv = (t.auth as { passwordFromEnv?: string } | undefined)
          ?.passwordFromEnv;
        const password = passwordFromEnv ? (process.env[passwordFromEnv] ?? '') : '';
        return async (row: ShareGrantRow) => {
          const shareWith = granteeOverride ?? row.grantee;
          if (!shareWith) {
            return {
              ok: false as const,
              reason:
                'This grant names no grantee address (a link or domain share) — there is ' +
                'nobody to share with. Handle it by hand and mark the row done.',
            };
          }
          return createNextcloudUserShare(
            {
              webdavUrl: t.url,
              username: t.user,
              password,
              httpClient: {
                async request({ url, method, headers, body }) {
                  const r = await fetch(url, {
                    method,
                    headers,
                    ...(typeof body === 'string' ? { body } : {}),
                  });
                  return { status: r.status, body: await r.text(), headers: {} };
                },
              },
            },
            {
              path: m.config.targetFolderPrefix
                ? `${m.config.targetFolderPrefix}/${row.onLabel}`
                : row.onLabel,
              shareWith,
              role: row.role,
            },
          );
        };
      };
      /**
       * One appliance, one tenant — every configured mapping shares it, so the
       * checklist is tenant-scoped exactly as it is on managed, with no
       * per-mapping meaning to invent.
       */
      const applianceTenantId = (): TenantId =>
        (mappings[0]?.config.tenantId ?? '00000000-0000-0000-0000-000000000000') as TenantId;

      // ------------------------------ the provider setup checklist (0061/0066)
      //
      // GENERIC ON PURPOSE. The prerequisites are the same work in both
      // editions — somebody still creates a Box app and gets an admin to
      // authorise it — so the appliance answers the same two routes over the
      // same table, and the shared UI needs no edition branch.
      //
      // Connections management is NOT mirrored, and that is a decision rather
      // than an omission: an appliance's connections come from mapping FILES,
      // which are the source of truth an operator edits and version-controls.
      // A UI that let somebody edit them here would either lie (the file wins
      // on restart) or quietly rewrite a file the operator owns.
      const setupGetMatch =
        req.method === 'GET' && req.url ? /^\/setup\/([^/]+)\/([^/]+)$/.exec(req.url) : null;
      if (setupGetMatch) {
        const side = setupGetMatch[1] === 'target' ? 'target' : 'source';
        const provider = decodeURIComponent(setupGetMatch[2]!);
        const steps = setupStepsFor(side, provider);
        const rows = await ledger.listSetupSteps(applianceTenantId(), side, provider);
        const byKey = new Map(rows.map((r) => [r.stepKey, r]));
        const statuses = steps.map((step) => {
          const row = byKey.get(step.key);
          return {
            step,
            state: row?.state ?? ('open' as const),
            ...(row?.decidedBy ? { decidedBy: row.decidedBy } : {}),
            ...(row?.decidedAt ? { decidedAt: row.decidedAt } : {}),
          };
        });
        return sendJson(res, 200, {
          side,
          provider,
          steps: statuses,
          progress: summariseSetup(statuses),
        });
      }
      const setupPutMatch =
        req.method === 'PUT' && req.url
          ? /^\/setup\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(req.url)
          : null;
      if (setupPutMatch) {
        const body = await readJson(req);
        const side = setupPutMatch[1] === 'target' ? 'target' : 'source';
        const provider = decodeURIComponent(setupPutMatch[2]!);
        const stepKey = decodeURIComponent(setupPutMatch[3]!);
        const state = (body as { state?: string }).state;
        if (state !== 'open' && state !== 'done' && state !== 'skipped') {
          return sendJson(res, 400, {
            error: 'invalid_body',
            reason: "Send { state } — one of 'open', 'done' or 'skipped'.",
          });
        }
        if (!setupStepsFor(side, provider).some((x) => x.key === stepKey)) {
          return sendJson(res, 404, {
            error: 'unknown_step',
            reason: `'${stepKey}' is not a setup step for the ${side} '${provider}'.`,
          });
        }
        // One operator on an appliance, so the decider is the operator — the
        // same word the sharing queue uses here.
        await ledger.setSetupStepState(applianceTenantId(), side, provider, stepKey, {
          state,
          decidedBy: 'operator',
        });
        const steps = setupStepsFor(side, provider);
        const rows = await ledger.listSetupSteps(applianceTenantId(), side, provider);
        const byKey = new Map(rows.map((r) => [r.stepKey, r]));
        const statuses = steps.map((step) => {
          const row = byKey.get(step.key);
          return {
            step,
            state: row?.state ?? ('open' as const),
            ...(row?.decidedBy ? { decidedBy: row.decidedBy } : {}),
            ...(row?.decidedAt ? { decidedAt: row.decidedAt } : {}),
          };
        });
        return sendJson(res, 200, {
          side,
          provider,
          steps: statuses,
          progress: summariseSetup(statuses),
        });
      }

      // ------------------------------------------ the sharing queue (ADR-0032)
      const sharingGetMatch =
        req.method === 'GET' && req.url ? /^\/mappings\/([^/]+)\/sharing$/.exec(req.url) : null;
      if (sharingGetMatch) {
        const id = decodeURIComponent(sharingGetMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
        const lifecycle = await mappingStatus(m);
        const grants = await ledger.listShareGrants(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
        );
        return sendJson(res, 200, {
          migrationStatus: lifecycle,
          summary: summariseShareGrants(grants),
          grants,
          ...(lifecycle === 'done' ? { reportingClosed: REPORTING_CLOSED } : {}),
        });
      }
      const sharingRescanMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/sharing\/rescan$/.exec(req.url)
          : null;
      if (sharingRescanMatch) {
        await drain(req);
        const id = decodeURIComponent(sharingRescanMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
        const coverage = resolveCoverage([
          { mappingId: m.config.mappingId, source: m.config.source },
        ]);
        const mailbox = coverage.addresses[0];
        if (!mailbox) {
          // The same fact the permission report refuses over, named (rule 9).
          return sendJson(res, 409, {
            error: 'address_unstated',
            reason:
              'This mapping does not state which mailbox it reads, so its sharing cannot ' +
              'be inventoried.',
          });
        }
        const scans = inventoryScansFor(mailbox);
        const result = await refreshShareGrants({
          tenantId: m.config.tenantId as TenantId,
          mappingId: m.mailboxMappingId as MappingId,
          ledger,
          scans: [scans.scanCalendars, scans.scanDrive],
        });
        return sendJson(res, 200, result);
      }
      const sharingDecisionMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/sharing\/([^/]+)\/decision$/.exec(req.url)
          : null;
      if (sharingDecisionMatch) {
        const id = decodeURIComponent(sharingDecisionMatch[1]!);
        const grantId = decodeURIComponent(sharingDecisionMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
        const body = ((await readJson(req).catch(() => ({}))) ?? {}) as {
          action?: string;
          reason?: string;
          grantee?: string;
        };
        if (body.action !== 'apply' && body.action !== 'done' && body.action !== 'skip') {
          return sendJson(res, 400, {
            error: 'unknown action',
            hint:
              "A sharing row can be applied ('apply'), ticked off as done by hand " +
              "('done'), or skipped ('skip').",
          });
        }
        const deps = {
          tenantId: m.config.tenantId as TenantId,
          mappingId: m.mailboxMappingId as MappingId,
          ledger,
          // The appliance is operated by one person with the config file in
          // their hands — 'operator' is that person, the run log's word.
          decidedBy: 'operator',
          onError: (msg: string, err: unknown) => log.error(msg, err),
        };
        const outcome =
          body.action === 'apply'
            ? await (async () => {
                const lifecycle = await mappingStatus(m);
                const createShare = nextcloudCapabilityFor(m, body.grantee?.trim() || undefined);
                return applyShareGrant(
                  {
                    ...deps,
                    lifecycleDone: lifecycle === 'done',
                    ...(createShare ? { createShare } : {}),
                  },
                  grantId,
                );
              })()
            : await markShareGrant(
                deps,
                grantId,
                body.action === 'done' ? 'done_manual' : 'skipped',
                body.reason,
              );
        if (!outcome.ok) {
          return sendJson(res, outcome.code === 'not_found' ? 404 : 409, {
            error: outcome.code,
            reason: outcome.reason,
          });
        }
        return sendJson(res, 200, { status: 'ok', grant: outcome.row });
      }
      // The §14.2 permission inventory (workplan 0029 T1/T3/T4). Markdown,
      // same shape and same words as managed (ADR-0026), derived on every
      // read — a permission granted this morning belongs in the report this
      // afternoon, and a stored snapshot goes stale exactly when it matters.
      //
      // Read-only by construction: §14.2's apply step is deferred, so there
      // is no write path here to get wrong.
      const permissionReportMatch =
        req.method === 'GET' && req.url ? /^\/permissions\/report(?:\?(.*))?$/.exec(req.url) : null;
      if (permissionReportMatch) {
        const params = new URLSearchParams(permissionReportMatch[1] ?? '');
        // Either the address directly, or a mapping to resolve it from —
        // the screen knows which migration the operator is looking at, not
        // which mailbox is behind it, and asking somebody to retype their
        // own address is a way to get it wrong. `resolveCoverage` already
        // knows where a mapping's address lives per source kind.
        const askedMappingId = params.get('mappingId')?.trim();
        let mailbox = params.get('mailbox')?.trim();
        if (!mailbox && askedMappingId) {
          const m = mappings.find((x) => x.config.mappingId === askedMappingId);
          if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
          const coverage = resolveCoverage([
            { mappingId: m.config.mappingId, source: m.config.source },
          ]);
          mailbox = coverage.addresses[0];
          if (!mailbox) {
            // An UNSTATED mapping — a Graph source reading /me, whose address
            // the config never records. Said, not guessed (rule 9).
            return sendJson(res, 409, {
              error: 'address_unstated',
              reason:
                'This mapping does not state which mailbox it reads, so its permissions ' +
                'cannot be inventoried. Ask for a mailbox directly: ' +
                '?mailbox=someone@example.com',
            });
          }
        }
        if (!mailbox) {
          return sendJson(res, 400, {
            error: 'missing_mailbox',
            reason:
              'GET /permissions/report?mailbox=someone@example.com ' +
              '(or ?mappingId=… to resolve it from a migration)',
          });
        }
        const delegation = mailboxDelegations();
        const scans = inventoryScansFor(mailbox);

        const markdown = await runPermissionInventory({
          mappingLabel: mailbox,
          generatedOn: new Date().toISOString().slice(0, 10),
          delegationReason:
            delegation.kind === 'not_discoverable' ? delegation.reason : 'not inventoried',
          // Both scans always passed, never omitted: an absent dep falls back
          // to the pass's generic "no reader is configured", and neither of
          // these is unconfigured — each has its own reason, and they differ.
          scanCalendars: scans.scanCalendars,
          scanDrive: scans.scanDrive,
          error: (m, err) => log.error(m, err instanceof Error ? err.message : err),
        });
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
        return res.end(markdown);
      }
      // The Pattern D runbook (workplan 0027 T2). Markdown, not JSON: it is a
      // document a person follows on a target platform this tool cannot
      // reach. Derived on every read, so answering a decision or re-running
      // discovery is reflected without anybody refreshing a snapshot.
      if (req.method === 'GET' && req.url === '/shared-addresses/runbook') {
        const store = new PgGroupDefStore(db);
        const groups = [];
        for (const t of [...new Set(mappings.map((m) => m.config.tenantId))]) {
          groups.push(...(await store.list(t as TenantId)));
        }
        const markdown = renderGroupRunbook({
          groups,
          generatedOn: new Date().toISOString().slice(0, 10),
        });
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
        return res.end(markdown);
      }
      // The §11.1 drift decision queue (workplan 0028 T1). The appliance
      // answers for every configured mapping's tenant, like every queue.
      if (req.method === 'GET' && req.url === '/decisions') {
        const store = new PgDecisionStore(db);
        const tenants = [...new Set(mappings.map((m) => m.config.tenantId))];
        const decisions = [];
        for (const t of tenants) {
          decisions.push(...(await store.list(t as TenantId)));
        }
        return sendJson(res, 200, { decisions });
      }
      // The standing answers (workplan 0028 T5). Same contract as managed
      // (ADR-0026): one operating UI, so the screen calls the same shapes.
      if (req.method === 'GET' && req.url === '/decisions/presets') {
        const store = new PgPolicyPresetStore(db);
        const tenants = [...new Set(mappings.map((m) => m.config.tenantId))];
        const presets = [];
        for (const t of tenants) {
          presets.push(...(await store.list(t as TenantId)));
        }
        // Categories absent are `ask`; said rather than left to be inferred.
        return sendJson(res, 200, { presets, defaultAction: 'ask' });
      }
      const presetSetMatch =
        req.method === 'PUT' && req.url
          ? /^\/decisions\/presets\/([^/]+)$/.exec(req.url)
          : null;
      if (presetSetMatch) {
        const category = decodeURIComponent(presetSetMatch[1]!);
        const body = await readJson(req).catch(() => undefined);
        const action = (body as { action?: unknown } | undefined)?.action;
        if (action !== 'auto' && action !== 'ask') {
          return sendJson(res, 400, {
            error: 'Bad Request',
            message: "action must be 'auto' or 'ask'.",
          });
        }
        const store = new PgPolicyPresetStore(db);
        // Every configured tenant: the appliance's operator speaks for all of
        // them, and a preset that applied to only one would be a surprise on
        // an appliance whose owner thinks of it as one system.
        for (const t of [...new Set(mappings.map((m) => m.config.tenantId))]) {
          await store.set(t as TenantId, category, action);
        }
        return sendJson(res, 200, { category, action });
      }
      const decisionActMatch =
        req.method === 'POST' && req.url
          ? /^\/decisions\/([^/]+)\/(resolve|dismiss)$/.exec(req.url)
          : null;
      if (decisionActMatch) {
        const decisionId = decodeURIComponent(decisionActMatch[1]!);
        const action = decisionActMatch[2] as 'resolve' | 'dismiss';
        let body: unknown;
        try {
          body = await readJson(req);
        } catch (err) {
          return sendJson(res, 400, {
            error: 'invalid_json',
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        const resolution =
          body && typeof body === 'object' && 'resolution' in body
            ? ((body as { resolution: unknown }).resolution as Record<string, unknown>)
            : undefined;
        if (action === 'resolve' && (resolution === undefined || typeof resolution !== 'object')) {
          return sendJson(res, 400, {
            error: 'missing_resolution',
            reason: 'resolve carries the answer: POST { "resolution": { ... } }',
          });
        }
        const store = new PgDecisionStore(db);
        // Single-user edition: no accounts, so the answer is attributed to
        // the appliance's one operator, by name.
        let closed: Awaited<ReturnType<PgDecisionStore['resolve']>>;
        let closedTenant: string | undefined;
        for (const t of [...new Set(mappings.map((m) => m.config.tenantId))]) {
          closed =
            action === 'resolve'
              ? await store.resolve(t as TenantId, decisionId, resolution!, 'appliance-operator')
              : await store.dismiss(t as TenantId, decisionId, 'appliance-operator');
          if (closed) {
            closedTenant = t;
            break;
          }
        }
        // The one category whose answer CHANGES something (workplan 0028 T3),
        // with the same words and the same ordering as managed (ADR-0026):
        // applied only AFTER the resolve succeeded, because the conditional
        // UPDATE is what guarantees exactly one answer wins.
        if (closed! && closedTenant && closed!.category === 'shared_address_pattern' && closed!.subjectKey) {
          const pattern = sharedAddressAnswer(resolution);
          if (pattern) {
            const rows = await new PgGroupDefStore(db).setPattern(
              closedTenant as TenantId,
              closed!.subjectKey,
              pattern,
            );
            if (rows === 0) {
              log.warn(
                `[decisions] answered ${closed!.subjectKey} as ${pattern} but no group_def row matched`,
              );
            }
          }
        }
        if (!closed!) {
          // Same wording as the managed edition (ADR-0026): one contract.
          return sendJson(res, 409, {
            error: 'Conflict',
            message: 'This decision does not exist or has already been answered.',
          });
        }
        return sendJson(res, 200, {
          ...closed!,
          effect: action === 'resolve' ? DECISION_EFFECTS.resolved : DECISION_EFFECTS.dismissed,
        });
      }
      // The migration completion report (workplan 0047): the SAME shared
      // builder the managed route calls (rule 5), on this edition's stores.
      // No `applied` summary — the appliance answers applies synchronously and
      // records them in its run log; the report says so instead of showing
      // zeros that would read as "nothing was ever removed".
      const completionMatch = req.url
        ? /^\/mappings\/([^/]+)\/completion-report$/.exec(req.url)
        : null;
      if (completionMatch && req.method === 'GET') {
        const id = decodeURIComponent(completionMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
        const tId = m.config.tenantId as TenantId;
        const mId = m.mailboxMappingId as MappingId;
        const statuses = await statusStore.getStatus(tId, mId);
        const failures = await ledger.listFailures(tId, mId);
        const report = buildCompletionReport({
          mappingId: m.config.mappingId,
          sourceType: m.config.source.type,
          targetType: m.config.target.type,
          lifecycle: await mappingStatus(m),
          generatedAt: new Date().toISOString(),
          domains: buildDomainStatusReports(statuses, failures),
          moves: await ledger.listMoves(tId, mId),
          deletions: await ledger.listDeletions(tId, mId),
          failures,
          // The checklist's closing state (ADR-0032, 0052 T6b) — same rows
          // the Sharing screen shows, so document and page cannot disagree.
          sharing: (({ applied, doneManual, skipped, open, openManual }) => ({
            applied,
            doneManual,
            skipped,
            open,
            openManual,
          }))(summariseShareGrants(await ledger.listShareGrants(tId, mId))),
        });
        return sendJson(res, 200, {
          report,
          markdown: renderCompletionReportMarkdown(report),
        });
      }
      // Gate 1 of the destructive path, as a readable fact (workplan 0019 T3).
      // The value lives in the mapping's CONFIG FILE on this edition, and
      // `source: 'config'` says so — the same screen that offers a switch on
      // managed renders a read-only note here.
      const applyFlagMatch = req.url
        ? /^\/mappings\/([^/]+)\/apply-deletions$/.exec(req.url)
        : null;
      if (applyFlagMatch && req.method === 'GET') {
        const id = decodeURIComponent(applyFlagMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
        const flag: ApplyDeletionsFlag = {
          allowApplyDeletions: m.config.allowApplyDeletions === true,
          autoApplyRelocations: m.config.autoApplyRelocations === true,
          source: 'config',
        };
        return sendJson(res, 200, flag);
      }
      if (applyFlagMatch && req.method === 'PATCH') {
        // An honest refusal, not a silent 404: the appliance's flag is
        // config-file-owned, and pretending the route does not exist would
        // send somebody hunting for a different URL instead of the file.
        await drain(req);
        return sendJson(res, 405, {
          error: 'config_owned',
          reason:
            "The appliance's flags live in the mapping's config file " +
            '(`allowApplyDeletions`, `autoApplyRelocations`); edit the file and ' +
            'restart the appliance. No API changes them.',
        });
      }
      const deletionMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/deletions\/([^/]+)\/(keep)$/.exec(req.url)
          : null;
      if (deletionMatch) {
        await drain(req);
        const id = decodeURIComponent(deletionMatch[1]!);
        const hash = decodeURIComponent(deletionMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const applied = await ledger.resolveDeletion(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
          hash,
          'keep',
        );
        // False means nothing under that key is CONFIRMED and open — it came
        // back, it is still only being watched, or someone already decided.
        if (!applied) {
          return sendJson(res, 404, {
            error: 'no confirmed, open disappearance under that natural key',
            hint:
              'It may have reappeared on the source, already been acknowledged, or — for an ' +
              'inferred deletion — not yet been missing for ' +
              `${DELETION_CONFIRMATIONS} consecutive scans.`,
          });
        }

        log.info(
          `[selfhost] ${m.config.mappingId}: operator chose 'keep' for vanished item ${hash.slice(0, 12)}`,
        );
        return sendJson(res, 200, {
          status: 'ok',
          action: 'keep',
          naturalKeyHash: hash,
          effect:
            "Acknowledged. The target keeps its copy and this stops being reported unless the " +
            'item reappears on the source and vanishes again.',
        });
      }
      // THE ONE DESTRUCTIVE ROUTE IN THIS API. Everything above it in this file
      // — /failures, /moves, /deletions and their `keep` actions — changes
      // nothing on either side. This removes the target's copy, on an explicit
      // per-item decision, gated by `applyDeletion` in @openmig/core: off unless
      // the mapping opts in (`allowApplyDeletions`), refused for anything but
      // POSITIVE deletion evidence, refused for an item the target owner has
      // since edited, and refused altogether behind the mass-deletion circuit
      // breaker. See the runbook before wiring this into anything automated —
      // it is designed to be used one confirmed item at a time.
      const applyDeletionMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/deletions\/([^/]+)\/(apply)$/.exec(req.url)
          : null;
      if (applyDeletionMatch) {
        await drain(req);
        const id = decodeURIComponent(applyDeletionMatch[1]!);
        const hash = decodeURIComponent(applyDeletionMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const configWithCorrectMappingId = { ...m.config, mappingId: m.mailboxMappingId };
        const outcome = await applyMappingDeletion(configWithCorrectMappingId, hash, ledgerOptions);

        if (!outcome.ok) {
          // Every refusal reason is written to be read verbatim by an operator —
          // see the comment on `ApplyDeletionOutcome` in apply-deletion.ts. 404
          // for "there is nothing here to act on" (not_found, not_confirmed,
          // already_applied); 403 for "this exists but you may not remove it"
          // (everything else — not enabled, weak evidence, not ours, edited,
          // mass-deletion breaker, target incapable).
          // `removed_not_recorded` is neither: the copy IS gone and the ledger
          // would not say so. 404 would tell an operator there was nothing
          // here to act on, which is the opposite of what happened, and 403
          // would say they may not — so it answers 500 with the reason, which
          // is what a state needing a human actually is.
          const status =
            outcome.code === 'removed_not_recorded'
              ? 500
              : outcome.code === 'not_found' ||
                  outcome.code === 'not_confirmed' ||
                  outcome.code === 'already_applied'
                ? 404
                : 403;
          return sendJson(res, status, { error: outcome.code, reason: outcome.reason });
        }

        log.warn(
          `[selfhost] ${m.config.mappingId}: operator applied removal of item ` +
            `${hash.slice(0, 12)} (${outcome.kind}) — the target's copy is gone.`,
        );
        return sendJson(res, 200, {
          status: 'ok',
          action: 'apply',
          naturalKeyHash: hash,
          kind: outcome.kind,
          effect:
            outcome.kind === 'binned'
              ? "Removed from the target. The target's own bin still has it for whatever " +
                'retention window that server keeps — this tool cannot restore it, but the ' +
                'server might still be able to.'
              : 'Removed from the target with no recovery path from here.',
        });
      }
      // THE SECOND DESTRUCTIVE ROUTE (ADR-0030). It removes the target's OLD
      // copy of a file the source moved or renamed — and it is allowed to,
      // where a deletion on the same evidence would not be, because the same
      // bytes are already on the target under the new key. `applyRelocation`
      // re-checks exactly that before touching anything, along with every gate
      // the deletion path has: the per-mapping opt-in (the SAME
      // `allowApplyDeletions` — this is the same capability), the target's
      // ability to remove, ownership, the ETag, and the mass-deletion breaker.
      const applyMoveMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/moves\/([^/]+)\/(apply)$/.exec(req.url)
          : null;
      if (applyMoveMatch) {
        await drain(req);
        const id = decodeURIComponent(applyMoveMatch[1]!);
        const hash = decodeURIComponent(applyMoveMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const configWithCorrectMappingId = { ...m.config, mappingId: m.mailboxMappingId };
        const outcome = await applyMappingRelocation(
          configWithCorrectMappingId,
          hash,
          ledgerOptions,
        );

        if (!outcome.ok) {
          // Same status mapping as the deletion route: 404 for "nothing here to
          // act on", 403 for "this exists but you may not remove it".
          // `not_relocated` is a 404 — an ordinary move genuinely has nothing
          // for this route to act on.
          const status =
            outcome.code === 'removed_not_recorded'
              ? 500
              : outcome.code === 'not_found' ||
                  outcome.code === 'not_confirmed' ||
                  outcome.code === 'already_applied' ||
                  outcome.code === 'not_relocated'
                ? 404
                : 403;
          return sendJson(res, status, { error: outcome.code, reason: outcome.reason });
        }

        log.warn(
          `[selfhost] ${m.config.mappingId}: operator applied relocation of item ` +
            `${hash.slice(0, 12)} (${outcome.kind}) — the old copy is gone and the same bytes ` +
            'remain under the key the source moved it to.',
        );
        return sendJson(res, 200, {
          status: 'ok',
          action: 'apply',
          naturalKeyHash: hash,
          kind: outcome.kind,
          effect:
            'The old copy has been removed from the target. The file itself is still there, ' +
            'under the name and folder the source moved it to — that copy was made before ' +
            'this removal and was checked again just now.' +
            (outcome.kind === 'binned'
              ? " The target's own bin still holds the old copy for whatever retention window " +
                'that server keeps.'
              : ''),
        });
      }
      const moveMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/moves\/([^/]+)\/(keep)$/.exec(req.url)
          : null;
      if (moveMatch) {
        await drain(req);
        const id = decodeURIComponent(moveMatch[1]!);
        const hash = decodeURIComponent(moveMatch[2]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const applied = await ledger.resolveMove(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
          hash,
          'keep',
        );
        // False means no OPEN move under that key — it was moved back on the
        // source, or someone already decided. Saying "not found" beats
        // reporting a decision that did not happen.
        if (!applied) {
          return sendJson(res, 404, {
            error: 'no open move under that natural key',
            hint: 'It may have been moved back on the source, or already been acknowledged.',
          });
        }

        log.info(`[selfhost] ${m.config.mappingId}: operator chose 'keep' for moved item ${hash.slice(0, 12)}`);
        return sendJson(res, 200, {
          status: 'ok',
          action: 'keep',
          naturalKeyHash: hash,
          effect:
            'Acknowledged. Nothing changed on the source or the target; this move stops being ' +
            'reported unless the item moves somewhere else again.',
        });
      }
      const failureMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/failures\/([^/]+)\/(retry|accept)$/.exec(req.url)
          : null;
      if (failureMatch) {
        await drain(req);
        const id = decodeURIComponent(failureMatch[1]!);
        const hash = decodeURIComponent(failureMatch[2]!);
        const action = failureMatch[3] as FailureAction;
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const applied = await ledger.resolveFailure(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
          hash,
          action,
        );
        // False means there is no FAILED row under that key — it succeeded in
        // the meantime, or someone already decided. Saying "not found" beats
        // reporting a decision that did not happen.
        if (!applied) {
          return sendJson(res, 404, {
            error: 'no unresolved failure under that natural key',
            hint: 'It may have succeeded on a later pass, or already been retried or accepted.',
          });
        }

        if (action === 'retry') {
          // A parked item does not hold the cursor back, so by now the source
          // may not be listing it as changed. Cursors are non-authoritative
          // (ADR-0020): dropping them costs one full, still-idempotent re-scan
          // and guarantees the item is put back in front of the loop.
          await cursorStore.clear(m.config.tenantId as TenantId, m.mailboxMappingId as MappingId);
        }

        log.info(`[selfhost] ${m.config.mappingId}: operator chose '${action}' for item ${hash.slice(0, 12)}`);
        return sendJson(res, 200, {
          status: 'ok',
          action,
          naturalKeyHash: hash,
          effect:
            action === 'retry'
              ? 'Attempts reset and cursors cleared; the next scheduled pass will try again.'
              : 'Left behind for good: no further retries, and excluded from the verification gate.',
        });
      }
      // Run history for one mapping (workplan 0026 T3 row 23 -- the runs
      // panel). Same RunReport contract as the managed edition, produced by
      // the ledger's own reader, so the panel shows the same thing wherever
      // it runs. The rows exist because runMapping() above opens one per
      // pass; until this route, the appliance WROTE history nobody could
      // read -- the 2026-08-09 session diagnosed a failed domain from log
      // tails while these rows held the answer.
      const runsMatch =
        req.method === 'GET' && req.url ? /^\/mappings\/([^/]+)\/runs$/.exec(req.url) : null;
      if (runsMatch) {
        const id = decodeURIComponent(runsMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });
        // The ledger keys runs by the mailbox_mapping row id, not the config
        // mappingId -- same translation every other read here makes.
        const { runs, truncated } = await withTenant(
          persistenceBackend.driver,
          m.config.tenantId as string,
          async (tdb) =>
            new RunStore(tdb).listRunsWithEvents(
              m.config.tenantId as TenantId,
              m.mailboxMappingId as MappingId,
            ),
        );
        return sendJson(res, 200, { runs, truncated });
      }
      if (req.method === 'GET' && req.url === '/discovery') {
        const out: Record<string, DiscoveryRecord[]> = {};
        for (const m of mappings) {
          out[m.config.mappingId] = await discoveryStore.getDiscovery(
            m.config.tenantId as TenantId,
            m.mailboxMappingId as MappingId,
          );
        }
        return sendJson(res, 200, out);
      }
      const startMatch = req.method === 'POST' && req.url ? /^\/mappings\/([^/]+)\/start$/.exec(req.url) : null;
      if (startMatch) {
        await drain(req);
        const id = decodeURIComponent(startMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const status = await mappingStatus(m);
        const transition = startTransition(status);
        if ('conflict' in transition) {
          return sendJson(res, 409, { error: transition.conflict });
        }
        if (transition.activate) {
          await withTenantContext(m.config.tenantId as string, async (client) => {
            await client.query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [m.mailboxMappingId]);
          });
          log.info(`[selfhost] ${m.config.mappingId}: activated by operator`);
        }
        scheduleMapping(m);
        // JSON, not the Post/Redirect/Get it used to answer with. That 303 was
        // for the hand-rolled HTML form on the old confirm page; the React
        // screen that replaced it (ADR-0026) calls this with fetch, and a
        // redirect there is silently followed to a page nobody asked for.
        // `activated` distinguishes a first click from an idempotent second one.
        return sendJson(res, 200, {
          status: 'ok',
          action: 'start',
          mappingId: m.config.mappingId,
          activated: transition.activate,
          effect: transition.activate
            ? 'The migration is running. It syncs on its schedule from now on, and will report ' +
              'anything that needs a decision.'
            : 'This migration was already running; nothing changed.',
        });
      }

      // Finish the migration: stop syncing, stop reporting, change nothing.
      //
      // The end of the shadow sync, and the last step of the cutover flow. The
      // mapping goes to 'done' and is unscheduled, so the source stops being
      // watched — no more copying, and no more drift/deletion/move reporting.
      // Everything already on the target stays exactly as it is: this changes
      // what the tool does NEXT, never what it has written.
      //
      // Refused while items are still awaiting a decision in the failure queue,
      // because finishing over those quietly turns "still working on it" into
      // "this is what you got". `?force=true` overrides, and the refusal carries
      // the count so that choice is an informed one.
      const finishMatch =
        req.method === 'POST' && req.url
          ? /^\/mappings\/([^/]+)\/finish(?:\?(.*))?$/.exec(req.url)
          : null;
      if (finishMatch) {
        await drain(req);
        const id = decodeURIComponent(finishMatch[1]!);
        const force = new URLSearchParams(finishMatch[2] ?? '').get('force') === 'true';
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        const status = await mappingStatus(m);
        const failures = await ledger.listFailures(
          m.config.tenantId as TenantId,
          m.mailboxMappingId as MappingId,
        );
        const unresolved = failures.filter((f) => f.needsDecision).length;
        const transition = finishTransition(status, unresolved, force);

        if ('refuse' in transition) {
          return sendJson(res, 409, { error: transition.refuse, hint: transition.hint, code: transition.code });
        }
        if (transition.finish === false) {
          const already: FinishAccepted = {
            status: 'ok',
            action: 'finish',
            alreadyDone: true,
            effect: 'This migration was already finished; nothing changed.',
          };
          return sendJson(res, 200, already);
        }

        await withTenantContext(m.config.tenantId as string, async (client) => {
          await client.query(`UPDATE mailbox_mapping SET status = 'done' WHERE id = $1`, [
            m.mailboxMappingId,
          ]);
        });
        unscheduleMapping(m);
        log.warn(
          `[selfhost] ${m.config.mappingId}: FINISHED by operator — no longer syncing` +
            (unresolved > 0 ? ` (forced over ${unresolved} unresolved failure(s))` : ''),
        );
        // Once, on the real transition: the repeat path above answers
        // `alreadyDone` and returns before reaching here, so finishing twice
        // cannot send twice (0030 T2).
        await tell({ kind: 'migration_finished', mappingId: m.config.mappingId });

        const finished: FinishAccepted = {
          status: 'ok',
          action: 'finish',
          mappingId: m.config.mappingId,
          ...(unresolved > 0 ? { leftUnmigrated: unresolved } : {}),
          effect:
            'The migration is finished. This mapping no longer syncs, and drift, deletions and ' +
            'moves are no longer reported for it. Nothing was added to or removed from the ' +
            'target — what is there now is what stays.',
          ifYouNeedToResume:
            'Remove the mapping from the config directory to retire it for good, or set its ' +
            "mailbox_mapping.status back to 'active' and restart the appliance to resume.",
        };
        return sendJson(res, 200, finished);
      }

      // Run a pass NOW, and answer when it has finished.
      //
      // "Sync now" is a thing operators ask for on its own — after fixing a
      // credential, after resolving a failure, or simply to see the effect of a
      // change without waiting for the cron to come round. It is also what makes
      // the e2e suite bearable: the fixture's schedule is `* * * * *`, so every
      // "wait for the next pass" in a test was up to 60 SECONDS of sleeping, and
      // the two slowest gates are mostly made of those waits.
      //
      // `scheduler.runOnce` is single-flight per mapping id, so this can never
      // start a second concurrent pass: if the cron is already mid-pass, this
      // call joins that one and returns when it finishes. That also means the
      // pass you get back may have STARTED BEFORE your request — a caller that
      // needs a pass which observed a specific change must re-check and, if
      // necessary, ask again. The e2e helpers do exactly that rather than
      // assuming one call is enough.
      const runNowMatch =
        req.method === 'POST' && req.url ? /^\/mappings\/([^/]+)\/run$/.exec(req.url) : null;
      if (runNowMatch) {
        await drain(req);
        const id = decodeURIComponent(runNowMatch[1]!);
        const m = mappings.find((x) => x.config.mappingId === id);
        if (!m) return sendJson(res, 404, { error: 'unknown mapping' });

        // Only an ACTIVE mapping syncs. Refusing here rather than running anyway
        // keeps one rule about when data moves: a paused mapping is awaiting the
        // operator's green light, and a finished one is finished.
        const status = await mappingStatus(m);
        if (status !== 'active') {
          return sendJson(res, 409, {
            error: `mapping is '${status}', not 'active'`,
            hint:
              status === 'paused'
                ? 'Confirm the migration first (POST /mappings/{id}/start).'
                : 'A mapping in cutover or done no longer syncs.',
          });
        }

        const startedAt = Date.now();
        await scheduler.runOnce(m.config.mappingId, runMapping(m));
        return sendJson(res, 200, {
          status: 'ok',
          action: 'run',
          mappingId: m.config.mappingId,
          tookMs: Date.now() - startedAt,
          note:
            'A pass has completed. Because runs are single-flight per mapping, this may have ' +
            'been a pass already in progress when you asked — read /status to see what it did.',
        });
      }
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      // Log it, with the stack, before answering. A failing request used to
      // leave NOTHING in the container logs: the message went into the response
      // body and nowhere else, so the diagnostics artifact — the only thing we
      // get back from a self-hosted run — showed a healthy-looking appliance
      // next to a bare 500. Hard rule 9: the cause has to survive somewhere.
      //
      // The stack stays server-side. Error messages already cross the wire and
      // that is enough to act on; stacks carry filesystem layout, and driver
      // errors can quote a connection string, neither of which belongs in an
      // HTTP body (workplan 0010 T4, secret hygiene).
      log.error(`[selfhost] ${req.method} ${req.url} failed:`, err);
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'internal error',
      });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const boundPort = (server.address() as { port: number }).port;
  log.info(`[selfhost] status server on http://${host}:${boundPort}`);
  // The bind IS the auth boundary (services/edition.ts): off localhost,
  // everything is exposed — the UI and the destructive routes (apply,
  // finish) alike. Deliberate LAN binds are legitimate; silent ones are how
  // an appliance ends up operable by the whole office, so say it at boot.
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    log.warn(
      `[selfhost] bound to ${host}: the appliance has NO authentication — ` +
        `anyone who can reach port ${boundPort} can operate it, including ` +
        `apply and finish. Keep this behind your own firewall.`,
    );
  }

  return {
    port: boundPort,
    notifier,
    stop: () => shutdown(server, handles, persistenceBackend),
  };
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Consume and discard a request body (the start form POSTs no fields we need). */
function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    req.on('data', () => {});
    req.on('end', () => resolve());
    req.on('error', reject);
  });
}

/**
 * Read a JSON request body. The first appliance route to carry one is the
 * decision queue's resolve (0028 T1) — the owner's answer is the payload.
 * An empty body resolves to undefined; malformed JSON rejects, and the
 * caller answers 400 with the parse error verbatim (rule 9).
 */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function shutdown(
  server: Server,
  handles: readonly ScheduleHandle[],
  db: { close: () => Promise<void> },
): Promise<void> {
  // Stop scheduling new passes; single-flight means no pass overlaps, so any
  // in-flight pass runs to completion (persisting its cursors) before we exit.
  for (const h of handles) h.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
}

/**
 * A hint to print next to a startup failure we know the shape of.
 *
 * Only one so far, and it cost a full e2e cycle to diagnose from the raw error:
 * `EACCES … mkdir '/data/state/pglite'`. That message names the path and the
 * syscall and is still not enough, because the cause is not in the container at
 * all — Docker seeds a fresh named volume with the ownership of the image
 * directory it covers, so a volume created by an image that never made
 * `/data/state` comes up owned by root, and the appliance runs as uid 10001.
 *
 * Returns the hint rather than replacing the error, and the caller logs both:
 * a guess that turned out to be wrong must not be the only thing an operator
 * sees (hard rule 9). Anything unrecognised gets nothing, deliberately — a hint
 * for every error is a hint for none.
 */
/**
 * The lost-ledger warning for an ACTIVE mapping with an empty ledger
 * (ADR-0020 / 0026 T1 item 5). Pure so the wording is testable; returns
 * undefined when there is nothing to say. Zero rows on an active mapping is
 * a warning and not an action because it has an innocent cause too — a first
 * pass still running — and the recovery (reindex) belongs to the operator.
 */
export function lostLedgerWarning(mappingId: string, ledgerRows: number): string | undefined {
  if (ledgerRows > 0) return undefined;
  return (
    `${mappingId} is active but its ledger holds ZERO rows. If this install has synced ` +
    'before, the ledger was lost (wiped volume, restored disk) — the ledger is a rebuildable ' +
    'cache (ADR-0020): run the worker CLI\'s `reindex --tenant <t> --mapping <m> --yes` to ' +
    'adopt what the target already holds before the next pass re-copies it. If this mapping ' +
    'has genuinely never completed a pass, this warning is expected and will stop once one has.'
  );
}

export function startupHint(err: unknown): string | undefined {
  const e = err as { code?: string; path?: string } | null;
  if (e?.code !== 'EACCES' || !e.path) return undefined;
  return (
    `The appliance runs as uid 10001 and cannot write to ${e.path}. ` +
    'In Docker, that usually means the volume mounted there is owned by root — ' +
    'which happens when it was created by an image that did not itself create ' +
    'the directory. Recreate the volume (`docker compose down -v`) on a current ' +
    'image, or chown it to 10001:10001.'
  );
}

// CLI entrypoint (skipped when imported by tests).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === `file://${invokedPath}`) {
  start()
    .then((handle) => {
      const graceful = () => {
        log.info('[selfhost] shutting down…');
        handle.stop().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on('SIGTERM', graceful);
      process.on('SIGINT', graceful);
    })
    .catch((err) => {
      log.error('[selfhost] failed to start:', err);
      const hint = startupHint(err);
      if (hint) log.error(`[selfhost] ${hint}`);
      process.exit(1);
    });
}
