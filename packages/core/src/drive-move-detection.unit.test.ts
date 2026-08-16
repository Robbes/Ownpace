// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Move detection through the REAL Drive connector, in the production shape.
 *
 * Found while preparing the owner's manual test drill, not by a failing test —
 * which is the point of this file. Every earlier move-detection test either ran
 * without a cursor store or opted into `listKeys` explicitly, and the Drive
 * connector's own tests never ran the sync loop at all. Production has neither
 * luxury: the scheduler always configures cursors, `GoogleDriveSource.listSince`
 * returned a sentinel cursor it never used, and the connector had no
 * `listKeys`. So from the second pass on, `fullyEnumerated` was false for every
 * folder and `detectPathKeyedMoves` never ran — no rename, no move, no drift
 * and no absence-counted deletion could EVER be detected for a Drive source.
 * The entire ADR-0030 relocation path was unreachable through the connector
 * that motivated it, and nothing looked broken: every pass reported clean.
 *
 * These tests run `runFileSync` — the real adapter, whose `source.listKeys`
 * wiring is the thing under test — against the real `GoogleDriveSource` on a
 * fake transport, WITH a cursor store, across two passes. The world() tests in
 * `move-detection.unit.test.ts` prove the loop; this file proves the connector
 * can reach it.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource } from '@openmig/connectors';
import {
  asTenantId,
  asMappingId,
  fileNaturalKeyHash,
  type RawFileItem,
  type UpsertResult,
  type FileFolder,
} from '@openmig/shared';
import { runFileSync } from './dav-sync';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory';

const TENANT = asTenantId('a7d40000-e29b-41d4-a716-4466554409aa');
const MAPPING = asMappingId('a7d40000-e29b-41d4-a716-4466554409bb');
const BASE = 'https://drive.test/v3';

interface FakeFile {
  id: string;
  name: string;
  size: string;
  md5Checksum: string;
}

/**
 * A one-folder Drive whose contents a test can change between passes.
 *
 * Route matching is by the QUERY SHAPE the connector actually sends —
 * `mimeType!=` for files, `mimeType=` for folders, `alt=media` for bytes,
 * `?fields=id,name,mimeType` for the fetch-time metadata read — so a change in
 * how the connector asks shows up as a loud 404, not a silently wrong answer.
 */
function fakeDrive(initial: FakeFile[]) {
  const state = { files: initial, listings: 0 };
  const transport = async (url: string) => {
    const ok = (body: unknown, bytes?: Uint8Array) => ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
      text: async () => '',
    });
    const decoded = decodeURIComponent(url);
    if (decoded.includes("mimeType='application/vnd.google-apps.folder'")) {
      return ok({ files: [] }); // a flat root: no subfolders
    }
    if (decoded.includes("mimeType!='application/vnd.google-apps.folder'")) {
      state.listings += 1;
      return ok({ files: state.files });
    }
    if (url.includes('alt=media')) {
      return ok({}, new Uint8Array([66, 89, 84, 69, 83]));
    }
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

/** The minimum honest FileTargetWriter: stores bytes, adopts on re-write. */
function memoryTarget() {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (
      parentId: string,
      raw: RawFileItem,
      options?: { overwrite?: boolean },
    ): Promise<UpsertResult> => {
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

function deps(source: GoogleDriveSource, target: ReturnType<typeof memoryTarget>) {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target,
    ledger: new MemoryLedger(),
    // THE PRODUCTION SHAPE. Every earlier test that proved move detection left
    // this out, and its presence is exactly what broke the connector: a stored
    // cursor marks a listing incomplete unless the source can answer for its
    // whole key set.
    cursors: new MemoryCursorStore(),
  };
}

const FILE: FakeFile = { id: 'f-1', name: 'report.pdf', size: '5', md5Checksum: 'md5-same' };

describe('a rename in Drive, seen by the pass AFTER the copy (the production case)', () => {
  it('is reported as a relocation, with the new key', async () => {
    const { state, transport } = fakeDrive([FILE]);
    const d = deps(new GoogleDriveSource(transport, { baseUrl: BASE }), memoryTarget());

    const first = await runFileSync(d);
    expect(first.created, 'the copy exists before the rename').toBe(1);

    // The owner renames it in Drive. Same id, same bytes, new name.
    state.files = [{ ...FILE, name: 'summary.pdf' }];

    const second = await runFileSync(d);

    // Before the fix this was 0 — with a cursor stored, the pass counted its
    // key set incomplete, skipped detection entirely, and the rename surfaced
    // NOWHERE: not as a move, not as drift. The queue the owner is told to
    // check stayed empty while the target quietly kept both copies.
    expect(second.moved).toBe(1);
    expect(second.moves[0]).toMatchObject({
      domain: 'file',
      naturalKeyHash: fileNaturalKeyHash('report.pdf'),
      toNaturalKeyHash: fileNaturalKeyHash('summary.pdf'),
    });
    expect(second.drift, 'explained, so not drift').toBe(0);
  });

  it('counts a plain deletion as drift on the following pass', async () => {
    // The other half the broken gate silenced: a file deleted in Drive was
    // never even counted absent, so the deletions queue could never fill.
    const { state, transport } = fakeDrive([FILE]);
    const d = deps(new GoogleDriveSource(transport, { baseUrl: BASE }), memoryTarget());
    await runFileSync(d);

    state.files = [];
    const second = await runFileSync(d);

    expect(second.drift).toBe(1);
  });

  it('does not cost a second Drive listing per folder', async () => {
    // `listKeys` answers from the listing `listSince` just made (consume-once,
    // so a changed call order degrades to one extra request rather than to a
    // stale answer). The detector must not double the connector's dominant
    // API cost — T1 already flagged listing volume as Drive's expensive half.
    const { state, transport } = fakeDrive([FILE]);
    const d = deps(new GoogleDriveSource(transport, { baseUrl: BASE }), memoryTarget());

    await runFileSync(d);
    const after = state.listings;
    await runFileSync(d);

    expect(state.listings - after, 'one file-listing per folder per pass').toBe(1);
  });
});
