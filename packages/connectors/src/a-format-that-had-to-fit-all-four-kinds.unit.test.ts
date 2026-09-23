// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FORMAT THAT HAD TO FIT ALL FOUR KINDS (workplan 0042 T9).
 *
 * One export setting covered Docs, Sheets, Slides and Drawings alike, and no
 * editable format carries all four: `export-odf` refuses every Doc and
 * `export-office` every Slides deck, both measured byte-unstable. So somebody
 * who wanted their Docs editable in Word and their decks at all had to choose
 * which kind to lose. The owner's live migration is the case: Office for
 * everything, and every deck parked on the Failures screen.
 *
 * The owner's decision, 2026-09-23: *"a per kind choice makes more sense for
 * the fileformats. Split that up."* These tests hold the connector to it: each
 * kind is named, exported, refused and remembered under its OWN format, and a
 * kind with no format of its own follows the single setting, as every mapping
 * written before this did.
 */

import { describe, it, expect } from 'vitest';
import { statedFailureCategoryOf } from '@openmig/shared';
import { GoogleDriveSource, NativeFileRefused } from './google-drive-source.ts';
import type { DriveTransport, GoogleDriveSourceConfig } from './google-drive-source.types.ts';

const BASE = 'https://drive.test/v3';
const G = 'application/vnd.google-apps.';

const native = (id: string, name: string, kind: string) => ({
  id,
  name,
  mimeType: `${G}${kind}`,
  modifiedTime: '2026-09-23T10:00:00Z',
});

const DOC = native('doc-1', 'Plan', 'document');
const SHEET = native('sheet-1', 'Budget', 'spreadsheet');
const DECK = native('deck-1', 'Kickoff', 'presentation');
const DRAWING = native('drawing-1', 'Diagram', 'drawing');
const FORM = native('form-1', 'Signup', 'form');
const ALL = [DOC, SHEET, DECK, DRAWING];

/**
 * A Drive that lists `files` in its root, answers each file's metadata by id,
 * and hands back three bytes for any export — recording every URL asked.
 */
function drive(files: ReadonlyArray<Record<string, unknown>>) {
  const calls: string[] = [];
  const transport: DriveTransport = async (url) => {
    calls.push(url);
    const byId = files.find((f) => url.includes(`/files/${String(f['id'])}?fields=`));
    const body = url.includes('/files?q=') ? { files } : (byId ?? {});
    return {
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
      text: async () => '',
    };
  };
  return { transport, calls };
}

/** The owner's choice: Docs and Sheets as Office, decks as ODF, Drawings as Office's SVG. */
const EDITABLE: GoogleDriveSourceConfig = {
  baseUrl: BASE,
  nativeFilePolicy: 'export-office',
  nativeFilePolicies: { presentation: 'export-odf' },
};

const itemFor = (file: { id: string; name: string }) => ({
  path: file.name,
  isDirectory: false,
  size: 0,
  modifiedAt: '2026-09-23T10:00:00Z',
  sourceRef: file.id,
});

async function listed(config: GoogleDriveSourceConfig, files = ALL) {
  const source = new GoogleDriveSource(drive(files).transport, config);
  const { items } = await source.listSince({ path: '' });
  return { source, items: items.map((i) => i.item) };
}

describe('each kind in its own format', () => {
  it('carries all four kinds, editable, where no single format could', async () => {
    const { source, items } = await listed(EDITABLE);
    // Every one listed under the name its OWN format gives it. The deck is
    // `.odp` although the single setting says Office.
    expect(items.map((i) => i.name)).toEqual([
      'Plan.docx',
      'Budget.xlsx',
      'Kickoff.odp',
      'Diagram.svg',
    ]);
    // And the preflight counts nothing left behind. Under the single setting
    // alone it counted the deck until 2026-09-23, when the refusal of a
    // measured-unstable export went (ADR-0046, amended); now one format can
    // carry all four too.
    expect(source.nativeRefusals()).toEqual({});
    const single = await listed({ baseUrl: BASE, nativeFilePolicy: 'export-office' });
    expect(single.source.nativeRefusals()).toEqual({});
  });

  it('exports the deck as ODF and the Doc as Office, from one source', async () => {
    const { transport, calls } = drive(ALL);
    const source = new GoogleDriveSource(transport, EDITABLE);

    await source.fetch(itemFor(DECK));
    await source.fetch(itemFor(DOC));

    const exports = calls.filter((url) => url.includes('/export')).map(decodeURIComponent);
    expect(exports).toHaveLength(2);
    expect(exports[0]).toContain('/files/deck-1/export');
    expect(exports[0]).toContain('application/vnd.oasis.opendocument.presentation');
    expect(exports[1]).toContain('/files/doc-1/export');
    expect(exports[1]).toContain('wordprocessingml');
  });

  it('lets a Doc out under ODF when Docs alone go to Office', async () => {
    // The mirror image: the single setting is the one that refuses Docs, and
    // the Doc's own format carries it.
    const config: GoogleDriveSourceConfig = {
      baseUrl: BASE,
      nativeFilePolicy: 'export-odf',
      nativeFilePolicies: { document: 'export-office' },
    };
    const { source, items } = await listed(config);
    expect(items.map((i) => i.name)).toEqual([
      'Plan.docx',
      'Budget.ods',
      'Kickoff.odp',
      'Diagram.svg',
    ]);
    expect(source.nativeRefusals()).toEqual({});
    expect(source.refusalFor(DOC)).toBeUndefined();
  });

  it('refuses a kind set to refuse, and exports the rest', async () => {
    const config: GoogleDriveSourceConfig = {
      baseUrl: BASE,
      nativeFilePolicy: 'export-pdf',
      nativeFilePolicies: { drawing: 'refuse' },
    };
    const { source, items } = await listed(config);
    // Left under its own name, as a refused file always is.
    expect(items.map((i) => i.name)).toEqual(['Plan.pdf', 'Budget.pdf', 'Kickoff.pdf', 'Diagram']);
    expect(source.nativeRefusals()).toEqual({ drawing: 1 });

    const refusal = source.refusalFor(DRAWING);
    expect(refusal).toBeInstanceOf(NativeFileRefused);
    expect(refusal?.message).toMatch(/set not to export/);
    expect(statedFailureCategoryOf(refusal)).toBe('policy_refused');
    expect(source.refusalFor(DOC)).toBeUndefined();
  });

  it('exports a measured-unstable pair, as a kind’s own choice or the single one', async () => {
    // Refused until 2026-09-23: Slides under Office, Docs under OpenDocument.
    // Their exports differ between draws, and that no longer matters: a rewrite
    // follows Drive's modified time (ADR-0046, amended).
    const config: GoogleDriveSourceConfig = {
      baseUrl: BASE,
      nativeFilePolicy: 'export-odf',
      nativeFilePolicies: { presentation: 'export-office' },
    };
    const { transport, calls } = drive(ALL);
    const source = new GoogleDriveSource(transport, config);

    await source.fetch(itemFor(DECK));
    await source.fetch(itemFor(DOC));
    const exports = calls.filter((url) => url.includes('/export')).map(decodeURIComponent);
    expect(exports).toHaveLength(2);
    expect(exports[0]).toContain('presentationml');
    expect(exports[1]).toContain('application/vnd.oasis.opendocument.text');
    expect(source.refusalFor(DECK)).toBeUndefined();
    expect(source.refusalFor(DOC)).toBeUndefined();
  });

  it('gives a Form no way out, whatever each kind is set to', () => {
    const source = new GoogleDriveSource(drive([FORM]).transport, {
      baseUrl: BASE,
      nativeFilePolicies: {
        document: 'export-pdf',
        spreadsheet: 'export-pdf',
        presentation: 'export-pdf',
        drawing: 'export-pdf',
      },
    });
    const refusal = source.refusalFor(FORM);
    expect(refusal).toBeInstanceOf(NativeFileRefused);
    expect(statedFailureCategoryOf(refusal)).toBe('source_refused');
  });
});

describe('a kind with no format of its own', () => {
  it('follows the single setting, so a mapping written before this reads as it did', async () => {
    const before = await listed({ baseUrl: BASE, nativeFilePolicy: 'export-office' });
    const after = await listed({
      baseUrl: BASE,
      nativeFilePolicy: 'export-office',
      nativeFilePolicies: {},
    });
    expect(after.items).toEqual(before.items);
    expect(after.source.nativeRefusals()).toEqual(before.source.nativeRefusals());
  });

  it('is refused when neither says anything, as the default always was', async () => {
    const { source } = await listed({
      baseUrl: BASE,
      nativeFilePolicies: { presentation: 'export-odf' },
    });
    expect(source.nativeRefusals()).toEqual({ document: 1, spreadsheet: 1, drawing: 1 });
    expect(source.refusalFor(DECK)).toBeUndefined();
  });
});

describe('the names a document had before', () => {
  it('are the other formats’ names, never the one its own kind is in', async () => {
    // What lets a switch close the refusals left under an old name
    // (0042 T8 (b)): the deck is `.odp` now, and the names it could have had
    // are under refuse, Office and PDF.
    const { items } = await listed(EDITABLE, [DECK]);
    expect(items[0]!.path).toBe('Kickoff.odp');
    expect([...(items[0]!.formerPaths ?? [])].sort()).toEqual([
      'Kickoff',
      'Kickoff.pdf',
      'Kickoff.pptx',
    ]);
  });
});
