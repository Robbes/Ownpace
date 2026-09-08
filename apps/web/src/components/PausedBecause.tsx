// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE "paused, and why" — one component, two positions.
 *
 * A migration that is not moving used to be silent about it. Three different
 * things can stop one, and the screen could express none of them: a domain
 * that stopped at its source's daily download ceiling was written to the
 * ledger as `completed`, with a "last synced" time beside a half-copied
 * mailbox; an operator hold had nowhere to put a sentence at all.
 *
 * Rendering both through one component is the point. They are one state with
 * a reason attached, not two unrelated notions the reader has to reconcile:
 * the same word, the same colour, the same fold, whether the reason belongs to
 * one data type (a ceiling, on that row) or to the platform (a hold, once,
 * above everything).
 *
 * ## Amber, not red
 *
 * Nothing failed. Nothing is owed a retry. The cursors are where the last pass
 * left them and copying continues by itself. Colouring this as a problem is
 * how somebody comes to distrust a migration that is fine — hard rule 9 cuts
 * both ways — so it is a note, with `role="note"`, in the same amber the
 * counted-earlier line uses.
 *
 * ## The reason is on screen; the reassurance folds
 *
 * Task #124's precedent: a hover fails on touch, on a keyboard and in a screen
 * reader, so the sentence itself is always visible. What folds under "Why?" is
 * the longer answer to *should I be worried* — which nobody reads until they
 * ask, which is exactly what 0118's copy budget exempts a `.why` key for.
 */

import React from 'react';
import type { PauseReason } from '@openmig/shared';
import { useT, useFormatters } from '../i18n/index.tsx';
import { PAUSE_KEY, PAUSE_WHY_KEY } from '../i18n/pause-key.ts';
import { Hint } from './Hint.tsx';

export const PausedBecause: React.FC<{
  reason: PauseReason;
  /** Its own block above the strip (`banner`), or a line inside a row. */
  variant?: 'banner' | 'inline';
}> = ({ reason, variant = 'inline' }) => {
  const t = useT();
  const { dateTime } = useFormatters();

  // The sentence, through the one map, with whatever the reason carries.
  const sentence = ((): string => {
    if (reason.kind === 'operator-hold') {
      // An operator's own words REPLACE the default rather than joining it:
      // two sentences saying nearly the same thing is how a notice stops
      // being read.
      return reason.message ?? t(PAUSE_KEY[reason.kind]);
    }
    if (!reason.windowResetsAt) {
      // No window to name. "When it resets" rather than a time we would have
      // had to invent — see PauseReason.windowResetsAt. The one sentence with
      // no entry in PAUSE_KEY, because it is the same reason said differently
      // rather than a reason of its own.
      return t('pause.ceiling.unknown', { provider: reason.provider });
    }
    return t(PAUSE_KEY[reason.kind], {
      provider: reason.provider,
      resets: dateTime(reason.windowResetsAt),
    });
  })();

  const body = (
    <Hint
      text={sentence}
      why={t(PAUSE_WHY_KEY[reason.kind])}
      tone="caution"
      className={variant === 'banner' ? 'mt-1' : 'mt-0.5'}
    />
  );

  if (variant === 'inline') {
    return (
      <div role="note" className="w-full text-amber-800">
        {body}
      </div>
    );
  }

  return (
    <div
      role="note"
      className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <p className="font-medium">{t('pause.hold.heading')}</p>
      {body}
      {reason.kind === 'operator-hold' && (
        <p className="mt-1 text-amber-800">
          {t('pause.hold.since')} {dateTime(reason.since)}
        </p>
      )}
    </div>
  );
};

export default PausedBecause;
