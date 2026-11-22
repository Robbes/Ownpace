// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORKER'S PROCESS (ADR-0054; workplan 0167 T6): `node
 * apps/worker/src/runner/main.ts`, run by Node directly, as the API runs
 * `apps/api/src/index.ts`.
 *
 * It refuses to start, with one sentence on stderr and exit 1, unless the
 * switch names pg-boss (`OWNPACE_JOB_RUNNER=pg-boss`) and the jobs' URL is set
 * (`JOBS_DATABASE_URL`, the `ownpace_jobs` role through PgBouncer). So the
 * worker's service may be in the stack while Trigger.dev runs the jobs: it
 * does nothing but say why. Then it works the jobs (`./worker.ts`) until
 * SIGTERM or SIGINT, stops as `JobWorker#stop` says, and exits 0.
 */

import { log } from '@openmig/shared';
import { JobWorker, passesInFlightFrom, refusalToStart } from './worker.ts';

function refuse(why: string): never {
  process.stderr.write(`[worker] not started: ${why}\n`);
  process.exit(1);
}

const refusal = refusalToStart(process.env);
if (refusal !== null) refuse(refusal);

let passesInFlight: number;
try {
  passesInFlight = passesInFlightFrom(process.env.MAX_PASSES_IN_FLIGHT);
} catch (err) {
  refuse(err instanceof Error ? err.message : String(err));
}

const worker = new JobWorker({ connectionString: process.env.JOBS_DATABASE_URL!.trim(), passesInFlight });

let exitCode = 0;
const stop = (why: string): void => {
  log.info(`[worker] ${why}: stopping.`);
  void worker
    .stop()
    .catch((err: unknown) => {
      log.error('[worker] did not stop cleanly:', err);
      exitCode = 1;
    })
    .finally(() => process.exit(exitCode));
};
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));

try {
  await worker.start();
} catch (err) {
  log.error('[worker] could not start:', err);
  exitCode = 1;
  stop('the start failed');
}
