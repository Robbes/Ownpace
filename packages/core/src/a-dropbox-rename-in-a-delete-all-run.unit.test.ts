// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DROPBOX RENAME IN A *DELETE ALL OF THESE HERE TOO* RUN (workplan 0164 T3,
 * the third review's R6).
 *
 * Dropbox keys a file by its path (`dropbox-file-source.ts`: the path is the
 * natural key, the stable `id` is only `sourceRef`), and a rename answers the
 * old path with a tombstone. Outside a test migration the bin read takes that
 * tombstone as the owner's bin (`trashed`, `resolveDiscardedItems`), so the old
 * path's row lands on *Deleted on the old system* AND, paired by its bytes with
 * the new path, on Moves. *Delete all of these here too* takes `trashed` rows,
 * so a run can reach that row before anyone applies the move.
 *
 * The question was whether that run removes the only copy of a file still alive
 * at the source, and leaves it never copied again. Held here through the real
 * `DropboxFileSource` on a fake transport, the real `runFileSync`, and the run's
 * own loop over the real `applyDeletion` and `MemoryLedger`:
 *
 *  - the old path's row is on both queues after the rename, `trashed`;
 *  - the run removes the OLD path's copy only, the one applying the move would
 *    remove; the new path's copy, made by the pass that saw the rename, stays;
 *  - the move is closed on Moves as decided, its old copy removed (workplan 0164),
 *    and applying it afterwards removes nothing more
 *    (`already_applied`);
 *  - the new path keeps syncing: a later pass leaves it as it is;
 *  - nothing is left that is never copied again: the tombstone is on the old
 *    path's key, and since that row carries the recorded move, a file that
 *    comes back to the old path is copied again (`relocated-away`).
 */

import { describe, it, expect, vi } from 'vitest';
import { DropboxFileSource, type DropboxTransport } from '@openmig/connectors';
import {
  applyEachInTurn,
  asMappingId,
  asTenantId,
  fileNaturalKeyHash,
  mayOfferApply,
  type FileFolder,
  type RawFileItem,
  type RemovalResult,
  type UpsertResult,
} from '@openmig/shared';
import { applyDeletion, applyRelocation } from './apply-deletion.ts';
import { runFileSync } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('d0b0e000-e29b-41d4-a716-4466554401aa');
const MAPPING = asMappingId('d0b0e000-e29b-41d4-a716-4466554401bb');
const API = 'https://dropbox.test/api';
const CONTENT = 'https://dropbox.test/content';

/** A one-folder Dropbox a test can change between passes: live files, and the paths whose last state is deleted. */
function fakeDropbox() {
  const state = {
    files: [] as Array<{ id: string; name: string; hash: string }>,
    tombstones: [] as string[],
  };
  const ok = (body: unknown, bytes?: Uint8Array) => ({
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => (bytes ?? new Uint8Array([66, 89, 84, 69, 83])).buffer as ArrayBuffer,
    text: async () => '',
  });
  const transport: DropboxTransport = async (url, init) => {
    if (url === `${API}/files/list_folder`) {
      const arg = JSON.parse(init.body ?? '{}') as { include_deleted?: boolean };
      const live = state.files.map((f) => ({
        '.tag': 'file',
        id: f.id,
        name: f.name,
        path_display: `/${f.name}`,
        size: 5,
        content_hash: f.hash,
        server_modified: '2026-11-01T00:00:00Z',
      }));
      // `include_deleted` is the bin read's: a path whose latest state is deleted.
      const dead = arg.include_deleted
        ? state.tombstones.map((name) => ({ '.tag': 'deleted', name, path_display: `/${name}` }))
        : [];
      return ok({ entries: [...live, ...dead], cursor: 'c-1', has_more: false });
    }
    if (url === `${CONTENT}/files/download`) return ok({});
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

/** A file target that stores what it is given, and removes what it is asked to. */
function memoryTarget() {
  const stored = new Map<string, Uint8Array>();
  const removed: string[] = [];
  return {
    stored,
    removed,
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
    removeItem: vi.fn(async (targetId: string): Promise<RemovalResult> => {
      removed.push(targetId);
      stored.delete(targetId);
      return { kind: 'deleted' };
    }),
  };
}

const OLD = fileNaturalKeyHash('report.pdf');
const NEW = fileNaturalKeyHash('summary.pdf');

async function aRenameOnDropbox() {
  const { state, transport } = fakeDropbox();
  const target = memoryTarget();
  const ledger = new MemoryLedger();
  const d = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT }),
    target,
    ledger,
    cursors: new MemoryCursorStore(),
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  };

  state.files = [{ id: 'id:file-1', name: 'report.pdf', hash: 'h-same' }];
  expect((await runFileSync(d)).created, 'copied before the rename').toBe(1);

  // Renamed in Dropbox: same id, same bytes, a new path, and the old path's tombstone.
  state.files = [{ id: 'id:file-1', name: 'summary.pdf', hash: 'h-same' }];
  state.tombstones = ['report.pdf'];
  await runFileSync(d);

  return { state, target, ledger, d };
}

/** The rows *Delete all of these here too* takes: confirmed, open, offered their own delete. */
async function offered(ledger: MemoryLedger) {
  return (await ledger.listDeletions(TENANT, MAPPING)).filter(
    (r) => r.confirmed && r.acknowledgedAt === undefined && mayOfferApply(r, []),
  );
}

describe('a Dropbox rename, reached by a delete-all run before its move is applied', () => {
  it('puts the old path on both queues: on Deletions as found in the bin, and on Moves', async () => {
    const { ledger } = await aRenameOnDropbox();

    expect(await offered(ledger)).toEqual([expect.objectContaining({ naturalKeyHash: OLD, evidence: 'trashed' })]);
    const moves = await ledger.listMoves(TENANT, MAPPING);
    expect(moves).toEqual([expect.objectContaining({ naturalKeyHash: OLD, toNaturalKeyHash: NEW })]);
    expect(moves[0]!.acknowledgedAt).toBeUndefined();
  });

  it('removes only the old path’s copy; the new path’s copy stays and keeps syncing, and a return to the old path is copied again', async () => {
    const { state, target, ledger, d } = await aRenameOnDropbox();
    const newCopy = [...target.stored.keys()].find((k) => k.endsWith(':summary.pdf'));
    expect(newCopy, 'the pass that saw the rename copied the new path').toBeDefined();

    const rows = await offered(ledger);
    const results = await applyEachInTurn(
      rows.map((r) => ({ domain: r.domain, naturalKeyHash: r.naturalKeyHash })),
      (item) =>
        applyDeletion(
          {
            tenantId: TENANT,
            mappingId: MAPPING,
            domain: item.domain,
            ledger,
            target,
            allowApplyDeletions: true,
            stillTheAuthority: async () => true,
          },
          item.naturalKeyHash,
        ),
    );

    // The run removed the old path's copy: what applying the move removes too.
    expect(results).toEqual([expect.objectContaining({ answered: { ok: true, kind: 'deleted' } })]);
    expect(target.removed).toEqual([expect.stringMatching(/:report\.pdf$/)]);
    expect(target.stored.has(newCopy!), 'the new path’s copy is untouched').toBe(true);
    expect((await ledger.find(TENANT, MAPPING, 'file', OLD))?.status).toBe('tombstoned');
    expect((await ledger.find(TENANT, MAPPING, 'file', NEW))?.status).toBe('copied');

    // The move is listed as decided, its old copy removed (workplan 0164), and
    // applying it now removes nothing more.
    const move = (await ledger.listMoves(TENANT, MAPPING)).find((m) => m.naturalKeyHash === OLD);
    expect(move).toMatchObject({ decided: 'applied', acknowledgedAt: expect.any(String) });
    const moved = await applyRelocation(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger,
        target,
        allowApplyDeletions: true,
        stillTheAuthority: async () => true,
      },
      OLD,
    );
    expect(moved).toEqual(expect.objectContaining({ ok: false, code: 'already_applied' }));
    expect(target.removed).toHaveLength(1);
    expect(target.stored.has(newCopy!)).toBe(true);

    // The file lives on under its new name, and the next pass leaves it be.
    state.tombstones = [];
    const after = await runFileSync(d);
    expect(after.created).toBe(0);
    expect(target.stored.has(newCopy!)).toBe(true);
    expect((await ledger.find(TENANT, MAPPING, 'file', NEW))?.status).toBe('copied');

    // Renamed back: the old path's tombstone carries the recorded move, so the
    // file is copied there again rather than refused as a deletion's.
    state.files = [{ id: 'id:file-1', name: 'report.pdf', hash: 'h-same' }];
    state.tombstones = ['summary.pdf'];
    const back = await runFileSync(d);
    expect(back.created, 'copied again at the old path').toBe(1);
    expect([...target.stored.keys()].some((k) => k.endsWith(':report.pdf'))).toBe(true);
  });
});
