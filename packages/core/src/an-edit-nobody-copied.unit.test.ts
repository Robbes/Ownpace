// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN EDIT NOBODY COPIED (found 2026-09-22, reading the Google export follow-ups
 * the owner asked for — 0042 T8 (d)).
 *
 * The file domain decides a known file changed by its `sourceVersion`, which
 * `runFileSync` reads from `FileItem.etag`, and `classifyKnownItem` SKIPS a
 * file that has none. WebDAV fills it with the server's ETag. The four API
 * sources — Drive, OneDrive, Box, Dropbox — filled nothing. So a file edited
 * at the source after its first copy was never copied again, on all four, and
 * every pass reported it `skipped` as if it had looked and found nothing new.
 *
 * These run the real `runFileSync` over the real `GoogleDriveSource` on a fake
 * transport, with a cursor store, across passes — the production shape
 * `drive-move-detection.unit.test.ts` established. The other three sources'
 * versions are pinned beside their own listing tests.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource } from '@openmig/connectors';
import {
  asTenantId,
  asMappingId,
  fileVersion,
  type FileFolder,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';

const TENANT = asTenantId('e0170000-e29b-41d4-a716-4466554409aa');
const MAPPING = asMappingId('e0170000-e29b-41d4-a716-4466554409bb');
const BASE = 'https://drive.test/v3';

interface FakeFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

/** A flat Drive whose files a test can change between passes. */
function fakeDrive(initial: FakeFile[]) {
  const state = { files: initial };
  const transport = async (url: string) => {
    const ok = (body: unknown, bytes?: Uint8Array) => ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    });
    const decoded = decodeURIComponent(url);
    if (decoded.includes('trashed=true')) return ok({ files: [] });
    if (url.includes('/files/root?fields=id')) return ok({ id: 'drive-root' });
    if (decoded.includes("mimeType='application/vnd.google-apps.folder'")) return ok({ files: [] });
    if (decoded.includes("mimeType!='application/vnd.google-apps.folder'")) {
      return ok({ files: state.files.map((f) => ({ mimeType: 'application/pdf', size: '5', ...f })) });
    }
    if (url.includes('alt=media')) return ok({}, new Uint8Array([66, 89, 84, 69, 83]));
    if (url.includes('?fields=id,name,mimeType')) {
      const id = /\/files\/([^?]+)\?/.exec(url)?.[1];
      const file = state.files.find((f) => f.id === id);
      return ok({ id: file?.id, name: file?.name, mimeType: file?.mimeType ?? 'application/pdf' });
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => `no fake route for ${url}`,
    };
  };
  return { state, transport };
}

/** Stores bytes and says which writes were rewrites of a file it holds. */
function memoryTarget() {
  const rewrites: string[] = [];
  return {
    rewrites,
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (
      parentId: string,
      raw: RawFileItem,
      options?: { overwrite?: boolean },
    ): Promise<UpsertResult> => {
      const at = `${parentId}:${raw.item.path}`;
      if (options?.overwrite) {
        rewrites.push(raw.item.path);
        return { targetId: at, created: false, updated: true };
      }
      return { targetId: at, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
}

function deps(source: GoogleDriveSource, target: ReturnType<typeof memoryTarget>) {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target,
    ledger: new MemoryLedger(),
    cursors: new MemoryCursorStore(),
    sourceIsAuthorityOnExistence: true,
  };
}

const FILE: FakeFile = { id: 'f-1', name: 'report.pdf', md5Checksum: 'md5-before' };

describe('a Drive file edited after its first copy', () => {
  it('is copied again on the next pass', async () => {
    const { state, transport } = fakeDrive([FILE]);
    const target = memoryTarget();
    const d = deps(new GoogleDriveSource(transport, { baseUrl: BASE }), target);

    expect((await runFileSync(d)).created).toBe(1);

    // The owner edits it in Drive: new bytes, so a new checksum.
    state.files = [{ ...FILE, md5Checksum: 'md5-after' }];
    const second = await runFileSync(d);

    // Before: `skipped: 1`, `updated: 0`, and the copy stayed as it was.
    expect(second.updated).toBe(1);
    expect(target.rewrites).toEqual(['report.pdf']);
  });

  it('is left alone when nothing changed — no download, no rewrite', async () => {
    const { transport } = fakeDrive([FILE]);
    const target = memoryTarget();
    const d = deps(new GoogleDriveSource(transport, { baseUrl: BASE }), target);

    await runFileSync(d);
    const second = await runFileSync(d);

    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(target.rewrites).toEqual([]);
  });
});

describe('a copy made before files had versions', () => {
  it('is not rewritten on the first pass after the upgrade — its version is recorded', async () => {
    // Every Drive, OneDrive, Box and Dropbox copy in every deployment has no
    // version today. Rewriting them all on the first pass after this ships
    // would re-download a whole migration; recording what each is now costs a
    // ledger write and nothing else, and the NEXT edit is the one that counts.
    const { state, transport } = fakeDrive([FILE]);
    const target = memoryTarget();
    const real = new GoogleDriveSource(transport, { baseUrl: BASE });
    const asBefore = {
      listFolders: () => real.listFolders(),
      listSince: async (folder: FileFolder, cursor?: { value: string }) => {
        const listing = await real.listSince(folder, cursor);
        return {
          ...listing,
          items: listing.items.map(({ item, ...rest }) => {
            const { etag: _unversioned, ...withoutVersion } = item;
            return { ...rest, item: withoutVersion };
          }),
        };
      },
      fetch: (item: RawFileItem['item']) => real.fetch(item),
    };
    const d = deps(real, target);

    await runFileSync({ ...d, source: asBefore as unknown as GoogleDriveSource });
    const upgraded = await runFileSync(d);
    expect(upgraded.updated, 'the upgrade itself rewrites nothing').toBe(0);
    expect(target.rewrites).toEqual([]);

    state.files = [{ ...FILE, md5Checksum: 'md5-after' }];
    const edited = await runFileSync(d);
    expect(edited.updated, 'and the first real edit after it is copied').toBe(1);
  });
});

describe('what a Drive listing gives as the version', () => {
  it('is the checksum for a file with bytes, and the last edit for a native Doc', async () => {
    const { transport } = fakeDrive([
      FILE,
      {
        id: 'd-1',
        name: 'Notes',
        mimeType: 'application/vnd.google-apps.document',
        modifiedTime: '2026-09-22T10:00:00Z',
      },
    ]);
    const source = new GoogleDriveSource(transport, { baseUrl: BASE });

    const { items } = await source.listSince({ path: '' });
    const etagOf = (path: string) => items.find((i) => i.item.path === path)?.item.etag;

    expect(etagOf('report.pdf')).toBe('hash:md5-before');
    expect(etagOf('Notes')).toBe('modified:2026-09-22T10:00:00Z');
  });

  it('is nothing at all when the source gave neither, rather than a constant', () => {
    // A constant would call every later pass "unchanged" with the confidence
    // of a real comparison.
    expect(fileVersion(undefined, undefined)).toEqual({});
    expect(fileVersion('', undefined)).toEqual({});
  });
});
