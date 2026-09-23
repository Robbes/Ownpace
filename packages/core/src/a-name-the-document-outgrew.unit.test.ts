// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NAME THE DOCUMENT OUTGREW (workplan 0042 T8 (b), the owner's decision of
 * 2026-09-23: one record per Google document, whatever its export format).
 *
 * A Google Doc, Sheet or Slides deck has no file name of its own. The export
 * policy decides the suffix, and a file's name is its natural key, so switching
 * the policy lists every native document under a key the ledger has never seen.
 * The document is found again under its new name. The failure recorded under
 * the old one, most often a refused Slides deck, was never listed again, and it
 * sat on the Failures screen for good: twenty of them were waiting on the
 * owner's own migration when he asked about switching.
 *
 * These drive the real file pass (`runFileSync`) against the in-memory ledger.
 * The last one runs the real Google Drive connector, because the former names
 * are the connector's to compute and a pass that never received them would
 * pass every test above it.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource } from '@openmig/connectors';
import {
  asTenantId,
  asMappingId,
  fileNaturalKeyHash,
  type FileFolder,
  type FileSource,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';
import { classifyKnownItem } from './domain-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('0e1d0000-e29b-41d4-a716-446655443001');
const MAPPING = asMappingId('0e1d0000-e29b-41d4-a716-446655443002');

const key = (path: string) => fileNaturalKeyHash(path);

/** One listed file: where it is, whose it is, and whether its fetch fails. */
interface Listed {
  readonly path: string;
  readonly sourceRef: string;
  readonly formerPaths?: ReadonlyArray<string>;
  /** The fetch throws this, standing in for a refusal. */
  readonly fails?: string;
}

/** A flat source whose listing a test replaces between passes. */
function source(initial: ReadonlyArray<Listed>, opts: { listKeys?: boolean } = {}) {
  const state = { listed: [...initial] };
  const root: FileFolder = { path: '' };
  const src: FileSource & { listKeys?: (folder: FileFolder) => Promise<ReadonlyArray<string>> } = {
    listFolders: async () => [root],
    listSince: async () => ({
      items: state.listed.map((l) => ({
        item: {
          path: l.path,
          name: l.path,
          isDirectory: false,
          size: 3,
          modifiedAt: '2026-09-23T00:00:00Z',
          etag: 'v1',
          sourceRef: l.sourceRef,
          ...(l.formerPaths ? { formerPaths: l.formerPaths } : {}),
        },
      })),
      nextCursor: { value: 'seen' },
    }),
    fetch: async (item) => {
      const listed = state.listed.find((l) => l.path === item.path);
      if (listed?.fails) throw new Error(listed.fails);
      return { item, content: new TextEncoder().encode(item.path) };
    },
    ...(opts.listKeys ? { listKeys: async () => state.listed.map((l) => l.path) } : {}),
  };
  return { state, src };
}

/** Stores what it is given; enough to make a copy a copy. */
function target() {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (parentId: string, raw: RawFileItem): Promise<UpsertResult> => {
      const at = `${parentId}:${raw.item.path}`;
      const existed = stored.has(at);
      stored.set(at, raw.content ?? new Uint8Array());
      return existed ? { targetId: at, created: false, adopted: true } : { targetId: at, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
}

function world(initial: ReadonlyArray<Listed>, opts: { cursors?: boolean; listKeys?: boolean } = {}) {
  const { state, src } = source(initial, opts);
  const ledger = new MemoryLedger();
  const onTarget = target();
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: src,
    target: onTarget,
    ledger,
    ...(opts.cursors ? { cursors: new MemoryCursorStore() } : {}),
    sourceIsAuthorityOnExistence: true,
  };
  return { state, ledger, stored: onTarget.stored, pass: () => runFileSync(deps) };
}

/** A Slides deck called `Deck`, as the listing names it under each policy. */
const DECK = 'deck-1';
const deckUnder = {
  refuse: { path: 'Deck', sourceRef: DECK, formerPaths: ['Deck.odp', 'Deck.pptx', 'Deck.pdf'] },
  odf: { path: 'Deck.odp', sourceRef: DECK, formerPaths: ['Deck', 'Deck.pptx', 'Deck.pdf'] },
  office: { path: 'Deck.pptx', sourceRef: DECK, formerPaths: ['Deck', 'Deck.odp', 'Deck.pdf'] },
} as const;

const failuresOf = async (ledger: MemoryLedger) =>
  (await ledger.listFailures(TENANT, MAPPING)).map((f) => f.naturalKeyHash);

describe('a failure left under a name the document no longer has', () => {
  it('closes by itself once the same document is copied under its new name', async () => {
    const w = world([{ ...deckUnder.refuse, fails: 'refused: set not to export' }]);
    await w.pass();
    expect(await failuresOf(w.ledger)).toEqual([key('Deck')]);

    // The owner chooses a format. The same deck is listed under a new name.
    w.state.listed = [deckUnder.odf];
    const second = await w.pass();

    expect(second.created, 'the deck arrives under its new name').toBe(1);
    expect(second.superseded, 'and the pass says it closed the old refusal').toBe(1);
    expect(await failuresOf(w.ledger), 'nothing left on the Failures screen').toEqual([]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Deck'));
    expect(old).toMatchObject({ status: 'superseded', supersededByNaturalKeyHash: key('Deck.odp') });
  });

  it('closes a failure written before failures kept their source handle', async () => {
    // The owner's own twenty were recorded without one, and they are the
    // rows this exists for.
    const w = world([deckUnder.odf]);
    await w.ledger.recordFailure(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        itemType: 'file',
        naturalKeyHash: key('Deck.pptx'),
        contentHash: '',
        targetId: '',
        createdAt: '2026-09-17T00:00:00Z',
        status: 'failed',
      },
      'refused: the export is not byte-stable',
      { park: true },
    );

    const pass = await w.pass();

    expect(pass.superseded).toBe(1);
    expect(await failuresOf(w.ledger)).toEqual([]);
  });

  it('shows the document once when the new format refuses it too', async () => {
    // Before this, a Slides deck still refused under the new policy was on the
    // Failures screen twice: once under each name.
    const w = world([{ ...deckUnder.refuse, fails: 'refused: set not to export' }]);
    await w.pass();

    w.state.listed = [{ ...deckUnder.office, fails: 'refused: the export is not byte-stable' }];
    const second = await w.pass();

    expect(second.superseded).toBe(1);
    expect(await failuresOf(w.ledger), 'one row, under the name it has now').toEqual([key('Deck.pptx')]);
  });

  it('records the source handle on a failure, which it used to leave out', async () => {
    const w = world([{ ...deckUnder.refuse, fails: 'refused' }]);
    await w.pass();
    const row = await w.ledger.find(TENANT, MAPPING, 'file', key('Deck'));
    expect(row?.sourceRef).toBe(DECK);
  });
});

describe('what it leaves alone', () => {
  it('a failure under a name a real file still carries', async () => {
    // An uploaded `Deck.pdf` beside a Slides deck called `Deck`: the PDF is a
    // name the deck would have under `export-pdf`, and it is somebody's file.
    // Its failure is parked and was written before failures kept a source
    // handle, so nothing but the listing can say it is still somebody's.
    const pdf = { path: 'Deck.pdf', sourceRef: 'pdf-9' };
    const w = world([deckUnder.odf, pdf]);
    for (const [path, ref] of [['Deck', DECK], ['Deck.pdf', undefined]] as const) {
      await w.ledger.recordFailure(
        {
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: 'file',
          naturalKeyHash: key(path),
          ...(ref !== undefined ? { sourceRef: ref } : {}),
          contentHash: '',
          targetId: '',
          createdAt: '2026-09-17T00:00:00Z',
          status: 'failed',
        },
        'refused',
        { park: true },
      );
    }

    const pass = await w.pass();

    expect(pass.superseded, 'only the deck’s own old name').toBe(1);
    expect(await failuresOf(w.ledger)).toEqual([key('Deck.pdf')]);
  });

  it('a failure that says it belongs to a different document', async () => {
    const w = world([{ path: 'Deck', sourceRef: 'another-deck', fails: 'refused' }]);
    await w.pass();

    // A different document of the same name, listed under an export name.
    w.state.listed = [deckUnder.odf];
    const second = await w.pass();

    expect(second.superseded).toBe(0);
    expect(await failuresOf(w.ledger)).toEqual([key('Deck')]);
  });

  /**
   * A failed row under `Deck` and a first pass that stored a cursor. A folder
   * that had a failure keeps no cursor, so the failure is seeded rather than
   * produced, and an ordinary file is what the first pass copies.
   */
  async function cursorWorld(listKeys: boolean) {
    const other = { path: 'Other.txt', sourceRef: 'other-1' };
    const w = world([other], { cursors: true, listKeys });
    await w.ledger.recordFailure(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        itemType: 'file',
        naturalKeyHash: key('Deck'),
        sourceRef: DECK,
        contentHash: '',
        targetId: '',
        createdAt: '2026-09-17T00:00:00Z',
        status: 'failed',
      },
      'refused: set not to export',
      { park: true },
    );
    await w.pass();
    w.state.listed = [other, deckUnder.odf];
    return w;
  }

  it('anything on a pass that could not list everything', async () => {
    // A stored cursor and no way to list a folder's keys: the pass cannot say
    // what it did not see, so it says nothing.
    const w = await cursorWorld(false);
    const second = await w.pass();

    expect(second.superseded).toBe(0);
    expect(await failuresOf(w.ledger)).toEqual([key('Deck')]);
  });

  it('closes it all the same when the source CAN list a folder’s keys', async () => {
    // The production shape for Drive: a stored cursor, and `listKeys`.
    const w = await cursorWorld(true);
    const second = await w.pass();

    expect(second.superseded).toBe(1);
    expect(await failuresOf(w.ledger)).toEqual([]);
  });

  it('a copy that reached the target under the old name', async () => {
    // Bytes the owner may want: never closed, never removed. The second half
    // marks it as an earlier export instead (below).
    const report = { path: 'Report.docx', sourceRef: 'doc-1', formerPaths: ['Report', 'Report.odt', 'Report.pdf'] };
    const w = world([report]);
    await w.pass();

    w.state.listed = [{ path: 'Report.pdf', sourceRef: 'doc-1', formerPaths: ['Report', 'Report.odt', 'Report.docx'] }];
    const second = await w.pass();

    expect(second.superseded).toBe(0);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Report.docx'));
    expect(old?.status).toBe('copied');
  });
});

/**
 * THE SECOND HALF (the owner, 2026-09-23: *"An old copy in Nextcloud is never
 * deleted for you. Deletions lists it as 'an earlier export', not as 'deleted
 * in Google'."*).
 *
 * Between two export formats every document is copied again under its new
 * name, and the old copy stays on the target. Before this, the detector saw the
 * old name missing with nothing carrying its bytes (the new format's bytes
 * differ), and two clean passes later reported each old copy as deleted in
 * Google.
 */
describe('the copy the old name left on the target', () => {
  const reportUnder = {
    office: { path: 'Report.docx', sourceRef: 'doc-1', formerPaths: ['Report', 'Report.odt', 'Report.pdf'] },
    odf: { path: 'Report.odt', sourceRef: 'doc-1', formerPaths: ['Report', 'Report.docx', 'Report.pdf'] },
  } as const;

  it('is marked as an earlier export of the new copy, and nothing is removed', async () => {
    const w = world([reportUnder.office]);
    await w.pass();

    w.state.listed = [reportUnder.odf];
    const second = await w.pass();

    expect(second.created, 'the document arrives under its new name').toBe(1);
    expect(second.earlierExports, 'and the pass says what the old copy is').toBe(1);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Report.docx'));
    expect(old, 'still ours, still on the target').toMatchObject({
      status: 'copied',
      supersededByNaturalKeyHash: key('Report.odt'),
    });
    expect([...w.stored.keys()].sort()).toEqual(['t/root:Report.docx', 't/root:Report.odt']);
  });

  it('is never counted as missing, however many passes follow', async () => {
    const w = world([reportUnder.office]);
    await w.pass();
    w.state.listed = [reportUnder.odf];
    const later = [await w.pass(), await w.pass(), await w.pass()];

    for (const pass of later) {
      expect(pass.deletions.map((d) => d.naturalKeyHash)).not.toContain(key('Report.docx'));
      expect(pass.drift, 'not an unexplained absence either').toBe(0);
    }
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Report.docx'));
    expect(old?.absentPasses ?? 0).toBe(0);
    expect(later.slice(1).every((p) => p.earlierExports === 0), 'marked once, not every pass').toBe(true);
  });

  it('is a current copy again when the policy gives its name again, and the other becomes the earlier one', async () => {
    const w = world([reportUnder.office]);
    await w.pass();
    w.state.listed = [reportUnder.odf];
    await w.pass();

    w.state.listed = [reportUnder.office];
    const back = await w.pass();

    expect(back.earlierExports).toBe(1);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', key('Report.docx')))?.supersededByNaturalKeyHash).toBeUndefined();
    expect(await w.ledger.find(TENANT, MAPPING, 'file', key('Report.odt'))).toMatchObject({
      status: 'copied',
      supersededByNaturalKeyHash: key('Report.docx'),
    });
  });

  it('leaves alone a copy that says it belongs to another document', async () => {
    const w = world([{ path: 'Report.docx', sourceRef: 'an-uploaded-file' }]);
    await w.pass();

    w.state.listed = [reportUnder.odf];
    const second = await w.pass();

    expect(second.earlierExports).toBe(0);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', key('Report.docx')))?.supersededByNaturalKeyHash).toBeUndefined();
  });

  it('leaves alone a file that was on the target before the migration came', async () => {
    // `adopted`: the owner's own bytes, whatever their name.
    const w = world([reportUnder.odf]);
    await w.ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'file',
      naturalKeyHash: key('Report.docx'),
      sourceRef: 'doc-1',
      collection: '',
      contentHash: 'theirs',
      targetId: 't/root:Report.docx',
      createdAt: '2026-09-17T00:00:00Z',
      status: 'adopted',
    });

    const pass = await w.pass();

    expect(pass.earlierExports).toBe(0);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', key('Report.docx')))?.supersededByNaturalKeyHash).toBeUndefined();
  });
});

describe('a superseded name that comes back', () => {
  it('is tried again, because the policy was switched back and it is a current name', async () => {
    const w = world([{ ...deckUnder.refuse, fails: 'refused' }]);
    await w.pass();
    w.state.listed = [deckUnder.odf];
    await w.pass();

    // Switched back to `refuse`: the deck is `Deck` again, and refused again.
    w.state.listed = [{ ...deckUnder.refuse, fails: 'refused' }];
    await w.pass();

    const back = await w.ledger.find(TENANT, MAPPING, 'file', key('Deck'));
    expect(back?.status, 'on the Failures screen again, not silently skipped').toBe('failed');
    expect(back?.supersededByNaturalKeyHash).toBeUndefined();
    expect(back?.attemptCount).toBe(2);
    expect((await w.ledger.find(TENANT, MAPPING, 'file', key('Deck.odp')))?.status).toBe('copied');
  });

  it('is classified as a retry, never a skip', () => {
    expect(classifyKnownItem({ status: 'superseded' }, 'v1')).toBe('retry-failed');
  });
});

describe('through the real Google Drive connector', () => {
  const BASE = 'https://drive.test/v3';
  const SLIDES = 'application/vnd.google-apps.presentation';

  /** A one-folder Drive holding one Slides deck, and nothing else. */
  function drive() {
    const deck = { id: DECK, name: 'Deck', mimeType: SLIDES, modifiedTime: '2026-09-20T10:00:00Z' };
    return async (url: string) => {
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
      if (decoded.includes("mimeType!='application/vnd.google-apps.folder'")) return ok({ files: [deck] });
      if (url.includes('?fields=id,name,mimeType')) return ok(deck);
      if (url.includes('/export?mimeType=')) return ok({}, new TextEncoder().encode('an odp deck'));
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => `no fake route for ${url}`,
      };
    };
  }

  it('a deck refused under Office is copied under ODF, and its refusal closes', async () => {
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const common = {
      tenantId: TENANT,
      mappingId: MAPPING,
      target: target(),
      ledger,
      cursors,
      sourceIsAuthorityOnExistence: true,
    };

    // Under `export-office` a Slides export is measured unstable, so it is
    // refused, as the owner's twenty were.
    await runFileSync({
      ...common,
      source: new GoogleDriveSource(drive(), { baseUrl: BASE, nativeFilePolicy: 'export-office' }),
    });
    expect((await ledger.listFailures(TENANT, MAPPING)).map((f) => f.naturalKeyHash)).toEqual([
      key('Deck.pptx'),
    ]);

    // The owner switches the migration to ODF, where a deck is stable.
    const second = await runFileSync({
      ...common,
      source: new GoogleDriveSource(drive(), { baseUrl: BASE, nativeFilePolicy: 'export-odf' }),
    });

    expect(second.created).toBe(1);
    expect(second.superseded).toBe(1);
    expect(await ledger.listFailures(TENANT, MAPPING)).toEqual([]);
    expect((await ledger.find(TENANT, MAPPING, 'file', key('Deck.pptx')))?.status).toBe('superseded');
  });
});
