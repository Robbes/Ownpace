// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What the appliance's digest collects, separated from what it reads from
 * (workplan 0030 T3, tested after the fact — the same treatment the managed
 * loop got, and for the same reason).
 *
 * The appliance and managed collect differently on purpose: the appliance
 * walks the mappings it was configured with and asks each one's own lifecycle
 * status, while managed enumerates tenants from a database. What they must
 * NOT differ on is what any of it MEANS — so both hand their rows to
 * `summariseQueues` in shared, and both apply the rules pinned here:
 *
 *  - a `done` mapping is skipped BEFORE its reads (a finished migration keeps
 *    its history but stops nagging);
 *  - a read that failed is a BLIND SPOT carrying the server's own words, not
 *    a zero — "I found nothing" and "I could not look" must never arrive as
 *    the same email (hard rule 9);
 *  - the pending-decision count is taken ONCE per tenant, because a decision
 *    about a new mailbox belongs to no mapping yet and two mappings each
 *    claiming it would double it.
 *
 * The seam is here rather than inline in `start()` because that function is
 * a thousand lines of wiring, and a rule buried in wiring is a rule with no
 * test.
 */

import {
  summariseQueues,
  reportsToDigest,
  type MappingAttention,
  type DeletionRow,
  type MoveRow,
  type FailureRow,
} from '@openmig/shared';

/** One configured mapping, as the collector needs to see it. */
export interface CollectMapping {
  /** The id an owner sees and the digest prints. */
  readonly mappingId: string;
  /** The tenant this mapping belongs to — the scope of the decision count. */
  readonly tenantId: string;
}

export interface CollectDeps {
  readonly mappings: readonly CollectMapping[];
  /** The mapping's own lifecycle status, or a throw this turns into a blind spot. */
  status(mapping: CollectMapping): Promise<string | undefined>;
  listDeletions(mapping: CollectMapping): Promise<readonly DeletionRow[]>;
  listMoves(mapping: CollectMapping): Promise<readonly MoveRow[]>;
  listFailures(mapping: CollectMapping): Promise<readonly FailureRow[]>;
  countPendingDecisions(tenantId: string): Promise<number>;
}

/** What the digest would say right now. Never throws for one queue's sake. */
export async function collectAttention(deps: CollectDeps): Promise<MappingAttention[]> {
  const out: MappingAttention[] = [];
  const decisionsCountedFor = new Set<string>();

  for (const mapping of deps.mappings) {
    const blindSpots: string[] = [];
    const guarded = async <T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await read();
      } catch (err) {
        blindSpots.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
        return fallback;
      }
    };

    const status = await guarded(
      "the migration's own status",
      () => deps.status(mapping),
      undefined,
    );
    // Checked before the reads, so a finished migration costs the digest four
    // queries less as well as costing its owner no email.
    if (!reportsToDigest(status)) continue;

    const deletions = await guarded('the deletions queue', () => deps.listDeletions(mapping), []);
    const moves = await guarded('the moves queue', () => deps.listMoves(mapping), []);
    const failures = await guarded('the failures queue', () => deps.listFailures(mapping), []);

    // Once per tenant. The FIRST reportable mapping of a tenant carries the
    // count; the rest report zero rather than repeating it.
    const first = !decisionsCountedFor.has(mapping.tenantId);
    decisionsCountedFor.add(mapping.tenantId);
    const pendingDecisions = first
      ? await guarded('the decision queue', () => deps.countPendingDecisions(mapping.tenantId), 0)
      : 0;

    out.push(
      summariseQueues(mapping.mappingId, {
        deletions,
        moves,
        failures,
        pendingDecisions,
        status,
        blindSpots,
      }),
    );
  }

  return out;
}
