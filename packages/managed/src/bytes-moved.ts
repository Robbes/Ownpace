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
 *
 * ## The alpha's data does not count (managed 0040)
 *
 * The owner, 2026-10-04: *"In total for ever, and the alpha's data doesn't
 * count"*. The total stays the record of what was moved; `alpha_bytes` rises
 * with it while the stage is `alpha`, and what a ceiling, a hold or a tier
 * counts is the difference (`counted`). Nobody marks the alpha's end: the
 * share simply stops rising when the stage changes.
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
  async add(tenantId: TenantId, bytes: number, stage: { readonly inTheAlpha: boolean } = { inTheAlpha: false }): Promise<void> {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    const n = Math.trunc(bytes);
    // During the alpha the alpha's share rises with the total, so none of it counts.
    const alpha = stage.inTheAlpha ? n : 0;
    await this.db.execute(
      sql`INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes, updated_at)
          VALUES (${tenantId}, ${n}, ${alpha}, now())
          ON CONFLICT (tenant_id) DO UPDATE SET
            bytes = bytes_moved.bytes + EXCLUDED.bytes,
            alpha_bytes = bytes_moved.alpha_bytes + EXCLUDED.alpha_bytes,
            updated_at = now()`,
    );
  }

  /** The lifetime total, 0 when nothing has ever moved: the record, the alpha's share included. */
  async total(tenantId: TenantId): Promise<bigint> {
    return (await this.read(tenantId)).total;
  }

  /** What counts toward a ceiling, a hold and a tier: the total less what the alpha moved. */
  async counted(tenantId: TenantId): Promise<bigint> {
    return (await this.read(tenantId)).counted;
  }

  /** The total, the alpha's share, and what counts; all 0 when nothing has ever moved. */
  async read(tenantId: TenantId): Promise<{ total: bigint; inTheAlpha: bigint; counted: bigint }> {
    const rows = await this.db
      .select({ bytes: bytesMoved.bytes, alphaBytes: bytesMoved.alphaBytes })
      .from(bytesMoved)
      .where(eq(bytesMoved.tenantId, tenantId));
    const total = rows[0]?.bytes ?? 0n;
    const inTheAlpha = rows[0]?.alphaBytes ?? 0n;
    return { total, inTheAlpha, counted: total - inTheAlpha };
  }
}
