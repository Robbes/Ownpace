// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Static scope manifest (SAD §11.2) — "what migrates, what doesn't, and why", shown on the
 * pre-sync confirm screen alongside the live discovery counts (workplan 0013). Explicit and
 * readable: no silent omissions. Versioned so the UI can note when the promise set changes.
 *
 * In plain words, in English and in Dutch (2026-10-14): every managed tester reads it on Start a
 * migration and on Review and start. A row says what moves, what does not, and what is only
 * listed for them to redo by hand; it names no internal pattern, section or mechanism, and a
 * protocol only where the tester chooses a destination by it (`a-manifest-in-plain-words`).
 */

/**
 * WHOSE PROVIDER A ROW IS ABOUT.
 *
 * Not a protocol and not a connector: the thing a customer would name if you
 * asked what they are leaving. `standards` is the honest label for a source
 * that is an endpoint rather than a product — a bare IMAP server, a CalDAV
 * URL — where there is no vendor whose extras could stay behind.
 *
 * A LIST AS WELL AS A TYPE, because a client has to validate `appliesTo` when
 * it parses the manifest off the wire, and a second copy of these six words in
 * a schema is how the two would come to disagree (workplan 0153 T1 (a)).
 */
export const SCOPE_FAMILIES = [
  'google',
  'microsoft',
  'dropbox',
  'box',
  'archive',
  'standards',
] as const;
export type ScopeFamily = (typeof SCOPE_FAMILIES)[number];

/**
 * EVERY SOURCE TYPE'S FAMILY, held by the compiler rather than by memory.
 *
 * `Record<SourceConfig['type'], …>` means a connector added to the union
 * without a family here does not build. That is deliberate and it is the
 * cheapest half of this whole file's fix: the defect below was a new provider
 * inheriting an old provider's promises silently, and silence is exactly what
 * an exhaustive record removes.
 */
const SCOPE_FAMILY: Record<SourceConfig['type'], ScopeFamily> = {
  google: 'google',
  gmail: 'google',
  'google-calendar': 'google',
  'google-contacts': 'google',
  'google-drive': 'google',
  microsoft: 'microsoft',
  'graph-mail': 'microsoft',
  'graph-calendar': 'microsoft',
  'graph-contacts': 'microsoft',
  'graph-drive': 'microsoft',
  'graph-todo': 'microsoft',
  dropbox: 'dropbox',
  box: 'box',
  // An export archive is its own family and not the provider's, deliberately:
  // a Takeout reaches things the live Google APIs do not (Photos albums, per
  // workplan 0116), so answering "what migrates" with the live account's list
  // would be wrong in both directions.
  archive: 'archive',
  'imap-oauth2': 'standards',
  caldav: 'standards',
  carddav: 'standards',
  webdav: 'standards',
  // `jmap` and `imap-dav` are TARGET types and are deliberately absent: the
  // compiler said so the first time this record was written, which is the
  // whole argument for keying it on the union.
};

/**
 * The family a source type belongs to, or `undefined` for a string that is not
 * a source type at all.
 *
 * Takes a plain string for the reason `carriesGoogleNativeFiles` does: callers
 * hold a source type typed as `string` — a request body's field, a mapping row
 * read back from the database — and demanding the union would only move the
 * cast to them.
 */
export function scopeFamilyOf(sourceType: string): ScopeFamily | undefined {
  return (SCOPE_FAMILY as Record<string, ScopeFamily | undefined>)[sourceType];
}

/**
 * THE SAME QUESTION, ASKED IN THE MANAGED EDITION'S VOCABULARY (workplan 0153
 * T1 (a)).
 *
 * `SCOPE_FAMILY` above is keyed by the mapping file's source TYPE, which is
 * what the appliance's confirm page holds. The managed migration route answers
 * with the CONNECTION KIND instead (`sourceType: sourceConn?.kind`), the
 * column's older vocabulary: `google_drive` with an underscore, `o365` for
 * both of the customer-registered Microsoft cards, and `imap` and `apple` for
 * rows whose mapping file would say `imap-oauth2`, `caldav` or `carddav`.
 * Looked up in the table above, every one of those answered `undefined`, and
 * `scopeManifestFor` given no family keeps only the rows true of every source
 * — which, once the web schema had stripped `appliesTo` off every row, was
 * every row. So a Google Drive migration was confirmed under SharePoint, Teams
 * and Planner.
 *
 * A second table rather than one lookup that tries both vocabularies: `gmail`,
 * `google`, `microsoft`, `dropbox`, `box` and `archive` are one word in both,
 * but `imap` exists only as a kind and `caldav` only as a type here, and a
 * lookup that guessed which it had been handed would one day answer for a
 * string in the wrong one. `a-source-kind-with-no-scope-family.unit.test.ts`
 * in `apps/api` walks every source type the create door accepts through
 * `sourceKindFor`, so a kind added there without a row here fails the build.
 */
const SCOPE_FAMILY_OF_SOURCE_KIND: Readonly<Record<string, ScopeFamily>> = {
  // Any IMAP server, by protocol: an endpoint, not a product.
  imap: 'standards',
  // `o365` is the customer's own Entra registration, which both the IMAP and
  // the Graph card store; `microsoft` is the account card (workplan 0114).
  o365: 'microsoft',
  microsoft: 'microsoft',
  gmail: 'google',
  google_drive: 'google',
  google_calendar: 'google',
  google_contacts: 'google',
  google: 'google',
  // Apple publishes no API for its own Mail, Calendar or Contacts: the row is
  // reached over IMAP and DAV with an app-specific password (workplan 0115),
  // and `source-face-builders.ts` builds it with the same `imap` and `dav`
  // builders as Soverin. Their configs are `imap-oauth2`, `caldav` and
  // `carddav`, which the table above calls `standards`: one account, one
  // answer, whichever vocabulary asks.
  apple: 'standards',
  dropbox: 'dropbox',
  box: 'box',
  archive: 'archive',
};

/**
 * The family of a SOURCE connection kind, or `undefined` for a string that is
 * not one (a target kind, or the detail route's `'unknown'` when the
 * connection row is missing). Undefined narrows the manifest to the rows true
 * of every source, which under-tells rather than mis-tells.
 *
 * Own-property lookup, so `constructor` or `toString` is not a kind.
 */
export function scopeFamilyOfConnectionKind(kind: string): ScopeFamily | undefined {
  return Object.prototype.hasOwnProperty.call(SCOPE_FAMILY_OF_SOURCE_KIND, kind)
    ? SCOPE_FAMILY_OF_SOURCE_KIND[kind]
    : undefined;
}

/**
 * THE SAME QUESTION, ASKED IN *START A MIGRATION*'S VOCABULARY (workplan 0013,
 * 2026-10-16).
 *
 * *Start a migration* holds the CARD each migration is made with — the
 * wizard's source type (`WizardSourceType`): `apple` and `imap` for a mail
 * provider, `graph` and `oauth2` for Microsoft mail through a company's own
 * app, `google-drive` with a hyphen. It asked `scopeFamilyOf`, which knows the
 * mapping file's types, so an Apple, IMAP or company-app migration had no
 * family. That went unnoticed while Email, Calendar and Contacts were shown to
 * every family; once those rows say whose they are, a family-less Apple
 * migration would be told nothing about its mail.
 *
 * A third table for the third vocabulary, for the reason the second exists:
 * one lookup that tried each in turn would one day answer for a word in the
 * wrong one. `Record<WizardSourceType, …>` makes a card added to the union
 * without a family here fail to build.
 */
const SCOPE_FAMILY_OF_SOURCE_CARD: Readonly<Record<WizardSourceType, ScopeFamily>> = {
  google: 'google',
  gmail: 'google',
  'google-calendar': 'google',
  'google-contacts': 'google',
  'google-drive': 'google',
  microsoft: 'microsoft',
  // Microsoft mail through a company's own app, by Graph or by IMAP: the same
  // Microsoft account, read another way (`PlanChoices.microsoftMail`).
  graph: 'microsoft',
  oauth2: 'microsoft',
  dropbox: 'dropbox',
  box: 'box',
  archive: 'archive',
  // An endpoint rather than a product, as the kind table says of both.
  imap: 'standards',
  apple: 'standards',
};

/**
 * The family of a SOURCE CARD, or `undefined` for a string that is not one.
 * Own-property lookup, as `scopeFamilyOfConnectionKind`'s.
 */
export function scopeFamilyOfSourceCard(card: string): ScopeFamily | undefined {
  return Object.prototype.hasOwnProperty.call(SCOPE_FAMILY_OF_SOURCE_CARD, card)
    ? SCOPE_FAMILY_OF_SOURCE_CARD[card as WizardSourceType]
    : undefined;
}

import type { SourceConfig } from './config.ts';
import type { GuideHandle } from './guide-handle.ts';
import type { WizardSourceType } from './target-domains.ts';

/** The words of one row a reader sees: its label, its line and its fold. */
export interface ScopeManifestWords {
  readonly item: string;
  readonly detail: string;
  readonly more?: string;
}

export interface ScopeManifestEntry {
  /** Short label (e.g. "Email", "Teams chat"). */
  readonly item: string;
  /**
   * ONE LINE. The essential of what this row promises, and nothing else.
   *
   * It always said "one-line note" and four rows had grown to five and six
   * lines each, which is what the owner read on 2026-09-17: *"the explaining
   * tekst about 'Migrates' in green, 'Partial' in orange and 'Does not
   * migrate' in grey contain alot of tekst. Please compres/rewrite to contain
   * the Essentials."* Three columns of paragraphs on the screen where somebody
   * decides whether to start is a wall nobody finishes, and the rows that ran
   * longest were the ones carrying the caveats most worth reading.
   */
  readonly detail: string;
  /**
   * The rest of it, folded on screen (workplan 0118 T1's rule, applied to
   * server prose).
   *
   * NOT a place to put things nobody needs: what moved here is every word of
   * the old long details — the JMAP contacts verification narrowing, why a
   * Message-ID is generated, what Microsoft does not let us read about who
   * else could use a mailbox.
   * Those are disclosures, and compressing a disclosure out of existence is
   * the failure §11.2 exists to prevent. So the screen shows the line and
   * offers the rest, and
   * `a-promise-compressed-out-of-existence.unit.test.ts` holds each phrase
   * that must survive whatever the wording becomes.
   */
  readonly more?: string;
  /**
   * The section of a served guide that says the rest (workplan 0148 T7). A
   * screen draws the link beside the row, in its reader's language; the row's
   * words name no file.
   */
  readonly guide?: GuideHandle;
  /**
   * WHICH SOURCE FAMILIES THIS ROW IS TRUE OF. Absent means every one of them.
   *
   * This field exists because the manifest was a single list and the screen
   * fetched it with no argument, so a Google migration's review page promised
   * SharePoint version history and named Teams, Planner, Power Automate,
   * InfoPath and OneNote among the things it would not bring — while saying
   * nothing whatever about Docs, Drive or Gmail. Live 2026-09-22, on the
   * owner's own Google run.
   *
   * The cost is not the noise. This file's header states §11.2 — "no silent
   * omissions" — and for half the product's sources the omissions were total:
   * the native-format conversion that a Drive migration turns on is the
   * largest fidelity decision it makes, and it appeared nowhere on the screen
   * where that decision is confirmed.
   *
   * `permissions.ts` had already won this argument once, for the permissions
   * report: `googleMailboxDelegationNotRead` exists because "a Google tenant
   * handed an Exchange Online PowerShell instruction is being sent on a wrong
   * errand". The confirm screen simply never got the same treatment.
   *
   * A row with no `appliesTo` must therefore be true of EVERY source, which is
   * what `a-manifest-that-named-the-wrong-provider` holds: name a vendor's
   * product in a row and that row has to say whose.
   */
  readonly appliesTo?: ReadonlyArray<ScopeFamily>;
  /**
   * THE SAME ROW IN DUTCH, beside its English (workplan 0013, 2026-10-14).
   *
   * Every managed tester reads this panel twice, on *Start a migration* and
   * on *Review and start*, and it was the one block of those screens that
   * stayed English under `nl`. It is our own prose, not a finding, so it is
   * not the render-verbatim class: it is shared operator prose needed in both
   * languages (`docs/i18n-prose-boundary.md`, class 4), and its Dutch lives
   * here, in the same row, updated together with the English or not at all.
   * The screen shows the half in its reader's language, and the English row
   * where a row has no Dutch.
   *
   * `item` stays the row's key in English (the site's leaving pages name a
   * row by it); `nl.item` is only what a Dutch reader sees.
   */
  readonly nl?: ScopeManifestWords;
}

/**
 * A row's words in the reader's language: the Dutch half under `nl` when the
 * row has one, and otherwise the English as served.
 */
export function scopeManifestWords(entry: ScopeManifestEntry, locale: 'en' | 'nl'): ScopeManifestWords {
  if (locale === 'nl' && entry.nl !== undefined) return entry.nl;
  return {
    item: entry.item,
    detail: entry.detail,
    ...(entry.more !== undefined ? { more: entry.more } : {}),
  };
}

export interface ScopeManifest {
  /** Bump when the promise set changes. */
  readonly version: string;
  /** Fully migrated. */
  readonly migrates: ReadonlyArray<ScopeManifestEntry>;
  /** Migrated with known limitations. */
  readonly partial: ReadonlyArray<ScopeManifestEntry>;
  /** Explicitly NOT migrated (named, per §11.2 "no silent omissions"). */
  readonly doesNotMigrate: ReadonlyArray<ScopeManifestEntry>;
}

/**
 * The Files disclosure, shared by the per-provider rows above: it is about the
 * destination's check, which is the same sentence whichever provider the
 * bytes came from. Split the detail, not the disclosure.
 */
const FILES_MORE = {
  en:
    'Whatever kind of destination you choose, the check afterwards compares the number of ' +
    'files, their total size and their contents.',
  nl:
    'Welke soort bestemming u ook kiest, de verificatie achteraf vergelijkt het aantal ' +
    'bestanden, hun totale grootte en hun inhoud.',
} as const;

/**
 * The line both Permissions rows open with, in each language. Shared rather
 * than typed twice, because a reader who sees both providers' rows on the
 * appliance should read one promise, not two that drifted.
 */
const PERMISSIONS_LINE = {
  en: 'Listed for you to redo by hand; nothing is applied for you.',
  nl: 'Op een lijst gezet om met de hand over te zetten; er wordt niets voor u toegepast.',
} as const;
/** And the first sentence of both their folds. */
const PERMISSIONS_FIRST = {
  en: 'Every line of the permission list is a step for a person to take.',
  nl: 'Elke regel van de rechtenlijst is een stap die iemand zelf zet.',
} as const;

export const SCOPE_MANIFEST: ScopeManifest = {
  // NOT bumped on 2026-09-17, deliberately. The re-cut below moved words
  // between `detail` and `more` and changed no promise, and this version is
  // what tells a reader the promise SET changed. Moving it for a rewrite would
  // make the one signal that matters cheap.
  //
  // Bumped on 2026-09-23 because the set DID change: Google Tasks moved from
  // "does not migrate" to "migrates" (workplan 0126 T2).
  //
  // Bumped on 2026-09-25: shared mailboxes moved from "migrates" to "partial"
  // until one is copied (workplan 0141 T10 (a)).
  //
  // Bumped on 2026-10-14 (workplan 0013, Status): the rows were reworded in
  // plain words and got their Dutch, which alone would not move it, but three
  // rows now say what the code does where they used to say more. Mail with no
  // Message-ID is migrated only where the connection can give it one (a
  // Microsoft Graph connection cannot, and `DiscoveryCounts` already says so);
  // Microsoft calendar and file sharing are read only through an
  // administrator's own app given that permission; and Google Photos names the
  // Takeout route the wizard offers, where it said only that the Drive API
  // cannot reach them.
  //
  // Bumped on 2026-10-16 (workplan 0013, Status) because the set changed for
  // whole families of sources. Email, Calendar, Contacts and Mail with no
  // Message-ID carried no `appliesTo`, so they were shown to every source, and
  // a Dropbox, Box or Takeout-export migration was told its mail would move
  // while the code reads files and nothing else from all three
  // (`SOURCE_TYPE_DOMAINS`). Each now names the families that carry it. And
  // two Tasks rows joined Google's: Microsoft To Do and Apple Reminders, which
  // the code has read since 0114 T9 and 0115 and the screen never mentioned.
  version: '2026-10-16',
  migrates: [
    // MAIL, CALENDARS AND CONTACTS, for the families that carry them (2026-10-16).
    // Read from the code, not from memory: Google (its account, and `gmail`),
    // Microsoft (its account, and mail through a company's own app) and
    // `standards` (an IMAP server, an Apple account, and on an appliance a
    // CalDAV or CardDAV source). Never Dropbox or Box, whose sources read files
    // only, and never an export archive, which by owner decision D5 is read for
    // files and photos and nothing else (`SOURCE_TYPE_DOMAINS`). With no
    // `appliesTo` these were shown to those three as well.
    {
      item: 'Email',
      detail: 'Every folder, Sent, Drafts and Archive included, with flags, tags and dates.',
      appliesTo: ['google', 'microsoft', 'standards'],
      nl: {
        item: 'E-mail',
        detail: 'Elke map, ook Verzonden, Concepten en Archief, met markeringen, labels en datums.',
      },
    },
    {
      item: 'Calendar',
      detail: 'Events, repeating ones included, with their attendees.',
      appliesTo: ['google', 'microsoft', 'standards'],
      nl: { item: 'Agenda', detail: 'Afspraken, ook terugkerende, met hun deelnemers.' },
    },
    {
      item: 'Contacts',
      detail: 'Address books and contacts.',
      appliesTo: ['google', 'microsoft', 'standards'],
      more:
        'Every field comes across, including ones the destination has no field of its own for. ' +
        'One difference to know before you switch over: a JMAP destination cannot hand a ' +
        'contact back exactly as it was written, so there the check afterwards does not compare ' +
        'their contents. It checks how many there are and that each one is there instead, and ' +
        'the report says so for every run.',
      nl: {
        item: 'Contacten',
        detail: 'Adresboeken en contacten.',
        more:
          'Elk veld komt mee, ook velden waarvoor de bestemming zelf geen vak heeft. Eén verschil ' +
          'om te weten voordat u overstapt: een JMAP-bestemming kan een contact niet teruggeven ' +
          'precies zoals het werd geschreven, dus daar vergelijkt de verificatie achteraf hun ' +
          'inhoud niet. Ze kijkt dan hoeveel het er zijn en of elk ervan er staat, en het ' +
          'rapport zegt dat elke keer.',
      },
    },
    {
      item: 'Files',
      detail: 'OneDrive and SharePoint libraries: files and folders.',
      more: FILES_MORE.en,
      appliesTo: ['microsoft'],
      nl: {
        item: 'Bestanden',
        detail: 'OneDrive- en SharePoint-bibliotheken: bestanden en mappen.',
        more: FILES_MORE.nl,
      },
    },
    {
      item: 'Files',
      detail: 'Google Drive: files and folders.',
      more: FILES_MORE.en,
      appliesTo: ['google'],
      nl: { item: 'Bestanden', detail: 'Google Drive: bestanden en mappen.', more: FILES_MORE.nl },
    },
    {
      item: 'Tasks',
      detail: 'Google Tasks: every list and task, completed and assigned ones included.',
      more:
        "Read from Google Tasks itself, because Google's calendar connection carries no tasks. " +
        "Subtasks keep their parent; links, and where an assigned task came from, become lines " +
        "in the task's description; a task deleted in Google goes to Deletions for you to " +
        'decide, and is never removed for you. Two things Google does not give out cannot come ' +
        'across: a time of day on a due date, and a repeat.',
      appliesTo: ['google'],
      nl: {
        item: 'Taken',
        detail: 'Google Tasks: elke lijst en taak, ook afgevinkte en toegewezen taken.',
        more:
          'Gelezen uit Google Tasks zelf, omdat de agendakoppeling van Google geen taken bevat. ' +
          'Subtaken houden hun bovenliggende taak; links, en waar een toegewezen taak vandaan ' +
          'kwam, worden regels in de beschrijving van de taak; een taak die in Google is ' +
          'verwijderd, komt bij Verwijderingen zodat u beslist, en wordt nooit voor u verwijderd. ' +
          'Twee dingen die Google niet doorgeeft, kunnen niet mee: een tijdstip op een ' +
          'vervaldatum, en een herhaling.',
      },
    },
    // MICROSOFT TO DO (2026-10-16). Read since 0114 T9 by `graph-todo-source`,
    // and never on this screen. The fold is what that connector does: notes,
    // due date, importance, reminder and repeat each become their iCalendar
    // property; a task's steps (Graph's checklist) become lines in its
    // description; Outlook's two extra statuses map to not started (five onto
    // three, the original kept beside it); and attachments are not fetched at
    // all (`hasAttachments` is read, the files are not).
    {
      item: 'Tasks',
      detail: 'Microsoft To Do: every list and task, completed ones included.',
      more:
        'Each task keeps its notes, due date, importance, reminder and repeat, and its steps ' +
        'become lines in its description. Two statuses only Outlook sets, waiting on someone ' +
        'else and deferred, arrive as not started. Files attached to a task do not come across.',
      appliesTo: ['microsoft'],
      guide: 'microsoft#what-moves',
      nl: {
        item: 'Taken',
        detail: 'Microsoft To Do: elke lijst en taak, ook afgevinkte taken.',
        more:
          'Elke taak houdt haar notities, vervaldatum, prioriteit, herinnering en herhaling, en ' +
          'haar stappen worden regels in haar beschrijving. Twee statussen die alleen Outlook ' +
          'zet, wacht op iemand anders en uitgesteld, komen aan als niet begonnen. Bestanden die ' +
          'aan een taak hangen, komen niet mee.',
      },
    },
    {
      item: 'Files',
      detail: 'Files and folders.',
      more: FILES_MORE.en,
      appliesTo: ['dropbox', 'box', 'archive', 'standards'],
      nl: { item: 'Bestanden', detail: 'Bestanden en mappen.', more: FILES_MORE.nl },
    },
  ],
  partial: [
    {
      // Apple's Reminders (2026-10-16): Partial, not Migrates. Since iOS 13 and
      // macOS Catalina an upgraded Reminders list leaves iCloud's CalDAV for a
      // store only Apple's own apps read (DAVx5's and BusyMac's notes), so for
      // nearly every iPhone the calendar account holds no reminders at all.
      // What it still holds, a list never upgraded and other accounts' task
      // lists, is copied as written; the destination must keep task lists.
      item: 'Tasks',
      detail: 'Task lists in a calendar account; upgraded Apple Reminders cannot be read.',
      more:
        'Since iOS 13 and macOS Catalina, Apple keeps upgraded Reminders where only its own ' +
        'apps can read them, so no other app, Ownpace included, can reach them. Reminders ' +
        'that were never upgraded, and task lists in other calendar accounts, are copied as ' +
        'they were written. Your destination must keep task lists, as Nextcloud and Soverin ' +
        'do: one that keeps only calendars refuses each task, and lists it under Failures.',
      appliesTo: ['standards'],
      guide: 'apple#reminders',
      nl: {
        item: 'Taken',
        detail: 'Takenlijsten in een agenda-account; bijgewerkte Apple-herinneringen zijn onleesbaar.',
        more:
          'Sinds iOS 13 en macOS Catalina bewaart Apple bijgewerkte Herinneringen zo dat alleen ' +
          'de eigen apps van Apple ze kunnen lezen; geen andere app, ook Ownpace niet, kan erbij. ' +
          'Herinneringen die nooit zijn bijgewerkt, en takenlijsten in andere agenda-accounts, ' +
          'worden gekopieerd zoals ze werden geschreven. Uw bestemming moet takenlijsten ' +
          'bewaren, zoals Nextcloud en Soverin doen: een bestemming die alleen agenda’s bewaart, ' +
          'weigert elke taak, en zet die onder Mislukkingen.',
      },
    },
    // Distribution lists moved down from `migrates` on 2026-08-04 (workplan
    // 0027 T4). Under *Migrates* they promised a recreation no code performs,
    // which is the promise 0026's truth pass exists to stop us making. Shared
    // mailboxes went with them and came back the same day, when 0027 T3
    // landed. (0027 calls the two §14.1's Pattern D and Pattern S; those are
    // the architecture's names, and a tester reads neither.)
    //
    // Shared mailboxes moved down again on 2026-09-25 (workplan 0141 T10 (a),
    // the owner's choice): the code is built, and nobody has copied a real
    // shared mailbox with it (0027 T0 waits on the consent run). The Microsoft
    // 365 account card, the one most people pick, cannot read one at all.
    // Which column it sits in is `SOURCE_PROOFS.sharedMailbox`'s to say, in
    // front-door.ts: under *Migrates* once that verdict is proven, and the
    // verdict is proven only by a Live proofs row in the feature matrix
    // (`a-shared-mailbox-promise-with-its-proof.unit.test.ts`).
    {
      item: 'Shared mailboxes',
      detail: 'Needs your own app registration; not yet copied from a real shared mailbox.',
      appliesTo: ['microsoft'],
      more:
        'It is copied like any other mailbox: every folder, Sent, Drafts and Archive included, ' +
        'each message once, with the same checks afterwards. An administrator has to grant ' +
        'your own app registration application permissions on the source. The Microsoft 365 ' +
        "account button reads only the signed-in person's own mailbox, so it cannot copy a " +
        'shared one.',
      // The administrator's steps for that registration (0148 T7).
      guide: 'microsoft#application',
      nl: {
        item: 'Gedeelde mailboxen',
        detail: 'Vraagt om uw eigen appregistratie; nog nooit uit een echte gedeelde mailbox gemigreerd.',
        more:
          'Hij wordt gemigreerd zoals elke andere mailbox: elke map, ook Verzonden, Concepten en ' +
          'Archief, elk bericht één keer, met dezelfde verificatie achteraf. Een beheerder moet ' +
          'uw eigen appregistratie toepassingsmachtigingen op de bron geven. De knop Microsoft ' +
          '365 account leest alleen de eigen mailbox van wie zich aanmeldt, dus daarmee kan geen ' +
          'gedeelde mailbox worden gemigreerd.',
      },
    },
    {
      item: 'Distribution lists',
      detail: 'We list them and their members for you; you recreate them yourself.',
      appliesTo: ['microsoft'],
      more:
        'Not done for you. Each list and its members are read and shown, and you get ' +
        "step-by-step instructions with each list's address and exactly who must receive its " +
        'mail, including which lists cannot be recreated from them because their members could ' +
        'not be read. None of the destinations offers us a way to create a mail group.',
      nl: {
        item: 'Distributielijsten',
        detail: 'We zetten ze met hun leden voor u op een rij; u maakt ze zelf opnieuw aan.',
        more:
          'Dit gebeurt niet voor u. Elke lijst en haar leden worden gelezen en getoond, en u krijgt ' +
          'stap voor stap het adres van elke lijst en precies wie haar mail moet ontvangen, ook ' +
          'welke lijsten u er niet mee opnieuw kunt maken omdat hun leden niet te lezen waren. ' +
          'Geen van de bestemmingen biedt ons een manier om een mailgroep aan te maken.',
      },
    },
    {
      item: 'Mail with no Message-ID',
      detail: 'Migrated with a generated Message-ID on the copy, where the connection can add one.',
      // Email's families: a source that carries no mail has none without one.
      appliesTo: ['google', 'microsoft', 'standards'],
      more:
        'We need one to copy each message exactly once. The original on the source is never ' +
        'modified. The count before you start says how many messages get one, and how many ' +
        'this connection cannot give one, which are not migrated.',
      nl: {
        item: 'Mail zonder Message-ID',
        detail: 'Gemigreerd met een gegenereerde Message-ID op de kopie, waar de verbinding dat kan.',
        more:
          'We hebben er een nodig om elk bericht precies één keer te migreren. Het origineel op ' +
          'de bron wordt nooit gewijzigd. De telling voordat u start, zegt hoeveel berichten er ' +
          'een krijgen, en hoeveel deze verbinding er geen kan geven; die worden niet gemigreerd.',
      },
    },
    // Corrected 2026-08-04 (workplan 0029 T1–T3). The old wording — "only the
    // clean, reversible subset is auto-applied" — described a write step that
    // is DEFERRED by owner decision and has no code, and it read as a promise
    // that permissions largely take care of themselves. They do not.
    //
    // Corrected again 2026-10-14: the fold said the report "covers" calendar
    // and file sharing. It reads them only through an administrator's own app
    // given that permission (`directoryAvailability`, `driveSharingAvailability`
    // in connectors); a Microsoft 365 account's delegated grant reads neither,
    // and managed declines the file permission on purpose.
    {
      // The Google twin is below. `permissions.ts` already splits this exact
      // sentence per provider — `googleMailboxDelegationNotRead` exists
      // because an Exchange Online instruction sends a Google tenant on a
      // wrong errand — and this screen is where that split was missing.
      item: 'Permissions',
      detail: PERMISSIONS_LINE.en,
      appliesTo: ['microsoft'],
      more:
        `${PERMISSIONS_FIRST.en} Calendar sharing, and file and folder sharing ("anyone with ` +
        'the link" included), are read only where an administrator\'s own app registration was ' +
        'given that permission; where they were not read, the list says so. Who else could open ' +
        'or send from a mailbox (Full Access, Send As) cannot be read by Ownpace at all: the ' +
        'list says so for every migration, and you note it yourself, for example with Exchange ' +
        'Online PowerShell, before you switch over.',
      nl: {
        item: 'Rechten',
        detail: PERMISSIONS_LINE.nl,
        more:
          `${PERMISSIONS_FIRST.nl} Delen van agenda's, en van bestanden en mappen (ook "iedereen ` +
          'met de link"), wordt alleen gelezen waar de eigen appregistratie van een beheerder die ' +
          'machtiging kreeg; wat niet gelezen is, staat zo op de lijst. Wie verder een postvak ' +
          'kon openen of eruit kon verzenden (Volledige toegang, Verzenden als), kan Ownpace ' +
          'helemaal niet lezen: de lijst zegt dat bij elke migratie, en u noteert het zelf, ' +
          'bijvoorbeeld met Exchange Online PowerShell, voordat u overstapt.',
      },
    },
    // Proton calendar/contacts (ICS/vCard snapshots) removed 2026-08-02: zero
    // Proton code exists and the whole Proton destination is deferred with
    // ADR-0025's discipline (0026 T3 row 9). "SharePoint extras" moved to
    // doesNotMigrate the same day (row 3 retracted): "best-effort" with zero
    // code was a promise, not a hedge. The manifest promises only what is
    // built — rows return when the code does.
    // ---- Google -----------------------------------------------------------
    {
      // THE DECISION THE SCREEN DID NOT MENTION. A Drive migration asks, at
      // setup, what should happen to Docs, Sheets, Slides and Drawings
      // (`GOOGLE_NATIVE_FILE_SOURCE_TYPES`, the export chooser) — and this
      // panel, the one you confirm on, said nothing about it at all.
      item: 'Google-native files',
      detail: 'Docs, Sheets, Slides and Drawings are converted, never copied as they are.',
      appliesTo: ['google'],
      more:
        'Google keeps these as online documents, not as files, so there is no original file to ' +
        'copy. Each arrives in the format you chose when you set up the migration (OpenDocument, ' +
        'Microsoft Office or PDF; a drawing as an image) as a conversion Google makes, not the ' +
        'thing itself, or stays behind and is reported by name if you chose that. Two ' +
        'conversions of an unchanged document are not always identical either: a presentation ' +
        'saved as .pptx comes out different each time, where the same presentation as ' +
        'OpenDocument does not. Everything else in Drive, anything you uploaded, is copied ' +
        'exactly, like any other file.',
      nl: {
        item: 'Google-documenten',
        detail: 'Documenten, Spreadsheets, Presentaties, Tekeningen: omgezet, nooit ongewijzigd gekopieerd.',
        more:
          'Google bewaart deze als online documenten, niet als bestanden, dus er is geen origineel ' +
          'bestand om te kopiëren. Elk komt aan in het formaat dat u koos bij het instellen van de ' +
          'migratie (OpenDocument, Microsoft Office of PDF; een tekening als afbeelding), als ' +
          'omzetting die Google maakt en niet als het document zelf, of blijft achter en wordt ' +
          'bij naam gemeld als u dat koos. Twee omzettingen van een ongewijzigd document zijn ook ' +
          'niet altijd gelijk: een presentatie als .pptx komt elke keer anders uit, dezelfde ' +
          'presentatie als OpenDocument niet. Al het andere in Drive, alles wat u zelf uploadde, ' +
          'wordt exact gekopieerd, zoals elk ander bestand.',
      },
    },
    {
      item: 'Permissions',
      detail: PERMISSIONS_LINE.en,
      appliesTo: ['google'],
      more:
        `${PERMISSIONS_FIRST.en} Calendar sharing is not read, and neither is who else could ` +
        'read or send from this Gmail address (delegation and send-as): find those in Gmail ' +
        'under Settings → See all settings → Accounts and Import, and for a Workspace account ' +
        "in the Admin console under the user's Gmail settings. Note them by hand before you " +
        'switch over, because they stop working the moment the mailbox moves.',
      nl: {
        item: 'Rechten',
        detail: PERMISSIONS_LINE.nl,
        more:
          `${PERMISSIONS_FIRST.nl} Delen van agenda's wordt niet gelezen, en ook niet wie verder ` +
          'dit Gmail-adres kon lezen of eruit kon verzenden (gemachtigden en verzenden als): u ' +
          'vindt dat in Gmail onder Instellingen → Alle instellingen bekijken → Accounts en ' +
          'import, en voor een Workspace-account in de Admin-console bij de Gmail-instellingen ' +
          'van de gebruiker. Noteer het met de hand voordat u overstapt, want het werkt niet meer ' +
          'zodra de mailbox is gemigreerd.',
      },
    },
  ],
  // An `item` here is also a key: the site's leaving pages name these rows,
  // row for row, by their English `item` (`site/sources.mjs`, held by
  // `scripts/leaving-pages-say-what-the-app-says.unit.test.ts`). Reword the
  // Dutch `item` freely; renaming an English one is a change on the site too.
  doesNotMigrate: [
    {
      item: 'SharePoint extras',
      appliesTo: ['microsoft'],
      detail: 'Version history, permissions, metadata, lists and pages stay behind.',
      more: 'The files and folders themselves are migrated: see Files, under Migrates.',
      nl: {
        item: 'Extra’s van SharePoint',
        detail: 'Versiegeschiedenis, rechten, metagegevens, lijsten en pagina’s blijven achter.',
        more: 'De bestanden en mappen zelf worden wel gemigreerd: zie Bestanden, onder Migreert.',
      },
    },
    {
      appliesTo: ['microsoft'],
      item: 'Teams chat & calls',
      detail: 'Not migrated.',
      nl: { item: 'Teams-chats en -gesprekken', detail: 'Wordt niet gemigreerd.' },
    },
    {
      appliesTo: ['microsoft'],
      item: 'Planner',
      detail: 'Not migrated.',
      nl: { item: 'Planner', detail: 'Wordt niet gemigreerd.' },
    },
    {
      appliesTo: ['microsoft'],
      item: 'Power Automate',
      detail: 'Not migrated.',
      nl: { item: 'Power Automate', detail: 'Wordt niet gemigreerd.' },
    },
    {
      appliesTo: ['microsoft'],
      item: 'InfoPath',
      detail: 'Not migrated.',
      nl: { item: 'InfoPath', detail: 'Wordt niet gemigreerd.' },
    },
    {
      appliesTo: ['microsoft'],
      item: 'OneNote',
      detail: 'Not migrated unless set up separately.',
      nl: { item: 'OneNote', detail: 'Wordt niet gemigreerd, tenzij apart ingesteld.' },
    },
    {
      appliesTo: ['microsoft'],
      item: 'Retention holds',
      detail: 'Not migrated.',
      nl: { item: 'Bewaarblokkeringen', detail: 'Worden niet gemigreerd.' },
    },
    {
      appliesTo: ['microsoft'],
      item: 'Other O365 apps',
      detail: 'Not migrated: there is no European equivalent to move them to.',
      nl: {
        item: 'Andere Office 365-apps',
        detail: 'Worden niet gemigreerd: er is geen Europees alternatief voor.',
      },
    },
    // ---- Google -----------------------------------------------------------
    // NAMED, not implied. §11.2's rule is that an omission is STATED, and for
    // a Google source every one of them used to be silent — the only list on
    // the screen was somebody else's.
    {
      item: 'Google Keep',
      detail: 'Not migrated.',
      appliesTo: ['google'],
      nl: { item: 'Google Keep', detail: 'Wordt niet gemigreerd.' },
    },
    {
      // Not through the account: since 31 March 2025 Google lets no app read
      // a whole photo library. It said "not reachable through the Drive API
      // this tool uses", which was true and beside the point, and it said
      // nothing of the route the product does offer: a Takeout export, read
      // by the archive source (`SOURCE_TYPE_DOMAINS.archive`), which *Start a
      // migration* offers as *Photos: from a Takeout export* under Google.
      item: 'Google Photos',
      detail: 'Not with a Google sign-in; they can come from a Google Takeout export instead.',
      more:
        'Google no longer lets another app read a whole photo library. The complete route ' +
        'Google leaves open is a Takeout export you ask Google for: on Start a migration it is ' +
        'Photos: from a Takeout export, under Google, and on a self-hosted appliance the Export ' +
        'archive card on Accounts. The guide says how to ask for one.',
      appliesTo: ['google'],
      guide: 'google#photos',
      nl: {
        item: "Google Foto's",
        detail: 'Niet via aanmelden bij Google; ze kunnen wel mee via een Google Takeout-export.',
        more:
          'Google laat een andere app geen hele fotobibliotheek meer lezen. De volledige weg die ' +
          "Google openlaat, is een Takeout-export die u bij Google aanvraagt: bij Migratie " +
          "starten is dat Foto's: uit een Takeout-export, onder Google, en op een eigen appliance " +
          'de kaart Exportarchief bij Accounts. De handleiding zegt hoe u er een aanvraagt.',
      },
    },
    {
      item: 'Google Sites, Forms',
      detail: 'Not migrated.',
      appliesTo: ['google'],
      nl: { item: 'Google Sites en Formulieren', detail: 'Worden niet gemigreerd.' },
    },
    {
      item: 'Revision history',
      detail: 'A Drive document arrives as it is now; its earlier versions stay behind.',
      appliesTo: ['google'],
      nl: {
        item: 'Versiegeschiedenis',
        detail: 'Een document uit Drive komt aan zoals het nu is; eerdere versies blijven achter.',
      },
    },
  ],
};

/**
 * The manifest as it should be shown to somebody migrating FROM these
 * families: every row true of at least one of them, in the order above.
 *
 * A union rather than one family, because the appliance's confirm page shows
 * one manifest over several migrations. Every row it then shows is true of a
 * migration on that box, and no row names a provider that is not there.
 *
 * An EMPTY list \u2014 no mappings yet, or a source type this build does not know
 * \u2014 yields the rows true of every source and nothing provider-specific. That
 * is the safe direction: a reader is told less than their migration will do,
 * never more. It is also why `scopeFamilyOf` returns `undefined` rather than
 * guessing a family: an unknown source inheriting a known one's promises is
 * the defect this whole file just fixed.
 */
export function scopeManifestFor(
  manifest: ScopeManifest,
  families: ReadonlyArray<ScopeFamily>,
): ScopeManifest {
  const wanted = new Set(families);
  const keep = (e: ScopeManifestEntry): boolean =>
    e.appliesTo === undefined || e.appliesTo.some((f) => wanted.has(f));
  // The MANIFEST IT IS GIVEN, never the constant above: the route's comment
  // says the server owns this content, and a client that filtered its own
  // bundled copy would quietly show an older promise set than the one the
  // appliance is actually operating under.
  return {
    version: manifest.version,
    migrates: manifest.migrates.filter(keep),
    partial: manifest.partial.filter(keep),
    doesNotMigrate: manifest.doesNotMigrate.filter(keep),
  };
}

