// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Static scope manifest (SAD §11.2) — "what migrates, what doesn't, and why", shown on the
 * pre-sync confirm screen alongside the live discovery counts (workplan 0013). Explicit and
 * readable: no silent omissions. Versioned so the UI can note when the promise set changes.
 */

export interface ScopeManifestEntry {
  /** Short label (e.g. "Email", "Teams chat"). */
  readonly item: string;
  /** One-line note on coverage / caveats. */
  readonly detail: string;
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

export const SCOPE_MANIFEST: ScopeManifest = {
  version: '2026-08-04',
  migrates: [
    { item: 'Email', detail: 'Folders incl. Sent / Drafts / Archive, flags/keywords, timestamps.' },
    { item: 'Calendar', detail: 'Events, recurrence, attendees (ICS).' },
    { item: 'Contacts', detail: 'Address books and contacts (vCard).' },
    { item: 'Files', detail: 'OneDrive / SharePoint document libraries (files + folders).' },
    {
      item: 'Shared mailboxes',
      detail:
        'Pattern S — the shared store is copied, as an ordinary mapping: the full folder tree ' +
        'incl. Sent/Drafts/Archive, same idempotency and verification as any mailbox. Needs ' +
        'application permissions on the source (see docs/shared-mailboxes.md).',
    },
  ],
  partial: [
    // Pattern D moved down from `migrates` on 2026-08-04 (workplan 0027 T4).
    // Under *Migrates* it promised a recreation no code performs, which is
    // the promise 0026's truth pass exists to stop us making. Pattern S went
    // with it and came back the same day, when 0027 T3 landed.
    {
      item: 'Distribution lists (Pattern D)',
      detail:
        'DISCOVERED and GUIDED, not automated. The list and its members are read and shown, ' +
        'and you get a step-by-step document with each address and exactly who must receive ' +
        'its mail — including which lists cannot be recreated because their membership could ' +
        'not be read. Recreating them is manual: no target platform here offers a way to ' +
        'create a mail group for us (§14.2 — covered, not necessarily automated).',
    },
    {
      item: 'Mail with no Message-ID',
      detail:
        'Migrated, but the copy gets a generated Message-ID added — we need one to copy each ' +
        'message exactly once. The original on the source is never modified, and discovery ' +
        'reports how many messages this applies to.',
    },
    // Corrected 2026-08-04 (workplan 0029 T1–T3). The old wording — "only the
    // clean, reversible subset is auto-applied" — described a write step that
    // is DEFERRED by owner decision and has no code, and it read as a promise
    // that permissions largely take care of themselves. They do not.
    {
      item: 'Permissions',
      detail:
        'NOT yet inventoried, and nothing is ever auto-applied — §14.2\'s write step is ' +
        'deferred by decision. The reading and the report exist (calendar and file sharing, ' +
        'which Graph exposes) and are not yet reachable from a screen. Mailbox delegation — ' +
        'FullAccess, SendAs — is not readable through Graph at all and is reported as ' +
        'uninventoried rather than omitted; capture it with Exchange Online PowerShell before ' +
        'you cut over.',
    },
    // Proton calendar/contacts (ICS/vCard snapshots) removed 2026-08-02: zero
    // Proton code exists and the whole Proton destination is deferred with
    // ADR-0025's discipline (0026 T3 row 9). "SharePoint extras" moved to
    // doesNotMigrate the same day (row 3 retracted): "best-effort" with zero
    // code was a promise, not a hedge. The manifest promises only what is
    // built — rows return when the code does.
  ],
  doesNotMigrate: [
    {
      item: 'SharePoint extras',
      detail:
        'Version history, permissions, metadata/columns, lists and site pages are not ' +
        'migrated — files and folders are (see Files above).',
    },
    { item: 'Teams chat & calls', detail: 'Not migrated.' },
    { item: 'Planner', detail: 'Not migrated.' },
    { item: 'Power Automate', detail: 'Not migrated.' },
    { item: 'InfoPath', detail: 'Not migrated.' },
    { item: 'OneNote', detail: 'Not migrated unless set up separately.' },
    { item: 'Retention holds', detail: 'Not migrated.' },
    { item: 'Other O365 apps', detail: 'No sovereign equivalent — not migrated.' },
  ],
};
