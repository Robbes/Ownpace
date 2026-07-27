// Copyright 2026 OpenHands Agent (Apache-2.0)
/**
 * Generalized domain sync loop - mirrors the proven reconcile.ts pattern.
 * 
 * This is NOT a generic item type abstraction. Each wrapper operates on REAL
 * domain-typed sources/targets (CalendarSource/CalendarTargetWriter, etc.).
 * The abstraction is at the function level, parameterizing the loop with
 * domain-specific injected functions.
 */

import {
  mapWithConcurrency,
  type Ledger,
  type CursorStore,
  type UpsertResult,
  type TenantId,
  type MappingId,
} from '@openmig/shared';

const DEFAULT_CONCURRENCY = 4;

/** Minimal folder interface - all domain folders have at least a path. */
export interface FolderLike {
  readonly path?: string;
  readonly name?: string;
}

/**
 * Dependency bundle for a domain sync operation.
 * Domain-specific functions are injected to keep the loop generic.
 */
export interface DomainSyncDeps<Source, Target, Item, Folder extends FolderLike = FolderLike> {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly domain: 'email' | 'calendar' | 'contact' | 'file';
  readonly source: Source;
  readonly target: Target;
  readonly ledger: Ledger;
  readonly cursors?: CursorStore;
  readonly concurrency?: number;
  /** List folders on the source */
  readonly listFolders: () => Promise<ReadonlyArray<Folder>>;
  /** List items in a folder since a cursor */
  readonly listSince: (folder: Folder, cursor?: { readonly value: string }) => Promise<{ items: ReadonlyArray<Item>; nextCursor: { readonly value: string } }>;
  /** Fetch raw data for an item */
  readonly fetchRaw: (item: Item) => Promise<{ raw: unknown; sizeBytes: number }>;
  /** Upsert item on target */
  readonly upsert: (targetId: string, raw: unknown, ...args: unknown[]) => Promise<UpsertResult>;
  /** Extract natural key from item */
  /**
   * The item's natural-key hash, or undefined when it cannot be known from the
   * listing alone — mail with no Message-ID, whose key has to be derived from
   * the body. Those items fall through to `naturalKeyFromRaw` after the fetch.
   */
  readonly naturalKey: (item: Item) => string | undefined;
  /**
   * Derive the natural-key hash once the raw item is in hand. Required if
   * `naturalKey` can return undefined.
   *
   * Costs those items the pre-fetch ledger fast-path — their key IS their
   * content, so it cannot be known before reading them — but NOT idempotency:
   * the ledger is checked again with the derived key before anything is
   * written, so a re-run re-reads the message and still creates nothing.
   */
  readonly naturalKeyFromRaw?: (item: Item, raw: unknown) => string;
  /** Compute content hash from raw data */
  readonly contentHash: (raw: unknown) => string;
  /** Ensure target collection exists */
  readonly ensureCollection: (folder: Folder) => Promise<string>;
}

/** Summary of a domain sync pass. */
export interface DomainSyncResult {
  readonly scanned: number;
  readonly created: number;
  readonly skipped: number;
  readonly failed: number;
  /** Source items absent on a later pass (potential deletions). */
  readonly drift: number;
}

/**
 * Generalized domain sync loop - mirrors the proven reconcile.ts pattern.
 * 
 * Idempotent (run twice -> second pass creates 0) and non-destructive (never deletes
 * or overwrites on the target). Anchored on natural key via ledger fast-path.
 * 
 * Throughput/memory: folders run sequentially; within a folder, items processed with
 * BOUNDED CONCURRENCY. Cursor persisted ONLY AFTER folder fully succeeds.
 */
export async function runDomainSync<Source, Target, Item, Folder extends FolderLike>(
  deps: DomainSyncDeps<Source, Target, Item, Folder>
): Promise<DomainSyncResult> {
  const {
    tenantId,
    mappingId,
    domain,
    ledger,
    cursors,
    concurrency = DEFAULT_CONCURRENCY,
    listFolders,
    listSince,
    fetchRaw,
    upsert,
    naturalKey,
    naturalKeyFromRaw,
    contentHash,
    ensureCollection,
  } = deps;

  let scanned = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;

  const folders = await listFolders();
  
  for (const folder of folders) {
    const collectionId = await ensureCollection(folder);
    const prev = cursors ? await cursors.get(tenantId, mappingId, folder.path ?? folder.name ?? '') : undefined;
    const { items, nextCursor } = await listSince(folder, prev);

    await mapWithConcurrency(items, concurrency, async (item) => {
      scanned += 1;
      let naturalKeyHash = naturalKey(item);

      // Ledger fast-path: already migrated -> skip without fetching.
      if (naturalKeyHash !== undefined) {
        const known = await ledger.find(tenantId, mappingId, domain, naturalKeyHash);
        if (known) {
          skipped += 1;
          return;
        }
      }

      // Fetch raw data
      const { raw, sizeBytes } = await fetchRaw(item);

      if (naturalKeyHash === undefined) {
        // The key could not be known from the listing, so derive it now. Mail
        // with no Message-ID is keyed by a hash of its own bytes; that is only
        // available once the message has been read.
        if (!naturalKeyFromRaw) {
          throw new Error(
            `naturalKey returned undefined for a ${domain} item but no naturalKeyFromRaw was ` +
              `supplied; refusing to write an item with no idempotency anchor.`,
          );
        }
        naturalKeyHash = naturalKeyFromRaw(item, raw);

        // Second fast-path check, now that we have a key. This is what keeps
        // these items idempotent: a re-run pays the fetch again (unavoidable —
        // the key is the content) but must not create a duplicate.
        const knownAfterFetch = await ledger.find(tenantId, mappingId, domain, naturalKeyHash);
        if (knownAfterFetch) {
          skipped += 1;
          return;
        }
      }

      // Hashed AFTER any key derivation, so for a message we rewrote this is
      // the hash of the bytes we will actually write. The target stores what we
      // wrote, and §20 checksum sampling compares against it.
      const ch = contentHash(raw);

      try {
        // Upsert on target (pass item for domain-specific metadata like keywords)
        const result = await upsert(collectionId, raw, item);

        // Record in ledger with honest status
        await ledger.recordIfAbsent({
          tenantId,
          itemType: domain,
          mappingId,
          naturalKeyHash,
          contentHash: ch,
          targetId: result.targetId,
          createdAt: new Date().toISOString(),
          sizeBytes,
          status: result.created ? 'copied' : 'updated',
        });

        if (result.created) created += 1;
        else skipped += 1;
      } catch (err) {
        // Record failure - DO NOT swallow
        failed += 1;
        const error = err as Error;
        
        // Record failed item in ledger
        await ledger.recordIfAbsent({
          tenantId,
          itemType: domain,
          mappingId,
          naturalKeyHash,
          contentHash: ch,
          targetId: '',
          createdAt: new Date().toISOString(),
          sizeBytes: 0,
          status: 'failed',
        });

        // Re-throw to surface the error
        throw error;
      }
    });

    // Persist cursor only after folder fully succeeded
    if (cursors) {
      await cursors.set(
        tenantId,
        mappingId,
        (folder as { path?: string; name?: string }).path ?? (folder as { name?: string }).name ?? '',
        nextCursor
      );
    }
  }

  return { scanned, created, skipped, failed, drift: 0 };
}
