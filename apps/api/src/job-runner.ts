// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE RUNNER THIS API HANDS ITS JOBS TO (workplan 0167 T6 and T9; ADR-0054).
 *
 * pg-boss, the only one since alpha.18, which removed Trigger.dev. The switch
 * `OWNPACE_JOB_RUNNER` keeps a reader so an old `.env` fails loudly rather
 * than silently: unset, empty or `pg-boss` runs; `trigger` is refused with one
 * sentence, {@link TRIGGER_REMOVED}; any other value is refused as before. The
 * API reads it at its start, so a refused value stops the start, and wherever
 * it is read after. It reads it here, not from `@openmig/scheduler`, so the
 * test files that mock that package with a bare factory need no new export.
 *
 * ## The producer
 *
 * One per API process, `PgBossProducer` from the runner (#2040), declared with
 * the catalog's seventeen queues and connected on `JOBS_DATABASE_URL`, the role
 * `ownpace_jobs` through PgBouncer, never the owner's URL. It is imported
 * dynamically, on the first enqueue or cancel, so a module that only reads the
 * switch loads no pg-boss (`a-runner-the-api-does-not-load`). It enqueues,
 * reads and cancels, and never migrates, supervises or fires a schedule: the
 * worker does those. The URL is read once, when the producer is made, and
 * never logged; unset, the first enqueue is refused with one sentence, and the
 * door lands that on its row as it lands any failed enqueue. A producer whose
 * start failed (the worker never installed the schema) is closed and
 * forgotten, so the next press tries again rather than failing for the life of
 * the process. It is closed when the process is asked to stop, and the signal
 * then does what it would have done.
 *
 * ## Cancelling by a run's ref
 *
 * `cancelRun(ref)` is what the close hands `closeAccount`. A run's
 * `orchestrator_ref` is a pg-boss job id (a UUID); a ref of another shape
 * (Trigger.dev's `run_…`, from before alpha.16) is a clear error, which the
 * close logs and leaves to the erasure quiesce. A ref whose job is gone, or
 * settled already, reads as finished, and a log line says so.
 */

import type { PgBossProducer } from '@openmig/scheduler/pg-boss';
import { log } from '@openmig/shared';

export type JobRunnerName = 'pg-boss';

/** pg-boss's schema in the ledger's database, made by the managed bring-up (ADR-0054). */
export const JOBS_SCHEMA = 'pgboss';

/** What the switch says when an old `.env` still names Trigger.dev (0167 T9). */
export const TRIGGER_REMOVED =
  'OWNPACE_JOB_RUNNER is "trigger", but Trigger.dev was removed in alpha.18, so remove the key from the .env or set it to "pg-boss".';

/** The runner `OWNPACE_JOB_RUNNER` names: pg-boss, unset or empty included. Throws on anything else. */
export function jobRunner(env: NodeJS.ProcessEnv = process.env): JobRunnerName {
  const value = env.OWNPACE_JOB_RUNNER?.trim() ?? '';
  if (value === '' || value === 'pg-boss') return 'pg-boss';
  if (value === 'trigger') throw new Error(TRIGGER_REMOVED);
  throw new Error(`OWNPACE_JOB_RUNNER is "${value}", and it may only be "pg-boss" (unset or empty means "pg-boss").`);
}

/** A pg-boss job id: what `orchestrator_ref` holds for a run on pg-boss. */
const PG_BOSS_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a run's ref is pg-boss's (a UUID); Trigger.dev's were `run_…`. */
export function isPgBossRef(ref: string): boolean {
  return PG_BOSS_REF.test(ref);
}

let producer: Promise<PgBossProducer> | null = null;
let stopOnSignal: ((signal: NodeJS.Signals) => void) | null = null;

/**
 * The process's one producer, made and started on first use. Only
 * `enqueue-unless-held.ts` and `cancelRun` below call this
 * (`a-hold-that-holds-every-door`).
 */
export function pgBossProducer(env: NodeJS.ProcessEnv = process.env): Promise<PgBossProducer> {
  if (producer) return producer;
  // A start that fails forgets only itself: by the time it fails, a close and
  // a newer press may have made another, which is the one to keep (and close).
  const making: Promise<PgBossProducer> = makeProducer(env).catch((err: unknown) => {
    if (producer === making) producer = null;
    throw err;
  });
  producer = making;
  return making;
}

/** What a pg-boss enqueue or cancel says when the runner has no URL to reach. */
export const NO_JOBS_URL =
  'OWNPACE_JOB_RUNNER is "pg-boss" and JOBS_DATABASE_URL is not set, so no job can be enqueued or cancelled.';

async function makeProducer(env: NodeJS.ProcessEnv): Promise<PgBossProducer> {
  const connectionString = env.JOBS_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(NO_JOBS_URL);
  }
  const { PgBossProducer, JOB_CATALOG } = await import('@openmig/scheduler/pg-boss');
  const made = new PgBossProducer({ connectionString, schema: JOBS_SCHEMA, maxConnections: 2 }, JOB_CATALOG);
  try {
    await made.start();
  } catch (err) {
    await made.stop({ graceful: false, timeoutMs: 5_000 }).catch((stopErr: unknown) => {
      log.warn('[jobs] the producer did not close after failing to start:', stopErr);
    });
    throw err;
  }
  if (!stopOnSignal) {
    stopOnSignal = (signal) => {
      void closeJobRunner().finally(() => {
        // Our listener is gone by now (`once`); the signal then does its default.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    };
    process.once('SIGTERM', stopOnSignal);
    process.once('SIGINT', stopOnSignal);
  }
  return made;
}

/** Close the producer, if one was made. Safe to call more than once. */
export async function closeJobRunner(): Promise<void> {
  const made = producer;
  producer = null;
  if (stopOnSignal) {
    process.removeListener('SIGTERM', stopOnSignal);
    process.removeListener('SIGINT', stopOnSignal);
    stopOnSignal = null;
  }
  if (!made) return;
  const client = await made.catch(() => null);
  if (client) await client.stop({ graceful: false, timeoutMs: 5_000 });
}

/**
 * Ask the runner the ref belongs to to cancel the run. What the close hands
 * `closeAccount` (`routes/support.ts`, `routes/tenants/index.ts`,
 * `scripts/operator.ts`).
 */
export async function cancelRun(ref: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  jobRunner(env);
  if (!isPgBossRef(ref)) {
    throw new Error(`Run ${ref} is not a pg-boss job id, and this API runs its jobs on pg-boss; it was not cancelled.`);
  }
  const cancelled = await (await pgBossProducer(env)).cancel(ref);
  if (!cancelled) log.info(`[jobs] run ${ref} is no longer queued or running on pg-boss; read as finished.`);
}
