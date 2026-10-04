// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Where the privacy policy is, for the mail the managed service sends to people
 * items were shared with (workplan 0139 T4; the owner's
 * privacy-share-mail-notice (a), 2026-09-28; privacy §4.6).
 *
 * ## One setting, read by both halves
 *
 * The web app's links to the legal pages come from one build argument,
 * `VITE_LEGAL_SITE_URL` (`apps/web/src/services/legal-links.ts`, 0139 T10
 * (a)). This mail is rendered by the API, which that build argument never
 * reaches, so `managed.yml` hands the same `.env` key to the api service as
 * `LEGAL_SITE_URL`. Unset or blank is the production site, as it is for the
 * web app: the OTA stack sets its test site once, and both halves follow.
 *
 * ## Why the file is written here as well
 *
 * `legal-links.ts` is the web bundle's, and `vite.config.ts` loads it at build
 * time to refuse a value the links cannot use; making it import this package
 * would load the package index into every web build, the appliance's
 * included. So the privacy page's file per language is written here too, and
 * `scripts/a-policy-link-that-answers.unit.test.ts` holds the two modules to
 * each other and to the files the site build writes: for every value, this
 * address is the web's, and a value the web refuses is refused here.
 *
 * ## A value the link cannot use is refused
 *
 * Anything but a bare `http(s)` origin throws, naming both the API's name and
 * the `.env` key the operator sets. The API asks once at start
 * (`apps/api/src/index.ts`), so the operator meets it there, and again for
 * each press, before anything is sent.
 *
 * Only the managed service sends the line. The appliance's owner sends this
 * mail from their own box, and our policy is not theirs, so the appliance
 * hands the press no address (`announceByHandShares`'s `privacyPolicy`).
 *
 * ## The Alpha conditions too, for the grant mail
 *
 * The access-granted mail links the Alpha conditions while the deployment runs
 * the alpha (0139 T4, with 0131 T1: *"the access-granted mail's sentence
 * carries the same link"*). The api sends that mail as well, so its address is
 * made here, from the same key and by the same rule: `alphaConditionsUrl`. The
 * file per language is written out a second time for the reason above, and the
 * same guard holds it to the web's `LEGAL_FILES` and to what the site build
 * writes. Only the managed service sends a grant mail; the appliance lets
 * nobody in.
 *
 * ## The tester guide too, for the grant mail and the invitation
 *
 * During the alpha the access-granted mail and the invitation (0156 T3) end
 * the alpha paragraph with the conditions' address and then the tester
 * guide's (0131 T1 (b), 0144 T1): `testerGuideUrl`, from the same key and by
 * the same rule. The guide is not a legal text, so the web keeps its file in
 * `apps/web/src/services/tester-guide-link.ts`, not in `LEGAL_FILES`; it is
 * written out here a second time for the reason above, and the same guard
 * holds it to that table and to the files an alpha build of the site writes.
 * Only a site built for the alpha writes it (`ALPHA_ONLY` in
 * `site/build.mjs`), and only the managed service sends either mail with it.
 */

import type { NotificationLocale } from './notifications.ts';

/** What the API reads; `managed.yml` fills it from the web build's `.env` key. */
export interface LegalSiteForMailEnv {
  readonly LEGAL_SITE_URL?: string;
}

/** The production site, where the texts are published (0139 T10). */
export const PRODUCTION_LEGAL_SITE = 'https://www.ownpace.eu';

/** The privacy policy's file on the site, per language, as the site build names it. */
export const PRIVACY_POLICY_FILE: Readonly<Record<NotificationLocale, string>> = {
  en: 'privacy.html',
  nl: 'nl/privacy.html',
};

function refused(value: string, why: string): Error {
  return new Error(
    `LEGAL_SITE_URL is "${value}", which ${why}. managed.yml fills it from VITE_LEGAL_SITE_URL ` +
      `in .env: set that to the site's origin alone, such as ${PRODUCTION_LEGAL_SITE}, or leave ` +
      'it empty for that one, then rebuild the web image and restart the api.',
  );
}

/** The site's origin: the setting, or the production site when it is unset or blank. */
export function legalSiteForMailFrom(env: LegalSiteForMailEnv): string {
  const value = env.LEGAL_SITE_URL?.trim();
  if (!value) return PRODUCTION_LEGAL_SITE;
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

/** The privacy policy's address, in the mail's language. */
export function privacyPolicyUrl(locale: NotificationLocale, env: LegalSiteForMailEnv): string {
  return `${legalSiteForMailFrom(env)}/${PRIVACY_POLICY_FILE[locale]}`;
}

/** The Alpha conditions' file on the site, per language, as the site build names it. */
export const ALPHA_CONDITIONS_FILE: Readonly<Record<NotificationLocale, string>> = {
  en: 'alpha.html',
  nl: 'nl/alpha.html',
};

/** The Alpha conditions' address, in the mail's language (the grant mail and the invitation). */
export function alphaConditionsUrl(locale: NotificationLocale, env: LegalSiteForMailEnv): string {
  return `${legalSiteForMailFrom(env)}/${ALPHA_CONDITIONS_FILE[locale]}`;
}

/** The tester guide's file on the site, per language, as an alpha build of the site names it. */
export const TESTER_GUIDE_FILE: Readonly<Record<NotificationLocale, string>> = {
  en: 'alpha-guide.html',
  nl: 'nl/alpha-handleiding.html',
};

/** The tester guide's address, in the mail's language (the grant mail and the invitation). */
export function testerGuideUrl(locale: NotificationLocale, env: LegalSiteForMailEnv): string {
  return `${legalSiteForMailFrom(env)}/${TESTER_GUIDE_FILE[locale]}`;
}
