// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHEN A SHARE MAY BE APPLIED (ADR-0032 §5; workplan 0128 T5, slice 6).
 *
 * A share invite is an announcement that the new system is live, so a share is
 * applied at or after cutover, never before. Since the owner's D8 each data
 * type has its own cutover, so each share waits for its own data type's: a
 * calendar shared with a colleague is announced once the calendars are cut
 * over, while the files keep running as an ordinary sync until theirs.
 * `share_grant.subject` says which data type a share belongs to.
 *
 * At or past its cutover is `cutover`, `done`, or `continuous` (kept in the
 * lane after it). The gate used to allow `done` only, where ADR-0032 §5 says
 * done or cutover: from the cutover on, the new system is the one people use.
 */

import type { DiscoveryDomain } from './discovery.ts';
import type { PathPhaseOf } from './path-phase.ts';

/** The data type a share belongs to, by `share_grant.subject`; undefined for one the gate cannot place. */
export function dataTypeOfShare(subject: string): DiscoveryDomain | undefined {
  switch (subject) {
    case 'mailbox':
      return 'email';
    case 'calendar':
      return 'calendar';
    case 'drive_item':
      return 'file';
    default:
      return undefined;
  }
}

/** The phases at or past a cutover: the new system is live for the data type. */
export const PHASES_PAST_A_CUTOVER: readonly string[] = ['cutover', 'done', 'continuous'];

/**
 * Whether a share may be applied now: its own data type is at or past its
 * cutover, as every gate reads a data type's phase (`readPathPhases`). A share
 * the gate cannot place waits for the whole migration, whose status is at or
 * past its cutover once every data type is.
 */
export function shareMayBeApplied(subject: string, status: string, phaseOf: PathPhaseOf): boolean {
  const domain = dataTypeOfShare(subject);
  return PHASES_PAST_A_CUTOVER.includes(domain === undefined ? status : phaseOf(domain).phase);
}
