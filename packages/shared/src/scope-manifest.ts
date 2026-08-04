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
  ],
  partial: [
    // Moved down from `migrates` on 2026-08-04 (workplan 0027 T4). Discovery
    // ships — the addresses are found, classified and shown before anything
    // is copied — and the copying half does not. Under *Migrates* these two
    // rows promised a migration that no code performs, which is the promise
    // 0026's truth pass exists to stop us making. They move back up when
    // 0027 T2/T3 land, with whatever qualifiers are true then.
    {
      item: 'Shared mailboxes (Pattern S)',
      detail:
        'DISCOVERED, not yet copied. Shared addresses are found on the source and classified ' +
        'before you start; where the source cannot say which kind an address is, you are asked ' +
        'rather than guessed at. Copying the shared store itself is not built yet (workplan ' +
        '0027 T3).',
    },
    {
      item: 'Distribution lists (Pattern D)',
      detail:
        'DISCOVERED, not yet recreated. The list and its members are read and shown; a list ' +
        'whose members could not be read says so rather than appearing empty. Recreating the ' +
        'group on the target is not built yet (workplan 0027 T2).',
    },
    {
      item: 'Mail with no Message-ID',
      detail:
        'Migrated, but the copy gets a generated Message-ID added — we need one to copy each ' +
        'message exactly once. The original on the source is never modified, and discovery ' +
        'reports how many messages this applies to.',
    },
    { item: 'Permissions', detail: 'Inventoried and guided; only the clean, reversible subset is auto-applied (§14.2).' },
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
