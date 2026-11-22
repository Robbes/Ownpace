// Copyright 2026 The Ownpace authors (Apache-2.0)

// A cutover's final sync, for `../worker.integration.test.ts` only: forked by
// the worker in place of `run-cutover`'s entry, it asks its runner for a pass
// on its migration and waits for it, as `run-cutover.ts` does
// (`context.runner.enqueueAndWait`), and hands back what the wait settled.
// Never shipped: nothing outside the test names it.

import { z } from 'zod';
import { serveRuns } from '@openmig/scheduler/pg-boss';
import type { DeltaSyncJobPayload } from '../../jobs/run-delta-sync.ts';
import { onPgBoss } from '../serve-job.ts';

const StandInCutoverSchema = z.object({ tenantId: z.string(), mappingId: z.string() });

serveRuns({
  run: onPgBoss(StandInCutoverSchema, async ({ tenantId, mappingId }, context) => {
    const settled = await context.runner.enqueueAndWait(
      'run-delta-sync',
      { tenantId, mappingId } as DeltaSyncJobPayload,
      { serializeBy: mappingId, tags: [`tenant:${tenantId}`, `mapping:${mappingId}`, 'cutover-final-sync'] },
    );
    return { settled };
  }),
});
