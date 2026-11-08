#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MACHINE'S PRODUCT NAME, KEPT OUT OF EVERY FILE GIT LISTS.
 *
 * The detector of `scripts/a-machine-called-by-its-product-name.unit.test.ts`,
 * which tells the story, the rules and what this cannot see. It lives here, in
 * plain `.mjs` with nothing but Node's own modules, because `docs-hygiene` in
 * `.github/workflows/ci.yml` runs it on every change and installs nothing: most
 * of the text it reads is workplans and runbooks, and `detect-changes` skips
 * `unit-tests` for a change to the workplans alone. `conflict-markers.mjs` runs
 * there for the same reason.
 *
 * Usage, from any directory (it finds the repository by its own location):
 *
 *   node scripts/machine-product-name.mjs --check
 *
 * Exit 0 with one line when no file names it, 1 with the file, line and column
 * of each one that does. It never prints what it found, only where: the log of
 * a run of this public repository is public text too.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What it looks for, as SHA-256 digests of the lowercased words, and
 * deliberately not in clear: this file would otherwise be the one in the tree
 * that names them. A digest of a short word is no secret to anybody who tries;
 * it keeps the word out of the text, which is all the rule asks.
 *
 * `WORD_DIGESTS`: the names of one word. `PAIR_DIGESTS`: the names of two, each
 * as the digest of its first word and the digest of both, joined by one space.
 */
export const WORD_DIGESTS = Object.freeze([
  '92f473809e5979a7da2b7f52771b3a9e3d7105dcb0f24ae333c5bf279b863d73',
  '761fca33267f8a3eb82e6059e5e5324bf255cec68bc1fe2d92775ac334f1a338',
  '8d4321d936320802386311d254c4af52951abb880b47fb077edf3d89c150b289',
  '85cf6544b31034294b67701f0e2d0d6bae7d119d7805c9d48dee21f8d5ed43fa',
]);
export const PAIR_DIGESTS = Object.freeze([
  Object.freeze([
    'e010fd1ce1acc173e3b4835b7635f8d4600d774869102adb5cb7b5d7895649ba',
    'db0fd153986fa46cd1d545edd36fc54bb4af5cffb48ef3945fc05742bd543d7c',
  ]),
  Object.freeze([
    '761fca33267f8a3eb82e6059e5e5324bf255cec68bc1fe2d92775ac334f1a338',
    '35d3439bc22d3c91bab63b6b48a37d29cb95dfd645ac6c0c46023f4cd71f654f',
  ]),
]);

/**
 * The paths passed over, and why. Pinned by the guard, so that adding one is a
 * decision made in a pull request that runs the unit suite.
 *
 * `pnpm-lock.yaml` is generated from the registry. Its names are third-party
 * packages' and their integrity hashes, which nobody here writes or can rename,
 * and a package whose name holds one of the words could arrive with any update.
 * It holds none today.
 */
export const SKIPPED = Object.freeze(['pnpm-lock.yaml']);

/**
 * The files that still hold an occurrence waiting for a decision, and on how
 * many lines. A file that holds more or fewer than it declares fails: one
 * declared and gone would excuse the next one written there.
 *
 * `.github/workflows/e2e-o365.yml`: the runner label its `runs-on` asks for,
 * which is the word itself. The owner added that label to the runner on
 * 2026-11-02 rather than drop it from `runs-on`, the choice #1137 left to them
 * (workplan 0141 T13 (a)). It goes when the workflow asks for a neutral label
 * the owner has added to the runner, or for none, and this entry goes with it.
 */
export const OWED = Object.freeze({
  '.github/workflows/e2e-o365.yml': 1,
});

/** A token: a run of ASCII letters and digits. A hyphen, underscore, dot or slash ends one. */
const TOKEN = /[A-Za-z0-9]+/g;

const digestOf = (text) => createHash('sha256').update(text).digest('hex');

const WORDS = new Set(WORD_DIGESTS);
const PAIRS = new Set(PAIR_DIGESTS.map(([, both]) => both));
const STARTS = new Set(PAIR_DIGESTS.map(([first]) => first));

/** Per lowercased token: is it a word, and can it start a pair. Tokens repeat; digests are not free. */
const known = new Map();
function judge(token) {
  let verdict = known.get(token);
  if (verdict === undefined) {
    const d = digestOf(token);
    verdict = { word: WORDS.has(d), start: STARTS.has(d) };
    known.set(token, verdict);
  }
  return verdict;
}

/**
 * Where one file's text names it: each line once, at the first column a word or
 * the first word of a pair starts on (both 1-based). A pair may span a line
 * break, and is reported at its first word.
 */
export function hitsIn(text) {
  const lines = text.split('\n');
  const found = new Map();
  const note = (line, column) => {
    if (!found.has(line) || found.get(line) > column) found.set(line, column);
  };
  let previous;
  lines.forEach((content, i) => {
    for (const m of content.matchAll(TOKEN)) {
      const token = m[0].toLowerCase();
      const verdict = judge(token);
      if (verdict.word) note(i + 1, m.index + 1);
      if (previous?.start && PAIRS.has(digestOf(`${previous.token} ${token}`))) note(previous.line, previous.column);
      previous = { token, start: verdict.start, line: i + 1, column: m.index + 1 };
    }
  });
  return [...found].map(([line, column]) => ({ line, column })).sort((a, b) => a.line - b.line);
}

/**
 * The lines of declared files that `owed` does not account for, as findings,
 * and a finding with line 0 for a file that holds fewer than it declares.
 */
export function owedFindings(byFile, owed = OWED) {
  const findings = [];
  const files = [...new Set([...Object.keys(byFile), ...Object.keys(owed)])].sort();
  for (const file of files) {
    const hits = byFile[file] ?? [];
    const want = owed[file] ?? 0;
    if (hits.length === want) continue;
    if (hits.length < want) {
      findings.push({
        file,
        line: 0,
        column: 0,
        what:
          `OWED declares ${want} line(s) in this file and it holds ${hits.length}: ` +
          'take the entry out of OWED in scripts/machine-product-name.mjs',
      });
      continue;
    }
    for (const h of hits) findings.push({ file, ...h, what: want === 0 ? '' : `one of ${hits.length}, where OWED declares ${want}` });
  }
  return findings;
}

/** git's own test for binary: a NUL in the first 8,000 bytes. */
export const isBinary = (bytes) => bytes.subarray(0, 8000).includes(0);

/**
 * Every file `git ls-files` lists under `root`, untracked ones included, read
 * and judged. `findings` holds every line `owed` does not account for.
 */
export function scanTree(root = REPO_ROOT, owed = OWED) {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // A path mid-merge is listed once per stage; once is enough.
  const files = [...new Set(listing.split('\0').filter(Boolean))].sort();

  const scanned = [];
  const binary = [];
  const skipped = [];
  const byFile = {};
  for (const file of files) {
    if (SKIPPED.includes(file)) {
      skipped.push(file);
      continue;
    }
    const path = join(root, file);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      // In the index, gone from the working tree: no text to name anything.
      // Any other failure to read is a failure, not a pass.
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile()) continue;
    const bytes = readFileSync(path);
    if (isBinary(bytes)) {
      binary.push(file);
      continue;
    }
    scanned.push(file);
    const hits = hitsIn(bytes.toString('utf8'));
    if (hits.length > 0) byFile[file] = hits;
  }
  const findings = owedFindings(byFile, owed).sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  return { scanned, binary, skipped, byFile, findings };
}

/** The failure message: each file, line and column, and what to write instead. Never the word. */
export function verdictMessage(found) {
  const files = new Set(found.map((f) => f.file)).size;
  return [
    `${files} file(s) name the machine by its hardware product name:`,
    '',
    ...found.map((f) => `  ${f.file}${f.line > 0 ? `:${f.line}:${f.column}` : ''}${f.what ? `  ${f.what}` : ''}`),
    '',
    'Say "the machine", "the box", "the host", "the arm64 machine" or "the self-hosted runner" instead.',
    'In a quotation of the owner, mark the substitution in square brackets: [the machine].',
    'A name that holds the word (a host, a fixture, a placeholder) gets a neutral one.',
    'The word is not printed here: the log of a public run is public text too.',
  ].join('\n');
}

/** `--check`: the exit status, with the verdict printed. */
export function main(argv = process.argv.slice(2), root = REPO_ROOT) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    console.error('usage: machine-product-name.mjs --check');
    return 2;
  }
  const tree = scanTree(root);
  if (tree.findings.length > 0) {
    console.error(verdictMessage(tree.findings));
    return 1;
  }
  const owed = Object.entries(tree.byFile).map(([file, hits]) => `${hits.length} in ${file}`);
  console.log(
    `no file names the machine by its product name: ${tree.scanned.length} files read ` +
      `(${tree.binary.length} binary and ${tree.skipped.length} skipped passed over); ` +
      `owed: ${owed.join(', ') || 'none'}`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
