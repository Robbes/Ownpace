// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, DURING THE COPY, IN ONE SENTENCE (workplan 0154 T3 (b)).
 *
 * The rule is `timeWhileCopying` in `packages/shared`; this says it in the
 * reader's language: *"About 4 to 8 days more, from the last 3 passes."*, or,
 * before three passes, *"We will know after three passes; 1 so far."* Where
 * the provider asked us to slow down it says so first: *"Slowed by Microsoft
 * 365."* The slowing is honoured, and already in the rate (hard rule 4).
 */
import React from 'react';
import type { TimeWhileCopying } from '@openmig/shared';
import { useT } from '../i18n/index.tsx';

export const TimeWhileCopyingLine: React.FC<{
  time: TimeWhileCopying;
  /** Who slowed it, by name, where the rate says it was slowed. */
  provider: string;
  className?: string;
}> = ({ time, provider, className = 'text-sm text-gray-700' }) => {
  const t = useT();
  let sentence: string;
  if (time.kind === 'afterThreePasses') {
    sentence = t('timeLeft.afterThreePasses', { n: time.passesSoFar });
  } else {
    const vars = { low: time.low, high: time.high, n: time.passes };
    const range =
      time.low === 0
        ? t(time.unit === 'days' ? 'timeLeft.copying.upToDays' : 'timeLeft.copying.upToHours', vars)
        : t(time.unit === 'days' ? 'timeLeft.copying.days' : 'timeLeft.copying.hours', vars);
    sentence = time.slowed ? `${t('timeLeft.slowedBy', { provider })} ${range}` : range;
  }
  return (
    <p className={className} data-time-while-copying={time.kind}>
      <span className="font-medium text-gray-900">{t('timeLeft.label')}</span> {sentence}
    </p>
  );
};
