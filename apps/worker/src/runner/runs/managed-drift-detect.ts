// Copyright 2026 The Ownpace authors (Apache-2.0)

// `managed-drift-detect` on pg-boss: the entry the worker forks, one process per run
// (`../worker.ts`, `../serve-job.ts`). Static imports only, ending in serveRuns.

import { serveRuns } from '@openmig/scheduler/pg-boss';
import { DriftDetectJobSchema, managedDriftDetectRun } from '../../jobs/managed-drift-detect.ts';
import { onPgBoss } from '../serve-job.ts';

serveRuns({ run: onPgBoss(DriftDetectJobSchema, managedDriftDetectRun) });
