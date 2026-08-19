// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The Dropbox source, against a fake transport (workplan 0055). What these
 * hold, in order of what it would cost a customer if wrong:
 *
 *  1. The natural key is the DISPLAY path relative to the configured root —
 *     the same tree lands the same way whichever root carried it.
 *  2. The listing never carries bytes; `fetch` addresses by Dropbox's own id
 *     (stable across renames) via the header-argument download endpoint.
 *  3. Pagination (`has_more`/continue) is followed to the end — a partial
 *     listing read as the folder would count every unread file as absent.
 *  4. `removed` is never populated; the tombstone read below is the bin
 *     (`trashed`-class) evidence instead.
 */

import { describe, it, expect } from 'vitest';
import { DropboxFileSource } from './dropbox-file-source.ts';
import type { DropboxTransport } from './dropbox-file-source.types.ts';

const API = 'https://api.test/2';
const CONTENT = 'https://content.test/2';

/**
 * Served BY CURSOR, not by call count — the continue endpoint is one URL, so
 * the cursor in the BODY is the only address there is.
 *
 * Workplans 0058 and 0059 both found connectors certified healthy by mocks
 * answering what no server could: one invented a response field, the other
 * returned page two for a repeat of the identical request. A call-counting
 * fake here would pass whether or not `listAll` fed each page's cursor into
 * the next continue — which is the entire mechanism. So a continue carrying
 * cursor `c1` gets page 1, and one that reuses a stale cursor gets the page it
 * asked for, looping exactly as the real API would.
 */
function fakeDropbox(pages: Record<string, unknown[]>, bytes?: Uint8Array) {
  const calls: Array<{ url: string; body?: string; headers: Record<string, string> }> = [];
  let sharingCount = 0;
  const transport: DropboxTransport = async (url, init) => {
    calls.push({ url, headers: { ...init.headers }, ...(init.body ? { body: init.body } : {}) });
    const respond = (payload: unknown) => ({
      ok: true,
      status: 200,
      json: async () => payload,
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    });
    if (url.includes('/files/download')) return respond({});
    if (url.includes('/sharing/list_folders/continue')) {
      const queue = pages['sharing'] ?? [];
      return respond(queue[++sharingCount] ?? { entries: [] });
    }
    if (url.includes('/sharing/list_folders')) {
      const queue = pages['sharing'] ?? [];
      return respond(queue[0] ?? { entries: [] });
    }
    if (url.includes('list_folder/continue')) {
      // `c1` → page 1 of the continue queue. A stale or missing cursor
      // therefore re-reads a page it has already had, which is a loop.
      const arg = JSON.parse(init.body ?? '{}') as { cursor?: string };
      const index = Number(String(arg.cursor ?? 'c1').replace(/^c/, '')) - 1;
      const queue = pages['continue'] ?? [];
      return respond(
        queue[Number.isNaN(index) ? 0 : index] ?? { entries: [], cursor: 'c', has_more: false },
      );
    }
    const arg = JSON.parse(init.body ?? '{}') as { path: string };
    const first = pages[arg.path] ?? [{ entries: [], cursor: 'c', has_more: false }];
    return respond(first[0]);
  };
  return { transport, calls };
}

const FILE = (path: string, over: Record<string, unknown> = {}) => ({
  '.tag': 'file',
  id: `id:${path}`,
  name: path.split('/').pop(),
  path_display: path,
  size: 42,
  server_modified: '2026-08-01T10:00:00Z',
  content_hash: `hash-${path}`,
  ...over,
});

describe('the natural key', () => {
  it('is the display path RELATIVE to the configured root', async () => {
    const { transport } = fakeDropbox({
      '/Team/Docs': [
        { entries: [FILE('/Team/Docs/plan.pdf')], cursor: 'c', has_more: false },
      ],
    });
    const source = new DropboxFileSource(transport, {
      apiBaseUrl: API,
      contentBaseUrl: CONTENT,
      rootPath: 'Team', // normalised to '/Team'
    });

    const { items } = await source.listSince({ path: 'Docs' });

    expect(items).toHaveLength(1);
    expect(items[0]!.item.path).toBe('Docs/plan.pdf');
    expect(items[0]!.item.contentHash).toBe('hash-/Team/Docs/plan.pdf');
    expect(items[0]!.item.sourceRef).toBe('id:/Team/Docs/plan.pdf');
    expect(items[0]!.content, 'the listing must not carry bytes').toBeUndefined();
  });

  it('listKeys answers from the same listing listSince just made — consume once', async () => {
    const { transport, calls } = fakeDropbox({
      '': [{ entries: [FILE('/a.txt')], cursor: 'c', has_more: false }],
    });
    const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });

    await source.listSince({ path: '' });
    const listCallsBefore = calls.length;
    expect(await source.listKeys({ path: '' })).toEqual(['a.txt']);
    expect(calls.length, 'the memo answered — no second listing').toBe(listCallsBefore);
  });
});

describe('pagination', () => {
  it('follows has_more to the end — a partial listing is never the folder', async () => {
    const { transport, calls } = fakeDropbox({
      '': [{ entries: [FILE('/one.txt')], cursor: 'c1', has_more: true }],
      continue: [
        { entries: [FILE('/two.txt')], cursor: 'c2', has_more: true },
        { entries: [FILE('/three.txt')], cursor: 'c3', has_more: false },
      ],
    });
    const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });

    const { items } = await source.listSince({ path: '' });

    expect(items.map((i) => i.item.path)).toEqual(['one.txt', 'two.txt', 'three.txt']);
    // Each continue must carry the cursor the PREVIOUS page answered. The fake
    // serves by it, so reusing a stale one would re-read a page forever —
    // asserted because a call-counting fake passes either way (0058/0059).
    expect(JSON.parse(calls[1]!.body!).cursor).toBe('c1');
    expect(JSON.parse(calls[2]!.body!).cursor).toBe('c2');
  });
});

describe('listFolders', () => {
  it('walks ONE recursive listing and keeps only folders, root included', async () => {
    const { transport, calls } = fakeDropbox({
      '': [
        {
          entries: [
            { '.tag': 'folder', id: 'id:d', name: 'Docs', path_display: '/Docs' },
            FILE('/Docs/x.txt'),
            { '.tag': 'folder', id: 'id:d2', name: 'Old', path_display: '/Docs/Old' },
          ],
          cursor: 'c',
          has_more: false,
        },
      ],
    });
    const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });

    const folders = await source.listFolders();

    expect(folders.map((f) => f.path)).toEqual(['', 'Docs', 'Docs/Old']);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ recursive: true });
  });
});

describe('fetch', () => {
  it("downloads by Dropbox's own id, in the header argument the endpoint demands", async () => {
    const bytes = new TextEncoder().encode('file bytes');
    const { transport, calls } = fakeDropbox({}, bytes);
    const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });

    const raw = await source.fetch({
      path: 'Docs/plan.pdf',
      isDirectory: false,
      size: 10,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'id:abc123',
    });

    expect(new TextDecoder().decode(raw.content!)).toBe('file bytes');
    const call = calls[0]!;
    expect(call.url).toBe(`${CONTENT}/files/download`);
    expect(JSON.parse(call.headers['Dropbox-API-Arg']!)).toEqual({ path: 'id:abc123' });
  });

  it('refuses an item with no recorded id instead of guessing by path', async () => {
    const { transport } = fakeDropbox({});
    const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });

    await expect(
      source.fetch({
        path: 'x.txt',
        isDirectory: false,
        size: 1,
        modifiedAt: '2026-08-01T10:00:00Z',
        sourceRef: '',
      }),
    ).rejects.toThrow(/No Dropbox file id/);
  });
});

describe('listTrashedPaths — the tombstones (deletion evidence follow-up)', () => {
  it('asks WITH include_deleted and returns only tombstones, root-relative', async () => {
    const { transport, calls } = fakeDropbox({
      '/Team': [
        {
          entries: [
            FILE('/Team/kept.txt'),
            { '.tag': 'deleted', name: 'gone.txt', path_display: '/Team/Docs/gone.txt' },
            { '.tag': 'deleted', name: 'Old', path_display: '/Team/Old' },
          ],
          cursor: 'c',
          has_more: false,
        },
      ],
    });
    const source = new DropboxFileSource(transport, {
      apiBaseUrl: API,
      contentBaseUrl: CONTENT,
      rootPath: '/Team',
    });

    const trashed = (await source.listTrashedPaths()).paths;

    expect(trashed).toEqual(['Docs/gone.txt', 'Old']);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ include_deleted: true, recursive: true });
  });

  it('the ordinary listing still never asks for tombstones', async () => {
    const { transport, calls } = fakeDropbox({
      '': [{ entries: [], cursor: 'c', has_more: false }],
    });
    await new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT }).listSince({
      path: '',
    });

    expect(JSON.parse(calls[0]!.body!).include_deleted).toBeUndefined();
  });
});

describe('listSharedFolders — the browse behind rootPath (0049/0051, Dropbox turn)', () => {
  it('pages to the end; only a MOUNTED folder carries the path that goes in rootPath', async () => {
    const { transport, calls } = fakeDropbox({
      sharing: [
        {
          entries: [{ shared_folder_id: '11', name: 'Team Docs', path_lower: '/team docs' }],
          cursor: 'more',
        },
        {
          entries: [{ shared_folder_id: '22', name: 'Unmounted' }],
        },
      ],
    });
    const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });

    const folders = await source.listSharedFolders();

    expect(folders).toEqual([
      { id: '11', name: 'Team Docs', path: '/team docs' },
      { id: '22', name: 'Unmounted' },
    ]);
    expect(calls[1]!.url).toBe(`${API}/sharing/list_folders/continue`);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ cursor: 'more' });
  });
});
