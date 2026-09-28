// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BIN READ THAT HELD THE WHOLE ACCOUNT (workplan 0150 T1 and T8).
 *
 * Two readers of a Dropbox walk the whole tree: `listFolders`, which a pass
 * starts from, and `listTrashedPaths`, the bin read, which also brings every
 * tombstone Dropbox still keeps. Both gathered every entry of that walk into
 * one array before they looked at any of it. On the owner's account that is
 * 55,245 files, and the pass machine has half a gigabyte.
 *
 * The bin read runs only on a pass that reached every folder, and of what such
 * a pass holds only at its end it held the most. It was suspected first when
 * every pass of the owner's migration was killed for memory (SIGKILL), but
 * those passes died while copying, of an upload that kept each file whole, and
 * none reached it (`an-upload-that-kept-every-byte`; 0150's Status,
 * 2026-09-28).
 *
 * What this holds, against a fake Dropbox that logs each page it serves and
 * each entry that is read:
 *
 *  1. Each reader is done with a page before it asks for the next, so no
 *     more than one page is held at a time.
 *  2. What they answer is what they answered before, across pages: the
 *     folders; the tombstones' paths, a deleted Paper doc under its exported
 *     name as well; and the count of tombstones with no name.
 *  3. A listing that never stops paging is still refused, not taken as whole.
 */

import { describe, it, expect } from 'vitest';
import { DropboxFileSource } from './dropbox-file-source.ts';
import type { DropboxEntry, DropboxTransport } from './dropbox-file-source.types.ts';

type Tag = 'file' | 'folder' | 'deleted';

/** An entry whose kind, when read, is written to the log: the moment the source looks at it. */
function entry(log: string[], tag: Tag, path: string, over: Partial<DropboxEntry> = {}): DropboxEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const base: Record<string, unknown> = {
    id: `id:${path}`,
    name,
    path_display: path,
    ...(tag === 'file' ? { size: 10, server_modified: '2026-09-25T10:00:00Z', content_hash: `h-${path}` } : {}),
    ...over,
  };
  Object.defineProperty(base, '.tag', {
    enumerable: true,
    get() {
      log.push(`read ${path}`);
      return tag;
    },
  });
  return base as unknown as DropboxEntry;
}

/** A Dropbox that serves these pages in order, writing each page to the log as it goes out. */
function paged(log: string[], pages: ReadonlyArray<ReadonlyArray<DropboxEntry>>): DropboxTransport {
  let served = 0;
  return async (url) => {
    const at = served++;
    log.push(`page ${at + 1}`);
    const body = url.endsWith('/files/list_folder') || url.endsWith('/files/list_folder/continue')
      ? { entries: pages[at] ?? [], cursor: `c${at + 1}`, has_more: at + 1 < pages.length }
      : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => JSON.stringify(body),
    };
  };
}

const source = (transport: DropboxTransport, paper?: 'markdown') =>
  new DropboxFileSource(transport, {
    apiBaseUrl: 'https://api.test/2',
    contentBaseUrl: 'https://content.test/2',
    ...(paper ? { nativeFilePolicies: { paper } } : {}),
  });

/** True when every entry of each page was read before the next page was asked for. */
function donePageByPage(log: string[], pages: ReadonlyArray<ReadonlyArray<string>>): boolean {
  return pages.every((paths, i) => {
    const next = log.indexOf(`page ${i + 2}`);
    if (next === -1) return true;
    return paths.every((p) => {
      const read = log.indexOf(`read ${p}`);
      return read !== -1 && read < next;
    });
  });
}

describe('the folder walk', () => {
  it('is done with each page before it asks for the next', async () => {
    const log: string[] = [];
    const pages = [
      [entry(log, 'folder', '/A'), entry(log, 'file', '/A/one.txt')],
      [entry(log, 'file', '/A/two.txt'), entry(log, 'folder', '/B')],
      [entry(log, 'folder', '/B/C')],
    ];
    const folders = await source(paged(log, pages)).listFolders();

    expect(folders.map((f) => f.path)).toEqual(['', 'A', 'B', 'B/C']);
    expect(
      donePageByPage(log, [
        ['/A', '/A/one.txt'],
        ['/A/two.txt', '/B'],
      ]),
      log.join('\n'),
    ).toBe(true);
  });
});

describe('the bin read', () => {
  it('is done with each page before it asks for the next, though the live files come through it too', async () => {
    const log: string[] = [];
    const pages = [
      [entry(log, 'file', '/keep.txt'), entry(log, 'deleted', '/gone.txt')],
      [entry(log, 'folder', '/Old'), entry(log, 'deleted', '/Old/letter.pdf')],
      [entry(log, 'file', '/Old/kept.pdf')],
    ];
    const trashed = await source(paged(log, pages)).listTrashedPaths();

    expect([...trashed.paths].sort()).toEqual(['Old/letter.pdf', 'gone.txt']);
    expect(
      donePageByPage(log, [
        ['/keep.txt', '/gone.txt'],
        ['/Old', '/Old/letter.pdf'],
      ]),
      log.join('\n'),
    ).toBe(true);
  });

  it('answers as before across pages: a Paper doc under its exported name too, and the unnamed counted', async () => {
    const log: string[] = [];
    const pages = [
      [entry(log, 'deleted', '/Notes.paper')],
      [entry(log, 'deleted', '/nameless', { path_display: undefined }), entry(log, 'deleted', '/b.txt')],
    ];
    const trashed = await source(paged(log, pages), 'markdown').listTrashedPaths();

    expect([...trashed.paths].sort()).toEqual(['Notes.paper', 'Notes.paper.md', 'b.txt']);
    expect(trashed.unnameable).toBe(1);
  });

  it('still refuses a listing that never stops paging, rather than taking part of it as the whole', async () => {
    const endless: DropboxTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ entries: [], cursor: 'again', has_more: true }),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    });
    await expect(source(endless).listTrashedPaths()).rejects.toThrow(
      'did not stop paging after 1000 continues',
    );
    await expect(source(endless).listFolders()).rejects.toThrow('did not stop paging after 1000 continues');
  });
});
