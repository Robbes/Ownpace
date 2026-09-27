// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `/.well-known/security.txt` (RFC 9116), written by the site build
 * (workplan 0139 T9).
 *
 * ONE CHANNEL, STATED THE SAME WAY EVERYWHERE. The owner decided on 2026-09-27
 * that a vulnerability is reported through the GitHub advisory form that
 * `SECURITY.md` names, with `support@ownpace.eu` as the fallback for someone
 * without a GitHub account. The two `Contact` lines are in that order, because
 * RFC 9116 reads the first as the preferred one.
 *
 * `Expires` is required, and the RFC asks for less than a year: the build
 * writes 180 days from the day it runs, and every deploy rebuilds the site.
 *
 * `Canonical` names the production site, and only a `--public` build writes
 * it: a test host serves the same file under another name, where a canonical
 * naming production would be false.
 */

import { SUPPORT_EMAIL } from './prices.mjs';

/** The channel `SECURITY.md` names first. */
export const ADVISORY_FORM = 'https://github.com/Robbes/Ownpace/security/advisories/new';

/** The policy the file points at. */
export const POLICY_URL = 'https://github.com/Robbes/Ownpace/blob/main/SECURITY.md';

/** Where the production site is served. */
export const PUBLIC_SITE_URL = 'https://www.ownpace.eu';

/** How far ahead `Expires` is written. */
export const EXPIRES_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The file, for a build that runs at `now`. */
export function securityTxt({ now, isPublic }) {
  const expires = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + EXPIRES_AFTER_DAYS * DAY_MS);
  return [
    `Contact: ${ADVISORY_FORM}`,
    `Contact: mailto:${SUPPORT_EMAIL}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en, nl',
    ...(isPublic ? [`Canonical: ${PUBLIC_SITE_URL}/.well-known/security.txt`] : []),
    `Policy: ${POLICY_URL}`,
    '',
  ].join('\n');
}
