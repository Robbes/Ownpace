// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT WAITS ON SOMEBODY, COUNTED ONE WAY (workplan 0153 T3).
 *
 * Two places show a count from `GET /api/attention`: a person's card on
 * Migrations (*Needs you: 3*), and the menu beside *Needs you*. They count the
 * same things, so the menu's number is what the cards say added up, plus
 * what belongs to no card:
 *
 * - a migration's failures, deletions and moves waiting, and each data type
 *   whose grace period ended while nobody chose;
 * - the organisation's own decisions about a new mailbox, which belong to no
 *   migration. The read hangs them on the first migration that reports, or
 *   on the organisation's line when none does, so no card claims them and
 *   the menu counts them wherever they ride.
 *
 * Not *Ready to switch*, which a card says in its stage, and not the sharing
 * checklist, which is worked after finishing and blocks nothing.
 *
 * A COUNT THAT COULD NOT BE TAKEN IS UNDEFINED, never zero (hard rule 9): a
 * failed read, or a queue the read could not look in (a blind spot).
 */
import type { MappingAttention, TenantAttention } from '@openmig/shared';

/** What waits on a person about one of their migrations. Undefined when it could not be counted. */
export function waitingOn(a: MappingAttention | undefined, attentionRead: boolean): number | undefined {
  if (!attentionRead) return undefined;
  if (!a) return 0;
  if ((a.blindSpots?.length ?? 0) > 0) return undefined;
  return a.failuresWaiting + a.deletionsWaiting + a.movesWaiting + (a.graceEnded?.length ?? 0);
}

/** Everything waiting on the organisation, for the menu. Undefined when any of it could not be counted. */
export function needsYouTotal(attention: {
  readonly mappings: readonly MappingAttention[];
  readonly tenant?: TenantAttention;
}): number | undefined {
  if ((attention.tenant?.blindSpots?.length ?? 0) > 0) return undefined;
  let total = attention.tenant?.pendingDecisions ?? 0;
  for (const m of attention.mappings) {
    const n = waitingOn(m, true);
    if (n === undefined) return undefined;
    total += n + m.pendingDecisions;
  }
  return total;
}
