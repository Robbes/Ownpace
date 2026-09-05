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
 * six sentences was edited — the customer reading one remedy while the person
 * they phoned reads another is worse than the operator seeing nothing, because
 * both of them would believe they were looking at the same screen.
 *
 * Exhaustive by type, so a seventh category cannot reach either screen with
 * nothing to say.
 */

import type { FailureCategory, FailureSide } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export const FAILURE_KEY: Record<FailureCategory, StringKey> = {
  auth_expired: 'failure.authExpired',
  rate_limited: 'failure.rateLimited',
  quota_exceeded: 'failure.quotaExceeded',
  target_refused: 'failure.targetRefused',
  network: 'failure.network',
  unknown: 'failure.unknown',
};

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
