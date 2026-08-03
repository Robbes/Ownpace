// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The drift decision queue's port (SAD §11.1/§11.2, workplan 0028 T1).
 *
 * The mapping-level lifecycle queue ABOVE the item-level ones
 * (deletions/moves/failures): drift the sync notices — a new mailbox on the
 * source, an ambiguous shared-address pattern — becomes a question the owner
 * answers in the UI, instead of a guess. The schema shipped in ledger v1;
 * this port is its first contract. First slice covers two categories
 * (`new_mailbox`, `shared_address_pattern`) — the enum lists all ten because
 * the TABLE does, not because detectors exist; a category with no detector
 * simply never gets raised.
 */

import type { TenantId, MappingId } from './ids';

export const DECISION_CATEGORIES = [
  'new_mailbox',
  'deleted_mailbox',
  'quota',
  'shared_address_pattern',
  'offboarding',
  'alias_removed',
  'new_domain',
  'rules_detected',
  'target_drift',
  'other',
] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export type DecisionStatus = 'pending' | 'resolved' | 'auto_resolved' | 'dismissed';

export interface DecisionRow {
  readonly id: string;
  readonly tenantId: TenantId;
  /** Absent for tenant-level drift (a new mailbox belongs to no mapping yet). */
  readonly mappingId?: MappingId;
  readonly category: DecisionCategory;
  /** One operator-facing sentence: what was noticed. The server's words. */
  readonly summary: string;
  /** Structured facts behind the summary, category-shaped. */
  readonly detail: Readonly<Record<string, unknown>>;
  /** What answering "do the default" would do, when the detector proposes one. */
  readonly proposedDefault?: string;
  /**
   * The detector's stable identifier for what this is about — what makes
   * re-raising idempotent. Absent only for categories with no natural subject.
   */
  readonly subjectKey?: string;
  readonly status: DecisionStatus;
  /** The owner's answer, recorded verbatim at resolve time. */
  readonly resolution?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  /** Who answered: a member's user id, or the preset that auto-answered. */
  readonly resolvedBy?: string;
}

export interface RaiseDecisionInput {
  readonly tenantId: TenantId;
  readonly mappingId?: MappingId;
  readonly category: DecisionCategory;
  readonly subjectKey: string;
  readonly summary: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly proposedDefault?: string;
}

export interface DecisionStore {
  /**
   * Raise a decision, idempotently: while a PENDING decision exists for the
   * same (tenant, category, subjectKey), raising it again returns that row
   * unchanged — enforced by the database (partial unique index, migration
   * 0005), not by a read that can race. A subject the owner already answered
   * MAY be raised again: only the open question is unique (rule 1 — every
   * detector re-run converges on the same pending set).
   */
  raise(input: RaiseDecisionInput): Promise<{ decision: DecisionRow; created: boolean }>;

  /** List decisions, newest first. No filter = everything (the screen's read). */
  list(
    tenantId: TenantId,
    filter?: { status?: DecisionStatus; mappingId?: MappingId },
  ): Promise<ReadonlyArray<DecisionRow>>;

  /**
   * Record the owner's answer on a PENDING decision. Returns the updated row,
   * or undefined when there is nothing to resolve — unknown id, or already
   * answered (an answer must never silently overwrite an earlier one).
   */
  resolve(
    tenantId: TenantId,
    decisionId: string,
    resolution: Readonly<Record<string, unknown>>,
    resolvedBy: string,
  ): Promise<DecisionRow | undefined>;

  /** Close a PENDING decision without acting. Same not-pending contract as resolve. */
  dismiss(tenantId: TenantId, decisionId: string, dismissedBy: string): Promise<DecisionRow | undefined>;
}
