// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RUN'S CONTEXT, ON EITHER RUNNER (ADR-0054; workplan 0167 T6).
 *
 * Every job in this directory is a Trigger.dev task today, and becomes a
 * pg-boss queue's once the switch is on (`@openmig/scheduler/pg-boss`, its
 * catalog). So no job calls the Trigger.dev SDK itself: each exports its run,
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
 * This module is the Trigger.dev half: {@link onTriggerDev} makes the context
 * from what Trigger.dev hands a run, and its runner makes the SDK calls those
 * jobs made, moved here as they were. The pg-boss half comes with the worker.
 *
 * EVERY JOB IMPORTS IT, so it does nothing when it is imported, and loads the
 * SDK and nothing else: no job module, no pool, no sink
 * (`scripts/a-pass-that-opened-the-owners-pool`). A pass's task is handed to
 * the runner by the job that enqueues one, which decides when the pass's
 * module is loaded, as it always did: that module opens its pools, and points
 * the process's sinks at them, when it is imported.
 */

import { configure, runs } from '@trigger.dev/sdk';
import type { OrchestratorVerdict } from '@openmig/shared';
import type { DeltaSyncOutput } from './final-sync.ts';
import type { DeltaSyncJobPayload } from './run-delta-sync.ts';

/** What a run is handed besides its payload, on either runner. */
export interface RunContext {
  /**
   * The runner's own id for this run: Trigger.dev's `ctx.run.id`, or the
   * pg-boss job's id. A pass writes it on its run row (`orchestrator_ref`),
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

/** How a pass is put on its queue, on either runner. */
export interface PassOptions {
  /** One run at a time per value: the migration's id (Trigger.dev's `concurrencyKey`). */
  readonly serializeBy: string;
  /** What the run is filed under, for whoever looks: `tenant:…`, `mapping:…`. Ids, never words. */
  readonly tags: readonly string[];
}

/** How a run ended: what it returned, or what it failed with once its own attempts were spent. */
export type Settled<R> = { readonly ok: true; readonly output: R } | { readonly ok: false; readonly error: unknown };

/** What a job asks of the runner it runs on. */
export interface JobRunnerPort {
  /** Which runner this is, by the name the switch gives it: the sync tick's own beat is named after it. */
  readonly name: 'trigger' | 'pg-boss';
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

/**
 * `run-delta-sync`'s Trigger.dev task, as the runner below calls it: its two
 * SDK calls, and nothing else. Written out rather than taken as `typeof
 * runDeltaSync`, which the pass's own module, importing this one, would make
 * circular.
 */
export interface DeltaSyncTask {
  trigger(payload: DeltaSyncJobPayload, options: { concurrencyKey: string; tags: string[] }): Promise<{ readonly id: string }>;
  triggerAndWait(
    payload: DeltaSyncJobPayload,
    options: { concurrencyKey: string; tags: string[] },
  ): PromiseLike<Settled<DeltaSyncOutput>>;
}

/** What a Trigger.dev run is handed to enqueue a pass with. */
export interface TriggerDevTasks {
  /**
   * The pass's task, loaded when a pass is enqueued: the job decides when the
   * pass's module is loaded. The sync tick imports it at its top, and a
   * cutover when its final sync starts, as each always did.
   */
  readonly deltaSync?: () => Promise<DeltaSyncTask>;
}

/**
 * A job's run as Trigger.dev calls it: with a context made from what
 * Trigger.dev hands the run, and its runner in it.
 */
export function onTriggerDev<P, R>(
  run: (payload: P, context: RunContext) => Promise<R>,
  tasks: TriggerDevTasks = {},
): (payload: P, params: unknown) => Promise<R> {
  return (payload, params) => run(payload, triggerDevContext(params, tasks));
}

/**
 * The context of a Trigger.dev run, from the parameters Trigger.dev hands its
 * `run` (`ctx`, from @trigger.dev/core's TaskRunContext). Read as run-delta-sync
 * read the run's id until it moved here: absent rather than wrong if the shape
 * ever changes again.
 */
function triggerDevContext(params: unknown, tasks: TriggerDevTasks): RunContext {
  const contextRunId = (params as { ctx?: { run?: { id?: unknown } } } | undefined)?.ctx?.run
    ?.id;
  const runId = typeof contextRunId === 'string' ? contextRunId : undefined;
  const contextAttempt = (params as { ctx?: { attempt?: { number?: unknown } } } | undefined)?.ctx?.attempt
    ?.number;
  const attempt = typeof contextAttempt === 'number' ? contextAttempt : undefined;
  return {
    ...(runId !== undefined ? { runId } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    runner: triggerDevRunner(tasks),
  };
}

/** The Trigger.dev runner: the SDK calls the jobs made, as they made them. */
function triggerDevRunner(tasks: TriggerDevTasks): JobRunnerPort {
  return {
    name: 'trigger',
    async enqueue(queue, payload, options) {
      const runDeltaSync = await passTask(tasks, queue);
      // In-network API URL (found live, 2026-08-01, the tick's first due
      // firing): the platform injects TRIGGER_API_URL as the HOST-perspective
      // API origin (http://localhost:3090 — correct for the deploy CLI, which
      // is why API_ORIGIN is set that way), but inside a runner container
      // `localhost` is the runner itself. The tick was the FIRST task that
      // called the API from within a runner — idle ticks succeeded, and the
      // first DUE tick died on the .trigger() call with connection refused.
      // Point the SDK at the compose-network address instead; secretKey keeps
      // resolving from the injected TRIGGER_SECRET_KEY env. Scoped to this
      // run's own process (each task run executes in its own TaskRunProcess).
      configure({ baseURL: process.env.TRIGGER_API_URL_IN_NETWORK ?? 'http://trigger-api:3000' });
      const handle = await runDeltaSync.trigger(payload, { concurrencyKey: options.serializeBy, tags: [...options.tags] });
      return { runId: handle.id };
    },
    async enqueueAndWait(queue, payload, options) {
      const runDeltaSync = await passTask(tasks, queue);
      // The in-network API address, for the reason `enqueue` gives.
      configure({ baseURL: process.env.TRIGGER_API_URL_IN_NETWORK ?? 'http://trigger-api:3000' });
      return await runDeltaSync.triggerAndWait(payload, {
        concurrencyKey: options.serializeBy,
        tags: [...options.tags],
      });
    },
    async verdict(ref) {
      const remote = await runs.retrieve(ref);
      // Both directions identified POSITIVELY, with anything unrecognised
      // falling through to `unknown` — which blocks. `isCompleted` looks like
      // the umbrella flag and reading it alone would be a guess; if it turned
      // out to mean "succeeded", a failed run would read as live and block
      // the erasure for ever, which is the exact bug being fixed here. A
      // status this code has never heard of should make it wait for a person,
      // not decide.
      const stillGoing = remote.isExecuting || remote.isQueued || remote.isWaiting;
      const terminal = remote.isCompleted || remote.isFailed || remote.isCancelled;
      return stillGoing ? 'live' : terminal ? 'finished' : 'unknown';
    },
    async cancel(ref) {
      await runs.cancel(ref);
    },
  };
}

/** The pass's task, from the job that enqueues one. */
async function passTask(tasks: TriggerDevTasks, queue: string): Promise<DeltaSyncTask> {
  if (queue !== 'run-delta-sync' || tasks.deltaSync === undefined) {
    throw new Error(
      `This run was handed no task to enqueue "${queue}" on: only the sync tick and a cutover enqueue, ` +
        "each a pass, and each hands run-delta-sync's task to onTriggerDev.",
    );
  }
  return tasks.deltaSync();
}
