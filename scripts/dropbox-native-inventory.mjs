#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LISTING THAT NAMES NO FILE: what a real Dropbox holds that Dropbox will
 * not hand over as a file (workplan 0150 T2).
 *
 * A Paper doc is listed like any file, but `files/download` refuses it. Dropbox
 * says so on the listing itself: `is_downloadable: false`, with `export_info`
 * naming the formats `files/export` offers. 0150 T3 and T4 export such files in
 * a format the person chooses. What they build on is read here, from a real
 * account, before their code merges (0150 open question 3):
 *
 *   (a) which formats each kind offers, and whether `files/export` answers in
 *       each of them;
 *   (b) whether `content_hash`, `rev` or `server_modified` moves after an edit,
 *       since the sync decides a rewrite from the listing's version;
 *   (c) which other kinds the account lists, and which offer no export;
 *   (d) the size such a file is listed with.
 *
 * It prints kinds, counts, formats and sizes. It prints no file or folder
 * name, no path and no token: a kind is shown only when it is a plain short
 * extension, and in `--versions` each file is a label cut from a hash of its
 * Dropbox id. It reads and writes nothing else: every call is one of `READS`,
 * and the export probe keeps only the byte count of what it receives.
 *
 * Run it with a token for the account, never on the command line:
 *
 *   read -rs DROPBOX_ACCESS_TOKEN && export DROPBOX_ACCESS_TOKEN
 *   node scripts/dropbox-native-inventory.mjs            # the inventory, with the export probe
 *   node scripts/dropbox-native-inventory.mjs --no-probe # the inventory only
 *   node scripts/dropbox-native-inventory.mjs --versions > before.txt
 *     (edit one Paper doc in Dropbox, then)
 *   node scripts/dropbox-native-inventory.mjs --versions > after.txt
 *   diff before.txt after.txt                            # the fields an edit moves
 *
 * `--root /Some/Folder` lists one folder instead of the whole account. The
 * token can be one the Dropbox App Console generates for the app's own
 * account (the app's Settings tab, "Generated access token"), with the scopes
 * a migration's token has. The appliance's three variables work too:
 * DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN. A host
 * without Node can run it in a container that has it, reading the script
 * from stdin: `docker run --rm -i -e DROPBOX_ACCESS_TOKEN node:24-alpine node
 * --input-type=module - < scripts/dropbox-native-inventory.mjs`.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs on a bare
 * checkout and needs no type stripping. Its guard,
 * `scripts/a-listing-that-names-no-file.unit.test.ts`, runs the functions
 * below against a fake Dropbox.
 */

import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { URLSearchParams, fileURLToPath } from 'node:url';

export const API = 'https://api.dropboxapi.com/2';
export const CONTENT = 'https://content.dropboxapi.com/2';
export const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

/** Every address this script calls. Each is a read; none changes the account. */
export const READS = Object.freeze([
  `${API}/files/list_folder`,
  `${API}/files/list_folder/continue`,
  `${CONTENT}/files/export`,
  TOKEN_URL,
]);

/** The connector's own page size and its guard against a listing that never ends. */
const PAGE = 1000;
const MAX_PAGES = 1000;
/** A 429 or a 5xx is asked again this many times, after Dropbox's Retry-After. */
const RETRIES = 3;

/** A kind is printed only when it is a plain short extension, so no name leaks through it. */
const PLAIN_EXTENSION = /^\.[a-z0-9]{1,8}$/;

/** The kind a name is listed with: its extension, or a placeholder that names nothing. */
export function kindOf(name) {
  const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  if (dot <= 0) return '(no extension)';
  const ext = name.slice(dot).toLowerCase();
  return PLAIN_EXTENSION.test(ext) ? ext : '(other)';
}

/** A label for one file that stays the same across runs and names nothing: a cut of its id's hash. */
export function labelOf(id) {
  return createHash('sha256').update(String(id)).digest('hex').slice(0, 10);
}

/** A header argument Dropbox reads as JSON, with anything outside ASCII escaped, as it asks. */
function headerJson(value) {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

async function call(fetch, url, { token, body, arg }, sleep) {
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method: 'POST', headers };
    if (arg !== undefined) {
      headers['Dropbox-API-Arg'] = headerJson(arg);
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(after) && after > 0 ? after : 2 ** attempt, 60) * 1000);
      continue;
    }
    return res;
  }
}

/** Dropbox's own summary of a refusal, which names the reason and never the file. */
async function refusalOf(res) {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text);
    const summary =
      parsed.error_summary ?? (typeof parsed.error === 'string' ? parsed.error : parsed.error?.['.tag']);
    if (typeof summary === 'string' && summary !== '') return summary.slice(0, 120);
  } catch {
    // Not JSON: fall through to the status alone.
  }
  return `HTTP ${res.status}`;
}

async function page(res, what) {
  if (!res.ok) throw new Error(`Dropbox refused ${what}: ${await refusalOf(res)}.`);
  return res.json();
}

/** Every entry under `root`, through `list_folder` and its `continue`, as a sync pass reads them. */
async function listAll(fetch, token, root, sleep) {
  const entries = [];
  let pages = 1;
  let body = await page(
    await call(
      fetch,
      `${API}/files/list_folder`,
      { token, body: { path: root, recursive: true, include_deleted: false, limit: PAGE } },
      sleep,
    ),
    'files/list_folder',
  );
  entries.push(...(body.entries ?? []));
  while (body.has_more) {
    if (++pages > MAX_PAGES) {
      throw new Error(`the listing did not end after ${MAX_PAGES} pages; nothing is reported from a partial one.`);
    }
    body = await page(
      await call(fetch, `${API}/files/list_folder/continue`, { token, body: { cursor: body.cursor } }, sleep),
      'files/list_folder/continue',
    );
    entries.push(...(body.entries ?? []));
  }
  return { entries, pages };
}

/** The formats `files/export` offers for one entry: its default first, then the others, once each. */
export function formatsOf(entry) {
  const info = entry.export_info ?? {};
  const formats = [info.export_as, ...(Array.isArray(info.export_options) ? info.export_options : [])];
  return [...new Set(formats.filter((f) => typeof f === 'string' && f !== ''))];
}

/** One export, of which only the status, the size and the result header's shape are kept. */
async function exportOnce(fetch, token, id, format, sleep) {
  const res = await call(fetch, `${CONTENT}/files/export`, { token, arg: { path: id, export_format: format } }, sleep);
  if (!res.ok) return { status: res.status, refusal: await refusalOf(res) };
  const bytes = (await res.arrayBuffer()).byteLength;
  let meta = {};
  try {
    meta = JSON.parse(res.headers.get('dropbox-api-result') ?? '{}').export_metadata ?? {};
  } catch {
    // A result header that does not parse is reported as carrying nothing.
  }
  return {
    status: res.status,
    bytes,
    suffix: kindOf(meta.name),
    exportHash: typeof meta.export_hash === 'string',
    paperRevision: meta.paper_revision !== undefined,
  };
}

/**
 * The inventory: every file counted, and each kind Dropbox will not download
 * described, with the export probed once per kind and format.
 */
export async function inventory({ fetch, token, root = '', probe = true, sleep = defaultSleep }) {
  const { entries, pages } = await listAll(fetch, token, root, sleep);
  let files = 0;
  let folders = 0;
  const kinds = new Map();
  for (const entry of entries) {
    if (entry['.tag'] === 'folder') folders++;
    if (entry['.tag'] !== 'file') continue;
    files++;
    if (entry.is_downloadable !== false) continue;
    const kind = kindOf(entry.name);
    const k = kinds.get(kind) ?? {
      files: 0,
      exportAs: new Set(),
      options: new Set(),
      noExport: 0,
      minSize: Infinity,
      maxSize: 0,
      has: { content_hash: 0, rev: 0, server_modified: 0 },
      sample: undefined,
    };
    k.files++;
    const formats = formatsOf(entry);
    if (formats.length === 0) k.noExport++;
    if (entry.export_info?.export_as) k.exportAs.add(entry.export_info.export_as);
    for (const option of entry.export_info?.export_options ?? []) k.options.add(option);
    if (typeof entry.size === 'number') {
      k.minSize = Math.min(k.minSize, entry.size);
      k.maxSize = Math.max(k.maxSize, entry.size);
    }
    for (const field of ['content_hash', 'rev', 'server_modified']) if (entry[field]) k.has[field]++;
    if (!k.sample && formats.length > 0) k.sample = entry;
    kinds.set(kind, k);
  }
  const probes = [];
  if (probe) {
    for (const [kind, k] of kinds) {
      if (!k.sample) continue;
      for (const format of formatsOf(k.sample)) {
        probes.push({ kind, format, ...(await exportOnce(fetch, token, k.sample.id, format, sleep)) });
      }
    }
  }
  return { files, folders, pages, kinds, probes };
}

const count = (n) => n.toLocaleString('en-US');
const list = (set) => (set.size ? [...set].sort().join(', ') : '(none)');

/** The inventory as the lines to print. */
export function render({ files, folders, pages, kinds, probes }, { probed = true } = {}) {
  const native = [...kinds.values()].reduce((sum, k) => sum + k.files, 0);
  const lines = [
    'Dropbox native-format inventory (0150 T2). Read-only; no file or folder name is printed.',
    `Listed: ${count(files)} file(s) and ${count(folders)} folder(s), in ${count(pages)} page(s).`,
    `Files Dropbox will not hand over through files/download: ${count(native)}.`,
  ];
  for (const [kind, k] of [...kinds].sort(([a], [b]) => a.localeCompare(b))) {
    const size = k.minSize === Infinity ? 'no size listed' : `listed size ${count(k.minSize)} to ${count(k.maxSize)} bytes`;
    lines.push(
      `  ${kind}: ${count(k.files)} file(s); export_as ${list(k.exportAs)}; export_options ${list(k.options)}; ` +
        `${count(k.noExport)} with no export offered; ${size}; ` +
        `content_hash on ${k.has.content_hash}, rev on ${k.has.rev}, server_modified on ${k.has.server_modified}.`,
    );
  }
  if (!probed) {
    lines.push('Export probe: skipped (--no-probe).');
  } else if (probes.length === 0) {
    lines.push('Export probe: nothing to probe; no kind offers an export.');
  } else {
    lines.push('Export probe, one file per kind, in each format it offers (only the size is kept):');
    for (const p of probes) {
      lines.push(
        p.refusal
          ? `  ${p.kind} as ${p.format}: refused, ${p.status} ${p.refusal}.`
          : `  ${p.kind} as ${p.format}: ${p.status}, ${count(p.bytes)} bytes, named ${p.suffix}; ` +
              `export_hash ${p.exportHash ? 'present' : 'absent'}, paper_revision ${p.paperRevision ? 'present' : 'absent'}.`,
      );
    }
  }
  return lines;
}

/**
 * One line per file Dropbox will not download, with the fields a sync reads
 * its version from, under a label that names nothing. Run it before and after
 * an edit, and `diff` shows which fields the edit moved.
 */
export async function versions({ fetch, token, root = '', sleep = defaultSleep }) {
  const { entries } = await listAll(fetch, token, root, sleep);
  return entries
    .filter((e) => e['.tag'] === 'file' && e.is_downloadable === false)
    .map(
      (e) =>
        `${labelOf(e.id)} ${kindOf(e.name)} rev=${e.rev ?? '-'} server_modified=${e.server_modified ?? '-'} ` +
        `content_hash=${e.content_hash ?? '-'} size=${e.size ?? '-'}`,
    )
    .sort();
}

/** The token: one given as is, or one the appliance's three variables refresh. */
export async function tokenFrom(env, fetch) {
  if (env.DROPBOX_ACCESS_TOKEN) return env.DROPBOX_ACCESS_TOKEN;
  const { DROPBOX_APP_KEY: key, DROPBOX_APP_SECRET: secret, DROPBOX_REFRESH_TOKEN: refresh } = env;
  if (key && secret && refresh) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: key,
        client_secret: secret,
      }).toString(),
    });
    if (!res.ok) throw new Error(`Dropbox refused the refresh token: ${await refusalOf(res)}.`);
    const body = await res.json();
    if (typeof body.access_token !== 'string') throw new Error('Dropbox answered the refresh with no access token.');
    return body.access_token;
  }
  throw new Error(
    'no token. Set DROPBOX_ACCESS_TOKEN (read -rs DROPBOX_ACCESS_TOKEN && export DROPBOX_ACCESS_TOKEN), ' +
      'or DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN. Nothing was read.',
  );
}

/** The command line, or a refusal that names what it did not understand. */
export function optionsFrom(argv) {
  const options = { root: '', probe: true, versions: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-probe') options.probe = false;
    else if (arg === '--versions') options.versions = true;
    else if (arg === '--root' && i + 1 < argv.length) options.root = argv[++i];
    else {
      // An option is echoed; anything else may be a path, and is not.
      const what = arg.startsWith('--') ? `unknown option ${JSON.stringify(arg)}` : 'a value with no option before it';
      throw new Error(`${what}. Use --root <folder>, --no-probe or --versions.`);
    }
  }
  if (options.root !== '' && !options.root.startsWith('/')) {
    throw new Error('--root takes a Dropbox path that starts with "/", or nothing for the whole account.');
  }
  return options;
}

function defaultSleep(ms) {
  return wait(ms);
}

async function main(argv, env) {
  const options = optionsFrom(argv);
  const token = await tokenFrom(env, fetch);
  if (options.versions) {
    for (const line of await versions({ fetch, token, root: options.root })) console.log(line);
    return;
  }
  const result = await inventory({ fetch, token, root: options.root, probe: options.probe });
  for (const line of render(result, { probed: options.probe })) console.log(line);
}

// Run as a file, or read from stdin (`node -`, where the file is named "-"); never on import.
const entry = process.argv[1];
if (entry === '-' || (entry !== undefined && fileURLToPath(import.meta.url) === entry)) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(`dropbox-native-inventory: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
