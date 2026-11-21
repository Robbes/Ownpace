// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DROPBOX FILE RENAMED OUT OF THE MARKER, through the real Dropbox source
 * (workplan 0162 §2 (f); the second thing T1 settles before any marker can be
 * set).
 *
 * Dropbox's model is the path: a file renamed or moved is listed at its new
 * path under the same `id`, and the old path answers `list_folder` with
 * `include_deleted` as a tombstone (`.tag: "deleted"`), which carries a name
 * and a path and no id. `listTrashedPaths` reads those tombstones as the
 * owner's bin. Under a marker the bin is filtered by the marked name, so the
 * tombstone of a file renamed out of the marker passes the filter by its old,
 * marked name, while the file itself is listed under its new name and set
 * aside. The pass then found the old path's copy in the bin and not alive
 * anywhere, and recorded it as `trashed`, the evidence an apply may act on,
 * while the file was still there.
 *
 * What ties the two together is the ledger: the row the old path keys holds
 * the Dropbox `id` it was copied under (`sourceRef`), and the listing gives
 * the same `id` for the file under its new name. So under a marker, a bin
 * entry whose row's file is still listed under any name, kept or set aside,
 * is not a trashed file.
 *
 * The fake answers the requests the connector makes, by the arguments in
 * their bodies, as `dropbox-file-source.unit.test.ts` does, and models
 * Dropbox as this connector reads it (`DropboxEntry`, `listTrashedPaths`).
 * It is not a recording of Dropbox's servers.
 *
 * Without a marker none of this changes: a renamed file is copied under its
 * new name and paired with the old one, and the old path's tombstone is read
 * as the bin beside that, as it was. That last is the same misreading, found
 * here and recorded in 0162's Status; this plan does not change what a
 * migration that is not a test reports.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DropboxFileSource } from '@openmig/connectors';
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

const TENANT = asTenantId('01620008-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('01620008-e29b-41d4-a716-446655440002');
const API = 'https://api.dropbox.example.test/2';
const CONTENT = 'https://content.dropbox.example.test/2';
const MARKER = '[Ownpace-test]';

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** A live file, as `list_folder` lists it. */
interface FakeFile {
  readonly id: string;
  readonly name: string;
}

/** A tombstone: a path whose latest state is deleted. No id, as Dropbox's carries none. */
interface Tombstone {
  readonly name: string;
}

/**
 * A one-folder Dropbox whose files a test changes between passes. Answered by
 * what each request asks for: `recursive` and `include_deleted` in the body of
 * `files/list_folder`, the id in `Dropbox-API-Arg` for a download. Anything
 * else is a loud 404. Each file's bytes are its own (`B:` and its id), so a
 * rename pairs only with the file it is.
 */
function fakeDropbox(initial: FakeFile[]) {
  const state = { files: initial, tombstones: [] as Tombstone[] };
  const ok = (body: unknown, bytes?: Uint8Array) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
    text: async () => JSON.stringify(body),
  });
  const entry = (f: FakeFile) => ({
    '.tag': 'file',
    id: f.id,
    name: f.name,
    path_display: `/${f.name}`,
    size: new TextEncoder().encode(`B:${f.id}`).byteLength,
    server_modified: '2026-11-20T10:00:00Z',
    content_hash: `dropbox-hash-of-${f.id}`,
  });
  const transport = async (url: string, init: { headers: Readonly<Record<string, string>>; body?: string }) => {
    if (url === `${CONTENT}/files/download`) {
      const { path } = JSON.parse(init.headers['Dropbox-API-Arg'] ?? '{}') as { path?: string };
      if (!state.files.some((f) => f.id === path)) {
        return { ok: false, status: 409, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), text: async () => `no file ${path}` };
      }
      return ok({}, new TextEncoder().encode(`B:${path}`));
    }
    if (url === `${API}/files/list_folder`) {
      const arg = JSON.parse(init.body ?? '{}') as { path?: string; recursive?: boolean; include_deleted?: boolean };
      if (arg.path !== '') throw new Error(`the fake has one folder, the root; asked for ${arg.path}`);
      const entries: unknown[] = state.files.map(entry);
      if (arg.recursive && arg.include_deleted) {
        for (const t of state.tombstones) entries.push({ '.tag': 'deleted', name: t.name, path_display: `/${t.name}` });
      }
      return ok({ entries, cursor: 'c-end', has_more: false });
    }
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), text: async () => `no fake route for ${url}` };
  };
  /** Dropbox's answer to a rename: the same id under the new name, and a tombstone at the old one. */
  const rename = (id: string, to: string) => {
    const was = state.files.find((f) => f.id === id)!;
    state.files = state.files.map((f) => (f.id === id ? { ...f, name: to } : f));
    state.tombstones = [...state.tombstones.filter((t) => t.name !== to), { name: was.name }];
  };
  /** And to a deletion: no file, and a tombstone at its path. */
  const remove = (id: string) => {
    const was = state.files.find((f) => f.id === id)!;
    state.files = state.files.filter((f) => f.id !== id);
    state.tombstones = [...state.tombstones, { name: was.name }];
  };
  return { state, transport, rename, remove };
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
function migration(transport: ReturnType<typeof fakeDropbox>['transport'], marker: string | null) {
  const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });
  const target = memoryTarget();
  const ledger = new MemoryLedger();
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: markedOnlyFiles(source, marker),
    target,
    ledger,
    cursors: new MemoryCursorStore(),
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  };
  return { source, target, ledger, pass: () => runFileSync(deps) };
}

const MARKED: FakeFile = { id: 'id:f-1', name: '[Ownpace-test] report.pdf' };
const OTHER: FakeFile = { id: 'id:f-2', name: '[Ownpace-test] notes.pdf' };
const CONTROL: FakeFile = { id: 'id:f-3', name: 'Taxes.pdf' };

describe('Dropbox, as the fake answers a rename', () => {
  it('lists the file under its new name, with the same id, and a tombstone at the old one', async () => {
    const box = fakeDropbox([MARKED]);
    const { source } = migration(box.transport, null);
    box.rename(MARKED.id, 'report.pdf');

    const listed = await source.listSince({ path: '' });
    expect(listed.items.map((i) => [i.item.path, i.item.sourceRef])).toEqual([['report.pdf', MARKED.id]]);
    expect((await source.listTrashedPaths()).paths).toEqual(['[Ownpace-test] report.pdf']);
  });
});

describe('a test migration, when the owner renames a marked Dropbox file out of the marker', () => {
  it('records no deletion, however many passes run, and the copy stays', async () => {
    const box = fakeDropbox([MARKED]);
    const m = migration(box.transport, MARKER);
    expect((await m.pass()).created).toBe(1);

    box.rename(MARKED.id, 'report.pdf');

    for (let n = 1; n <= 3; n += 1) {
      const r = await m.pass();
      expect(r.deletions, `pass ${n}: the tombstone of a file still listed is not its bin`).toEqual([]);
      expect(r.created, `pass ${n}: nothing is copied under the unmarked name`).toBe(0);
      expect(r.moves, `pass ${n}`).toEqual([]);
      expect(r.drift, `pass ${n}`).toBe(0);
    }
    const row = await m.ledger.find(TENANT, MAPPING, 'file', fileNaturalKeyHash('[Ownpace-test] report.pdf'));
    expect(row?.status).toBe('copied');
    expect(row?.deletionTrashedAt).toBeUndefined();
    expect([...m.target.stored.keys()]).toEqual(['t/root:[Ownpace-test] report.pdf']);
  });

  it('reports it at once when the file is then deleted for good, as trashed', async () => {
    const box = fakeDropbox([MARKED]);
    const m = migration(box.transport, MARKER);
    await m.pass();
    box.rename(MARKED.id, 'report.pdf');
    expect((await m.pass()).deletions).toEqual([]);

    box.remove(MARKED.id);
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

describe('a test migration, with the marker kept', () => {
  it('reports a rename between two marked names as a relocation, and not as a file in the bin', async () => {
    const box = fakeDropbox([MARKED, CONTROL]);
    const m = migration(box.transport, MARKER);
    expect((await m.pass()).created).toBe(1);

    box.rename(MARKED.id, '[Ownpace-test] summary.pdf');
    const r = await m.pass();

    expect(r.created).toBe(1);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]).toMatchObject({
      naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'),
      toNaturalKeyHash: fileNaturalKeyHash('[Ownpace-test] summary.pdf'),
    });
    expect(r.deletions).toEqual([]);
  });

  it('puts a marked file the owner deletes in the queue at once, on evidence an apply may act on, and nothing for an unmarked one deleted beside it', async () => {
    const box = fakeDropbox([MARKED, OTHER, CONTROL]);
    const m = migration(box.transport, MARKER);
    expect((await m.pass()).created).toBe(2);

    box.remove(MARKED.id);
    box.remove(CONTROL.id);
    const r = await m.pass();

    expect(r.deletions).toHaveLength(1);
    expect(r.deletions[0]).toMatchObject({
      naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'),
      evidence: 'trashed',
      confirmed: true,
      absentPasses: 0,
    });
    expect(mayOfferApply(r.deletions[0]!, [])).toBe(true);
    expect(r.drift).toBe(0);
  });
});

describe('the same rename in a migration that is not a test', () => {
  it('copies the new name and pairs the old one with it as a relocation', async () => {
    const box = fakeDropbox([MARKED]);
    const m = migration(box.transport, null);
    await m.pass();

    box.rename(MARKED.id, 'report.pdf');
    const r = await m.pass();

    expect(r.created).toBe(1);
    expect(r.moves[0]).toMatchObject({
      naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'),
      toNaturalKeyHash: fileNaturalKeyHash('report.pdf'),
    });
  });

  it('reads the tombstone as it did before: nothing here changes a migration that is not a test', async () => {
    // Found on the way, and left as it is (0162 Status, 2026-11-21): without a
    // marker the old path's tombstone is read as the owner's bin too, beside
    // the relocation. Changing that changes what every Dropbox migration
    // reports, which is not this plan's to decide.
    const box = fakeDropbox([MARKED]);
    const m = migration(box.transport, null);
    await m.pass();

    box.rename(MARKED.id, 'report.pdf');
    const r = await m.pass();

    expect(r.deletions).toEqual([
      expect.objectContaining({ naturalKeyHash: fileNaturalKeyHash('[Ownpace-test] report.pdf'), evidence: 'trashed' }),
    ]);
  });
});
