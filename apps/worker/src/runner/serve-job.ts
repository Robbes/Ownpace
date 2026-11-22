// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE JOB'S RUN, IN THE PROCESS THE WORKER FORKED FOR IT (ADR-0054; workplan
 * 0167 T6).
 *
 * Each file in `./runs/` is the entry the worker forks for one queue: it
 * imports that job's module statically, and ends in
 * `serveRuns({ run: onPgBoss(<schema>, <job>Run) })`. What the run is handed
 * is made here, as Trigger.dev makes it for the same job (`onTriggerDev`):
 *
 * 1. **The payload, parsed with the job's own schema.** A payload the schema
 *    refuses fails the run before the job's run is called, and is not retried:
 *    Trigger.dev 4.8.8 parses before `run` too, and settles a
 *    `TaskPayloadParsedError` as `skipped`, with no further attempts
 *    (`TaskExecutor#handleError`). Here it is zod's `ZodError`, whose name the
 *    worker settles as `deadletter` (`NOT_RETRIED_ERROR_NAMES`). Like
 *    Trigger.dev's, it never reaches `leavesAReference`, so it records no
 *    event: no job ran.
 * 2. **Its context**: the run's pg-boss id and attempt, as the worker forked
 *    it, and the pg-boss runner (`./pg-boss-context.ts`), whose producer the
 *    run opens only if it asks for it, and which is closed here once the run
 *    has settled.
 *
 * AND THE PROCESS PUTS ITSELF FIRST FOR THE OOM KILLER (0167, design point 8).
 * The worker's container is capped as a whole; a run whose heap is within its
 * cap can still take the container to its limit with what lives outside V8.
 * Raising `/proc/self/oom_score_adj`, which any process may do for itself,
 * makes the kernel take a run before the worker that holds every run's claim.
 */

import { writeFileSync } from 'node:fs';
import type { ChildRunInfo } from '@openmig/scheduler/pg-boss';
import { log } from '@openmig/shared';
import type { RunContext } from '../jobs/run-context.ts';
import { pgBossContext, pgBossRunner, type ProducerLike } from './pg-boss-context.ts';

/** The most a process may say of itself: taken first. */
const OOM_SCORE_ADJ = '1000';

/** What a job's schema is asked: zod's `parse`, which throws a `ZodError`. */
export interface PayloadSchema<P> {
  parse(payload: unknown): P;
}

let oomScoreSet = false;

/** Ask the kernel to take this process first. Said, and not fatal, where it cannot: not every host has `/proc`. */
export function preferredByTheOomKiller(path = '/proc/self/oom_score_adj'): boolean {
  try {
    writeFileSync(path, OOM_SCORE_ADJ);
    return true;
  } catch (err) {
    log.warn(`[jobs] this run could not raise its own ${path}, so the OOM killer may pick the worker first:`, err);
    return false;
  }
}

/**
 * A job's run as the forked process serves it: parsed with `schema`, handed a
 * pg-boss context, its producer closed once it settles.
 */
export function onPgBoss<P, R>(
  schema: PayloadSchema<P>,
  run: (payload: P, context: RunContext) => Promise<R>,
  open?: () => ProducerLike,
): (payload: unknown, info: ChildRunInfo | undefined) => Promise<R> {
  return async (payload, info) => {
    if (info === undefined) {
      throw new Error('This run was forked without its run id and attempt; the worker always hands both.');
    }
    if (!oomScoreSet) {
      oomScoreSet = true;
      preferredByTheOomKiller();
    }
    // Before the run, as Trigger.dev parses: a ZodError here is not retried.
    const parsed = schema.parse(payload);
    const runner = pgBossRunner(open);
    try {
      return await run(parsed, pgBossContext(info, runner));
    } finally {
      await runner.close();
    }
  };
}
