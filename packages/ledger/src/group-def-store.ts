// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `group_def`'s first reader and writer (workplan 0027 T1).
 *
 * The table has been in the schema since ledger v1 with nothing on either
 * side of it — one of the unowned features the 2026-08-02 sweep found, and
 * the reason the scope manifest's two §14.1 rows had no code behind them.
 *
 * The property this file exists to guarantee is **convergence**: discovery
 * re-runs, and the second pass must update the group it already knows rather
 * than shadow it with a second row (hard rule 1). That is the unique index's
 * doing, not a read-then-write — `uk_group_def_source_address` (migration
 * 0006) turns the re-insert into a conflict and `upsert` answers it.
 *
 * What it deliberately does NOT do is move `status` backwards. A group that
 * T2 has already recreated on the target (`created`) stays created when
 * discovery sees it again; re-running discovery must not make the appliance
 * think it has work to redo, and rule 2 says a re-run never undoes an action.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from './db-types.ts';
import * as schemaPg from './schema-pg.ts';
import type { TenantId } from '@openmig/shared';

/** §14.1's two patterns. `undefined` means discovery could not tell. */
export type SharedAddressPattern = 'shared_s' | 'distribution_d';

/** One shared address as discovery found it. */
export interface DiscoveredGroupInput {
  readonly sourceConnectionId: string;
  readonly address: string;
  readonly sourceGroupId?: string;
  readonly displayName?: string;
  readonly pattern?: SharedAddressPattern;
  /** The member addresses. Pattern D's whole payload; empty is legal. */
  readonly members: readonly string[];
  /**
   * Whether the member list above is an answer. Defaults to true; pass false
   * when the source could not be asked, so an unread list is never mistaken
   * for an empty group (rule 9).
   */
  readonly membersKnown?: boolean;
}

export interface GroupDefRow {
  readonly id: string;
  readonly sourceConnectionId: string;
  readonly address: string;
  readonly sourceGroupId?: string;
  readonly displayName?: string;
  readonly pattern?: SharedAddressPattern;
  readonly members: readonly string[];
  readonly membersKnown: boolean;
  readonly targetGroupRef?: string;
  readonly status: 'pending' | 'created' | 'error';
}

export class PgGroupDefStore {
  private readonly db: PgDatabase;
  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * Record a discovered group, or update the one already recorded.
   *
   * Returns whether the row was created, so a caller can tell "new since last
   * time" from "seen again" without a second query — the same distinction the
   * decision store's `raise` makes, and for the same reason: only the first
   * sighting is news.
   */
  async upsert(
    tenantId: TenantId,
    input: DiscoveredGroupInput,
  ): Promise<{ readonly row: GroupDefRow; readonly created: boolean }> {
    const address = input.address.trim().toLowerCase();
    const values = {
      tenantId,
      sourceConnectionId: input.sourceConnectionId,
      address,
      sourceGroupId: input.sourceGroupId ?? null,
      displayName: input.displayName ?? null,
      pattern: input.pattern ?? null,
      members: [...input.members],
      membersKnown: input.membersKnown ?? true,
    };

    const inserted = await this.db
      .insert(schemaPg.groupDef)
      .values(values)
      .onConflictDoNothing()
      .returning();

    const fresh = inserted[0];
    if (fresh) return { row: toGroupDefRow(fresh), created: true };

    // Seen before: refresh what the directory says now. `status` and
    // `targetGroupRef` are untouched on purpose — those are T2's record of
    // what was done on the target, and discovery has no business rewinding it.
    const updated = await this.db
      .update(schemaPg.groupDef)
      .set({
        sourceGroupId: values.sourceGroupId,
        displayName: values.displayName,
        pattern: values.pattern,
        members: values.members,
        membersKnown: values.membersKnown,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schemaPg.groupDef.tenantId, tenantId),
          eq(schemaPg.groupDef.sourceConnectionId, input.sourceConnectionId),
          eq(schemaPg.groupDef.address, address),
        ),
      )
      .returning();

    const row = updated[0];
    if (!row) {
      // Neither inserted nor updated means the conflict was on something we
      // did not target — never silently report success (rule 9).
      throw new Error(`group_def upsert for ${address} matched no row`);
    }
    return { row: toGroupDefRow(row), created: false };
  }

  /**
   * Record the pattern an owner chose for an address (workplan 0028 T3).
   *
   * By ADDRESS rather than by row id, and across every source connection in
   * the tenant, because that is the shape of the question that was asked:
   * *do recipients jointly handle info@, or does each of them receive the
   * mail?* is a fact about how the organisation uses that address, not about
   * which directory we happened to read it from. Two sources being
   * consolidated hold two rows for it and the answer is true of both.
   *
   * Returns how many rows it set, so a caller can tell a real write from an
   * answer that landed on nothing (an address discovery has since stopped
   * seeing) rather than reporting success either way.
   */
  async setPattern(
    tenantId: TenantId,
    address: string,
    pattern: SharedAddressPattern,
  ): Promise<number> {
    const updated = await this.db
      .update(schemaPg.groupDef)
      .set({ pattern, updatedAt: sql`now()` })
      .where(
        and(
          eq(schemaPg.groupDef.tenantId, tenantId),
          eq(schemaPg.groupDef.address, address.trim().toLowerCase()),
        ),
      )
      .returning();
    return updated.length;
  }

  /** Every shared address discovered for this tenant. */
  async list(tenantId: TenantId): Promise<readonly GroupDefRow[]> {
    const rows = await this.db
      .select()
      .from(schemaPg.groupDef)
      .where(eq(schemaPg.groupDef.tenantId, tenantId));
    return rows.map(toGroupDefRow);
  }
}

type Row = typeof schemaPg.groupDef.$inferSelect;

function toGroupDefRow(row: Row): GroupDefRow {
  return {
    id: row.id,
    sourceConnectionId: row.sourceConnectionId,
    address: row.address,
    ...(row.sourceGroupId ? { sourceGroupId: row.sourceGroupId } : {}),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.pattern ? { pattern: row.pattern } : {}),
    members: Array.isArray(row.members) ? (row.members as string[]) : [],
    membersKnown: row.membersKnown,
    ...(row.targetGroupRef ? { targetGroupRef: row.targetGroupRef } : {}),
    status: row.status,
  };
}
