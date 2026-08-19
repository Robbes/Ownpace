// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import {
  type DecisionStore,
  type DecisionRow,
  type DecisionStatus,
  type RaiseDecisionInput,
  type TenantId,
  type MappingId,
} from '@openmig/shared';
import type { PgDatabase } from './db.ts';
import { eq, and, desc } from 'drizzle-orm';
import * as schemaPg from './schema-pg.ts';

/**
 * PostgreSQL implementation of {@link DecisionStore} (workplan 0028 T1) —
 * the `decision` table's first reader and writer since ledger v1 shipped it.
 *
 * Idempotent raise is the database's doing, not a read-then-insert: the
 * partial unique index `uk_decision_pending_subject` (migration 0005) makes
 * the insert of an already-open question a conflict, which `raise` answers by
 * returning the existing pending row. Tenant-scoped by RLS like every other
 * table — production callers run inside `withTenant` as `app_user`.
 */
export class PgDecisionStore implements DecisionStore {
  private readonly db: PgDatabase;

  constructor(db: PgDatabase) {
    this.db = db;
  }

  async raise(input: RaiseDecisionInput): Promise<{ decision: DecisionRow; created: boolean }> {
    const inserted = await this.db
      .insert(schemaPg.decision)
      .values({
        tenantId: input.tenantId,
        mappingId: input.mappingId ?? null,
        category: input.category,
        subjectKey: input.subjectKey,
        summary: input.summary,
        detail: input.detail ?? {},
        proposedDefault: input.proposedDefault ?? null,
      })
      // The partial index only covers PENDING rows, so this is precisely
      // "while the question is open, asking again is a no-op" — an answered
      // subject inserts a fresh row, which is the intended history shape.
      .onConflictDoNothing()
      .returning();

    const row = inserted[0];
    if (row) return { decision: toDecisionRow(row), created: true };

    // Conflict: the open question already exists — hand it back unchanged.
    const existing = await this.db
      .select()
      .from(schemaPg.decision)
      .where(
        and(
          eq(schemaPg.decision.tenantId, input.tenantId),
          eq(schemaPg.decision.category, input.category),
          eq(schemaPg.decision.subjectKey, input.subjectKey),
          eq(schemaPg.decision.status, 'pending'),
        ),
      );
    const found = existing[0];
    if (!found) {
      // The pending row vanished between conflict and read (resolved in the
      // gap). Saying nothing would make the detector's raise disappear —
      // retry once; a second conflict-and-gone in a row is genuinely
      // exceptional and surfaces (rule 9).
      const retried = await this.db
        .insert(schemaPg.decision)
        .values({
          tenantId: input.tenantId,
          mappingId: input.mappingId ?? null,
          category: input.category,
          subjectKey: input.subjectKey,
          summary: input.summary,
          detail: input.detail ?? {},
          proposedDefault: input.proposedDefault ?? null,
        })
        .onConflictDoNothing()
        .returning();
      const retriedRow = retried[0];
      if (!retriedRow) {
        throw new Error(
          `decision raise for ${input.category}/${input.subjectKey}: conflict but no pending row, twice`,
        );
      }
      return { decision: toDecisionRow(retriedRow), created: true };
    }
    return { decision: toDecisionRow(found), created: false };
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: DecisionStatus; mappingId?: MappingId },
  ): Promise<ReadonlyArray<DecisionRow>> {
    const conditions = [eq(schemaPg.decision.tenantId, tenantId)];
    if (filter?.status) conditions.push(eq(schemaPg.decision.status, filter.status));
    if (filter?.mappingId) conditions.push(eq(schemaPg.decision.mappingId, filter.mappingId));

    const rows = await this.db
      .select()
      .from(schemaPg.decision)
      .where(and(...conditions))
      .orderBy(desc(schemaPg.decision.createdAt));
    return rows.map(toDecisionRow);
  }

  async resolve(
    tenantId: TenantId,
    decisionId: string,
    resolution: Readonly<Record<string, unknown>>,
    resolvedBy: string,
  ): Promise<DecisionRow | undefined> {
    return this.close(tenantId, decisionId, 'resolved', resolution, resolvedBy);
  }

  /**
   * Close a decision the way a POLICY PRESET said to, without asking anybody
   * (workplan 0028 T5).
   *
   * A separate status from `resolved` on purpose: the history has to show
   * whether a person decided this or a standing rule did. Six months later,
   * "who agreed to this?" is a question the audit trail must be able to
   * answer, and `resolved` would claim a human did.
   *
   * Still goes through the same conditional UPDATE, so it can only close a
   * PENDING row — a preset cannot overwrite an answer somebody already gave.
   */
  async autoResolve(
    tenantId: TenantId,
    decisionId: string,
    resolution: Readonly<Record<string, unknown>>,
  ): Promise<DecisionRow | undefined> {
    return this.close(tenantId, decisionId, 'auto_resolved', resolution, 'policy-preset');
  }

  async dismiss(
    tenantId: TenantId,
    decisionId: string,
    dismissedBy: string,
  ): Promise<DecisionRow | undefined> {
    return this.close(tenantId, decisionId, 'dismissed', undefined, dismissedBy);
  }

  /**
   * The one write both closings share. `status = 'pending'` in the WHERE is
   * the contract: an already-answered decision is never overwritten — the
   * second answer gets `undefined` back, not a quiet win.
   */
  private async close(
    tenantId: TenantId,
    decisionId: string,
    status: 'resolved' | 'auto_resolved' | 'dismissed',
    resolution: Readonly<Record<string, unknown>> | undefined,
    by: string,
  ): Promise<DecisionRow | undefined> {
    const updated = await this.db
      .update(schemaPg.decision)
      .set({
        status,
        resolution: resolution ?? null,
        resolvedAt: new Date(),
        resolvedBy: by,
      })
      .where(
        and(
          eq(schemaPg.decision.tenantId, tenantId),
          eq(schemaPg.decision.id, decisionId),
          eq(schemaPg.decision.status, 'pending'),
        ),
      )
      .returning();
    const row = updated[0];
    return row ? toDecisionRow(row) : undefined;
  }
}

function toDecisionRow(row: typeof schemaPg.decision.$inferSelect): DecisionRow {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    ...(row.mappingId ? { mappingId: row.mappingId as MappingId } : {}),
    category: row.category,
    summary: row.summary,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    ...(row.proposedDefault ? { proposedDefault: row.proposedDefault } : {}),
    ...(row.subjectKey ? { subjectKey: row.subjectKey } : {}),
    status: row.status,
    ...(row.resolution ? { resolution: row.resolution as Record<string, unknown> } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    ...(row.resolvedBy ? { resolvedBy: row.resolvedBy } : {}),
  };
}
