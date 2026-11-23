// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the accessibility statement is, for every link the app makes to it
 * (workplan 0145 T9 (b)).
 *
 * ## Not a legal page, so not in `legal-links.ts`'s table
 *
 * The statement is a page of the same public site as the legal texts, and not
 * one of them: nobody accepts it, it has no version, and the site builds it
 * from `site/pages/` and not `site/legal/`. `LEGAL_PAGES` is held to exactly
 * the pages the build renders from `site/legal/`. So the statement has a table
 * of its own here, as the tester guide does (`tester-guide-link.ts`), and the
 * origin from the one place that makes it, `legalSiteFrom` (the setting
 * `VITE_LEGAL_SITE_URL`, or the production site when it is unset). Unlike the
 * guide, every build of the site writes it, so it is linked in every build of
 * the app.
 *
 * Linked beside the other texts the app links outside a form: under the
 * sign-in page, in the menu, and at the foot of the grant page with the
 * privacy policy and the terms (`AccessibilityLink.tsx`).
 *
 * `scripts/a-policy-link-that-answers.unit.test.ts` builds the site and fails
 * when an address below is not the file it writes for that language, or when
 * another shipped file in the web app names the statement's file.
 */

import type { Locale } from '../i18n/strings.ts';
import { legalSiteFrom, type LegalSiteEnv } from './legal-links.ts';

/** The statement's file on the site, per language, as the site build names it (`site/copy.mjs`). */
export const ACCESSIBILITY_FILES: Readonly<Record<Locale, string>> = {
  en: 'accessibility.html',
  nl: 'nl/toegankelijkheid.html',
};

/** See `legal-links.ts`: under vitest, `import.meta.env` is not shared between modules. */
const buildEnv = (): LegalSiteEnv =>
  (import.meta as unknown as { env?: LegalSiteEnv }).env ?? {};

/** The statement's address, in the reader's language. */
export function accessibilityUrl(locale: Locale, source: LegalSiteEnv = buildEnv()): string {
  return `${legalSiteFrom(source)}/${ACCESSIBILITY_FILES[locale]}`;
}
