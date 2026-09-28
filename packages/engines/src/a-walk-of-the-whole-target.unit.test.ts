// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WALK OF THE WHOLE TARGET (2026-09-28).
 *
 * Before its first write, the WebDAV writer listed everything under its root,
 * one PROPFIND per directory, one after another, so that it could tell a file
 * already on the target from one that is not. It did so on every pass, and
 * whatever the pass would touch. On a target that already holds an account's
 * worth of folders, that is the whole account listed before anything is
 * copied: the owner's Dropbox pass copied nothing for the first 40 of its 50
 * minutes.
 *
 * Now a directory is listed the first time something in it is asked about.
 * These hold that it answers as the walk did, and costs what the pass touches:
 *
 *  1. a write lists the directories it touches, and none of the others;
 *  2. a file the target holds is adopted, from its directory's listing;
 *  3. a directory where a file has to go is refused, as before;
 *  4. a directory this writer made is never listed: it is known to be empty;
 *  5. a directory is listed once, however many of its files are asked about
 *     at the same moment, and a file written there is in its listing after;
 *  6. a directory that cannot be listed falls back to the per-item check;
 *  7. a directory the server says was already there (405) is listed when
 *     asked about, never assumed empty.
 */

import { describe, expect, it } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient } from './webdav-target-writer.ts';
import type { Ledger, MappingId, RawFileItem, TenantId } from '@openmig/shared';

const TENANT = 'aa aa' as unknown as TenantId;
const MAPPING = 'bb bb' as unknown as MappingId;
const ROOT_PATH = '/remote.php/dav/files/alice/';
const ledger = { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger;

type Kind = 'dir' | 'file';
interface Asked {
  readonly method: string;
  readonly path: string;
  readonly depth?: string;
}

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * A DAV server holding `tree` (root-relative path -> kind), which writes down
 * every request. `unlistable` answers 403 to a Depth 1 listing; `unlisted` is
 * held but left out of its parent's listing, as a folder made a moment after
 * the listing was taken would be.
 */
function davServer(tree: Record<string, Kind>, { unlistable = [] as string[], unlisted = [] as string[] } = {}) {
  const held = new Map<string, Kind>([['', 'dir'], ...Object.entries(tree)]);
  const asked: Asked[] = [];
  const pathOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice(ROOT_PATH.length)).replace(/\/+$/, '');
  const entry = (path: string, kind: Kind) =>
    `<d:response><d:href>${ROOT_PATH}${path.split('/').map(encodeURIComponent).join('/')}${kind === 'dir' && path ? '/' : ''}</d:href>` +
    `<d:propstat><d:prop><d:resourcetype>${kind === 'dir' ? '<d:collection/>' : ''}</d:resourcetype></d:prop></d:propstat></d:response>`;
  const client = {
    async request(o: { method: string; url: string; headers?: Record<string, string> }) {
      const path = pathOf(o.url);
      asked.push({ method: o.method, path, ...(o.headers?.Depth !== undefined ? { depth: o.headers.Depth } : {}) });
      if (o.method === 'PROPFIND') {
        const kind = held.get(path);
        if (!kind) return { status: 404, body: '', headers: {} };
        if (o.headers?.Depth === '1' && unlistable.includes(path)) return { status: 403, body: '', headers: {} };
        let body = entry(path, kind);
        if (o.headers?.Depth === '1') {
          for (const [p, k] of held) {
            if (p !== '' && p !== path && parentOf(p) === path && !unlisted.includes(p)) body += entry(p, k);
          }
        }
        return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${body}</d:multistatus>`, headers: {} };
      }
      if (o.method === 'MKCOL') {
        if (held.has(path)) return { status: 405, body: '', headers: {} };
        held.set(path, 'dir');
        return { status: 201, body: '', headers: {} };
      }
      if (o.method === 'PUT') {
        if (held.has(path)) return { status: 412, body: '', headers: {} };
        held.set(path, 'file');
        return { status: 201, body: '', headers: { etag: '"written"' } };
      }
      return { status: 200, body: '', headers: {} };
    },
  } as unknown as HttpClient;
  return { client, asked };
}

const writerOn = (client: HttpClient) =>
  new WebDAVTargetWriter(
    { url: `https://dav.example${ROOT_PATH}`, username: 'alice', password: 'pw' },
    { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );

const BYTES = new TextEncoder().encode('the bytes the source holds');
const file = (path: string): RawFileItem =>
  ({
    item: { path, name: path, isDirectory: false, size: BYTES.byteLength, modifiedAt: '', sourceRef: '' },
    content: BYTES,
  }) as never;

/** Where the directories a pass lists were, in order. */
const listed = (asked: Asked[]) => asked.filter((a) => a.method === 'PROPFIND' && a.depth === '1').map((a) => a.path);
const puts = (asked: Asked[]) => asked.filter((a) => a.method === 'PUT').map((a) => a.path);

/** An account that already holds a great deal, beside the one folder a pass writes into. */
function aFullAccount(): Record<string, Kind> {
  const tree: Record<string, Kind> = { Work: 'dir', 'Work/Old.pdf': 'file', 'Work/Sub': 'dir', Photos: 'dir', Archive: 'dir' };
  for (let i = 0; i < 30; i++) tree[`Photos/${2000 + i}`] = 'dir';
  for (let i = 0; i < 20; i++) tree[`Archive/box-${i}`] = 'dir';
  return tree;
}

describe('what a write lists', () => {
  it('lists the directories it touches, and none of the others', async () => {
    const { client, asked } = davServer(aFullAccount());
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Work' });
    const result = await writer.upsertFile('Work', file('Work/Report.pdf'));

    expect(result.created).toBe(true);
    expect(listed(asked)).toEqual(['', 'Work']);
    // And nothing asked one path at a time: the listings answered it all.
    expect(asked.filter((a) => a.method === 'PROPFIND' && a.depth === '0')).toEqual([]);
  });

  it('adopts a file the target holds, from its directory listing', async () => {
    const { client, asked } = davServer(aFullAccount());
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Work' });
    const result = await writer.upsertFile('Work', file('Work/Old.pdf'));

    expect(result.adopted).toBe(true);
    expect(puts(asked)).toEqual([]);
  });

  it('refuses a file where the target holds a directory', async () => {
    const { client, asked } = davServer(aFullAccount());
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Work' });
    await expect(writer.upsertFile('Work', file('Work/Sub'))).rejects.toThrow(/already holds a DIRECTORY/);
    expect(puts(asked)).toEqual([]);
  });
});

describe('a directory this writer made', () => {
  it('is never listed: it is known to be empty', async () => {
    const { client, asked } = davServer(aFullAccount());
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'New/Deep' });
    const result = await writer.upsertFile('New/Deep', file('New/Deep/a.txt'));

    expect(result.created).toBe(true);
    expect(asked.filter((a) => a.method === 'MKCOL').map((a) => a.path)).toEqual(['New', 'New/Deep']);
    expect(listed(asked)).toEqual(['']);
  });

  it('is listed after all when the server says it was already there (405)', async () => {
    const { client, asked } = davServer({ Race: 'dir', 'Race/y.txt': 'file' }, { unlisted: ['Race'] });
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Race' });
    const result = await writer.upsertFile('Race', file('Race/y.txt'));

    expect(result.adopted).toBe(true);
    expect(listed(asked)).toEqual(['', 'Race']);
    expect(puts(asked)).toEqual([]);
  });
});

describe('one listing', () => {
  it('knows a file this writer has just written there', async () => {
    const { client, asked } = davServer(aFullAccount());
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Work' });
    await writer.upsertFile('Work', file('Work/Report.pdf'));
    const again = await writer.upsertFile('Work', file('Work/Report.pdf'));

    expect(again.adopted).toBe(true);
    expect(puts(asked)).toEqual(['Work/Report.pdf']);
  });

  it('serves every file of a directory asked about at the same moment', async () => {
    const { client, asked } = davServer(aFullAccount());
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Work' });
    await Promise.all([1, 2, 3, 4, 5].map((n) => writer.upsertFile('Work', file(`Work/new-${n}.txt`))));

    expect(listed(asked).filter((p) => p === 'Work')).toHaveLength(1);
    expect(puts(asked)).toHaveLength(5);
  });
});

describe('a directory that cannot be listed', () => {
  it('falls back to asking about each file', async () => {
    const { client, asked } = davServer({ Locked: 'dir' }, { unlistable: ['Locked'] });
    const writer = writerOn(client);

    await writer.ensureDirectory({ path: 'Locked' });
    const result = await writer.upsertFile('Locked', file('Locked/x.txt'));

    expect(result.created).toBe(true);
    expect(asked).toContainEqual({ method: 'PROPFIND', path: 'Locked/x.txt', depth: '0' });
  });
});
