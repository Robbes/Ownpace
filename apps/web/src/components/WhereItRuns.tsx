// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *OWNPACE RUNS IN {COUNTRY}.* (workplan 0176 D16 (a)): one fixed sentence
 * under the first line of a person's link page, and of *Everything on one
 * page*, with the country's name in the reader's language. The country is the
 * deployment's one setting (`services/where-it-runs.ts`); unset, this draws
 * nothing at all, and on the appliance it never draws.
 *
 * READ HERE, DIRECTLY, AND NOT IN THE SERVICE. Vite replaces
 * `import.meta.env.VITE_OWNPACE_COUNTRY` at build time, and written out like
 * this `vi.stubEnv` reaches it too, as it reaches the stage in `AlphaNote.tsx`.
 * A `.ts` file cannot say it this way: the root typecheck has no Vite types.
 */
import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import { isSelfHost } from '../services/edition.ts';
import { whereItRuns } from '../services/where-it-runs.ts';

/** Where the service runs, as this bundle was built to say it; null when it says nothing. */
export function useWhereItRuns(): string | null {
  const { locale } = useLocale();
  return whereItRuns(locale, import.meta.env.VITE_OWNPACE_COUNTRY, isSelfHost());
}

/** The sentence, in a paragraph of its own; nothing when the deployment says nowhere. */
export const WhereItRuns: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useLocale();
  const country = useWhereItRuns();
  if (country === null) return null;
  return (
    <p className={className} data-where-it-runs>
      {t('grant.person.runsIn', { country })}
    </p>
  );
};
