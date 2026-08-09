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

import type { TenantId, MappingId, RunReport, RunEventReport } from '@openmig/shared';
import type { PgDatabase } from './db';
import { and, desc, eq, inArray } from 'drizzle-orm';
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

  /**
   * Runs for one mapping, newest first, each with its event log — the read
   * side this store shipped without for its first week (the API queried the
   * tables directly, and the appliance had no reader at all).
   *
   * ONE reader for both editions, same argument as `/metrics` sharing one
   * renderer (0026 T3 row 19): two implementations of "what is a run report"
   * would drift, and a panel built against one edition's shape would silently
   * show less on the other. The managed route and the appliance route both
   * call this and serve the result verbatim.
   *
   * Events are fetched for the LISTED runs only and capped per run — the log
   * is append-only and unbounded, and a run that retried all night can carry
   * hundreds of throttle warnings; the newest tell the story. The cap keeps
   * order chronological within what it keeps (newest N, then re-sorted
   * ascending) so a reader still sees cause before consequence.
   */
  async listRunsWithEvents(
    tenantId: TenantId,
    mappingId: MappingId,
    { limit = 20, eventsPerRun = 25 }: { limit?: number; eventsPerRun?: number } = {},
  ): Promise<{ runs: RunReport[]; truncated: boolean }> {
    // Over-fetch by one (0036 T3): with exactly `limit` rows returned the
    // caller could not distinguish "all of them" from "the newest limit of
    // more", and a label based on length === cap would be almost-honest.
    const fetched = await this.db
      .select()
      .from(schemaPg.run)
      .where(and(eq(schemaPg.run.tenantId, tenantId), eq(schemaPg.run.mappingId, mappingId)))
      .orderBy(desc(schemaPg.run.createdAt))
      .limit(limit + 1);
    const truncated = fetched.length > limit;
    const runs = truncated ? fetched.slice(0, limit) : fetched;
    if (runs.length === 0) return { runs: [], truncated: false };

    const events = await this.db
      .select({
        runId: schemaPg.runEvent.runId,
        level: schemaPg.runEvent.level,
        message: schemaPg.runEvent.message,
        at: schemaPg.runEvent.at,
      })
      .from(schemaPg.runEvent)
      .where(
        and(
          eq(schemaPg.runEvent.tenantId, tenantId),
          inArray(
            schemaPg.runEvent.runId,
            runs.map((r) => r.id),
          ),
        ),
      )
      .orderBy(desc(schemaPg.runEvent.at));

    const byRun = new Map<string, RunEventReport[]>();
    // All events for the listed runs are already fetched; the cap is applied
    // here — so the exact per-run total is known and the truncation marker is
    // a fact, not an inference.
    const totalByRun = new Map<string, number>();
    for (const e of events) {
      totalByRun.set(e.runId, (totalByRun.get(e.runId) ?? 0) + 1);
      const list = byRun.get(e.runId) ?? [];
      if (list.length < eventsPerRun) {
        list.push({
          level: e.level as RunEventReport['level'],
          message: e.message,
          at: e.at.toISOString(),
        });
        byRun.set(e.runId, list);
      }
    }

    return {
      runs: runs.map((r) => {
        const report = toRunReport(r, (byRun.get(r.id) ?? []).reverse());
        return (totalByRun.get(r.id) ?? 0) > eventsPerRun
          ? { ...report, eventsTruncated: true }
          : report;
      }),
      truncated,
    };
  }
}

/** A `run` row as drizzle returns it — only the fields the mapper reads. */
interface RunRowLike {
  id: string;
  mappingId: string | null;
  kind: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  stats: unknown;
  createdAt: Date;
}

/**
 * The wire shape (`RunReport` in @openmig/shared), from a ledger row.
 *
 * Moved here from the managed API's private `toApiRun` so the appliance could
 * not grow a second, slightly different one. The status collapse
 * (`queued`->'pending', `succeeded`->'success') is the API's original public
 * contract, kept — changing stored words is cheap, changing served ones
 * breaks whoever reads them.
 */
export function toRunReport(r: RunRowLike, events: RunEventReport[]): RunReport {
  const statusMap: Record<string, RunReport['status']> = {
    queued: 'pending',
    running: 'running',
    succeeded: 'success',
    failed: 'failed',
    cancelled: 'cancelled',
  };
  const stats = (r.stats ?? {}) as { itemsProcessed?: number; errors?: number };
  return {
    id: r.id,
    mappingId: r.mappingId,
    // 'incremental' is the delta pass; every other kind is a full-scan shape.
    // (The first draft of this mapper inverted that for cutover/verify/backup
    // kinds -- caught against the original before it could serve anything.)
    type: r.kind === 'incremental' ? 'delta' : 'full',
    status: statusMap[r.status] ?? 'pending',
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    itemsProcessed: stats.itemsProcessed ?? 0,
    errors: stats.errors ?? 0,
    createdAt: r.createdAt.toISOString(),
    events,
  };
}

