// Copyright 2026 The Ownpace authors (Apache-2.0)

// A worker in a process of its own, for `../worker.integration.test.ts` only:
// the pass's queue worked with the stand-in pass, a heartbeat of 10 s, so that
// the test can kill this whole process mid-run, as a worker that dies, and see
// the run picked up by the next worker. Never shipped: nothing imports it.

import { JOB_CATALOG, type JobCatalogEntry } from '@openmig/scheduler/pg-boss';
import { JobWorker } from '../worker.ts';

const pass = JOB_CATALOG.find((job) => job.name === 'run-delta-sync')!;
const worker = new JobWorker({
  connectionString: process.env.JOBS_DATABASE_URL!,
  passesInFlight: 2,
  catalog: [{ ...pass, heartbeatSeconds: 10 } as JobCatalogEntry],
  entries: { 'run-delta-sync': new URL('./a-pass-stand-in.ts', import.meta.url) },
  tuning: { pollingIntervalSeconds: 0.5, monitorIntervalSeconds: 1, superviseIntervalSeconds: 1 },
  health: null,
});
await worker.start();
process.stdout.write('[a-worker-to-kill] working\n');
