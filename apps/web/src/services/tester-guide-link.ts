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
 * On a site built without the alpha setting this address is a 404. So it is
 * linked only where the alpha runs: by the alpha note (`AlphaNote.tsx`, through
 * `LegalLinks`), which stands on every signed-in page, on `/login`,
 * `/request-access`, `/invitations` and the acceptance screen, and only when
 * `isAlpha` says so (0131 T1 (b)). Always shown there, also before the site is
 * published (the owner, 2026-10-03: *"Always shown"*). The access-granted mail
 * and the invitation link it too, during the alpha; the API makes their copy
 * (`TESTER_GUIDE_FILE` and `testerGuideUrl` in
 * `packages/shared/src/privacy-policy-link.ts`). A stack that runs the alpha
 * builds its site with the same setting (`deploy/compose/www.yml`).
 *
 * The Dutch file was `nl/alfa-handleiding.html` until 2026-10-04, when the
 * owner chose the spelling *Alpha* (#1439). It had never been published, so
 * nothing redirects the old name.
 *
 * `scripts/a-policy-link-that-answers.unit.test.ts` builds the site for the
 * alpha and fails when an address below is not the file it writes for that
 * language, when the mails' copy disagrees, or when another shipped file in
 * the web app names the guide's file.
 */

import type { Locale } from '../i18n/strings.ts';
import { legalSiteFrom, type LegalSiteEnv } from './legal-links.ts';

/** The guide's file on the site, per language, as the site build names it (`site/copy.mjs`). */
export const TESTER_GUIDE_FILES: Readonly<Record<Locale, string>> = {
  en: 'alpha-guide.html',
  nl: 'nl/alpha-handleiding.html',
};

/** See `legal-links.ts`: under vitest, `import.meta.env` is not shared between modules. */
const buildEnv = (): LegalSiteEnv =>
  (import.meta as unknown as { env?: LegalSiteEnv }).env ?? {};

/** The guide's address, in the reader's language. */
export function testerGuideUrl(locale: Locale, source: LegalSiteEnv = buildEnv()): string {
  return `${legalSiteFrom(source)}/${TESTER_GUIDE_FILES[locale]}`;
}
