// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Managed edition scheduler entrypoint (workplan 0011 T7).
 *
 * The Trigger.dev v4 tasks under `src/jobs/*` are the intended long-term
 * execution path, but registering them requires a `trigger.config.ts` plus a
 * `trigger deploy` step against a live Trigger.dev instance — neither exists
 * in this repo yet, so those tasks are currently unreachable/undeployed.
 * `src/index.ts` (the CLI worker entrypoint) is not a substitute either: it
 * requires a single `--config <mapping.json>` file and models one file-driven
 * mapping, which is the self-host shape, not the managed edition's per-tenant
 * DB-row model.
 *
 * This entrypoint is the pragmatic interim: a long-running, multi-tenant
 * process that polls `mailbox_mapping` for `status = 'active'` rows across
 * ALL tenants (the owner `DATABASE_URL` connection bypasses RLS for this
 * trusted, system-level enumeration — the same trust boundary self-host's
 * `withTenantContext` relies on for its own single tenant), reads
 * `scope_selection` for each mapping's enabled domains, and schedules a
 * recurring sync tick with the in-process croner scheduler. Each tick reuses
 * the already-proven, RLS-enforced, credential-decrypting deps builders
 * (`buildDepsFromMapping` / `buildDomainDepsFromMapping`) and sync functions
 * that the Trigger.dev job definitions already use — see
 * `src/jobs/run-delta-sync.ts` for the per-domain template this mirrors.
 *
 * A failed domain is logged and marked failed in migration_status (hard rule
 * 9 — surfaced, never swallowed) but does not block other domains for the
 * same mapping, nor other mappings: this is a long-running process serving
 * every active tenant, so one tenant's broken credentials must never stop
 * the loop.
 *
 * NOT verified against a live Docker/Postgres stack from this sandbox (no
 * Docker daemon available here) — typecheck/lint only. See
 * docs/workplans/0011-managed-edition-hardening.md T7 status for what is and
 * isn't confirmed.
 */

import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import {
  withTenant,
  PgMigrationStatusStore,
  recordComputeForRun,
  recordApiCallForRun,
  runMigrations,
  RunStore,
} from '@openmig/ledger';
import { InProcessScheduler } from '@openmig/scheduler/in-process';
import { runShadowPass, runCalendarSync, runContactSync, runFileSync } from '@openmig/core';
import type { TenantId, MappingId, ScheduleHandle } from '@openmig/shared';
import { buildDepsFromMapping, buildDomainDepsFromMapping } from './build-deps-from-mapping';
import { log } from '@openmig/shared';

const DEFAULT_SCHEDULE = '*/15 * * * *'; // every 15 minutes if a mapping omits one
const DEFAULT_POLL_INTERVAL_MS = 60_000; // re-check mailbox_mapping.status every minute

// Pricing configuration (mirrors run-delta-sync.ts; should come from config/env in production).
const PRICING = { computePricePerHour: 5 }; // €0.05/hour

type Domain = 'email' | 'calendar' | 'contact' | 'file';

interface ActiveMapping {
  readonly id: string;
  readonly tenantId: string;
  readonly schedule: string | null;
}

/** Current billing period dates (mirrors run-delta-sync.ts). */
function getCurrentPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

  return { periodStart, periodEnd };
}

/**
 * All mappings currently 'active', across every tenant. Deliberately bypasses
 * RLS (owner connection, no tenant context set) — this is a trusted,
 * system-level enumeration, never exposed to a tenant-scoped request.
 */
async function loadActiveMappings(pool: Pool): Promise<ActiveMapping[]> {
  const { rows } = await pool.query<{ id: string; tenant_id: string; schedule: string | null }>(
    `SELECT id, tenant_id, schedule FROM mailbox_mapping WHERE status = 'active'`,
  );
  return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, schedule: r.schedule }));
}

/**
 * Domains selected for a mapping (scope_selection rows with included=true).
 * The create-mapping API only inserts rows for domains the tenant selected —
 * no row means "not selected", so an empty result means the mapping has no
 * work to do (not "default to everything").
 */
async function loadEnabledDomains(pool: Pool, tenantId: string, mappingId: string): Promise<Domain[]> {
  const { rows } = await pool.query<{ domain: Domain }>(
    `SELECT domain FROM scope_selection WHERE tenant_id = $1 AND mapping_id = $2 AND included = true`,
    [tenantId, mappingId],
  );
  return rows.map((r) => r.domain);
}

/** Build deps, run the domain's sync, and track migration_status (mirrors orchestration.ts's
 * runAllDomains -- initDomainStatus is the only INSERT; markInProgress/markCompleted/markFailed
 * are plain UPDATEs that silently no-op without it, for every domain including email. Confirmed
 * live: before this fix, GET /:mappingId's domainStatus came back empty for both demo tenants
 * despite real sync activity in the worker logs -- initDomainStatus was never called anywhere in
 * this file. */
async function runDomain(
  pool: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: Domain,
): Promise<{ created: number; skipped: number }> {
  await withTenant(pool, tenantId, async (db) => {
    const statusStore = new PgMigrationStatusStore(db);
    await statusStore.initDomainStatus(tenantId, mappingId, domain);
    await statusStore.markInProgress(tenantId, mappingId, domain);
  });
  try {
    let result: { created: number; skipped: number };
    if (domain === 'email') {
      const deps = await buildDepsFromMapping(pool, tenantId, mappingId);
      try {
        result = await runShadowPass(deps);
      } finally {
        await deps.close();
      }
    } else if (domain === 'calendar') {
      const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'calendar');
      try {
        result = await runCalendarSync(deps);
      } finally {
        await deps.close();
      }
    } else if (domain === 'contact') {
      const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'contact');
      try {
        result = await runContactSync(deps);
      } finally {
        await deps.close();
      }
    } else {
      const deps = await buildDomainDepsFromMapping(pool, tenantId, mappingId, 'file');
      try {
        result = await runFileSync(deps);
      } finally {
        await deps.close();
      }
    }
    await withTenant(pool, tenantId, async (db) => {
      await new PgMigrationStatusStore(db).markCompleted(tenantId, mappingId, domain);
    });
    log.info(`[managed-scheduler] ${mappingId}/${domain}: ${result.created} created, ${result.skipped} skipped`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    try {
      await withTenant(pool, tenantId, async (db) => {
        await new PgMigrationStatusStore(db).markFailed(tenantId, mappingId, domain, message);
      });
    } catch (statusErr) {
      log.error(`[managed-scheduler] ${mappingId}/${domain}: failed to mark status failed:`, statusErr);
    }
    throw err;
  }
}

/** Compute + API-call metering for a completed domain run (mirrors run-delta-sync.ts). */
/**
 * Append a run event, best-effort. The run log is bookkeeping: a failure to
 * write it must never abort or fail the sync pass it is describing.
 */
async function logRunEvent(
  pool: Pool,
  tenantId: TenantId,
  runId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await withTenant(pool, tenantId, async (db) => {
      await new RunStore(db).logEvent(tenantId, runId, level, message, detail);
    });
  } catch (err) {
    log.error('[managed-scheduler] failed to write run event:', err instanceof Error ? err.message : err);
  }
}

async function recordMetering(
  pool: Pool,
  tenantId: TenantId,
  mappingId: MappingId,
  domain: Domain,
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  await withTenant(pool, tenantId, async (db) => {
    const statusStore = new PgMigrationStatusStore(db);
    const statusList = await statusStore.getStatus(tenantId, mappingId);
    const domainStatus = statusList.find((s) => s.domain === domain);
    if (domainStatus && domainStatus.completedAt) {
      await recordComputeForRun(
        db,
        {
          tenantId,
          mappingId,
          domain,
          startedAt: new Date(domainStatus.startedAt),
          completedAt: new Date(domainStatus.completedAt),
          periodStart,
          periodEnd,
        },
        PRICING,
      );
      await recordApiCallForRun(db, { tenantId, mappingId, domain, periodStart, periodEnd });
    }
  });
}

/** One scheduled tick for a mapping: run every enabled domain, independently. */
function runMapping(pool: Pool, mapping: ActiveMapping) {
  return async () => {
    const { id: mappingId, tenantId } = mapping;
    log.info(`[managed-scheduler] ${mappingId}: starting pass...`);

    let domains: Domain[];
    try {
      domains = await loadEnabledDomains(pool, tenantId, mappingId);
    } catch (err) {
      log.error(
        `[managed-scheduler] ${mappingId}: failed to load scope selection:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }
    if (domains.length === 0) {
      log.info(`[managed-scheduler] ${mappingId}: no domains selected, skipping`);
      return;
    }

    const { periodStart, periodEnd } = getCurrentPeriod();

    // One `run` row per pass, so run history reflects what actually executed.
    // Opened before the first domain so a crashed pass leaves a `running` row
    // rather than no trace at all. Bookkeeping is best-effort throughout: it
    // must never abort the sync pass it describes.
    let runId: string | null = null;
    try {
      runId = await withTenant(pool, tenantId as TenantId, async (db) =>
        new RunStore(db).startRun({
          tenantId: tenantId as TenantId,
          mappingId: mappingId as MappingId,
          kind: 'incremental',
          trigger: 'schedule',
        }),
      );
    } catch (err) {
      log.error(`[managed-scheduler] ${mappingId}: failed to open run row:`, err instanceof Error ? err.message : err);
    }

    let itemsProcessed = 0;
    let errors = 0;

    for (const domain of domains) {
      try {
        const result = await runDomain(pool, tenantId as TenantId, mappingId as MappingId, domain);
        itemsProcessed += result.created + result.skipped;
        await recordMetering(pool, tenantId as TenantId, mappingId as MappingId, domain, periodStart, periodEnd);
        if (runId) {
          await logRunEvent(pool, tenantId as TenantId, runId, 'info',
            `${domain}: ${result.created} created, ${result.skipped} skipped`,
            { domain, created: result.created, skipped: result.skipped });
        }
      } catch (err) {
        // Surfaced (logged + marked failed inside runDomain); never rethrown here —
        // this is a long-running loop serving every tenant, so one tenant's
        // failing domain must not stop the others (hard rule 9: surface, don't crash).
        const message = err instanceof Error ? err.message : String(err);
        errors += 1;
        log.error(`[managed-scheduler] ${mappingId}/${domain}: sync failed:`, message);
        if (runId) {
          await logRunEvent(pool, tenantId as TenantId, runId, 'error', `${domain} sync failed: ${message}`, { domain });
        }
      }
    }

    if (runId) {
      const id = runId;
      try {
        await withTenant(pool, tenantId as TenantId, async (db) => {
          // A pass where every domain failed is a failed run; a partial failure
          // still records its error count so the UI shows it.
          await new RunStore(db).finishRun(id, errors >= domains.length ? 'failed' : 'succeeded', {
            itemsProcessed,
            errors,
          });
        });
      } catch (err) {
        log.error(`[managed-scheduler] ${mappingId}: failed to close run row:`, err instanceof Error ? err.message : err);
      }
    }

    log.info(`[managed-scheduler] ${mappingId}: pass complete`);
  };
}

/**
 * Reconcile the scheduled set against the current `active` mappings: schedule
 * newly-active mappings, unschedule ones that are no longer active (paused,
 * cutover, done, or deleted). Idempotent — safe to call on every poll tick.
 */
async function reconcileSchedules(
  pool: Pool,
  scheduler: InProcessScheduler,
  scheduled: Map<string, ScheduleHandle>,
): Promise<void> {
  const active = await loadActiveMappings(pool);
  const activeById = new Map(active.map((m) => [m.id, m]));

  for (const [mappingId, handle] of scheduled) {
    if (!activeById.has(mappingId)) {
      handle.stop();
      scheduled.delete(mappingId);
      log.info(`[managed-scheduler] ${mappingId}: no longer active, unscheduled`);
    }
  }

  for (const mapping of active) {
    if (scheduled.has(mapping.id)) continue;
    const cron = mapping.schedule ?? DEFAULT_SCHEDULE;
    const handle = scheduler.schedule(mapping.id, cron, runMapping(pool, mapping));
    scheduled.set(mapping.id, handle);
    log.info(`[managed-scheduler] ${mapping.id}: scheduled (${cron})`);
  }
}

export interface ManagedSchedulerOptions {
  readonly databaseUrl?: string;
  readonly port?: number;
  readonly host?: string;
  readonly pollIntervalMs?: number;
}

export interface ManagedSchedulerHandle {
  readonly port: number;
  stop(): Promise<void>;
}

/** Start the managed scheduler. Returns a handle for graceful shutdown (used by tests too). */
export async function start(options: ManagedSchedulerOptions = {}): Promise<ManagedSchedulerHandle> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const port = options.port ?? Number(process.env.PORT ?? 8082);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  // Self-migrate first, same as apps/api and apps/selfhost -- this process has no
  // depends_on ordering against api in managed.yml (only postgres/trigger-api), so it can
  // race api for who migrates first. migrate.ts's advisory lock + idempotent re-run makes
  // that race safe either way.
  await runMigrations({ connectionString: databaseUrl });

  const pool = new Pool({ connectionString: databaseUrl });
  const scheduler = new InProcessScheduler();
  const scheduled = new Map<string, ScheduleHandle>();

  await reconcileSchedules(pool, scheduler, scheduled);
  const pollTimer = setInterval(() => {
    reconcileSchedules(pool, scheduler, scheduled).catch((err) => {
      log.error('[managed-scheduler] reconcile failed:', err instanceof Error ? err.message : err);
    });
  }, pollIntervalMs);

  const server: Server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', scheduled: scheduled.size }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const boundPort = (server.address() as { port: number }).port;
  log.info(`[managed-scheduler] listening on http://${host}:${boundPort}, polling every ${pollIntervalMs}ms`);

  return {
    port: boundPort,
    stop: async () => {
      clearInterval(pollTimer);
      for (const handle of scheduled.values()) handle.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  };
}

// CLI entrypoint (skipped when imported by tests).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === `file://${invokedPath}`) {
  start()
    .then((handle) => {
      const graceful = () => {
        log.info('[managed-scheduler] shutting down…');
        handle.stop().then(() => process.exit(0)).catch(() => process.exit(1));
      };
      process.on('SIGTERM', graceful);
      process.on('SIGINT', graceful);
    })
    .catch((err) => {
      log.error('[managed-scheduler] failed to start:', err);
      process.exit(1);
    });
}
