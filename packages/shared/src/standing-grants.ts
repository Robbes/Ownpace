// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The permission you granted us, which only you can take back
 * (workplan 0085 T4b — owner's finding, 2026-08-18).
 *
 * ## The gap this closes
 *
 * Erasure can destroy our copy of a credential, and it can often revoke a
 * token. **Neither of those removes the consent.** When somebody grants this
 * product access — an Entra app consent, a Google OAuth authorization, a
 * Dropbox app link, a Box admin authorization — that grant lives in *their*
 * platform, under *their* account, and no API call of ours can withdraw it on
 * their behalf.
 *
 * So the honest sequence at the end of a migration is:
 *
 *   1. we stop using the access,
 *   2. we delete our copy and revoke the token where the provider allows it,
 *   3. **and a standing permission to read their mail is still sitting there**
 *      until they go and remove it.
 *
 * Step 3 is invisible unless somebody says it out loud. The owner asked for
 * this at offboarding, and named the other place it belongs: **finishing a
 * migration**. That is the sharper of the two — a customer who has cut over
 * successfully is *done with us*, feels done, and is the least likely person
 * to think about a consent they granted six weeks earlier. Offboarding at
 * least has erasure to prompt the thought.
 *
 * ## Why this is a reminder and not a button
 *
 * We could link to the page. We cannot click it. Pretending otherwise — a
 * "revoke access" button that quietly only deletes our row — would be the
 * worst version of this: it would leave the grant standing while telling the
 * person it was gone. The rule this repo keeps coming back to applies here
 * too: **say what actually happened.**
 *
 * Bilingual, adjacent, per `docs/i18n-prose-boundary.md` class 4 — this is
 * operator prose we author, and `apps/selfhost` needs it as much as the
 * console does.
 */

import type { RefusalLocale } from './credential-refusals';

/** Where a standing grant lives, and what it is called there. */
export interface StandingGrant {
  /** A stable handle for this grant, for tests and for switching on. */
  readonly id: string;
  /**
   * Every identifier that implies this grant — in BOTH vocabularies.
   *
   * This product names providers two ways and they do not line up: a stored
   * `connection.kind` (`o365`, `google_drive`, …, with underscores) and a
   * wizard source type (`graph`, `oauth2`, `google-drive`, …, with hyphens).
   * One grant is implied by several of each — every Google connector shares a
   * single account authorization, and both `graph` and `oauth2` are the same
   * Entra app consent.
   *
   * Keying on one vocabulary would have made the reminder **silently never
   * fire** for callers holding the other, which is the worst failure available
   * here: the customer is told nothing, and nothing looks wrong.
   */
  readonly impliedBy: readonly string[];
  /** What the provider calls the thing to remove. Rendered verbatim — it is a label on their screen. */
  readonly whatTheyCallIt: string;
  /** Where to go. A URL when the provider has a stable one; otherwise a path through their UI. */
  readonly where: string;
  readonly en: string;
  readonly nl: string;
}

/**
 * Only the providers where a grant actually persists after we stop using it.
 *
 * Deliberately NOT a row per connection kind. A plain IMAP connection
 * authenticates with a password the customer already controls — there is no
 * consent object sitting in a console, and inventing a reminder for it would
 * teach people to ignore the ones that matter.
 */
const GRANTS: readonly StandingGrant[] = [
  {
    id: 'microsoft',
    // `o365` is the stored kind; `graph` and `oauth2` are the wizard types for
    // the same Entra app registration (0074 T1: `oauth2` means Entra ID).
    impliedBy: ['o365', 'graph', 'oauth2'],
    whatTheyCallIt: 'Enterprise applications → Permissions',
    where: 'https://entra.microsoft.com → Identity → Applications → Enterprise applications',
    en:
      'The admin consent you granted to this application stays in your Microsoft Entra tenant ' +
      'until an administrator removes it. Until then it remains a standing permission to read ' +
      'the mailboxes it was scoped to, whether or not anybody is using it.',
    nl:
      'De beheerderstoestemming die u aan deze toepassing hebt gegeven, blijft in uw Microsoft ' +
      'Entra-tenant staan totdat een beheerder die verwijdert. Tot dat moment blijft het een ' +
      'permanente machtiging om de betrokken postbussen te lezen, of iemand die nu gebruikt of niet.',
  },
  {
    id: 'google',
    // One Google account authorization covers every Google connector.
    impliedBy: [
      'gmail',
      'google_drive',
      'google_calendar',
      'google_contacts',
      'google-drive',
      'google-calendar',
      'google-contacts',
    ],
    whatTheyCallIt: 'Third-party apps with account access',
    where: 'https://myaccount.google.com/permissions',
    en:
      'The access you granted stays on your Google account until you remove it there. Revoking ' +
      'the token stops it working; removing the app removes the grant itself.',
    nl:
      'De toegang die u hebt verleend blijft op uw Google-account staan totdat u die daar ' +
      'verwijdert. Het intrekken van het token stopt het gebruik; het verwijderen van de app ' +
      'haalt de machtiging zelf weg.',
  },
  {
    id: 'dropbox',
    impliedBy: ['dropbox'],
    whatTheyCallIt: 'Connected apps',
    where: 'https://www.dropbox.com/account/connected_apps',
    en:
      'The app link you approved stays on your Dropbox account until you unlink it there.',
    nl:
      'De app-koppeling die u hebt goedgekeurd blijft op uw Dropbox-account staan totdat u die ' +
      'daar ontkoppelt.',
  },
  {
    id: 'box',
    impliedBy: ['box'],
    whatTheyCallIt: 'Admin Console → Apps → Custom Apps Manager',
    where: 'https://app.box.com/master/custom-apps',
    en:
      'The one-time admin authorization you granted stays in your Box enterprise until an ' +
      'administrator removes the application there.',
    nl:
      'De eenmalige beheerdersautorisatie die u hebt verleend blijft in uw Box-omgeving staan ' +
      'totdat een beheerder de toepassing daar verwijdert.',
  },
];

/**
 * The standing grants implied by a set of provider identifiers.
 *
 * Accepts either vocabulary — stored `connection.kind` or wizard source type —
 * and deduplicates, so a tenant using Gmail, Google Drive and Google Calendar
 * is reminded once about one Google authorization rather than three times about
 * the same page.
 */
export function standingGrantsFor(identifiers: Iterable<string>): readonly StandingGrant[] {
  const wanted = new Set(identifiers);
  return GRANTS.filter((g) => g.impliedBy.some((id) => wanted.has(id)));
}

/** True when an identifier leaves a grant behind that only the customer can remove. */
export function leavesAStandingGrant(identifier: string): boolean {
  return GRANTS.some((g) => g.impliedBy.includes(identifier));
}

/** Every grant this module knows about — for the coverage lock in the tests. */
export function grantIds(): readonly string[] {
  return GRANTS.map((g) => g.id);
}

/** Every identifier that implies some grant, both vocabularies. */
export function identifiersWithStandingGrants(): readonly string[] {
  return GRANTS.flatMap((g) => [...g.impliedBy]);
}

/**
 * The reminder, in one language, for the kinds a tenant actually used.
 *
 * Returns an empty array when nothing applies, so a caller renders nothing
 * rather than an empty heading — a reminder section with no reminders reads as
 * a bug and trains people to skim past the real ones.
 */
export function standingGrantReminders(
  kinds: Iterable<string>,
  locale: RefusalLocale,
): ReadonlyArray<{ readonly heading: string; readonly body: string; readonly where: string }> {
  return standingGrantsFor(kinds).map((g) => ({
    heading: g.whatTheyCallIt,
    body: locale === 'nl' ? g.nl : g.en,
    where: g.where,
  }));
}
