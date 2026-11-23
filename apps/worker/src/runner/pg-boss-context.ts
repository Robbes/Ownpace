// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN'S CONTEXT ON PG-BOSS (ADR-0054; workplan 0167 T6).
 *
 * The pg-boss half of `../jobs/run-context.ts`: what a job asks of its runner
 * (enqueue a pass, wait for one, ask after a run, cancel it), answered by
 * `@openmig/scheduler/pg-boss`'s producer, the client that enqueues, reads and
 * cancels and never migrates, schedules, supervises or works a queue.
 *
 * ONLY THE WORKER'S RUN ENTRIES IMPORT THIS (`./runs/*.ts`). Every job
 * imports `run-context.ts`, which holds types only, so no job module loads
 * pg-boss by itself (`scripts/a-pass-that-opened-the-owners-pool`, its rule on
 * pg-boss).
 *
 * THE PRODUCER IS OPENED WHEN A RUN FIRST ASKS, AND CLOSED WHEN IT ENDS. Most
 * runs never ask (eleven of the seventeen jobs ask nothing), so they open no
 * connection to the jobs schema at all. A run that asks opens one producer for
 * its whole run, on `JOBS_DATABASE_URL`, and its entry closes it once the run
 * has settled (`./serve-job.ts`).
 *
 * WHAT A REF READS AS (0167, design point 6). A run's `orchestrator_ref` is the
 * pg-boss job's id, a UUID. A ref of Trigger.dev's shape (`run_…`), left by a
 * pass that ran before the switch, is never asked of pg-boss: it reads
 * `unknown`, which blocks whoever asked (the purge waits for a person) rather
 * than guess. A pg-boss ref whose job is gone reads as `finished`, said in a
 * line: pg-boss deletes a settled job after its retention and a waiting one
 * after its own, never an active one, so a vanished job is a run that no longer
 * runs.
 */

import {
  JOB_CATALOG,
  PgBossProducer,
  killMarginSeconds,
  type ChildRunInfo,
  type RunOutcome,
  type RunStatus,
} from '@openmig/scheduler/pg-boss';
import { log, type OrchestratorVerdict } from '@openmig/shared';
// The job's context, beside the runner's own `RunContext` (`@openmig/scheduler/pg-boss`).
import type { JobRunnerPort, RunContext as JobRunContext, Settled } from '../jobs/run-context.ts';
import type { DeltaSyncOutput } from '../jobs/final-sync.ts';

/** pg-boss's schema, made by the bring-up and owned by `ownpace_jobs` (`deploy/compose/jobs-role.sql`). */
export const JOBS_SCHEMA = 'pgboss';

/** How often a run waiting for another asks after it (Trigger.dev's `triggerAndWait` waits on a push). */
export const WAIT_POLL_MS = 1000;

/**
 * How long a run may wait for another, from when it started: its own limit,
 * less the margin at which the worker kills it (`killMarginSeconds`), less as
 * long again, up to a minute, for the run to say why it stopped waiting. A
 * cutover waits for a pass ahead of it and for its own final sync; on
 * Trigger.dev those waits did not count toward its limit, and a final sync
 * that failed came back as one that did not settle, which the cutover records
 * (`FinalSyncNotFinished`). Here the wall clock counts, so the wait gives up
 * first and hands back the same answer: the run is never killed mid-wait as
 * `RunTimedOut`, with nothing recorded.
 */
export function waitBudgetMs(limitSeconds: number): number {
  const settle = Math.min(60, Math.max(1, Math.floor(limitSeconds / 10)));
  return Math.max(1, limitSeconds - killMarginSeconds(limitSeconds) - settle) * 1000;
}

/** What the worker hands a forked run besides its id and attempt: until when it may wait (ms since the epoch). */
export interface PgBossRunInfo extends ChildRunInfo {
  readonly waitsUntil?: number;
}

/** A pg-boss job id. Anything else, Trigger.dev's `run_…` among them, this runner never started. */
const PG_BOSS_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a run asks of the producer: the calls below, and its own start and stop. */
export interface ProducerLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(queue: string, payload: unknown, opts: { serializeBy?: string; tags?: readonly string[] }): Promise<{ runId: string | null }>;
  enqueueAndWait<R>(
    queue: string,
    payload: unknown,
    opts: { serializeBy?: string; tags?: readonly string[]; pollMs?: number; signal?: AbortSignal },
  ): Promise<RunOutcome<R>>;
  status(runId: string): Promise<RunStatus | null>;
  cancel(runId: string): Promise<boolean>;
}

/** The producer a run opens, on the jobs' own URL: never the owner's. */
export function producerFromEnv(env: NodeJS.ProcessEnv = process.env): ProducerLike {
  const url = env.JOBS_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'JOBS_DATABASE_URL is not set, so this run cannot reach the jobs schema to enqueue, ask after or cancel a ' +
        'run. The worker refuses to start without it; a run forked by it inherits it.',
    );
  }
  return new PgBossProducer({ connectionString: url, schema: JOBS_SCHEMA, maxConnections: 2 }, JOB_CATALOG);
}

/**
 * What pg-boss's state of a run says to the job asking: still going, or at an
 * end. `null` is a job that is gone, which reads as finished (see the header).
 */
export function verdictOfStatus(status: RunStatus | null): OrchestratorVerdict {
  if (status === null) return 'finished';
  switch (status.state) {
    case 'queued':
    case 'retrying':
    case 'running':
      return 'live';
    case 'completed':
    case 'failed':
    case 'cancelled':
      return 'finished';
    default:
      // A state this code has never heard of waits for a person, as on Trigger.dev.
      return 'unknown';
  }
}

/** Whether `ref` is a pg-boss job's id, and so one this runner may be asked about. */
export function isPgBossRef(ref: string): boolean {
  return PG_BOSS_REF.test(ref);
}

/** What a run that waited on another is handed, from pg-boss's outcome. */
export function settledOf<R>(outcome: RunOutcome<R>): Settled<R> {
  if (outcome.ok) return { ok: true, output: outcome.output };
  // As stored: `{ name, message }` once failed, null for a cancel that left none.
  return {
    ok: false,
    error: outcome.error ?? { name: 'RunCancelled', message: `The run ended ${outcome.state}.` },
  };
}

/** A run's runner on pg-boss, and the one way to close what it opened. */
export interface PgBossRunner {
  readonly port: JobRunnerPort;
  /** Close the producer, if the run opened one. Never throws: a failed close is said. */
  close(): Promise<void>;
}

export function pgBossRunner(open: () => ProducerLike = producerFromEnv, waitsUntil?: number): PgBossRunner {
  let opened: Promise<ProducerLike> | null = null;
  const producer = (): Promise<ProducerLike> => {
    opened ??= (async () => {
      const p = open();
      try {
        await p.start();
      } catch (err) {
        await p.stop().catch((stopErr: unknown) => {
          log.error('[jobs] the producer that failed to start did not stop either:', stopErr);
        });
        opened = null;
        throw err;
      }
      return p;
    })();
    return opened;
  };

  const port: JobRunnerPort = {
    name: 'pg-boss',
    async enqueue(queue, payload, options) {
      const { runId } = await (await producer()).enqueue(queue, payload, {
        serializeBy: options.serializeBy,
        tags: options.tags,
      });
      // A `singleton` queue always takes the run; only a `stately` one may refuse, and a pass's is not.
      if (runId === null) throw new Error(`pg-boss took no run on "${queue}" and gave no id.`);
      return { runId };
    },
    async enqueueAndWait(queue, payload, options) {
      const deadline = waitsUntil === undefined ? undefined : AbortSignal.timeout(Math.max(0, waitsUntil - Date.now()));
      try {
        const outcome = await (await producer()).enqueueAndWait<DeltaSyncOutput>(queue, payload, {
          serializeBy: options.serializeBy,
          tags: options.tags,
          pollMs: WAIT_POLL_MS,
          ...(deadline ? { signal: deadline } : {}),
        });
        return settledOf(outcome);
      } catch (err) {
        if (deadline?.aborted !== true) throw err;
        // The wait's own deadline, not the pass's: the pass goes on, and this run says it did not settle.
        log.warn(`[jobs] stopped waiting for a run on "${queue}": this run's time would run out before it settled.`);
        return {
          ok: false,
          error: {
            name: 'FinalSyncTimedOut',
            message: `The run on "${queue}" had not settled when this run's own time limit was near.`,
          },
        };
      }
    },
    async verdict(ref) {
      if (!isPgBossRef(ref)) return 'unknown';
      const status = await (await producer()).status(ref);
      if (status === null) {
        log.info(
          `[jobs] run ${ref} is no longer in the jobs schema: pg-boss deletes a run only once it has ended, ` +
            'or after it waited past its retention, so it is read as finished.',
        );
      }
      return verdictOfStatus(status);
    },
    async cancel(ref) {
      if (!isPgBossRef(ref)) {
        throw new Error(`"${ref}" is not a pg-boss run's id; the pg-boss runner never started it, and cannot cancel it.`);
      }
      await (await producer()).cancel(ref);
    },
  };

  return {
    port,
    async close() {
      const p = opened;
      opened = null;
      if (p === null) return;
      try {
        await (await p).stop();
      } catch (err) {
        log.error('[jobs] the run could not close its producer:', err);
      }
    },
  };
}

/** A run's context on pg-boss: its id and attempt as the worker forked it, and its runner. */
export function pgBossContext(run: { readonly runId: string; readonly attempt: number }, runner: PgBossRunner): JobRunContext {
  return { runId: run.runId, attempt: run.attempt, runner: runner.port };
}
