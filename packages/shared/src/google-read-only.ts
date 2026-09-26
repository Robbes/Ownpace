// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH GOOGLE CONSENTS GOOGLE ITSELF HOLDS TO READING (workplan 0144 T3).
 *
 * Ownpace only reads, from every source: no source connector sends anything
 * that writes. That is the software's promise. Whether the PERMISSION a person
 * grants is read-only is a different fact, and it is Google's: the scope the
 * product asks for decides it, and Google's consent screen describes it.
 *
 *   mail       `https://mail.google.com/`, the only scope Google accepts for
 *              IMAP. Google describes it as reading, sending and permanently
 *              deleting all mail.
 *   calendar   `auth/calendar`. Whether `calendar.readonly` works on Google's
 *              CalDAV is the owner test runbook's question zero, unanswered.
 *   contact    `auth/carddav`. Google publishes no read-only CardDAV scope.
 *   file       `drive.readonly`. Read-only by Google's rule.
 *   task       `tasks.readonly`. Read-only by Google's rule.
 *
 * The readiness review of 2026-09-23 found the product calling all five
 * "read-only". A person reads that word as a property of the permission,
 * because that is what it means on a consent screen, and one click later
 * Google's own screen says the opposite for mail, calendars and contacts.
 *
 * ## Why a table per data type, here, and not the scopes
 *
 * The scopes live in `packages/orchestration` (`GOOGLE_SCOPES_ASKED_BY_DOMAIN`,
 * with `GOOGLE_SCOPES_READ_ONLY_AT_GOOGLE` beside it), which the browser does
 * not import. The wizard's line beside *Connect with Google* needs the answer
 * before any scope is built, from the data types ticked. So this is the one
 * reading the browser has, and two tests hold it to the scope tables:
 * `domains-to-scopes.unit.test.ts` at the table, and
 * `grant-link-readiness.unit.test.ts` through the ask a grant link really makes.
 *
 * A `Record` over every data type rather than a list of the read-only ones, so
 * a sixth type does not compile until somebody says which it is. And a new
 * `true` needs Google's word for it, not a narrower wish: the day the calendar
 * asks for `calendar.readonly`, both scope tables and this row change together,
 * or those tests fail.
 */

import type { DiscoveryDomain } from './discovery.ts';

/** Per data type: whether the scope asked for it is one Google holds to reading. */
export const GOOGLE_READ_ONLY_AT_GOOGLE: Readonly<Record<DiscoveryDomain, boolean>> = {
  email: false,
  calendar: false,
  contact: false,
  file: true,
  task: true,
};

/**
 * Whether a Google consent for these data types asks for a permission that
 * also allows changes. Nothing asked is nothing to describe, so `false`.
 */
export function googleConsentAllowsChanges(asked: ReadonlyArray<DiscoveryDomain>): boolean {
  return asked.some((domain) => !GOOGLE_READ_ONLY_AT_GOOGLE[domain]);
}
