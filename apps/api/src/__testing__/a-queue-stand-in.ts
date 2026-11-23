// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE JOBS' QUEUE, STOOD IN FOR (workplan 0167 T9).
 *
 * Every enqueue in this API goes to pg-boss since alpha.18 removed Trigger.dev
 * (`enqueue-unless-held.ts`, `job-runner.ts`). The unit tests that press a door
 * stood in for Trigger.dev's SDK until then (`getTriggerClient` mocked in
 * `@openmig/scheduler`); they stand in for pg-boss's producer now, through
 * this, so a door's enqueue reaches a recorder and nothing connects:
 *
 *   vi.mock('@openmig/scheduler/pg-boss', async (importOriginal) =>
 *     (await import('./__testing__/a-queue-stand-in.ts')).aQueueStandIn(await importOriginal(), record));
 *
 * `record(taskId, payload, options)` is told each enqueue, the options as the
 * producer is handed them (`pgBossOptionsFor`: `serializeBy`, `idempotency`,
 * `tags`), and its answer is the run's id. It may throw, as a producer that could not enqueue would. A run is
 * cancelled as found. The real catalog is kept: the producer is declared with
 * it, as `job-runner.ts` declares the real one.
 *
 * The API refuses to make a producer without a jobs URL, and asks before it
 * imports this module, so each test sets one in its `vi.hoisted` (one that
 * names no host anybody has):
 *
 *   process.env.JOBS_DATABASE_URL ??= 'postgres://ownpace_jobs@jobs.stand-in.invalid:6432/none';
 */

export type Recorded = (
  taskId: string,
  payload: Record<string, unknown>,
  options: Readonly<Record<string, unknown>>,
) => string | Promise<string>;

/** A run's id, as pg-boss would give it: a UUID, numbered. */
export function aRunId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** The module `@openmig/scheduler/pg-boss` is mocked with: the real one, its producer stood in for. */
export function aQueueStandIn(
  actual: Record<string, unknown>,
  record: Recorded,
  cancelled: (runId: string) => void = () => {},
): Record<string, unknown> {
  class PgBossProducer {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async enqueue(
      taskId: string,
      payload: Record<string, unknown>,
      options: Readonly<Record<string, unknown>> = {},
    ): Promise<{ runId: string; joined: boolean }> {
      return { runId: await record(taskId, payload, options), joined: false };
    }
    async cancel(runId: string): Promise<boolean> {
      cancelled(runId);
      return true;
    }
  }
  return { ...actual, PgBossProducer };
}
