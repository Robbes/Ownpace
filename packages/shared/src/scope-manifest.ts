// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Static scope manifest (SAD §11.2) — "what migrates, what doesn't, and why", shown on the
 * pre-sync confirm screen alongside the live discovery counts (workplan 0013). Explicit and
 * readable: no silent omissions. Versioned so the UI can note when the promise set changes.
 */

/**
 * WHOSE PROVIDER A ROW IS ABOUT.
 *
 * Not a protocol and not a connector: the thing a customer would name if you
 * asked what they are leaving. `standards` is the honest label for a source
 * that is an endpoint rather than a product — a bare IMAP server, a CalDAV
 * URL — where there is no vendor whose extras could stay behind.
 */
export type ScopeFamily =
  | 'google'
  | 'microsoft'
  | 'dropbox'
  | 'box'
  | 'archive'
  | 'standards';

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

import type { SourceConfig } from './config.ts';

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
   * Message-ID is generated, what Graph cannot read about mailbox delegation.
   * Those are disclosures, and compressing a disclosure out of existence is
   * the failure §11.2 exists to prevent. So the screen shows the line and
   * offers the rest, and
   * `a-promise-compressed-out-of-existence.unit.test.ts` holds each phrase
   * that must survive whatever the wording becomes.
   */
  readonly more?: string;
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
 * TARGET's two write paths, which is the same sentence whichever provider the
 * bytes came from. Split the detail, not the disclosure.
 */
const FILES_MORE =
  'The same files either way, and unlike the contacts row above there is no narrowing to ' +
  'state: a JMAP file node carries both its byte count and a handle to its content, so ' +
  'verification checks counts, total bytes AND content checksums on both paths.';

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
  version: '2026-09-25',
  migrates: [
    { item: 'Email', detail: 'Folders incl. Sent / Drafts / Archive, flags/keywords, timestamps.' },
    { item: 'Calendar', detail: 'Events, recurrence, attendees (ICS).' },
    {
      item: 'Contacts',
      detail: 'Address books and contacts (vCard), over CardDAV or JMAP.',
      more:
        'The same contacts either way, including properties with no JSContact equivalent. One ' +
        'difference worth knowing before cutover: on the JMAP path the target exposes no route ' +
        'back to the original vCard, so content-checksum sampling does not run and verification ' +
        'checks counts and presence instead. The report says so per run rather than leaving it ' +
        'to be inferred.',
    },
    {
      item: 'Files',
      detail: 'OneDrive and SharePoint libraries: files and folders, over WebDAV or JMAP.',
      more: FILES_MORE,
      appliesTo: ['microsoft'],
    },
    {
      item: 'Files',
      detail: 'Google Drive: files and folders, over WebDAV or JMAP.',
      more: FILES_MORE,
      appliesTo: ['google'],
    },
    {
      item: 'Tasks',
      detail: 'Google Tasks: every list and task, completed and assigned ones included.',
      more:
        "Read over Google's Tasks API, because its CalDAV carries no tasks. Subtasks keep " +
        'their parent; links, and where an assigned task came from, become lines in its ' +
        'description; a task deleted in Google goes to your Deletions queue and is never ' +
        'removed for you. Two things the API does not have cannot be carried: a time of day ' +
        'on a due date, and a repeat.',
      appliesTo: ['google'],
    },
    {
      item: 'Files',
      detail: 'Files and folders, over WebDAV or JMAP.',
      more: FILES_MORE,
      appliesTo: ['dropbox', 'box', 'archive', 'standards'],
    },
  ],
  partial: [
    // Pattern D moved down from `migrates` on 2026-08-04 (workplan 0027 T4).
    // Under *Migrates* it promised a recreation no code performs, which is
    // the promise 0026's truth pass exists to stop us making. Pattern S went
    // with it and came back the same day, when 0027 T3 landed.
    //
    // Pattern S moved down again on 2026-09-25 (workplan 0141 T10 (a), the
    // owner's choice): the code is built, and nobody has copied a real shared
    // mailbox with it (0027 T0 waits on the consent run). The Microsoft 365
    // account card, the one most people pick, cannot read one at all. Which
    // column it sits in is `SOURCE_PROOFS.sharedMailbox`'s to say, in
    // front-door.ts: under *Migrates* once that verdict is proven, and the
    // verdict is proven only by a Live proofs row in the feature matrix
    // (`a-shared-mailbox-promise-with-its-proof.unit.test.ts`).
    {
      item: 'Shared mailboxes',
      detail: 'Needs your own app registration; not yet copied from a real shared mailbox.',
      appliesTo: ['microsoft'],
      more:
        'Pattern S — the shared store is copied as an ordinary mapping: the full folder tree ' +
        'incl. Sent/Drafts/Archive, same idempotency and verification as any mailbox. Needs ' +
        'application permissions on the source, granted by an administrator to your own app ' +
        'registration (see docs/shared-mailboxes.md). The Microsoft 365 account button reads ' +
        "the signed-in person's own mailbox only, so it cannot copy a shared one.",
    },
    {
      item: 'Distribution lists (Pattern D)',
      detail: 'Read and written up for you; recreating them is manual.',
      appliesTo: ['microsoft'],
      more:
        'DISCOVERED and GUIDED, not automated. The list and its members are read and shown, ' +
        'and you get a step-by-step document with each address and exactly who must receive ' +
        'its mail — including which lists cannot be recreated because their membership could ' +
        'not be read. No target platform here offers a way to create a mail group for us ' +
        '(§14.2 — covered, not necessarily automated).',
    },
    {
      item: 'Mail with no Message-ID',
      detail: 'Migrated, with a generated Message-ID added to the copy.',
      more:
        'We need one to copy each message exactly once. The original on the source is never ' +
        'modified, and discovery reports how many messages this applies to.',
    },
    // Corrected 2026-08-04 (workplan 0029 T1–T3). The old wording — "only the
    // clean, reversible subset is auto-applied" — described a write step that
    // is DEFERRED by owner decision and has no code, and it read as a promise
    // that permissions largely take care of themselves. They do not.
    {
      // The Google twin is below. `permissions.ts` already splits this exact
      // sentence per provider — `googleMailboxDelegationNotRead` exists
      // because an Exchange Online instruction sends a Google tenant on a
      // wrong errand — and this screen is where that split was missing.
      item: 'Permissions',
      detail: 'Inventoried and written up; nothing is applied for you.',
      appliesTo: ['microsoft'],
      more:
        'INVENTORIED and GUIDED; nothing is auto-applied — §14.2\'s write step is deferred by ' +
        'decision, so every item in the report is a step for a person. The report covers what ' +
        'Microsoft Graph exposes: calendar sharing, and file and folder sharing including ' +
        '"anyone with the link". Mailbox delegation — FullAccess, SendAs — is NOT readable ' +
        'through Graph at all; the report says so for every migration rather than omitting it, ' +
        'and you capture it with Exchange Online PowerShell before you cut over.',
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
      detail: 'Docs, Sheets, Slides and Drawings are converted on export, never copied as-is.',
      appliesTo: ['google'],
      more:
        'Drive stores these as documents, not as files, so there is no original to copy — the ' +
        'format is the one you chose at setup (Office, ODF or PDF) and the result is a ' +
        'rendering rather than the thing itself. Two renderings of the same document are not ' +
        'always byte-identical either: measured per format and per type, a deck exported as ' +
        '.pptx differs between two exports of an unchanged deck, where the same deck as ODF ' +
        'does not. Everything else in Drive — anything you uploaded — is copied byte for byte ' +
        'like any other file.',
    },
    {
      item: 'Permissions',
      detail: 'Inventoried and written up; nothing is applied for you.',
      appliesTo: ['google'],
      more:
        'INVENTORIED and GUIDED; nothing is auto-applied — §14.2\'s write step is deferred by ' +
        'decision, so every item in the report is a step for a person. Gmail delegation and ' +
        'send-as are NOT read by this tool: find them in Gmail under Settings → See all ' +
        'settings → Accounts and Import, and for a Workspace account in the Admin console ' +
        'under the user\'s Gmail settings. Record them by hand before cutover, because they ' +
        'stop working the moment the mailbox moves.',
    },
  ],
  doesNotMigrate: [
    {
      item: 'SharePoint extras',
      appliesTo: ['microsoft'],
      detail: 'Version history, permissions, metadata, lists and pages stay behind.',
      more: 'The files and folders themselves are migrated — see Files above.',
    },
    { appliesTo: ['microsoft'], item: 'Teams chat & calls', detail: 'Not migrated.' },
    { appliesTo: ['microsoft'], item: 'Planner', detail: 'Not migrated.' },
    { appliesTo: ['microsoft'], item: 'Power Automate', detail: 'Not migrated.' },
    { appliesTo: ['microsoft'], item: 'InfoPath', detail: 'Not migrated.' },
    { appliesTo: ['microsoft'], item: 'OneNote', detail: 'Not migrated unless set up separately.' },
    { appliesTo: ['microsoft'], item: 'Retention holds', detail: 'Not migrated.' },
    { appliesTo: ['microsoft'], item: 'Other O365 apps', detail: 'No sovereign equivalent — not migrated.' },
    // ---- Google -----------------------------------------------------------
    // NAMED, not implied. §11.2's rule is that an omission is STATED, and for
    // a Google source every one of them used to be silent — the only list on
    // the screen was somebody else's.
    { item: 'Google Keep', detail: 'Not migrated.', appliesTo: ['google'] },
    {
      item: 'Google Photos',
      detail: 'Not migrated \u2014 not reachable through the Drive API this tool uses.',
      appliesTo: ['google'],
    },
    { item: 'Google Sites, Forms', detail: 'Not migrated.', appliesTo: ['google'] },
    {
      item: 'Revision history',
      detail: 'A Drive document exports as it is now; its earlier versions stay behind.',
      appliesTo: ['google'],
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

