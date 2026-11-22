// Copyright 2026 The Ownpace authors (Apache-2.0)

// `managed-group-discovery` on pg-boss: the entry the worker forks, one process per run
// (`../worker.ts`, `../serve-job.ts`). Static imports only, ending in serveRuns.

import { serveRuns } from '@openmig/scheduler/pg-boss';
import { GroupDiscoveryJobSchema, managedGroupDiscoveryRun } from '../../jobs/managed-group-discovery.ts';
import { onPgBoss } from '../serve-job.ts';

serveRuns({ run: onPgBoss(GroupDiscoveryJobSchema, managedGroupDiscoveryRun) });
