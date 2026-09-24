// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOCUMENT THAT ARRIVED WITHOUT ITS EXTENSION.
 *
 * A Google Doc's `name` carries no extension, because there is no file for one
 * to describe. Under an export policy there IS one: the bytes that land are
 * ODT, DOCX, SVG or PDF. Copied out under the bare name, the owner's document
 * arrives on Nextcloud as "Voorbeeldtekst" — no icon, no preview, and no
 * application offered when they double-click it. The migration reported a
 * success and delivered something they cannot open.
 *
 * This file pins the third policy (`export-odf`) the owner asked for, the
 * Drawing rendering that no policy had, and the suffix that makes any of it
 * usable:
 *
 *   - `export-odf` renders Docs/Sheets/Slides as ODT/ODS/ODP;
 *   - a Drawing renders as SVG under BOTH document families and PDF under
 *     `export-pdf`, because Drive offers a Drawing nothing else — it was
 *     listed as exportable and mapped by nothing, so the refusal told owners
 *     to "choose a policy that covers it" about a file no policy covered;
 *   - the export's extension is appended to the name, once, and the PATH gets
 *     the same one — the path is the natural key (§10, ADR-0020), so a name
 *     and a key that disagreed about the suffix would copy every document
 *     twice.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource } from './google-drive-source.ts';
import {
  NATIVE_EXPORT_TYPES,
  type DriveTransport,
  type NativeFilePolicy,
} from './google-drive-source.types.ts';

const BASE = 'https://drive.test/v3';
const G = 'application/vnd.google-apps.';

/** A transport that answers one folder listing, and records what was asked. */
function listing(files: ReadonlyArray<Record<string, unknown>>) {
  const calls: string[] = [];
  const transport: DriveTransport = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ files }),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    };
  };
  return { transport, calls };
}

function native(id: string, name: string, kind: string) {
  return { id, name, mimeType: `${G}${kind}`, modifiedTime: '2026-08-01T10:00:00Z' };
}

async function namesUnder(policy: NativeFilePolicy, files: ReadonlyArray<Record<string, unknown>>) {
  const { transport } = listing(files);
  const source = new GoogleDriveSource(transport, { baseUrl: BASE, nativeFilePolicy: policy });
  const { items } = await source.listSince({ path: '' });
  return items.map((i) => ({ name: i.item.name, path: i.item.path }));
}

describe('export-odf renders the OpenDocument family', () => {
  it.each([
    ['document', 'application/vnd.oasis.opendocument.text'],
    // `x-vnd`, not `vnd` — Google's own spelling for the Sheets ODS type, and
    // the one `files.export` accepts. Pinned so it is not tidied into a 400.
    ['spreadsheet', 'application/x-vnd.oasis.opendocument.spreadsheet'],
    ['presentation', 'application/vnd.oasis.opendocument.presentation'],
  ])('a %s exports as %s', (kind, mime) => {
    expect(NATIVE_EXPORT_TYPES['export-odf'][`${G}${kind}`]).toBe(mime);
  });

  it.each([
    ['export-odf', '.odt', '.ods', '.odp'],
    ['export-office', '.docx', '.xlsx', '.pptx'],
    ['export-pdf', '.pdf', '.pdf', '.pdf'],
  ] as const)('%s names the three documents %s / %s / %s', async (policy, doc, sheet, slide) => {
    const out = await namesUnder(policy, [
      native('d', 'Voorbeeldtekst', 'document'),
      native('s', 'Factsheet voorbeeld', 'spreadsheet'),
      native('p', 'Thema-avond', 'presentation'),
    ]);
    expect(out.map((o) => o.name)).toEqual([
      `Voorbeeldtekst${doc}`,
      `Factsheet voorbeeld${sheet}`,
      `Thema-avond${slide}`,
    ]);
  });
});

describe('a Drawing has a rendering at last', () => {
  it('is SVG under both document families — the only vector form Drive offers', () => {
    // Not ODG and not VSDX: Drive answers 400 for both. PNG would be a diagram
    // nobody can edit again.
    expect(NATIVE_EXPORT_TYPES['export-odf'][`${G}drawing`]).toBe('image/svg+xml');
    expect(NATIVE_EXPORT_TYPES['export-office'][`${G}drawing`]).toBe('image/svg+xml');
  });

  it('is PDF under export-pdf, like everything else there', () => {
    expect(NATIVE_EXPORT_TYPES['export-pdf'][`${G}drawing`]).toBe('application/pdf');
  });

  it.each([
    ['export-odf', '.svg'],
    ['export-office', '.svg'],
    ['export-pdf', '.pdf'],
  ] as const)('lands as %s → %s', async (policy, ext) => {
    const out = await namesUnder(policy, [native('w', 'Organogram', 'drawing')]);
    expect(out[0]?.name).toBe(`Organogram${ext}`);
  });

  it('is no longer refused for want of a rendering', async () => {
    const { transport } = listing([]);
    const source = new GoogleDriveSource(transport, {
      baseUrl: BASE,
      nativeFilePolicy: 'export-office',
    });
    expect(
      source.refusalFor({
        id: 'w',
        name: 'Organogram',
        mimeType: `${G}drawing`,
      }),
      'a drawing under export-office used to be refused as uncovered',
    ).toBeUndefined();
  });
});

describe('the suffix and the natural key agree', () => {
  it('puts the SAME extension on the path as on the name', async () => {
    // The path is the natural key. If `toFileItem` suffixed the name and
    // `childPath` did not, every document would be created once under each
    // spelling — a silent double of the owner's whole Drive.
    const out = await namesUnder('export-odf', [native('d', 'Voorbeeldtekst', 'document')]);
    expect(out[0]?.path).toBe('Voorbeeldtekst.odt');
    expect(out[0]?.name).toBe('Voorbeeldtekst.odt');
  });

  it('does not double a suffix the owner already typed', async () => {
    // Somebody whose Doc is called "Q3 report.pdf" gets one .pdf, not two.
    const out = await namesUnder('export-pdf', [native('d', 'Q3 report.pdf', 'document')]);
    expect(out[0]?.name).toBe('Q3 report.pdf');
  });

  it('matches an existing suffix case-insensitively', async () => {
    // ".PDF" is the same claim as ".pdf", and appending to it would produce
    // "Q3 report.PDF.pdf".
    const out = await namesUnder('export-pdf', [native('d', 'Q3 report.PDF', 'document')]);
    expect(out[0]?.name).toBe('Q3 report.PDF');
  });

  it("keeps a name that ends in ANOTHER format's suffix whole, and adds the real one", async () => {
    // The owner's decision (0042 T8 (c), 2026-09-23): "if those are the
    // original files and work in the target, we keep". The name they gave
    // stays whole, and the LAST suffix is what the bytes are, which is the one
    // Nextcloud types a file by. Stripping or replacing ".xls" would rename
    // their document, and re-key it.
    const out = await namesUnder('export-office', [
      native('s', 'Budget.xls', 'spreadsheet'),
      native('d', 'Notes.rtf', 'document'),
    ]);
    expect(out.map((o) => o.name)).toEqual(['Budget.xls.xlsx', 'Notes.rtf.docx']);
    expect(out.map((o) => o.path)).toEqual(['Budget.xls.xlsx', 'Notes.rtf.docx']);
  });
});

describe('nothing else is renamed', () => {
  it('leaves an ordinary file alone under every policy', async () => {
    // An uploaded .docx already has its extension and is downloaded, not
    // exported. Suffixing it would re-key files that migrate perfectly today.
    for (const policy of ['refuse', 'export-odf', 'export-office', 'export-pdf'] as const) {
      const out = await namesUnder(policy, [
        {
          id: 'f',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: '2048',
          md5Checksum: 'abc',
          modifiedTime: '2026-08-01T10:00:00Z',
        },
      ]);
      expect(out[0]?.name, policy).toBe('report.pdf');
      expect(out[0]?.path, policy).toBe('report.pdf');
    }
  });

  it('leaves a native file alone under refuse, which copies nothing anyway', async () => {
    // Under `refuse` the item is parked, not copied. Renaming it would change
    // the key of a row that exists only to be decided on.
    const out = await namesUnder('refuse', [native('d', 'Voorbeeldtekst', 'document')]);
    expect(out[0]?.name).toBe('Voorbeeldtekst');
  });

  it('leaves a type no policy renders alone — a Form is not a file', async () => {
    const out = await namesUnder('export-odf', [native('f', 'Inschrijving', 'form')]);
    expect(out[0]?.name).toBe('Inschrijving');
  });
});
