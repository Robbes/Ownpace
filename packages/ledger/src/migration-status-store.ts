// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import {
  type MigrationStatusStore,
  type MigrationStatus,
  type TenantId,
  type MappingId,
  type PassMetrics,
} from '@openmig/shared';
import type { PgDatabase } from './db';
import { eq, and, sql } from 'drizzle-orm';
import * as schemaPg from './schema-pg';

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
    domain: 'email' | 'calendar' | 'contact' | 'file',
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
    domain: 'email' | 'calendar' | 'contact' | 'file',
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'in_progress',
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

  async markCompleted(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
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

  async markFailed(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: 'email' | 'calendar' | 'contact' | 'file',
    error: string,
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'failed',
        lastError: error,
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
    domain: 'email' | 'calendar' | 'contact' | 'file',
  ): Promise<void> {
    await this.db
      .update(schemaPg.migrationStatus)
      .set({
        state: 'skipped',
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
        schemaPg.migrationStatus.lastPassMetrics,
      )
      .orderBy(schemaPg.migrationStatus.domain);

    return rows.map((row) => ({
      id: row.status.id,
      tenantId: row.status.tenantId as TenantId,
      mappingId: row.status.mappingId as MappingId,
      domain: row.status.domain as 'email' | 'calendar' | 'contact' | 'file',
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
    }));
  }
}
