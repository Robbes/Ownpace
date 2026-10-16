// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The permission inventory's vocabulary (SAD §14.2, workplan 0029 T1).
 *
 * §14.2's promise is *covered, not necessarily automated*: discover every
 * right on the source, map what maps cleanly, guide the rest. This module is
 * the shape those findings take, kept in `shared` for the same reason
 * `DirectoryListing` is — the connector that produces them and the report
 * that consumes them are in different packages, and neither should own the
 * other's vocabulary.
 *
 * THE UNION IS THE DESIGN, again. A cutover that nobody inventoried is how
 * SendAs on the shared address, the assistant's FullAccess and the family
 * calendar share all break silently on day one. An inventory that came back
 * empty because nobody could look reads exactly like one that came back empty
 * because there was nothing to find — and the first is the dangerous one, so
 * they are different values (hard rule 9).
 */

import type { Bilingual } from './link-holder-refusals.ts';

/** What kind of thing a right was granted over. */
export type PermissionSubject = 'mailbox' | 'calendar' | 'drive_item';

/**
 * One right, as the source stated it.
 *
 * `raw` is the source's own words, kept verbatim — the report renders it
 * unchanged (the prose boundary: translate the frame, never the finding).
 * Everything else is a handle for grouping and mapping; nothing here is a
 * normalised model of "permission", because the whole §14.2 position is that
 * a fragile full ACL translator is what NOT to build.
 */
export interface PermissionGrant {
  readonly subject: PermissionSubject;
  /** What the right is over: an address, a calendar name, a file path. */
  readonly on: string;
  /** Who holds it, as the source names them. Empty for a link-style grant. */
  readonly grantee?: string;
  /** The source's own name for the right: `FullAccess`, `write`, `owner`. */
  readonly role: string;
  /**
   * The grant verbatim, for the report and for anybody re-checking it later.
   * Never parsed for meaning downstream — it is evidence, not a model.
   */
  readonly raw: string;
  /**
   * True when the right is held by a sharing LINK rather than a person —
   * "anyone with this link can edit" is a different risk from "Anna can
   * edit", and a report that flattened them would hide the one worth acting
   * on before cutover.
   */
  readonly viaLink?: boolean;
  /**
   * WHERE THE THING SITS, in the source's own ids (workplan 0123 T4).
   *
   * Optional, and absent is a real answer: a source that cannot cheaply say
   * where an item lives leaves all three off, and the sharing queue then lists
   * that row on its own rather than folding it under a container on a guess.
   * Hard rule 9 — not knowing where something lives is not the same as knowing
   * it lives with these others.
   *
   * `itemKey` is what a child's `parentKey` points AT. `isContainer` has three
   * answers on purpose: true, false, and absent for "the source did not say".
   *
   * Drive fills these because `parents` and `mimeType` ride along on the
   * `files.list` the scan already makes, for nothing. It deliberately does NOT
   * use Drive's own `permissionDetails.inherited`: that was measured to arrive
   * only on `permissions.list`, one request per item, and without the
   * `inheritedFrom` that would make it a grouping key at all (2026-09-18).
   */
  readonly itemKey?: string;
  readonly parentKey?: string;
  readonly isContainer?: boolean;
}

/**
 * What a source came back with when asked for the rights on something.
 *
 * `not_discoverable` carries the reason IN THE SOURCE'S TERMS, and it is not
 * a failure state: some rights genuinely cannot be read through the API this
 * tool uses, and saying so precisely is more useful than an empty list and
 * more honest than a silent skip.
 *
 * `reasonNl` is the same sentence in Dutch, where the sentence is ours and we
 * wrote it in both languages (the owner, 2026-10-16). Absent is a real answer:
 * a provider's own words, or a reason somebody else's code gave, has no Dutch,
 * and a Dutch screen then says the English as it came.
 */
export type PermissionListing =
  | { readonly kind: 'listed'; readonly grants: readonly PermissionGrant[] }
  | { readonly kind: 'not_discoverable'; readonly reason: string; readonly reasonNl?: string };

/**
 * What a source should SAY when it did not read a class of rights.
 *
 * In a tester's words since 2026-10-16 (the owner: every sentence a managed
 * Alpha tester reads is written for testers). It said *"These permissions
 * could not be inventoried … will stop working at cutover"*. The meaning is
 * kept, and it is the whole point of the frame: nothing was looked at, which
 * is never "nothing is shared" (hard rule 9), and what is not carried over
 * stops working the moment the person switches over.
 */
export function permissionsNotDiscoverable(reason: string): string {
  return (
    `Who has access here was not read: ${withoutStop(reason)}. This does not mean nothing is shared — ` +
    'nothing was looked at, and any access given here stops working without warning when ' +
    'you switch over.'
  );
}

/**
 * A reason without its closing stop, so the frame's own does not double it: a
 * reason another door wrote as a whole sentence read *"… setup.md).. This"*.
 */
function withoutStop(reason: string): string {
  return reason.replace(/\.\s*$/, '');
}

/** The same frame in Dutch, around a reason written in Dutch. */
export function permissionsNotDiscoverableNl(reasonNl: string): string {
  return (
    `Wie hier toegang heeft, is niet gelezen: ${withoutStop(reasonNl)}. Dat betekent niet dat er niets ` +
    'gedeeld is — er is niets bekeken, en toegang die hier is gegeven, werkt zonder ' +
    'waarschuwing niet meer zodra u overstapt.'
  );
}

/** A reason written in both languages, framed as a blind spot in each. */
export function notReadSaid(reason: Bilingual): Bilingual {
  return { en: permissionsNotDiscoverable(reason.en), nl: permissionsNotDiscoverableNl(reason.nl) };
}

/**
 * A blind spot of ours as a listing, its Dutch beside it. Takes the sentence
 * as said, already framed (`notReadSaid`, or one of the `…Said()` and
 * `microsoftAccount…NotRead()` below), so nothing is framed twice.
 */
export function notReadListing(said: Bilingual): PermissionListing {
  return { kind: 'not_discoverable', reason: said.en, reasonNl: said.nl };
}

/**
 * Mailbox delegation, unread, in GOOGLE's words.
 *
 * The pair to `mailboxDelegations()` in the Graph connector, and it exists for
 * the reason two other branches in this codebase already exist: a Google
 * tenant handed an Exchange Online PowerShell instruction is being sent on a
 * *wrong errand* — `Get-MailboxPermission` will never run against their
 * account, so a reader who follows it learns nothing and concludes the tool
 * is broken rather than that the rights are unread.
 *
 * Deliberately no API claim. Gmail does expose delegation and send-as
 * settings to some callers, and this tool does not read them; saying "cannot
 * be read" would be a stronger statement than the evidence supports. What it
 * says is where a person can look, which is what the sentence is for.
 */
export function googleMailboxDelegationNotRead(): string {
  return googleMailboxDelegationNotReadSaid().en;
}

/** `googleMailboxDelegationNotRead`, in both languages. */
export function googleMailboxDelegationNotReadSaid(): Bilingual {
  return notReadSaid({
    en:
      'Gmail delegation and send-as are not read by Ownpace. Find them in Gmail under ' +
      'Settings → See all settings → Accounts and Import — "Grant access to your account" ' +
      'and "Send mail as" — and, for a Workspace account, in the Admin console under the ' +
      "user's Gmail settings. Note them by hand before you switch over, because they stop " +
      'working the moment the mailbox moves',
    nl:
      'Gmail-gemachtigden en verzenden-als leest Ownpace niet. U vindt ze in Gmail bij ' +
      'Instellingen, op het tabblad Accounts en import, en voor een Workspace-account ook in ' +
      'de Beheerconsole, bij de Gmail-instellingen van de gebruiker. Noteer ze zelf voordat u ' +
      'overstapt, want ze werken niet meer zodra het postvak is overgezet',
  });
}

/**
 * THE SOURCES THAT ARE NEITHER MICROSOFT NOR GOOGLE, in their own words (the
 * owner, 2026-10-14): an IMAP mailbox, Apple, Soverin, Dropbox, Box, Nextcloud,
 * an export archive.
 *
 * Every one of them was handed Microsoft's sentences on the managed report and
 * the Sharing checklist: Exchange Online PowerShell for who else had access to
 * the mailbox, *"this tenant has no Microsoft 365 source connection, and only
 * Graph can enumerate a directory"* for its calendars, and OneDrive and
 * SharePoint for its files. Each was a wrong errand, as Google's was before
 * `googleMailboxDelegationNotRead`.
 *
 * Neutral on purpose: nothing here names a provider's settings page, because
 * the family is too wide for one to be true of every member. And each still
 * says it as a blind spot (hard rule 9): Ownpace did not look, which is never
 * "there is nothing to find". Wrapped in `permissionsNotDiscoverable`, as
 * every other blind spot is.
 */
export function mailboxAccessNotReadForThisSource(): string {
  return mailboxAccessNotReadForThisSourceSaid().en;
}

/** `mailboxAccessNotReadForThisSource`, in both languages. */
export function mailboxAccessNotReadForThisSourceSaid(): Bilingual {
  return notReadSaid({
    en:
      'who else could open this account or send mail from it is not read by Ownpace for this ' +
      "kind of source. Note it from your old provider's settings before you switch over",
    nl:
      'wie dit account nog meer kon openen of eruit kon verzenden, leest Ownpace niet bij dit ' +
      'soort bron. Noteer het vanuit de instellingen van uw oude aanbieder voordat u overstapt',
  });
}

/** Calendar sharing, for the sources `mailboxAccessNotReadForThisSource` speaks for. */
export function calendarSharingNotReadForThisSource(): string {
  return calendarSharingNotReadForThisSourceSaid().en;
}

/** `calendarSharingNotReadForThisSource`, in both languages. */
export function calendarSharingNotReadForThisSourceSaid(): Bilingual {
  return notReadSaid({
    en:
      'calendar sharing is not read by Ownpace for this kind of source. Note who you shared ' +
      'each calendar with before you switch over',
    nl:
      "delen van agenda's leest Ownpace niet bij dit soort bron. Noteer met wie u elke agenda " +
      'deelde voordat u overstapt',
  });
}

/** File and folder sharing, for the same sources. */
export function fileSharingNotReadForThisSource(): string {
  return fileSharingNotReadForThisSourceSaid().en;
}

/** `fileSharingNotReadForThisSource`, in both languages. */
export function fileSharingNotReadForThisSourceSaid(): Bilingual {
  return notReadSaid({
    en:
      'file and folder sharing is not read by Ownpace for this kind of source. Note who you ' +
      'shared files and folders with before you switch over',
    nl:
      'delen van bestanden en mappen leest Ownpace niet bij dit soort bron. Noteer met wie u ' +
      'bestanden en mappen deelde voordat u overstapt',
  });
}

/**
 * A MICROSOFT ACCOUNT CONNECTED WITH ONE PERSON'S OWN SIGN-IN, in its own
 * words (the owner, 2026-10-16): the `microsoft` connection kind, which
 * *Connect with Microsoft* stores, as against `o365`, an administrator's app
 * registration in an organisation's Microsoft 365.
 *
 * It was handed the administrator's sentences: Exchange Online PowerShell's
 * `Get-MailboxPermission` for who else had access to the mailbox, which an
 * Outlook.com account has no way to run, and a directory that needs an app
 * registration. Ownpace reads such an account with the person's own grant and
 * reads none of who they gave access to.
 *
 * TRUE OF A PERSONAL AND OF A WORK OR SCHOOL ACCOUNT ALIKE, on purpose. The
 * `microsoft` kind says how the account was connected, not which kind of
 * account it is: the consent goes through `common`, which takes both, asks for
 * no `openid` scope, and so nothing stored says which one signed in. So these
 * name no Exchange tool and no organisation, and no menu path either: Microsoft
 * moves Outlook's menus between its versions, and a path we cannot hold to is
 * a wrong errand of its own. They say what Ownpace did not read, and where the
 * person looks: Outlook's own settings.
 */
export function microsoftAccountMailboxAccessNotRead(): Bilingual {
  return notReadSaid({
    en:
      'who else could open this mailbox or send mail from it is not read by Ownpace for a ' +
      "Microsoft account connected with your own sign-in. Note it from Outlook's settings " +
      'before you switch over',
    nl:
      'wie dit postvak nog meer kon openen of eruit kon verzenden, leest Ownpace niet bij een ' +
      'Microsoft-account dat met uw eigen aanmelding is gekoppeld. Noteer het vanuit de ' +
      'instellingen van Outlook voordat u overstapt',
  });
}

/** Calendar sharing, for the account `microsoftAccountMailboxAccessNotRead` speaks for. */
export function microsoftAccountCalendarSharingNotRead(): Bilingual {
  return notReadSaid({
    en:
      'calendar sharing is not read by Ownpace for a Microsoft account connected with your ' +
      "own sign-in. Note who you shared each calendar with, from Outlook's settings, before " +
      'you switch over',
    nl:
      "delen van agenda's leest Ownpace niet bij een Microsoft-account dat met uw eigen " +
      'aanmelding is gekoppeld. Noteer vanuit de instellingen van Outlook met wie u elke ' +
      'agenda deelde, voordat u overstapt',
  });
}

/** OneDrive sharing, for the same account. */
export function microsoftAccountFileSharingNotRead(): Bilingual {
  return notReadSaid({
    en:
      'OneDrive sharing is not read by Ownpace for a Microsoft account connected with your own ' +
      'sign-in. Note who you shared files and folders with before you switch over',
    nl:
      'delen op OneDrive leest Ownpace niet bij een Microsoft-account dat met uw eigen ' +
      'aanmelding is gekoppeld. Noteer met wie u bestanden en mappen deelde voordat u overstapt',
  });
}
