// Copyright 2026 The Ownpace authors (Apache-2.0)

import { createHash } from 'node:crypto';
import {
  ARCHIVE_ITEM_KINDS,
  ArchiveUnreadable,
  type ArchiveHandle,
  type ArchiveItem,
  type ArchiveItemKind,
  type ArchiveLocation,
  type ArchiveReader,
  type ArchiveSummary,
} from '@openmig/core/archive-reader';
import { localStore, type ArchiveStore } from './archive-store.ts';
import { zipTreeOf, type ArchiveTree } from './archive-tree.ts';
import { openZip, ZipUnreadable, type ZipArchive } from './zip-archive.ts';

/**
 * The Apple Data & Privacy reader (workplan 0171 T1, §2.2 to §2.4).
 *
 * EXPERIMENTAL, and built on one export (the owner's D9, 2026-11-24). What
 * that export answered is in workplan 0116: two wrapper folders, then the
 * person's own tree unchanged, with one flat `Drive Details.csv` inside the
 * data and no path column in it:
 *
 * ```
 * iCloud Drive.zip
 * └── iCloud Drive/          wrapper 1, named for the service
 *     └── Drive/             wrapper 2
 *         ├── Drive Details.csv
 *         └── <the person's own tree>
 * ```
 *
 * ## What it reads, and how it decides
 *
 * - **The data root is FOUND by its manifest, not by its path.** The folder
 *   holding a `Drive Details.csv` whose first line is the header below is
 *   iCloud Drive's; a folder holding a CSV whose header names an image file
 *   column and a checksum column is iCloud Photos'. Neither wrapper name is
 *   read, and the search looks at most four levels down, as Takeout's
 *   `findPhotosRoot` does.
 * - **The tree is the truth.** A file's place is its folder below the data
 *   root, unchanged. The manifest is excluded at its ONE path, never by its
 *   name: the person's own `Drive Details.csv` deeper down is copied.
 * - **The CSV is joined, not trusted.** It has no path column, so a row is
 *   joined to a file only when its `Title` and `Size` match exactly one file
 *   and that file matches exactly one row. A joined row adds `Favourite` and
 *   its three dates to `metadata`, VERBATIM; nothing is parsed (D6).
 * - **Dates are the zip's own** (D6): the extended-timestamp field, which is
 *   UTC, where the member has one; otherwise the DOS stamp, which has no zone
 *   and is read as if it were UTC. A file may be dated hours off, never days.
 *   The CSV's dates carry no zone and the one export measured read as US
 *   Pacific, so they are kept as text and never become a date here.
 * - **iWork packages** (`.pages`, `.numbers`, `.key`) are copied as what they
 *   arrive as: a folder, files and all, or one file. Either way nothing is
 *   lost.
 * - **Photos are written against Apple's description, not a real export.**
 *   No iCloud Photos export has been opened for this repository, so every
 *   column name the reader relies on sits in ONE table,
 *   {@link APPLE_PHOTOS_COLUMNS}; the first real export corrects that table,
 *   not the reader.
 *
 * ## What it refuses, and why loudly
 *
 * An export with neither manifest is refused with `ArchiveUnreadable`, never
 * read as empty: an empty import is indistinguishable, on the screen, from an
 * export that really was empty (the factory's rule). So is a folder holding
 * fewer `.zip` parts than the person said Apple gave them (§2.3: a missing part
 * cannot be seen from the files), and two parts whose manifests disagree,
 * which is two different exports in one folder. Anything under the export
 * that is neither service's data root is not copied, and the summary says how
 * much was left behind.
 */

/** The header of `Drive Details.csv`, as 0116 recorded it from the one export. */
export const APPLE_DRIVE_MANIFEST = 'Drive Details.csv';
export const APPLE_DRIVE_COLUMNS = [
  'Title',
  'Base Hash',
  'Type',
  'Size',
  'Created On',
  'Modified On',
  'Last Opened On',
  'Favourite',
  'Executable',
  'Package Signature',
] as const;

/**
 * THE ONE TABLE THE FIRST PHOTOS EXPORT CORRECTS (§2.2).
 *
 * The column names of iCloud Photos' CSVs as Apple describes the export, not
 * as one has been read: `file` names the media file, `checksum` is what makes
 * a CSV the library's manifest rather than an album's list. Each is a list of
 * spellings, any of which counts. Nothing else in this file names a photos
 * column.
 */
export const APPLE_PHOTOS_COLUMNS = {
  file: ['imgName', 'Image Name', 'File Name', 'fileName'],
  checksum: ['fileChecksum', 'Checksum', 'checksum'],
} as const;

/** What counts as a photo or a video beside the photos manifest. */
const MEDIA_EXTENSION = /\.(jpe?g|heic|heif|png|gif|tiff?|webp|dng|raw|cr2|nef|arw|mov|mp4|m4v|avi|3gp)$/i;

/** How deep the search for a data root goes, from the top of the export. */
const ROOT_SEARCH_DEPTH = 4;

/** The most of a CSV's first line read to decide what it is. */
const HEADER_BYTES = 64 * 1024;

const ZIP = /\.zip$/i;
const CSV = /\.csv$/i;

type Service = 'icloud-drive' | 'icloud-photos';

/** A data root, and the manifest(s) that made it one. */
interface DataRoot {
  readonly service: Service;
  readonly path: string;
  /** Tree paths of the manifests, excluded from the items at exactly these paths. */
  readonly manifests: ReadonlyArray<string>;
}

interface FoundFile {
  readonly treePath: string;
  readonly service: Service;
  /** The folder it sits in, relative to its data root; `''` for the root itself. */
  readonly folder: string;
  readonly name: string;
}

interface Collapsed {
  readonly items: ReadonlyArray<ArchiveItem>;
  /** Item key → the tree path of one copy of those bytes under that name. */
  readonly whereabouts: ReadonlyMap<string, string>;
  readonly skipped: { readonly folders: ReadonlyArray<string>; readonly items: number };
  readonly albums: ReadonlyArray<string>;
}

interface AppleHandle extends ArchiveHandle {
  readonly tree: ArchiveTree;
  readonly roots: ReadonlyArray<DataRoot>;
  collapsed?: Promise<Collapsed>;
}

const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const join = (folder: string, name: string): string =>
  folder === '' ? name : name === '' ? folder : `${folder}/${name}`;

/** An item is its bytes AND its name: two differently named files with equal bytes are two files. */
const itemKey = (contentHash: string, name: string): string => `${contentHash}\u0000${name}`;

/**
 * A CSV, RFC 4180: quoted fields, doubled quotes, CR LF or LF, a leading BOM.
 * Small on purpose; the manifests are tables of names and numbers.
 */
export function parseAppleCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Rows as records keyed by the header's (trimmed) column names. */
function csvRecords(text: string): { header: string[]; records: Record<string, string>[] } {
  const [head, ...body] = parseAppleCsv(text);
  const header = (head ?? []).map((h) => h.trim());
  return {
    header,
    records: body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))),
  };
}

const utf8 = new TextDecoder();

/** The first line of a file, read from the front of its stream and no further. */
async function firstLine(tree: ArchiveTree, path: string): Promise<string> {
  const stream = await tree.stream(path);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    while (seen < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      seen += value.byteLength;
      if (value.includes(0x0a)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(seen);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return (utf8.decode(bytes).split(/\r?\n/)[0] ?? '').replace(/^\uFEFF/, '');
}

function headerOf(line: string): string[] {
  return (parseAppleCsv(line)[0] ?? []).map((h) => h.trim());
}

export function isAppleDriveHeader(header: ReadonlyArray<string>): boolean {
  return header.length === APPLE_DRIVE_COLUMNS.length && APPLE_DRIVE_COLUMNS.every((c, i) => header[i] === c);
}

function columnIn(header: ReadonlyArray<string>, names: ReadonlyArray<string>): string | undefined {
  return names.find((n) => header.includes(n));
}

/** A photos manifest names a file column AND a checksum column. */
export function isApplePhotosManifestHeader(header: ReadonlyArray<string>): boolean {
  return (
    columnIn(header, APPLE_PHOTOS_COLUMNS.file) !== undefined &&
    columnIn(header, APPLE_PHOTOS_COLUMNS.checksum) !== undefined
  );
}

/** An album's list names a file column and no checksum. */
function isAlbumHeader(header: ReadonlyArray<string>): boolean {
  return (
    columnIn(header, APPLE_PHOTOS_COLUMNS.file) !== undefined &&
    columnIn(header, APPLE_PHOTOS_COLUMNS.checksum) === undefined
  );
}

/**
 * Every data root within {@link ROOT_SEARCH_DEPTH} levels, found by what it
 * holds. A found root is not descended into: the person's own tree below it
 * may hold CSVs of their own, and those are files to copy, not manifests.
 */
async function findDataRoots(tree: ArchiveTree): Promise<DataRoot[]> {
  const roots: DataRoot[] = [];
  const walk = async (folder: string, depth: number): Promise<void> => {
    const entries = [...(await tree.list(folder))].sort(byName);
    const csvs = entries.filter((e) => !e.isDirectory && CSV.test(e.name));
    const drive = csvs.find((e) => e.name === APPLE_DRIVE_MANIFEST);
    if (drive && isAppleDriveHeader(headerOf(await firstLine(tree, join(folder, drive.name))))) {
      roots.push({ service: 'icloud-drive', path: folder, manifests: [join(folder, drive.name)] });
      return;
    }
    const photoManifests: string[] = [];
    for (const csv of csvs) {
      const at = join(folder, csv.name);
      if (isApplePhotosManifestHeader(headerOf(await firstLine(tree, at)))) photoManifests.push(at);
    }
    if (photoManifests.length > 0) {
      roots.push({ service: 'icloud-photos', path: folder, manifests: photoManifests });
      return;
    }
    if (depth >= ROOT_SEARCH_DEPTH) return;
    for (const sub of entries.filter((e) => e.isDirectory)) await walk(join(folder, sub.name), depth + 1);
  };
  await walk('', 0);
  return roots;
}

/** Every file below `folder`, recursively, sorted, as tree paths. */
async function filesBelow(tree: ArchiveTree, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of [...(await tree.list(folder))].sort(byName)) {
    const at = join(folder, entry.name);
    if (entry.isDirectory) out.push(...(await filesBelow(tree, at)));
    else out.push(at);
  }
  return out;
}

function relativeTo(root: string, treePath: string): { folder: string; name: string } {
  const below = root === '' ? treePath : treePath.slice(root.length + 1);
  const cut = below.lastIndexOf('/');
  return cut < 0 ? { folder: '', name: below } : { folder: below.slice(0, cut), name: below.slice(cut + 1) };
}

/**
 * What is under the export but in no data root, counted for the summary:
 * a third service the reader does not know is left behind and SAID, never
 * read as if it were Drive.
 */
async function outsideRoots(
  tree: ArchiveTree,
  roots: ReadonlyArray<DataRoot>,
): Promise<{ folders: string[]; items: number }> {
  const inRoot = (path: string): boolean => roots.some((r) => r.path === '' || path === r.path || path.startsWith(`${r.path}/`));
  const holdsRoot = (path: string): boolean => roots.some((r) => path === '' || r.path.startsWith(`${path}/`));
  const folders: string[] = [];
  let items = 0;
  const walk = async (folder: string): Promise<void> => {
    for (const entry of [...(await tree.list(folder))].sort(byName)) {
      const at = join(folder, entry.name);
      if (inRoot(at)) continue;
      if (entry.isDirectory && holdsRoot(at)) {
        await walk(at);
        continue;
      }
      if (entry.isDirectory) {
        folders.push(at);
        items += (await filesBelow(tree, at)).length;
      } else {
        items += 1;
      }
    }
  };
  if (!roots.some((r) => r.path === '')) await walk('');
  return { folders, items };
}

async function fingerprint(tree: ArchiveTree, path: string): Promise<{ hash: string; sizeBytes: number }> {
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const stream = await tree.stream(path);
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    digest.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { hash: digest.digest('hex'), sizeBytes };
}

function asArchiveError(err: unknown): unknown {
  if (err instanceof ZipUnreadable) {
    return new ArchiveUnreadable(`This archive could not be read — ${err.reason}`, { cause: err });
  }
  return err;
}

const NOT_APPLE =
  'This does not look like an Apple export we know: no “Drive Details.csv” of iCloud Drive and no ' +
  'photos list of iCloud Photos was found in it. Apple’s export from privacy.apple.com holds one of ' +
  'them; an export of another Apple service, or a download that has not fully arrived, looks like this.';

/**
 * THE PARTS, opened (§2.3).
 *
 * A folder of `.zip` parts is read as one export; a folder with none is an
 * extracted export; one named `.zip` is one part. With the person's count in
 * hand, fewer parts than they said is refused, naming both numbers.
 */
async function openParts(
  store: ArchiveStore,
  location: ArchiveLocation,
): Promise<{ tree: ArchiveTree; archives: ReadonlyArray<ZipArchive>; parts: ReadonlyArray<string> }> {
  const found = await store.stat(location.path);
  if (found.kind === 'absent') {
    throw new ArchiveUnreadable(
      `This archive could not be opened — nothing is at ${store.describe(location.path)}. If the download ` +
        'is still running, or was saved somewhere else, it will look like this.',
    );
  }
  let parts: string[];
  if (found.kind === 'folder') {
    const zips = (await store.list(location.path)).filter((n) => ZIP.test(n)).sort();
    if (zips.length === 0) {
      // An extracted export. Its parts cannot be counted, so the count is not asked of it.
      return { tree: store.folderTree(location.path), archives: [], parts: [] };
    }
    parts = zips.map((n) => store.join(location.path, n));
  } else {
    const { name } = store.split(location.path);
    if (!ZIP.test(name)) {
      throw new ArchiveUnreadable(
        `This archive could not be opened — ${name} is a file, not a folder or a .zip download.`,
      );
    }
    parts = [location.path];
  }
  const expected = location.parts;
  if (expected !== undefined && parts.length < expected) {
    throw new ArchiveUnreadable(
      `This archive could not be opened — found ${parts.length} of the ${expected} parts Apple gave you. ` +
        'Put every part, unopened, in the same folder and name that folder here.',
    );
  }
  const archives: ZipArchive[] = [];
  try {
    for (const part of parts) {
      const source = await store.source(part);
      try {
        archives.push(await openZip(source));
      } catch (err) {
        await source.close().catch(() => {});
        throw err;
      }
    }
  } catch (err) {
    await Promise.all(archives.map((a) => a.close().catch(() => {})));
    if (err instanceof ArchiveUnreadable) throw err;
    const reason = err instanceof ZipUnreadable ? err.reason : err instanceof Error ? err.message : String(err);
    throw new ArchiveUnreadable(
      `This archive could not be opened — ${reason} If the download is still running, or only some parts ` +
        'arrived, it will look like this.',
      { cause: err },
    );
  }
  return { tree: zipTreeOf(archives), archives, parts };
}

/**
 * Two parts carrying the same manifest with different bytes are two exports
 * (§2.3), and reading them as one would answer every path from whichever part
 * came first. Compared by the directory's CRC-32 and size, without reading.
 */
function refuseDisagreeingManifests(
  archives: ReadonlyArray<ZipArchive>,
  parts: ReadonlyArray<string>,
  roots: ReadonlyArray<DataRoot>,
  describe: (path: string) => string,
): void {
  const key = (name: string): string => name.split('/').filter((s) => s !== '').join('/');
  for (const manifest of roots.flatMap((r) => r.manifests)) {
    const seen: Array<{ part: string; crc: number; size: number }> = [];
    archives.forEach((archive, i) => {
      const entry = archive.entries.find((e) => !e.isDirectory && key(e.name) === manifest);
      if (entry) seen.push({ part: parts[i]!, crc: entry.crc32, size: entry.uncompressedSize });
    });
    const first = seen[0];
    const other = seen.find((s) => s.crc !== first?.crc || s.size !== first?.size);
    if (first && other) {
      throw new ArchiveUnreadable(
        `This archive could not be opened — ${describe(first.part)} and ${describe(other.part)} carry ` +
          `different “${manifest.split('/').pop()}” files, so they are two different exports. Keep one ` +
          'export’s parts in this folder.',
      );
    }
  }
}

/** The Drive manifest's rows joined to the files, one to one, by Title and Size (§2.2 step 4). */
function joinDriveRows(
  records: ReadonlyArray<Record<string, string>>,
  files: ReadonlyArray<{ readonly key: string; readonly name: string; readonly sizeBytes: number }>,
): Map<string, Record<string, string>> {
  const filesBy = new Map<string, string[]>();
  for (const f of files) {
    const k = `${f.name}\u0000${f.sizeBytes}`;
    filesBy.set(k, [...(filesBy.get(k) ?? []), f.key]);
  }
  const rowsBy = new Map<string, Record<string, string>[]>();
  for (const r of records) {
    const size = Number((r['Size'] ?? '').trim());
    if (!Number.isInteger(size)) continue;
    const k = `${r['Title'] ?? ''}\u0000${size}`;
    rowsBy.set(k, [...(rowsBy.get(k) ?? []), r]);
  }
  const out = new Map<string, Record<string, string>>();
  for (const [k, rows] of rowsBy) {
    const matched = filesBy.get(k);
    if (rows.length === 1 && matched?.length === 1) out.set(matched[0]!, rows[0]!);
  }
  return out;
}

/** What a joined Drive row adds, verbatim (D6: the dates are text, never parsed). */
function driveMetadata(row: Record<string, string>): Record<string, string> {
  return {
    Favourite: row['Favourite'] ?? '',
    'Created On': row['Created On'] ?? '',
    'Modified On': row['Modified On'] ?? '',
    'Last Opened On': row['Last Opened On'] ?? '',
  };
}

/**
 * @param store where locations point: the appliance's disk unless the caller
 *   says otherwise, as for the Takeout reader.
 */
export function createApplePrivacyArchiveReader(store: ArchiveStore = localStore()): ArchiveReader {
  const walk = async (tree: ArchiveTree, roots: ReadonlyArray<DataRoot>): Promise<Collapsed> => {
    const found: FoundFile[] = [];
    let skippedItems = 0;
    const skippedFolders: string[] = [];
    const driveRecords: Record<string, string>[] = [];
    const photoRows = new Map<string, Record<string, string>[]>();
    /** Album title → the media names it lists. */
    const albumLists = new Map<string, Set<string>>();

    for (const root of roots) {
      const manifests = new Set(root.manifests);
      if (root.service === 'icloud-drive') {
        driveRecords.push(...csvRecords(utf8.decode(await tree.read(root.manifests[0]!))).records);
      } else {
        for (const manifest of root.manifests) {
          const { header, records } = csvRecords(utf8.decode(await tree.read(manifest)));
          const column = columnIn(header, APPLE_PHOTOS_COLUMNS.file)!;
          for (const r of records) {
            const name = r[column] ?? '';
            photoRows.set(name, [...(photoRows.get(name) ?? []), r]);
          }
        }
      }
      for (const treePath of await filesBelow(tree, root.path)) {
        if (manifests.has(treePath)) continue;
        const { folder, name } = relativeTo(root.path, treePath);
        if (root.service === 'icloud-photos') {
          if (CSV.test(name)) {
            const { header, records } = csvRecords(utf8.decode(await tree.read(treePath)));
            if (isAlbumHeader(header)) {
              const column = columnIn(header, APPLE_PHOTOS_COLUMNS.file)!;
              const title = name.replace(CSV, '');
              const listed = albumLists.get(title) ?? new Set<string>();
              for (const r of records) listed.add(r[column] ?? '');
              albumLists.set(title, listed);
              continue;
            }
          }
          if (!MEDIA_EXTENSION.test(name)) {
            // Beside the photos, not a photo: counted in the summary, not copied.
            skippedItems += 1;
            continue;
          }
        }
        found.push({ treePath, service: root.service, folder, name });
      }
    }

    const outside = await outsideRoots(tree, roots);
    skippedFolders.push(...outside.folders);
    skippedItems += outside.items;

    // One record per distinct item: the same name and bytes in two parts, two
    // folders or two albums is one item, placed in each (rule 1).
    const byKey = new Map<string, { copies: FoundFile[]; hash: string; sizeBytes: number; createdAt?: string }>();
    for (const file of found) {
      const { hash, sizeBytes } = await fingerprint(tree, file.treePath);
      const key = itemKey(hash, file.name);
      const seen = byKey.get(key);
      if (seen) {
        seen.copies.push(file);
        continue;
      }
      const createdAt = tree.modifiedAt ? await tree.modifiedAt(file.treePath) : undefined;
      byKey.set(key, { copies: [file], hash, sizeBytes, ...(createdAt ? { createdAt } : {}) });
    }

    const driveRows = joinDriveRows(
      driveRecords,
      [...byKey].flatMap(([key, v]) =>
        v.copies.some((c) => c.service === 'icloud-drive') ? [{ key, name: v.copies[0]!.name, sizeBytes: v.sizeBytes }] : [],
      ),
    );

    // Where a photo in no album lands: the export's own wrapper for the
    // service, so photos never fall loose among the person's Drive files.
    const photosHome = new Map(
      roots.filter((r) => r.service === 'icloud-photos').map((r) => [r.path, r.path.split('/')[0] ?? ''] as const),
    );
    const photosRootOf = (file: FoundFile): string =>
      roots.find((r) => r.service === 'icloud-photos' && (r.path === '' || file.treePath.startsWith(`${r.path}/`)))?.path ?? '';

    const items: ArchiveItem[] = [];
    const whereabouts = new Map<string, string>();
    const usedAlbums = new Set<string>();
    for (const [key, { copies, hash, sizeBytes, createdAt }] of byKey) {
      const first = copies[0]!;
      whereabouts.set(key, first.treePath);
      const placeIn = new Set<string>();
      const folders = new Set<string>();
      const services = new Set<Service>();
      const albums: string[] = [];
      for (const copy of copies) {
        services.add(copy.service);
        if (copy.service === 'icloud-drive') {
          placeIn.add(copy.folder);
          folders.add(copy.folder);
          continue;
        }
        const inAlbums = [...albumLists].filter(([, names]) => names.has(copy.name)).map(([title]) => title);
        for (const album of inAlbums) {
          albums.push(album);
          usedAlbums.add(album);
          placeIn.add(album);
          folders.add(album);
        }
        const home = join(photosHome.get(photosRootOf(copy)) ?? '', copy.folder);
        folders.add(home);
        if (inAlbums.length === 0) placeIn.add(home);
      }
      const driveRow = driveRows.get(key);
      const photoRow = services.has('icloud-photos') ? photoRows.get(first.name) : undefined;
      items.push({
        contentHash: hash,
        path: first.name,
        sizeBytes,
        kind: 'original',
        // `''` is the import root, which `placeIn` says by being empty.
        placeIn: [...placeIn].filter((f) => f !== '').sort(),
        folders: [...folders].sort(),
        ...(createdAt ? { createdAt } : {}),
        metadata: {
          services: [...services].sort(),
          ...(driveRow ? { driveDetails: driveMetadata(driveRow) } : {}),
          // Joined only when the name is listed once: two rows for one name
          // cannot say which is this file's.
          ...(photoRow?.length === 1 ? { photoDetails: photoRow[0] } : {}),
          ...(albums.length > 0 ? { albums: [...new Set(albums)].sort() } : {}),
        },
      });
    }
    return {
      items,
      whereabouts,
      skipped: { folders: skippedFolders, items: skippedItems },
      albums: [...usedAlbums].sort(),
    };
  };

  const collapsedOnce = (handle: AppleHandle): Promise<Collapsed> =>
    (handle.collapsed ??= walk(handle.tree, handle.roots).catch((err: unknown) => {
      throw asArchiveError(err);
    }));

  async function locate(handle: ArchiveHandle, item: ArchiveItem): Promise<string> {
    const at = (await collapsedOnce(handle as AppleHandle)).whereabouts.get(itemKey(item.contentHash, item.path));
    if (!at) {
      throw new Error(`This archive holds no item with hash ${item.contentHash.slice(0, 12)}… (${item.path}).`);
    }
    return at;
  }

  return {
    provider: 'apple-privacy',

    async open(location: ArchiveLocation): Promise<ArchiveHandle> {
      if (location.provider !== 'apple-privacy') {
        throw new ArchiveUnreadable(
          `This reader opens Apple Data & Privacy exports, and this one is a ${location.provider} export.`,
        );
      }
      const { tree, archives, parts } = await openParts(store, location);
      try {
        const roots = await findDataRoots(tree).catch((err: unknown) => {
          throw asArchiveError(err);
        });
        if (roots.length === 0) throw new ArchiveUnreadable(NOT_APPLE);
        for (const service of ['icloud-drive', 'icloud-photos'] as const) {
          const same = roots.filter((r) => r.service === service);
          if (same.length > 1) {
            throw new ArchiveUnreadable(
              `This archive could not be opened — it holds more than one ${service === 'icloud-drive' ? 'iCloud Drive' : 'iCloud Photos'} ` +
                `export (${same.map((r) => `“${r.path}”`).join(', ')}). Keep one export in this folder.`,
            );
          }
        }
        refuseDisagreeingManifests(archives, parts, roots, (p) => store.split(p).name);
        const handle: AppleHandle = { provider: 'apple-privacy', tree, roots, close: () => tree.close() };
        return handle;
      } catch (err) {
        await tree.close().catch(() => {});
        throw err;
      }
    },

    async *items(handle: ArchiveHandle): AsyncIterable<ArchiveItem> {
      yield* (await collapsedOnce(handle as AppleHandle)).items;
    },

    async content(handle: ArchiveHandle, item: ArchiveItem): Promise<Uint8Array> {
      const at = await locate(handle, item);
      try {
        return await (handle as AppleHandle).tree.read(at);
      } catch (err) {
        throw asArchiveError(err);
      }
    },

    async contentStream(handle: ArchiveHandle, item: ArchiveItem): Promise<ReadableStream<Uint8Array>> {
      const at = await locate(handle, item);
      try {
        return await (handle as AppleHandle).tree.stream(at);
      } catch (err) {
        throw asArchiveError(err);
      }
    },

    async summary(handle: ArchiveHandle): Promise<ArchiveSummary> {
      const { items, skipped, albums } = await collapsedOnce(handle as AppleHandle);
      const dates = items.map((i) => i.createdAt).filter((d): d is string => Boolean(d)).sort();
      const byKind = Object.fromEntries(ARCHIVE_ITEM_KINDS.map((k) => [k, 0])) as Record<ArchiveItemKind, number>;
      for (const item of items) byKind[item.kind] += 1;
      return {
        items: items.length,
        bytes: items.reduce((n, i) => n + i.sizeBytes, 0),
        folders: new Set(items.flatMap((i) => i.folders)).size,
        byKind,
        ...(dates[0] ? { earliest: dates[0] } : {}),
        ...(dates.at(-1) ? { latest: dates.at(-1)! } : {}),
        ...(skipped.items > 0 || skipped.folders.length > 0 ? { skipped } : {}),
        ...(albums.length > 0 ? { albums: albums.map((title) => ({ folder: title, title, metadata: {} })) } : {}),
      };
    },
  };
}
