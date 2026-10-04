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
 *
 * **The alpha note draws its links here too** (workplan 0131 T1 (b)): the
 * Alpha conditions, and after them the tester guide (0144 T1), with `guide`.
 * The guide is not a legal text, so it is not a `LegalPage`; its address is
 * `services/tester-guide-link.ts`'s, on the same site, and it is named by its
 * own title (`alpha.note.guide`) and opens the same way.
 */

import React from 'react';
import { useLocale } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { legalUrl, type LegalPage } from '../services/legal-links.ts';
import { testerGuideUrl } from '../services/tester-guide-link.ts';

/** Each text's own title, in the reader's language: the acceptance screen's names. */
const NAME: Readonly<Record<LegalPage, StringKey>> = {
  privacy: 'acceptance.doc.privacy',
  terms: 'acceptance.doc.terms',
  alpha: 'acceptance.doc.alpha',
};

export const LegalLinks: React.FC<{
  /** The texts to link, in the order they are read. */
  readonly pages: ReadonlyArray<LegalPage>;
  /** Also the tester guide, after them: the alpha note's links (0131 T1 (b)). */
  readonly guide?: boolean;
}> = ({ pages, guide = false }) => {
  const { t, locale } = useLocale();
  const links: ReadonlyArray<{ key: string; href: string; name: StringKey }> = [
    ...pages.map((page) => ({ key: page, href: legalUrl(page, locale), name: NAME[page] })),
    ...(guide ? [{ key: 'guide', href: testerGuideUrl(locale), name: 'alpha.note.guide' as const }] : []),
  ];
  return (
    <>
      {links.map((link, i) => (
        <React.Fragment key={link.key}>
          {i > 0 && ' · '}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            {t(link.name)}
            <span className="sr-only"> {t('acceptance.newTab')}</span>
          </a>
        </React.Fragment>
      ))}
    </>
  );
};

export default LegalLinks;
