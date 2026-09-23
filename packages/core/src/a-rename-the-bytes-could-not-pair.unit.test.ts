// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RENAME THE BYTES COULD NOT PAIR (workplan 0042 T10, ADR-0030 amended).
 *
 * A move on a path-keyed source is found by pairing a disappearance with an
 * arrival carrying the same bytes. A Google Doc, Sheet or Slides deck has no
 * bytes of its own: each pass copies a fresh export, and two exports of an
 * unchanged document are not byte-identical once the format is a zip. So a
 * renamed document was never paired. Its old name went missing, two clean
 * passes later it was reported as DELETED IN GOOGLE, and both copies stayed on
 * the target. A throwaway probe through this same loop showed it.
 *
 * The owner's decisions, 2026-09-23: *"Yes, pair renamed Google documents by
 * their Drive id"* and *"Yes, Apply may remove the old copy of a renamed Google
 * filetype/document."* These tests hold both halves:
 *
 *  - detection pairs a Google document by the id the source gives it, and only
 *    a Google document: every other file is still paired by its bytes, and so
 *    is a document whose two exports are byte-identical (PDF, SVG);
 *  - Apply accepts the same id in place of the same bytes, for a pair made that
 *    way and no other, with every other gate standing;
 *  - unattended apply leaves such a pair for a person.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  asTenantId,
  asMappingId,
  fileNaturalKeyHash,
  type FileFolder,
  type FileSource,
  type LedgerRecord,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';
import {
  applyRelocation,
  autoApplyRelocations,
  evaluateApplyRelocation,
} from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('0e1d0000-e29b-41d4-a716-446655443a01');
const MAPPING = asMappingId('0e1d0000-e29b-41d4-a716-446655443a02');

const key = (path: string) => fileNaturalKeyHash(path);

/** One listed file. A Google document's bytes change on every fetch. */
interface Listed {
  readonly path: string;
  readonly sourceRef: string;
  /** A Google document: copied as a fresh export, never the same bytes twice. */
  readonly native?: boolean;
  /** Its Drive id, as the Drive source sets `sourceIdentity`; absent before this change. */
  readonly identity?: string;
  /** The bytes of an ordinary file. */
  readonly bytes?: string;
  /** A Google document exported as PDF or SVG: the same bytes on every fetch. */
  readonly stable?: boolean;
  /** Its copy fails on the target. */
  readonly failing?: boolean;
  readonly formerPaths?: ReadonlyArray<string>;
}

function world(initial: ReadonlyArray<Listed>) {
  const state = { listed: [...initial], exports: 0 };
  const root: FileFolder = { path: '' };
  const src: FileSource = {
    listFolders: async () => [root],
    listSince: async () => ({
      items: state.listed.map((l) => ({
        item: {
          path: l.path,
          name: l.path,
          isDirectory: false,
          size: 3,
          modifiedAt: '2026-09-23T00:00:00Z',
          etag: `v-${l.sourceRef}`,
          sourceRef: l.sourceRef,
          ...(l.identity ? { sourceIdentity: l.identity } : {}),
          ...(l.formerPaths ? { formerPaths: l.formerPaths } : {}),
        },
      })),
      nextCursor: { value: 'seen' },
    }),
    fetch: async (item) => {
      const listed = state.listed.find((l) => l.path === item.path)!;
      // A GOOGLE DOCUMENT: a fresh export every time, never the same bytes,
      // unless the format is one whose exports are byte-identical.
      state.exports += 1;
      const text =
        listed.native && !listed.stable
          ? `${listed.sourceRef} export ${state.exports}`
          : (listed.bytes ?? `${listed.sourceRef} export`);
      return { item, content: new TextEncoder().encode(text) };
    },
  };
  const stored = new Map<string, Uint8Array>();
  const target = {
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (parentId: string, raw: RawFileItem): Promise<UpsertResult> => {
      if (state.listed.find((l) => l.path === raw.item.path)?.failing) {
        throw new Error('the target refused the upload');
      }
      const at = `${parentId}:${raw.item.path}`;
      const existed = stored.has(at);
      stored.set(at, raw.content ?? new Uint8Array());
      return existed ? { targetId: at, created: false, adopted: true } : { targetId: at, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
  const ledger = new MemoryLedger();
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: src,
    target,
    ledger,
    sourceIsAuthorityOnExistence: true,
  };
  return { state, ledger, stored, pass: () => runFileSync(deps) };
}

const DOC = (path: string, id = 'doc-1'): Listed => ({
  path,
  sourceRef: id,
  identity: id,
  native: true,
});

describe('a renamed Google document', () => {
  it('is reported as moved, never as deleted in Google', async () => {
    const w = world([DOC('Plan.docx')]);
    await w.pass();

    // Renamed in Drive. The export under the new name has other bytes.
    w.state.listed = [DOC('Roadmap.docx')];
    const renamed = await w.pass();
    expect(renamed.moves).toEqual([
      expect.objectContaining({
        naturalKeyHash: key('Plan.docx'),
        toNaturalKeyHash: key('Roadmap.docx'),
      }),
    ]);
    expect(renamed.deletions).toEqual([]);

    // And stays explained: two more clean passes report no deletion, where
    // before this the old name was a confirmed inferred deletion by now.
    for (let i = 0; i < 3; i++) {
      const later = await w.pass();
      expect(later.deletions, `pass ${i + 3}`).toEqual([]);
    }
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Plan.docx'));
    expect(old).toMatchObject({
      movedToNaturalKeyHash: key('Roadmap.docx'),
      movedByIdentity: true,
    });
  });

  it('is not paired with a different document that arrives as it goes', async () => {
    const w = world([DOC('Plan.docx')]);
    await w.pass();
    w.state.listed = [DOC('Other.docx', 'doc-2')];
    const next = await w.pass();
    expect(next.moves).toEqual([]);
  });

  it('is never paired with another document by bytes their exports share', async () => {
    // Two documents whose PDF exports are byte-identical: the one that went
    // was deleted, not moved to the one that came. Only its own id pairs a
    // Google document.
    const same = { stable: true, bytes: 'the same page' };
    const w = world([{ ...DOC('A.pdf'), ...same }]);
    await w.pass();
    w.state.listed = [{ ...DOC('B.pdf', 'doc-2'), ...same }];
    const next = await w.pass();
    expect(next.moves).toEqual([]);
  });

  it('pairs every old name the document left with the name it has now', async () => {
    // An id names one document, so each name it was listed under is an old
    // copy of that one document, not a deletion.
    const w = world([DOC('Plan.docx'), DOC('Plan (2).docx')]);
    await w.pass();
    w.state.listed = [DOC('Roadmap.docx')];
    const renamed = await w.pass();
    expect(renamed.moves.map((m) => m.toNaturalKeyHash)).toEqual([
      key('Roadmap.docx'),
      key('Roadmap.docx'),
    ]);
  });

  it('pairs a rename it did not see happen, and takes back the deletion it reported', async () => {
    // Renamed BEFORE ids paired anything: the source gave no id, so the old
    // name ran up its absences and was reported as deleted in Google.
    const before = (path: string): Listed => ({ path, sourceRef: 'doc-1', native: true });
    const w = world([before('Plan.docx')]);
    await w.pass();
    w.state.listed = [before('Roadmap.docx')];
    await w.pass();
    const reported = await w.pass();
    expect(reported.deletions).toEqual([
      expect.objectContaining({ naturalKeyHash: key('Plan.docx') }),
    ]);

    // The first pass that lists the document with its id: the old name is
    // where it was, not a deletion, and the queue stops saying otherwise.
    w.state.listed = [DOC('Roadmap.docx')];
    const paired = await w.pass();
    expect(paired.moves).toEqual([
      expect.objectContaining({
        naturalKeyHash: key('Plan.docx'),
        toNaturalKeyHash: key('Roadmap.docx'),
      }),
    ]);
    expect(paired.deletions).toEqual([]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Plan.docx'));
    expect(old).toMatchObject({ movedByIdentity: true });
    expect(old?.absentPasses ?? 0).toBe(0);
    expect(await w.ledger.listDeletions(TENANT, MAPPING, 'file')).toEqual([]);
  });

  it('waits for a copy under the new name, and pairs once there is one', async () => {
    const w = world([DOC('Plan.docx')]);
    await w.pass();
    // Renamed, and the new name's first copy fails: nothing on the target to
    // pair with yet.
    w.state.listed = [{ ...DOC('Roadmap.docx'), failing: true }];
    const failed = await w.pass();
    expect(failed.moves).toEqual([]);
    // Copied on the next pass, and paired then.
    w.state.listed = [DOC('Roadmap.docx')];
    const copied = await w.pass();
    expect(copied.moves).toEqual([
      expect.objectContaining({ toNaturalKeyHash: key('Roadmap.docx') }),
    ]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Plan.docx'));
    expect(old?.absentPasses ?? 0).toBe(0);
  });

  it('pairs the name it was renamed back to, after the first move was applied', async () => {
    // Plan → Roadmap, the old copy removed; then renamed back. The copy at
    // Plan is written again, and Roadmap's copy is now the old one.
    const w = world([DOC('Plan.docx')]);
    await w.pass();
    w.state.listed = [DOC('Roadmap.docx')];
    await w.pass();
    const removed = await applyRelocation(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger: w.ledger,
        allowApplyDeletions: true,
        target: {
          removeItem: vi.fn(async (targetId: string) => {
            w.stored.delete(targetId);
            return { kind: 'deleted' as const, conflicted: false };
          }),
          hasItem: vi.fn(async () => true),
        },
      },
      key('Plan.docx'),
    );
    expect(removed.ok).toBe(true);

    w.state.listed = [DOC('Plan.docx')];
    const back = await w.pass();
    expect(back.moves).toEqual([
      expect.objectContaining({
        naturalKeyHash: key('Roadmap.docx'),
        toNaturalKeyHash: key('Plan.docx'),
      }),
    ]);
  });

  it('forgets the pair, and how it was made, when the old name comes back', async () => {
    const w = world([DOC('Plan.docx')]);
    await w.pass();
    w.state.listed = [DOC('Roadmap.docx')];
    await w.pass();
    w.state.listed = [DOC('Plan.docx')];
    await w.pass();
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Plan.docx'));
    expect(old?.movedToNaturalKeyHash).toBeUndefined();
    expect(old?.movedByIdentity).toBeUndefined();
  });

  it('stays a bytes pair where its exports are byte-identical (PDF, SVG)', async () => {
    // Before ids paired anything, a renamed PDF export was paired by its
    // bytes, and unattended apply acted on it. It still is, and still does:
    // the id is the evidence only where the bytes cannot be.
    const PDF = (path: string) => ({ ...DOC(path), stable: true });
    const w = world([PDF('Plan.pdf')]);
    await w.pass();
    w.state.listed = [PDF('Roadmap.pdf')];
    const renamed = await w.pass();
    expect(renamed.moves).toEqual([
      expect.objectContaining({ toNaturalKeyHash: key('Roadmap.pdf') }),
    ]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Plan.pdf'));
    expect(old?.movedToNaturalKeyHash).toBe(key('Roadmap.pdf'));
    expect(old?.movedByIdentity).toBeUndefined();

    const report = await autoApplyRelocations(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger: w.ledger,
        target: {
          removeItem: vi.fn(async () => ({ kind: 'deleted' as const })),
          hasItem: vi.fn(async () => true),
        },
        allowApplyDeletions: true,
        autoApplyRelocations: true,
      },
      '9999-01-01T00:00:00.000Z',
    );
    expect(report.applied).toEqual([
      expect.objectContaining({ naturalKeyHash: key('Plan.pdf') }),
    ]);
  });

  it('is never paired while it is an earlier export of itself (a format switch)', async () => {
    // Same Drive id under a new name, because the FORMAT changed. That is the
    // earlier-export case (0042 T8 (b)), marked before the detector runs, and
    // must not become a move whose Apply would remove the old format's copy.
    const w = world([
      { ...DOC('Plan.docx'), formerPaths: ['Plan', 'Plan.odt', 'Plan.pdf'] },
    ]);
    await w.pass();
    w.state.listed = [{ ...DOC('Plan.odt'), formerPaths: ['Plan', 'Plan.docx', 'Plan.pdf'] }];
    const switched = await w.pass();
    expect(switched.moves).toEqual([]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Plan.docx'));
    expect(old?.supersededByNaturalKeyHash).toBe(key('Plan.odt'));
    expect(old?.movedToNaturalKeyHash).toBeUndefined();
  });
});

describe('every other file', () => {
  it('is still paired by its bytes, as ADR-0030 always did', async () => {
    const w = world([{ path: 'report.pdf', sourceRef: 'file-1', bytes: 'the report' }]);
    await w.pass();
    w.state.listed = [{ path: 'summary.pdf', sourceRef: 'file-1', bytes: 'the report' }];
    const renamed = await w.pass();
    expect(renamed.moves).toEqual([
      expect.objectContaining({ toNaturalKeyHash: key('summary.pdf') }),
    ]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('report.pdf'));
    expect(old?.movedByIdentity).toBeUndefined();
  });

  it('is not paired by its id when its bytes changed too', async () => {
    // Renamed AND edited: an ordinary file carries no identity to pair by, so
    // this is not a move, exactly as before.
    const w = world([{ path: 'report.pdf', sourceRef: 'file-1', bytes: 'the report' }]);
    await w.pass();
    w.state.listed = [{ path: 'summary.pdf', sourceRef: 'file-1', bytes: 'an edited report' }];
    const renamed = await w.pass();
    expect(renamed.moves).toEqual([]);
  });
});

/**
 * APPLY, against the pair detection records. Both the evaluator (the managed
 * edition's queue decision) and the removal itself are asked, over one ledger.
 */
const OLD = 'Plan.docx';
const NEW = 'Roadmap.docx';

function docRow(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: OLD,
    contentHash: 'export-1',
    targetId: 'target/Plan.docx',
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
    sourceRef: 'doc-1',
    ...overrides,
  };
}

async function seedIdentityPair(
  ledger: MemoryLedger,
  arrival: Partial<LedgerRecord> = {},
  pairedBy: 'content' | 'identity' = 'identity',
  old: Partial<LedgerRecord> = {},
) {
  await ledger.recordIfAbsent(docRow(old));
  await ledger.recordIfAbsent(
    docRow({ naturalKeyHash: NEW, contentHash: 'export-2', targetId: 'target/Roadmap.docx', ...arrival }),
  );
  await ledger.recordMove(TENANT, MAPPING, 'file', OLD, 'Docs', NEW, pairedBy);
}

async function apply(ledger: MemoryLedger, present = true) {
  const removeItem = vi.fn(async () => ({ kind: 'deleted' as const, conflicted: false }));
  const hasItem = vi.fn(async () => present);
  const shared = {
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file' as const,
    ledger,
    allowApplyDeletions: true,
  };
  const evaluated = await evaluateApplyRelocation(shared, OLD);
  const applied = await applyRelocation({ ...shared, target: { removeItem, hasItem } }, OLD);
  return { evaluated, applied, removeItem };
}

describe('Apply on a renamed Google document', () => {
  it('removes the old copy: same document, written by us, on the target', async () => {
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger);
    const { evaluated, applied, removeItem } = await apply(ledger);
    expect(evaluated).toEqual({ ok: true, domain: 'file' });
    expect(applied.ok).toBe(true);
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(await ledger.find(TENANT, MAPPING, 'file', OLD)).toMatchObject({ status: 'tombstoned' });
  });

  it('refuses when the new copy no longer carries the document’s id', async () => {
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger, { sourceRef: 'doc-2' });
    const { evaluated, applied, removeItem } = await apply(ledger);
    expect(evaluated).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(applied).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('refuses when neither copy carries an id: two blanks are not one document', async () => {
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger, { sourceRef: '' }, 'identity', { sourceRef: '' });
    const { evaluated, applied, removeItem } = await apply(ledger);
    expect(evaluated).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(applied).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('refuses a new copy this migration did not write', async () => {
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger, { status: 'adopted' });
    const { applied, removeItem } = await apply(ledger);
    expect(applied).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('refuses when the target does not have the new copy, whatever the ledger says', async () => {
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger);
    const { applied, removeItem } = await apply(ledger, false);
    expect(applied).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('asks a pair made by BYTES for the same bytes, whatever ids it carries', async () => {
    // The id is accepted only as the proof the pair was made by. A bytes pair
    // whose bytes no longer agree is an edit after the move, as before.
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger, {}, 'content');
    const { evaluated, applied, removeItem } = await apply(ledger);
    expect(evaluated).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(applied).toMatchObject({ ok: false, code: 'relocation_unconfirmed' });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('is re-checked under the write: the ledger refuses an id that does not match', async () => {
    // Gate 7, the ledger's own condition, on its own: core's check ran before
    // a network call, and the arrival can change in between.
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger, { sourceRef: 'doc-2' });
    expect(await ledger.applyRelocation(TENANT, MAPPING, 'file', OLD)).toBe(false);
    const matching = new MemoryLedger();
    await seedIdentityPair(matching);
    expect(await matching.applyRelocation(TENANT, MAPPING, 'file', OLD)).toBe(true);
    // And a pair made by bytes is not let through by the ids it carries.
    const byBytes = new MemoryLedger();
    await seedIdentityPair(byBytes, {}, 'content');
    expect(await byBytes.applyRelocation(TENANT, MAPPING, 'file', OLD)).toBe(false);
  });
});

describe('unattended apply (ADR-0031)', () => {
  it('leaves a pair made by id for a person, and says why', async () => {
    const ledger = new MemoryLedger();
    await seedIdentityPair(ledger);
    const target = {
      removeItem: vi.fn(async () => ({ kind: 'deleted' as const })),
      hasItem: vi.fn(async () => true),
    };
    const report = await autoApplyRelocations(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger,
        target,
        allowApplyDeletions: true,
        autoApplyRelocations: true,
      },
      '9999-01-01T00:00:00.000Z',
    );
    expect(report.applied).toEqual([]);
    expect(report.leftForReview).toEqual([
      expect.objectContaining({ naturalKeyHash: OLD, code: 'paired_by_identity' }),
    ]);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});
