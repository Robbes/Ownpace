// Copyright 2026 The Ownpace authors (Apache-2.0)
import type { FailureCategory, FailureSide } from './failure-category.ts';
import type { TenantId, MappingId } from './ids.ts';
import type { BudgetPause, DownloadMeter } from './rate-budget.ts';
import type { PauseReason } from './pause-reason.ts';
import type { DeadlinePause, PassClock } from './pass-deadline.ts';
import type { SourceAuthority } from './lifecycle.ts';
import type { DomainDiscovery, DiscoveryRecord, DiscoveryDomain } from './discovery.ts';
import type { MailFolder, MailItem, RawMessage, MailKeyword, SpecialUse } from './mail.ts';
import type { CalendarFolder, RawCalendarEvent } from './calendar.ts';
import type { ContactFolder, RawContact } from './contact.ts';
import type { FileFolder, FileItem, RawFileItem } from './file.ts';

/** Opaque, source-defined cursor for incremental listing (e.g. UIDVALIDITY+UIDNEXT). */
export interface SyncCursor {
  readonly value: string;
}

/**
 * Persists per-folder incremental cursors so steady-state passes list only changed items.
 * Cursors are NON-AUTHORITATIVE (ADR-0020): a lost or malformed cursor merely forces a full,
 * still-idempotent re-scan. Backed by the ledger DB (a `cursors` table) in the real impl.
 */
export interface CursorStore {
  get(tenantId: TenantId, mappingId: MappingId, folderPath: string): Promise<SyncCursor | undefined>;
  set(tenantId: TenantId, mappingId: MappingId, folderPath: string, cursor: SyncCursor): Promise<void>;
  /**
   * Forget every cursor for a mapping, forcing the next pass to list in full.
   *
   * Exists for the operator RETRY action. A parked item does not hold the
   * cursor back, so by the time someone decides to retry it the source may no
   * longer be listing it as changed — and a retry that cannot re-read the item
   * is not a retry. Cursors are non-authoritative (ADR-0020), so dropping them
   * costs one full, still-idempotent re-scan and nothing else.
   */
  clear(tenantId: TenantId, mappingId: MappingId): Promise<void>;
}

/**
 * The cursor key for the read-only scan of a collection the pass does NOT copy.
 *
 * A separate namespace from the collection's own content cursor, and the
 * separation is load-bearing rather than tidy. The bin scan advances a cursor
 * through a folder whose items are deliberately not being migrated; if it shared
 * the content cursor and the owner later brought that folder INTO scope
 * (`excludeSpecialUse: []`), the next pass would find the cursor already advanced
 * past every message in it. Those messages would never be copied and no ledger
 * row would exist to show it — a silent partial migration produced by a
 * bookkeeping collision.
 *
 * U+0001 (SOH) delimits the prefix because it cannot occur in either kind of path
 * a real collection has: RFC 3501 excludes C0 controls from IMAP mailbox names, and
 * a WebDAV path percent-encodes them. So a real collection can never produce this
 * key, which is what makes the collision impossible rather than unlikely. NUL
 * would have been the obvious choice and is not usable — Postgres rejects it in
 * `text`.
 */
export function discardedScanCursorKey(collectionPath: string): string {
  return `\u0001discarded\u0001${collectionPath}`;
}

/** A source mailbox the engine reads from. READ-ONLY. */
export interface SourceConnector {
  /** Enumerate folders with special-use detection (RFC 6154). */
  listFolders(): Promise<ReadonlyArray<MailFolder>>;
  /**
   * List items in `folder` changed since `cursor` (or all if undefined),
   * returning the items plus the next cursor to persist.
   */
  listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<MailItem>;
    nextCursor: SyncCursor;
    /**
     * Items in this folder that could NOT be listed because they carry no
     * natural key — mail with no Message-ID, which cannot be tracked
     * idempotently and is therefore not migrated.
     *
     * They used to be dropped with a bare `continue`. Nothing counted them, so
     * they were invisible everywhere at once: absent from the ledger, absent
     * from the target reindexer's listing, and — because discovery counts by
     * calling this very method — absent from the item total the customer
     * approves at the confirm screen. Both sides of the verification gate
     * agreed on nothing and reported PASS.
     *
     * Reporting the count is what makes "leave them behind" an honest choice
     * rather than a silent one. Omitted (or 0) when there were none.
     */
    unkeyable?: number;
    /**
     * Source refs the server REPORTED as removed on this poll — Graph's
     * delta `@removed` entries, the mail equivalent of CalDAV's
     * `sync-collection` 404s (see `CalendarSource.listSince`).
     *
     * Message ids, not natural keys, and unavoidably so: a removed delta
     * entry carries no `internetMessageId` — `id` is all that is left, which
     * is why `sourceRef` is recorded at copy time and `findBySourceRef` is
     * the way back.
     *
     * IMAP never populates this — a plain mailbox listing has no removal
     * report — and that absence is legitimate, not a blind spot being
     * papered over: mail's other deletion evidence (the trash scan,
     * absence-counting) keeps working exactly as before. Absent must not be
     * read as "nothing was deleted".
     */
    removed?: ReadonlyArray<string>;
  }>;
  /** Fetch the full RFC822 bytes for an item. */
  fetch(item: MailItem): Promise<RawMessage>;
}

/**
 * Calendar source connector for CalDAV.
 */
export interface CalendarSource {
  /** List all calendar collections */
  listFolders(): Promise<ReadonlyArray<CalendarFolder>>;
  /**
   * List calendar items changed since cursor.
   */
  listSince(
    folder: CalendarFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawCalendarEvent>;
    nextCursor: SyncCursor;
    /**
     * Items this listing FOUND but could not turn into something migratable —
     * a card, event or file whose mapping threw. Omitted (or 0) when there
     * were none.
     *
     * NOT the same thing as mail's `unkeyable`, and the difference is the
     * whole point: an unkeyable message is still migrated, under a key the
     * sync generates. An unreadable item is LOST. Counting them in one field
     * would let discovery report a lost item as a carried one.
     *
     * The mail connector settled the rule this exists to keep (see
     * `SourceConnector.listSince`): *"Skipping is honest exactly when the same
     * object is already accounted for somewhere the owner looks."* Until
     * 2026-09-07 the Graph contact, calendar and drive listings each caught a
     * per-item mapping failure, wrote `log.warn`, and continued — so the item
     * was absent from the pass, absent from the count the customer approves,
     * and absent from the verification totals on both sides, which then agreed
     * with each other and reported PASS. The owner's "Contacts ✓ 1 address
     * book · 0 cards" could not be told apart from an address book whose every
     * card failed to map.
     *
     * A source that cannot fail this way omits the field; that absence is
     * legitimate, not a blind spot being hidden.
     */
    unreadable?: number;
    /**
     * Source hrefs the server reported as REMOVED on this poll (RFC 6578).
     *
     * `sync-collection` answers an incremental poll with the changed objects AND
     * the deleted ones — the latter as a `<response>` carrying just an href and a
     * 404 status. That is the source stating outright that an object is gone,
     * which is a stronger claim than anything else in this product has access to;
     * everywhere else deletion has to be inferred from repeated absence. See
     * {@link DeletionEvidence}.
     *
     * Hrefs, not natural keys, and unavoidably so: a removed object has no body
     * left, so there is no UID to key it by. The loop matches them back to items
     * via `Ledger.findBySourceRef`, which is why the href is recorded at copy
     * time.
     *
     * Absent (or empty) means the server reported no removals. Absent must not be
     * read as "nothing was deleted" — a full listing has no removals to report
     * either, and a source that does not speak sync-collection never populates
     * this at all.
     */
    removed?: ReadonlyArray<string>;
  }>;
}

/**
 * Contact source connector for CardDAV.
 */
export interface ContactSource {
  /** List all address book collections */
  listFolders(): Promise<ReadonlyArray<ContactFolder>>;
  /**
   * List contacts changed since cursor.
   */
  listSince(
    folder: ContactFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawContact>;
    nextCursor: SyncCursor;
    /**
     * Items this listing FOUND but could not turn into something migratable —
     * a card, event or file whose mapping threw. Omitted (or 0) when there
     * were none.
     *
     * NOT the same thing as mail's `unkeyable`, and the difference is the
     * whole point: an unkeyable message is still migrated, under a key the
     * sync generates. An unreadable item is LOST. Counting them in one field
     * would let discovery report a lost item as a carried one.
     *
     * The mail connector settled the rule this exists to keep (see
     * `SourceConnector.listSince`): *"Skipping is honest exactly when the same
     * object is already accounted for somewhere the owner looks."* Until
     * 2026-09-07 the Graph contact, calendar and drive listings each caught a
     * per-item mapping failure, wrote `log.warn`, and continued — so the item
     * was absent from the pass, absent from the count the customer approves,
     * and absent from the verification totals on both sides, which then agreed
     * with each other and reported PASS. The owner's "Contacts ✓ 1 address
     * book · 0 cards" could not be told apart from an address book whose every
     * card failed to map.
     *
     * A source that cannot fail this way omits the field; that absence is
     * legitimate, not a blind spot being hidden.
     */
    unreadable?: number;
    /** Hrefs the server reported as removed. See `CalendarSource.listSince`. */
    removed?: ReadonlyArray<string>;
  }>;
  /**
   * The rest of ONE card, for the pass that is about to write it.
   *
   * A listing is what a source can afford to read for every card at once, and
   * for Graph that is not the whole card: a contact's fields come in the delta
   * page, and its photo is a request of its own (`/contacts/{id}/photo/$value`).
   * A source whose listing already carries the whole card leaves this out, and
   * the listed card is written as before.
   *
   * The sync loop calls it once per card it WRITES, and never for one it skips
   * as already copied. It runs inside the loop's bounded concurrency, where a
   * file's download happens too. A throw fails that card, which is tried again.
   * Returning the listed card unchanged is how a source says there was nothing
   * to add.
   *
   * Optional, unlike `FileSource.fetch`, because a listed card is a complete
   * card for every source but one. Until 2026-09-23 that one had a `fetch` that
   * nothing called, since it was not on this port, so no Microsoft contact
   * ever reached its destination with its photo.
   */
  fetch?(item: RawContact): Promise<RawContact>;
}

/**
 * File source connector for WebDAV.
 */
export interface FileSource {
  /** List all file folders/directories */
  listFolders(): Promise<ReadonlyArray<FileFolder>>;
  /**
   * List files changed since cursor.
   *
   * METADATA ONLY. `RawFileItem.content` is expected to be absent here — the
   * bytes come from {@link FileSource.fetch}, one item at a time, inside the
   * sync loop's bounded concurrency.
   *
   * The WebDAV source used to GET every changed file's content inline in this
   * loop, serially, before the sync loop had started. Two consequences: the
   * downloads ignored `concurrency` entirely (only the uploads were parallel),
   * and a whole folder's bytes sat in memory at once — which is not a limit any
   * migration of real file storage can live within, and directly contradicts
   * the documented promise that concurrency "bounds peak memory to ~concurrency
   * bodies in flight".
   */
  listSince(
    folder: FileFolder,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<RawFileItem>;
    nextCursor: SyncCursor;
    /**
     * Items this listing FOUND but could not turn into something migratable —
     * a card, event or file whose mapping threw. Omitted (or 0) when there
     * were none.
     *
     * NOT the same thing as mail's `unkeyable`, and the difference is the
     * whole point: an unkeyable message is still migrated, under a key the
     * sync generates. An unreadable item is LOST. Counting them in one field
     * would let discovery report a lost item as a carried one.
     *
     * The mail connector settled the rule this exists to keep (see
     * `SourceConnector.listSince`): *"Skipping is honest exactly when the same
     * object is already accounted for somewhere the owner looks."* Until
     * 2026-09-07 the Graph contact, calendar and drive listings each caught a
     * per-item mapping failure, wrote `log.warn`, and continued — so the item
     * was absent from the pass, absent from the count the customer approves,
     * and absent from the verification totals on both sides, which then agreed
     * with each other and reported PASS. The owner's "Contacts ✓ 1 address
     * book · 0 cards" could not be told apart from an address book whose every
     * card failed to map.
     *
     * A source that cannot fail this way omits the field; that absence is
     * legitimate, not a blind spot being hidden.
     */
    unreadable?: number;
    /**
     * Source refs the service REPORTED as deleted on this poll.
     *
     * OneDrive/SharePoint answer a delta query with the items that changed and the
     * ones that were deleted, the latter carrying a `deleted` facet. That is the
     * Graph equivalent of a CalDAV `sync-collection` 404 — the service stating
     * outright that an item is gone — and it was being read and discarded.
     *
     * Refs, not paths: a deleted delta entry is not guaranteed to carry usable path
     * metadata, while its `id` always is present and never changes. Matched back
     * through `Ledger.findBySourceRef`, which is why the file domain records the
     * source's own handle rather than re-recording the path.
     *
     * Absent means none were reported, which is NOT "nothing was deleted": WebDAV
     * has no delta query at all and never populates this.
     */
    removed?: ReadonlyArray<string>;
    /**
     * Files this read returned that ANOTHER folder's listing yields.
     *
     * A OneDrive folder's delta is its whole subtree, so the Graph source
     * keeps each folder's own files and counts the rest here — which is how
     * the sync loop tells a folder holding only subfolders from one that
     * answered nothing (see `firstReadSawNothing` in `domain-sync.ts`).
     * Absent from every source whose listing is a folder's own children.
     */
    listedElsewhere?: number;
  }>;
  /**
   * Fetch one file's bytes. Called once per item by the sync loop.
   *
   * Required, not optional: a source that cannot produce content cannot
   * migrate files, and the loop's only alternative is to write an empty file
   * and call it a success.
   */
  fetch(item: FileItem): Promise<RawFileItem>;
  /**
   * A SNAPSHOT, not a scan (workplan 0116 §5).
   *
   * Set by a source whose complete listing is NOT a complete listing of what
   * the person has: an export archive, whose scope the person chose, whose
   * parts may have failed to download, and whose categories they may have
   * deselected between two requests. Deleted, deselected and truncated present
   * identically in it, so an item's absence from the listing is evidence of
   * nothing — weaker than `inferred`, this product's weakest deletion class,
   * which needs consecutive complete scans of a live account.
   *
   * The sync loop then never counts an absence against a ledger row and never
   * reports a deletion, even as a suspicion: an import from such a source adds
   * and updates, and a target keeps what a later snapshot no longer mentions.
   * Reported removals (`listSince().removed`) and a bin (`listTrashedPaths`)
   * are positive evidence and stay usable — a snapshot has neither.
   */
  readonly snapshot?: true;
  /**
   * Every file path currently in this collection, ignoring any cursor.
   *
   * Optional, and it exists for exactly one purpose: telling a file that MOVED
   * from one that was deleted. Files are keyed by path, so a move mints a new
   * natural key and the only trace of the old one is its absence — which
   * `listSince` cannot show, because with a cursor it returns just what changed
   * and everything untouched looks equally absent.
   *
   * Without this, move detection for files only ever ran on a cursor-less pass,
   * which in production means the first one and nothing after it — a detector
   * that could not fire when it mattered.
   *
   * Must be CHEAP: paths only, no content, no per-item round trips. For WebDAV
   * it is the same PROPFIND `listSince` already issues, without the change
   * filter. A source that cannot answer cheaply should not implement it; the
   * loop then reports moves only on a full scan, exactly as before.
   *
   * Paths must be identical in form to `FileItem.path`, since the loop hashes
   * both into the same natural key.
   */
  listKeys?(folder: FileFolder): Promise<ReadonlyArray<string>>;
  /**
   * Root-relative paths of files sitting in the owner's BIN on the source.
   *
   * Optional, because a bin is not a WebDAV concept: RFC 4918 has none, and this
   * is Nextcloud's own `/remote.php/dav/trashbin/…` extension. A source that
   * cannot answer leaves the file domain on absence-counting, which is a weaker
   * signal but an honest one.
   *
   * Whole-account rather than per-folder: a bin is one collection holding
   * everything the owner deleted, wherever it came from, and each entry carries
   * the ORIGINAL path rather than living at it.
   *
   * Paths must be identical in form to `FileItem.path`, since the loop hashes both
   * into the same natural key. That agreement is the entire feature: a path that
   * differs by a leading slash or a `rootPath` prefix hashes to something no row
   * has, and the result is not an error but SILENCE.
   */
  listTrashedPaths?(): Promise<TrashListing>;
}

/**
 * What a bin read found, and what it could not read — the two being different
 * answers rather than one short list.
 *
 * A bin entry that cannot be turned into a natural key is skipped either way,
 * because there is nothing to hash. The question this type exists to answer is
 * whether that skip is worth telling anyone about, and the mail connector
 * settled it first: it drops a binned message with no Message-ID and says so
 * in `reconcile.ts` — *"Nothing is lost by skipping it: those items are counted
 * as `unkeyable` wherever they are listed in scope."* The silence is earned by
 * the second half. Skipping is honest exactly when the same object is already
 * accounted for somewhere the owner looks.
 *
 * Two kinds of skip come out of that test differently, and only one belongs in
 * `unnameable`:
 *
 *  - **Out of scope** — the entry's original location is not under this
 *    migration's root (a Drive parent chain that tops out elsewhere, a Box
 *    ancestor chain that never passes the configured folder, a WebDAV location
 *    outside `rootPath`). NOT counted, and not a blind spot: an item outside
 *    the root was never copied, so no ledger row and no target copy exist to
 *    reconcile. `resolveDiscardedItems` re-checks this against the ledger
 *    anyway (`if (!row) continue`), so an over-broad bin listing is harmless
 *    and a connector-side scope filter can only ever lose true positives.
 *  - **Unnameable** — the entry probably WAS in scope and we cannot say where
 *    it lived: a Box item with no `path_collection`, a Drive item whose
 *    ancestor was permanently deleted, an unparseable WebDAV location. Nothing
 *    counts these anywhere, so they fail the mail test. Their cost is precise:
 *    the deletion still surfaces by absence-counting, but its evidence
 *    degrades from `trashed` to `inferred`, and ADR-0024 gate 3 then withholds
 *    the apply action — the owner sees a deletion they cannot action and no
 *    reason why. That is what this count exists to explain.
 */
export interface TrashListing {
  /** Root-relative original paths, in `FileItem.path` form. */
  readonly paths: ReadonlyArray<string>;
  /**
   * Entries that WERE possibly in scope and could not be named. Required, not
   * optional: a connector that has thought about its bin should state zero
   * rather than leave the question unanswered.
   */
  readonly unnameable: number;
  /** Why, in the source's own terms. Shown verbatim; set only when `unnameable > 0`. */
  readonly reason?: string;
}

/**
 * The same answer once the paths have become natural keys — what the sync loop
 * consumes. See {@link TrashListing} for what `unnameable` does and does not
 * count.
 */
export interface DiscardedListing {
  readonly keys: ReadonlyArray<string>;
  readonly unnameable: number;
  readonly reason?: string;
}

/**
 * Union type for all source connector types.
 * Used for factory functions that can return different source types.
 */
export type Source = SourceConnector | CalendarSource | ContactSource | FileSource;

/** Result of upserting one message into a target. */
export interface UpsertResult {
  /** Target-side id (e.g. a JMAP Email id). */
  readonly targetId: string;
  /** True if a new item was created; false if it already existed (idempotent skip). */
  readonly created: boolean;
  /**
   * True when the item was found ALREADY ON THE TARGET under our natural key
   * and therefore not written — as opposed to skipped because our own ledger
   * already had it.
   *
   * The two are very different facts and were indistinguishable: both return
   * `created: false`. A first migration into an account the customer is already
   * using reported exactly the same "0 created, N skipped" as a clean re-run of
   * a finished one, so nobody could tell that N items had been silently left as
   * the destination found them.
   *
   * Adoption is the right default — non-destructive, hard rule 2 — but it is a
   * decision about the customer's data and has to be visible before cutover.
   */
  readonly adopted?: boolean;
  /**
   * The target's own version marker for what we just wrote — a DAV ETag.
   *
   * Persisted so a LATER pass can tell whether the copy is still the one we
   * made. Absent when the server returns none, which costs that item its
   * overwrite protection and nothing else.
   */
  readonly targetVersion?: string;
  /**
   * The rewrite was REFUSED because the target copy is no longer the one we
   * wrote. Nothing was written.
   *
   * Set only on the overwrite path, and only when the caller supplied an
   * `expectedTargetVersion` that the target no longer reports. Somebody has
   * edited our copy in the new system — which shadow migration positively
   * invites, since the whole point is that the owner can start using it — and
   * hard rule 2 puts those bytes out of reach.
   *
   * Not an error, and deliberately not thrown: a conflict is a fact about
   * ownership, not a failure to migrate. Throwing would spend one of the item's
   * five attempts and count towards the systemic-failure tripwire, both of
   * which describe something else entirely.
   */
  readonly conflicted?: boolean;
  /**
   * True when an item WE had already copied was rewritten because the source
   * version changed — the shadow-sync update path (§11.1, "the source is
   * authoritative for content").
   *
   * Distinct from `created` and from `adopted`, and the distinction is the
   * whole safety argument: this only ever overwrites bytes this tool put there
   * itself. An item the destination already held is `adopted`, never rewritten.
   */
  readonly updated?: boolean;
}

/** Per-call instructions for a target write. */
export interface UpsertOptions {
  /**
   * Rewrite the target item even though the ledger already has it.
   *
   * Off by default, and the default is the rule: hard rule 2 is
   * "never auto-delete/overwrite on the target". The exception this flag opens
   * is narrow and is decided by `runDomainSync`, not by the writers — it is set
   * only for an item this tool itself copied, whose source version has since
   * changed. Nothing the customer already had on the target is ever eligible.
   */
  readonly overwrite?: boolean;
  /**
   * The source version (ETag) to persist on whatever ledger row this write
   * creates.
   *
   * Passed down rather than left to the sync loop because the WRITERS record
   * first and `recordIfAbsent` is a no-op on conflict — the comment in each
   * DAV writer says so outright ("`recordIfAbsent` makes the first writer win,
   * and that is this one"). So a version the loop wrote afterwards was
   * silently discarded, every row landed with `source_version` NULL, and the
   * next pass read that as "not known" and backfilled instead of rewriting.
   * The whole feature was one pass late, and only against a real ledger: an
   * in-memory fake that does not record from the writer never sees it.
   *
   * Undefined for a source with no version — the mail shape.
   */
  readonly sourceVersion?: string;
  /**
   * The source collection to persist on whatever ledger row this write creates.
   *
   * Passed down for the same reason as `sourceVersion`: the writers record
   * first and `recordIfAbsent` no-ops on conflict, so anything the loop records
   * afterwards is discarded.
   */
  readonly collection?: string;
  /**
   * Refuse the overwrite unless the target still reports this version.
   *
   * The ETag the server gave us when we wrote this item. Supplied only on the
   * rewrite path, and only when we have one; a writer that finds the target
   * reporting something else must write NOTHING and return
   * `conflicted: true`.
   *
   * This is what keeps hard rule 2 honest over time. Ownership was being judged
   * from `status === 'copied'`, which records that we wrote the bytes once —
   * not that they are still ours. An owner who edits a migrated item in the new
   * system silently loses that edit the next time the source changes.
   *
   * Absent means no check, which is the behaviour every row written before
   * migration 0023 gets, and any server that returns no ETag on PUT. Failing
   * closed instead would refuse every source change until each row had been
   * rewritten once — a protection that presents as an outage.
   */
  readonly expectedTargetVersion?: string;
  /**
   * The source's own handle for this item, to persist on the ledger row.
   *
   * Passed down for the same reason as `sourceVersion` and `collection`: the
   * writers record first and `recordIfAbsent` no-ops on conflict, so anything
   * the loop records afterwards is discarded.
   */
  readonly sourceRef?: string;
}

/** A target mailbox store the engine writes to. NEVER deletes or overwrites (non-destructive). */
export interface TargetWriter {
  /** Ensure a mailbox exists for the given folder/role; return its target id. */
  ensureMailbox(folder: MailFolder): Promise<string>;
  /**
   * Idempotently write a message into the target mailbox: **create-if-absent keyed on the
   * natural key**. The implementation SHOULD verify existence on the target itself (JMAP
   * `Email/query` on header `Message-ID`; IMAP `SEARCH HEADER Message-ID`) in addition to the
   * ledger fast-path, so even an empty ledger never produces duplicates. Keywords and the
   * original receivedAt are preserved. See ADR-0020 (the ledger is a rebuildable cache).
   */
  upsertEmail(
    mailboxId: string,
    raw: RawMessage,
    keywords: ReadonlyArray<MailKeyword>,
  ): Promise<UpsertResult>;
  /**
   * Existence check for create-if-absent (ADR-0020): return the target id of an item already
   * present in `mailboxId` with this natural key (JMAP `Email/query` on header `Message-ID`;
   * IMAP `SEARCH HEADER Message-ID`), or `undefined`. `upsertEmail` relies on this so an empty
   * ledger never causes duplicates.
   */
  findByNaturalKey(mailboxId: string, naturalKey: string): Promise<string | undefined>;
}

/**
 * Calendar target writer for CalDAV sync.
 */
export interface CalendarTargetWriter {
  /** Ensure a calendar collection exists; return its target id. */
  ensureCalendar(folder: CalendarFolder): Promise<string>;
  /**
   * Idempotently write a calendar event.
   *
   * With `options.overwrite`, rewrite one this writer already holds — the
   * shadow-sync update path. Only `runDomainSync` sets it, and only for an
   * item it copied itself whose source version has since changed.
   */
  upsertCalendarEvent(
    calendarId: string,
    raw: RawCalendarEvent,
    options?: UpsertOptions,
  ): Promise<UpsertResult>;
  /**
   * Existence check for create-if-absent.
   */
  findCalendarByNaturalKey(calendarId: string, naturalKey: string): Promise<string | undefined>;
}

/**
 * Contact target writer for CardDAV sync.
 */
export interface ContactTargetWriter {
  /** Ensure an address book collection exists; return its target id. */
  ensureContactFolder(folder: ContactFolder): Promise<string>;
  /**
   * Idempotently write a contact.
   *
   * With `options.overwrite`, rewrite one this writer already holds — the
   * shadow-sync update path. Only `runDomainSync` sets it, and only for an
   * item it copied itself whose source version has since changed.
   */
  upsertContact(
    folderId: string,
    raw: RawContact,
    options?: UpsertOptions,
  ): Promise<UpsertResult>;
  /**
   * Existence check for create-if-absent.
   */
  findContactByNaturalKey(folderId: string, naturalKey: string): Promise<string | undefined>;
}

/**
 * File target writer for WebDAV sync.
 */
export interface FileTargetWriter {
  /** Ensure a directory exists; return its target id. */
  ensureDirectory(folder: FileFolder): Promise<string>;
  /**
   * Idempotently write a file.
   *
   * With `options.overwrite`, rewrite one this writer already holds — the
   * shadow-sync update path. Only `runDomainSync` sets it, and only for an
   * item it copied itself whose source version has since changed.
   */
  upsertFile(
    parentId: string,
    raw: RawFileItem,
    options?: UpsertOptions,
  ): Promise<UpsertResult>;
  /**
   * Existence check for create-if-absent.
   */
  findFileByNaturalKey(parentId: string, naturalKey: string): Promise<string | undefined>;
}


/**
 * How final a removal on the target turned out to be.
 *
 * Reported rather than assumed, because it differs per target and an operator
 * deciding whether to press the button needs to know which one they are getting.
 *
 * - `'binned'` — the copy went to the target's own bin and the owner can still
 *   get it back for whatever window that server keeps. A Nextcloud files DELETE
 *   does this; so does moving a message into the target's `\Trash` mailbox.
 * - `'deleted'` — gone, with no recovery path from our side.
 */
export type RemovalKind = 'binned' | 'deleted';

/** Outcome of removing one item's copy from the target. */
export interface RemovalResult {
  /** How final it was. Absent when nothing was removed. */
  readonly kind?: RemovalKind;
  /**
   * The copy has been EDITED on the target since we wrote it, so nothing was
   * removed.
   *
   * The same contract as `UpsertResult.conflicted`, and for the same reason: an
   * item the owner has changed in the new system is theirs, and hard rule 2 is
   * absolute about it. Refusing here rather than in the caller keeps the check
   * where the ETag is, which is the only place it can be done without a race.
   */
  readonly conflicted?: boolean;
}

/**
 * A target writer that can remove a copy it wrote.
 *
 * OPTIONAL, and deliberately a separate interface rather than a method on the
 * four target ports. Removal is the one destructive capability in this product,
 * so a writer has to opt in by implementing it, and a writer that has not
 * implemented it makes `applyDeletion` REFUSE with that reason rather than
 * silently doing nothing. Bolting it onto `TargetWriter` would have made every
 * test double and every future writer destructive-capable by default.
 */
export interface TargetRemover {
  /**
   * Remove the copy identified by `targetId`, binning it where the target has a
   * bin and deleting it outright where it does not.
   *
   * `expectedTargetVersion` is the version marker we recorded when we wrote the
   * item. When supplied, the writer must remove NOTHING and answer
   * `conflicted: true` if the target reports anything else — the mirror of the
   * overwrite protection on `UpsertOptions`.
   *
   * `collection` is the collection recorded on the ledger row, passed because
   * NOT EVERY TARGET ID IS GLOBALLY UNIQUE. A JMAP Email id and a DAV href both
   * identify an object on their own, so those writers ignore this. An IMAP UID
   * does not: it is only meaningful inside one mailbox, and the same number
   * names a different message in the next one. A writer whose ids are
   * collection-scoped MUST refuse rather than guess when this is absent or
   * empty — guessing on the one destructive operation in the product means
   * removing a message nobody asked about.
   */
  removeItem(
    targetId: string,
    options?: {
      readonly expectedTargetVersion?: string;
      readonly collection?: string;
    },
  ): Promise<RemovalResult>;
}

/** Does this object implement {@link TargetRemover}? */
export function canRemove(target: unknown): target is TargetRemover {
  return typeof (target as TargetRemover | undefined)?.removeItem === 'function';
}

/**
 * Ask the target whether a copy is REALLY there (ADR-0030, amended).
 *
 * OPTIONAL, and separate from `TargetRemover` for the same reason that one is
 * separate: a writer opts in, and one that has not makes the caller refuse
 * rather than assume.
 *
 * WHY IT EXISTS. `applyRelocation` removes the target's old copy of a moved
 * file, and the only thing that makes that admissible is the same bytes being
 * present under the new key. It was checked against the LEDGER — and the ledger
 * is a claim, not the target. ADR-0024 deliberately removes-then-records, so a
 * crash or a failed write between the two leaves a row saying `copied` for a
 * copy that is already gone. Trusting such a row is how the last copy of a file
 * gets destroyed by an operation that reports the opposite.
 *
 * So the destructive path asks. A writer that cannot answer does not get to
 * host this operation.
 */
export interface TargetPresenceCheck {
  /**
   * Is `targetId` still on the target?
   *
   * `false` means confidently absent. THROW rather than answer `false` when the
   * question could not be put — a network error, a permission problem, a
   * timeout. The caller treats an exception as "do not proceed", and treating
   * an outage as absence is how a removal gets authorised by a broken network.
   *
   * `collection` is passed for the same reason `removeItem` takes one: not
   * every target id is meaningful on its own.
   */
  hasItem(
    targetId: string,
    options?: { readonly collection?: string },
  ): Promise<boolean>;
}

/** Does this object implement {@link TargetPresenceCheck}? */
export function canConfirmPresence(target: unknown): target is TargetPresenceCheck {
  return typeof (target as TargetPresenceCheck | undefined)?.hasItem === 'function';
}

/** One existing item discovered on the target during reindex/adoption (ADR-0020). */
export interface TargetEntry {
  /** Natural key as stored on the target (e.g. Message-ID). */
  readonly naturalKey: string;
  /**
   * Target-side id (e.g. a JMAP Email id).
   *
   * For the DAV writers this is a path in the WRITER'S coordinate system —
   * leading slash, relative to the configured endpoint — because that is what
   * `buildUrl` consumes and what the write path records. Never the server's
   * own href: those come back endpoint-absolute, and one fed through
   * `buildUrl` carries the DAV prefix twice. `targetIdRelativeTo` converts.
   */
  readonly targetId: string;
  /** Mailbox/folder the item lives in on the target. */
  readonly mailboxId: string;
  /** Content hash, if cheaply available from the listing; used as a fallback key. */
  readonly contentHash?: string;
  /**
   * Size in bytes as the target reports it, when the listing already carries it
   * (JMAP `size`, IMAP `RFC822.SIZE`, DAV `getcontentlength`).
   *
   * This is what lets verification report `totalBytesTarget` as a real
   * measurement. Leave it undefined rather than guessing: an estimated total is
   * indistinguishable from a measured one in the report, and the whole point of
   * the field is that it was measured.
   */
  readonly sizeBytes?: number;
}

/**
 * Reads existing items off the target to rebuild idempotency state (ADR-0020, workplan T9).
 * Used when the ledger is empty but the target is non-empty (a fresh reinstall), and on demand.
 * Enumeration is header/metadata-only (Message-ID / UID / path) and may be large — implementations
 * SHOULD page; the async iterable lets callers stream without loading everything into memory.
 */
export interface TargetReindexer {
  /** Stream every existing item's natural key + target id (optionally scoped to one mailbox). */
  listEntries(mailboxId?: string): AsyncIterable<TargetEntry>;

  /**
   * Hash the item's content AS STORED ON THE TARGET, for §20 checksum sampling.
   * Called only for sampled items, so it may fetch the body.
   *
   * Implement this ONLY where the target stores the bytes verbatim, so the
   * result is directly comparable to the source hash the ledger recorded —
   * mail (a JMAP blob / IMAP `BODY[]` is the message as submitted) and files
   * (WebDAV serves back what was PUT).
   *
   * Deliberately NOT implemented for CalDAV/CardDAV: servers re-serialize
   * iCalendar and vCard (property reordering, re-folded lines, their own
   * PRODID), so a hash of what comes back would differ from the source hash for
   * every single item — reporting a healthy migration as 100% corrupt. Leaving
   * it out means those samples are counted as `checksumUnavailable`, which says
   * "not measured" instead of inventing a verdict.
   *
   * Return undefined when this particular item's content cannot be read;
   * the sample is then counted as unavailable rather than as a mismatch.
   *
   * `scheme` SAYS WHICH QUESTION TO ANSWER, and answering a different one is
   * worse than answering none (ADR-0046, 0042 T7). The ledger's stored hash
   * carries the scheme that made it; the caller reads that and asks for the
   * same one back, because a value taken one way and a value taken another way
   * say nothing about each other. An implementation that cannot produce the
   * scheme it was asked for returns **undefined** — "not measured", which is
   * already this method's answer for anything it cannot read — and never a
   * hash of a different kind, which would be a comparison nobody made.
   * Omitted means `bytes`, which is what every caller wanted before renderings
   * existed and what every row without a tag still means.
   */
  contentHashFor?(entry: TargetEntry, scheme?: TargetHashScheme): Promise<string | undefined>;
}

/**
 * Which way to hash what the target holds — see `contentHashFor`.
 *
 * Two, not three: this is not the ledger's tag vocabulary (`cal1:`, `zip1:`,
 * untagged) but the question a target can be ASKED. A caller maps a stored
 * tag onto one of these; a target answers it or answers nothing.
 */
export type TargetHashScheme = 'bytes' | 'container-parts';

/** One row of idempotency state. */
export interface LedgerRecord {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly itemType: DiscoveryDomain;
  readonly naturalKeyHash: string;
  /**
   * The item's own identifier in plain text — a Message-ID, a UID, a file path.
   *
   * NOT a key: `naturalKeyHash` above is what every lookup and every action
   * uses, and nothing reads this to find a row. It exists so the confirmed list
   * can say WHICH item a row is, which is the whole point of a document
   * somebody empties their old account on the strength of (see
   * `confirmed-list.ts`, where §17's exception for it is argued).
   *
   * Optional, and `''` means "not recorded" — which is every row written before
   * 2026-09-12, because the ledger hardcoded `''` here with a comment saying a
   * caller would set it while this field did not exist for one to set. A caller
   * with nothing to say leaves the column alone rather than blanking it, the
   * same rule `collection` and `sourceRef` follow.
   */
  readonly naturalKey?: string;
  /**
   * The name a PERSON calls this item: an event's SUMMARY, a contact's FN.
   *
   * Beside `naturalKey`, never instead of it. The key is what the source calls
   * the item and is unique; this is what its owner calls it and is not. Two
   * people named Jan Jansen are two rows, keyed apart and labelled the same,
   * and that is correct.
   *
   * Absent for a domain whose key is ALREADY the name (a file's path) and for
   * one whose name this code cannot yet read (a mail Subject lives behind RFC
   * 2047 encoded-words). See `displayNameForCalendar` in `hash.ts` for which
   * domains fill it and why the other two do not.
   *
   * Optional and never blanked, the same rule `naturalKey` follows: a caller
   * with nothing to say leaves the column alone rather than erasing what an
   * earlier pass recorded.
   */
  readonly displayName?: string;
  /**
   * WHAT WE CORRECTED IN THIS ITEM'S BYTES ON THE WAY OUT (workplan 0124 T1).
   *
   * One sentence per correction, joined — naming the line, the property and the
   * parameter, and never a value. Absent is the ordinary answer and means
   * nothing was corrected; it is NOT the same as "we did not look", because the
   * repair runs on every card and answers empty for a well-formed one.
   *
   * This is the guard rail that makes repairing somebody's content acceptable
   * at all. A pass must never quietly do something to a customer's data — so
   * the change lives on the row they can read, not in a log nobody does. If the
   * rule ever fires where it should not, this is where the evidence is.
   */
  readonly repaired?: string;
  readonly contentHash: string;
  readonly targetId: string;
  /** ISO 8601 timestamp the row was first recorded. */
  readonly createdAt: string;
  /** Size in bytes of the item (optional for backward compatibility). */
  readonly sizeBytes?: number;
  /** Status of the item sync (copied, updated, skipped, failed, etc.). */
  /**
   * `'adopted'` means the item was already on the target under our natural key,
   * so nothing was written. Kept distinct from `'updated'`: both mean "not
   * created", but only this one says the destination account was not empty.
   */
  readonly status?:
    | 'pending'
    | 'copied'
    | 'updated'
    | 'adopted'
    | 'skipped'
    | 'failed'
    /**
     * The owner saw a parked failure and chose to migrate without this item.
     * Terminal: never retried, and verification counts it as knowingly
     * excluded rather than missing. See migration 0021.
     */
    | 'left_behind'
    | 'deleted_source'
    /**
     * The owner decided a source deletion should follow through, and this
     * tool removed the target's copy. Terminal, and the ONLY status that
     * records something this product destroyed.
     *
     * The row is deliberately kept: it is the record that the item existed,
     * was migrated, and was then removed on a specific date by a specific
     * decision. Deleting the row instead would leave no trace of any of it.
     *
     * The name and the CHECK constraint have existed since migration 0001 and
     * nothing ever wrote this value — the fifth vacant slot in this schema,
     * after `collection`, `target_version`, `absent_passes` and `source_ref`.
     * It is used rather than replaced because it is exactly right, and because
     * `isOnTarget` had to learn about it either way: read as "on the target",
     * a tombstoned row makes §20 verification expect bytes that were removed
     * on purpose.
     */
    | 'tombstoned'
    /**
     * A name this document had under another export policy, now recorded
     * under the one the current policy gives it (workplan 0042 T8 (b),
     * migration 0056). Only a row that never reached the target ends this
     * way, so it is not on the target, not an open problem, and not a
     * decision: if the name itself comes back, the row is tried again.
     */
    | 'superseded';
  /**
   * The same document under the name the current export policy gives it.
   *
   * On a `superseded` row, the row that took over from it (0042 T8 (b)). On a
   * copy still on the target (`copied` or `updated`), the row it is an earlier
   * export of: the document was exported again under another name, and this
   * copy is what the earlier policy left (`Ledger.markEarlierExports`). Absent
   * on every other row.
   */
  readonly supersededByNaturalKeyHash?: string;
  /**
   * The SOURCE collection this item lived in when we copied it.
   *
   * The column has existed since 0001 and nothing ever wrote it — every row
   * carried `''`. So the ledger could say WHAT had been migrated and never
   * WHERE it came from, which makes a move undetectable: for a stable-key
   * domain the item simply reappears under a different folder and the ledger
   * has nothing to compare against.
   *
   * Empty string means "not recorded" — every row written before this — and is
   * never treated as a move. Guessing would turn a whole corpus into moves on
   * first upgrade.
   */
  readonly collection?: string;
  /**
   * The TARGET's own version marker (an ETag) for our copy, as we last wrote it.
   *
   * The mirror of `sourceVersion`: that one says what the source looked like
   * when we read it, this one says what the target looked like when we left it.
   * Compared before any rewrite — if the target reports something else, the
   * copy has been edited in the new system and is no longer ours to replace.
   *
   * An ETag rather than a hash of the bytes on purpose: CalDAV and CardDAV
   * servers may normalise what they store, so a re-read can differ from what we
   * sent for reasons that have nothing to do with anyone editing it. The ETag
   * is minted after any normalisation.
   *
   * Absent means "not known", and never blocks a write. See migration 0023.
   */
  readonly targetVersion?: string;
  /**
   * The SOURCE's own handle for this item — a DAV href.
   *
   * The bridge from a removal report back to an item. CalDAV and CardDAV speak
   * RFC 6578 `sync-collection`, which reports a deleted object as its HREF with
   * a 404 status; a removed object has no body left, so the href is all there
   * is. Our natural key for those domains is the UID, which lives inside that
   * body — without the href recorded at copy time, "this href is gone" cannot be
   * turned into "this item is gone" and the report is unusable.
   *
   * Absent means not recorded: every row written before migration 0025, and any
   * source with no stable per-item handle. Those items cannot be matched against
   * a removal report and fall back to the absence-counting in 0024.
   */
  readonly sourceRef?: string;
  /**
   * Where the SOURCE lists this item now, when that is no longer `collection`.
   *
   * Absent means "not moved". Together the two say "we put it here, the source
   * has since put it there" — `collection` deliberately keeps describing where
   * the target's copy actually is, because that is the only place it is.
   */
  /**
   * Consecutive complete scans that failed to find this item on the source.
   *
   * 0 or absent means "present, or never checked". See migration 0024 for why
   * this is a count and not a flag.
   */
  readonly absentPasses?: number;
  /**
   * When the SOURCE first reported this item as removed (RFC 6578).
   *
   * Absent means it has told us nothing — which is always the case for mail and
   * files, neither of which has such a report. Evidence of a different KIND from
   * `absentPasses`, not a stronger degree of it: see {@link DeletionEvidence}.
   */
  readonly deletionReportedAt?: string;
  /**
   * When a copy of this item was first found in the owner's bin on the source.
   *
   * Absent means we have not seen it there — including for every domain whose
   * source has no bin we can read. See {@link DeletionEvidence}.
   */
  readonly deletionTrashedAt?: string;
  /** When the owner decided to keep the target's copy of a vanished item. */
  readonly deletionAcknowledgedAt?: string;
  /**
   * When this tool REMOVED the target's copy, following the owner's decision.
   *
   * The audit trail for the only destructive thing this product does. Present
   * only alongside `status: 'tombstoned'`, and what distinguishes an applied
   * decision from a `keep` — both close the queue entry, and only one of them
   * took something away.
   */
  readonly deletionAppliedAt?: string;
  readonly movedToCollection?: string;
  /**
   * The natural key the item is listed under NOW, when that key changed too.
   *
   * Present only for a RELOCATION — a path-keyed item whose move or rename
   * produced a new key, correlated by content hash (ADR-0030). A mail or
   * calendar item keeps its key when it moves, so this stays absent for them,
   * and that absence is load-bearing: `applyRelocation` is offered only where
   * this is set, because the whole safety argument is that the same bytes are
   * already on the target under THIS key.
   */
  readonly movedToNaturalKeyHash?: string;
  /**
   * The move above was paired by the source's own id, not by equal bytes
   * (workplan 0042 T10): a renamed Google document whose two exports differ
   * byte for byte. Apply then asks for the same id instead of the same bytes.
   */
  readonly movedByIdentity?: boolean;
  /**
   * When the move above was RECORDED (migration 0013). Re-stamped when the
   * destination changes — a move somewhere new is a new report — and cleared
   * with the move. The queue's age, and ADR-0031's survived-a-pass gate.
   */
  readonly movedRecordedAt?: string;
  /**
   * When the owner saw the move and chose to leave the target alone (§11.2).
   *
   * Absent while the move is still open. Cleared automatically if the item
   * moves AGAIN somewhere else — a decision about one arrangement is not
   * consent to every later one.
   */
  readonly moveAcknowledgedAt?: string;
  /**
   * How many times this item has been attempted and failed. Attempts, and
   * nothing else.
   *
   * Reset to 0 by an operator RETRY. Reaching `MAX_ITEM_ATTEMPTS` is one of
   * the two ways an item stops being retried automatically; `parkedAt` is the
   * other, and it does not wait for a count. Until 2026-09-14 parking was
   * written INTO this number, which put "5 tries" in front of an owner for a
   * policy refusal attempted once.
   */
  readonly attemptCount?: number;
  /**
   * When this item stopped being retried and started waiting on a person.
   *
   * Absent means it is still in the automatic lane. A decision-class failure
   * (see `isDecisionError`) is parked on its FIRST attempt — a policy that
   * answers the same way every pass is not something to try five times — so
   * `attemptCount` alone cannot say whether an item is parked, and since
   * migration 0046 it no longer pretends to.
   */
  readonly parkedAt?: string;
  /**
   * The last error, verbatim.
   *
   * The whole point of the failure queue: an operator cannot choose between
   * retrying and accepting without knowing what the server actually said. Hard
   * rule 9 — never mask errors — and per-item isolation only respects it if
   * the error survives somewhere durable.
   *
   * Server-side only in the sense that it is never a metric LABEL (§17); it is
   * ledger data and is exposed on the operator's own status surface.
   */
  readonly lastError?: string;
  /**
   * What KIND of failure `lastError` was (migration 0049).
   *
   * On the RECORD as well as on `ItemFailure` so the in-memory ledger can hold
   * what the real one stores: a fake that dropped this would let a test assert
   * a remedy the product never wrote, which is the shape of mistake every
   * other comment in that file exists to prevent.
   */
  readonly lastErrorCategory?: FailureCategory;
  /**
   * The SOURCE's own version marker for the item as we last copied it — a DAV
   * ETag, and nothing else today.
   *
   * This is what makes a weeks-long shadow sync current rather than a one-shot
   * copy. §11.1: "the source is authoritative for content." Without a version
   * to compare, the ledger can only answer "have I seen this natural key",
   * which is true forever once an item is copied — so an event rescheduled in
   * week two would still be the week-one version at cutover.
   *
   * Deliberately opaque: the sync loop compares it for EQUALITY and never
   * parses or orders it. An ETag is an opaque validator per RFC 9110 §8.8.3,
   * and a server is free to change its shape.
   *
   * Undefined means "not known", which is the honest state for a row written
   * before this column existed and for any source that offers no version.
   * Neither is treated as changed — see `runDomainSync`.
   */
  readonly sourceVersion?: string;
}

/**
 * One sharing-queue row (ADR-0032): a grant the §14.2 inventory discovered,
 * held as a checklist item. `open` is the only state without a decider —
 * every settled row answers who and when, which is what makes the queue a
 * checklist rather than a report.
 */
/** One settled setup step. Absence of a row means the step is still open. */
export interface SetupStepRow {
  readonly id: string;
  readonly side: 'source' | 'target';
  readonly provider: string;
  readonly stepKey: string;
  readonly state: 'open' | 'done' | 'skipped';
  readonly decidedBy?: string;
  readonly decidedAt?: string;
}

export interface ShareGrantRow {
  readonly id: string;
  readonly grantHash: string;
  readonly subject: string;
  readonly onLabel: string;
  readonly grantee?: string;
  readonly role: string;
  readonly viaLink: boolean;
  /** The grant verbatim, in the source's own words — evidence, never parsed. */
  readonly raw: string;
  /** mapGrant's two verdicts: a clean target equivalent exists, or a person decides. */
  readonly verdict: 'clean' | 'manual';
  /** What it corresponds to on the target / what to do instead. */
  readonly verdictTarget: string;
  readonly state: 'open' | 'applied' | 'done_manual' | 'skipped';
  readonly stateReason?: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly scannedAt: string;
  /**
   * Where the thing sits, in the SOURCE's own ids (workplan 0123 T4) — what
   * `groupShareGrants` folds a folder's contents on. All three optional, and
   * absent is a real answer: a row the source could not place is listed on its
   * own, never folded under a container on a guess (hard rule 9). Rows scanned
   * before migration 0053 have none of them and group again on the next scan.
   */
  readonly itemKey?: string;
  readonly parentKey?: string;
  readonly isContainer?: boolean;
}

/** Idempotency ledger. UNIQUE(tenantId, mappingId, itemType, naturalKeyHash). Non-destructive. */
/**
 * One name a listed document would have had under another export policy
 * (workplan 0042 T8 (b)). See `Ledger.supersedeFormerNames`.
 */
export interface FormerName {
  /** The key the document had, or would have had, under another policy. */
  readonly formerNaturalKeyHash: string;
  /** The key this pass listed it under. */
  readonly naturalKeyHash: string;
  /** The source's own handle for the document, when it has one. */
  readonly sourceRef?: string;
}

export interface Ledger {
  /** Look up an existing record by natural key. */
  find(
    tenantId: TenantId,
    mappingId: MappingId,
    itemType: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<LedgerRecord | undefined>;
  /**
   * Record a mapping if absent. If a row with the same
   * (tenantId, mappingId, itemType, naturalKeyHash) exists, return it unchanged (no-op);
   * otherwise insert and return the new row.
   */
  recordIfAbsent(record: LedgerRecord): Promise<LedgerRecord>;
  /**
   * Overwrite the mutable state of an EXISTING row: content hash, target id,
   * size, status and source version. Never inserts — a natural key with no row
   * is a caller bug, not a row to create, and this throws rather than quietly
   * creating one behind `recordIfAbsent`'s back.
   *
   * Exists because `recordIfAbsent` is a no-op on conflict, which is exactly
   * right for idempotency and exactly wrong for the one case where the source
   * item legitimately changed. The natural key — the idempotency anchor — is
   * never touched here (hard rule 1); only the facts about the copy are.
   */
  recordUpdate(record: LedgerRecord): Promise<LedgerRecord>;
  /**
   * Record that an item could not be migrated: bump `attempt_count`, store the
   * verbatim error, and set status `failed`.
   *
   * Inserts when the item has never been recorded and updates when it has, so
   * a second failure of the same item counts as a second attempt rather than a
   * silent no-op (which is what `recordIfAbsent` would have done — leaving
   * `attempt_count` at 1 forever and making a permanently broken item
   * indistinguishable from one that failed once).
   *
   * `options.park` records the failure as one that is NOT going to be retried
   * automatically: it stamps `parked_at`, so the next pass hands the item to a
   * person instead of fetching it again. For decision-class failures (see
   * `isDecisionError`) — a policy that answers the same way every time is not
   * something to try five times.
   *
   * It does NOT touch the attempt count beyond the single increment every
   * failure gets. Until 2026-09-14 parking WAS the count — `attempt_count`
   * jumped to `MAX_ITEM_ATTEMPTS` — and the owner's screen, which prints that
   * number, reported five attempts against a Google Doc we asked for once.
   */
  recordFailure(
    record: LedgerRecord,
    error: string,
    options?: {
      readonly park?: boolean;
      /**
       * Which side threw, when the pass could tell (0094 T5) — the input the
       * item's `last_error_category` is derived from, in the same statement
       * that writes the prose (migration 0049).
       *
       * A source refusal and a target one read IDENTICALLY, so this is the only
       * thing that can tell `source_refused` from `target_refused`. Optional
       * because a failure raised outside either closure genuinely has no side,
       * and `undefined` is a real answer there rather than a guess.
       */
      readonly side?: FailureSide;
      /**
       * The category the THROW SITE named, when it named one (workplan 0125
       * T4) — read off the thrown value by `statedFailureCategoryOf`, on the
       * same line that reads the side, and never parsed out of `error`.
       *
       * Set only by errors this codebase builds itself, which already know
       * what they are: `NativeFileRefused` branches on whether a setting would
       * change the answer before it writes a word of prose, and a regex over
       * that prose is a second, worse derivation of what it knew. It wins over
       * both the message and the side, because it is first-hand.
       *
       * `undefined` is the normal case — a provider's error states nothing —
       * and means the message is read exactly as it always was.
       */
      readonly category?: FailureCategory;
    },
  ): Promise<LedgerRecord>;
  /**
   * Everything the ledger says is ON THE TARGET for one domain, with the source
   * collection each item came from.
   *
   * Used to notice items that have DISAPPEARED from the source since the last
   * pass, and to correlate a disappearance with an identical item appearing
   * elsewhere — which is what a move looks like in a path-keyed domain, where
   * the natural key itself changes and nothing else can connect the two.
   *
   * Whole-domain rather than per-collection on purpose. A source folder that
   * was RENAMED is not in the folder listing at all, so a per-collection query
   * driven by what the pass scanned would never look at its rows and the
   * largest kind of reorganisation there is would go unreported.
   *
   * Two exclusions, both load-bearing:
   *
   *   - rows that are not on the target (`failed`, `left_behind`) — nothing was
   *     placed for them, so their absence from a listing means nothing;
   *   - rows with no recorded collection, i.e. everything written before the
   *     column was populated. Those cannot say where they came from, and
   *     including them would report an entire legacy corpus as vanished on the
   *     first full scan after upgrading.
   */
  placedItems(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
  ): Promise<
    Array<{
      naturalKeyHash: string;
      contentHash: string;
      collection: string;
      /** A move already recorded against this row, if any. See `recordMove`. */
      movedToCollection?: string;
      /**
       * The key it moved to, when the key itself changed — a RELOCATION
       * (ADR-0030). Carried so a remembered one can be re-reported as such on
       * later passes, once the arrival is no longer new and there is nothing
       * left to correlate against.
       */
      movedToNaturalKeyHash?: string;
      /** When the move was recorded; re-stamped when the destination changes. */
      movedRecordedAt?: string;
      /** Set once the owner has decided about that move. */
      moveAcknowledgedAt?: string;
      /** Consecutive complete scans that have failed to find it. */
      absentPasses?: number;
      /** Set once the owner has decided about its disappearance. */
      deletionAcknowledgedAt?: string;
      /**
       * Set once the target's copy was actually REMOVED by an apply.
       *
       * Carried because move detection must not let an already-removed row
       * compete for arrivals: it would steal the correlation that explains a
       * live rename, and re-open a destructive queue entry for a decision
       * somebody already carried out. The rows stay in this listing for the
       * mass-deletion breaker's denominator, which is why they have to be
       * distinguishable rather than absent.
       */
      deletionAppliedAt?: string;
      /**
       * The key this copy is an earlier export of (0042 T8 (b), second half):
       * the document is listed under the name the current export policy gives
       * it. Carried so the detector leaves an explained copy alone, and clears
       * the mark when the old name is given again.
       */
      supersededByNaturalKeyHash?: string;
      /**
       * The source's own handle for the item, where it recorded one — for a
       * Drive file, its id. What a renamed Google document is paired by
       * (workplan 0042 T10).
       */
      sourceRef?: string;
    }>
  >;
  /**
   * HOW MANY ITEMS WE DELIBERATELY DID NOT WRITE, per domain (workplan 0124 T2).
   *
   * The migration page could report what was copied, what failed, what is
   * retrying and what is waiting on a decision — and had no word at all for the
   * items hard rule 2 left standing. Those are not failures and they are not
   * copies, so every existing counter was the wrong place to put them, and a
   * person reading a total that did not add up had nothing to read instead.
   *
   * ONE COUNT, AND IT MUST STAY ONE. Two different rows wear `status =
   * 'adopted'` and `confirmed-list.ts` is emphatic that they are different
   * things: an item the target already held under our natural key and we never
   * wrote, and one we wrote once that the customer has since edited, where hard
   * rule 2 leaves their edit standing. **The ledger cannot tell them apart
   * after the fact** — the second is recorded by rewriting the first's status —
   * so this returns a single number and the screen says a sentence true of
   * both. Splitting it would be inventing a distinction the data cannot
   * support, which is worse than the silence it replaces.
   *
   * A domain with no adopted rows is ABSENT from the map rather than zero, so a
   * caller can tell "none" from "this domain was never counted" — the reports
   * are built per status row, and a domain may have one without this query
   * having run for it.
   */
  countAdoptedByDomain(
    tenantId: TenantId,
    mappingId: MappingId,
  ): Promise<Readonly<Partial<Record<DiscoveryDomain, number>>>>;
  /** Unresolved failures for a domain, newest attempt first. */
  listFailures(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: DiscoveryDomain,
  ): Promise<ItemFailure[]>;
  /**
   * Apply an owner decision to one failed item.
   *
   * `'retry'` resets `attempt_count` so the next pass tries again; `'accept'`
   * moves it to `left_behind` for good. Returns false when there is no failed
   * row under that key — an already-resolved item must not silently look like
   * a successful decision.
   */
  /**
   * Apply one decision to a GROUP of failed items, and say how many it changed.
   *
   * WHY A GROUP AND NOT A LOOP OVER ONE. A connector bug parks items by the
   * dozen, and its fix parks nothing — but parking does not clear itself, so
   * every item the old code exhausted stays parked for a defect that no longer
   * exists. Live 2026-09-11 that was 82 files behind one non-recursive MKCOL,
   * and the only ways to clear them were 82 button presses or hand-written
   * SQL against the ledger. The owner ran the SQL.
   *
   * `match` NARROWS, and at least one narrowing is required of the caller (the
   * route enforces it): a bare "retry everything failed" would also reset the
   * policy refusals sitting beside them, which re-park on first sight and buy
   * nothing but a refetch each. The two that matter in practice are the domain
   * and a substring of the error, because "everything that failed the same way"
   * is how a person actually thinks about a connector bug.
   *
   * `errorContains` is matched LITERALLY. A needle carrying `%` or `_` must not
   * widen the match — `50%` is an ordinary thing to find in a filename, and a
   * bare LIKE would turn it into "anything".
   *
   * Returns the number of rows changed, never a boolean: a caller that cannot
   * say how many items it just put back in front of the loop is reporting an
   * intention rather than an effect.
   */
  resolveFailureGroup(
    tenantId: TenantId,
    mappingId: MappingId,
    action: FailureAction,
    match: {
      readonly domain?: DiscoveryDomain;
      readonly category?: FailureCategory;
      readonly errorContains?: string;
    },
  ): Promise<number>;
  resolveFailure(
    tenantId: TenantId,
    mappingId: MappingId,
    naturalKeyHash: string,
    action: FailureAction,
  ): Promise<boolean>;
  /**
   * Record that the source now lists an already-copied item somewhere else.
   *
   * Nothing on the target changes — this is the durable half of the report.
   * Without it a pass counted the divergence, logged it and forgot it, so an
   * operator who was not reading the container output at that moment never
   * learned, and had no way to say "dealt with, stop telling me".
   *
   * Clears any previous acknowledgement when the DESTINATION has changed:
   * agreeing to one arrangement is not agreeing to every later one. Re-running
   * it with the same destination leaves the decision standing, so an ordinary
   * pass does not reopen something a person already closed.
   *
   * `toNaturalKeyHash` is what makes a RELOCATION distinguishable from a move
   * (ADR-0030): set it when the item's own key changed — a file moved or
   * renamed, correlated by content hash — and leave it unset when the key
   * survived, which is every mail and calendar move. Only the first kind can
   * be applied, because only there is there a new copy to point at.
   *
   * `pairedBy: 'identity'` records that the relocation was paired by the
   * source's own id rather than by equal bytes — a renamed Google document
   * (workplan 0042 T10) — which changes what Apply asks of the new copy.
   */
  recordMove(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
    toCollection: string,
    toNaturalKeyHash?: string,
    pairedBy?: 'content' | 'identity',
  ): Promise<void>;
  /**
   * Write one attribution row to the audit log (workplan 0048).
   *
   * Grown for ADR-0031's auto-apply — the first thing in the product that
   * REMOVES data with nobody watching, and therefore the first that needs a
   * durable "who did this" both editions can answer. `audit_log` has existed
   * since the baseline with no writer; this is its writer, behind the port so
   * the appliance's PGlite and managed Postgres record identically.
   */
  recordAuditEvent(
    tenantId: TenantId,
    event: {
      readonly actor: string;
      readonly action: string;
      readonly entity?: string;
      readonly detail?: Record<string, unknown>;
    },
  ): Promise<void>;
  /**
   * How many audit rows match — the digest's "removed automatically since the
   * last summary" count. `since` is inclusive ISO time; `mappingId` filters on
   * the detail blob, where attribution rows record it.
   */
  countAuditEvents(
    tenantId: TenantId,
    filter: {
      readonly actor: string;
      readonly action: string;
      readonly since: string;
      readonly mappingId?: string;
    },
  ): Promise<number>;
  /**
   * When the newest matching audit row was written (undefined = never) — the
   * digest's "when did I last actually send": a window computed as
   * now-minus-cadence double-counts after a late run and under-counts after a
   * missed one; the recorded send time does neither.
   */
  latestAuditEventAt(
    tenantId: TenantId,
    filter: {
      /** Omit to match ANY actor — "was this ever pressed", whoever pressed. */
      readonly actor?: string;
      readonly action: string;
      /** Narrow to one mapping via the audit detail; omit for tenant-wide. */
      readonly mappingId?: string;
    },
  ): Promise<string | undefined>;
  /**
   * Upsert the sharing queue's rows from a fresh inventory scan (ADR-0032,
   * workplan 0052). Identity is `grantHash`; a known row only refreshes
   * `scannedAt` — an owner's decision is NEVER reset to open by looking
   * again. Returns how many rows are new.
   */
  upsertShareGrants(
    tenantId: TenantId,
    mappingId: MappingId,
    grants: ReadonlyArray<{
      readonly grantHash: string;
      readonly subject: string;
      readonly onLabel: string;
      readonly grantee?: string;
      readonly role: string;
      readonly viaLink: boolean;
      readonly raw: string;
      readonly verdict: 'clean' | 'manual';
      readonly verdictTarget: string;
      /** Where it sits, when the source can say (workplan 0123 T4). */
      readonly itemKey?: string;
      readonly parentKey?: string;
      readonly isContainer?: boolean;
    }>,
  ): Promise<number>;
  /**
   * Setup-checklist state for one side of one provider, for this tenant
   * (workplan 0061). Only rows a person has SETTLED exist; a step nobody has
   * touched has no row, and the reader treats its absence as `open`. That way
   * a new step added in code is open for everyone the moment it ships, with
   * no backfill.
   */
  listSetupSteps(
    tenantId: TenantId,
    side: 'source' | 'target',
    provider: string,
  ): Promise<ReadonlyArray<SetupStepRow>>;
  /**
   * Record what a person decided about one setup step. Upserts on the step's
   * identity, so ticking, un-ticking and skipping are the same call — and
   * setting it back to `open` clears the decider, because an open step is by
   * definition one nobody has answered.
   */
  setSetupStepState(
    tenantId: TenantId,
    side: 'source' | 'target',
    provider: string,
    stepKey: string,
    decision: { readonly state: 'open' | 'done' | 'skipped'; readonly decidedBy: string },
  ): Promise<SetupStepRow>;
  /** Every sharing-queue row for one mapping, checklist order (open first, then by label). */
  listShareGrants(tenantId: TenantId, mappingId: MappingId): Promise<ReadonlyArray<ShareGrantRow>>;
  /**
   * Settle one sharing-queue row. Only an `open` row can be settled and only
   * with a decider named — the checklist's whole point is that "done" always
   * has a who and a when. Returns the updated row, or undefined when the row
   * does not exist or was already settled (the caller words the refusal).
   */
  decideShareGrant(
    tenantId: TenantId,
    mappingId: MappingId,
    grantId: string,
    decision: {
      readonly state: 'applied' | 'done_manual' | 'skipped';
      readonly decidedBy: string;
      readonly reason?: string;
    },
  ): Promise<ShareGrantRow | undefined>;
  /**
   * Forget a recorded move, because the source lists the item where we copied
   * it from again.
   *
   * The divergence is gone, so the queue entry has to go with it — including
   * the acknowledgement, since there is no longer anything to have agreed to.
   * An entry that outlived its cause would have people acting on a layout that
   * had already been put back.
   */
  clearMove(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<void>;
  /** Recorded moves for a mapping — open ones first, then acknowledged. */
  listMoves(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: DiscoveryDomain,
  ): Promise<ItemMove[]>;
  /**
   * Apply an owner decision to one moved item.
   *
   * Returns false when there is no OPEN move under that key — it moved back, or
   * someone already decided. Saying "not found" beats reporting a decision that
   * did not happen.
   */
  resolveMove(
    tenantId: TenantId,
    mappingId: MappingId,
    naturalKeyHash: string,
    action: MoveAction,
  ): Promise<boolean>;
  /**
   * The row a source href belongs to, or undefined.
   *
   * The lookup a removal report needs. A `sync-collection` 404 gives an href and
   * nothing else — no body, so no UID, so no natural key — and this is the only
   * way back to the item it used to be.
   *
   * Never matches a row with no recorded href: `{}` is "not recorded", not "the
   * item whose href is empty", and treating them alike would attach a removal
   * report to an arbitrary pre-0025 row.
   */
  findBySourceRef(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    sourceRef: string,
  ): Promise<LedgerRecord | undefined>;
  /**
   * Close the failures a document left under names it no longer has (workplan
   * 0042 T8 (b), migration 0056).
   *
   * A Google-native document's name comes from the export policy, and the name
   * is the key, so every policy switch gives it a new one. Each pair says: this
   * pass listed the document under `naturalKeyHash`, and under another policy
   * it would have been `formerNaturalKeyHash`. The caller passes only former
   * names this pass did NOT list, because a real file can carry the same name
   * (an uploaded `Deck.pptx` beside a Slides deck called `Deck`) and a name
   * still listed is still somebody's.
   *
   * A row under a former name becomes `superseded` only when it is `failed`,
   * and when it records no source handle or the same one as the document: a
   * row that says it belongs to a different object is left alone. Anything that
   * reached the target is never touched here. Returns each superseded row with
   * the key that took over from it.
   */
  supersedeFormerNames(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    formerNames: ReadonlyArray<FormerName>,
  ): Promise<ReadonlyArray<{ readonly naturalKeyHash: string; readonly supersededBy: string }>>;
  /**
   * Mark the copies a document left ON THE TARGET under names it no longer has
   * (workplan 0042 T8 (b), second half; the owner's decision of 2026-09-23).
   *
   * `supersedeFormerNames`'s other half, over the same pairs. That one closes a
   * failure, because nothing of it reached the target. This one is for a copy
   * that did: the document's earlier export (`Report.docx` after a switch to
   * `export-odf`). Nothing is removed or closed. The row is marked as an
   * earlier export of the key that took over (`supersededByNaturalKeyHash` on
   * a row still `copied` or `updated`), which keeps it out of the deletion
   * detector, because the document was exported again, not deleted in Google,
   * and puts it in the Deletions queue as what it is, for the owner to keep or
   * remove.
   *
   * Our own copies only (`copied`, `updated`) that were never removed: an
   * `adopted` file was on the target before the migration arrived and is the
   * owner's, whatever its name. Matched by the source's handle as
   * `supersedeFormerNames` matches. A row already marked for the same key is
   * left as it is. Returns the rows newly marked, with the key each is an
   * earlier export of.
   */
  markEarlierExports(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    formerNames: ReadonlyArray<FormerName>,
  ): Promise<ReadonlyArray<{ readonly naturalKeyHash: string; readonly exportedAs: string }>>;
  /**
   * The name an earlier export had is a current name again (the policy was
   * switched back), so the copy is no longer an earlier export of anything.
   * A no-op on a row that is not one.
   */
  clearEarlierExport(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<void>;
  /**
   * Note that a complete scan did not find this item, and return how many
   * consecutive scans that now makes.
   *
   * Counting is the whole safety argument. We never observe a deletion, only an
   * absence, and absence has innocent causes that all look identical — so the
   * count is what separates "the source no longer has this" from "the source
   * had a bad afternoon".
   */
  recordAbsent(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<number>;
  /**
   * The SOURCE has told us this item is gone.
   *
   * Not a stronger version of `recordAbsent` — a different kind of statement.
   * That one counts times we failed to see something; this one records that the
   * server named the object and said 404 (RFC 6578). Stored separately so the
   * two can never be confused by anything downstream, and so `absentPasses`
   * keeps meaning exactly what it says.
   *
   * Keeps the FIRST report: that is the moment we learned, and re-stamping it
   * every pass would lose the only date an audit cares about. Idempotent, so a
   * server that keeps repeating a removal across passes costs one no-op update.
   *
   * Returns false when there is no row under that key — an object the source
   * removed that we never copied is not a deletion we have anything to say
   * about.
   */
  recordReportedDeletion(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<boolean>;
  /**
   * A copy of this item is sitting in the owner's bin on the source.
   *
   * The third kind of evidence, and the only one mail has. An item in a `\Trash`
   * collection is the source system's own record that the person deleted it —
   * positive evidence, so like a removal report it needs no corroboration, but a
   * DIFFERENT claim: the object still exists, and the owner may empty the bin or
   * restore it.
   *
   * Its own column for the same reason as `recordReportedDeletion`: a stronger
   * signal arriving later must not overwrite when an earlier one was learned.
   * Keeps the first sighting, and returns false when there is no row under that
   * key — most of what is in a bin was never migrated.
   */
  recordTrashedDeletion(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<boolean>;
  /**
   * The item is back. Reset the count, any report, and any decision about it.
   *
   * CONSECUTIVE is the property being maintained: an item that vanishes, comes
   * back and vanishes again has been missing once, twice — never twice in a
   * row. Without the reset a flaky folder would accumulate its way to
   * "confirmed deleted" over a month of unrelated hiccups.
   *
   * The REPORT and the BIN SIGHTING are cleared too. A UID can be deleted and
   * re-created — a calendar invitation declined and re-sent, a contact restored
   * from a phone — and a message can be dragged out of Deleted Items back into
   * the inbox. An item that is demonstrably present again must not keep carrying
   * a claim that the source considers it gone.
   */
  clearAbsent(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<void>;
  /** Items the source has stopped showing — confirmed ones first. */
  listDeletions(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: DiscoveryDomain,
  ): Promise<ItemDeletion[]>;
  /**
   * The copies on the target that an earlier export policy left, still ours
   * and never removed (0042 T8 (b), second half): open ones first, then kept.
   * See {@link EarlierExport} for why these are not deletions.
   */
  listEarlierExports(
    tenantId: TenantId,
    mappingId: MappingId,
    domain?: DiscoveryDomain,
  ): Promise<EarlierExport[]>;
  /**
   * Apply an owner decision to one vanished item.
   *
   * Returns false when nothing under that key is CONFIRMED and still open — it
   * came back, or someone already decided, or the absence has been seen only
   * once. Saying "not found" beats reporting a decision that did not happen.
   */
  resolveDeletion(
    tenantId: TenantId,
    mappingId: MappingId,
    naturalKeyHash: string,
    action: DeletionAction,
  ): Promise<boolean>;
  /**
   * Record that the target's copy has been REMOVED, after it actually has been.
   *
   * Called only by `applyDeletion`, only once the target has confirmed the
   * removal, and never speculatively. The ordering is deliberate: if this write
   * fails after a successful removal, the row still claims the item is on the
   * target and §20 reports it missing — loud, and correctable. Recording first
   * and failing to remove would leave the row saying an item is gone while the
   * copy sits there, which nothing would ever notice.
   *
   * Sets `status = 'tombstoned'` — see the note on that value — plus the applied
   * date, and closes the queue entry. Returns false when the row was no longer
   * eligible, so a caller cannot report a removal the ledger did not accept.
   */
  applyDeletion(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<boolean>;
  /**
   * Record that the target's OLD copy of a relocated item has been removed
   * (ADR-0030), after it actually has been.
   *
   * The sibling of `applyDeletion`, and deliberately a separate method rather
   * than a flag on it: the two enforce DIFFERENT conditions in SQL. That one
   * requires positive deletion evidence; this one requires a recorded
   * relocation — `moved_to_natural_key_hash` set — and no deletion evidence is
   * needed or expected, because nothing was deleted. Sharing one write with a
   * parameter would put both sets of conditions one `if` away from each other
   * on the path that destroys data.
   *
   * Same ordering rule, same tombstone, and it closes the MOVE queue entry
   * rather than a deletion one. Returns false when the row was no longer
   * eligible.
   */
  applyRelocation(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    naturalKeyHash: string,
  ): Promise<boolean>;
}

/** What an owner can do about an item that would not migrate (§11.2). */
export type FailureAction = 'retry' | 'accept';

/**
 * Attempts before an item stops being retried automatically and waits for a
 * person.
 *
 * Not 1: the great majority of item failures are transient (a locked SQLite
 * target, a 503, a dropped connection), and the DAV/JMAP writers already
 * retry those WITHIN a pass. Reaching this cap means the item survived that
 * and failed on several separate passes, which is the signal that it is the
 * item, not the weather.
 *
 * Not unbounded either: an item that can never be read costs a fetch attempt
 * every pass forever, and — worse — keeps looking like something that might
 * still fix itself. Parking it is what turns it into a question someone can
 * answer.
 */
export const MAX_ITEM_ATTEMPTS = 5;

/**
 * Does this ledger status mean the item IS on the target?
 *
 * A row is not proof of a successful copy, and every layer that has assumed
 * otherwise has produced a silent false success. `failed` means we tried and
 * did not; `left_behind` means the owner decided we never will. Both are rows,
 * and neither is a copy.
 *
 * `undefined` counts as migrated, for rows predating the status column. That is
 * generous, and deliberately so — being generous about `failed` is what loses
 * data — but it is NOT a licence to destroy anything: the column is
 * `NOT NULL DEFAULT 'pending'`, so a row read from Postgres always has a
 * status, and the destructive path in `apply-deletion.ts` requires `copied` or
 * `updated` explicitly rather than asking this. Read this as "do not report it
 * missing", not as "we wrote it".
 */
export function isOnTarget(status: LedgerRecord['status']): boolean {
  // `tombstoned` is the one status this product creates by destroying something:
  // the owner decided a source deletion should follow through and the copy was
  // removed. The row survives as the record of that, so it MUST NOT read as "on
  // the target" — §20 would expect bytes that were removed on purpose and report
  // them as missing, turning a completed decision into a verification failure.
  //
  // `superseded` never reached the target at all: only a row that failed under
  // a name the document no longer has is ever given it (0042 T8 (b)).
  return (
    status !== 'failed' &&
    status !== 'left_behind' &&
    status !== 'tombstoned' &&
    status !== 'superseded'
  );
}

/** One item that would not migrate, and what can be done about it. */
export interface ItemFailure {
  readonly domain: DiscoveryDomain;
  /**
   * The idempotency anchor, and the handle for `resolveFailure`.
   *
   * Opaque on purpose. The natural key itself is a Message-ID, an iCal UID or
   * a FILE PATH, and §17 treats the last of those as personal data; the hash
   * identifies the item for the two actions without putting a path into a
   * response that may be logged or forwarded.
   */
  readonly naturalKeyHash: string;
  /**
   * The name a PERSON calls this item: an event's SUMMARY, a contact's FN.
   *
   * ## Why this sits beside a field whose comment says the opposite
   *
   * The paragraph above is still true of the KEY and nothing here changes it:
   * the hash remains the handle for Retry and for Leave behind, and nothing
   * keys, matches or decides on the value below.
   *
   * What the paragraph did not anticipate is that the queue would be unusable
   * without a label. On 2026-09-13 two of the owner's contacts were refused by
   * a live Nextcloud, five attempts each. This screen is where he was meant to
   * act on them, and all it could say was a hash. Four days later, handed the
   * UIDs from the database instead: *"I can not find these contacts, or atleast
   * i do no know how."* The ledger's own `recordFailure` already carries a note
   * saying the rows that most need a name were the only ones that could never
   * get one.
   *
   * So this is the same §17 exception `ConfirmedRowView.naturalKey` is granted,
   * and for the stronger version of its argument: a list that cannot say WHICH
   * item is missing is not a list anybody can act on, and this is the list whose
   * entire purpose is being acted on.
   *
   * ## What made it safe to add, checked rather than assumed
   *
   * `listFailures` has five kinds of caller, and only ONE renders an item:
   *
   *  - the owner's own Failures screen and its appliance twin — the reader
   *    this field exists for;
   *  - the 0122 progress VIEW LINK (`apps/api/src/routes/view.ts`), which maps
   *    these rows through `buildDomainStatusReports` into per-domain counts; no
   *    row reaches its response;
   *  - both digest builders, which read `failures.filter(needsDecision).length`
   *    and nothing else, so no name reaches an email;
   *  - the Attention page, which derives counts per mapping.
   *
   * A future caller that forwards a whole row somewhere is the thing to watch,
   * which is why this comment names the four rather than saying "it is fine".
   *
   * Absent for a file (whose key IS its name), for mail (whose Subject this
   * codebase cannot decode yet), and on every row written before 2026-09-17.
   * The screen then shows what it has always shown.
   */
  readonly displayName?: string;
  readonly collection?: string;
  readonly attempts: number;
  /** Verbatim, so the operator can tell a 507 from a 403 from a parse error. */
  readonly lastError: string;
  /**
   * What KIND of failure `lastError` was, in the same nine values the domain
   * level uses — so the screen can show a remedy in the reader's language
   * beside prose that is always the provider's English (migration 0049).
   *
   * BESIDE the prose, never instead of it. An operator diagnosing a 507 needs
   * the provider's own words; a customer deciding what to do needs a sentence
   * they can act on, and until now the item level had only the first.
   *
   * ABSENT rather than `'unknown'` when the row has none: every row written
   * before migration 0049 has NULL, and `'unknown'` is a real classification
   * ("we looked and could not tell"). Reporting one as the other would put a
   * remedy under a failure nobody classified.
   */
  readonly category?: FailureCategory;
  readonly lastAttemptAt?: string;
  /**
   * False while the item is still being retried automatically; true once it is
   * waiting on a decision — either because attempts ran out or because it was
   * PARKED on sight.
   */
  readonly needsDecision: boolean;
  /**
   * Set when this item is waiting on a person rather than on more attempts.
   *
   * The distinction a bare `attempts` cannot make: an item parked on its first
   * failure was tried ONCE, and printing its count as a try total tells the
   * owner we hammered their provider five times over a setting they chose.
   * Absent on an item that simply exhausted its retries — there the count is
   * the truth and says it.
   */
  readonly parkedAt?: string;
}

/**
 * An item the SOURCE now shows in a different collection from the one we
 * copied it into.
 *
 * Named a "move" because that is what causes it in practice, but the loop
 * cannot prove it within a single pass: a user who COPIED an event into a
 * second calendar produces exactly the same observation. It therefore does
 * neither thing on the target — §11.1 makes the owner authoritative for
 * topology and lifecycle, and hard rule 2 forbids the delete half of a move
 * outright.
 *
 * `from` and `to` are folder paths, which §17 counts as personal data. They
 * belong on the operator's own status surface — the same place `lastError`
 * already goes — and must NEVER become a metric label; the count is the only
 * part of this that is safe to export to a metrics store.
 */
export interface ItemMove {
  readonly domain: DiscoveryDomain;
  /** Same anchor, and for the same §17 reason, as `ItemFailure.naturalKeyHash`. */
  readonly naturalKeyHash: string;
  /** The source collection recorded on the ledger row when we copied it. */
  readonly from: string;
  /** The source collection it is listed in now. */
  readonly to: string;
  /**
   * The natural key it is listed under now — a RELOCATION rather than a move.
   *
   * Present only when the item's own key changed: a file that was moved or
   * renamed, correlated by content hash (ADR-0030). Absent for every mail and
   * calendar move, where the key survives.
   *
   * It is what makes a rename legible at all — `from` and `to` are both `Docs`
   * when somebody renames a file inside one folder, and this is the field that
   * says what actually changed — and it is the precondition for `apply`: the
   * old copy may be removed only because the same bytes are already on the
   * target under THIS key.
   */
  readonly toNaturalKeyHash?: string;
  /**
   * When this move was RECORDED (migration 0013). Re-stamped when the
   * destination changes — a move somewhere new is a new report.
   *
   * The queue's age column: `updatedAt` cannot serve, because every pass
   * touches it and the answer always reads "just now". Absent only for a row
   * recorded before the column existed whose backfill has not run.
   */
  readonly recordedAt?: string;
  /**
   * When the owner saw this move and chose to leave the target's layout alone.
   *
   * Absent while it is still open. A pass reports only OPEN moves, so
   * acknowledging one genuinely quiets it — and a queue nobody can quiet is one
   * people stop reading, which is how a real divergence goes unnoticed among
   * ones somebody already decided about.
   */
  readonly acknowledgedAt?: string;
}

/**
 * How we came to believe an item is gone from the source.
 *
 * The distinction is the whole safety argument for ever ACTING on a deletion,
 * and the two are different in kind rather than in degree:
 *
 * - `'reported'` — the source said so. RFC 6578 `sync-collection` answers an
 *   incremental CalDAV/CardDAV poll with a `<response>` carrying the object's
 *   href and a 404 status. There is nothing to infer and nothing to corroborate;
 *   waiting for it to repeat would not make it more true, only later.
 * - `'trashed'` — the owner PUT IT IN THE BIN. The item is still on the source,
 *   sitting in a collection whose RFC 6154 role is `\Trash`, which is the source
 *   system's own way of recording "the person deleted this". Positive evidence,
 *   like `reported`: we are looking at the item, not failing to find it, so it
 *   needs no corroboration either. This is the ONLY deletion evidence mail has —
 *   IMAP offers no removal report in the shape `'reported'` needs, and a mailbox
 *   cannot be enumerated cheaply enough for `'inferred'` to be affordable.
 * - `'inferred'` — we stopped seeing it. Absence has a dozen innocent causes
 *   that all present identically, so it takes `DELETION_CONFIRMATIONS`
 *   consecutive complete scans before a person is told, and even then it is a
 *   suspicion.
 *
 * Ranked `reported` > `trashed` > `inferred` when more than one applies: "the
 * source no longer has it at all" supersedes "the owner binned it", and both
 * supersede "we did not see it". Each is recorded with its own date, so a later
 * stronger signal never overwrites when an earlier one was learned.
 *
 * Only the first two may ever gate a destructive action. Deleting a customer's
 * data because a listing was throttled is the worst thing this product could do.
 */
export type DeletionEvidence = 'reported' | 'trashed' | 'inferred';

/**
 * A copy on the target that an earlier export policy left (workplan 0042 T8
 * (b), second half; the owner's decision of 2026-09-23: *"An old copy in
 * Nextcloud is never deleted for you. Deletions lists it as 'an earlier
 * export', not as 'deleted in Google'."*).
 *
 * NOT an `ItemDeletion`, deliberately. Nothing was deleted at the source: the
 * same document is listed there under the name the current policy gives it,
 * and copied under that name. Counted as a deletion it would raise the
 * mass-deletion breaker the day an owner switches format (every Google
 * document at once), and every digest, report and checklist that says
 * "deleted on the old system" would say it of documents that are not. So it
 * has its own listing, shown on the Deletions screen as what it is, and it
 * counts in none of those.
 */
export interface EarlierExport {
  readonly domain: DiscoveryDomain;
  /** The earlier copy's key. Same anchor, same §17 reason, as `ItemFailure.naturalKeyHash`. */
  readonly naturalKeyHash: string;
  /** Where it was copied from. */
  readonly collection: string;
  /** The document's current copy: the key the current export policy gives it. */
  readonly exportedAs: string;
  /** When a pass first found it an earlier export. */
  readonly markedAt?: string;
  /** Set once the owner has said to keep it. */
  readonly acknowledgedAt?: string;
}

/**
 * An item the SOURCE no longer has, which the target still holds.
 *
 * `evidence` says how we know, and it matters more than any other field here —
 * see {@link DeletionEvidence}. For an inferred deletion `absentPasses` is the
 * honest measure of how much to believe the claim; for a reported one it is
 * usually 0 and means nothing, because the source told us outright rather than
 * us noticing.
 *
 * `collection` is a folder path, which §17 counts as personal data. It belongs
 * on the operator's own status surface — the same place `lastError` and
 * `ItemMove.from` already go — and must never become a metric label.
 */
export interface ItemDeletion {
  readonly domain: DiscoveryDomain;
  /** Same anchor, same §17 reason, as `ItemFailure.naturalKeyHash`. */
  readonly naturalKeyHash: string;
  /** Where we copied it from, which is also where it stopped appearing. */
  readonly collection: string;
  /**
   * Consecutive complete scans that failed to find it.
   *
   * 0 is normal for a REPORTED deletion: the source named the object, so nothing
   * had to go missing for us to know. Read it together with `evidence`, never
   * alone.
   */
  readonly absentPasses: number;
  /**
   * Whether this is worth putting in front of a person yet.
   *
   * A reported or trashed deletion is confirmed on sight — both are positive
   * observations. An inferred one is confirmed once `absentPasses` reaches
   * `DELETION_CONFIRMATIONS`; below that the item is watched, not reported,
   * because a queue filled with absences that may simply be a folder having a bad
   * afternoon is a queue people stop reading.
   */
  readonly confirmed: boolean;
  /** How we know. See {@link DeletionEvidence}. */
  readonly evidence: DeletionEvidence;
  /** When the source first told us, for a reported deletion. */
  readonly reportedAt?: string;
  /** When we first found a copy of it in the owner's bin. */
  readonly trashedAt?: string;
  /** When the owner decided to keep the target's copy anyway. */
  readonly acknowledgedAt?: string;
}

/**
 * Consecutive complete scans an item must be missing from before its
 * disappearance is put in front of a person.
 *
 * Two, not one, because one absent listing is not evidence: a folder briefly
 * missing from discovery, a throttled listing, a permissions blip and a source
 * connector having a bad ten minutes all present exactly the same way. Two, not
 * ten, because the cost of waiting is only latency on a report — nothing is
 * acted on either way — and an owner who deleted something last week should not
 * have to wait a fortnight to be told the target still has it.
 */
export const DELETION_CONFIRMATIONS = 2;

/** What an owner can decide about a vanished item. See `Ledger.resolveDeletion`. */
export type DeletionAction =
  /**
   * Keep the target's copy and stop reporting this one.
   *
   * Changes nothing on either side, and remains the usual answer: a target that
   * is a fuller archive than the shrinking source is a feature, not a fault.
   */
  | 'keep'
  /**
   * Follow the deletion through — remove the target's copy too.
   *
   * THE ONLY DESTRUCTIVE ACTION IN THIS PRODUCT. Hard rule 2 forbids this tool
   * deleting on a target *of its own accord*; it does not forbid an owner
   * deciding about their own data, which §11.2 explicitly reserves to them. The
   * distinction is the entire design: nothing here is ever automatic, batched,
   * or inferred.
   *
   * Every gate is enforced in `applyDeletion` rather than here, because most of
   * them need the target: see that function for the list and the reasoning. The
   * two that matter most are that only POSITIVE evidence qualifies — never an
   * absence, however often repeated — and that a copy the owner has edited in
   * the new system is refused outright.
   */
  | 'apply';

/** What an owner can decide about a move. See `Ledger.resolveMove`. */
export type MoveAction =
  /**
   * Leave the target as it is and stop reporting this arrangement.
   *
   * The only action there is for now, and it changes nothing on either side —
   * it records that a person looked. Making the target match the source means
   * removing the copy from where it currently sits, which is the delete half of
   * a move and forbidden outright by hard rule 2; that needs its own explicitly
   * destructive path, with its own confirmation, and does not exist yet.
   */
  'keep';

/**
 * Persists per-domain pre-sync discovery counts (workplan 0013 T2). One row per
 * (tenant, mapping, domain); re-discovery overwrites. Tenant-scoped by RLS.
 */
export interface DiscoveryStore {
  /** Upsert the counts for one domain (clears any prior error). */
  upsertDiscovery(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    discovery: DomainDiscovery,
  ): Promise<void>;
  /** Record that discovery failed for one domain, keeping the verbatim error (§11.2). */
  recordDiscoveryError(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    error: string,
  ): Promise<void>;
  /** Read all stored domain discovery rows for a mapping, ordered by domain. */
  getDiscovery(tenantId: TenantId, mappingId: MappingId): Promise<DiscoveryRecord[]>;
}

/** Handle to a scheduled job; calling stop() cancels future runs. */
export interface ScheduleHandle {
  stop(): void;
}

/**
 * Orchestration seam. The self-host edition implements this in-process (croner);
 * the managed edition swaps a Trigger.dev-backed impl. Implementations MUST be
 * single-flight per jobId (no overlapping runs — coalesce).
 */
export interface Scheduler {
  /** Run `task` on a cron expression; coalesce overlapping runs. */
  schedule(jobId: string, cron: string, task: () => Promise<void>): ScheduleHandle;
  /** Run `task` once, now. */
  runOnce(jobId: string, task: () => Promise<void>): Promise<void>;
}

/** Dependency bundle for one mapping's shadow pass (DI for the T4 reconcile loop). */
export interface ReconcileDeps extends PassClock, SourceAuthority {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly source: SourceConnector;
  readonly target: TargetWriter;
  readonly ledger: Ledger;
  /**
   * Optional cursor persistence: when provided, each folder pass lists only items changed since
   * the stored cursor and persists the new cursor after the folder completes. Absent -> full scan
   * (always correct via the ledger, just more work).
   */
  readonly cursors?: CursorStore;
  /** Max messages processed in parallel per folder (default 4). Bounds throughput and peak memory. */
  readonly concurrency?: number;
  /** What to do when the destination already holds the item; `'skip'` (adopt) by default. */
  readonly onCollision?: 'skip' | 'fail';
  /**
   * Create every target mailbox under this folder — see
   * `MappingConfig.targetFolderPrefix` for the choice this encodes (merge by
   * default; a subfolder per source on request). Source-side reading — folder
   * listing, cursors, the ledger's `collection` — never sees it.
   */
  readonly targetFolderPrefix?: string;
  /**
   * Mail folders to leave behind, by RFC 6154 special-use role.
   *
   * Absent means trash and junk (`DEFAULT_EXCLUDE_SPECIAL_USE`). Pass `[]` to
   * migrate everything. See `MappingConfig.excludeSpecialUse` for why the
   * default is what it is — and for the second reason to leave the trash behind:
   * an item sitting in Deleted Items is explicit evidence the owner deleted it,
   * which is far better than the absence-counting the deletions queue otherwise
   * has to rely on.
   */
  readonly excludeSpecialUse?: ReadonlyArray<SpecialUse>;
  /**
   * The mail source endpoint's daily download meter (workplan 0090 T4).
   * Absent means the endpoint has no ceiling — no gate, no pause. When
   * present, the pass reads it before fetching and STOPS at zero remaining:
   * a scheduled pause (`ReconcileResult.budgetPause`), never an error, and
   * never something to retry into.
   */
  readonly downloadMeter?: DownloadMeter;
}

/** Summary of a single shadow pass. */
export interface ReconcileResult {
  /**
   * How many collections the SOURCE listed for this pass.
   *
   * Here as well as on `DomainSyncResult` so that MAIL is not the one domain
   * whose "nothing happened" cannot be read. Covering four of five is how the
   * task domain slipped past twice.
   */
  readonly collectionsListed: number;
  readonly scanned: number;
  readonly created: number;
  /**
   * Bytes of the messages this pass copied onto the target for the first
   * time — the `created` set exactly (see `DomainSyncResult.firstCopyBytes`,
   * whose value this passes through). Optional for compatibility with
   * callers written before it existed; absent reads as 0.
   */
  readonly firstCopyBytes?: number;
  /** Not created because OUR LEDGER already had the message. */
  readonly skipped: number;
  /**
   * Not created because the TARGET mailbox already held a message with this
   * Message-ID. Counted apart from `skipped`: both mean "not created", but only
   * this one says the destination was not empty.
   *
   * REQUIRED now, as `updated` is. It was optional "for compatibility with
   * callers written before it existed", and an optional count is one a
   * summary line defaults to zero — which is how a pass came to report
   * `N created, M skipped` and nothing about what it adopted or rewrote.
   */
  readonly adopted: number;
  /**
   * Rewritten on the target because the source changed after it was copied.
   *
   * Mail is mostly immutable, so this is usually zero — but mail runs through
   * the same `runDomainSync` as every other domain and that reports one, and
   * this result was the place it was dropped. `pass-summary.ts` in core reads
   * it; a result that cannot say what it rewrote cannot say the pass carried
   * the owner's edits across.
   */
  readonly updated: number;
  /**
   * Messages the source now lists in a different folder from the one they were
   * copied into. Nothing was written and nothing was deleted — see `ItemMove`.
   *
   * For mail this is as likely to be a COPY as a move: the same Message-ID
   * genuinely lives in two folders on plenty of servers, and the pass cannot
   * distinguish the two. Which is exactly why it reports rather than acts.
   */
  readonly moved?: number;
  /** Source items absent on a later pass (potential deletions) — logged, never propagated. */
  readonly drift: number;
  /**
   * Items the owner deleted on the source, which the target still holds.
   *
   * For mail these come from the owner's BIN — an item in a `\Trash` collection is
   * the source system's own record that the person deleted it, and it is the only
   * deletion evidence this domain has. Nothing is removed from the target; see
   * `ItemDeletion` and §11.1. Absent when the pass found none.
   */
  readonly deletions?: ReadonlyArray<ItemDeletion>;
  /**
   * Special-use mail folders that were present on the source and deliberately
   * NOT migrated — trash and junk by default.
   *
   * Reported because quietly not copying someone's Deleted Items is the same
   * class of failure as quietly copying it. Absent when nothing was skipped.
   */
  readonly excludedCollections?: ReadonlyArray<'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | 'normal'>;
  /**
   * The source lists a message again after this tool REMOVED the target's copy
   * on an explicit owner decision (`applyDeletion`). NOT re-created — see the
   * long comment on the same field in `DomainSyncResult`. Absent when none.
   */
  readonly reappearedAfterRemoval?: number;
  /**
   * Set when the pass stopped at the day's download ceiling (0090 T4). A
   * scheduled pause, not an error: nothing failed, the paused folder's cursor
   * stayed put, and the next pass continues by itself. Absent on a pass that
   * never hit the ceiling — including every pass with no meter at all.
   */
  readonly budgetPause?: BudgetPause;
  /**
   * Set when the pass stopped because its own deadline arrived rather than
   * because the day's bytes ran out — see `DeadlinePause`. Carried here for
   * the same reason `budgetPause` is: the caller decides what to tell the
   * owner, and it cannot tell them which clock ran out if the result does not
   * say.
   */
  readonly deadlinePause?: DeadlinePause;
}

/**
 * Signature of the one-way, non-destructive shadow pass (implemented in @openmig/core, T4).
 * Runs a mapping to convergence; a second run yields `created === 0`.
 */
export type RunShadowPass = (deps: ReconcileDeps) => Promise<ReconcileResult>;

/** Dependency bundle for a reindex/adopt pass (DI for the T9 routine). */
export interface ReindexDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly reindexer: TargetReindexer;
  readonly ledger: Ledger;
  /**
   * Which domain's rows the adopted entries become. Defaults to 'email' —
   * the reindexer was mail-only until the doorway existed (0026 T1 item 5);
   * the reindexer passed in must of course read the SAME domain's target.
   */
  readonly domain?: DiscoveryDomain;
}

/** Summary of a reindex/adopt pass. */
export interface ReindexResult {
  readonly scanned: number;
  /** Rows newly written to the ledger (adopted from the target). */
  readonly adopted: number;
  /** Entries already present in the ledger. */
  readonly alreadyKnown: number;
}

/**
 * Signature of the reindex/adopt routine (implemented in @openmig/core, T9): rebuilds ledger state
 * from the target's existing items so a fresh install does not re-copy what is already there.
 */
export type RunReindex = (deps: ReindexDeps) => Promise<ReindexResult>;

/**
 * OAuth2 token response with expiry information.
 */
export interface OAuth2Token {
  /** Access token string. */
  readonly accessToken: string;
  /** Token type (typically "Bearer"). */
  readonly tokenType: string;
  /** Unix timestamp (seconds since epoch) when the token expires. */
  readonly expiresAt: number;
  /** Refresh token, if available (for delegated flows). */
  readonly refreshToken?: string;
  /** Space-separated list of granted scopes. */
  readonly scope?: string;
}

/**
 * Configuration for TokenProvider.
 */
export interface TokenProviderConfig {
  /** OAuth2 token endpoint URL. */
  readonly tokenEndpoint: string;
  /** OAuth2 client ID. */
  readonly clientId: string;
  /** OAuth2 client secret (for client-credentials flow). */
  readonly clientSecret?: string;
  /** Client certificate key (for certificate-based auth). */
  readonly clientCertificateKey?: string;
  /** Client certificate thumbprint (for certificate-based auth). */
  readonly clientCertificateThumbprint?: string;
  /** OAuth2 tenant ID (for Azure AD). */
  readonly tenantId?: string;
  /** Resource/scopes for the token request. */
  readonly scope: string;
  /** Refresh token (for refresh-token flow). */
  readonly refreshToken?: string;
  /** Username (for refresh-token flow). */
  readonly username?: string;
  /** Password (for refresh-token flow). */
  readonly password?: string;
}

/**
 * Token status information.
 */
export interface TokenStatus {
  /** Whether the token is currently valid. */
  readonly isValid: boolean;
  /** Time until expiry in seconds (negative if already expired). */
  readonly timeUntilExpiry: number;
  /** Token type. */
  readonly tokenType?: string;
  /** Scopes granted. */
  readonly scope?: string;
}

/**
 * Token provider interface for managing OAuth2 tokens.
 * Provides token caching, automatic refresh, and single-flight refresh for concurrent callers.
 */
export interface TokenProvider {
  /**
   * Get the current access token, refreshing if necessary.
   * Returns a token that is guaranteed to be valid (not expired) at the time of return.
   * Concurrent callers will share a single refresh request (single-flight).
   */
  getToken(): Promise<OAuth2Token>;

  /**
   * Force a token refresh, bypassing the cache.
   * Returns the newly refreshed token.
   */
  refresh(): Promise<OAuth2Token>;

  /**
   * Check if the current token is valid (not expired).
   * Does not trigger a refresh.
   */
  isTokenValid(): boolean;

  /**
   * Get detailed token status information.
   */
  getTokenStatus(): TokenStatus;
}

/**
 * Port for reading verification data from the ledger.
 * Used by the verification orchestrator to compare source vs target state.
 * All queries are Postgres-only (ADR-0016).
 */
export interface LedgerVerificationReader {
  /** Count items of a given type in the ledger for a mapping */
  countItems(tenantId: TenantId, mappingId: MappingId, domain: DiscoveryDomain): Promise<number>;
  
  /** Get total bytes for items of a given type in the ledger */
  totalSizeBytes(tenantId: TenantId, mappingId: MappingId, domain: DiscoveryDomain): Promise<number>;
  
  /** Get sample items for verification (ids + natural key hashes + content hashes) */
  getSamples(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    count: number
  ): Promise<Array<{ id: string; naturalKeyHash: string; contentHash: string }>>;
  
  /** Get all natural key hashes for a given domain (used for discrepancy detection) */
  getAllNaturalKeyHashes(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain
  ): Promise<string[]>;
}

/**
 * Migration status for a domain sync.
 */
/**
 * Every state a data type's pass can be in: ONE list, read by the ledger's
 * column, the status store and both web schemas, so a state added here is
 * added everywhere or fails to compile (the lesson `DISCOVERY_DOMAINS` taught).
 * The database's CHECK is the one copy that cannot import it; migration 0057
 * is its last widening, and a test on PGlite writes every value through it.
 */
export const DOMAIN_STATES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'skipped',
  'stopped',
] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

export interface MigrationStatus {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly domain: DiscoveryDomain;
  /**
   * `skipped` and `stopped` are both a data type the mapping does not run
   * (workplan 0125 T7). `skipped` has nothing on the target. `stopped` has
   * `itemsSynced` copies there that no longer follow the source, and
   * switching it back on continues where it stopped.
   */
  readonly state: DomainState;
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly bytesTransferred: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly lastError?: string;
  /**
   * What KIND of failure `lastError` was — one of six (workplan 0110 T3).
   * Beside the prose, never instead of it. Absent when nothing has failed;
   * `'unknown'` when something failed and could not be classified, which is a
   * different thing a screen must not conflate.
   *
   * Safe where `lastError` is not: it carries no address, no folder name and
   * no subject.
   */
  readonly lastErrorCategory?: FailureCategory;
  /**
   * Which SIDE the last failure happened on — source or target — recorded by
   * the pass at the closure that threw (0094 T5, second slice). Absent when
   * the pass could not tell, or nothing has failed; a screen must then say
   * "one of the two" rather than guess.
   */
  readonly failedSide?: FailureSide;
  /**
   * The reference the last failure was recorded under (ledger 0061, workplan
   * 0129 T1): eight hex characters, the same on the operator's log page and
   * on the log line with the error's text. What a person quotes. Absent when
   * nothing has failed, or the failure predates references.
   */
  readonly lastErrorReference?: string;
  /** Where the last completed pass spent its wall time. Absent until one has. */
  readonly lastPassMetrics?: PassMetrics;
  /**
   * Why this domain stopped on purpose, when it did (migration 0041). A
   * SCHEDULED pause, never a failure — the state stays `in_progress`, which is
   * literally true across passes, and this says what is holding it up. Absent
   * when nothing is.
   */
  readonly pausedReason?: PauseReason;
}

/**
 * What a data type the mapping does not run was recorded as (workplan 0125
 * T7): `stopped`, with the copies it has on the target, or `skipped` when it
 * has none. `copies` is the number `itemsSynced` reports for it.
 */
export type SwitchedOffState =
  | { readonly state: 'stopped'; readonly copies: number }
  | { readonly state: 'skipped' };

/**
 * Port for tracking per-domain migration status.
 * State is maintained (pending/in_progress/completed/failed/skipped/stopped),
 * while item counts are DERIVED from the item ledger records.
 */
/**
 * Where one domain pass spent its wall time.
 *
 * Counts and durations only — NEVER folder names or addresses. §17 treats job
 * metadata as personal data, and this is persisted for dashboards and exported
 * as metrics, both of which have different retention than the ledger.
 */
export interface PassMetrics {
  readonly items: number;
  readonly wallMs: number;
  readonly sourceFetchMs: number;
  readonly targetWriteMs: number;
  readonly ledgerMs: number;
  readonly hashMs: number;
  /**
   * Sum of phase time over wall time — how much work was actually in flight.
   * Approaches the configured concurrency when healthy; 1 means the pass ran
   * serially, which is a configuration problem rather than a slow server.
   */
  readonly overlap: number;
}

export interface MigrationStatusStore {
  /**
   * Initialize domain status as 'pending' (idempotent).
   * Creates a new row if it doesn't exist, otherwise no-op.
   */
  initDomainStatus(tenantId: TenantId, mappingId: MappingId, domain: DiscoveryDomain): Promise<void>;

  /**
   * Mark a domain sync as in progress.
   */
  markInProgress(tenantId: TenantId, mappingId: MappingId, domain: DiscoveryDomain): Promise<void>;

  /**
   * Mark a domain sync as completed successfully.
   */
  markCompleted(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    /** Where this pass's time went, for §19's throughput dashboard. */
    metrics?: PassMetrics,
  ): Promise<void>;

  /**
   * Mark a domain sync as PAUSED — stopped on purpose, with the reason.
   *
   * Deliberately not `markCompleted`: that call "positively asserts the domain
   * finished" (its own comment, which is why it clears the last error), and a
   * domain that stopped at the day's download ceiling has finished nothing.
   * The state stays `in_progress` — true across passes — and the reason says
   * what a reader is waiting for.
   */
  markPaused(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    reason: PauseReason,
  ): Promise<void>;

  /**
   * Mark a domain sync as failed with an error.
   */
  markFailed(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
    error: string,
    /** Which side the error came from, when the pass could tell (0094 T5). */
    side?: FailureSide,
    /** The reference the failure was recorded under (0129 T1), kept to be shown. */
    reference?: string,
  ): Promise<void>;

  /**
   * Record a data type the mapping does not run (workplan 0125 T7).
   *
   * `stopped` when it has copies on the target, `skipped` when it has none,
   * decided in the same statement that writes it, from the items
   * `itemsSynced` counts. Before this, every switched-off data type was
   * `skipped`, the word for one the migration never had, and its copies
   * stopped following the source without a word.
   */
  markSwitchedOff(
    tenantId: TenantId,
    mappingId: MappingId,
    domain: DiscoveryDomain,
  ): Promise<SwitchedOffState>;

  /**
   * A data type switched back on is no longer `stopped`: it is `pending` until
   * its next pass starts. Only a `stopped` row changes; any other state is
   * left as the last pass wrote it.
   */
  markSwitchedOn(tenantId: TenantId, mappingId: MappingId, domain: DiscoveryDomain): Promise<void>;

  /**
   * Get the migration status for a mapping, including DERIVED counts from item records.
   * Returns status for all domains (email, calendar, contact, file).
   */
  getStatus(tenantId: TenantId, mappingId: MappingId): Promise<MigrationStatus[]>;
}
