// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE NAMES A GOOGLE DOCUMENT WOULD HAVE HAD (workplan 0042 T8 (b)).
 *
 * The export policy decides a native document's suffix, and the path is the
 * natural key, so a policy switch lists the same document under a new key.
 * `formerPaths` is how the pass learns the keys it used to have, and it is only
 * as good as this list: a name missing here is a failure that never closes, and
 * a name that is not the document's is a failure closed for a file that still
 * needs it. So each policy's name is pinned, and so are the two cases where
 * a name coincides with the current one.
 */

import { describe, it, expect } from 'vitest';
import { GoogleDriveSource } from './google-drive-source.ts';
import type { NativeFilePolicy } from './google-drive-source.types.ts';

const BASE = 'https://drive.test/v3';

interface Listed {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
}

function drive(files: ReadonlyArray<Listed>) {
  return async (url: string) => {
    const ok = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    });
    const decoded = decodeURIComponent(url);
    if (url.includes('/files/root?fields=id')) return ok({ id: 'drive-root' });
    if (decoded.includes("mimeType='application/vnd.google-apps.folder'")) return ok({ files: [] });
    if (decoded.includes("mimeType!='application/vnd.google-apps.folder'")) {
      return ok({ files: files.map((f) => ({ ...f, modifiedTime: '2026-09-20T10:00:00Z' })) });
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => `no fake route for ${url}`,
    };
  };
}

/** Each listed item's path and former paths, under `policy`. */
async function listed(files: ReadonlyArray<Listed>, policy: NativeFilePolicy) {
  const source = new GoogleDriveSource(drive(files), { baseUrl: BASE, nativeFilePolicy: policy });
  const [root] = await source.listFolders();
  const { items } = await source.listSince(root!);
  return Object.fromEntries(items.map((i) => [i.item.path, i.item.formerPaths]));
}

const SLIDES = { id: 'deck-1', name: 'Deck', mimeType: 'application/vnd.google-apps.presentation' };

describe('a Google document’s names under the other policies', () => {
  it('a Slides deck under Office has been, or would be, Deck, Deck.odp and Deck.pdf', async () => {
    expect(await listed([SLIDES], 'export-office')).toEqual({
      'Deck.pptx': ['Deck', 'Deck.odp', 'Deck.pdf'],
    });
  });

  it('the same deck when refused would be Deck.odp, Deck.pptx or Deck.pdf under a format', async () => {
    expect(await listed([SLIDES], 'refuse')).toEqual({
      Deck: ['Deck.odp', 'Deck.pptx', 'Deck.pdf'],
    });
  });

  it('a Drawing leaves out the name its current policy shares with another', async () => {
    // Office and ODF both ask Drive for SVG, so under Office the ODF name IS
    // the current one, and a document is never its own former name.
    const drawing = { id: 'dr-1', name: 'Diagram', mimeType: 'application/vnd.google-apps.drawing' };
    expect(await listed([drawing], 'export-office')).toEqual({
      'Diagram.svg': ['Diagram', 'Diagram.pdf'],
    });
  });

  it('a document named with its own suffix keeps it, and the refused name is the same key', async () => {
    // Under `refuse` a Doc called `Notes.docx` is listed as `Notes.docx`, which
    // is also its name under Office: one key, one row, nothing to supersede.
    const notes = { id: 'n-1', name: 'Notes.docx', mimeType: 'application/vnd.google-apps.document' };
    expect(await listed([notes], 'export-office')).toEqual({
      'Notes.docx': ['Notes.docx.odt', 'Notes.docx.pdf'],
    });
  });

  it('a file whose name is its own has none', async () => {
    const pdf = { id: 'p-1', name: 'Scan.pdf', mimeType: 'application/pdf' };
    expect(await listed([pdf], 'export-office')).toEqual({ 'Scan.pdf': undefined });
  });
});
