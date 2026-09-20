// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE AN ARCHIVE'S FILES ARE, WITHOUT SAYING HOW THEY ARE STORED
 * (workplan 0116 D7, second slice).
 *
 * The Takeout reader walks a tree: the folders under `Takeout/Google Photos`,
 * the files in each, a sidecar beside a photo, the bytes of one file at a
 * time. Until this slice that tree was the filesystem, which meant the person
 * had to extract the download first — and on the managed edition there is no
 * filesystem a pass can reach at all (0116 T4, measured 2026-09-05).
 *
 * This is the seam: five questions a reader asks of a tree, answered by a
 * folder on disk ({@link openFolderTree}) or by the `.zip` the export came as
 * ({@link zipTreeOf}), so the reader is written once and never knows which.
 *
 * ## Paths
 *
 * `/`-separated, relative to the tree's root, never leading with one, `''`
 * being the root — the spelling a zip uses for every member, so the zip tree
 * needs no translation and the folder tree does one `join`. In the zip tree a
 * path is a KEY, looked up in a map built from the member names, and is never
 * touched as a filesystem path: a member spelled `../../etc/passwd` is a
 * member with that name, or nothing, and can reach nothing.
 *
 * ## A multi-part download is one tree
 *
 * Google splits a large Takeout into `takeout-<stamp>-001.zip`, `-002.zip`,
 * … and each part is a complete zip on its own — a central directory of its
 * own, openable alone. (That is the measurement 0116 §"What D7 is actually
 * choosing between" asked for; the reader refuses a spanned set with a
 * sentence, and would have said so.) The photo tree is split across the parts
 * BY FILE, so an album's copy of a photo can sit in part 1 and the year copy —
 * the one Takeout wrote the sidecar beside — in part 3. `zipTreeOf` takes
 * every part and answers as if they were one tree; the reader's collapse by
 * content hash then meets the two copies exactly as it does on disk.
 */

import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { openFileSource, openZip, type RandomAccessSource, type ZipArchive, type ZipEntry } from './zip-archive.ts';

/** One child of a folder. */
export interface TreeEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/**
 * A whole-file read holds this much at most, unless the caller says otherwise
 * — an item, not a library. The same figure `ZipArchive.read` defaults to, so
 * the two trees refuse the same file at the same size.
 */
export const DEFAULT_TREE_READ_BYTES = 256 * 1024 * 1024;

/** The five questions a reader asks. See the header for the path rules. */
export interface ArchiveTree {
  /** Whether a folder is at this path. */
  isDirectory(path: string): Promise<boolean>;
  /**
   * The immediate children of a folder, files and folders alike, in no
   * promised order. Rejects when nothing is at `path`, or a file is.
   */
  list(path: string): Promise<ReadonlyArray<TreeEntry>>;
  /**
   * A whole file, for something small — a sidecar, an item under the
   * streaming threshold. Refuses BEFORE reading a file larger than `maxBytes`,
   * so a caller that buffers cannot be walked into holding a video.
   */
  read(path: string, maxBytes?: number): Promise<Uint8Array>;
  /**
   * The file's bytes as a fresh stream. RE-OPENABLE: a second call is a
   * second read from the first byte, which is what a retry after a
   * half-written upload needs (`FileBody.open`).
   */
  stream(path: string): Promise<ReadableStream<Uint8Array>>;
  /** Releases whatever the tree holds open — a zip tree holds a descriptor per part. */
  close(): Promise<void>;
}

/** A folder on disk as a tree: the appliance's route, and what the reader read before this slice. */
export function openFolderTree(root: string): ArchiveTree {
  const at = (path: string): string => (path === '' ? root : join(root, ...path.split('/')));

  async function file(path: string): Promise<{ readonly at: string; readonly size: number }> {
    const info = await stat(at(path));
    if (!info.isFile()) throw new Error(`${path} is not a file.`);
    return { at: at(path), size: info.size };
  }

  return {
    async isDirectory(path) {
      try {
        return (await stat(at(path))).isDirectory();
      } catch {
        return false;
      }
    },

    async list(path) {
      const entries = await readdir(at(path), { withFileTypes: true });
      // A symlink is neither: it is skipped, as the reader always skipped it.
      return entries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    },

    async read(path, maxBytes = DEFAULT_TREE_READ_BYTES) {
      const found = await file(path);
      if (found.size > maxBytes) {
        throw new Error(
          `${path} is ${found.size} bytes, more than the ${maxBytes} this read will hold; stream it instead.`,
        );
      }
      return new Uint8Array(await readFile(found.at));
    },

    async stream(path) {
      // `createReadStream` reports a missing file on the stream, later; the
      // stat makes a missing path reject HERE, where the caller can say so.
      const found = await file(path);
      return Readable.toWeb(createReadStream(found.at)) as ReadableStream<Uint8Array>;
    },

    async close() {},
  };
}

interface Member {
  readonly archive: ZipArchive;
  readonly entry: ZipEntry;
}

interface Folder {
  readonly folders: Set<string>;
  readonly files: Map<string, Member>;
}

/** A member name as a tree path: no leading slashes, no trailing one, no empty segments. */
function segmentsOf(name: string): string[] {
  return name.split('/').filter((segment) => segment !== '');
}

/**
 * Every folder in the archives, by path, with what sits directly in it.
 *
 * Folders are IMPLIED by the members' names rather than read from directory
 * placeholders: some writers emit `Takeout/` and `Takeout/Google Photos/` as
 * members of their own and some emit no directory entries at all, and a
 * reader that trusted the placeholders would see an empty tree on the second
 * kind. A name that appears in two parts is answered by the first part it was
 * met in, and Takeout never does that with a photo.
 */
function indexOf(archives: ReadonlyArray<ZipArchive>): Map<string, Folder> {
  const index = new Map<string, Folder>();
  const folderAt = (path: string): Folder => {
    let folder = index.get(path);
    if (!folder) {
      folder = { folders: new Set(), files: new Map() };
      index.set(path, folder);
    }
    return folder;
  };
  folderAt('');

  for (const archive of archives) {
    for (const entry of archive.entries) {
      const segments = segmentsOf(entry.name);
      if (segments.length === 0) continue;
      const folderSegments = entry.isDirectory ? segments.length : segments.length - 1;
      let parent = '';
      for (let i = 0; i < folderSegments; i += 1) {
        const name = segments[i]!;
        folderAt(parent).folders.add(name);
        parent = parent === '' ? name : `${parent}/${name}`;
        folderAt(parent);
      }
      if (entry.isDirectory) continue;
      const files = folderAt(parent).files;
      const name = segments[segments.length - 1]!;
      if (!files.has(name)) files.set(name, { archive, entry });
    }
  }
  return index;
}

/** The zips, already open, as one tree. Closing the tree closes every one of them. */
export function zipTreeOf(archives: ReadonlyArray<ZipArchive>): ArchiveTree {
  const index = indexOf(archives);
  const key = (path: string): string => segmentsOf(path).join('/');

  function member(path: string): Member {
    const segments = segmentsOf(path);
    const name = segments.pop();
    const folder = index.get(segments.join('/'));
    const found = name === undefined ? undefined : folder?.files.get(name);
    if (!found) throw new Error(`${path} is not in this archive.`);
    return found;
  }

  return {
    async isDirectory(path) {
      return index.has(key(path));
    },

    async list(path) {
      const folder = index.get(key(path));
      if (!folder) throw new Error(`${path} is not a folder in this archive.`);
      return [
        ...[...folder.folders].map((name) => ({ name, isDirectory: true })),
        ...[...folder.files.keys()].map((name) => ({ name, isDirectory: false })),
      ];
    },

    async read(path, maxBytes = DEFAULT_TREE_READ_BYTES) {
      const { archive, entry } = member(path);
      return archive.read(entry, maxBytes);
    },

    async stream(path) {
      const { archive, entry } = member(path);
      return archive.open(entry);
    },

    async close() {
      await Promise.all(archives.map((archive) => archive.close()));
    },
  };
}

/**
 * The zips at these paths, opened and joined into one tree. `open` is how a
 * path becomes bytes — a file on the appliance's disk by default, a file in
 * the customer's own target read by byte range on the managed edition
 * (`webdav-archive-store.ts`). Anything that fails to open closes what was
 * opened before it and throws the zip reader's own sentence; the caller turns
 * that into `ArchiveUnreadable`, because only the caller knows the archive's
 * name.
 */
export async function openZipTree(
  parts: ReadonlyArray<string>,
  open: (path: string) => Promise<RandomAccessSource> = openFileSource,
): Promise<ArchiveTree> {
  const archives: ZipArchive[] = [];
  try {
    for (const part of parts) {
      const source = await open(part);
      try {
        archives.push(await openZip(source));
      } catch (err) {
        await source.close().catch(() => {});
        throw err;
      }
    }
  } catch (err) {
    await Promise.all(archives.map((archive) => archive.close().catch(() => {})));
    throw err;
  }
  return zipTreeOf(archives);
}
