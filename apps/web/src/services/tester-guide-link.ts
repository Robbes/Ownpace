// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the tester guide is, for every link the app makes to it (workplan 0144
 * T1).
 *
 * ## Not a legal page, so not in `legal-links.ts`'s table
 *
 * The guide is a page of the same public site as the legal texts, and it is
 * not one of them: nobody accepts it, it has no version, the site builds it
 * from `site/pages/` and not `site/legal/`, and only when the site is built for
 * the alpha (`OWNPACE_STAGE=alpha`; `ALPHA_ONLY` in `site/build.mjs`).
 * `LEGAL_PAGES` is held to exactly the pages the build renders from
 * `site/legal/`, in every build, and the grant page shows every one of them.
 * So the guide has a table of its own here, and the origin from the one place
 * that makes it, `legalSiteFrom` (the setting `VITE_LEGAL_SITE_URL`, or the
 * production site when it is unset). A value that function refuses is refused
 * here too, naming the setting.
 *
 * ## A link that answers only on a site built for the alpha
 *
 * On a site built without the alpha setting this address is a 404. A screen
 * that links it shows the link only where the alpha runs (`isAlpha` in
 * `components/AlphaNote.tsx`), and only once the site is published. Nothing
 * links it yet: the alpha note's link (0131 T1 (b)), the request page and the
 * access-granted mail follow (0144 Status, 2026-10-03).
 *
 * `scripts/a-policy-link-that-answers.unit.test.ts` builds the site for the
 * alpha and fails when an address below is not the file it writes for that
 * language, or when another shipped file names the guide's file.
 */

import type { Locale } from '../i18n/strings.ts';
import { legalSiteFrom, type LegalSiteEnv } from './legal-links.ts';

/** The guide's file on the site, per language, as the site build names it (`site/copy.mjs`). */
export const TESTER_GUIDE_FILES: Readonly<Record<Locale, string>> = {
  en: 'alpha-guide.html',
  nl: 'nl/alfa-handleiding.html',
};

/** See `legal-links.ts`: under vitest, `import.meta.env` is not shared between modules. */
const buildEnv = (): LegalSiteEnv =>
  (import.meta as unknown as { env?: LegalSiteEnv }).env ?? {};

/** The guide's address, in the reader's language. */
export function testerGuideUrl(locale: Locale, source: LegalSiteEnv = buildEnv()): string {
  return `${legalSiteFrom(source)}/${TESTER_GUIDE_FILES[locale]}`;
}
