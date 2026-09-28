// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The remedy sentence for each failure category (workplan 0110 T3).
 *
 * ## Why this is its own file
 *
 * It began inside `LiveProgress.tsx`, which is the customer's screen. The
 * operator's support screen (0110 T4) shows the same categories, and the
 * owner's reason for wanting that surface at all was: *"people expect me to be
 * able to see what they see in case I'm contacted."*
 *
 * A second copy of this map would make that false the first time one of the
 * nine sentences was edited — the customer reading one remedy while the person
 * they phoned reads another is worse than the operator seeing nothing, because
 * both of them would believe they were looking at the same screen.
 *
 * Exhaustive by type, so a tenth category cannot reach either screen with
 * nothing to say. That is not decoration: adding `source_refused` and
 * `format_refused` on 2026-09-17, and `policy_refused` on 2026-09-18, turned
 * this file and its sibling red before a line of UI was touched, which is the
 * whole of how a new category gets a sentence.
 */

import type { FailureCategory, FailureSide } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export const FAILURE_KEY: Record<FailureCategory, StringKey> = {
  auth_expired: 'failure.authExpired',
  rate_limited: 'failure.rateLimited',
  quota_exceeded: 'failure.quotaExceeded',
  policy_refused: 'failure.policyRefused',
  too_large: 'failure.tooLarge',
  source_refused: 'failure.sourceRefused',
  target_refused: 'failure.targetRefused',
  format_refused: 'failure.formatRefused',
  network: 'failure.network',
  unknown: 'failure.unknown',
};

/**
 * THE REMEDY FOR ONE ITEM'S CATEGORY, ON THE MIGRATION IT BELONGS TO (workplan
 * 0150 D9, the owner's choice of 2026-09-26).
 *
 * The category alone chose it until a second source could state
 * `policy_refused`. Drive's sentence for it names Drive's own setting, *Export
 * format for Google files*, and a Dropbox migration has no such setting: its
 * Paper docs are refused because this service does not export them yet
 * (0150 T5). So a Dropbox migration reads its own sentence, which names no
 * setting until 0150 T3 adds one, and every other migration reads the one
 * above, word for word as the owner worded Drive's.
 *
 * `sourceKind` is the failures queue's (`FailuresQueue.sourceKind`), absent
 * from a server that predates it. Every screen that shows an ITEM's remedy
 * asks here; the three that show a data type's category index the map above
 * directly, because that category never holds `policy_refused`
 * (`a-remedy-chosen-by-source` holds both halves).
 */
export function remedyKey(category: FailureCategory, sourceKind?: string): StringKey {
  if (category === 'policy_refused' && sourceKind === 'dropbox') {
    return 'failure.policyRefused.dropbox';
  }
  return FAILURE_KEY[category];
}

/**
 * And which SIDE it happened on, when the pass could tell (workplan 0094 T5,
 * second slice) — one map for the same two screens, for the same reason.
 * Absent means "the pass could not tell", and the screens then say nothing
 * about the side rather than guessing.
 */
export const FAILURE_SIDE_KEY: Record<FailureSide, StringKey> = {
  source: 'failure.side.source',
  target: 'failure.side.target',
};
