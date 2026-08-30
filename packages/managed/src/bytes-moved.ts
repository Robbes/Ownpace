// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The cumulative first-copy meter (workplan 0109 T3).
 *
 * ADR-0014's data axis: cumulative, first successful copy only, never falls —
 * it sets the FLOOR under a tenant's tier, so the number must be one an
 * invoice can stand on months later. The engine computes `firstCopyBytes` per
 * pass at the exact moment of each target CREATE (a neutral statistic — the
 * appliance gets the same number and ignores it); the managed worker hands it
 * here after the pass, and this store adds it in ONE statement, the shape
 * 0090's budget proved for monotonic counters.
 *
 * The migration's trigger refuses any lowering for every role, so a bug here
 * can under-count (the safe direction) but never shrink what a customer
 * already moved into a smaller-looking bill for us and a dispute for them.
 */

import { eq, sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import type { TenantId } from '@openmig/shared';
import { bytesMoved } from './schema-managed.ts';

export class PgBytesMovedStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * Add one pass's first-copy bytes to the tenant's lifetime total.
   *
   * Zero adds nothing and touches nothing — most delta passes copy nothing
   * new, and writing a zero row for every one of them would make absence
   * (nothing has ever moved) indistinguishable from activity.
   */
  async add(tenantId: TenantId, bytes: number): Promise<void> {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    await this.db.execute(
      sql`INSERT INTO bytes_moved (tenant_id, bytes, updated_at)
          VALUES (${tenantId}, ${Math.trunc(bytes)}, now())
          ON CONFLICT (tenant_id) DO UPDATE SET
            bytes = bytes_moved.bytes + EXCLUDED.bytes,
            updated_at = now()`,
    );
  }

  /** The lifetime total, 0 when nothing has ever moved. */
  async total(tenantId: TenantId): Promise<bigint> {
    const rows = await this.db
      .select({ bytes: bytesMoved.bytes })
      .from(bytesMoved)
      .where(eq(bytesMoved.tenantId, tenantId));
    return rows[0]?.bytes ?? 0n;
  }
}
