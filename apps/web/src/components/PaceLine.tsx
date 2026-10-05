// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE PACE, SAID WHERE A MIGRATION IS READ (workplan 0157 T5).
 *
 * On Free, outside the alpha, a migration runs one pass a day, and a pass
 * stops taking work at 50 minutes (`PASS_SOFT_DEADLINE_MS`). Without this line
 * a person on Free would watch a first copy move once a day and not know why:
 * *"Free: one pass a day, up to 50 minutes. Next pass: 6 Oct 2026, 07:12."*,
 * and the way to more, a higher tier, on the Billing page.
 *
 * The migration's page says its own next pass; the person's page says the pace
 * of each of their migrations, without one time for several. On a paid tier,
 * and during the alpha, there is no pace to say, and nothing is drawn: the
 * stage and the time left say how the copy goes.
 *
 * The time-left line above it already counts in days on Free: it measures from
 * how far apart the passes started (`timeWhileCopying`), so a day apart reads
 * as days.
 */
import React from 'react';
import { Link } from 'react-router';
import { useFormatters, useT } from '../i18n/index.tsx';

/** Free's pace, one pass a day (`FREE_PASS_EVERY_MINUTES` in `@openmig/managed`). */
const ONE_DAY_MINUTES = 24 * 60;

export const PaceLine: React.FC<{
  /** The least minutes between two passes, from the API (`pace`). */
  leastMinutesBetweenPasses: number | undefined;
  /** When the pace lets the next pass run; absent or null when it may run now. */
  nextPassAt?: string | null;
  /** Said of all of a person's migrations, rather than of one. */
  eachMigration?: boolean;
  className?: string;
}> = ({ leastMinutesBetweenPasses, nextPassAt, eachMigration = false, className = 'text-sm text-gray-700' }) => {
  const t = useT();
  const { dateTime } = useFormatters();
  if (leastMinutesBetweenPasses === undefined || leastMinutesBetweenPasses < ONE_DAY_MINUTES) return null;
  return (
    <p className={className} data-pace="free">
      <span className="font-medium text-gray-900">{t('pace.free.label')}</span>{' '}
      {t(eachMigration ? 'pace.free.eachMigration' : 'pace.free.oneMigration')}
      {nextPassAt ? ` ${t('pace.free.next', { time: dateTime(nextPassAt) })}` : ''}{' '}
      <Link to="/billing" className="text-blue-700 hover:underline">
        {t('pace.free.higher')}
      </Link>
    </p>
  );
};

export default PaceLine;
