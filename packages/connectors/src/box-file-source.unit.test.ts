// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
 */

import { describe, it, expect } from 'vitest';
import { BoxFileSource } from './box-file-source';
import { BoxTokenProvider } from './box-token-provider';
import type { BoxTransport } from './box-file-source.types';

const API = 'https://api.test/2.0';

type Page = { entries: unknown[]; next_marker?: string };

/** Pages per folder id; a folder's array is consumed one page per request. */
function fakeBox(pagesByFolder: Record<string, Page[]>, bytes?: Uint8Array) {
  const calls: string[] = [];
  const served: Record<string, number> = {};
  const transport: BoxTransport = async (url) => {
    calls.push(url);
    const respond = (payload: unknown, ok = true, status = 200) => ({
      ok,
      status,
      json: async () => payload,
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    });
    const itemsMatch = /\/folders\/([^/]+)\/items/.exec(url);
    if (itemsMatch) {
      const folderId = decodeURIComponent(itemsMatch[1]!);
      const queue = pagesByFolder[folderId] ?? [{ entries: [] }];
      const index = served[folderId] ?? 0;
      served[folderId] = index + 1;
      return respond(queue[Math.min(index, queue.length - 1)]);
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
    const { transport } = fakeBox({
      '0': [
        { entries: [FILE('f1', 'one.txt')], next_marker: 'm1' },
        { entries: [FILE('f2', 'two.txt')], next_marker: 'm2' },
        { entries: [FILE('f3', 'three.txt')] },
      ],
    });
    const source = new BoxFileSource(transport, { baseUrl: API });

    const { items } = await source.listSince({ path: '' });

    expect(items.map((i) => i.item.path)).toEqual(['one.txt', 'two.txt', 'three.txt']);
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
