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
import { runMigrations, createPgDb, createPgliteDb, pgDriver, PgMigrationStatusStore, PgDiscoveryStore, PgDecisionStore, PgLedger, PgCursorStore, RunStore, withTenant } from '@openmig/ledger';
// Import the in-process scheduler directly (NOT the package index, which
// re-exports the Trigger.dev client) so self-host never loads managed code —
// hard rule 5.
import { InProcessScheduler } from '@openmig/scheduler/in-process';
import { runAllDomains, discoverAllDomains, verifyMapping, applyMappingDeletion } from '@openmig/worker/orchestration';
import { SCOPE_MANIFEST, DELETION_CONFIRMATIONS } from '@openmig/shared';
// The operating contract (ADR-0026): the queue shapes and the operator-facing
// prose that goes with them, shared with the UI and the managed edition so the
// three cannot drift apart in the explanations that stop somebody destroying
// data by accident.
import {
  MAPPING_LIFECYCLES,
  REPORTING_CLOSED,
  FAILURE_GUIDANCE,
  MOVES_MEANING,
  MOVE_GUIDANCE,
  DELETIONS_MEANING,
  DELETION_GUIDANCE,
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
import { loadConfigDir, type LoadedMapping } from './config-dir';
import { buildStatusReport, type MappingStatusInput } from './status';
import { startTransition, finishTransition } from './lifecycle';
import { serveUi, UI_MOUNT } from './static-ui';
import { createVerifyRunner } from './verify-run';
import { log } from '@openmig/shared';
import { renderMetrics, METRICS_CONTENT_TYPE } from '@openmig/shared';
import {
  readNotifierConfig,
  createNotifier,
  disabledNotifier,
  createFailureStreakGate,
  renderEvent,
  type Notifier,
  type NotificationEvent,
} from '@openmig/shared';
import { smtpTransport } from '@openmig/connectors';

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

// UUID generation for selfhost (deterministic based on input for idempotency)
function uuidFromString(seed: string): string {
  const hash = Buffer.from(seed).toString('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

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
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      // 0013 T7: created PAUSED (draft) — only scheduled after the operator confirms in the UI.
      [mailboxMappingId, tenantId, sourceMailboxId, targetMailboxId, 'mirror', 'paused']
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
  const notifierConfig = readNotifierConfig(process.env);
  const notifier: Notifier = notifierConfig.enabled
    ? createNotifier(smtpTransport(notifierConfig.smtp), notifierConfig.settings)
    : disabledNotifier(notifierConfig.reason, (m) => log.warn(m));
  log.info(
    notifierConfig.enabled
      ? `[selfhost] notifications: ON → ${notifierConfig.settings.to.join(', ')} ` +
          `(${notifierConfig.settings.locale ?? 'en'}, via ${notifierConfig.smtp.host}:${notifierConfig.smtp.port})`
      : `[selfhost] notifications: OFF — ${notifierConfig.reason}`,
  );

  /** One outage, one email — never one per failed pass (0030 T2). */
  const failureStreak = createFailureStreakGate();
  const notifyLocale = notifierConfig.enabled ? (notifierConfig.settings.locale ?? 'en') : 'en';

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

      if (runId) {
        const id = runId;
        const failures = results.filter((r) => r.error);
        try {
          await withTenant(persistenceBackend.driver, tenantId, async (tdb) => {
            const runs = new RunStore(tdb);
            for (const r of results) {
              // Failures carry the real message verbatim (hard rule 9).
              if (r.error) {
                await runs.logEvent(tenantId, id, 'error', `${r.domain} sync failed: ${r.error}`, { domain: r.domain });
              } else {
                await runs.logEvent(tenantId, id, 'info',
                  `${r.domain}: ${r.created} created, ${r.skipped} skipped`,
                  { domain: r.domain, created: r.created, skipped: r.skipped });
              }
            }
            await runs.finishRun(id, failures.length > 0 && failures.length === results.length ? 'failed' : 'succeeded', {
              itemsProcessed: results.reduce((n, r) => n + r.created + r.skipped, 0),
              errors: failures.length,
            });
          });
        } catch (err) {
          log.error(`[selfhost] ${m.config.mappingId}: failed to close run row:`, err instanceof Error ? err.message : err);
        }
      }

      log.info(`[selfhost] ${m.config.mappingId}: pass complete (${created} created)`);

      // A pass in which EVERY domain failed is the mapping failing, and the
      // same definition the run row uses — a partly failed pass is per-item
      // trouble that the queues already report to a person. The gate makes
      // this one email per outage rather than one per minute (0030 T2).
      const allFailed = results.length > 0 && results.every((r) => r.error);
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
        return sendJson(res, 200, buildStatusReport(inputs));
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
      // The §11.1 drift decision queue (workplan 0028 T1). The appliance
      // answers for every configured mapping's tenant, like every queue. No
      // detector exists yet, so an empty list here means "nothing can raise
      // decisions yet" — the screen's empty state says so (rule 9), not
      // "no drift".
      if (req.method === 'GET' && req.url === '/decisions') {
        const store = new PgDecisionStore(db);
        const tenants = [...new Set(mappings.map((m) => m.config.tenantId))];
        const decisions = [];
        for (const t of tenants) {
          decisions.push(...(await store.list(t as TenantId)));
        }
        return sendJson(res, 200, { decisions });
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
        for (const t of [...new Set(mappings.map((m) => m.config.tenantId))]) {
          closed =
            action === 'resolve'
              ? await store.resolve(t as TenantId, decisionId, resolution!, 'appliance-operator')
              : await store.dismiss(t as TenantId, decisionId, 'appliance-operator');
          if (closed) break;
        }
        if (!closed!) {
          // Same wording as the managed edition (ADR-0026): one contract.
          return sendJson(res, 409, {
            error: 'Conflict',
            message: 'This decision does not exist or has already been answered.',
          });
        }
        return sendJson(res, 200, closed!);
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
            "The appliance's flag lives in the mapping's config file " +
            '(`allowApplyDeletions`); edit the file and restart the appliance. ' +
            'No API changes it.',
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
          const status =
            outcome.code === 'not_found' ||
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
          return sendJson(res, 409, { error: transition.refuse, hint: transition.hint });
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
