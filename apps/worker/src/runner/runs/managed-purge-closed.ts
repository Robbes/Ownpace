// Copyright 2026 The Ownpace authors (Apache-2.0)

// `managed-purge-closed` on pg-boss: the entry the worker forks, one process per run
// (`../worker.ts`, `../serve-job.ts`). Static imports only, ending in serveRuns.

import { serveRuns } from '@openmig/scheduler/pg-boss';
import { PurgeClosedJobSchema, managedPurgeClosedRun } from '../../jobs/managed-purge-closed.ts';
import { onPgBoss } from '../serve-job.ts';

serveRuns({ run: onPgBoss(PurgeClosedJobSchema, managedPurgeClosedRun) });
