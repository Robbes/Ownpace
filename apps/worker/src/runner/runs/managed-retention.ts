// Copyright 2026 The Ownpace authors (Apache-2.0)

// `managed-retention` on pg-boss: the entry the worker forks, one process per run
// (`../worker.ts`, `../serve-job.ts`). Static imports only, ending in serveRuns.

import { serveRuns } from '@openmig/scheduler/pg-boss';
import { RetentionJobSchema, managedRetentionRun } from '../../jobs/managed-retention.ts';
import { onPgBoss } from '../serve-job.ts';

serveRuns({ run: onPgBoss(RetentionJobSchema, managedRetentionRun) });
