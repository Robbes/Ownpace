// Copyright 2026 The Ownpace authors (Apache-2.0)

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

import type { RefusalLocale } from './credential-refusals.ts';

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
 * Providers where a CONSENT persists after we stop using it.
 *
 * Not a row per connection kind: several kinds share one authorization, and a
 * reminder repeated three times about the same page trains people to skim.
 *
 * This list used to be the whole story, on the reasoning that *"a plain IMAP
 * connection authenticates with a password the customer already controls — there
 * is no consent object sitting in a console"*. **Half right, and the wrong
 * half was load-bearing** (owner, 2026-08-18). There is no *consent* object,
 * but there is very often a **credential** object — an app password sitting in
 * the provider's account settings, which we deleted our copy of and which still
 * works. `CREDENTIAL_RETIREMENTS` below covers those; the two are kept separate
 * because they are different things to do, not because one matters less.
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
    // The ACCOUNT kind's grant (workplan 0114), and a SECOND Microsoft entry
    // rather than a wider `impliedBy` on the one above. The two are different
    // grants that happen to share a provider:
    //
    //  - `o365`/`graph`/`oauth2` carry an ADMIN consent in an Entra tenant,
    //    removable only by an administrator, often covering other people's
    //    mailboxes.
    //  - `microsoft` carries the signed-in person's OWN delegated consent,
    //    which they remove themselves, in a different console, over their own
    //    data only.
    //
    // Telling somebody who pressed a button that they need an administrator
    // is a dead end at exactly the moment they are trying to leave — and the
    // reverse, telling an admin they can do it from My Account, is worse: it
    // leaves a tenant-wide permission live while they believe it is gone.
    id: 'microsoft-account',
    impliedBy: ['microsoft'],
    whatTheyCallIt: 'My Account → Privacy → Apps and services',
    where: 'https://myaccount.microsoft.com → Privacy → Apps and services you have given access to',
    en:
      'The consent you gave this application stays on your Microsoft account until you remove ' +
      'it there. Until then it remains a standing permission to read the mail, calendars, ' +
      'contacts and files you approved, whether or not anybody is using it. Microsoft publishes ' +
      'no way for us to withdraw it on your behalf.',
    nl:
      'De toestemming die u aan deze toepassing hebt gegeven, blijft op uw Microsoft-account ' +
      'staan totdat u die daar verwijdert. Tot dat moment blijft het een permanente machtiging ' +
      'om de e-mail, agenda\u0027s, contacten en bestanden te lezen die u hebt goedgekeurd, of ' +
      'iemand die nu gebruikt of niet. Microsoft biedt ons geen manier om die namens u in te trekken.',
  },
  {
    id: 'google',
    // One Google account authorization covers every Google connector — which
    // is exactly why the ACCOUNT kind belongs here beside the four
    // single-purpose ones (workplan 0106 T3b). Without it, a customer erased
    // with a `google` connection was the only one told nothing: revoking their
    // refresh token stops it working, and the app stays listed on their
    // account until they remove it there. Revocable and standing-granted are
    // not alternatives — `gmail` is both, and for the same reason.
    impliedBy: [
      'gmail',
      'google_drive',
      'google_calendar',
      'google_contacts',
      'google',
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


/**
 * A credential the customer gave us that keeps working after we forget it
 * (owner's finding, 2026-08-18: *"they just need to be reminded to do so and
 * not leave credentials wandering around"*).
 *
 * ## Why this is separate from a consent, and equally necessary
 *
 * Deleting our encrypted copy of an app password removes it from us. It does
 * not remove it from the provider — that string keeps authenticating until
 * somebody deletes or changes it in the account it belongs to. So the shape of
 * the risk is identical to a standing consent (access that outlives our
 * erasure and only the customer can end), even though the object and the
 * screen are different.
 *
 * ## Why the vague ones are still worth saying
 *
 * For `nextcloud` and `proton` we can name the screen. For a generic `imap` or
 * `webdav` connection we cannot — the portal belongs to whichever provider
 * they use, and we do not know which. The temptation is to say nothing rather
 * than say something imprecise.
 *
 * That would be the wrong call: **the customer knows who their mail provider
 * is, and we know what they should look for.** Naming the thing ("app
 * password", "application-specific password", "device password") is the part
 * they cannot supply, and it is enough to find the screen. Saying nothing
 * leaves a working credential in place because we could not be exact.
 */
export interface CredentialRetirement {
  readonly id: string;
  /** `connection.kind` values, and wizard types where they differ. */
  readonly impliedBy: readonly string[];
  /** What the provider calls it — rendered verbatim. */
  readonly whatTheyCallIt: string;
  /** A URL where one is stable, else the path through their settings. */
  readonly where: string;
  readonly en: string;
  readonly nl: string;
}

const CREDENTIALS: readonly CredentialRetirement[] = [
  {
    // NEITHER A GRANT NOR A CREDENTIAL — and it is here anyway (0116 T1).
    //
    // An export archive leaves nothing behind at any provider: no consent, no
    // app link, no password. By the letter of this file it belongs in neither
    // table. It is filed as a CREDENTIAL retirement because of what the two
    // tables are actually for, which is telling somebody what still exists
    // after we have forgotten them — and in this case something very large
    // does. The export sitting in their Downloads folder is a complete copy of
    // their photo library, or their iCloud Drive, or both, in the clear, on
    // whatever machine they extracted it to. Nobody else is going to mention
    // it, because nobody else knows it is there.
    //
    // Deliberately NOT phrased as an instruction to delete it. It is their
    // data and the point of the whole exercise was to get it; some people will
    // want to keep it as their own backup, which is a perfectly good reason.
    // What the sentence supplies is the fact and the reason to think about it.
    id: 'archive',
    impliedBy: ['archive'],
    whatTheyCallIt: 'the export you downloaded',
    where: 'wherever you saved and extracted the export on your own computer or drive',
    en:
      'The export archive itself is still on your own disk, where you put it. We never had a ' +
      'copy — only the path — and that path is now deleted. Worth remembering that the ' +
      'archive is a complete, unencrypted copy of everything the provider handed over, so ' +
      'keep it somewhere you would be happy keeping your photos, or delete it once the ' +
      'migration is done.',
    nl:
      'Het exportarchief zelf staat nog op uw eigen schijf, waar u het hebt neergezet. Wij ' +
      'hadden er nooit een kopie van — alleen het pad — en dat pad is nu verwijderd. Houd er ' +
      'rekening mee dat het archief een volledige, onversleutelde kopie is van alles wat de ' +
      'aanbieder heeft meegegeven: bewaar het ergens waar u ook uw foto\u0027s zou bewaren, ' +
      'of verwijder het zodra de migratie klaar is.',
  },
  {
    // A CREDENTIAL, not a grant, and that is the whole shape of the Apple kind
    // (workplan 0115): there is no consent to withdraw because Apple never
    // offered one for its own data. What the customer holds is an
    // app-specific password they made, and it keeps working until they say
    // otherwise.
    id: 'apple',
    impliedBy: ['apple'],
    whatTheyCallIt: 'Sign-In and Security → App-Specific Passwords',
    where: 'account.apple.com → Sign-In and Security → App-Specific Passwords',
    en:
      'The app-specific password you created for this migration still works on your Apple ' +
      'Account. Deleting our copy does not revoke it at Apple — remove it from the list to ' +
      'end it. It ends on its own, without changing your Apple Account password.',
    nl:
      'Het app-specifieke wachtwoord dat u voor deze migratie hebt aangemaakt werkt nog ' +
      'steeds op uw Apple-account. Het verwijderen van onze kopie trekt het bij Apple niet ' +
      'in — verwijder het uit de lijst om het te beëindigen. Dat kan zonder uw ' +
      'Apple-accountwachtwoord te wijzigen.',
  },
  {
    id: 'nextcloud',
    impliedBy: ['nextcloud'],
    whatTheyCallIt: 'Settings → Security → Devices & sessions',
    where: 'your Nextcloud account → Settings → Security → Devices & sessions',
    en:
      'The app password you created for this migration still works on your Nextcloud account. ' +
      'Deleting our copy does not delete it there — revoke the device entry to end it.',
    nl:
      'Het app-wachtwoord dat u voor deze migratie hebt aangemaakt werkt nog steeds op uw ' +
      'Nextcloud-account. Het verwijderen van onze kopie verwijdert het daar niet — trek de ' +
      'apparaatvermelding in om het te beëindigen.',
  },
  {
    id: 'proton',
    impliedBy: ['proton'],
    whatTheyCallIt: 'Account → Security → App passwords',
    where: 'https://account.proton.me → Security and privacy',
    en:
      'The bridge or app password you gave us still works on your Proton account until you ' +
      'delete it there.',
    nl:
      'Het bridge- of app-wachtwoord dat u ons hebt gegeven werkt nog op uw Proton-account ' +
      'totdat u het daar verwijdert.',
  },
  {
    id: 'mail_password',
    impliedBy: ['imap', 'jmap', 'soverin', 'selfhosted_mail'],
    whatTheyCallIt: 'your mail provider’s account or security settings',
    where:
      'your mail provider’s account settings — look for “app password”, ' +
      '“application-specific password” or “device password”',
    en:
      'The mailbox password or app password you gave us still works. We have deleted our copy; ' +
      'only you can retire it, by deleting that app password or changing the account password. ' +
      'We cannot name the exact screen because it belongs to your provider, not to us.',
    nl:
      'Het postbuswachtwoord of app-wachtwoord dat u ons hebt gegeven werkt nog steeds. Wij ' +
      'hebben onze kopie verwijderd; alleen u kunt het intrekken, door dat app-wachtwoord te ' +
      'verwijderen of het accountwachtwoord te wijzigen. Wij kunnen het exacte scherm niet ' +
      'noemen omdat het van uw aanbieder is, niet van ons.',
  },
  {
    id: 'dav_password',
    impliedBy: ['caldav', 'carddav', 'webdav'],
    whatTheyCallIt: 'your calendar, contacts or file provider’s security settings',
    where:
      'your provider’s account settings — look for “app password”, ' +
      '“application-specific password” or “connected devices”',
    en:
      'The password you gave us for this calendar, contacts or file account still works. We have ' +
      'deleted our copy; only you can retire it where the account lives.',
    nl:
      'Het wachtwoord dat u ons voor dit agenda-, contacten- of bestandsaccount hebt gegeven ' +
      'werkt nog steeds. Wij hebben onze kopie verwijderd; alleen u kunt het intrekken waar het ' +
      'account thuishoort.',
  },
];

/** The credentials a set of provider identifiers leaves behind, deduplicated. */
export function credentialRetirementsFor(
  identifiers: Iterable<string>,
): readonly CredentialRetirement[] {
  const wanted = new Set(identifiers);
  return CREDENTIALS.filter((c) => c.impliedBy.some((id) => wanted.has(id)));
}

/** Every credential-retirement id — for the coverage lock in the tests. */
export function credentialRetirementIds(): readonly string[] {
  return CREDENTIALS.map((c) => c.id);
}

/** Every identifier that leaves a credential behind. */
export function identifiersWithRetirableCredentials(): readonly string[] {
  return CREDENTIALS.flatMap((c) => [...c.impliedBy]);
}

/** One entry in the list of access that outlives our erasure. */
export interface OutlivingAccess {
  readonly id: string;
  /** A consent in a console, or a credential in an account. Different jobs. */
  readonly category: 'consent' | 'credential';
  readonly heading: string;
  readonly body: string;
  readonly where: string;
}

/**
 * Everything that keeps working after we have forgotten the customer, in one
 * list, for the kinds they actually used.
 *
 * Credentials come FIRST. A consent is a permission sitting unused; a live app
 * password is a working way in, and if somebody reads one item and stops, that
 * is the one they should have read. (Both are shown — this decides the order,
 * not the contents.)
 *
 * Empty when nothing applies, so a caller renders nothing rather than an empty
 * heading: a reminder section with no reminders reads as a bug and trains
 * people to skim past the real ones.
 */
export function accessThatOutlivesErasure(
  identifiers: Iterable<string>,
  locale: RefusalLocale,
): readonly OutlivingAccess[] {
  const kinds = [...identifiers];
  const credentials: OutlivingAccess[] = credentialRetirementsFor(kinds).map((c) => ({
    id: c.id,
    category: 'credential',
    heading: c.whatTheyCallIt,
    body: locale === 'nl' ? c.nl : c.en,
    where: c.where,
  }));
  const consents: OutlivingAccess[] = standingGrantsFor(kinds).map((g) => ({
    id: g.id,
    category: 'consent',
    heading: g.whatTheyCallIt,
    body: locale === 'nl' ? g.nl : g.en,
    where: g.where,
  }));
  return [...credentials, ...consents];
}
