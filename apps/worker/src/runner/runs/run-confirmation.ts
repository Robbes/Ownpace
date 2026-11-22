// Copyright 2026 The Ownpace authors (Apache-2.0)

// `run-confirmation` on pg-boss: the entry the worker forks, one process per run
// (`../worker.ts`, `../serve-job.ts`). Static imports only, ending in serveRuns.

import { serveRuns } from '@openmig/scheduler/pg-boss';
import { ConfirmationJobSchema, runConfirmationRun } from '../../jobs/run-confirmation.ts';
import { onPgBoss } from '../serve-job.ts';

serveRuns({ run: onPgBoss(ConfirmationJobSchema, runConfirmationRun) });
