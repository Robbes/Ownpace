// Copyright 2026 The Ownpace authors (Apache-2.0)

import { createHash } from 'node:crypto';
import type { FileFolder, FileItem, FileSource, RawFileItem, SyncCursor } from '@openmig/shared';
import type {
  ArchiveHandle,
  ArchiveItem,
  ArchiveLocation,
  ArchiveProvider,
  ArchiveReader,
} from '@openmig/core/archive-reader';

/**
 * AN EXPORT ARCHIVE AS A FILE SOURCE (workplan 0116 T5 + T6).
 *
 * This is the whole of "migrating FROM an archive": the reader seam (T2)
 * answers what is inside, and this class makes those answers look like any
 * other file source, so the file domain's sync loop, its ledger and its
 * targets do the copying exactly as they do for a Drive or a Dropbox. Nothing
 * here knows which export it is reading. A third export is a new reader and
 * nothing else — the promise 0116 §2 makes is kept by this file having no
 * `switch` on `provider`.
 *
 * ## Placement (T5; 0112 §3)
 *
 * Every folder in `ArchiveItem.placeIn` becomes a folder under the import
 * root, and the item is written under EACH of them — 0112's decision 5: copy
 * per album, bytes being cheap next to a target-specific link. The reader has
 * already decided which folders are the person's own and which are the
 * provider's filing (Takeout's `Photos from 2019`), so nothing here has to.
 * An item placed nowhere lands at the root.
 *
 * The item's path on the target is `<folder>/<name>`, and that path is the
 * natural key the file domain keys its ledger by. The same bytes under two
 * albums are two rows with one content hash, which is what a person browsing
 * two albums expects to find.
 *
 * ## The manifest (T5; 0112 §3's "beside the tree")
 *
 * One JSON file at the root of the import, named by a fingerprint of the
 * archive's content hashes, carrying everything the export knew about every
 * item — the sidecar verbatim, every folder it was filed under, what kind of
 * thing it is and what it belongs to. It exists because a target has no field
 * for most of that, and the archive's download link expires: what is not
 * written somewhere now is gone. Named by fingerprint rather than by date so
 * the same archive imported twice is the same file with the same hash, which
 * the ledger then skips like any other unchanged item; a later export in the
 * series writes its own manifest beside the earlier one and removes nothing.
 *
 * ## Idempotency and the delta (T6; 0116 §5)
 *
 * Nothing extra is built, on purpose. Every item carries the reader's content
 * hash, the sync loop recomputes it over the bytes it fetches (the seam's
 * rule 2 says they agree), and the ledger's existing rule does the rest: a
 * path it holds with the same hash is skipped without a fetch, a path with a
 * new hash is updated, a path it does not hold is created. So a second import
 * of one archive writes nothing, and a later export in the series writes only
 * what is new in it.
 *
 * ## What this source deliberately cannot say
 *
 * It is a SNAPSHOT (`snapshot: true`), so the loop never counts an item's
 * absence against a row and never reports a deletion, even as a suspicion.
 * It also implements neither `listKeys` nor `listTrashedPaths`: an archive has
 * no bin, and offering a complete key set would be offering absence-counting
 * the evidence it must not have. An archive delta may only ADD.
 */

/** The root of the import: the manifest lives here, and any item placed nowhere. */
const ROOT: FileFolder = { path: '' };

/** For an item the export gave no date — the same fallback the Dropbox source uses. */
const UNDATED = new Date(0).toISOString();

/** What the manifest file is called, before its fingerprint. */
export const ARCHIVE_MANIFEST_PREFIX = 'export-archive-manifest-';

interface Manifest {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly contentHash: string;
  readonly modifiedAt: string;
  readonly fingerprint: string;
}

/** An opened archive and everything the one walk of it produced. */
interface Opened {
  readonly handle: ArchiveHandle;
  readonly items: ReadonlyArray<ArchiveItem>;
  readonly manifest: Manifest;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One row per item, everything the reader carried, in a fixed order. */
export function buildArchiveManifest(
  provider: ArchiveProvider,
  items: ReadonlyArray<ArchiveItem>,
): Manifest {
  // Sorted by hash, not by the order the reader met them in: a manifest that
  // changed bytes with `readdir` order would be re-written on every import.
  const rows = [...items]
    .sort((a, b) => a.contentHash.localeCompare(b.contentHash))
    .map((item) => ({
      path: item.path,
      placedIn: item.placeIn,
      contentHash: item.contentHash,
      sizeBytes: item.sizeBytes,
      kind: item.kind,
      ...(item.relatedTo ? { relatedTo: item.relatedTo } : {}),
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      folders: item.folders,
      metadata: item.metadata,
    }));
  const fingerprint = createHash('sha256')
    .update(rows.map((r) => r.contentHash).join('\n'))
    .digest('hex')
    .slice(0, 12);
  const bytes = new TextEncoder().encode(`${JSON.stringify({ provider, items: rows }, null, 2)}\n`);
  const dates = rows.map((r) => r.createdAt).filter((d): d is string => Boolean(d)).sort();
  return {
    name: `${ARCHIVE_MANIFEST_PREFIX}${fingerprint}.json`,
    bytes,
    contentHash: sha256(bytes),
    modifiedAt: dates.at(-1) ?? UNDATED,
    fingerprint,
  };
}

function manifestRef(manifest: Manifest): string {
  return `manifest:${manifest.fingerprint}`;
}

function manifestItem(manifest: Manifest): FileItem {
  return {
    path: manifest.name,
    name: manifest.name,
    isDirectory: false,
    size: manifest.bytes.byteLength,
    contentHash: manifest.contentHash,
    modifiedAt: manifest.modifiedAt,
    mimeType: 'application/json',
    sourceRef: manifestRef(manifest),
  };
}

/** The item as the file domain sees it, under ONE of its folders. */
function placed(item: ArchiveItem, folder: string): FileItem {
  return {
    path: folder ? `${folder}/${item.path}` : item.path,
    name: item.path,
    isDirectory: false,
    size: item.sizeBytes,
    contentHash: item.contentHash,
    // The taken time is the best "modified" an export knows; an undated item
    // gets the epoch rather than "now", which would change on every import.
    modifiedAt: item.createdAt ?? UNDATED,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    // The archive's own identity for the bytes (0116 §5: the hash is the only
    // identity two exports share). Never used to match a removal — a snapshot
    // reports none — but `fetch` finds the item by it.
    sourceRef: item.contentHash,
  };
}

export class ArchiveFileSource implements FileSource {
  /** See the class header and `FileSource.snapshot`: absence is evidence of nothing. */
  readonly snapshot = true as const;

  private readonly reader: ArchiveReader;
  private readonly location: ArchiveLocation;
  /** Opened once per source, which is once per pass — the walk is the expensive part. */
  private opened?: Promise<Opened>;

  constructor(reader: ArchiveReader, location: ArchiveLocation) {
    this.reader = reader;
    this.location = location;
  }

  private open(): Promise<Opened> {
    // `ArchiveUnreadable` propagates as it is. A pass that cannot open its
    // archive fails with the reader's sentence — "could not be opened", the
    // likely cause — and never lists an empty archive in its place.
    return (this.opened ??= (async () => {
      const handle = await this.reader.open(this.location);
      const items: ArchiveItem[] = [];
      for await (const item of this.reader.items(handle)) items.push(item);
      return { handle, items, manifest: buildArchiveManifest(this.location.provider, items) };
    })());
  }

  async listFolders(): Promise<ReadonlyArray<FileFolder>> {
    const { items } = await this.open();
    const folders = [...new Set(items.flatMap((item) => item.placeIn))].sort();
    return [ROOT, ...folders.map((path) => ({ path, name: path }))];
  }

  async listSince(
    folder: FileFolder,
    _cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<RawFileItem>; nextCursor: SyncCursor }> {
    // The cursor is ignored: an archive has no change feed, so every pass
    // lists everything and the ledger's fast-path decides what is new. The
    // cursor returned is a marker rather than a position, as Dropbox's is.
    const { items, manifest } = await this.open();
    const here =
      folder.path === ''
        ? items.filter((item) => item.placeIn.length === 0)
        : items.filter((item) => item.placeIn.includes(folder.path));
    // METADATA ONLY — the bytes come through `fetch`, one item at a time,
    // inside the loop's bounded concurrency (`FileSource.listSince`).
    const listed: RawFileItem[] = here.map((item) => ({ item: placed(item, folder.path) }));
    if (folder.path === '') listed.push({ item: manifestItem(manifest) });
    return { items: listed, nextCursor: { value: `full-listing:${folder.path}` } };
  }

  async fetch(item: FileItem): Promise<RawFileItem> {
    const { handle, items, manifest } = await this.open();
    if (item.sourceRef === manifestRef(manifest)) return { item, content: manifest.bytes };
    const found = items.find((candidate) => candidate.contentHash === item.sourceRef);
    if (!found) {
      // A listing from one archive fetched against another is a caller's
      // bug; naming it beats reading whatever sits at a guessed path.
      throw new Error(`This archive holds no item for ${item.path} (ref ${item.sourceRef}).`);
    }
    return { item, content: await this.reader.content(handle, found) };
  }
}
