// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * "Connecting Google during the Alpha? Read this first: When you connect
 * Google" (the owner, 2026-10-18; the UX sweep's journey-google-alpha-hurdles).
 *
 * While Ownpace's app at Google is in Google's test phase, Google lets in only
 * the addresses on its list of test users, and first warns that it has not
 * checked the app. A tester whose address is not on the list ends on Google's
 * *Access blocked* page. The tester guide says what to do; the app said
 * nothing. The owner chose the lighter of two options: not the guide's
 * sentences repeated here, but one line that sends the reader to them, the
 * guide's own section on connecting Google, in the reader's language
 * (`testerGuideSectionUrl`).
 *
 * Where it stands: above the first Google sign-in a person meets. On
 * *Connect your accounts* (Start a migration, step 4) that is above the cards,
 * when one of them is Google's, and Google's cards come first there (the
 * tiles' order). On the grant page it is above the Google button, and on a
 * person's link above the first account's.
 *
 * Quiet, not the welcome's amber box: the box is the members' welcome
 * (`AlphaNote`), and a second one in its shape would read as the same kind of
 * thing. `role="note"`, as the welcome's, so it is told apart from the form
 * around it without being read out as an alert. The link opens in a new tab,
 * said, as every link to the site's pages is (`LegalLinks`): it sits beside a
 * sign-in that is half done.
 *
 * Only while the deployment runs the Alpha, and never on the appliance
 * (`isAlpha`, the welcome's own rule). Whether the line goes when Google's
 * client leaves its test phase mid-Alpha is the owner's call (0140 T1 (b));
 * the bundle cannot see that state, so the Alpha is the rule until then.
 */

import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import { testerGuideSectionUrl } from '../services/tester-guide-link.ts';
import { isAlpha } from './AlphaNote.tsx';

export const AlphaGoogleLine: React.FC<{
  /** Spacing from what surrounds it, which differs per page; the shape does not. */
  className?: string;
}> = ({ className }) => {
  const { t, locale } = useLocale();
  if (!isAlpha()) return null;

  const shape = 'text-sm text-gray-700';
  return (
    <p role="note" className={className ? `${className} ${shape}` : shape}>
      {t('alpha.google.lead')}{' '}
      <a
        href={testerGuideSectionUrl(locale, 'google')}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-700 underline underline-offset-2 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
      >
        {t('alpha.google.guide')}
        <span className="sr-only"> {t('common.newTab')}</span>
      </a>
    </p>
  );
};

export default AlphaGoogleLine;
