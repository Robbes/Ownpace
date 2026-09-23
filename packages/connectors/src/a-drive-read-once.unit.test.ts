// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DRIVE READ ONCE, NOT ONCE PER FOLDER (2026-09-22).
 *
 * The owner's first Microsoft preflight was still counting Files an hour in —
 * the worker's limit for one attempt — and started over from the top. The
 * OneDrive listing walked the drive a request per folder, one after another,
 * and then asked Graph again for every folder's own delta: at least two
 * requests per folder, in series, before a single file was counted.
 *
 * Microsoft's delta on the drive's root *"starts enumerating the drive's
 * hierarchy"*: every folder and every file, with the id of the parent each
 * lives in, a page at a time. So a pass now reads that once, and every folder
 * is answered from it. A later pass reads the drive's CHANGE FEED once, and
 * every folder is answered from that.
 *
 * The fake counts what it is asked, because the count is the claim. It keeps a
 * change log so a later pass sees what Graph would show it: the items changed
 * since the link it holds, the deleted ones marked deleted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphDriveSource } from './graph-drive-source.ts';
import type { OAuth2Token, SyncCursor, TokenProvider } from '@openmig/shared';
import { setLogLevel, resetLogLevel } from '@openmig/shared';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const ROOT = 'root-id';

interface Entry {
  readonly id: string;
  name: string;
  parent?: string;
  readonly folder?: true;
  size?: number;
  deleted?: true;
  /** The clock tick of the entry's last change. */
  at: number;
}

/**
 * A OneDrive: the same tree as the placement tests, a change log, and a page
 * size small enough that the one read spans several pages.
 */
function aOneDrive(options: { root?: boolean; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 4;
  let clock = 1;
  const entries = new Map<string, Entry>();
  const put = (e: Omit<Entry, 'at'>) => entries.set(e.id, { ...e, at: clock });
  if (options.root !== false) put({ id: ROOT, name: 'root', folder: true });
  put({ id: 'f-top', name: 'top.txt', parent: ROOT, size: 10 });
  put({ id: 'd-photos', name: 'Photos', parent: ROOT, folder: true });
  put({ id: 'f-a', name: 'a.jpg', parent: 'd-photos', size: 100 });
  put({ id: 'd-2019', name: '2019', parent: 'd-photos', folder: true });
  put({ id: 'f-b', name: 'b.jpg', parent: 'd-2019', size: 1000 });
  put({ id: 'd-archive', name: 'Archive', parent: ROOT, folder: true });
  put({ id: 'd-2018', name: '2018', parent: 'd-archive', folder: true });
  put({ id: 'f-c', name: 'c.jpg', parent: 'd-2018', size: 5000 });

  const requests: string[] = [];
  const pathOf = (id: string): string =>
    id === ROOT ? '' : `${pathOf(entries.get(id)!.parent!)}/${entries.get(id)!.name}`;
  const asItem = (e: Entry, withPath = false) =>
    e.deleted
      ? { id: e.id, deleted: {} }
      : {
          id: e.id,
          name: e.name,
          size: e.size ?? 0,
          lastModifiedDateTime: `2026-09-22T00:00:0${Math.min(e.at, 9)}Z`,
          ...(e.folder ? { folder: { childCount: 0 } } : { file: { mimeType: 'image/jpeg' } }),
          ...(e.id === ROOT
            ? { root: {} }
            : {
                parentReference: {
                  id: e.parent,
                  ...(withPath ? { path: `/drive/root:${pathOf(e.parent!)}` } : {}),
                },
              }),
        };
  const respond = (body: unknown) => ({
    status: 200,
    text: async () => JSON.stringify(body),
    headers: new Map(),
  });
  const paged = (items: unknown[], page: number, again: (n: number) => string, token: string) => {
    const slice = items.slice((page - 1) * pageSize, page * pageSize);
    const more = page * pageSize < items.length;
    return respond({
      value: slice,
      ...(more ? { '@odata.nextLink': again(page + 1) } : { '@odata.deltaLink': token }),
    });
  };

  const fetchImpl = vi.fn(async (url: string) => {
    requests.push(url);
    const u = new URL(url);
    // The change feed: what changed after the token, deleted ones marked so.
    // Checked first: its link has the same path as the full read.
    if (u.searchParams.has('token')) {
      const since = Number(u.searchParams.get('token'));
      const changed = [...entries.values()].filter((e) => e.at > since);
      return respond({
        value: changed.map((e) => asItem(e)),
        '@odata.deltaLink': `${GRAPH}/drive/root/delta?token=${clock}`,
      });
    }
    // The drive's root delta: every live entry, in pages.
    if (u.pathname.endsWith('/me/drive/root/delta')) {
      const page = Number(u.searchParams.get('page') ?? '1');
      const live = [...entries.values()].filter((e) => !e.deleted);
      return paged(
        live.map((e) => asItem(e)),
        page,
        (n) => `${GRAPH}/drive/root/delta?page=${n}`,
        `${GRAPH}/drive/root/delta?token=${clock}`,
      );
    }
    // A folder's own delta, as a cursor from before 2026-09-22 still asks.
    const folderDelta = /\/me\/drive\/root:(.+):\/delta$/.exec(decodeURIComponent(u.pathname));
    if (folderDelta) {
      const folderId = [...entries.values()].find((e) => e.folder && pathOf(e.id) === folderDelta[1])!.id;
      const within = (e: Entry): boolean =>
        e.id === folderId || (e.parent !== undefined && within(entries.get(e.parent)!));
      return respond({
        value: [...entries.values()].filter((e) => !e.deleted && within(e)).map((e) => asItem(e)),
        '@odata.deltaLink': `${GRAPH}/drive/root:${folderDelta[1]}:/delta?folder=done`,
      });
    }
    // `children`, which only the walk asks for.
    const children = /\/me\/drive\/(?:root|items\/([^/]+))\/children$/.exec(u.pathname);
    if (children) {
      const parent = children[1] ?? ROOT;
      return respond({
        value: [...entries.values()]
          .filter((e) => !e.deleted && e.parent === parent)
          .map((e) => ({ ...asItem(e, true), parentReference: { id: parent, path: `/drive/root:${pathOf(parent)}` } })),
      });
    }
    throw new Error(`the fake Graph does not serve ${url}`);
  });

  return {
    fetchImpl,
    requests,
    /** A change, stamped with the next tick. */
    change(id: string, to: Partial<Omit<Entry, 'id' | 'at'>>) {
      clock += 1;
      const e = entries.get(id);
      if (e) entries.set(id, { ...e, ...to, at: clock });
      else entries.set(id, { id, name: to.name ?? id, ...to, at: clock } as Entry);
    },
  };
}

const tokens: TokenProvider = {
  getToken: async () =>
    ({ accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() / 1000 + 3600 }) as OAuth2Token,
  refresh: vi.fn(),
  isTokenValid: () => true,
  getTokenStatus: vi.fn(),
} as unknown as TokenProvider;

function sourceOver(drive: ReturnType<typeof aOneDrive>): GraphDriveSource {
  global.fetch = drive.fetchImpl as unknown as typeof fetch;
  return new GraphDriveSource({ tokenProvider: tokens, tenantId: 't' });
}

/** One pass: walk, then list every folder with the cursor it held, if any. */
async function aPass(source: GraphDriveSource, cursors: Map<string, SyncCursor>) {
  const out = new Map<string, { paths: string[]; removed?: ReadonlyArray<string> }>();
  for (const folder of await source.listFolders()) {
    const listing = await source.listSince(folder, cursors.get(folder.path));
    cursors.set(folder.path, listing.nextCursor);
    out.set(folder.path, {
      paths: listing.items.map((i) => i.item.path),
      ...(listing.removed ? { removed: listing.removed } : {}),
    });
  }
  return out;
}

beforeEach(() => setLogLevel('error'));
afterEach(() => {
  resetLogLevel();
  vi.restoreAllMocks();
});

describe('a first pass', () => {
  it('asks Graph for the whole drive once, in pages — not once per folder', async () => {
    const drive = aOneDrive({ pageSize: 4 });
    const listed = await aPass(sourceOver(drive), new Map());

    // Nine entries at four a page: three pages of ONE read. The walk asked
    // for five `children` listings and then five folder deltas.
    expect(drive.requests).toHaveLength(3);
    expect(drive.requests.every((url) => url.includes('/me/drive/root/delta'))).toBe(true);
    expect(Object.fromEntries([...listed].map(([folder, l]) => [folder, l.paths]))).toEqual({
      '': ['/top.txt'],
      '/Archive': [],
      '/Archive/2018': ['/Archive/2018/c.jpg'],
      '/Photos': ['/Photos/a.jpg'],
      '/Photos/2019': ['/Photos/2019/b.jpg'],
    });
  });
});

describe('a later pass', () => {
  it('reads the drive\'s change feed once, and answers every folder from it', async () => {
    const drive = aOneDrive();
    const source = sourceOver(drive);
    const cursors = new Map<string, SyncCursor>();
    await aPass(source, cursors);

    drive.change('f-b', { size: 2000 }); // edited
    drive.change('f-n', { name: 'n.jpg', parent: 'd-photos', size: 7 }); // added
    drive.change('f-c', { deleted: true }); // deleted
    drive.requests.length = 0;

    const second = await aPass(source, cursors);

    // One read of the drive (listFolders) and ONE read of the feed, however
    // many folders held a cursor.
    const feedReads = drive.requests.filter((url) => url.includes('?token='));
    expect(feedReads).toHaveLength(1);
    expect(second.get('/Photos')!.paths).toEqual(['/Photos/n.jpg']);
    expect(second.get('/Photos/2019')!.paths).toEqual(['/Photos/2019/b.jpg']);
    expect(second.get('/Archive/2018')!.paths).toEqual([]);
    // Each removal reported once, by the root, not once per folder.
    expect(second.get('')!.removed).toEqual(['f-c']);
    expect([...second.values()].filter((l) => l.removed !== undefined)).toHaveLength(1);
  });

  it('answers a folder that is new since the last pass from this pass\'s read', async () => {
    const drive = aOneDrive();
    const source = sourceOver(drive);
    const cursors = new Map<string, SyncCursor>();
    await aPass(source, cursors);

    drive.change('d-new', { name: 'New', parent: ROOT, folder: true } as Partial<Entry>);
    drive.change('f-x', { name: 'x.txt', parent: 'd-new', size: 1 });
    const second = await aPass(source, cursors);

    expect(second.get('/New')!.paths).toEqual(['/New/x.txt']);
  });
});

describe('an item the read returns twice', () => {
  it('is taken as its LAST occurrence, as Microsoft says to', async () => {
    // *"The same item may appear more than once in a delta feed, for various
    // reasons. You should use the last occurrence you see."* Here it was
    // renamed while the pages were being read.
    const pages = [
      {
        value: [
          { id: ROOT, name: 'root', root: {}, folder: { childCount: 1 } },
          { id: 'f-1', name: 'old.txt', parentReference: { id: ROOT }, file: {}, size: 1,
            lastModifiedDateTime: '2026-09-22T00:00:01Z' },
        ],
        '@odata.nextLink': `${GRAPH}/drive/root/delta?page=2`,
      },
      {
        value: [
          { id: 'f-1', name: 'new.txt', parentReference: { id: ROOT }, file: {}, size: 1,
            lastModifiedDateTime: '2026-09-22T00:00:02Z' },
        ],
        '@odata.deltaLink': `${GRAPH}/drive/root/delta?token=2`,
      },
    ];
    global.fetch = vi.fn(async (url: string) => ({
      status: 200,
      text: async () => JSON.stringify(url.includes('page=2') ? pages[1] : pages[0]),
      headers: new Map(),
    })) as unknown as typeof fetch;
    const source = new GraphDriveSource({ tokenProvider: tokens, tenantId: 't' });

    await source.listFolders();
    const root = await source.listSince({ path: '' });

    expect(root.items.map((i) => i.item.path)).toEqual(['/new.txt']);
  });
});

describe('what came before', () => {
  it('still honours a cursor on one folder\'s own delta, once, then moves it to the feed', async () => {
    const drive = aOneDrive();
    const source = sourceOver(drive);
    await source.listFolders();
    drive.requests.length = 0;

    const legacy: SyncCursor = {
      value: `graph-drive-delta:/Photos:${GRAPH}/drive/root:/Photos:/delta`,
    };
    const listing = await source.listSince({ path: '/Photos', name: 'Photos' }, legacy);

    expect(drive.requests).toEqual([`${GRAPH}/drive/root:/Photos:/delta`]);
    expect(listing.items.map((i) => i.item.path)).toEqual(['/Photos/a.jpg']);
    expect(listing.nextCursor.value.startsWith('graph-drive-feed:')).toBe(true);
  });

  it('walks a drive whose read names no root, as it always did', async () => {
    // Undocumented, and so not trusted to be impossible: without the root
    // there is nothing to build the tree under, and the walk is what worked.
    const drive = aOneDrive({ root: false });
    const folders = await sourceOver(drive).listFolders();

    expect(folders.map((f) => f.path)).toEqual(['', '/Photos', '/Photos/2019', '/Archive', '/Archive/2018']);
    expect(drive.requests.some((url) => url.endsWith('/children'))).toBe(true);
  });
});
