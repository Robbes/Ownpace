// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION THAT WAS CLOSED (workplan 0085 T2; the owner's report of
 * 2026-09-28).
 *
 * Closing an organisation stops everything that starts work, re-arms it, or
 * uses the access the organisation gave: the tick, a pass already under way,
 * the builders of every reader, and every door that would do one of those.
 * Reading, export, the reopen and the erasure stay open. The alpha conditions
 * promise it: "If you close your account, nothing uses it from then on"
 * (`site/legal/alpha.md` §10).
 *
 * This is the one sentence all of them say, in both languages, beside each
 * other (`docs/i18n-prose-boundary.md`, class 4). A door knows both days and
 * names them. A builder, which runs in the shared packages and cannot read
 * the managed edition's `tenant_closure`, knows neither and says so without
 * them. The days are UTC calendar dates, the same in both languages, as every
 * date the erasure is named by (`erasure-timeline.ts`).
 */

import type { BilingualRefusal } from './credential-refusals.ts';

/** The stable code every refusal for a closed organisation carries. */
export const ACCOUNT_CLOSED = 'account_closed';

/** What a refusal can say about a close. Either day may be unknown to the caller. */
export interface OrganisationClosure {
  /** When it was closed, or null when the caller cannot read it. */
  readonly closedAt: Date | null;
  /** When its data is removed from the service (`tenant_closure.purge_after`), or null. */
  readonly purgeAfter: Date | null;
}

/** The day a close is named by: its UTC date. */
function day(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Why nothing was started: the organisation was closed.
 *
 * A reopen is possible while the removal is still ahead (`reopenTenant`), so
 * the sentence says so only then. `now` is passed so a test can state it.
 */
export function organisationClosedRefusal(closure: OrganisationClosure, now: Date = new Date()): BilingualRefusal {
  const { closedAt, purgeAfter } = closure;
  const reopenable = purgeAfter !== null && purgeAfter.getTime() > now.getTime();
  const en = [
    closedAt ? `This organisation was closed on ${day(closedAt)}.` : 'This organisation was closed.',
    'Nothing is started, and nothing uses the access it gave.',
    ...(purgeAfter ? [`Its data is removed from the service on ${day(purgeAfter)}.`] : []),
    ...(reopenable ? ['Until then, its owner can reopen it.'] : []),
  ];
  const nl = [
    closedAt ? `Deze organisatie is op ${day(closedAt)} gesloten.` : 'Deze organisatie is gesloten.',
    'Er wordt niets gestart, en niets gebruikt de toegang die zij gaf.',
    ...(purgeAfter ? [`De gegevens worden op ${day(purgeAfter)} uit de dienst verwijderd.`] : []),
    ...(reopenable ? ['Tot dan kan de eigenaar haar heropenen.'] : []),
  ];
  return { code: ACCOUNT_CLOSED, fields: [], en: en.join(' '), nl: nl.join(' ') };
}
