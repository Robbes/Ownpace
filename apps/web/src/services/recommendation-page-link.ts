// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the site's page about a recommendation is, for the two places the
 * app links it (workplan 0177 §11): the door, `/code`, and the giver's page,
 * each as *Read more about a recommendation*. It is the page 0172 wrote as
 * the gift page, and its two addresses stay (`site/copy.mjs`'s `gift`).
 *
 * ## A link that answers only on a site built for the Alpha
 *
 * The site writes the page only when it is built for the Alpha
 * (`ALPHA_ONLY` in `site/build.mjs`), as it writes the tester guide. So, as
 * the guide's link (`tester-guide-link.ts`), it is shown only where `isAlpha`
 * says the Alpha runs, and its origin is the one place that makes it,
 * `legalSiteFrom`: the setting `VITE_LEGAL_SITE_URL`, or the production site
 * when it is unset.
 *
 * `site/site.unit.test.ts` builds the site for the Alpha and fails when a
 * file below is not one it writes for that language.
 */

import type { Locale } from '../i18n/strings.ts';
import { legalSiteFrom, type LegalSiteEnv } from './legal-links.ts';

/** The page's file on the site, per language, as the site build names it (`site/copy.mjs`). */
export const RECOMMENDATION_PAGE_FILES: Readonly<Record<Locale, string>> = {
  en: 'gift.html',
  nl: 'nl/cadeau.html',
};

/** See `legal-links.ts`: under vitest, `import.meta.env` is not shared between modules. */
const buildEnv = (): LegalSiteEnv =>
  (import.meta as unknown as { env?: LegalSiteEnv }).env ?? {};

/** The page's address, in the reader's language. */
export function recommendationPageUrl(locale: Locale, source: LegalSiteEnv = buildEnv()): string {
  return `${legalSiteFrom(source)}/${RECOMMENDATION_PAGE_FILES[locale]}`;
}

/** The site's own address as a person types it, for the card's *Who Ownpace is*: no scheme. */
export function siteAsTyped(source: LegalSiteEnv = buildEnv()): string {
  return legalSiteFrom(source).replace(/^https?:\/\//, '');
}
