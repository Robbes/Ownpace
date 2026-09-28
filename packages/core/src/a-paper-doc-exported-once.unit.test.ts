// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAPER DOC EXPORTED ONCE (workplan 0150 T3 (b) and T4, through the real
 * sync loop and the real Dropbox source).
 *
 * The connector's guard, `a-paper-doc-that-arrives`, holds what the source
 * lists and fetches. This holds what the loop then makes of it, against a
 * Dropbox that exports a Paper doc as Markdown, with bytes that differ on
 * every export, as nothing promises they will not:
 *
 *  - the first pass writes `Notes.paper.md`, and the next one writes and
 *    exports nothing, because the listing's version decides (ADR-0046);
 *  - an edit in Paper moves that version, and the doc is exported again;
 *  - a Paper doc parked by name before a format was chosen is copied once one
 *    is, and its parked row is closed, not left on the Failures page;
 *  - a format switched later copies it again under the new name, and the copy
 *    in the old format stays, as an earlier export, never as a deletion (T3 (c));
 *  - a renamed Paper doc is paired by its Dropbox id and reported as moved,
 *    never as deleted in Dropbox (D8).
 */

import { describe, it, expect } from 'vitest';
import {
  asMappingId,
  asTenantId,
  fileNaturalKeyHash,
  type FileFolder,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import {
  DropboxFileSource,
  type DropboxEntry,
  type DropboxPaperPolicy,
  type DropboxTransport,
} from '@openmig/connectors';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import { runFileSync } from './dav-sync.ts';

const TENANT = asTenantId('0150e700-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0150e700-e29b-41d4-a716-446655440002');

const key = (path: string) => fileNaturalKeyHash(path);

const file = (name: string, over: Partial<DropboxEntry> = {}): DropboxEntry => ({
  '.tag': 'file',
  id: `id:${name}`,
  name,
  path_display: `/${name}`,
  size: 100,
  server_modified: '2026-09-25T10:00:00Z',
  content_hash: `hash-${name}`,
  ...over,
});

const paper = (name: string, over: Partial<DropboxEntry> = {}): DropboxEntry =>
  file(name, {
    is_downloadable: false,
    export_info: { export_as: 'markdown', export_options: ['markdown', 'html'] },
    ...over,
  });

/** A Dropbox whose listing the test changes between passes, and a target that keeps what it is sent. */
function world(initial: DropboxEntry[]) {
  const state = { entries: [...initial], exports: 0, downloads: 0 };
  const transport: DropboxTransport = async (url) => {
    if (url.endsWith('/files/export')) {
      state.exports += 1;
      // Bytes that differ on every export: nothing promises they will not.
      const bytes = new TextEncoder().encode(`# Notes\n\nexport ${state.exports}\n`);
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
        text: async () => '',
      };
    }
    if (url.endsWith('/files/download')) {
      state.downloads += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
        text: async () => '',
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ entries: state.entries, cursor: 'end', has_more: false }),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    };
  };
  const source = (policy: DropboxPaperPolicy) =>
    new DropboxFileSource(transport, {
      apiBaseUrl: 'https://api.test/2',
      contentBaseUrl: 'https://content.test/2',
      nativeFilePolicies: { paper: policy },
    });
  const stored = new Map<string, Uint8Array>();
  const ledger = new MemoryLedger();

  async function pass(policy: DropboxPaperPolicy = 'markdown') {
    const written: string[] = [];
    const target = {
      ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
      upsertFile: async (parentId: string, raw: RawFileItem): Promise<UpsertResult> => {
        written.push(raw.item.path);
        const at = `${parentId}:${raw.item.path}`;
        const existed = stored.has(at);
        stored.set(at, raw.content ?? new Uint8Array());
        return existed ? { targetId: at, created: false, adopted: true } : { targetId: at, created: true };
      },
      findFileByNaturalKey: async () => undefined,
    };
    const result = await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: source(policy),
      target,
      ledger,
      cursors: new MemoryCursorStore(),
      concurrency: 1,
      sourceIsAuthorityOnExistence: true,
    });
    return { result, written };
  }
  return { state, stored, ledger, pass };
}

describe('a Paper doc exported as Markdown, through the sync loop', () => {
  it('is written once as Notes.paper.md, and the next pass writes and exports nothing', async () => {
    const w = world([paper('Notes.paper'), file('letter.pdf')]);
    const first = await w.pass();
    expect([...first.written].sort()).toEqual(['Notes.paper.md', 'letter.pdf']);
    expect(w.state.exports).toBe(1);
    expect(new TextDecoder().decode(w.stored.get('t/root:Notes.paper.md'))).toBe('# Notes\n\nexport 1\n');
    expect(first.result.needsDecision).toBe(0);

    const second = await w.pass();
    expect(second.written).toEqual([]);
    expect(w.state.exports).toBe(1);
    expect(await w.ledger.listFailures(TENANT, MAPPING, 'file')).toEqual([]);
  });

  it('is exported again after an edit in Paper, which moves the version the listing gives', async () => {
    const w = world([paper('Notes.paper')]);
    await w.pass();
    w.state.entries = [
      paper('Notes.paper', { server_modified: '2026-09-28T14:00:00Z', content_hash: 'hash-edited' }),
    ];
    const edited = await w.pass();
    expect(edited.written).toEqual(['Notes.paper.md']);
    expect(w.state.exports).toBe(2);
    expect(new TextDecoder().decode(w.stored.get('t/root:Notes.paper.md'))).toBe('# Notes\n\nexport 2\n');
  });

  it('closes the row it parked before a format was chosen, once it is copied under one', async () => {
    const w = world([paper('Notes.paper'), file('letter.pdf')]);
    const refused = await w.pass('refuse');
    expect(refused.written).toEqual(['letter.pdf']);
    expect(refused.result.needsDecision).toBe(1);
    const [parked] = await w.ledger.listFailures(TENANT, MAPPING, 'file');
    expect(parked).toMatchObject({ category: 'policy_refused', needsDecision: true });

    const chosen = await w.pass('markdown');
    expect(chosen.written).toEqual(['Notes.paper.md']);
    expect(await w.ledger.listFailures(TENANT, MAPPING, 'file')).toEqual([]);
  });

  it('is copied again under its new name when the format is switched, and the old copy is an earlier export', async () => {
    // What the revision rule tells a person who switches the format (T3 (c)):
    // the copy in the old format stays, and is never read as deleted in Dropbox.
    const w = world([paper('Notes.paper')]);
    await w.pass('markdown');
    const switched = await w.pass('html');
    expect(switched.written).toEqual(['Notes.paper.html']);
    expect(switched.result.earlierExports).toBe(1);
    expect(switched.result.deletions).toEqual([]);
    expect(switched.result.moves).toEqual([]);
    expect(w.stored.has('t/root:Notes.paper.md'), 'nothing on the target is removed').toBe(true);

    const next = await w.pass('html');
    expect(next.written).toEqual([]);
    expect(next.result.deletions).toEqual([]);
    expect(next.result.earlierExports, 'marked once, not every pass').toBe(0);
  });

  it('is reported as moved when renamed in Dropbox, paired by its id, never as deleted', async () => {
    const w = world([paper('Notes.paper')]);
    await w.pass();
    // Renamed in Dropbox: the same id under a new name. Its next export has other bytes.
    w.state.entries = [paper('Plan.paper', { id: 'id:Notes.paper' })];
    const renamed = await w.pass();
    expect(renamed.written).toEqual(['Plan.paper.md']);
    expect(renamed.result.moves).toEqual([
      expect.objectContaining({ naturalKeyHash: key('Notes.paper.md'), toNaturalKeyHash: key('Plan.paper.md') }),
    ]);
    expect(renamed.result.deletions).toEqual([]);
    const old = await w.ledger.find(TENANT, MAPPING, 'file', key('Notes.paper.md'));
    expect(old).toMatchObject({ movedToNaturalKeyHash: key('Plan.paper.md'), movedByIdentity: true });
  });
});
