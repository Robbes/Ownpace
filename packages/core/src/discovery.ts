// Copyright 2026 The Ownpace authors (Apache-2.0)

import type { DomainDiscovery, DiscoveryCollection, SyncCursor } from '@openmig/shared';
import { refuseOnceClosed, type OrganisationIsOpen } from './while-the-organisation-is-open.ts';

/**
 * Pre-sync discovery (workplan 0013 T1).
 *
 * Counts what a source holds for one domain — **read-only and body-free** — by reusing the same
 * `listFolders()` + metadata-only `listSince()` methods every source connector already implements
 * (mail / calendar / contact / file). It never calls `fetch()`, so no message/file bodies are
 * pulled. Implemented generically (structural over the four source shapes) rather than as a
 * per-connector method, so it works for every source — current and future — with zero connector
 * churn and reuses the already-tested listing paths. Connectors that can count more cheaply (IMAP
 * `STATUS`, Graph `totalItemCount`) may specialise later; this is the correct, uniform baseline.
 */

/** The read-only listing surface shared by all source connectors, over folder `F` and item `I`. */
export interface ListingSource<F, I> {
  listFolders(): Promise<ReadonlyArray<F>>;
  listSince(
    folder: F,
    cursor?: SyncCursor,
  ): Promise<{
    items: ReadonlyArray<I>;
    nextCursor: SyncCursor;
    /** Items with no natural key of their own; the sync generates one. */
    unkeyable?: number;
    /** Items the source could not list at all, for want of a key: NOT migrated. */
    unlisted?: number;
  }>;
}

/** Optional hooks to label collections and read per-item byte sizes. */
export interface DiscoverOptions<F, I> {
  /** Label for a collection; defaults to the folder's `name` then `path`. */
  readonly folderName?: (folder: F) => string;
  /** Cheap per-item byte size, when the listing carries it (mail/files). Return undefined to skip. */
  readonly itemBytes?: (item: I) => number | undefined;
  /**
   * Called with each source item's natural-key hash, when the caller wants to
   * know which of them the destination already holds.
   *
   * A callback rather than a returned set, so the memory cost of retaining one
   * hash per source item is the CALLER's decision — only worth paying when
   * there is a target reindexer to compare against. Return undefined for an
   * item with no key of its own (mail with no Message-ID); the sync mints one
   * from content that discovery deliberately never reads, so it cannot be
   * matched against the destination here.
   */
  readonly onNaturalKey?: (item: I) => string | undefined;
  /**
   * Why this collection will not be migrated, or undefined if it will be.
   *
   * Discovery still LISTS an excluded collection and counts it — into
   * `excludedItems` rather than `items`. The owner is being asked to approve
   * leaving it behind, and they cannot approve a number nobody produced.
   */
  readonly isExcluded?: (folder: F) => string | undefined;
  /**
   * Is the organisation still open? (workplan 0139 T7) Asked before each
   * collection is listed. The source was built before the count began, so a
   * close while it runs is not seen by the builders that refuse one. Once the
   * answer is no, the count throws the close's own refusal: the listing in
   * flight finishes, no other collection is listed, and no partial count is
   * returned to stand for the whole. Absent means nobody asks.
   *
   * NOT asked during `listFolders`, which comes first. For a mailbox that is
   * one listing of its folders; a file source walks its whole folder tree
   * there, a request per folder (Google Drive, Box, Dropbox), and a close
   * during that walk lets it run to its end before the first question stops
   * the count (the review of 2026-09-29). Asking inside the walk is each
   * connector's own change, and is not made.
   */
  readonly organisationIsOpen?: OrganisationIsOpen;
}

/** What the destination already holds, and how much of it we will adopt. */
export interface TargetDiscovery {
  /** Items already on the destination for this domain. */
  readonly targetExisting: number;
  /** Of those, how many share a natural key with a source item. */
  readonly targetColliding: number;
}

/** The enumeration surface a target must offer to be counted (a `TargetReindexer`). */
export interface CountableTarget {
  listEntries(mailboxId?: string): AsyncIterable<{ naturalKey: string }>;
}

/**
 * Count what the destination already holds, and how much of it collides with
 * the source.
 *
 * Read-only, and metadata-only: it walks the same `listEntries` the §20 gate
 * uses and never fetches an item body.
 *
 * A collision means the sync will ADOPT that item — record it as migrated and
 * leave the destination's copy exactly as it is. That is non-destructive by
 * design (hard rule 2), but it decides what the customer ends up with, so it
 * has to be on the confirm screen rather than discovered afterwards in a
 * verification report.
 *
 * @param hashTargetKey turns a target entry's natural key into the same hash
 *   space the source keys were collected in. The two sides key differently
 *   (a target yields a raw Message-ID or UID; the ledger stores a domain-prefixed
 *   hash), and comparing them unhashed is the ADR-0020 failure that made every
 *   item look missing in #139.
 */
export async function discoverTarget(
  target: CountableTarget,
  sourceKeyHashes: ReadonlySet<string>,
  hashTargetKey: (naturalKey: string) => string,
): Promise<TargetDiscovery> {
  let targetExisting = 0;
  let targetColliding = 0;

  for await (const entry of target.listEntries()) {
    targetExisting += 1;
    if (sourceKeyHashes.has(hashTargetKey(entry.naturalKey))) targetColliding += 1;
  }

  return { targetExisting, targetColliding };
}

/** Best-effort default label from a folder's `name`/`path` fields. */
function defaultFolderName<F>(folder: F): string {
  const f = folder as { name?: string; path?: string };
  return f.name ?? f.path ?? '';
}

/**
 * Produce a {@link DomainDiscovery} for one source by listing every collection's items (metadata
 * only) and tallying counts (and bytes where `itemBytes` yields a number).
 */
export async function discoverSource<F, I>(
  source: ListingSource<F, I>,
  options: DiscoverOptions<F, I> = {},
): Promise<DomainDiscovery> {
  const folders = await source.listFolders();
  const nameOf = options.folderName ?? defaultFolderName;

  let items = 0;
  let bytes = 0;
  let anyBytes = false;
  let generatedId = 0;
  let unlistedItems = 0;
  let excludedItems = 0;
  const perCollection: DiscoveryCollection[] = [];

  for (const folder of folders) {
    // Counted, then set aside. An excluded collection is still LISTED — the
    // owner is being asked to approve leaving it behind, and they cannot approve
    // a number nobody produced.
    const excluded = options.isExcluded?.(folder);
    // Each collection is one read of the account: asked about before it.
    await refuseOnceClosed(options.organisationIsOpen);
    // Metadata-only: listSince returns item descriptors; bodies come from fetch(), never called here.
    const { items: folderItems, unkeyable, unlisted } = await source.listSince(folder);
    const folderGeneratedId = unkeyable ?? 0;
    // Left behind, not given an id: the source could not list them at all
    // (Graph mail with no `internetMessageId`). Counted apart from `items` and
    // from `generatedIdItems`, which both mean "will be on the target".
    const folderUnlisted = unlisted ?? 0;

    let folderBytes = 0;
    let folderHasBytes = false;
    if (options.itemBytes || options.onNaturalKey) {
      for (const item of folderItems) {
        if (options.itemBytes) {
          const b = options.itemBytes(item);
          if (typeof b === 'number' && Number.isFinite(b)) {
            folderBytes += b;
            folderHasBytes = true;
          }
        }
        options.onNaturalKey?.(item);
      }
    }

    if (excluded !== undefined) {
      excludedItems += folderItems.length;
      perCollection.push({
        name: nameOf(folder),
        items: folderItems.length,
        ...(folderHasBytes ? { bytes: folderBytes } : {}),
        excluded,
      });
      continue;
    }

    items += folderItems.length;
    generatedId += folderGeneratedId;
    unlistedItems += folderUnlisted;
    if (folderHasBytes) {
      bytes += folderBytes;
      anyBytes = true;
    }
    perCollection.push({
      name: nameOf(folder),
      items: folderItems.length,
      ...(folderHasBytes ? { bytes: folderBytes } : {}),
      ...(folderGeneratedId > 0 ? { generatedIdItems: folderGeneratedId } : {}),
      ...(folderUnlisted > 0 ? { unlistedItems: folderUnlisted } : {}),
    });
  }

  return {
    collections: folders.length,
    // Everything we will move, INCLUDING the items that need a generated
    // Message-ID — those are copied, not left behind, so excluding them would
    // understate the migration.
    items,
    ...(anyBytes ? { bytes } : {}),
    ...(generatedId > 0 ? { generatedIdItems: generatedId } : {}),
    ...(unlistedItems > 0 ? { unlistedItems } : {}),
    ...(excludedItems > 0 ? { excludedItems } : {}),
    perCollection,
  };
}
