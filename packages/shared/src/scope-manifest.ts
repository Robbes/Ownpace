// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Static scope manifest (SAD §11.2) — "what migrates, what doesn't, and why", shown on the
 * pre-sync confirm screen alongside the live discovery counts (workplan 0013). Explicit and
 * readable: no silent omissions. Versioned so the UI can note when the promise set changes.
 */

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
  // NOT bumped on 2026-09-17, deliberately. The re-cut below moved words
  // between `detail` and `more` and changed no promise, and this version is
  // what tells a reader the promise SET changed. Moving it for a rewrite would
  // make the one signal that matters cheap.
  version: '2026-08-06',
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
      more:
        'The same files either way, and unlike the contacts row above there is no narrowing to ' +
        'state: a JMAP file node carries both its byte count and a handle to its content, so ' +
        'verification checks counts, total bytes AND content checksums on both paths.',
    },
    {
      item: 'Shared mailboxes',
      detail: 'Copied like any other mailbox, with the same checks.',
      more:
        'Pattern S — the shared store is copied as an ordinary mapping: the full folder tree ' +
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
      detail: 'Read and written up for you; recreating them is manual.',
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
      item: 'Permissions',
      detail: 'Inventoried and written up; nothing is applied for you.',
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
  ],
  doesNotMigrate: [
    {
      item: 'SharePoint extras',
      detail: 'Version history, permissions, metadata, lists and pages stay behind.',
      more: 'The files and folders themselves are migrated — see Files above.',
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
