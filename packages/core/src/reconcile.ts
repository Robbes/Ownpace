// Copyright 2026 OpenHands Agent (Apache-2.0)
import { applyTargetFolderPrefix,
  contentHash,
  ensureMessageId,
  naturalKeyHash,
  mapWithConcurrency as _mapWithConcurrency,
  naturalKeyForItem,
  type RunShadowPass,
  type SourceConnector,
  type TargetWriter,
  type Ledger,
  type CursorStore,
  type TenantId,
  type MappingId,
  type ReconcileResult as _ReconcileResult,
  type MailItem,
  type MailFolder,
  type RawMessage,
  type SpecialUse,
  DEFAULT_EXCLUDE_SPECIAL_USE,
  DEFAULT_CONCURRENCY,
  discardedScanCursorKey,
} from '@openmig/shared';
import { runDomainSync, type DomainSyncDeps as _DomainSyncDeps } from './domain-sync';

/**
 * One-way, non-destructive shadow pass for a single mapping — workplan 0001, T4.
 *
 * Idempotent (run twice -> the second pass creates 0) and non-destructive (never deletes or
 * overwrites on the target; source deletions are not propagated). Idempotency is anchored on the
 * natural key via the ledger fast-path, and `TargetWriter.upsertEmail` is itself create-if-absent
 * (ADR-0020), so even a wiped ledger cannot produce duplicates.
 *
 * Throughput/memory: folders run sequentially; within a folder, items are processed with BOUNDED
 * CONCURRENCY (`deps.concurrency`, default 4). Items in a folder have distinct Message-IDs, so
 * parallelism is race-free, and the cap bounds peak memory to ~`concurrency` bodies in flight.
 *
 * Incremental cursors: when `deps.cursors` is provided, each folder lists only items changed since
 * the stored cursor and the new cursor is persisted ONLY AFTER the folder completes successfully
 * (a failed folder keeps its old cursor and is re-scanned next pass). Cursors are non-authoritative
 * (ADR-0020): absent/lost/malformed just means a full, still-idempotent re-scan.
 */
export const runShadowPass: RunShadowPass = async (deps) => {
  const { tenantId, mappingId, source, target, ledger, cursors, onCollision } = deps;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const excluded = deps.excludeSpecialUse ?? DEFAULT_EXCLUDE_SPECIAL_USE;
  /** Which special-use roles were actually present and skipped, for the report. */
  const excludedCollections: SpecialUse[] = [];
  /**
   * The owner's BIN folders, captured while filtering them out of the copy.
   *
   * Populated by `listFolders` below, and read by `listDiscardedKeys` after it —
   * which is safe because the loop always lists folders first. Empty when the
   * mailbox has no trash folder, or when the owner brought trash INTO scope: an
   * item being migrated as content cannot also be read as a deletion.
   */
  let bins: ReadonlyArray<MailFolder> = [];

  // Delegate to generalized runDomainSync with mail-specific injections
  const result = await runDomainSync<SourceConnector, TargetWriter, MailItem, MailFolder>({
    tenantId,
    mappingId,
    domain: 'email',
    source,
    target,
    ledger,
    cursors,
    concurrency,
    // FOLDERS THE OWNER ASKED US TO LEAVE BEHIND never reach the loop.
    //
    // Filtered here rather than inside the loop because a skipped folder is not
    // a skipped ITEM: nothing about it should touch the ledger, the cursor
    // store, or any of the pass counters. It is out of scope, and out of scope
    // should look like it was never listed.
    //
    // Reported, not silent — see `excludedCollections` below. Quietly not
    // copying someone's Deleted Items is the same failure as quietly copying it.
    listFolders: async () => {
      const all = await source.listFolders();
      const keep = all.filter((f) => !excluded.includes(f.specialUse));
      for (const f of all) {
        if (excluded.includes(f.specialUse)) excludedCollections.push(f.specialUse);
      }
      // TRASH ONLY, not every excluded role. A message in Junk was very likely
      // put there by a spam filter rather than by a person, and the entire value
      // of this signal is that it is unambiguous owner intent; reading Junk as
      // "deleted" would report the owner's own mail as thrown away on the
      // strength of somebody else's classifier. Junk stays out of scope as
      // content and says nothing about lifecycle.
      bins = all.filter((f) => f.specialUse === 'trash' && excluded.includes(f.specialUse));
      return keep;
    },
    listSince: (folder, cursor) => source.listSince(folder, cursor),
    // Recorded at copy time so a later removal report can be matched back —
    // mail was the ONE domain that never recorded it, which is why 0023's
    // reported-removals follow-up (Graph delta `@removed`, now returned by
    // `listSince` above) had nothing to land on. Graph's `id` / IMAP's
    // folder:uid; `findBySourceRef` is the way back.
    sourceRef: (item) => (item as MailItem).sourceRef,
    // WHAT THE OWNER THREW AWAY — the mail domain's only deletion signal.
    //
    // IMAP has no removal report of the kind CalDAV's `sync-collection` gives,
    // and a mailbox cannot be enumerated cheaply enough to run absence-counting
    // every pass. So until this existed, a message the owner deleted in the old
    // system produced NOTHING: the target kept its copy in silence.
    //
    // The bin is read with its OWN cursor namespace, and that is load-bearing.
    // Sharing the folder's content cursor would mean that an owner who later
    // brought trash into scope (`excludeSpecialUse: []`) found the cursor already
    // advanced past every message in it — so those messages would never be
    // copied, and the ledger would have no row to show it. Cursors are
    // non-authoritative (ADR-0020), so the worst this namespace can cost is a
    // full re-list, which is idempotent; sharing one could cost real data.
    // Always supplied, and it answers `[]` when there is no bin to read: a
    // mailbox with no trash folder, or an owner who brought trash into scope, so
    // that its contents are being migrated rather than interpreted.
    listDiscardedKeys: async () => {
      const keys: string[] = [];
      for (const bin of bins) {
        const scanKey = discardedScanCursorKey(bin.path);
        const prev = cursors ? await cursors.get(tenantId, mappingId, scanKey) : undefined;
        const { items, nextCursor } = await source.listSince(bin, prev);
        for (const item of items) {
          // A message with no Message-ID cannot be matched to anything we copied,
          // so there is nothing to report. Nothing is lost by skipping it: those
          // items are counted as `unkeyable` wherever they are listed in scope.
          if (item.messageId) keys.push(naturalKeyForItem(item));
        }
        // Advanced only after the whole bin was listed, for the same reason the
        // content cursors are: recording progress through a partial listing would
        // retire messages nobody had looked at.
        if (cursors) await cursors.set(tenantId, mappingId, scanKey, nextCursor);
      }
      return keys;
    },
    fetchRaw: async (item) => {
      const raw = await source.fetch(item);
      // Mail with no Message-ID cannot be keyed, and used to be dropped by the
      // source entirely: never copied, and invisible to both halves of the
      // verification gate. Give it one, derived from its own bytes so it is
      // stable across passes, and WRITE it into the message so the target
      // reindexer reads back exactly the key the ledger stored.
      //
      // Doing it here rather than in the writer is deliberate: the returned
      // `raw` is what gets upserted AND what `contentHash` below hashes, so the
      // ledger's content hash describes the bytes actually on the target. Hash
      // the original instead and §20 checksum sampling flags every one of these
      // as corrupt.
      const ensured = ensureMessageId(raw.rfc822);
      // Size of the bytes we actually fetched and are about to write — NOT
      // `item.size` from the listing.
      //
      // `item.size` is optional on MailItem and depends on the source having
      // asked for RFC822.SIZE; when it is absent this fell back to 0, and since
      // it did so for every message the ledger's whole mail total came out 0.
      // §20 then compared a source total of 0 against a measured target total,
      // which is not a comparison at all — observed live as
      // `mail bytes: source=0 target=7695`.
      //
      // The fetched bytes are always available here, are what `contentHash`
      // below hashes, and are what the target receives — so this is both more
      // robust and more truthful than the listing's advertised size.
      if (!ensured.generated) {
        return { raw, sizeBytes: raw.rfc822.byteLength };
      }
      return {
        raw: { ...raw, rfc822: ensured.rfc822 } satisfies RawMessage,
        sizeBytes: ensured.rfc822.byteLength,
      };
    },
    upsert: async (mailboxId, raw, item) => 
      target.upsertEmail(mailboxId, raw as RawMessage, (item as MailItem).keywords),
    // Undefined for a message the source could not key: its natural key is a
    // hash of its own bytes, which are not available until the fetch.
    naturalKey: (item) => ((item as MailItem).messageId ? naturalKeyForItem(item) : undefined),
    naturalKeyFromRaw: (_item, raw) =>
      naturalKeyHash(ensureMessageId((raw as RawMessage).rfc822).messageId),
    contentHash: (raw) => contentHash((raw as RawMessage).rfc822),
    ensureCollection: (folder) =>
      target.ensureMailbox(
        // The one composition (`applyTargetFolderPrefix`), shared with the
        // destructive path: the mailbox created here is the mailbox a removal
        // must later open, and two spellings of it is how an IMAP UID gets
        // looked up in the wrong one.
        deps.targetFolderPrefix
          ? { ...folder, path: applyTargetFolderPrefix(deps.targetFolderPrefix, folder.path) }
          : folder,
      ),
    ...(onCollision ? { onCollision } : {}),
  });

  // Return compatible ReconcileResult (map failed to 0 for backward compatibility)
  return {
    scanned: result.scanned,
    created: result.created,
    skipped: result.skipped,
    adopted: result.adopted,
    moved: result.moved,
    drift: result.drift,
    // Passed through rather than dropped. The ledger is where these persist and
    // `/deletions` reads them from there — but a caller that logs a pass summary
    // should not have to query the database to learn that the owner deleted 40
    // messages, and every count this result omitted has eventually turned out to
    // be a fact somebody needed.
    ...(result.deletions.length > 0 ? { deletions: result.deletions } : {}),
    ...(excludedCollections.length > 0 ? { excludedCollections } : {}),
    ...(result.reappearedAfterRemoval > 0
      ? { reappearedAfterRemoval: result.reappearedAfterRemoval }
      : {}),
  };
};

/**
 * Dependency bundle for a shadow pass (DI for the T4 reconcile loop).
 * This is the original type for backward compatibility.
 */
export interface ReconcileDeps {
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
  /** What to do when the destination already holds the message; `'skip'` (adopt) by default. */
  readonly onCollision?: 'skip' | 'fail';
  /**
   * Create every target mailbox under this folder (`MappingConfig.
   * targetFolderPrefix`). Absent = merge, which is the default and the point:
   * see the config field for the choice this encodes. Source-side reading —
   * folder listing, cursors, the ledger's `collection` — never sees it.
   */
  readonly targetFolderPrefix?: string;
  /**
   * Mail folders to leave behind, by RFC 6154 special-use role.
   *
   * Absent means `DEFAULT_EXCLUDE_SPECIAL_USE` — trash and junk. Pass `[]` to
   * migrate everything. See `MappingConfig.excludeSpecialUse`.
   */
  readonly excludeSpecialUse?: ReadonlyArray<SpecialUse>;
}
