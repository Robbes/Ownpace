// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, BEFORE START, IN ONE SENTENCE WITH ITS REASON (workplan 0154 T3 (a)).
 *
 * The rule is `timeBeforeStart` in `packages/shared`; this says it in the
 * reader's language: *"About 4 to 5 days, because Google lets a mailbox
 * download 2.5 GB a day."*, or *"Depends on the provider; we will know after
 * the first hour."* The ceiling is read from the same constant the rule
 * divides by, in the reader's decimals, so the sentence cannot state a number
 * the arithmetic did not use.
 */
import React from 'react';
import { GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY, type TimeBeforeStart } from '@openmig/shared';
import { useLocale } from '../i18n/index.tsx';

export const TimeBeforeStartLine: React.FC<{ time: TimeBeforeStart; className?: string }> = ({
  time,
  className = 'text-sm text-gray-700',
}) => {
  const { t, locale } = useLocale();
  const ceiling = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY / 1_000_000_000,
  );
  let sentence: string;
  switch (time.kind) {
    case 'gmailDays':
      sentence = t('timeLeft.gmailDays', { low: time.low, high: time.high, ceiling });
      break;
    case 'gmailWithinADay':
      sentence = t('timeLeft.gmailWithinADay', { ceiling });
      break;
    case 'notKnownYet':
      sentence = t('timeLeft.notKnownYet');
      break;
  }
  const files = time.kind !== 'notKnownYet' && time.filesToo ? ` ${t('timeLeft.filesLater')}` : '';
  return (
    <p className={className} data-time-before-start={time.kind}>
      <span className="font-medium text-gray-900">{t('timeLeft.label')}</span> {sentence}
      {files}
    </p>
  );
};
