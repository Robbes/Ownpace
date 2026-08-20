// Copyright 2026 The Ownpace authors (Apache-2.0)

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

import type { TenantId, MappingId } from './ids.ts';

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

/**
 * What a source came back with when asked to list the directory (0028 T2).
 *
 * A UNION, not an array, and that is the whole design. A source that cannot
 * enumerate — every IMAP source, and a Graph connection with only delegated
 * permissions — must report that it could not look. An empty list from a
 * source that never looked reads exactly like a tenant where nothing changed,
 * and those two mean opposite things: "you are covered" versus "you are not
 * watching" (hard rule 9).
 *
 * It lives in shared because the connector that produces it and the detector
 * that consumes it are in different packages, and neither should own the
 * other's vocabulary.
 */
export type DirectoryListing =
  /** It looked. These are the mailboxes it found. */
  | { readonly kind: 'listed'; readonly addresses: readonly string[] }
  /** It could not look, and this is why — in the source's own words. */
  | { readonly kind: 'not_enumerable'; readonly reason: string };

/**
 * Whether a shared address carries a message store (workplan 0027 T1).
 *
 * §14.1's whole question turns on this: a store means there are messages to
 * copy (Pattern S), no store means what migrates is the definition and the
 * member list (Pattern D). The three-way shape is deliberate — `unknown` is
 * an answer, not a failure, and it is the one that becomes a
 * `shared_address_pattern` decision instead of a guess.
 *
 * Source-neutral on purpose. Translating a directory's vocabulary into these
 * three words is the connector's job (Microsoft's `Unified` group type means
 * `has_store`); turning them into a §14.1 pattern is `@openmig/core`'s.
 */
export type GroupStore = 'has_store' | 'no_store' | 'unknown';

/** §14.1's two patterns, as `mailbox_mapping.pattern` records them. */
export type SharedAddressPattern = 'shared_s' | 'distribution_d';

/** One shared address as a source's directory described it (0027 T1). */
export interface DiscoveredGroup {
  /** The directory's stable id — survives a rename, unlike the address. */
  readonly id: string;
  readonly address: string;
  readonly displayName?: string;
  readonly store: GroupStore;
  /**
   * Who is in it, or why that could not be found out. Pattern D recreates a
   * group from exactly this list, so a failed read must not arrive as an
   * empty membership (hard rule 9) — hence the same union as the directory.
   */
  readonly members: DirectoryListing;
}

/**
 * What a source came back with when asked to list its groups (0027 T1).
 *
 * The same union as {@link DirectoryListing} and for the same reason: IMAP
 * has no directory of groups at all, and a delegated Graph connection cannot
 * read `/groups`. Both must report that they could not look — an empty list
 * would tell an owner their organisation has no shared addresses.
 */
export type GroupListing =
  | { readonly kind: 'listed'; readonly groups: readonly DiscoveredGroup[] }
  | { readonly kind: 'not_enumerable'; readonly reason: string };

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
