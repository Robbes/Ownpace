// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Links to the legal texts, where a tester's data is collected (workplan 0139
 * T4).
 *
 * The request form, the Connect buttons and the report form each collect
 * something a tester types or grants, and each links the texts that say what
 * we do with it, beside what it collects. This draws those links once, so the
 * three cannot drift into three ways of doing it:
 *
 * - **The address is `services/legal-links.ts`'s**, in the reader's language,
 *   so `VITE_LEGAL_SITE_URL` moves these links with the grant page's and the
 *   acceptance screen's. No address is written here
 *   (`scripts/a-policy-link-that-answers.unit.test.ts` refuses one).
 * - **Each text is named as it names itself**: the title of the page the link
 *   opens, which the acceptance screen (0139 T3) already uses
 *   (`acceptance.doc.*`), so a tester meets one name per text wherever it is
 *   linked.
 * - **A new tab.** Every one of these sits beside a form or a button that is
 *   half done when somebody stops to read: a request being typed, a consent
 *   about to start, a report with a screenshot attached. Leaving the page
 *   would lose that. The tab is said to a screen reader, as the acceptance
 *   screen says it, and `noopener` keeps the text's page from reaching back.
 *
 * Always shown, also before the texts are published (the owner, 2026-10-03:
 * *"Always shown"*): the links point at the site's address, the test site on
 * the OTA stack and `www.ownpace.eu` on live, and testers arrive only after
 * publication.
 */

import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { legalUrl, type LegalPage } from '../services/legal-links.ts';

/** Each text's own title, in the reader's language: the acceptance screen's names. */
const NAME: Readonly<Record<LegalPage, StringKey>> = {
  privacy: 'acceptance.doc.privacy',
  terms: 'acceptance.doc.terms',
  alpha: 'acceptance.doc.alpha',
};

export const LegalLinks: React.FC<{
  /** The texts to link, in the order they are read. */
  readonly pages: ReadonlyArray<LegalPage>;
}> = ({ pages }) => {
  const { t, locale } = useLocale();
  return (
    <>
      {pages.map((page, i) => (
        <React.Fragment key={page}>
          {i > 0 && ' · '}
          <a
            href={legalUrl(page, locale)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            {t(NAME[page])}
            <span className="sr-only"> {t('acceptance.newTab')}</span>
          </a>
        </React.Fragment>
      ))}
    </>
  );
};

export default LegalLinks;
