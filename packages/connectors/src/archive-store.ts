// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE ARCHIVES LIVE (workplan 0116 T4, the relay's first slice).
 *
 * The Takeout reader opens an archive by LOCATION: a folder the person
 * extracted, or the `.zip` download itself, one part or every numbered part
 * beside it. Until this slice the only place a location could point was the
 * appliance's own disk. On the managed edition a pass has no disk to point at
 * (0116 T4, measured 2026-09-05), and the owner's answer to where a
 * customer's archive sits is *relay*: the parts go through Ownpace straight
 * into the customer's own file target, and the pass reads them THERE, by
 * byte range, with the same reader.
 *
 * This is the seam that lets the reader not know which. A store answers the
 * questions the reader asks BEFORE it has a tree: what is at this path, what
 * sits beside it, and — once it knows — the folder as a tree or the file as
 * a random-access source. `localStore` is the appliance's disk;
 * `webdavStore` (in `webdav-archive-store.ts`) is a file target. Paths are
 * `/`-separated and relative to the store's root; the local store turns them
 * into filesystem paths at the edge and nowhere else.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { openFolderTree, type ArchiveTree } from './archive-tree.ts';
import { openFileSource, type RandomAccessSource } from './zip-archive.ts';

/** What a store found at a path. `size` is the file's, in bytes. */
export type StoreEntry = { readonly kind: 'folder' } | { readonly kind: 'file'; readonly size: number } | { readonly kind: 'absent' };

export interface ArchiveStore {
  /** What is at `path`: a folder, a file with its size, or nothing. */
  stat(path: string): Promise<StoreEntry>;
  /** The names directly inside a folder, files and folders alike, in no promised order. */
  list(folder: string): Promise<ReadonlyArray<string>>;
  /** The folder at `path` as a tree: the extracted-archive case. */
  folderTree(path: string): ArchiveTree;
  /** The file at `path` as a random-access source: the zip case. */
  source(path: string): Promise<RandomAccessSource>;
  /** The store's own spelling of a path, for a sentence: `C:\...` on Windows, a URL-relative path on WebDAV. */
  describe(path: string): string;
  /** Folder and name of a path, in this store's syntax. */
  split(path: string): { readonly folder: string; readonly name: string };
  /** A folder and a name joined, in this store's syntax. */
  join(folder: string, name: string): string;
}

/** Folder and name of a `/`-separated store path. */
export function splitStorePath(path: string): { readonly folder: string; readonly name: string } {
  const trimmed = path.replace(/\/+$/, '');
  const at = trimmed.lastIndexOf('/');
  return at < 0 ? { folder: '', name: trimmed } : { folder: trimmed.slice(0, at), name: trimmed.slice(at + 1) };
}

/** `folder` and `name` joined in the store's spelling. */
export function joinStorePath(folder: string, name: string): string {
  return folder === '' ? name : `${folder.replace(/\/+$/, '')}/${name}`;
}

/**
 * The appliance's own disk.
 *
 * A location on this store is an ABSOLUTE filesystem path exactly as the
 * person typed it (`/srv/exports/takeout-…-001.zip`, `C:\Users\…`), and the
 * store keeps it that way: the reader splits and joins with the platform's
 * separator through this store's own `split`/`join`, so a Windows path is
 * never re-spelled with `/` and handed back to the filesystem.
 */
export function localStore(): ArchiveStore {
  return {
    async stat(path) {
      try {
        const info = await stat(path);
        if (info.isDirectory()) return { kind: 'folder' };
        if (info.isFile()) return { kind: 'file', size: info.size };
        return { kind: 'absent' };
      } catch {
        return { kind: 'absent' };
      }
    },
    async list(folder) {
      return readdir(folder);
    },
    folderTree(path) {
      return openFolderTree(path);
    },
    source(path) {
      return openFileSource(path);
    },
    describe(path) {
      return path;
    },
    split(path) {
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf(sep));
      return cut < 0 ? { folder: '', name: path } : { folder: path.slice(0, cut), name: path.slice(cut + 1) };
    },
    join(folder, name) {
      return folder === '' ? name : join(folder, name);
    },
  };
}
