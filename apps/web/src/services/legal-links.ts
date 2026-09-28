// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the legal pages are, for every link the app makes to them (workplan
 * 0139 T10 (a)).
 *
 * ## One setting
 *
 * The public site (`site/build.mjs`) is a separate deploy from this app, on its
 * own host: `www.ownpace.eu` for production, a test site for the OTA stack. So
 * the host is a build argument, `VITE_LEGAL_SITE_URL`, which `managed.yml`
 * passes to the web build as it passes `VITE_OIDC_ISSUER`. Unset or blank is
 * the production site: the address the grant page linked before this was a
 * setting, and the one the appliance's bundle, which is told nothing, keeps.
 *
 * ## One table
 *
 * The file names are the site build's, per language (`site/copy.mjs`'s
 * `files`). They are written out here rather than imported, because `site/`
 * imports nothing and this bundle does not reach into `site/`.
 * `scripts/a-policy-link-that-answers.unit.test.ts` runs the site build and
 * fails when an address below is not a file it writes for that language and
 * that page, or when it renders a legal page this table does not link. The
 * site's nginx adds no `.html`, so `/privacy` is a 404 there: the grant page
 * linked it until #1137.
 *
 * ## Not links yet
 *
 * The alpha conditions and the sub-processor list are not rendered by the site
 * build yet, so they have no address here, and a screen cannot link them. Their
 * text comes from 0139 T2 and T5; rendering them is 0139 T10's, with T2's guard
 * for the conditions. `NOT_BUILT_YET` names them. When the build renders one,
 * move it into `LEGAL_PAGES` with its file per language; the guard fails until
 * then.
 *
 * ## A value the links cannot use is refused
 *
 * The value reaches an `href`. Anything but a bare `http(s)` origin throws,
 * naming the setting: a scheme that is not http(s), no scheme, or a path, a
 * query or a fragment. The site writes its pages at the root of its host (its
 * own links are `/privacy.html`), so a path would name files that are not
 * there. A wrong address that looks like a link is worse than no link.
 *
 * The owner meets the refusal at build time, not a recipient at run time:
 * `vite.config.ts` runs `legalSiteFrom` on the value the bundle would carry and
 * stops the build. The grant page reads this module while it renders, and the
 * web app has no error boundary, so a refusal there would blank the page.
 */

import type { Locale } from '../i18n/strings.ts';

export interface LegalSiteEnv {
  readonly VITE_LEGAL_SITE_URL?: string;
}

/** The production site, where the texts are published (0139 T10). */
export const DEFAULT_LEGAL_SITE_URL = 'https://www.ownpace.eu';

/** The legal pages the site build writes today, by the build's own page keys. */
export const LEGAL_PAGES = ['privacy', 'terms'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

/**
 * Pages that will be linked and are not yet, because the site build does not
 * write them. Each names where its text comes from and who renders it.
 */
export const NOT_BUILT_YET = {
  conditions: 'the alpha conditions: text from 0139 T2 (site/legal/alpha.md), rendered by 0139 T10',
  subprocessors:
    'the sub-processor list: text from 0139 T5 (site/legal/subprocessors.md), rendered by 0139 T10',
} as const;
export type LegalPageNotBuiltYet = keyof typeof NOT_BUILT_YET;

/** Each page's file on the site, per language, as the site build names it. */
export const LEGAL_FILES: Readonly<Record<Locale, Readonly<Record<LegalPage, string>>>> = {
  en: { privacy: 'privacy.html', terms: 'terms.html' },
  nl: { privacy: 'nl/privacy.html', terms: 'nl/voorwaarden.html' },
};

/**
 * `import.meta.env` is not shared between modules under vitest, so the work is
 * a pure function of an environment and only the default reaches for the
 * build's (the shape `oidc.ts` and `idp-console.ts` take, for the same reason).
 */
const buildEnv = (): LegalSiteEnv =>
  (import.meta as unknown as { env?: LegalSiteEnv }).env ?? {};

function refused(value: string, why: string): Error {
  return new Error(
    `VITE_LEGAL_SITE_URL is "${value}", which ${why}. Set it to the site's origin ` +
      `alone, such as ${DEFAULT_LEGAL_SITE_URL}, or leave it empty for that one, and ` +
      'rebuild the web image.',
  );
}

/** The site's origin: the setting, or the production site when it is unset. */
export function legalSiteFrom(source: LegalSiteEnv): string {
  const value = source.VITE_LEGAL_SITE_URL?.trim();
  if (!value) return DEFAULT_LEGAL_SITE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw refused(value, 'is not an absolute address');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw refused(value, 'is not an http(s) address');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw refused(value, 'has more than an origin, and the site writes its pages at the root');
  }
  return url.origin;
}

/** One page's address, in the reader's language. */
export function legalUrl(
  page: LegalPage,
  locale: Locale,
  source: LegalSiteEnv = buildEnv(),
): string {
  return `${legalSiteFrom(source)}/${LEGAL_FILES[locale][page]}`;
}

/**
 * Every page's address, in the reader's language: `legalUrl` for each of
 * `LEGAL_PAGES`, so there is one way an address is made.
 */
export function legalLinks(
  locale: Locale,
  source: LegalSiteEnv = buildEnv(),
): Readonly<Record<LegalPage, string>> {
  return Object.fromEntries(
    LEGAL_PAGES.map((page) => [page, legalUrl(page, locale, source)]),
  ) as Record<LegalPage, string>;
}
