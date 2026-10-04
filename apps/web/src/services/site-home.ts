// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The way back to the public site, from the two pages a person meets before
 * they are inside the app: `/login` and `/request-access` (workplan 0152 T9).
 *
 * The origin is `legal-links.ts`'s: the setting `VITE_LEGAL_SITE_URL`, or the
 * production site when it is unset. So one value moves every link the app
 * makes to the site, and a test stack's sign-in page leads to its test site.
 * No host is written here (`scripts/a-policy-link-that-answers.unit.test.ts`
 * refuses one in any shipped file but that module).
 *
 * The address is the site's home page in the reader's language: the site
 * writes its Dutch pages under `/nl/` (`localeRoot` in `site/copy.mjs`). The
 * name is the site's host without `www.`, as a person says it.
 */

import type { Locale } from '../i18n/strings.ts';
import { legalSiteFrom, type LegalSiteEnv } from './legal-links.ts';

/** See `legal-links.ts`: under vitest, `import.meta.env` is not shared between modules. */
const buildEnv = (): LegalSiteEnv =>
  (import.meta as unknown as { env?: LegalSiteEnv }).env ?? {};

/** The site's home page, in the reader's language. */
export function siteHomeUrl(locale: Locale, source: LegalSiteEnv = buildEnv()): string {
  const origin = legalSiteFrom(source);
  return locale === 'nl' ? `${origin}/nl/` : `${origin}/`;
}

/** The site as a person says it: its host, without `www.`. */
export function siteName(source: LegalSiteEnv = buildEnv()): string {
  return new URL(legalSiteFrom(source)).host.replace(/^www\./, '');
}
