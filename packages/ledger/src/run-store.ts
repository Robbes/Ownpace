// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Run ledger: one `run` row per job execution, plus an append-only `run_event`
// log per run.
//
// Why this exists: the `run` / `run_event` tables and the API endpoints that
// read them (`GET /api/mappings/:mappingId/runs` and `.../runs/:runId`) shipped
// together, but nothing ever wrote to them — so run history was permanently
// empty in both editions, and `runs.integration.test.ts` only passed because it
// seeded rows with raw SQL itself. This store is the missing writer.
//
// Errors are recorded verbatim (hard rule 9): a failed run is written as
// `status = 'failed'` with the real message in a run_event, never swallowed
// into a silent success.

import type { TenantId, MappingId } from '@openmig/shared';
import type { PgDatabase } from './db';
import { eq } from 'drizzle-orm';
import * as schemaPg from './schema-pg';

/** What kind of work a run represents (mirrors the `run.kind` CHECK). */
export type RunKind = 'initial_copy' | 'incremental' | 'cutover' | 'verify' | 'discovery' | 'backup';

/** What caused the run to start (mirrors the `run.trigger` CHECK). */
export type RunTrigger = 'schedule' | 'manual' | 'event';

/** Terminal states a run can finish in. */
export type RunOutcome = 'succeeded' | 'failed' | 'cancelled';

export type RunEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StartRunInput {
  tenantId: TenantId;
  mappingId: MappingId;
  kind: RunKind;
  /** Defaults to 'schedule' — the common case for worker jobs. */
  trigger?: RunTrigger;
  /** The orchestrator's own id for this execution (e.g. a Trigger.dev run id). */
  orchestratorRef?: string;
}

/**
 * Aggregate counters surfaced by the API as `itemsProcessed` / `errors`.
 * Kept deliberately small — per-domain detail lives in `migration_status`.
 */
export interface RunStats {
  itemsProcessed?: number;
  errors?: number;
  [key: string]: unknown;
}

/**
 * Writes the run ledger. All methods assume the caller has already established
 * the tenant context (i.e. they run inside `withTenant`), matching how the
 * other stores in this package are used.
 */
export class RunStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /** Open a run in the `running` state and return its id. */
  async startRun(input: StartRunInput): Promise<string> {
    const rows = await this.db
      .insert(schemaPg.run)
      .values({
        tenantId: input.tenantId,
        mappingId: input.mappingId,
        kind: input.kind,
        trigger: input.trigger ?? 'schedule',
        status: 'running',
        ...(input.orchestratorRef ? { orchestratorRef: input.orchestratorRef } : {}),
        stats: {},
        startedAt: new Date(),
      })
      .returning({ id: schemaPg.run.id });

    const row = rows[0];
    if (!row) {
      // Never return a fake id — a caller that logged events against it would
      // silently write orphans.
      throw new Error('failed to create run row');
    }
    return row.id;
  }

  /** Close a run, recording its outcome and final counters. */
  async finishRun(runId: string, outcome: RunOutcome, stats: RunStats = {}): Promise<void> {
    await this.db
      .update(schemaPg.run)
      .set({
        status: outcome,
        stats,
        finishedAt: new Date(),
      })
      .where(eq(schemaPg.run.id, runId));
  }

  /** Append one entry to a run's event log. */
  async logEvent(
    tenantId: TenantId,
    runId: string,
    level: RunEventLevel,
    message: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(schemaPg.runEvent).values({
      tenantId,
      runId,
      level,
      message,
      ...(detail ? { detail } : {}),
    });
  }
}
