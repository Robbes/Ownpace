// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAPER DOC THAT ARRIVES (workplan 0150 T3 (b) and T4; the owner, on
 * 2026-09-28: "yes, paper export before the alpha").
 *
 * Until this, a Paper doc was refused by name whatever the migration said
 * (T5): Dropbox hands one over only through `files/export`, and nothing here
 * asked for one. Now a migration can choose the format Paper docs arrive in,
 * Markdown or HTML, and the source exports each one in it.
 *
 * What this holds, against a fake Dropbox that answers as the API says:
 *
 *  1. The name is chosen at listing, the suffix appended (D4): `Notes.paper`
 *     arrives as `Notes.paper.md`, and the key is that name. The names under
 *     the other policies ride along as `formerPaths`, and the Dropbox id as
 *     the identity that pairs a rename (D8).
 *  2. The export is one `files/export` call, by id, in the format chosen,
 *     buffered and before the size picks a stream, with the export's own
 *     length (T4). Its bytes are a rendering (ADR-0046).
 *  3. A format Dropbox does not offer for a file is refused as the setting's
 *     doing, before any request; so is Dropbox's `invalid_export_format`.
 *     Every other refusal stays an ordinary failure, retried (D2).
 *  4. With no format chosen nothing changes: the name is the file's own, and
 *     it is refused as before (D1). A kind that is not Paper is never renamed.
 *  5. A deleted Paper doc is evidence under both names, since a tombstone
 *     carries no export information.
 *  6. A format this source does not know stops it at construction.
 */

import { describe, it, expect } from 'vitest';
import { isDecisionError, statedFailureCategoryOf, type FileItem } from '@openmig/shared';
import { DropboxFileSource, DropboxNativeRefused } from './dropbox-file-source.ts';
import type { DropboxEntry, DropboxPaperPolicy, DropboxTransport } from './dropbox-file-source.types.ts';
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';

const API = 'https://api.test/2';
const CONTENT = 'https://content.test/2';

/** What an export of each format answers with. */
const EXPORTED: Record<string, Uint8Array> = {
  markdown: new TextEncoder().encode('# Notes\n\nA line.\n'),
  html: new TextEncoder().encode('<h1>Notes</h1><p>A line.</p>'),
};

interface Call {
  url: string;
  arg: Record<string, unknown>;
  body?: string;
}

/**
 * One folder, listed as given (live entries, and tombstones when deleted ones
 * are asked for). Downloads answer three bytes; exports answer as `answers`
 * says, else the format's bytes.
 */
function fakeDropbox(
  entries: DropboxEntry[],
  policy?: DropboxPaperPolicy,
  answers: Record<string, { status: number; body: string }> = {},
) {
  const calls: Call[] = [];
  const transport: DropboxTransport = async (url, init) => {
    if (url.startsWith(CONTENT)) {
      const arg = JSON.parse(init.headers['Dropbox-API-Arg'] ?? '{}') as Record<string, unknown>;
      calls.push({ url, arg, body: init.body });
      const answer = answers[`${String(arg.path)} ${String(arg.export_format)}`];
      const bytes = url.endsWith('/files/export') ? EXPORTED[String(arg.export_format)]! : new Uint8Array([7, 7, 7]);
      return {
        ok: answer ? answer.status === 200 : true,
        status: answer?.status ?? 200,
        json: async () => ({}),
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
        text: async () => answer?.body ?? '',
      };
    }
    const body = JSON.parse(init.body ?? '{}') as { include_deleted?: boolean };
    const listed = body.include_deleted ? entries : entries.filter((e) => e['.tag'] !== 'deleted');
    return {
      ok: true,
      status: 200,
      json: async () => ({ entries: listed, cursor: 'end', has_more: false }),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
    };
  };
  const source = new DropboxFileSource(transport, {
    apiBaseUrl: API,
    contentBaseUrl: CONTENT,
    ...(policy ? { nativeFilePolicies: { paper: policy } } : {}),
  });
  return { source, calls };
}

const file = (name: string, over: Partial<DropboxEntry> = {}): DropboxEntry => ({
  '.tag': 'file',
  id: `id:${name}`,
  name,
  path_display: `/Werk/${name}`,
  size: 1_000,
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

describe('the name is chosen at listing, with the suffix appended (D4)', () => {
  it('lists a Paper doc under Markdown as Notes.paper.md, naming its other keys and its id', async () => {
    const [doc] = await listed(fakeDropbox([{ ...paper('Notes.paper'), path_display: '/Notes.paper' }], 'markdown').source);
    expect(doc).toMatchObject({
      path: 'Notes.paper.md',
      name: 'Notes.paper.md',
      formerPaths: ['Notes.paper', 'Notes.paper.html'],
      sourceIdentity: 'id:Notes.paper',
      sourceRef: 'id:Notes.paper',
      exportOnly: { kind: 'paper', exportAs: 'markdown' },
    });
  });

  it('lists it under HTML as Notes.paper.html', async () => {
    const [doc] = await listed(fakeDropbox([{ ...paper('Notes.paper'), path_display: '/Notes.paper' }], 'html').source);
    expect(doc).toMatchObject({ path: 'Notes.paper.html', formerPaths: ['Notes.paper', 'Notes.paper.md'] });
  });

  it('keeps the folder: the suffix goes on the name, and the path ends in it', async () => {
    const [doc] = await listed(fakeDropbox([paper('Plan 2026.paper')], 'markdown').source);
    expect(doc?.path).toBe('Werk/Plan 2026.paper.md');
    expect(doc?.formerPaths).toEqual(['Werk/Plan 2026.paper', 'Werk/Plan 2026.paper.html']);
  });

  it('names a Paper template the same way', async () => {
    const [template] = await listed(
      fakeDropbox([paper('Weekly.papert', { export_info: { export_as: 'markdown' } })], 'markdown').source,
    );
    expect(template).toMatchObject({ path: 'Werk/Weekly.papert.md', exportOnly: { kind: 'papert', exportAs: 'markdown' } });
  });

  it("keeps the version the listing gives, whatever the export's bytes (ADR-0046)", async () => {
    const [doc] = await listed(fakeDropbox([paper('Notes.paper')], 'markdown').source);
    const [asListed] = await listed(fakeDropbox([paper('Notes.paper')]).source);
    expect(doc?.etag).toBeDefined();
    expect(doc?.etag).toBe(asListed?.etag);
  });

  it('answers listKeys with the same names', async () => {
    const { source } = fakeDropbox([paper('Notes.paper'), file('letter.pdf')], 'markdown');
    expect(await source.listKeys({ path: '' })).toEqual(['Werk/Notes.paper.md', 'Werk/letter.pdf']);
  });
});

describe('the export (T4)', () => {
  it('is one files/export call, by id, in the format chosen, returned buffered with its own length', async () => {
    const { source, calls } = fakeDropbox([paper('Notes.paper')], 'markdown');
    const [doc] = await listed(source);
    const raw = await source.fetch(doc!);
    expect(calls).toEqual([
      { url: `${CONTENT}/files/export`, arg: { path: 'id:Notes.paper', export_format: 'markdown' }, body: undefined },
    ]);
    expect(raw.content).toEqual(EXPORTED.markdown);
    expect(raw.body).toBeUndefined();
    expect(raw.item.size).toBe(EXPORTED.markdown!.byteLength);
    expect(raw.item.path).toBe('Werk/Notes.paper.md');
    expect(raw.rendering).toBe(true);
  });

  it('asks for HTML when HTML is chosen', async () => {
    const { source, calls } = fakeDropbox([paper('Notes.paper')], 'html');
    const [doc] = await listed(source);
    const raw = await source.fetch(doc!);
    expect(calls.map((c) => c.arg.export_format)).toEqual(['html']);
    expect(raw.content).toEqual(EXPORTED.html);
  });

  it('is buffered for a Paper doc listed above the streaming size, never a body', async () => {
    const { source, calls } = fakeDropbox([paper('Notes.paper', { size: STREAM_FILES_LARGER_THAN_BYTES * 4 })], 'markdown');
    const [doc] = await listed(source);
    const raw = await source.fetch(doc!);
    expect(raw.body).toBeUndefined();
    expect(raw.content).toEqual(EXPORTED.markdown);
    expect(raw.item.size).toBe(EXPORTED.markdown!.byteLength);
    expect(calls.map((c) => c.url)).toEqual([`${CONTENT}/files/export`]);
  });

  it('downloads every other file as before, and marks it as no rendering', async () => {
    const { source, calls } = fakeDropbox([file('letter.pdf')], 'markdown');
    const [letter] = await listed(source);
    const raw = await source.fetch(letter!);
    expect(calls.map((c) => c.url)).toEqual([`${CONTENT}/files/download`]);
    expect(raw.rendering).toBeUndefined();
    expect(letter).not.toHaveProperty('formerPaths');
    expect(letter).not.toHaveProperty('sourceIdentity');
  });
});

describe('a format the file does not offer is refused as the setting’s doing', () => {
  it('refuses before any request when Dropbox does not offer the format for this file', async () => {
    const { source, calls } = fakeDropbox([paper('Notes.paper', { export_info: { export_as: 'markdown' } })], 'html');
    const [doc] = await listed(source);
    expect(doc?.path).toBe('Werk/Notes.paper');
    const err = await refusal(source, doc!);
    expect(calls).toEqual([]);
    expect(err).toBeInstanceOf(DropboxNativeRefused);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    expect(isDecisionError(err)).toBe(true);
    expect((err as Error).message).toBe(
      '"Notes.paper" is a Dropbox Paper doc, and Dropbox does not offer it as html, the format this ' +
        'migration exports Paper docs in, so nothing was copied. Choose another format for Paper ' +
        'docs, or leave it behind.',
    );
  });

  it("refuses the same way when Dropbox answers invalid_export_format, naming the file as listed", async () => {
    const { source } = fakeDropbox([paper('Notes.paper')], 'markdown', {
      'id:Notes.paper markdown': {
        status: 409,
        body: '{"error_summary":"invalid_export_format/..","error":{".tag":"invalid_export_format"}}',
      },
    });
    const [doc] = await listed(source);
    const err = await refusal(source, doc!);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    expect(isDecisionError(err)).toBe(true);
    expect((err as Error).message).toContain('"Notes.paper" is a Dropbox Paper doc, and Dropbox does not offer it as markdown');
  });

  it('keeps every other refusal an ordinary failure, retried and read from its words', async () => {
    for (const [status, body] of [
      [409, '{"error_summary":"retry_error/..","error":{".tag":"retry_error"}}'],
      [409, '{"error_summary":"non_exportable/..","error":{".tag":"non_exportable"}}'],
      [500, 'Internal Server Error'],
    ] as const) {
      const { source } = fakeDropbox([paper('Notes.paper')], 'markdown', {
        'id:Notes.paper markdown': { status, body },
      });
      const [doc] = await listed(source);
      const err = await refusal(source, doc!);
      expect(err, body).not.toBeInstanceOf(DropboxNativeRefused);
      expect(isDecisionError(err), body).toBe(false);
      expect(statedFailureCategoryOf(err), body).toBeUndefined();
      expect((err as Error).message).toContain(`Dropbox refused the export of "Werk/Notes.paper.md" as markdown (${status})`);
    }
  });
});

describe('with no format chosen, nothing changes (D1)', () => {
  it('lists a Paper doc under its own name, naming the exported ones as former keys', async () => {
    const [doc] = await listed(fakeDropbox([paper('Notes.paper')]).source);
    expect(doc).toMatchObject({
      path: 'Werk/Notes.paper',
      name: 'Notes.paper',
      formerPaths: ['Werk/Notes.paper.md', 'Werk/Notes.paper.html'],
      sourceIdentity: 'id:Notes.paper',
    });
    expect(doc).not.toHaveProperty('exportOnly.exportAs');
  });

  it('refuses it by name, before any request, as T5 does', async () => {
    for (const policy of [undefined, 'refuse'] as const) {
      const { source, calls } = fakeDropbox([paper('Notes.paper')], policy);
      const [doc] = await listed(source);
      const err = await refusal(source, doc!);
      expect(calls).toEqual([]);
      expect(statedFailureCategoryOf(err)).toBe('policy_refused');
      expect((err as Error).message).toContain('"Notes.paper" is a Dropbox Paper doc. Dropbox hands one over only as an export');
    }
  });

  it('never renames a kind that is not Paper, and keeps refusing it', async () => {
    const { source, calls } = fakeDropbox(
      [file('Budget.gsheet', { is_downloadable: false, export_info: { export_as: 'xlsx', export_options: ['xlsx'] } })],
      'markdown',
    );
    const [sheet] = await listed(source);
    expect(sheet?.path).toBe('Werk/Budget.gsheet');
    expect(sheet).not.toHaveProperty('formerPaths');
    expect(sheet).not.toHaveProperty('sourceIdentity');
    const err = await refusal(source, sheet!);
    expect(calls).toEqual([]);
    expect((err as Error).message).toContain('"Budget.gsheet" is a document Dropbox keeps in a format of its own');
  });

  it('never exports another kind under the Paper setting, even one Dropbox offers as Markdown', async () => {
    // The setting is for Paper docs (D7). Another kind that happens to offer
    // the same format waits for a setting of its own.
    const { source, calls } = fakeDropbox(
      [file('Plan.gdoc', { is_downloadable: false, export_info: { export_as: 'docx', export_options: ['docx', 'markdown'] } })],
      'markdown',
    );
    const [doc] = await listed(source);
    expect(doc?.path).toBe('Werk/Plan.gdoc');
    const err = await refusal(source, doc!);
    expect(calls).toEqual([]);
    expect(statedFailureCategoryOf(err)).toBe('policy_refused');
    expect((err as Error).message).toContain('"Plan.gdoc" is a document Dropbox keeps in a format of its own (.gdoc).');
  });
});

describe('a deleted Paper doc is evidence under both names', () => {
  const tombstone = (name: string): DropboxEntry => ({ '.tag': 'deleted', name, path_display: `/Werk/${name}` });

  it('under a chosen format: the listed name and the exported one', async () => {
    const { source } = fakeDropbox([tombstone('Notes.paper'), tombstone('Weekly.papert'), tombstone('old.pdf')], 'html');
    const trash = await source.listTrashedPaths();
    expect([...trash.paths].sort()).toEqual([
      'Werk/Notes.paper',
      'Werk/Notes.paper.html',
      'Werk/Weekly.papert',
      'Werk/Weekly.papert.html',
      'Werk/old.pdf',
    ]);
  });

  it('with no format chosen: the listed name alone', async () => {
    const trash = await fakeDropbox([tombstone('Notes.paper')]).source.listTrashedPaths();
    expect(trash.paths).toEqual(['Werk/Notes.paper']);
  });
});

describe('a format this source does not know', () => {
  it('stops it at construction, naming the ones it knows', () => {
    expect(() => fakeDropbox([], 'pdf' as DropboxPaperPolicy)).toThrow(
      'Unknown format for Paper docs: "pdf". Use one of refuse, markdown, html.',
    );
  });
});
