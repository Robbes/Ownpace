// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LISTING THAT NAMES NO FILE: the inventory of what a real Dropbox will not
 * hand over as a file (workplan 0150 T2).
 *
 * 0150 T3 and T4 export Paper docs in a format the person chooses. Before
 * their code merges, 0150 asks what a real account says (open question 3):
 * which formats each kind offers and whether `files/export` answers in them,
 * whether an edit moves the fields a sync reads its version from, which other
 * kinds are listed, and their listed sizes. The owner runs
 * `scripts/dropbox-native-inventory.mjs` on his own account and pastes what it
 * prints, so what it prints must name no file, no folder and no token.
 *
 * This holds, against a fake Dropbox that answers as the API reference says:
 *
 *  1. every file is counted, and each kind Dropbox will not download is
 *     described: its formats, its listed sizes, the version fields it carries;
 *  2. the export is probed once per kind and format, by id, and only its size
 *     and the shape of its result header are kept;
 *  3. `--versions` gives one line per such file, under a label cut from its
 *     id's hash, so two runs around an edit differ on that one line;
 *  4. nothing it prints names a file, a folder or the token, in any mode or
 *     refusal;
 *  5. it calls nothing but its reads, follows the listing to its end, asks
 *     again after a 429, and never reports a listing that did not end;
 *  6. with no token it refuses before asking Dropbox anything, also when it
 *     is read from stdin, the way a host without Node runs it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API,
  CONTENT,
  READS,
  TOKEN_URL,
  inventory,
  kindOf,
  labelOf,
  optionsFrom,
  render,
  tokenFrom,
  versions,
  type Fetch,
} from './dropbox-native-inventory.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dropbox-native-inventory.mjs');
const TOKEN = 'sl.fake-token-not-a-secret';

/** Names, paths and ids a real account would hold; none may be printed. */
const PRIVATE = ['Jansen', 'Salaris', 'Geheim', 'Offerte', 'Privé', 'id:jansen'];

type Entry = Record<string, unknown>;

const file = (name: string, over: Entry = {}): Entry => ({
  '.tag': 'file',
  id: `id:${name.replace(/\W/g, '').toLowerCase()}`,
  name,
  path_display: `/Privé/Jansen/${name}`,
  size: 1_000,
  rev: 'a1b2c3',
  server_modified: '2026-09-20T10:00:00Z',
  content_hash: 'f'.repeat(64),
  ...over,
});

const paper = (name: string, over: Entry = {}): Entry =>
  file(name, {
    is_downloadable: false,
    export_info: { export_as: 'markdown', export_options: ['markdown', 'html'] },
    ...over,
  });

/** An account with ordinary files, two Paper docs, a template, a shortcut with no export, and a folder. */
const ACCOUNT: Entry[][] = [
  [
    { '.tag': 'folder', id: 'id:folder', name: 'Jansen', path_display: '/Privé/Jansen' },
    file('Salaris 2026.pdf'),
    file('Geheim.jpg', { is_downloadable: true }),
    paper('Offerte Jansen.paper', { size: 1_200 }),
  ],
  [
    paper('Geheim plan.paper', { size: 4_800 }),
    file('Weekly Jansen.papert', { is_downloadable: false, export_info: { export_as: 'markdown' }, size: 900 }),
    file('Salaris link.web', { is_downloadable: false, size: 250 }),
    file('Offerte.docx'),
  ],
];

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake Dropbox: the account in pages, and each export answered as `exports` says. */
function fakeDropbox(
  pages: Entry[][] = ACCOUNT,
  exports: Record<string, { status: number; body?: string }> = {},
  extra: { firstStatus?: number; retryAfter?: string } = {},
) {
  const calls: Call[] = [];
  let firstRefused = false;
  const respond = (status: number, body: string | Uint8Array, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(typeof body === 'string' ? body : ''),
    text: async () => (typeof body === 'string' ? body : ''),
    arrayBuffer: async () =>
      (typeof body === 'string' ? new TextEncoder().encode(body) : body).buffer as ArrayBuffer,
  });
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url === `${API}/files/list_folder`) {
      if (extra.firstStatus && !firstRefused) {
        firstRefused = true;
        return respond(extra.firstStatus, '{"error_summary":"too_many_requests/.."}', {
          'retry-after': extra.retryAfter ?? '',
        });
      }
      return respond(200, JSON.stringify({ entries: pages[0], cursor: 'page-1', has_more: pages.length > 1 }));
    }
    if (url === `${API}/files/list_folder/continue`) {
      const n = Number(JSON.parse(init.body ?? '{}').cursor.split('-')[1]);
      return respond(
        200,
        JSON.stringify({ entries: pages[n], cursor: `page-${n + 1}`, has_more: n + 1 < pages.length }),
      );
    }
    if (url === `${CONTENT}/files/export`) {
      const arg = JSON.parse(init.headers['Dropbox-API-Arg'] ?? '{}');
      const answer = exports[`${arg.path} ${arg.export_format}`];
      if (answer) return respond(answer.status, answer.body ?? '');
      const suffix = arg.export_format === 'markdown' ? 'md' : arg.export_format;
      return respond(200, new Uint8Array(arg.export_format === 'html' ? 3_000 : 700), {
        'dropbox-api-result': JSON.stringify({
          export_metadata: {
            name: `Offerte Jansen.${suffix}`,
            size: 700,
            export_hash: 'e'.repeat(64),
            paper_revision: 7,
          },
          file_metadata: { name: 'Offerte Jansen.paper', path_display: '/Privé/Jansen/Offerte Jansen.paper' },
        }),
      });
    }
    if (url === TOKEN_URL) return respond(200, JSON.stringify({ access_token: TOKEN, token_type: 'bearer' }));
    return respond(404, 'not a route this fake answers');
  };
  return { fetch, calls };
}

const noSleep = async () => {};

function expectNothingPrivate(text: string) {
  for (const word of [...PRIVATE, TOKEN]) expect(text, `printed ${word}`).not.toContain(word);
}

describe('the inventory counts every file and describes each kind Dropbox will not download', () => {
  it('says what a real account needs said, and nothing more', async () => {
    const { fetch } = fakeDropbox();
    const result = await inventory({ fetch, token: TOKEN, sleep: noSleep });
    expect(render(result)).toEqual([
      'Dropbox native-format inventory (0150 T2). Read-only; no file or folder name is printed.',
      'Listed: 7 file(s) and 1 folder(s), in 2 page(s).',
      'Files Dropbox will not hand over through files/download: 4.',
      '  .paper: 2 file(s); export_as markdown; export_options html, markdown; 0 with no export offered; ' +
        'listed size 1,200 to 4,800 bytes; content_hash on 2, rev on 2, server_modified on 2.',
      '  .papert: 1 file(s); export_as markdown; export_options (none); 0 with no export offered; ' +
        'listed size 900 to 900 bytes; content_hash on 1, rev on 1, server_modified on 1.',
      '  .web: 1 file(s); export_as (none); export_options (none); 1 with no export offered; ' +
        'listed size 250 to 250 bytes; content_hash on 1, rev on 1, server_modified on 1.',
      'Export probe, one file per kind, in each format it offers (only the size is kept):',
      '  .paper as markdown: 200, 700 bytes, named .md; export_hash present, paper_revision present.',
      '  .paper as html: 200, 3,000 bytes, named .html; export_hash present, paper_revision present.',
      '  .papert as markdown: 200, 700 bytes, named .md; export_hash present, paper_revision present.',
    ]);
  });

  it('counts a field only where the listing carries it', async () => {
    const { fetch } = fakeDropbox([[paper('Geheim.paper', { content_hash: undefined, rev: undefined })]]);
    const [, , , line] = render(await inventory({ fetch, token: TOKEN, probe: false, sleep: noSleep }), {
      probed: false,
    });
    expect(line).toContain('content_hash on 0, rev on 0, server_modified on 1.');
  });

  it('reads an account with nothing native as such', async () => {
    const { fetch, calls } = fakeDropbox([[file('Salaris 2026.pdf')]]);
    const lines = render(await inventory({ fetch, token: TOKEN, sleep: noSleep }));
    expect(lines.slice(1)).toEqual([
      'Listed: 1 file(s) and 0 folder(s), in 1 page(s).',
      'Files Dropbox will not hand over through files/download: 0.',
      'Export probe: nothing to probe; no kind offers an export.',
    ]);
    expect(calls.map((c) => c.url)).toEqual([`${API}/files/list_folder`]);
  });
});

describe('the export probe', () => {
  it('asks once per kind and format, by id, in the header, with no body', async () => {
    const { fetch, calls } = fakeDropbox();
    await inventory({ fetch, token: TOKEN, sleep: noSleep });
    const exports = calls.filter((c) => c.url === `${CONTENT}/files/export`);
    expect(exports.map((c) => JSON.parse(c.headers['Dropbox-API-Arg'] ?? '{}'))).toEqual([
      { path: 'id:offertejansenpaper', export_format: 'markdown' },
      { path: 'id:offertejansenpaper', export_format: 'html' },
      { path: 'id:weeklyjansenpapert', export_format: 'markdown' },
    ]);
    for (const c of exports) {
      expect(c.body).toBeUndefined();
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("reports a refusal with Dropbox's own reason, and carries on", async () => {
    const { fetch } = fakeDropbox(ACCOUNT, {
      'id:offertejansenpaper html': {
        status: 409,
        body: '{"error_summary":"non_exportable/..","error":{".tag":"non_exportable"}}',
      },
    });
    const lines = render(await inventory({ fetch, token: TOKEN, sleep: noSleep }));
    expect(lines).toContain('  .paper as html: refused, 409 non_exportable/...');
    expect(lines).toContain('  .papert as markdown: 200, 700 bytes, named .md; export_hash present, paper_revision present.');
  });

  it('says so when the result header carries neither the hash nor the revision', async () => {
    const { fetch } = fakeDropbox(ACCOUNT, { 'id:weeklyjansenpapert markdown': { status: 200, body: 'x' } });
    const lines = render(await inventory({ fetch, token: TOKEN, sleep: noSleep }));
    expect(lines).toContain(
      '  .papert as markdown: 200, 1 bytes, named (no extension); export_hash absent, paper_revision absent.',
    );
  });

  it('probes a kind through a file that offers an export, when the first one listed offers none', async () => {
    const { fetch, calls } = fakeDropbox([
      [
        file('Geheim.papert', { is_downloadable: false }),
        file('Weekly Jansen.papert', { is_downloadable: false, export_info: { export_as: 'markdown' } }),
      ],
    ]);
    const lines = render(await inventory({ fetch, token: TOKEN, sleep: noSleep }));
    expect(lines).toContain(
      '  .papert as markdown: 200, 700 bytes, named .md; export_hash present, paper_revision present.',
    );
    const exported = calls.filter((c) => c.url.endsWith('/files/export'));
    expect(exported.map((c) => JSON.parse(c.headers['Dropbox-API-Arg'] ?? '{}'))).toEqual([
      { path: 'id:weeklyjansenpapert', export_format: 'markdown' },
    ]);
  });

  it('is skipped with --no-probe, asking for no export at all', async () => {
    const { fetch, calls } = fakeDropbox();
    const result = await inventory({ fetch, token: TOKEN, probe: false, sleep: noSleep });
    expect(calls.some((c) => c.url.endsWith('/files/export'))).toBe(false);
    expect(render(result, { probed: false }).at(-1)).toBe('Export probe: skipped (--no-probe).');
  });
});

describe('--versions: the fields an edit moves', () => {
  it('gives one line per such file, the same on two runs, under a label that names nothing', async () => {
    const first = await versions({ fetch: fakeDropbox().fetch, token: TOKEN, sleep: noSleep });
    // Dropbox promises no order, so a second run that lists the other way round must read the same.
    const reversed = [...ACCOUNT].reverse().map((page) => [...page].reverse());
    const again = await versions({ fetch: fakeDropbox(reversed).fetch, token: TOKEN, sleep: noSleep });
    expect(again).toEqual(first);
    expect(first).toHaveLength(4);
    for (const line of first) {
      expect(line).toMatch(/^[0-9a-f]{10} \.\w+ rev=\S+ server_modified=\S+ content_hash=\S+ size=\d+$/);
    }
    expect(first).toContain(
      `${labelOf('id:geheimplanpaper')} .paper rev=a1b2c3 server_modified=2026-09-20T10:00:00Z ` +
        `content_hash=${'f'.repeat(64)} size=4800`,
    );
  });

  it('differs, after an edit, on that file alone', async () => {
    const before = await versions({ fetch: fakeDropbox().fetch, token: TOKEN, sleep: noSleep });
    const edited = ACCOUNT.map((page) =>
      page.map((e) => (e.name === 'Geheim plan.paper' ? { ...e, rev: 'd4e5f6', server_modified: '2026-09-28T13:00:00Z' } : e)),
    );
    const after = await versions({ fetch: fakeDropbox(edited).fetch, token: TOKEN, sleep: noSleep });
    const changed = after.filter((line) => !before.includes(line));
    expect(changed).toEqual([
      `${labelOf('id:geheimplanpaper')} .paper rev=d4e5f6 server_modified=2026-09-28T13:00:00Z ` +
        `content_hash=${'f'.repeat(64)} size=4800`,
    ]);
  });
});

describe('nothing it prints names a file, a folder or the token', () => {
  it('in the inventory, the probe and --versions', async () => {
    const { fetch } = fakeDropbox();
    const printed = [
      ...render(await inventory({ fetch, token: TOKEN, sleep: noSleep })),
      ...(await versions({ fetch, token: TOKEN, sleep: noSleep })),
    ].join('\n');
    expectNothingPrivate(printed);
  });

  it('in a kind: only a plain short extension is shown as one', () => {
    expect(kindOf('Notes.PAPER')).toBe('.paper');
    expect(kindOf('Weekly.papert')).toBe('.papert');
    expect(kindOf('Offerte.Jansen2026')).toBe('(other)');
    expect(kindOf('Salaris.voor jansen')).toBe('(other)');
    expect(kindOf('.bashrc')).toBe('(no extension)');
    expect(kindOf('Geheim')).toBe('(no extension)');
    expect(kindOf(undefined)).toBe('(no extension)');
  });

  it("in a refusal: Dropbox's reason, never the folder asked for", async () => {
    const refusing: Fetch = async () => ({
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{"error_summary":"path/not_found/..","error":{".tag":"path"}}',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const error = await inventory({ fetch: refusing, token: TOKEN, root: '/Privé/Jansen', sleep: noSleep }).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toBe('Dropbox refused files/list_folder: path/not_found/...');
    expectNothingPrivate((error as Error).message);
  });

  it('in a command line it does not understand', () => {
    expect(() => optionsFrom(['/Privé/Jansen'])).toThrow('a value with no option before it.');
    expect(() => optionsFrom(['--root', 'Privé/Jansen'])).toThrow('--root takes a Dropbox path that starts with "/"');
    for (const argv of [['/Privé/Jansen'], ['--root', 'Privé/Jansen']]) {
      try {
        optionsFrom(argv);
      } catch (e) {
        expectNothingPrivate((e as Error).message);
      }
    }
    expect(() => optionsFrom(['--recursive'])).toThrow('unknown option "--recursive"');
    expect(optionsFrom(['--root', '/Werk', '--no-probe'])).toEqual({ root: '/Werk', probe: false, versions: false });
    expect(optionsFrom(['--versions'])).toEqual({ root: '', probe: true, versions: true });
  });
});

describe('how it asks Dropbox', () => {
  it('calls nothing but its reads, each with POST', async () => {
    const { fetch, calls } = fakeDropbox();
    await inventory({ fetch, token: TOKEN, sleep: noSleep });
    await versions({ fetch, token: TOKEN, sleep: noSleep });
    expect(READS).toEqual([
      `${API}/files/list_folder`,
      `${API}/files/list_folder/continue`,
      `${CONTENT}/files/export`,
      TOKEN_URL,
    ]);
    for (const c of calls) {
      expect(READS).toContain(c.url);
      expect(c.method).toBe('POST');
    }
  });

  it('lists the whole account, recursively, and follows the cursor to the end', async () => {
    const { fetch, calls } = fakeDropbox();
    await inventory({ fetch, token: TOKEN, probe: false, sleep: noSleep });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ path: '', recursive: true, include_deleted: false, limit: 1000 });
    expect(JSON.parse(calls[1]!.body!)).toEqual({ cursor: 'page-1' });
    expect(calls).toHaveLength(2);
  });

  it("asks again after a 429, waiting as long as Dropbox's Retry-After says", async () => {
    const waits: number[] = [];
    const { fetch, calls } = fakeDropbox(ACCOUNT, {}, { firstStatus: 429, retryAfter: '3' });
    const result = await inventory({
      fetch,
      token: TOKEN,
      probe: false,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([3_000]);
    expect(calls.filter((c) => c.url === `${API}/files/list_folder`)).toHaveLength(2);
    expect(result.files).toBe(7);
  });

  it('reports nothing from a listing that never ends', async () => {
    const endless: Fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ entries: [], cursor: 'again', has_more: true }),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(inventory({ fetch: endless, token: TOKEN, sleep: noSleep })).rejects.toThrow(
      'the listing did not end after 1000 pages; nothing is reported from a partial one.',
    );
  });
});

describe('the token', () => {
  it('is used as given, with nothing asked of Dropbox', async () => {
    const { fetch, calls } = fakeDropbox();
    expect(await tokenFrom({ DROPBOX_ACCESS_TOKEN: TOKEN }, fetch)).toBe(TOKEN);
    expect(calls).toEqual([]);
  });

  it("is refreshed from the appliance's three variables", async () => {
    const { fetch, calls } = fakeDropbox();
    const token = await tokenFrom(
      { DROPBOX_APP_KEY: 'key', DROPBOX_APP_SECRET: 'secret', DROPBOX_REFRESH_TOKEN: 'refresh' },
      fetch,
    );
    expect(token).toBe(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh',
      client_id: 'key',
      client_secret: 'secret',
    });
  });

  it("says Dropbox's reason when a refresh is refused", async () => {
    const refused: Fetch = async () => ({
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{"error":"invalid_grant","error_description":"refresh token is invalid or revoked"}',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(
      tokenFrom({ DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', DROPBOX_REFRESH_TOKEN: 'r' }, refused),
    ).rejects.toThrow('Dropbox refused the refresh token: invalid_grant.');
  });

  it('is refused when missing, before anything is asked', async () => {
    const { fetch, calls } = fakeDropbox();
    await expect(tokenFrom({ DROPBOX_APP_KEY: 'only the key' }, fetch)).rejects.toThrow(
      /no token\. Set DROPBOX_ACCESS_TOKEN .* Nothing was read\./,
    );
    expect(calls).toEqual([]);
  });

  it('is refused the same way when the script is read from stdin, as in a container', () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('DROPBOX_')),
    ) as NodeJS.ProcessEnv;
    const run = spawnSync(process.execPath, ['--input-type=module', '-', '--no-probe'], {
      input: readFileSync(SCRIPT, 'utf8'),
      env,
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/^dropbox-native-inventory: no token\. .* Nothing was read\.\n$/);
  });
});
