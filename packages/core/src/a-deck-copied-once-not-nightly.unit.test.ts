// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DECK COPIED ONCE, NOT NIGHTLY (workplan 0042 T10 (c), ADR-0046 amended).
 *
 * Two exports of an unchanged Google Slides deck under Office are not the same
 * bytes (five `.pptx` members move between draws), and neither are two of a
 * Doc under OpenDocument (`settings.xml`). While a rewrite followed the bytes,
 * copying either meant copying it again on every pass, so both were refused
 * from 2026-09-16, and the owner's decks sat on the Failures screen.
 *
 * A rewrite has followed Drive's own `modifiedTime` since #1083, and a renamed
 * document has been paired by its Drive id since ADR-0030's amendment, so the
 * refusal protected nothing and went (2026-09-23). This file is what holds the
 * nightly rewrite off now, end to end: the real Drive connector, the real file
 * pass, and exports that differ on EVERY fetch.
 */

import { describe, it, expect } from 'vitest';
import { asMappingId, asTenantId, type RawFileItem, type UpsertResult } from '@openmig/shared';
import { GoogleDriveSource, type DriveTransport } from '@openmig/connectors';
import { runFileSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('0e200000-e29b-41d4-a716-446655443a01');
const MAPPING = asMappingId('0e200000-e29b-41d4-a716-446655443a02');
const G = 'application/vnd.google-apps.';

function world() {
  const files = [
    { id: 'deck-1', name: 'Kickoff', mimeType: `${G}presentation`, modifiedTime: '2026-09-20T10:00:00Z' },
    { id: 'doc-1', name: 'Plan', mimeType: `${G}document`, modifiedTime: '2026-09-20T10:00:00Z' },
  ];
  const exported: string[] = [];
  const transport: DriveTransport = async (url) => {
    const query = decodeURIComponent(url);
    const byId = files.find((f) => url.includes(`/files/${f.id}?fields=`));
    // One folder, the root, holding both documents: a query for subfolders,
    // or for the bin, finds nothing, as Drive's own filter would.
    const listed = query.includes("mimeType='application/vnd.google-apps.folder'") ||
      query.includes('trashed=true')
      ? []
      : files;
    const body = url.includes('/files?q=') ? { files: listed } : (byId ?? {});
    const exportOf = files.find((f) => url.includes(`/files/${f.id}/export`));
    if (exportOf) exported.push(exportOf.name);
    // A fresh export every time: never the same bytes twice.
    const bytes = new TextEncoder().encode(`${exportOf?.id ?? ''} draw ${exported.length}`);
    return {
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => bytes.buffer as ArrayBuffer,
      text: async () => '',
    };
  };
  // The two combinations that were refused: a deck under Office, a Doc under
  // OpenDocument.
  const source = new GoogleDriveSource(transport, {
    baseUrl: 'https://drive.test/v3',
    nativeFilePolicy: 'export-office',
    nativeFilePolicies: { document: 'export-odf' },
  });
  const written: string[] = [];
  const target = {
    ensureDirectory: async () => 't/root',
    upsertFile: async (_parent: string, raw: RawFileItem): Promise<UpsertResult> => {
      written.push(raw.item.path);
      return { targetId: `t/${raw.item.path}`, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
  const ledger = new MemoryLedger();
  const pass = () =>
    runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger,
      sourceIsAuthorityOnExistence: true,
    });
  return { files, exported, written, pass };
}

describe('a Google document whose exports never agree', () => {
  it('is copied, where it used to be refused', async () => {
    const w = world();
    const first = await w.pass();
    expect(first.failed).toBe(0);
    expect(first.created).toBe(2);
    expect([...w.written].sort()).toEqual(['Kickoff.pptx', 'Plan.odt']);
  });

  it('is not copied again while Drive says nobody edited it', async () => {
    const w = world();
    await w.pass();
    const exportsAfterFirst = w.exported.length;
    for (const n of [2, 3, 4]) {
      const again = await w.pass();
      expect(again.created, `pass ${n}`).toBe(0);
      expect(again.updated, `pass ${n}`).toBe(0);
      expect(again.failed, `pass ${n}`).toBe(0);
    }
    // Not even exported: the version decides before anything is fetched.
    expect(w.exported).toHaveLength(exportsAfterFirst);
    expect(w.written).toHaveLength(2);
  });

  it('is copied again once, when Drive says it was edited', async () => {
    const w = world();
    await w.pass();
    await w.pass();
    const deck = w.files.find((f) => f.id === 'deck-1')!;
    deck.modifiedTime = '2026-09-23T09:00:00Z';

    const edited = await w.pass();
    expect(edited.updated).toBe(1);
    expect(w.written).toEqual(expect.arrayContaining(['Kickoff.pptx']));
    expect(w.written.filter((path) => path === 'Kickoff.pptx')).toHaveLength(2);
    expect(w.written.filter((path) => path === 'Plan.odt')).toHaveLength(1);

    const after = await w.pass();
    expect(after.updated).toBe(0);
  });
});
