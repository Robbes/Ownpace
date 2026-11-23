// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MANAGED EDITION'S JOBS, WORKED ON PG-BOSS (ADR-0054; workplan 0167 T6).
 *
 * The parent process of the worker: it holds the claims, and every run is a
 * process of its own, forked from that job's entry in `./runs/` with V8's
 * heap capped (`runInChild`, from `@openmig/scheduler/pg-boss`). In order:
 *
 * 1. **Start the runner** on the jobs' own URL, in the schema the bring-up
 *    made (`createSchema: false`, `useListenNotify: false`, both the runner's
 *    own), migrating it inside, supervising every 15 s. The runner refuses a
 *    schema at any pg-boss version but the one it was proved on.
 * 2. **Declare the seventeen queues** from the catalog, as it gives them.
 * 3. **Work each queue** with its concurrency: one at a time, the pass
 *    `MAX_PASSES_IN_FLIGHT` and one more; and never more than
 *    `MAX_PASSES_IN_FLIGHT` + 2 runs at once across every queue
 *    (`runsAtOnceFor`), as Trigger.dev's plane admits. A run past either limit
 *    is not fetched and waits in its queue: it neither fails nor spends an
 *    attempt, and no kind of run is put ahead of another. The handler forks the queue's entry
 *    with `{ payload, runId, attempt }` and the run's `signal`, which the
 *    runner aborts on a cancel, a lost claim, or 30 s before the run's time
 *    limit, so a run's process is killed, and reaped, before pg-boss could
 *    start its retry. What the run threw settles it by name: a deliberate stop
 *    (`AbortTaskRunError`, `RunNotRetried`), a payload its schema refused
 *    (`ZodError`), the time limit, the heap and a SIGKILL or SIGABRT the worker
 *    did not send (Trigger.dev's `TASK_PROCESS_MAYBE_OOM_KILLED`) are not
 *    retried; anything else is, and so is a run whose claim lapsed because its
 *    worker died (`settlementFor`).
 * 4. **Register the nine schedules**, in UTC, each sent `{}`: a schedule's
 *    schema is `z.strictObject({})`. A minute missed while no worker ran is
 *    skipped, pg-boss's default, as Trigger.dev skips one.
 *
 * Healthy (`/health` 200) once all of that is done, and from the moment it
 * stops, unhealthy (503) again.
 *
 * ON STOP: no further run is fetched, and a run waiting for a slot stays in
 * its queue for the next worker, as does one claimed as the stop came, given
 * back at its attempt (or run with the runs going, where its queue's policy
 * refuses it back, as pg-boss runs one); the runs already going have
 * `STOP_GRACE_MS` to finish; then each run's process still alive is killed,
 * its run failed to be retried, and the runner stops. Inside the compose
 * service's own grace of 60 s.
 *
 * THIS PROCESS OPENS ONE POOL, THE JOBS SCHEMA'S, AND LOADS NO JOB. Every job
 * module opens its own pools when it is imported, and only the run's own
 * process imports one (`scripts/a-pass-that-opened-the-owners-pool`).
 */

import { createServer, type Server } from 'node:http';
import {
  JOB_CATALOG,
  PgBossJobRunner,
  concurrencyOf,
  runInChild,
  type JobCatalogEntry,
  type JobName,
  type PgBossJobRunnerOptions,
  // The runner's context of a run, not the job's (`../jobs/run-context.ts`), which the entries make.
  type RunContext as RunnerRunContext,
} from '@openmig/scheduler/pg-boss';
import { log } from '@openmig/shared';
import { JOBS_SCHEMA, waitBudgetMs, type PgBossRunInfo } from './pg-boss-context.ts';

/** The entry each queue's run is forked from. Static, so nothing imports a computed name. */
export const RUN_ENTRIES: Readonly<Record<JobName, URL>> = {
  'managed-sync-tick': new URL('./runs/managed-sync-tick.ts', import.meta.url),
  'managed-cadence-email': new URL('./runs/managed-cadence-email.ts', import.meta.url),
  'managed-digest': new URL('./runs/managed-digest.ts', import.meta.url),
  'managed-drift-detect': new URL('./runs/managed-drift-detect.ts', import.meta.url),
  'managed-group-discovery': new URL('./runs/managed-group-discovery.ts', import.meta.url),
  'managed-invoice-push': new URL('./runs/managed-invoice-push.ts', import.meta.url),
  'managed-month-invoices': new URL('./runs/managed-month-invoices.ts', import.meta.url),
  'managed-purge-closed': new URL('./runs/managed-purge-closed.ts', import.meta.url),
  'managed-retention': new URL('./runs/managed-retention.ts', import.meta.url),
  'run-delta-sync': new URL('./runs/run-delta-sync.ts', import.meta.url),
  'run-discovery': new URL('./runs/run-discovery.ts', import.meta.url),
  'run-verification': new URL('./runs/run-verification.ts', import.meta.url),
  'run-confirmation': new URL('./runs/run-confirmation.ts', import.meta.url),
  'run-apply-deletion': new URL('./runs/run-apply-deletion.ts', import.meta.url),
  'run-apply-relocation': new URL('./runs/run-apply-relocation.ts', import.meta.url),
  'run-cutover': new URL('./runs/run-cutover.ts', import.meta.url),
  'run-rollback': new URL('./runs/run-rollback.ts', import.meta.url),
};

/** Where the healthcheck asks, inside the worker's own container only. */
export const HEALTH_HOST = '127.0.0.1';
export const HEALTH_PORT = 3002;

/**
 * How long the runs going at a stop have to finish before their processes are
 * killed, and how long the runner then has to settle them: both inside the
 * compose service's `stop_grace_period` of 60 s, after which Docker kills the
 * container outright.
 */
export const STOP_GRACE_MS = 45_000;
export const STOP_SETTLE_MS = 10_000;

/** The sync tick's default cap on passes in flight (`DEFAULT_MAX_PASSES_IN_FLIGHT` in `managed-sync-tick.ts`). */
export const DEFAULT_MAX_PASSES_IN_FLIGHT = 3;

/**
 * The most runs the worker runs at once, every queue together:
 * `MAX_PASSES_IN_FLIGHT` + 2, the limit Trigger.dev's plane admits on the
 * stack (`deploy/compose/plane-limit.sh`), one slot above the tick's cap for
 * the tick and one for a cutover's final sync. A run past it is not fetched:
 * it waits in its queue, at the attempt it had, and a stop leaves it there.
 * The worker's memory limit is sized for exactly this many runs
 * (`deploy/compose/managed.yml`).
 */
export function runsAtOnceFor(passesInFlight: number): number {
  return passesInFlight + 2;
}

/** `MAX_PASSES_IN_FLIGHT` as the sync tick reads it: blank is the default, anything but a whole number ≥ 1 refused. */
export function passesInFlightFrom(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_PASSES_IN_FLIGHT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `MAX_PASSES_IN_FLIGHT must be a whole number, at least 1 — got ${JSON.stringify(raw)}. ` +
        `Leave it unset for the default of ${DEFAULT_MAX_PASSES_IN_FLIGHT}.`,
    );
  }
  return n;
}

/**
 * Why this process may not start, in one sentence, or null when it may: the
 * switch must name pg-boss, and the jobs' URL must be set. Unset or empty is
 * `trigger`; any other value is refused as the switch's own rule says.
 */
export function refusalToStart(env: NodeJS.ProcessEnv): string | null {
  const raw = env.OWNPACE_JOB_RUNNER?.trim() ?? '';
  const runner = raw === '' ? 'trigger' : raw;
  if (runner !== 'trigger' && runner !== 'pg-boss') {
    return `OWNPACE_JOB_RUNNER is ${JSON.stringify(raw)}, and may only be "trigger" or "pg-boss" (unset or empty is "trigger").`;
  }
  if (runner !== 'pg-boss') {
    return `OWNPACE_JOB_RUNNER is "${runner}", so the jobs run on Trigger.dev and this worker, which runs them on pg-boss, does not start.`;
  }
  if (!env.JOBS_DATABASE_URL?.trim()) {
    return 'JOBS_DATABASE_URL is not set, so this worker has no jobs schema to work; it is the ownpace_jobs role\'s URL, through PgBouncer.';
  }
  return null;
}

export type WorkerState = 'starting' | 'running' | 'stopping' | 'stopped';

/** Whether `/health` answers 200 in this state: only once started, never while starting or stopping. */
export function healthyIn(state: WorkerState): boolean {
  return state === 'running';
}

export interface WorkerOptions {
  readonly connectionString: string;
  readonly passesInFlight: number;
  /** The queues worked; the catalog by default. A test shortens a limit here. */
  readonly catalog?: readonly JobCatalogEntry[];
  /** Each queue's entry; `RUN_ENTRIES` by default. */
  readonly entries?: Readonly<Partial<Record<string, URL>>>;
  /** The runner's intervals, for a test; production takes the runner's own and supervises every 15 s. */
  readonly tuning?: Pick<
    PgBossJobRunnerOptions,
    | 'pollingIntervalSeconds'
    | 'monitorIntervalSeconds'
    | 'superviseIntervalSeconds'
    | 'cronWorkerIntervalSeconds'
    | 'cronMonitorIntervalSeconds'
  >;
  /** Where `/health` listens; null for none (a test that asks `state` itself). */
  readonly health?: { readonly host: string; readonly port: number } | null;
  readonly stopGraceMs?: number;
  readonly stopSettleMs?: number;
}

/** The worker: started once, stopped once. */
export class JobWorker {
  readonly #opts: WorkerOptions;
  readonly #runner: PgBossJobRunner;
  /** Aborted when the stop's grace is spent: every run's process still alive is killed. */
  readonly #shutdown = new AbortController();
  #state: WorkerState = 'starting';
  #health: Server | null = null;
  #stopping: Promise<void> | null = null;
  /** The runs going now, by id, for the stop's line. */
  readonly #going = new Set<string>();

  constructor(opts: WorkerOptions) {
    this.#opts = opts;
    this.#runner = new PgBossJobRunner({
      connectionString: opts.connectionString,
      schema: JOBS_SCHEMA,
      superviseIntervalSeconds: 15,
      runsAtOnce: runsAtOnceFor(opts.passesInFlight),
      ...opts.tuning,
    });
  }

  get state(): WorkerState {
    return this.#state;
  }

  /** The port `/health` listens on, once started; null when it listens nowhere. */
  get healthPort(): number | null {
    const address = this.#health?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  /** The runner, for a test that asks it about a run. */
  get runner(): PgBossJobRunner {
    return this.#runner;
  }

  async start(): Promise<void> {
    const health = this.#opts.health === undefined ? { host: HEALTH_HOST, port: HEALTH_PORT } : this.#opts.health;
    if (health !== null) this.#health = await serveHealth(health.host, health.port, () => healthyIn(this.#state));

    const catalog = this.#opts.catalog ?? JOB_CATALOG;
    const entries: Readonly<Partial<Record<string, URL>>> = this.#opts.entries ?? RUN_ENTRIES;
    // Every queue has its entry before anything is declared: a catalog entry without one is refused whole.
    const missing = catalog.filter((job) => entries[job.name] === undefined).map((job) => job.name);
    if (missing.length > 0) throw new Error(`No run entry for ${missing.join(', ')}: every queue the worker declares is worked.`);

    try {
      await this.#workEvery(catalog, entries);
    } catch (err) {
      // A stop asked for while starting closes the runner under the start, whose next call then
      // fails: that is the stop, not a failure to start.
      if (this.#state !== 'starting') return;
      throw err;
    }
    // A stop asked for while the last call was under way: it stands, and the worker never says it is running.
    if (this.#state !== 'starting') return;
    this.#state = 'running';
    log.info(
      `[worker] working ${catalog.length} queues on pg-boss, passes at once: ` +
        `${this.#opts.passesInFlight} and one for a cutover; runs at once, every queue together: ` +
        `${runsAtOnceFor(this.#opts.passesInFlight)}, the rest waiting in their queues.`,
    );
  }

  async #workEvery(catalog: readonly JobCatalogEntry[], entries: Readonly<Partial<Record<string, URL>>>): Promise<void> {
    await this.#runner.start(catalog);
    for (const job of catalog) {
      if (this.#state !== 'starting') return;
      const entry = entries[job.name]!;
      const concurrency = concurrencyOf(job, this.#opts.passesInFlight);
      await this.#runner.work<unknown, unknown>(
        job.name,
        async (payload: unknown, ctx: RunnerRunContext) => {
          this.#going.add(ctx.runId);
          try {
            // Until when the run may wait for another: counted from here, as the runner counts its kill.
            const run: PgBossRunInfo = {
              queue: ctx.queue,
              runId: ctx.runId,
              attempt: ctx.attempt,
              waitsUntil: Date.now() + waitBudgetMs(job.maxDurationSeconds),
            };
            return await runInChild(entry.href, payload, {
              maxOldSpaceMb: job.maxOldSpaceMb,
              signal: AbortSignal.any([ctx.signal, this.#shutdown.signal]),
              run,
            });
          } finally {
            this.#going.delete(ctx.runId);
          }
        },
        { concurrency },
      );
    }
    for (const job of catalog) {
      if (this.#state !== 'starting') return;
      if (job.kind === 'schedule') await this.#runner.schedule(job.name, job.cron, {});
    }
  }

  /** Stop fetching, give the runs going their grace, kill what is left, stop. */
  stop(): Promise<void> {
    this.#stopping ??= this.#stop();
    return this.#stopping;
  }

  async #stop(): Promise<void> {
    this.#state = 'stopping';
    const grace = this.#opts.stopGraceMs ?? STOP_GRACE_MS;
    const settle = this.#opts.stopSettleMs ?? STOP_SETTLE_MS;
    if (this.#going.size > 0) {
      log.info(`[worker] stopping: ${this.#going.size} run(s) going have ${grace / 1000} s to finish.`);
    }
    const kill = setTimeout(() => {
      if (this.#going.size > 0) {
        log.warn(
          `[worker] stopping: ${this.#going.size} run(s) still going after ${grace / 1000} s, killed to be retried: ` +
            [...this.#going].join(', '),
        );
      }
      this.#shutdown.abort(new Error('The worker is stopping.'));
    }, grace);
    try {
      await this.#runner.stop({ graceful: true, timeoutMs: grace + settle });
    } finally {
      clearTimeout(kill);
      this.#shutdown.abort(new Error('The worker stopped.'));
      this.#state = 'stopped';
      await close(this.#health);
    }
  }
}

/** `GET /health`: 200 while `healthy()`, 503 otherwise; anything else 404. */
export function serveHealth(host: string, port: number, healthy: () => boolean): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const ok = healthy();
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable' }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function close(server: Server | null): Promise<void> {
  if (server === null) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
