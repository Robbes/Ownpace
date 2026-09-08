// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sentence for each reason a migration is paused (migration 0041 / 0023).
 *
 * Its own file for the reason `failure-key.ts` is: the same reasons appear on
 * the customer's progress strip and, for the hold, on a banner across every
 * screen. One map means editing the sentence changes it everywhere at once,
 * and nobody ends up reading a different explanation from the person they
 * phoned about it.
 *
 * Exhaustive by type, so a third reason cannot reach a screen with nothing to
 * say. Note what is NOT here: the pass deadline. It has no customer sentence
 * on purpose — it happens on every pass of every large migration, and a notice
 * that appears constantly is one that is ignored on the day it matters. It is
 * reported in full in the run log.
 */

import type { PauseReason } from '@openmig/shared';
import type { StringKey } from './strings.ts';

export const PAUSE_KEY: Record<PauseReason['kind'], StringKey> = {
  'daily-download-ceiling': 'pause.ceiling',
  'operator-hold': 'pause.hold.default',
};

/**
 * What folds open under it — the longer answer to "should I be worried?".
 *
 * On screen rather than in a hover, and folded rather than always visible:
 * task #124's precedent (a hover fails on touch, keyboard and a screen
 * reader) plus 0118's copy budget, which exempts `.why` keys exactly because
 * they are not read until somebody asks.
 */
export const PAUSE_WHY_KEY: Record<PauseReason['kind'], StringKey> = {
  'daily-download-ceiling': 'pause.ceiling.why',
  'operator-hold': 'pause.hold.why',
};
