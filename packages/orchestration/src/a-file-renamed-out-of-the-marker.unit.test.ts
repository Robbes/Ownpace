// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE RENAMED OUT OF THE MARKER, through the real Drive source (workplan
 * 0162 §4, *Files are keyed by their path*; §2 (f)).
 *
 * A file's natural key is its path, and its title is its own name, so taking
 * the marker out of a file's name is a move to a path a test migration does
 * not list. The old path then counts as absent. Settled here, as §4 asks,
 * through `runFileSync` over the real `GoogleDriveSource` on a fake transport,
 * with cursors, which is how production runs it:
 *
 *  - before this change, two passes later it was reported as deleted in the
 *    old system, `inferred`, while the file was still there under its new
 *    name: the deletion queue §2 (f) says it must stay out of;
 *  - now it is neither drift nor a deletion, however many passes run, and its
 *    copy on the target stays exactly as it was copied. It is not relocated
 *    to the unmarked name either: nothing is copied under that name, and no
 *    move pairs with it;
 *  - a rename between two MARKED names is still reported as a relocation, as
 *    in any migration, so the owner can still tidy a test target;
 *  - a marked file the owner deletes goes to Drive's bin, and reaches the
 *    queue at once on that evidence, which an apply may act on (§6 step 5).
 *
 * The same rename in a migration that is not a test is the contrast: there
 * the renamed file is listed, copied under its new name, and paired with the
 * old one as a relocation, which is what a marked listing must never do with
 * an unmarked name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoogleDriveSource } from '@openmig/connectors';
import { runFileSync } from '@openmig/core';
import {
  asMappingId,
  asTenantId,
  fileNaturalKeyHash,
  mayOfferApply,
  resetLogLevel,
  setLogLevel,
  type FileFolder,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { MemoryCursorStore, MemoryLedger } from '../../core/src/__testing__/memory.ts';
import { markedOnlyFiles } from './marked-only.ts';

const TENANT = asTenantId('01620000-e29b-41d4-a716-4466554403a1');
const MAPPING = asMappingId('01620000-e29b-41d4-a716-4466554403a2');
const BASE = 'https://drive.example.test/v3';
const MARKER = '[Ownpace-test]';

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface FakeFile {
  id: string;
  name: string;
  size: string;
  md5Checksum: string;
  parents?: string[];
}

/**
 * A one-folder Drive whose files a test changes between passes, answered by
 * the query shapes the connector sends (as `drive-move-detection` does), so a
 * change in how it asks is a loud 404 rather than a quietly wrong answer.
 */
function fakeDrive(initial: FakeFile[]) {
  const state = { files: initial, trash: [] as FakeFile[] };
  const transport = async (url: string) => {
    const ok = (body: unknown, bytes?: Uint8Array) => ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    });
    const decoded = decodeURIComponent(url);
    if (decoded.includes('trashed=true')) return ok({ files: state.trash });
    if (url.includes('/files/root?fields=id')) return ok({ id: 'drive-root' });
    if (decoded.includes("mimeType='application/vnd.google-apps.folder'")) return ok({ files: [] });
    if (decoded.includes("mimeType!='application/vnd.google-apps.folder'")) return ok({ files: state.files });
    if (url.includes('alt=media')) return ok({}, new Uint8Array([66, 89, 84, 69, 83]));
    if (url.includes('?fields=id,name,mimeType')) {
      const id = /\/files\/([^?]+)\?/.exec(url)?.[1];
      const file = state.files.find((f) => f.id === id);
      return ok({ id: file?.id, name: file?.name, mimeType: 'application/pdf' });
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

/** A target that stores what it is given, by path. */
function memoryTarget() {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (parentId: string, raw: RawFileItem, options?: { overwrite?: boolean }): Promise<UpsertResult> => {
      const at = `${parentId}:${raw.item.path}`;
      const existed = stored.has(at);
      stored.set(at, raw.content ?? new Uint8Array());
      if (options?.overwrite) return { targetId: at, created: false, updated: true };
      if (existed) return { targetId: at, created: false, adopted: true };
      return { targetId: at, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
}

/** A pass's dependencies, the source wrapped as the builders wrap it. */
function migration(transport: ReturnType<typeof fakeDrive>['transport'], marker: string | null) {
  const target = memoryTarget();
  const ledger = new MemoryLedger();
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: markedOnlyFiles(new GoogleDriveSource(transport, { baseUrl: BASE }), marker),
    target,
    ledger,
    cursors: new MemoryCursorStore(),
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  };
  return { target, ledger, pass: () => runFileSync(deps) };
}

const MARKED: FakeFile = { id: 'f-1', name: '[Ownpace-test] report.pdf', size: '5', md5Checksum: 'md5-same' };

describe('a test migration, when the owner takes the marker out of a file’s name', () => {
  it('reports no deletion and no relocation, however many passes run, and the copy stays', async () => {
    const { state, transport } = fakeDrive([MARKED]);
    const m = migration(transport, MARKER);
    expect((await m.pass()).created).toBe(1);

    // Same id, same bytes, the marker gone from the name.
    state.files = [{ ...MARKED, name: 'report.pdf' }];

    for (let n = 1; n <= 5; n += 1) {
      const r = await m.pass();
      expect(r.created, `pass ${n}: nothing is copied under the unmarked name`).toBe(0);
      expect(r.deletions, `pass ${n}: nothing reaches the deletion queue`).toEqual([]);
      expect(r.moves, `pass ${n}: nothing is relocated to the unmarked name`).toEqual([]);
      expect(r.drift, `pass ${n}`).toBe(0);
    }
    const row = await m.ledger.find(TENANT, MAPPING, 'file', fileNaturalKeyHash('[Ownpace-test] report.pdf'));
    expect(row?.status).toBe('copied');
    expect(row?.absentPasses ?? 0).toBe(0);
    expect(row?.deletionReportedAt).toBeUndefined();
    expect(await m.ledger.find(TENANT, MAPPING, 'file', fileNaturalKeyHash('report.pdf'))).toBeUndefined();
    expect([...m.target.stored.keys()]).toEqual(['t/root:[Ownpace-test] report.pdf']);
  });

  it('copies it again when the marker is put back, and the first copy is still where it was', async () => {
    const { state, transport } = fakeDrive([MARKED]);
    const m = migration(transport, MARKER);
    await m.pass();
    state.files = [{ ...MARKED, name: 'report.pdf' }];
    await m.pass();
    await m.pass();

    state.files = [MARKED];
    const back = await m.pass();

    expect(back.created).toBe(0);
    expect(back.deletions).toEqual([]);
    expect([...m.target.stored.keys()]).toEqual(['t/root:[Ownpace-test] report.pdf']);
  });
});

describe('a test migration, with the marker kept', () => {
  it('reports a rename between two marked names as a relocation, as any migration does', async () => {
    const { state, transport } = fakeDrive([MARKED]);
    const m = migration(transport, MARKER);
    await m.pass();

    state.files = [{ ...MARKED, name: '[Ownpace-test] summary.pdf' }];
    const r = await m.pass();

    expect(r.created).toBe(1);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]).toMatchObject({
      domain: 'file',
      naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'),
      toNaturalKeyHash: fileNaturalKeyHash('[Ownpace-test] summary.pdf'),
    });
  });

  it('puts a marked file the owner binned in the queue at once, on evidence an apply may act on', async () => {
    const { state, transport } = fakeDrive([MARKED]);
    const m = migration(transport, MARKER);
    await m.pass();

    state.files = [];
    state.trash = [{ ...MARKED, parents: ['drive-root'] }];
    const r = await m.pass();

    expect(r.deletions).toHaveLength(1);
    expect(r.deletions[0]).toMatchObject({
      naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'),
      evidence: 'trashed',
      confirmed: true,
    });
    expect(mayOfferApply(r.deletions[0]!, [])).toBe(true);
  });
});

describe('the same rename in a migration that is not a test', () => {
  it('copies the new name and pairs the old one with it as a relocation, which a marked listing must not', async () => {
    const { state, transport } = fakeDrive([MARKED]);
    const m = migration(transport, null);
    await m.pass();

    state.files = [{ ...MARKED, name: 'report.pdf' }];
    const r = await m.pass();

    expect(r.created).toBe(1);
    expect(r.moves[0]).toMatchObject({
      naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'),
      toNaturalKeyHash: fileNaturalKeyHash('report.pdf'),
    });
  });
});
