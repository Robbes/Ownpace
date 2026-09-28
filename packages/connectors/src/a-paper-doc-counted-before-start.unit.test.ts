// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAPER DOC COUNTED BEFORE START (workplan 0150 T3 (d), D5).
 *
 * The confirm screen names what a migration will not copy while its format
 * can still be chosen, and Start waits for somebody to tick that they read it.
 * Drive's source counts its refused Google files for that line; a Dropbox
 * source counted nothing, so a migration full of Paper docs started with no
 * word about them, and they appeared afterwards, one row each, on the
 * Failures page.
 *
 * What this holds, against a fake Dropbox:
 *
 *  1. Nothing listed is `{}`, as Drive answers: counted, and none.
 *  2. Under `refuse`, every Paper doc and template is counted as `paper`.
 *     Another kind of Dropbox's own, one Dropbox offers no export for, and an
 *     ordinary file are not: no format this migration can choose carries them
 *     (D5), so they stay on the Failures page.
 *  3. Under a format, only a Paper doc whose file does not offer it is.
 *  4. A doc listed twice is counted once, by its Dropbox id.
 */

import { describe, it, expect } from 'vitest';
import type { DropboxPaperPolicy } from '@openmig/shared';
import { DropboxFileSource } from './dropbox-file-source.ts';
import type { DropboxEntry, DropboxTransport } from './dropbox-file-source.types.ts';

/** One folder, listed as given. Nothing here is ever downloaded or exported. */
function fakeDropbox(entries: DropboxEntry[], policy?: DropboxPaperPolicy): DropboxFileSource {
  const transport: DropboxTransport = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ entries, cursor: 'end', has_more: false }),
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => '',
  });
  return new DropboxFileSource(transport, {
    apiBaseUrl: 'https://api.test/2',
    contentBaseUrl: 'https://content.test/2',
    ...(policy ? { nativeFilePolicies: { paper: policy } } : {}),
  });
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

const exportOnly = (name: string, options: string[], over: Partial<DropboxEntry> = {}): DropboxEntry =>
  file(name, {
    is_downloadable: false,
    export_info: { export_as: options[0], export_options: options },
    ...over,
  });

/** A Paper doc, a template, another kind of Dropbox's own, one with no export, and a plain file. */
const ACCOUNT: DropboxEntry[] = [
  exportOnly('Notes.paper', ['markdown', 'html']),
  exportOnly('Minutes.papert', ['markdown', 'html']),
  exportOnly('Board.gsheet', ['xlsx']),
  file('Link.web', { is_downloadable: false }),
  file('letter.pdf'),
];

const listAll = async (source: DropboxFileSource) => source.listSince({ path: '' });

describe('the count the confirm screen reads', () => {
  it('is empty before anything is listed, and empty for a folder with no Paper doc', async () => {
    const source = fakeDropbox([file('letter.pdf'), exportOnly('Board.gsheet', ['xlsx'])]);
    expect(source.nativeRefusals()).toEqual({});
    await listAll(source);
    expect(source.nativeRefusals()).toEqual({});
  });

  it('counts every Paper doc and template under refuse, and nothing else', async () => {
    for (const policy of [undefined, 'refuse'] as const) {
      const source = fakeDropbox(ACCOUNT, policy);
      await listAll(source);
      expect(source.nativeRefusals(), String(policy)).toEqual({ paper: 2 });
    }
  });

  it('counts none under a format every doc offers', async () => {
    for (const policy of ['markdown', 'html'] as const) {
      const source = fakeDropbox(ACCOUNT, policy);
      await listAll(source);
      expect(source.nativeRefusals(), policy).toEqual({});
    }
  });

  it('counts, under a format, only the Paper doc whose file does not offer it', async () => {
    const source = fakeDropbox(
      [exportOnly('Notes.paper', ['markdown', 'html']), exportOnly('Old.paper', ['markdown'])],
      'html',
    );
    await listAll(source);
    expect(source.nativeRefusals()).toEqual({ paper: 1 });
  });

  it('counts a doc listed twice once, by its Dropbox id', async () => {
    const source = fakeDropbox(ACCOUNT);
    await listAll(source);
    await listAll(source);
    await source.listKeys({ path: '' });
    expect(source.nativeRefusals()).toEqual({ paper: 2 });
  });
});
