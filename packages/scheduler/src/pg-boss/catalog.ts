// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MANAGED EDITION'S JOBS, AS THE RUNNER DECLARES THEM (ADR-0054; workplan
 * 0167 T6).
 *
 * Seventeen queues, one for each Trigger.dev task under `apps/worker/src/jobs`
 * and named by the task's id, so a run goes by the same name on either runner:
 * nine schedules and eight jobs somebody asks for. Each entry says how its runs
 * are admitted, retried, timed, kept alive, capped and worked.
 *
 * - **Admitted.** A schedule's queue is `stately`, one run waiting and one
 *   running at most, so a schedule never overlaps itself (0167, point 6). A
 *   pass and a count are `singleton`, one running per migration (point 1):
 *   Trigger.dev's `concurrencyLimit: 1` with the `concurrencyKey: mappingId`
 *   every caller passes. A confirmation is `singleton` by the key its route
 *   passes, `confirm:<mappingId>`, which serialises nothing on Trigger.dev,
 *   whose queue for it has no limit; stricter here, and it costs nothing, since
 *   the route joins a confirmation already running before it asks for another.
 *   The rest are `standard`.
 * - **Retried and timed** as `apps/worker/trigger.config.ts` retries and times
 *   every task, none of which sets its own: three attempts, the first retry
 *   5 s after a failure and each after it twice as long, never longer than
 *   60 s (pg-boss adds up to as much again at random), and an hour a run. The
 *   hour is the pass's hard limit, `PASS_HARD_LIMIT_MS`, which its soft
 *   deadline stops short of (`scripts/a-pass-that-outlives-its-runner`).
 *   **But the cutover: three hours.** Trigger.dev 4.8.8 counts `maxDuration`
 *   on a run's CPU time, its wall time less its pauses, and a
 *   `triggerAndWait` is a pause (`usage.pauseAsync`). A cutover's preparation
 *   waits for a pass already running on its migration, then for its own final
 *   sync, then runs the gate; pg-boss's limit is the wall clock, and a run
 *   that reaches it is not retried, so one hour each.
 * - **Kept alive** by a beat every 30 s: a run whose worker stops beating is
 *   failed and retried (point 2).
 * - **Capped** at a heap of 410 MB a run, V8's share of the `small-1x`
 *   machine every task runs on, half a CPU and 512 MB (point 8). The CPU is
 *   the worker container's to cap.
 * - **Worked** one run at a time on each worker, except the pass: the sync
 *   tick's cap on passes in flight, `MAX_PASSES_IN_FLIGHT`, and one more, for
 *   the pass a cutover waits on, as the plane keeps a slot above the cap for
 *   it (`deploy/compose/plane-limit.sh`). How often an idle worker asks for
 *   work is the runner's, one interval for every queue.
 *
 * THE WORKER'S LIMIT ON RUNS AT ONCE (alpha.17; ADR-0054, 0167). Each queue
 * above has its own concurrency, which adds up to `MAX_PASSES_IN_FLIGHT` + 17.
 * The worker also holds every queue together to `MAX_PASSES_IN_FLIGHT` + 2
 * runs at once, the plane's limit (`plane-limit.sh`), counted before each
 * fetch (`./run-slots.ts`): a run past it waits in its queue, as a run past
 * the plane's limit stays queued, and the queues take turns at a slot that
 * frees.
 *
 * NOT TRIGGER.DEV'S CONCURRENCY, AND KNOWN NOT TO BE (ADR-0054, 0167).
 *  - **One of each job asked for at a time, across every organisation.**
 *    Trigger.dev runs one count per migration and counts of different
 *    migrations side by side, and puts no limit on verification,
 *    confirmation, the two applies, the cutover and the rollback. Here each of
 *    those queues is worked one run at a time on the one worker: a second
 *    organisation's count, or a second cutover, waits for the first.
 *
 * DATA ONLY. It imports nothing, so whoever reads it loads no pg-boss. Each
 * entry is a `QueueSpec` as `PgBossJobRunner#start` takes it, with what a
 * worker needs besides to work the queue. The tasks are held to it from their
 * source, ids, crons, keys, retries and time limit
 * (`apps/worker/src/jobs/the-catalog-is-the-tasks.unit.test.ts`).
 *
 * The worker reads it at start (`apps/worker/src/runner/worker.ts`), in
 * pg-boss mode, `managed.yml`'s default since workplan 0167 T7.
 */

/** What every run of every queue gets, as `trigger.config.ts` gives every task. */
interface EveryRun {
  /** Attempts in all, the first included. */
  readonly attempts: number;
  /** How long after a failure the first retry waits; each retry after it waits twice as long. */
  readonly retryDelaySeconds: number;
  /** No retry waits longer than this. */
  readonly retryDelayMaxSeconds: number;
  /** A run's time limit: pg-boss's `expireInSeconds`. */
  readonly maxDurationSeconds: number;
  /** A run whose worker stops beating for this long is failed and retried. */
  readonly heartbeatSeconds: number;
  /** V8's old-space cap for a run's process, in MB: `runInChild`'s `maxOldSpaceMb`. */
  readonly maxOldSpaceMb: number;
}

interface EveryQueue extends EveryRun {
  /** The queue's name, which is its Trigger.dev task's id. */
  readonly name: string;
  /**
   * How many of its runs one worker works at once: a number, or the sync
   * tick's cap on passes in flight and so many more (see {@link concurrencyOf}).
   */
  readonly concurrency: number | { readonly passesInFlightPlus: number };
}

/** A schedule: a run sent on its cron, read in UTC, onto a queue that holds one waiting and one running. */
export interface ScheduledJob extends EveryQueue {
  readonly kind: 'schedule';
  readonly cron: string;
  readonly policy: 'stately';
}

/** A job somebody asks for: the API, the sync tick, a cutover, the operator. */
export interface OnDemandJob extends EveryQueue {
  readonly kind: 'on-demand';
  readonly policy: 'singleton' | 'standard';
  /**
   * A `singleton` queue's key: what each caller passes as `serializeBy`, and
   * passes to Trigger.dev as `concurrencyKey`, the migration's id after a
   * prefix or none.
   */
  readonly serializedBy?: '<mappingId>' | `${string}:<mappingId>`;
}

export type JobCatalogEntry = ScheduledJob | OnDemandJob;

const EVERY_RUN = {
  attempts: 3,
  retryDelaySeconds: 5,
  retryDelayMaxSeconds: 60,
  maxDurationSeconds: 3600,
  heartbeatSeconds: 30,
  maxOldSpaceMb: 410,
} as const satisfies EveryRun;

const HOURLY_OR_DAILY = { ...EVERY_RUN, kind: 'schedule', policy: 'stately', concurrency: 1 } as const;

const ASKED_FOR = { ...EVERY_RUN, kind: 'on-demand', concurrency: 1 } as const;

/**
 * The cutover's limit: a pass running ahead of it, its own final sync, and the
 * gate, an hour each. On Trigger.dev its waits for the passes were pauses,
 * which `maxDuration` does not count; pg-boss counts the wall clock.
 */
const CUTOVER_MAX_DURATION_SECONDS = 3 * EVERY_RUN.maxDurationSeconds;

/** Every queue the managed edition's jobs run on, the nine schedules first. */
export const JOB_CATALOG = [
  { ...HOURLY_OR_DAILY, name: 'managed-sync-tick', cron: '* * * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-cadence-email', cron: '30 7 * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-digest', cron: '0 8 * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-drift-detect', cron: '0 7 * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-group-discovery', cron: '30 6 * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-invoice-push', cron: '41 * * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-month-invoices', cron: '23 * * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-purge-closed', cron: '23 * * * *' },
  { ...HOURLY_OR_DAILY, name: 'managed-retention', cron: '17 3 * * *' },
  {
    ...ASKED_FOR,
    name: 'run-delta-sync',
    policy: 'singleton',
    serializedBy: '<mappingId>',
    concurrency: { passesInFlightPlus: 1 },
  },
  { ...ASKED_FOR, name: 'run-discovery', policy: 'singleton', serializedBy: '<mappingId>' },
  { ...ASKED_FOR, name: 'run-verification', policy: 'standard' },
  { ...ASKED_FOR, name: 'run-confirmation', policy: 'singleton', serializedBy: 'confirm:<mappingId>' },
  { ...ASKED_FOR, name: 'run-apply-deletion', policy: 'standard' },
  { ...ASKED_FOR, name: 'run-apply-relocation', policy: 'standard' },
  { ...ASKED_FOR, name: 'run-cutover', policy: 'standard', maxDurationSeconds: CUTOVER_MAX_DURATION_SECONDS },
  { ...ASKED_FOR, name: 'run-rollback', policy: 'standard' },
] as const satisfies readonly JobCatalogEntry[];

/** A queue's name, which is its Trigger.dev task's id. */
export type JobName = (typeof JOB_CATALOG)[number]['name'];

/**
 * How many of a queue's runs one worker works at once, on a stack whose
 * `MAX_PASSES_IN_FLIGHT` is `passesInFlight`: a whole number, at least 1, as
 * the sync tick reads it.
 */
export function concurrencyOf(job: JobCatalogEntry, passesInFlight: number): number {
  if (!Number.isInteger(passesInFlight) || passesInFlight < 1) {
    throw new RangeError(`MAX_PASSES_IN_FLIGHT must be a whole number, at least 1, and was given as ${String(passesInFlight)}.`);
  }
  return typeof job.concurrency === 'number' ? job.concurrency : passesInFlight + job.concurrency.passesInFlightPlus;
}
