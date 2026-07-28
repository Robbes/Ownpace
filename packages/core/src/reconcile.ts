// Copyright 2026 OpenHands Agent (Apache-2.0)
import {
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
} from '@openmig/shared';
import { runDomainSync, type DomainSyncDeps as _DomainSyncDeps } from './domain-sync';

const DEFAULT_CONCURRENCY = 4;

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
  const { tenantId, mappingId, source, target, ledger, cursors } = deps;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;

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
    listFolders: () => source.listFolders(),
    listSince: (folder, cursor) => source.listSince(folder, cursor),
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
    ensureCollection: (folder) => target.ensureMailbox(folder),
  });

  // Return compatible ReconcileResult (map failed to 0 for backward compatibility)
  return {
    scanned: result.scanned,
    created: result.created,
    skipped: result.skipped,
    adopted: result.adopted,
    drift: result.drift,
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
}
