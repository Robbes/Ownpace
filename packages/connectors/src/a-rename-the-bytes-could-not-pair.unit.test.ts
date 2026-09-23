// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT PAIRS A RENAMED GOOGLE DOCUMENT (workplan 0042 T10, ADR-0030 amended).
 *
 * A Google Doc, Sheet, Slides deck or Drawing is copied as a fresh export on
 * every pass, and two Office or OpenDocument exports of it are not
 * byte-identical, so its bytes cannot pair it across a rename. Its Drive id
 * can: a rename does not change it. The owner's decision, 2026-09-23: *"Yes,
 * pair renamed Google documents by their Drive id"*.
 *
 * The connector's half: a Google document is listed with its Drive id as
 * `sourceIdentity`, the same id the pass records as its handle, and every
 * other file is listed without one, so its bytes pair it as they always did.
 * `packages/core/src/a-rename-the-bytes-could-not-pair.unit.test.ts` holds the
 * pass to what it does with it.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource } from './google-drive-source.ts';
import type { DriveTransport } from './google-drive-source.types.ts';

const BASE = 'https://drive.test/v3';
const G = 'application/vnd.google-apps.';
const AT = '2026-09-23T10:00:00Z';

const FILES = [
  { id: 'doc-1', name: 'Plan', mimeType: `${G}document`, modifiedTime: AT },
  { id: 'sheet-1', name: 'Budget', mimeType: `${G}spreadsheet`, modifiedTime: AT },
  { id: 'deck-1', name: 'Kickoff', mimeType: `${G}presentation`, modifiedTime: AT },
  { id: 'drawing-1', name: 'Diagram', mimeType: `${G}drawing`, modifiedTime: AT },
  {
    id: 'file-1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: '3',
    md5Checksum: '0123456789abcdef0123456789abcdef',
    modifiedTime: AT,
  },
];

/** A Drive that lists `files` in its root. */
const transport: DriveTransport = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (url.includes('/files?q=') ? { files: FILES } : {}),
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
  text: async () => '',
});

async function listed() {
  const source = new GoogleDriveSource(transport, {
    baseUrl: BASE,
    nativeFilePolicy: 'export-office',
    nativeFilePolicies: { presentation: 'export-odf' },
  });
  const { items } = await source.listSince({ path: '' });
  return Object.fromEntries(items.map((i) => [i.item.path, i.item]));
}

describe('what pairs a renamed Google document', () => {
  it('is its Drive id, the same one the pass records as its handle', async () => {
    const byPath = await listed();
    for (const [path, id] of [
      ['Plan.docx', 'doc-1'],
      ['Budget.xlsx', 'sheet-1'],
      ['Kickoff.odp', 'deck-1'],
      ['Diagram.svg', 'drawing-1'],
    ] as const) {
      expect(byPath[path]?.sourceIdentity, path).toBe(id);
      expect(byPath[path]?.sourceRef, path).toBe(id);
    }
  });

  it('is given to nothing else: a stored file is paired by its bytes', async () => {
    const byPath = await listed();
    expect(byPath['report.pdf']).toBeDefined();
    expect(byPath['report.pdf']).not.toHaveProperty('sourceIdentity');
  });
});
