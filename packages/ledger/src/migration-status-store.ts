// Copyright 2026 The Ownpace authors (Apache-2.0)
import {
  classifyFailure,
  isFailureCategory,
  type MigrationStatusStore,
  type MigrationStatus,
  type TenantId,
  type MappingId,
  type PassMetrics,
  isFailureSide,
  isPauseReason,
  type PauseReason,
} from '@openmig/shared';
import type { PgDatabase } from './db.ts';
import { eq, and, sql } from 'drizzle-orm';
import * as schemaPg from './schema-pg.ts';
import type { DiscoveryDomain, FailureSide } from '@openmig/shared';

/**
 * PostgreSQL implementation of MigrationStatusStore.
 * State is maintained (pending/in_progress/completed/failed/skipped),
 * while item counts are DERIVED from the item ledger records.
 */
export class PgMigrationStatusStore implements MigrationStatusStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /** Ensure the tenant exists (idempotent). Called before scheduling mappings. */
  async ensureTenant(tenantId: TenantId, tenantName: string = 'Default tenant'): Promise<void> {
    await this.db
      .insert(schemaPg.tenant)
      .values({
        id: tenantId,
        name: tenantName,
        status: 'active',
        settings: {},
      })
      .onConflictDoNothing();
  }

  async initDomainStatus(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
  ): Promise<void> {
    // Idempotent upsert: insert if not exists, otherwise no-op
    // Using raw SQL to ensure correct handling of composite unique constraint
    await this.db.execute(
      sql`INSERT INTO migration_status (id, tenant_id, mapping_id, domain, state, started_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}, ${mappingId}, ${domain}, 'pending', now(), now())
          ON CONFLICT (tenant_id, mapping_id, domain) DO NOTHING`
    );
  }

  async markInProgress(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'in_progress',
        // THIS PASS's start, not the row's. `initDomainStatus` writes
        // started_at once (INSERT ... ON CONFLICT DO NOTHING) and until
        // 2026-08-11 nothing ever wrote it again, so `completedAt -
        // startedAt` — which is how usage-metering prices compute time —
        // measured the AGE OF THE ROW instead of the duration of the pass.
        // Live on the Spark that read as 24.3 billable hours for a demo
        // that had done a few seconds of work. A number that grows on its
        // own with the calendar is not a measurement, and this one had a
        // price attached to it.
        startedAt: sql`now()`,
        updatedAt: sql`now()`,
        // A pass has STARTED, so whatever paused the last one is not this
        // one's state. Cleared here rather than only where a pause is written,
        // because this is the one call every pass makes first: a domain whose
        // ceiling reset overnight would otherwise still be showing yesterday's
        // "waiting for the daily limit" while it copies.
        pausedReason: null,
      })
      .where(
        and(
          eq(schemaPg.migrationStatus.tenantId, tenantId),
          eq(schemaPg.migrationStatus.mappingId, mappingId),
          eq(schemaPg.migrationStatus.domain, domain),
        ),
      );
  }

  async markCompleted(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    metrics?: PassMetrics,
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'completed',
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
        // The previous pass's error does not survive a clean one. Until
        // 2026-08-09 it did, and `/status` on the Windows appliance answered:
        //
        //   "domain": "email", "state": "completed",
        //   "itemsSynced": 500, "itemsFailed": 0,
        //   "lastError": "JMAP target password/token not found in environment"
        //
        // 500 of 500 copied, nothing failed, and a credential error printed
        // beside it -- from a pass hours earlier, before the credentials were
        // set. Nothing in the report says the error is historical, so the only
        // reading available to an operator is that something is still wrong.
        // A stale error next to a success is worse than no error at all: it
        // sends someone to fix what is already fixed (hard rule 9 -- a failure
        // must be reported as itself, and this one was reporting as a live
        // failure long after it stopped being one).
        //
        // Cleared HERE and not in markSkipped: 'completed' is the one state
        // that positively asserts the domain finished, so 'there is no last
        // error' is true rather than merely unknown. Per-item failures are
        // unaffected -- they live in the failure queue and are counted in
        // itemsFailed, not here.
        lastError: null,
        // Cleared with the prose it describes. A category that outlived its
        // failure would read as a current problem on a screen showing none.
        lastErrorCategory: null,
        // And the side (0094 T5): a side that outlived its failure would send
        // somebody to rotate a credential that works.
        failedSide: null,
        // No terminal state is also a live pause (migration 0041). Cleared
        // here, in markFailed and in markSkipped as well as at the top of the
        // next pass, so that a row can never carry both and let a screen
        // render "finished" and "waiting" at once.
        pausedReason: null,
        // Only when the caller measured a pass. Writing nulls over a previous
        // pass's numbers would blank the dashboard on any path that completes
        // without measuring.
        ...(metrics ? { lastPassMetrics: metrics } : {}),
      })
      .where(
        and(
          eq(schemaPg.migrationStatus.tenantId, tenantId),
          eq(schemaPg.migrationStatus.mappingId, mappingId),
          eq(schemaPg.migrationStatus.domain, domain),
        ),
      );
  }

  /**
   * The domain stopped on purpose, and here is why (migration 0041).
   *
   * NOT `markCompleted`. That call asserts the domain finished — it says so in
   * its own comment above, which is the whole basis for clearing the last
   * error there. A domain that stopped at the day's download ceiling has
   * finished nothing: its cursors are where they were, and the next scheduled
   * pass carries on from them.
   *
   * The state is left ALONE, at the `in_progress` that `markInProgress` wrote
   * at the top of this pass. That is literally true of a migration that is in
   * progress across passes, and it is what stops a "last synced" time from
   * appearing beside a half-copied mailbox.
   *
   * The failure trio is cleared for exactly the reason `markCompleted` clears
   * it: reaching here means the pass RETURNED — `markFailed` is the only thing
   * that writes `last_error`, and it is only called when a pass threw. So an
   * error still standing here is from a pass that has since been superseded by
   * a clean one, and a stale error beside a scheduled pause reads as the
   * cause of it.
   */
  async markPaused(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    reason: PauseReason,
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        pausedReason: reason,
        updatedAt: sql`now()`,
        lastError: null,
        lastErrorCategory: null,
        failedSide: null,
      })
      .where(
        and(
          eq(schemaPg.migrationStatus.tenantId, tenantId),
          eq(schemaPg.migrationStatus.mappingId, mappingId),
          eq(schemaPg.migrationStatus.domain, domain),
        ),
      );
  }

  async markFailed(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    error: string,
    side?: FailureSide,
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'failed',
        lastError: error,
        // Which side, when the pass could tell (0094 T5, second slice). NULL
        // is written explicitly rather than left: the previous failure's side
        // must not survive into a failure that could not name one.
        failedSide: side ?? null,
        // Classified HERE, at the moment of failure (workplan 0110 T3): this
        // is where the connector's message is freshest and has travelled
        // nowhere. Stored rather than derived on read, so that editing the
        // matcher later cannot silently change the answer a customer was
        // already given. The prose is kept verbatim beside it — the category
        // is the actionable twin, not a replacement.
        lastErrorCategory: classifyFailure(error),
        // See markCompleted: a failure is not a scheduled pause, and a row
        // carrying both would say the domain is fine and broken at once.
        pausedReason: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.migrationStatus.tenantId, tenantId),
          eq(schemaPg.migrationStatus.mappingId, mappingId),
          eq(schemaPg.migrationStatus.domain, domain),
        ),
      );
  }

  async markSkipped(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'skipped',
        // See markCompleted. A domain nobody is copying is not one waiting
        // for a window to reset.
        pausedReason: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.migrationStatus.tenantId, tenantId),
          eq(schemaPg.migrationStatus.mappingId, mappingId),
          eq(schemaPg.migrationStatus.domain, domain),
        ),
      );
  }

  async getStatus(
    tenantId: TenantId,
    mappingId: MappingId,
  ): Promise<MigrationStatus[]> {
    // Join migration_status with item to derive counts
    const rows = await this.db
      .select({
        status: schemaPg.migrationStatus,
        itemsSynced: sql<number>`COUNT(CASE WHEN ${schemaPg.item.status} IN ('copied', 'updated', 'skipped') THEN 1 END)`,
        itemsFailed: sql<number>`COUNT(CASE WHEN ${schemaPg.item.status} = 'failed' THEN 1 END)`,
        bytesTransferred: sql<number | null>`COALESCE(SUM(CASE WHEN ${schemaPg.item.status} IN ('copied', 'updated', 'skipped') THEN ${schemaPg.item.sizeBytes} ELSE 0 END), 0)`,
      })
      .from(schemaPg.migrationStatus)
      .leftJoin(
        schemaPg.item,
        and(
          eq(schemaPg.item.tenantId, schemaPg.migrationStatus.tenantId),
          eq(schemaPg.item.mappingId, schemaPg.migrationStatus.mappingId),
          eq(schemaPg.item.domain, schemaPg.migrationStatus.domain),
        ),
      )
      .where(
        and(
          eq(schemaPg.migrationStatus.tenantId, tenantId),
          eq(schemaPg.migrationStatus.mappingId, mappingId),
        ),
      )
      .groupBy(
        schemaPg.migrationStatus.id,
        schemaPg.migrationStatus.tenantId,
        schemaPg.migrationStatus.mappingId,
        schemaPg.migrationStatus.domain,
        schemaPg.migrationStatus.state,
        schemaPg.migrationStatus.startedAt,
        schemaPg.migrationStatus.updatedAt,
        schemaPg.migrationStatus.completedAt,
        schemaPg.migrationStatus.lastError,
        schemaPg.migrationStatus.lastErrorCategory,
        schemaPg.migrationStatus.failedSide,
        schemaPg.migrationStatus.lastPassMetrics,
        schemaPg.migrationStatus.pausedReason,
      )
      .orderBy(schemaPg.migrationStatus.domain);

    return rows.map((row) => ({
      id: row.status.id,
      tenantId: row.status.tenantId as TenantId,
      mappingId: row.status.mappingId as MappingId,
      domain: row.status.domain as DiscoveryDomain,
      state: row.status.state as
        | 'pending'
        | 'in_progress'
        | 'completed'
        | 'failed'
        | 'skipped',
      itemsSynced: Number(row.itemsSynced),
      itemsFailed: Number(row.itemsFailed),
      bytesTransferred: Number(row.bytesTransferred ?? 0),
      ...(row.status.lastPassMetrics
        ? { lastPassMetrics: row.status.lastPassMetrics as PassMetrics }
        : {}),
      startedAt: row.status.startedAt instanceof Date
        ? row.status.startedAt.toISOString()
        : row.status.startedAt,
      updatedAt: row.status.updatedAt instanceof Date
        ? row.status.updatedAt.toISOString()
        : row.status.updatedAt,
      completedAt: row.status.completedAt instanceof Date
        ? row.status.completedAt.toISOString()
        : row.status.completedAt ?? undefined,
      lastError: row.status.lastError ?? undefined,
      // Read back through the guard rather than cast: the column is `text`
      // with no CHECK (the six are product vocabulary, revisable without a
      // lock), so a value written by an older or newer build must not become
      // a category the UI has no sentence for.
      ...(isFailureCategory(row.status.lastErrorCategory)
        ? { lastErrorCategory: row.status.lastErrorCategory }
        : {}),
      // Through the guard for the same reason, though here the CHECK already
      // holds the column to two values: the guard is what the type rests on.
      ...(isFailureSide(row.status.failedSide) ? { failedSide: row.status.failedSide } : {}),
      // Through the guard, never cast: `jsonb` accepts whatever the writer
      // put there, and a reason from an older or newer build must not reach a
      // screen with no sentence for it (migration 0041).
      ...(isPauseReason(row.status.pausedReason)
        ? { pausedReason: row.status.pausedReason }
        : {}),
    }));
  }
}
