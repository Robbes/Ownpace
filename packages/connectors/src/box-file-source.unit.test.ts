// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Box source, against a fake transport (workplan 0056). What these hold,
 * in order of what it would cost a customer if wrong:
 *
 *  1. The natural key is the DERIVED path relative to the configured root
 *     folder — a Box item has no path of its own, so the derivation IS the
 *     key's foundation.
 *  2. The listing never carries bytes; `fetch` addresses by Box's own id
 *     (stable across renames) and follows the content endpoint's redirect.
 *  3. Marker pagination is followed to the end — a partial listing read as
 *     the folder would count every unread file as absent.
 *  4. Web links are pointers, not files — never enumerated as items.
 *  5. The bin read recovers the path an item HAD, from the ancestor chain the
 *     listing already carried — `trashed`-class evidence, which is what lets a
 *     Box deletion be applied instead of only reported. A bin that answered
 *     entries but no usable paths is NOT reported as an empty bin.
 */

import { describe, it, expect } from 'vitest';
import { BoxFileSource } from './box-file-source.ts';
import { BoxTokenProvider } from './box-token-provider.ts';
import type { BoxTransport } from './box-file-source.types.ts';

const API = 'https://api.test/2.0';

type Page = { entries: unknown[]; next_marker?: string };

/**
 * Pages per folder id, served BY MARKER — like Box does, and unlike a fake
 * that counts calls.
 *
 * Workplans 0058 and 0059 both turned up connectors certified healthy by mocks
 * answering something no server could answer: one invented a response field,
 * the other handed back page two for a repeat of the identical request. A
 * call-counting fake here would pass whether or not `listChildren` actually
 * sent `marker`, which is the only thing making its pagination work. So the
 * marker is the address: no marker means page 0, `?marker=m1` means page 1,
 * and a request that forgets it gets page 0 again — which loops, exactly as
 * the real API would.
 */
function fakeBox(pagesByFolder: Record<string, Page[]>, bytes?: Uint8Array) {
  const calls: string[] = [];
  const transport: BoxTransport = async (url) => {
    calls.push(url);
    const respond = (payload: unknown, ok = true, status = 200) => ({
      ok,
      status,
      json: async () => payload,
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    });
    /** `m3` → page 3; absent → page 0. The fake's whole addressing scheme. */
    const pageOf = (queue: Page[]): unknown => {
      const marker = /[?&]marker=([^&]*)/.exec(url)?.[1];
      const index = marker ? Number(decodeURIComponent(marker).replace(/^m/, '')) : 0;
      return queue[Math.min(Number.isNaN(index) ? 0 : index, queue.length - 1)];
    };
    if (url.includes('/folders/trash/items')) {
      return respond(pageOf(pagesByFolder['trash'] ?? [{ entries: [] }]));
    }
    const itemsMatch = /\/folders\/([^/]+)\/items/.exec(url);
    if (itemsMatch) {
      const folderId = decodeURIComponent(itemsMatch[1]!);
      return respond(pageOf(pagesByFolder[folderId] ?? [{ entries: [] }]));
    }
    if (url.includes('/content')) return respond({});
    return respond({ message: `unrouted: ${url}` }, false, 404);
  };
  return { transport, calls };
}

const FILE = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  type: 'file',
  id,
  name,
  size: 42,
  sha1: `sha-${id}`,
  modified_at: '2026-08-01T10:00:00Z',
  ...over,
});
const FOLDER = (id: string, name: string) => ({ type: 'folder', id, name });

describe('the natural key', () => {
  it('is the DERIVED path relative to the configured root folder', async () => {
    const { transport } = fakeBox({
      root9: [{ entries: [FOLDER('d1', 'Docs')] }],
      d1: [{ entries: [FILE('f1', 'plan.pdf')] }],
    });
    const source = new BoxFileSource(transport, { baseUrl: API, rootFolderId: 'root9' });

    const { items } = await source.listSince({ path: 'Docs' });

    expect(items).toHaveLength(1);
    expect(items[0]!.item.path).toBe('Docs/plan.pdf');
    expect(items[0]!.item.contentHash).toBe('sha-f1');
    expect(items[0]!.item.sourceRef).toBe('f1');
    expect(items[0]!.content, 'the listing must not carry bytes').toBeUndefined();
  });

  it('listKeys answers from the same listing listSince just made — consume once', async () => {
    const { transport, calls } = fakeBox({
      '0': [{ entries: [FILE('f1', 'a.txt')] }],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    await source.listSince({ path: '' });
    const before = calls.length;
    expect(await source.listKeys({ path: '' })).toEqual(['a.txt']);
    expect(calls.length, 'the memo answered — no second listing').toBe(before);
  });

  it('refuses a path whose folder does not exist, by name', async () => {
    const { transport } = fakeBox({ '0': [{ entries: [] }] });
    const source = new BoxFileSource(transport, { baseUrl: API });

    await expect(source.listSince({ path: 'Missing' })).rejects.toThrow(/No folder "Missing"/);
  });
});

describe('pagination', () => {
  it('follows next_marker to the end — a partial listing is never the folder', async () => {
    const { transport, calls } = fakeBox({
      '0': [
        { entries: [FILE('f1', 'one.txt')], next_marker: 'm1' },
        { entries: [FILE('f2', 'two.txt')], next_marker: 'm2' },
        { entries: [FILE('f3', 'three.txt')] },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    const { items } = await source.listSince({ path: '' });

    expect(items.map((i) => i.item.path)).toEqual(['one.txt', 'two.txt', 'three.txt']);
    // The marker is what advances the listing, and the fake serves BY it — so a
    // request that forgot to carry it would read page one again and never
    // terminate, exactly as against the real API. Asserted because a
    // call-counting fake would have passed either way (workplans 0058/0059).
    expect(calls[1]).toContain('marker=m1');
    expect(calls[2]).toContain('marker=m2');
  });
});

describe('listFolders', () => {
  it('walks depth-first and derives root-relative paths, root included', async () => {
    const { transport } = fakeBox({
      '0': [{ entries: [FOLDER('d1', 'Docs')] }],
      d1: [{ entries: [FOLDER('d2', 'Old')] }],
      d2: [{ entries: [] }],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    const folders = await source.listFolders();

    expect(folders.map((f) => f.path)).toEqual(['', 'Docs', 'Docs/Old']);
  });
});

describe('what is not a file', () => {
  it('web links are pointers, not files — never enumerated as items', async () => {
    const { transport } = fakeBox({
      '0': [
        {
          entries: [
            FILE('f1', 'real.txt'),
            { type: 'web_link', id: 'w1', name: 'bookmark' },
            FOLDER('d1', 'Docs'),
          ],
        },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    const { items } = await source.listSince({ path: '' });

    expect(items.map((i) => i.item.path)).toEqual(['real.txt']);
  });
});

describe('fetch', () => {
  it("downloads by Box's own id from the content endpoint", async () => {
    const bytes = new TextEncoder().encode('file bytes');
    const { transport, calls } = fakeBox({}, bytes);
    const source = new BoxFileSource(transport, { baseUrl: API });

    const raw = await source.fetch({
      path: 'Docs/plan.pdf',
      isDirectory: false,
      size: 10,
      modifiedAt: '2026-08-01T10:00:00Z',
      sourceRef: 'f42',
    });

    expect(new TextDecoder().decode(raw.content!)).toBe('file bytes');
    expect(calls[0]).toBe(`${API}/files/f42/content`);
  });

  it('refuses an item with no recorded id instead of guessing by path', async () => {
    const { transport } = fakeBox({});
    const source = new BoxFileSource(transport, { baseUrl: API });

    await expect(
      source.fetch({
        path: 'x.txt',
        isDirectory: false,
        size: 1,
        modifiedAt: '2026-08-01T10:00:00Z',
        sourceRef: '',
      }),
    ).rejects.toThrow(/No Box file id/);
  });
});

describe('listTrashedPaths — the bin read (trashed-class deletion evidence)', () => {
  const TRASHED = (name: string, chain: Array<{ id: string; name: string }>) => ({
    type: 'file',
    id: `t:${name}`,
    name,
    path_collection: { total_count: chain.length, entries: chain },
  });

  it('recovers the ORIGINAL root-relative path from the ancestor chain', async () => {
    const { transport, calls } = fakeBox({
      trash: [
        {
          entries: [
            TRASHED('gone.txt', [
              { id: '0', name: 'All Files' },
              { id: 'd1', name: 'Docs' },
            ]),
            TRASHED('top.txt', [{ id: '0', name: 'All Files' }]),
          ],
        },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    expect((await source.listTrashedPaths()).paths).toEqual(['Docs/gone.txt', 'top.txt']);
    // The chain is only asked for HERE — the ordinary listing never needs it.
    expect(calls[0]).toContain('path_collection');
  });

  it('is relative to the CONFIGURED root, and skips what was never under it', async () => {
    const { transport } = fakeBox({
      trash: [
        {
          entries: [
            TRASHED('mine.txt', [
              { id: '0', name: 'All Files' },
              { id: 'root9', name: 'Team' },
              { id: 'd2', name: 'Old' },
            ]),
            // Lives elsewhere in the account: not this migration's business.
            TRASHED('theirs.txt', [
              { id: '0', name: 'All Files' },
              { id: 'other', name: 'Elsewhere' },
            ]),
          ],
        },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API, rootFolderId: 'root9' });

    expect((await source.listTrashedPaths()).paths).toEqual(['Old/mine.txt']);
  });

  it('follows next_marker — a partial bin is never the bin', async () => {
    const { transport } = fakeBox({
      trash: [
        { entries: [TRASHED('one.txt', [{ id: '0', name: 'All Files' }])], next_marker: 'm1' },
        { entries: [TRASHED('two.txt', [{ id: '0', name: 'All Files' }])] },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    expect((await source.listTrashedPaths()).paths).toEqual(['one.txt', 'two.txt']);
  });

  it('an EMPTY bin is empty — nothing found, nothing unnameable', async () => {
    const { transport } = fakeBox({ trash: [{ entries: [] }] });

    expect(await new BoxFileSource(transport, { baseUrl: API }).listTrashedPaths()).toEqual({
      paths: [],
      unnameable: 0,
    });
  });

  it('out of scope is NOT counted — it was never in the migration', async () => {
    // A chain that never passes the configured root is arithmetic, not a blind
    // spot: nothing was copied, so no target copy exists to reconcile. Counting
    // it would cry wolf on every pass of every scoped migration.
    const { transport } = fakeBox({
      trash: [
        {
          entries: [
            TRASHED('elsewhere.txt', [
              { id: '0', name: 'All Files' },
              { id: 'other', name: 'Elsewhere' },
            ]),
          ],
        },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API, rootFolderId: 'root9' });

    expect(await source.listTrashedPaths()).toEqual({ paths: [], unnameable: 0 });
  });

  it('COUNTS an entry Box gave no chain for, and says why', async () => {
    // This one may well have been in scope, and nothing else will account for
    // it — the deletion degrades to `inferred`, which gate 3 will not apply.
    const { transport } = fakeBox({
      trash: [
        {
          entries: [
            { type: 'file', id: 'x', name: 'orphan.txt' },
            TRASHED('kept.txt', [{ id: '0', name: 'All Files' }]),
          ],
        },
      ],
    });

    const listing = await new BoxFileSource(transport, { baseUrl: API }).listTrashedPaths();

    expect(listing.paths, 'one unnameable entry must not silence the bin').toEqual(['kept.txt']);
    expect(listing.unnameable).toBe(1);
    expect(listing.reason).toMatch(/path_collection/);
  });

  it('a bin where NOTHING could be named still reports the count, never an empty bin', async () => {
    // What a Box answering path_collection with the Trash pseudo-folder would
    // look like, if it also dropped the chain: failing to read a bin is not the
    // same as there being none, and the count is what says so.
    const { transport } = fakeBox({
      trash: [{ entries: [{ type: 'file', id: 'x', name: 'gone.txt' }] }],
    });

    const listing = await new BoxFileSource(transport, { baseUrl: API }).listTrashedPaths();

    expect(listing.paths).toEqual([]);
    expect(listing.unnameable).toBe(1);
    expect(listing.reason).toBeTruthy();
  });
});

describe('the token provider — the Client Credentials Grant', () => {
  const ccgFetch = (status: number, payload: unknown) => {
    const bodies: string[] = [];
    const fetchImpl = async (_url: string, init: { body?: string }) => {
      bodies.push(init.body ?? '');
      return {
        ok: status < 400,
        status,
        text: async () => JSON.stringify(payload),
      };
    };
    return { bodies, fetchImpl };
  };

  it('asks for ONE subject: box_subject_type=user + the numeric id', async () => {
    const { bodies, fetchImpl } = ccgFetch(200, { access_token: 't', expires_in: 3600 });
    const provider = new BoxTokenProvider(
      { clientId: 'id', clientSecret: 'secret', subjectUserId: '12345' },
      { fetchImpl },
    );

    const token = await provider.getToken();

    expect(token.accessToken).toBe('t');
    const params = new URLSearchParams(bodies[0]!);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('box_subject_type')).toBe('user');
    expect(params.get('box_subject_id')).toBe('12345');
  });

  it("names the Admin Console on unauthorized_client — Box's own error does not", async () => {
    const { fetchImpl } = ccgFetch(400, { error: 'unauthorized_client' });
    const provider = new BoxTokenProvider(
      { clientId: 'id', clientSecret: 'secret', subjectUserId: '12345' },
      { fetchImpl },
    );

    await expect(provider.getToken()).rejects.toThrow(/Admin Console/);
  });

  it('refuses to construct without a subject — a token without one reads nobody', () => {
    expect(
      () => new BoxTokenProvider({ clientId: 'id', clientSecret: 'secret', subjectUserId: '' }),
    ).toThrow(/subjectUserId/);
  });
});
