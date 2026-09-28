// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAPER DOC REFUSED BY NAME (workplan 0150 T5, the alpha minimum).
 *
 * The owner's Dropbox migration met a Paper doc on 2026-09-25. Dropbox will
 * not hand one over through `files/download`, and answered, word for word as
 * the owner read it back on 2026-09-28:
 *
 *   409 {"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"}
 *
 * The source threw that as a bare `Error`. With no stated category the row
 * read `source_refused`, whose remedy says the old account would not hand the
 * file over and to try again if that changed. With no decision mark it was
 * tried on five passes and then waited on a person, never parked.
 *
 * What this holds, against a fake transport that answers as Dropbox does:
 *
 *  1. The listing reads Dropbox's own mark, `is_downloadable: false`, and the
 *     formats `export_info` offers.
 *  2. `fetch` refuses such a file before any download is asked for, and
 *     before the size chooses a stream, so the refusal stays the source's.
 *  3. The refusal is a decision with a stated category: `policy_refused` for
 *     a Paper doc (D9) and for any kind Dropbox exports, `source_refused` for
 *     a kind it offers no export for (D5). It names the file and the kind.
 *  4. A file the listing did not mark, answered with that same 409, is
 *     refused the same way; any other answer stays an ordinary failure.
 *  5. Every file Dropbox does hand over is downloaded as before.
 */

import { describe, it, expect } from 'vitest';
import { isDecisionError, statedFailureCategoryOf, type FileItem } from '@openmig/shared';
import { DropboxFileSource, DropboxNativeRefused } from './dropbox-file-source.ts';
import type { DropboxEntry, DropboxTransport } from './dropbox-file-source.types.ts';

const API = 'https://api.test/2';
const CONTENT = 'https://content.test/2';

/** The owner's answer, as Dropbox gave it. */
const UNSUPPORTED_FILE = '{"error":{".tag":"unsupported_file"},"error_summary":"unsupported_file/"}';

/** One folder, listed as given, and every download answered as `download` says. */
function fakeDropbox(
  entries: DropboxEntry[],
  download: { status: number; body: string } = { status: 200, body: '' },
) {
  const downloads: string[] = [];
  const transport: DropboxTransport = async (url, init) => {
    if (url.endsWith('/files/download')) {
      downloads.push(JSON.parse(init.headers['Dropbox-API-Arg'] ?? '{}').path as string);
      const ok = download.status === 200;
      return {
        ok,
        status: download.status,
        json: async () => ({}),
        arrayBuffer: async () => new Uint8Array([7, 7, 7]).buffer as ArrayBuffer,
        text: async () => download.body,
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ entries, cursor: 'end', has_more: false }),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    };
  };
  const source = new DropboxFileSource(transport, { apiBaseUrl: API, contentBaseUrl: CONTENT });
  return { source, downloads };
}

const file = (name: string, over: Partial<DropboxEntry> = {}): DropboxEntry => ({
  '.tag': 'file',
  id: `id:${name}`,
  name,
  path_display: `/${name}`,
  size: 1_000,
  server_modified: '2026-09-25T10:00:00Z',
  content_hash: `hash-${name}`,
  ...over,
});

const PAPER = file('Notes.paper', {
  is_downloadable: false,
  export_info: { export_as: 'markdown', export_options: ['markdown', 'html'] },
});

async function listed(source: DropboxFileSource): Promise<FileItem[]> {
  return (await source.listSince({ path: '' })).items.map((raw) => raw.item);
}

async function refusal(source: DropboxFileSource, item: FileItem): Promise<unknown> {
  try {
    await source.fetch(item);
  } catch (err) {
    return err;
  }
  throw new Error(`fetch handed "${item.path}" over instead of refusing it`);
}

describe('the listing reads what Dropbox says about a file it will not download', () => {
  it('marks a Paper doc with its kind and the formats Dropbox offers', async () => {
    const { source } = fakeDropbox([PAPER, file('letter.pdf')]);
    const [paper, letter] = await listed(source);
    expect(paper).toMatchObject({
      path: 'Notes.paper',
      exportOnly: { kind: 'paper', formats: ['markdown', 'html'] },
    });
    expect(letter).not.toHaveProperty('exportOnly');
  });

  it('marks only an explicit false: a file that says nothing is downloadable, as before', async () => {
    const { source } = fakeDropbox([
      file('said-yes.pdf', { is_downloadable: true }),
      file('said-nothing.pdf'),
    ]);
    for (const item of await listed(source)) expect(item).not.toHaveProperty('exportOnly');
  });
});

describe('a file Dropbox hands over only as an export is refused before any download', () => {
  it('refuses a Paper doc by name, as a policy_refused decision, and asks Dropbox nothing', async () => {
    const { source, downloads } = fakeDropbox([PAPER]);
    const [paper] = await listed(source);
    const err = await refusal(source, paper!);

    expect(err).toBeInstanceOf(DropboxNativeRefused);
    expect(isDecisionError(err)).toBe(true);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    // Since 0150 T3 (d) it names the setting that changes the answer, by the
    // words on the migration's page, as Drive's sentence does.
    expect((err as Error).message).toBe(
      '"Notes.paper" is a Dropbox Paper doc: it has no file to copy until Dropbox exports one, and ' +
        'this migration is set not to export Paper docs. Choose a format under Export format for ' +
        'Paper docs, and the next pass copies it in that format and closes this line, or leave ' +
        'it behind.',
    );
    expect(downloads).toEqual([]);
  });

  it('refuses one listed above the streaming size the same way, before a stream is chosen', async () => {
    // Above 8 MB a file is streamed, and its download happens inside `open()`,
    // under the destination's write. A refusal there would be recorded as the
    // destination's.
    const { source, downloads } = fakeDropbox([{ ...PAPER, size: 50 * 1024 * 1024 }]);
    const [paper] = await listed(source);
    const err = await refusal(source, paper!);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    expect(isDecisionError(err)).toBe(true);
    expect(downloads).toEqual([]);
  });

  it('names a Paper template as one', async () => {
    const { source } = fakeDropbox([
      file('Weekly.papert', { is_downloadable: false, export_info: { export_as: 'markdown' } }),
    ]);
    const [template] = await listed(source);
    const err = await refusal(source, template!);
    expect((err as Error).message).toContain('"Weekly.papert" is a Dropbox Paper template: it has no file to copy');
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
  });

  it('refuses another kind Dropbox exports as policy_refused, naming its extension', async () => {
    const { source } = fakeDropbox([
      file('Budget.gsheet', { is_downloadable: false, export_info: { export_as: 'xlsx' } }),
    ]);
    const [sheet] = await listed(source);
    const err = await refusal(source, sheet!);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    expect(isDecisionError(err)).toBe(true);
    expect((err as Error).message).toContain(
      '"Budget.gsheet" is a document Dropbox keeps in a format of its own (.gsheet).',
    );
  });

  it('refuses a kind Dropbox offers no export for as source_refused: no setting would help', async () => {
    const { source, downloads } = fakeDropbox([file('Shortcut.web', { is_downloadable: false })]);
    const [web] = await listed(source);
    const err = await refusal(source, web!);
    expect(statedFailureCategoryOf(err)).toBe('source_refused');
    expect(isDecisionError(err)).toBe(true);
    expect((err as Error).message).toBe(
      '"Shortcut.web" cannot be downloaded from Dropbox, and Dropbox offers no export for it, so ' +
        'there is no file to copy. Accept leaving it behind.',
    );
    expect(downloads).toEqual([]);
  });
});

describe('Dropbox refusing the download itself', () => {
  it('is the same refusal when the listing did not mark the file: the answer the owner met', async () => {
    const { source, downloads } = fakeDropbox([file('Notes.paper')], {
      status: 409,
      body: UNSUPPORTED_FILE,
    });
    const [paper] = await listed(source);
    const err = await refusal(source, paper!);
    expect(downloads).toEqual(['id:Notes.paper']);
    expect(err).toBeInstanceOf(DropboxNativeRefused);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    expect(isDecisionError(err)).toBe(true);
  });

  it('stays an ordinary failure for any other answer: retried, and read from its words', async () => {
    for (const body of ['{"error":{".tag":"restricted_content"}}', '{"error":{}}', 'not json']) {
      const { source } = fakeDropbox([file('letter.pdf')], { status: 409, body });
      const [letter] = await listed(source);
      const err = await refusal(source, letter!);
      expect(err, body).not.toBeInstanceOf(DropboxNativeRefused);
      expect(isDecisionError(err), body).toBe(false);
      expect(statedFailureCategoryOf(err), body).toBeUndefined();
      expect((err as Error).message).toContain('Dropbox refused the download of "letter.pdf" (409)');
    }
  });

  it('downloads every file Dropbox hands over, as before', async () => {
    const { source, downloads } = fakeDropbox([file('letter.pdf', { is_downloadable: true })]);
    const [letter] = await listed(source);
    const raw = await source.fetch(letter!);
    expect(raw.content).toEqual(new Uint8Array([7, 7, 7]));
    expect(downloads).toEqual(['id:letter.pdf']);
  });
});
