// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELTA THAT DID NOT SAY WHERE, AND A FILE LISTED ONCE PER FOLDER ABOVE IT
 * (2026-09-22, the owner's first live Microsoft → Nextcloud preflight).
 *
 * Two faults in one listing, found reading why that preflight sat on "Still
 * counting: Files" long after the connection Test had measured the drive.
 *
 * 1. THE DELTA LEAVES THE PATH OUT. Microsoft's documentation of
 *    `driveItem: delta`: *"The parentReference property on items won't include
 *    a value for path … When using delta you should always track items by
 *    id."* This connector built every file's key from exactly that path, and
 *    skipped a file without one with a log line — not on the preflight, not
 *    copied, on no screen. On a drive answering as documented, that is every
 *    file in it.
 *
 * 2. A FOLDER'S DELTA IS ITS SUBTREE. *"The service starts enumerating the
 *    drive's hierarchy"*, and `listFolders` returns every folder, root
 *    included — so a file three folders deep was listed four times, by the
 *    root and by each folder above it. The ledger's key kept the copy single;
 *    the preflight summed all four into the number the owner approves, and the
 *    pass paid for each of them.
 *
 * SINCE THE SAME DAY THE DRIVE IS READ ONCE PER PASS (`GraphDriveSource`'s
 * `driveRead`): `listFolders` reads the root's delta, and each folder's first
 * listing is answered from it. The placement rules pinned here are the same
 * rules, applied to that one read; `a-drive-read-once.unit.test.ts` pins the
 * reading itself.
 *
 * THE FAKE BELOW ANSWERS THE WAY THAT DOCUMENTATION SAYS GRAPH DOES. The
 * fixtures that stayed green over fault 1 put `parentReference.path` on delta
 * entries and no parent id at all — the reverse of the documented shape, and
 * the same kind of invented field workplan 0058 already had to take out once.
 * Here the walk (`children`) reports ids and paths, and a delta reports ids.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphDriveSource } from './graph-drive-source.ts';
import type { OAuth2Token, TokenProvider } from '@openmig/shared';
import { setLogLevel, resetLogLevel } from '@openmig/shared';

const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const ROOT = 'root-id';

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly parent?: string;
  readonly folder?: true;
  readonly size?: number;
}

/**
 * A drive with a file at the root, a file one and two levels down, and a
 * folder holding only a subfolder — the shape of most people's Pictures.
 */
function aDrive(): Entry[] {
  return [
    { id: ROOT, name: 'root', folder: true },
    { id: 'f-top', name: 'top.txt', parent: ROOT, size: 10 },
    { id: 'd-photos', name: 'Photos', parent: ROOT, folder: true },
    { id: 'f-a', name: 'a.jpg', parent: 'd-photos', size: 100 },
    { id: 'd-2019', name: '2019', parent: 'd-photos', folder: true },
    { id: 'f-b', name: 'b.jpg', parent: 'd-2019', size: 1000 },
    { id: 'd-archive', name: 'Archive', parent: ROOT, folder: true },
    { id: 'd-2018', name: '2018', parent: 'd-archive', folder: true },
    { id: 'f-c', name: 'c.jpg', parent: 'd-2018', size: 5000 },
  ];
}

/**
 * Graph, over `drive`: `children` per folder, and a delta per folder that is
 * that folder's whole subtree. `deltaPaths` puts `parentReference.path` on
 * delta entries too, for the drives that do send it; `alsoInDelta` adds
 * entries a delta returns beyond the tree, by the folder path it is asked for.
 */
function graphOver(
  drive: Entry[],
  options: { deltaPaths?: boolean; alsoInDelta?: Record<string, Entry[]> } = {},
) {
  const byId = (id: string) => drive.find((e) => e.id === id);
  const pathOf = (id: string): string => {
    const e = byId(id)!;
    return e.id === ROOT ? '' : `${pathOf(e.parent!)}/${e.name}`;
  };
  const within = (e: Entry, ancestor: string): boolean =>
    e.id === ancestor || (e.parent !== undefined && byId(e.parent) !== undefined && within(byId(e.parent)!, ancestor));
  const asItem = (e: Entry, withPath: boolean) => ({
    id: e.id,
    name: e.name,
    lastModifiedDateTime: '2026-09-22T00:00:00Z',
    size: e.size ?? 0,
    ...(e.folder ? { folder: { childCount: 0 } } : { file: { mimeType: 'image/jpeg' } }),
    ...(e.id === ROOT
      ? { root: {} }
      : {
          parentReference: {
            id: e.parent,
            driveId: 'drive-1',
            ...(withPath && byId(e.parent!) ? { path: `/drive/root:${pathOf(e.parent!)}` } : {}),
          },
        }),
  });
  const folderUrl = (id: string, what: 'children' | 'delta'): string => {
    if (id === ROOT) return `${GRAPH}/drive/root/${what}`;
    if (what === 'children') return `${GRAPH}/drive/items/${id}/children`;
    return `${GRAPH}/drive/root:${pathOf(id).split('/').map(encodeURIComponent).join('/')}:/delta`;
  };

  return vi.fn(async (url: string) => {
    for (const folder of drive.filter((e) => e.folder)) {
      let value: unknown[] | undefined;
      if (url === folderUrl(folder.id, 'children')) {
        // A `children` answer DOES carry the path; only delta leaves it out.
        value = drive.filter((e) => e.parent === folder.id).map((e) => asItem(e, true));
      } else if (url === folderUrl(folder.id, 'delta')) {
        value = [
          ...drive.filter((e) => within(e, folder.id)),
          ...(options.alsoInDelta?.[pathOf(folder.id)] ?? []),
        ].map((e) => asItem(e, options.deltaPaths === true));
      }
      if (value !== undefined) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ value, '@odata.deltaLink': `${GRAPH}/delta?token=${folder.id}` }),
          headers: new Map(),
        };
      }
    }
    throw new Error(`the fake Graph was asked for something it does not serve: ${url}`);
  });
}

const tokens: TokenProvider = {
  getToken: async () =>
    ({ accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() / 1000 + 3600 }) as OAuth2Token,
  refresh: vi.fn(),
  isTokenValid: () => true,
  getTokenStatus: vi.fn(),
} as unknown as TokenProvider;

function sourceOver(fetchImpl: ReturnType<typeof graphOver>): GraphDriveSource {
  global.fetch = fetchImpl as unknown as typeof fetch;
  return new GraphDriveSource({ tokenProvider: tokens, tenantId: 't' });
}

/** What the preflight and a pass both do: walk, then list every folder. */
async function listEveryFolder(source: GraphDriveSource) {
  const out: Array<{
    folder: string;
    paths: string[];
    sizes: number[];
    unreadable?: number;
    listedElsewhere?: number;
  }> = [];
  for (const folder of await source.listFolders()) {
    const listing = await source.listSince(folder);
    out.push({
      folder: folder.path,
      paths: listing.items.map((i) => i.item.path),
      sizes: listing.items.map((i) => i.item.size),
      ...(listing.unreadable !== undefined ? { unreadable: listing.unreadable } : {}),
      ...(listing.listedElsewhere !== undefined ? { listedElsewhere: listing.listedElsewhere } : {}),
    });
  }
  return out;
}

const byFolder = (listed: Awaited<ReturnType<typeof listEveryFolder>>) =>
  Object.fromEntries(listed.map((l) => [l.folder, l.paths]));

beforeEach(() => setLogLevel('error'));
afterEach(() => {
  resetLogLevel();
  vi.restoreAllMocks();
});

describe('a delta that did not say where', () => {
  it('places every file by its parent\'s id, as Microsoft says to', async () => {
    // Before: every entry lacked a path, so every file was skipped with a log
    // line and every listing below was empty.
    const listed = await listEveryFolder(sourceOver(graphOver(aDrive())));

    expect(byFolder(listed)).toEqual({
      '': ['/top.txt'],
      '/Photos': ['/Photos/a.jpg'],
      '/Photos/2019': ['/Photos/2019/b.jpg'],
      '/Archive': [],
      '/Archive/2018': ['/Archive/2018/c.jpg'],
    });
    expect(listed.filter((l) => l.unreadable !== undefined)).toEqual([]);
  });

  it('builds the same keys whether or not a delta reported the path', async () => {
    // Some drives do send it. The key must not depend on which kind answered,
    // or the same file would be two items to the ledger.
    const withoutPaths = byFolder(await listEveryFolder(sourceOver(graphOver(aDrive()))));
    const withPaths = byFolder(
      await listEveryFolder(sourceOver(graphOver(aDrive(), { deltaPaths: true }))),
    );

    expect(withPaths).toEqual(withoutPaths);
  });
});

describe('a file listed once per folder above it', () => {
  it('lists each file ONCE, so the preflight adds up to the drive — not the drive times its depth', async () => {
    // With paths on the delta, the old listing yielded nine items for these
    // four files: the root's read held all four, Photos held two, and so on.
    for (const deltaPaths of [false, true]) {
      const listed = await listEveryFolder(sourceOver(graphOver(aDrive(), { deltaPaths })));
      const paths = listed.flatMap((l) => l.paths);

      expect(paths).toHaveLength(4);
      expect(new Set(paths).size).toBe(4);
      expect(listed.flatMap((l) => l.sizes).reduce((a, b) => a + b, 0)).toBe(6110);
    }
  });

  it('says a folder holding only subfolders WAS read, so it keeps a cursor', async () => {
    // `/Archive` holds no file of its own. Without a count of what the read
    // returned for others, the sync loop reads "no items" on a first read as
    // "saw nothing" and stores no cursor. Since the drive is read once per
    // pass (2026-09-22), "the read" is that one read, so the count is every
    // file in the drive that is not this folder's.
    const listed = await listEveryFolder(sourceOver(graphOver(aDrive())));
    const said = Object.fromEntries(listed.map((l) => [l.folder, l]));

    expect(said['/Archive']!.paths).toEqual([]);
    expect(said['/Archive']!.listedElsewhere).toBe(4);
    expect(said['']!.listedElsewhere).toBe(3);
  });
});

describe('a file the walk cannot place yet', () => {
  it('waits for the next walk when its folder was made after this one — it is not unreadable', async () => {
    const drive = aDrive();
    const source = sourceOver(graphOver(drive));
    const folders = await source.listFolders();
    // Created between the walk and the root's read: Graph's delta returns the
    // new folder and its file, and the walk has never seen either.
    drive.push({ id: 'd-new', name: 'New', parent: ROOT, folder: true });
    drive.push({ id: 'f-n', name: 'n.txt', parent: 'd-new', size: 7 });

    const root = await source.listSince(folders.find((f) => f.path === '')!);
    expect(root.items.map((i) => i.item.path)).toEqual(['/top.txt']);
    expect(root.unreadable).toBeUndefined();

    // The next pass walks again, and the new folder lists its own file.
    const next = await listEveryFolder(source);
    expect(byFolder(next)['/New']).toEqual(['/New/n.txt']);
  });

  it('lists a folder that is EMPTY, and gives it the file that lands in it by the next pass', async () => {
    // An empty folder has no file to name it as a parent, so only its own
    // entry in the read makes it a folder at all — and the sync loop creates
    // directories from what `listFolders` answers.
    const drive = [...aDrive(), { id: 'd-empty', name: 'Empty', parent: ROOT, folder: true as const }];
    const source = sourceOver(graphOver(drive));
    const first = await listEveryFolder(source);
    expect(byFolder(first)['/Empty']).toEqual([]);

    drive.push({ id: 'f-e', name: 'e.txt', parent: 'd-empty', size: 3 });
    const next = await listEveryFolder(source);

    expect(byFolder(next)['/Empty']).toEqual(['/Empty/e.txt']);
  });

  it('counts a file nobody can place ONCE — by the root, whose read every file is in', async () => {
    // Neither a parent the walk knows, nor a folder in the same read, nor a
    // path: the key would be a guess. Counted rather than dropped, and counted
    // by one listing, or the fault this file is about comes back as a count.
    const stray: Entry = { id: 'f-stray', name: 'stray.txt', parent: 'nowhere', size: 1 };
    const listed = await listEveryFolder(
      sourceOver(graphOver(aDrive(), { alsoInDelta: { '': [stray], '/Photos': [stray] } })),
    );
    const at = Object.fromEntries(listed.map((l) => [l.folder, l]));

    expect(at['']!.unreadable).toBe(1);
    expect(at['/Photos']!.unreadable).toBeUndefined();
    // Still evidence the read returned something for others: the drive's
    // other three files, and the stray.
    expect(at['/Photos']!.listedElsewhere).toBe(4);
    expect(listed.flatMap((l) => l.paths)).not.toContain('/stray.txt');
  });
});
