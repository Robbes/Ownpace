// Copyright 2026 The Ownpace authors (Apache-2.0)

// `managed-month-invoices` on pg-boss: the entry the worker forks, one process per run
// (`../worker.ts`, `../serve-job.ts`). Static imports only, ending in serveRuns.

import { serveRuns } from '@openmig/scheduler/pg-boss';
import { MonthInvoicesJobSchema, managedMonthInvoicesRun } from '../../jobs/managed-month-invoices.ts';
import { onPgBoss } from '../serve-job.ts';

serveRuns({ run: onPgBoss(MonthInvoicesJobSchema, managedMonthInvoicesRun) });
