// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN'S CONTEXT (ADR-0054; workplan 0167 T6, and T9).
 *
 * Every job in this directory is a pg-boss queue's (`@openmig/scheduler/pg-boss`,
 * its catalog), worked by the `worker` service. Each job exports its run,
 * wrapped in `leavesAReference`, which is handed a {@link RunContext}, and what
 * a run asks of its runner goes through the context's {@link JobRunnerPort}.
 * Four jobs ask anything:
 *
 * - the sync tick enqueues passes, one at a time per migration;
 * - a cutover's preparation enqueues its final sync and waits for it;
 * - the purge of closed organisations asks after a run by its id, and cancels
 *   it;
 * - a pass writes the runner's own id for itself on its run row, as
 *   `orchestrator_ref`.
 *
 * The port's one implementation is the pg-boss runner's
 * (`apps/worker/src/runner/pg-boss-context.ts`). Until alpha.18 a second one,
 * Trigger.dev's, lived here; it went with Trigger.dev (0167 T9).
 *
 * EVERY JOB IMPORTS IT, so it does nothing when it is imported, and imports
 * types only: no job module, no pool, no sink
 * (`scripts/a-pass-that-opened-the-owners-pool`).
 */

import type { OrchestratorVerdict } from '@openmig/shared';
import type { DeltaSyncOutput } from './final-sync.ts';
import type { DeltaSyncJobPayload } from './run-delta-sync.ts';

/** What a run is handed besides its payload. */
export interface RunContext {
  /**
   * The runner's own id for this run: the pg-boss job's id. A pass writes it
   * on its run row (`orchestrator_ref`),
   * where the erasure's quiesce and the smoke look the run up. Absent when the
   * runner did not say, never guessed: a wrong one would point the quiesce at
   * somebody else's run.
   */
  readonly runId?: string;
  /** Which attempt this is, 1 on the first; absent when the runner did not say. */
  readonly attempt?: number;
  /** The runner this run is on, for what the run asks of it. */
  readonly runner: JobRunnerPort;
}

/** How a pass is put on its queue. */
export interface PassOptions {
  /** One run at a time per value: the migration's id (the queue's singleton key). */
  readonly serializeBy: string;
  /** What the run is filed under, for whoever looks: `tenant:…`, `mapping:…`. Ids, never words. */
  readonly tags: readonly string[];
}

/** How a run ended: what it returned, or what it failed with once its own attempts were spent. */
export type Settled<R> = { readonly ok: true; readonly output: R } | { readonly ok: false; readonly error: unknown };

/** What a job asks of the runner it runs on. */
export interface JobRunnerPort {
  /**
   * Which runner this is, by the name the switch gives it: the sync tick's own
   * beat is named after it. pg-boss alone since alpha.18 (0167 T9).
   */
  readonly name: 'pg-boss';
  /** Put a pass on its queue, and answer with the runner's id for it once it is there. */
  enqueue(queue: 'run-delta-sync', payload: DeltaSyncJobPayload, options: PassOptions): Promise<{ readonly runId: string }>;
  /** Put a pass on its queue, and wait for it to settle. */
  enqueueAndWait(
    queue: 'run-delta-sync',
    payload: DeltaSyncJobPayload,
    options: PassOptions,
  ): Promise<Settled<DeltaSyncOutput>>;
  /**
   * What the runner says of a run now, by its id: still going (`live`), at an
   * end (`finished`), or neither that it can name (`unknown`). Throws when it
   * could not be asked.
   */
  verdict(ref: string): Promise<OrchestratorVerdict>;
  /** Ask the runner to stop a run, by its id. */
  cancel(ref: string): Promise<void>;
}
