#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MERGE CONFLICT LEFT IN ANY FILE GIT LISTS, FOUND BEFORE THE TESTS EVER RUN.
 *
 * The detector of `scripts/a-conflict-left-in-a-file.unit.test.ts`, which
 * tells the story, the rules and what this cannot see. It lives here, in plain
 * `.mjs` with nothing but Node's own modules, for one reason. The guard runs in
 * `unit-tests`, and `detect-changes` skips that job for a change to the
 * workplans, `docs/architecture/**` and a few root files alone. 176 of the 567
 * files that conflicted in the merges replayed on 2026-10-03 were workplan
 * bodies on those paths, so a conflict a docs-only pull request leaves in one
 * would merge green and turn the next, unrelated pull request red: #772's shape,
 * which `.github/workflows/ci.yml` and `a-doc-a-test-reads-that-ci-skipped`
 * exist to stop. `docs-hygiene` runs on every change and installs nothing;
 * `lessons.mjs` and `workplan-index.mjs` run there for the same reason, and
 * now this does too.
 *
 * Usage, from any directory (it finds the repository by its own location):
 *
 *   node scripts/conflict-markers.mjs --check
 *
 * Exit 0 with one line when no file holds a conflict, 1 with every file and
 * line, and what to do about each, when one does.
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * git's four marker runs. Built, never typed: a line in this file that began
 * with one would be a conflict in this file, and the scan would be right to
 * fail on it.
 */
export const OURS = '<'.repeat(7);
export const BASE = '|'.repeat(7);
export const SPLIT = '='.repeat(7);
export const THEIRS = '>'.repeat(7);

const MARKER_TEXT = { ours: OURS, base: BASE, split: SPLIT, theirs: THEIRS };

/**
 * The files that quote a conflict ON PURPOSE, and how many each quotes.
 *
 * A fenced block in Markdown is where a quotation belongs, and it is also
 * where a real conflict can land whole: two of the 852 conflicts git wrote in
 * the replayed merges did, inside an ```ini block of
 * `docs/managed-bring-up.md`. So a fence does not excuse a conflict by itself.
 * Every quoted conflict has to be declared here, and a file that holds more or
 * fewer than it declares fails. The count, not the line: a plan's Status block
 * grows at the top, and a line number here would go stale with every session.
 *
 * Adding one is a decision, made in a pull request that runs the unit suite
 * (this file is under `scripts/`), and the guard pins the same list.
 */
export const QUOTATIONS = Object.freeze({
  // The lesson "Nothing ever parsed the bring-up": the #546 and #547 conflict,
  // quoted to show how git factors a shared closing brace out of a conflict.
  'docs/workplans/0099-an-invitation-you-can-answer.md': 1,
});

/** Which marker a line is, if any. git writes the run, then a space and a label, or nothing. */
export function markerOf(line) {
  if (/^<{7}(?:[ \t]|$)/.test(line)) return 'ours';
  if (/^\|{7}(?:[ \t]|$)/.test(line)) return 'base';
  if (/^={7}[ \t]*$/.test(line)) return 'split';
  if (/^>{7}(?:[ \t]|$)/.test(line)) return 'theirs';
  return undefined;
}

/** CommonMark's fence line: at most three spaces, a run of three or more, the rest. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Where the fenced blocks are. `within[i]` is the 0-based line the fence
 * around line `i` opened on, or -1; `unclosed` holds the 1-based lines of
 * fences that open and never close, and so quote nothing.
 */
export function fencesOf(lines) {
  const within = lines.map(() => -1);
  const unclosed = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE.exec(lines[i]);
    // A backtick fence's info string may not hold a backtick; such a line is inline code.
    if (!open || (open[1].startsWith('`') && open[2].includes('`'))) {
      i++;
      continue;
    }
    const run = open[1];
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const c = FENCE.exec(lines[j]);
      if (c && c[1][0] === run[0] && c[1].length >= run.length && c[2].trim() === '') {
        close = j;
        break;
      }
    }
    if (close === -1) {
      // Not a fence. Read on from the next line as prose, so that whatever
      // follows is judged rather than hidden.
      unclosed.push(i + 1);
      i++;
      continue;
    }
    for (let k = i; k <= close; k++) within[k] = i;
    i = close + 1;
  }
  return { within, unclosed };
}

export const isMarkdown = (file) => /\.(?:md|markdown|mdx)$/i.test(file);

/**
 * Every unresolved conflict and stray marker in one file's text, and the
 * lines (1-based) of those that stand inside one fenced block of a Markdown
 * file, which this function calls quoted. Whether a quotation is allowed
 * there is `QUOTATIONS`'s business, not this function's.
 */
export function conflictsIn(file, text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const fences = isMarkdown(file) ? fencesOf(lines) : { within: lines.map(() => -1), unclosed: [] };

  // Marker lines, 0-based, grouped into complete conflicts and strays.
  const conflicts = [];
  const strays = [];
  let open;
  lines.forEach((line, i) => {
    const marker = markerOf(line);
    if (marker === 'ours') {
      if (open) strays.push(open.lines[0]);
      open = { lines: [i], base: false, split: false };
    } else if (marker === 'base') {
      // Only between `ours` and the split; anywhere else it is not git's.
      if (open && !open.base && !open.split) {
        open.lines.push(i);
        open.base = true;
      }
    } else if (marker === 'split') {
      // A split with nothing open is a setext underline, and passes.
      if (open && !open.split) {
        open.lines.push(i);
        open.split = true;
      }
    } else if (marker === 'theirs') {
      if (open?.split) {
        conflicts.push([...open.lines, i]);
      } else {
        if (open) strays.push(open.lines[0]);
        strays.push(i);
      }
      open = undefined;
    }
  });
  if (open) strays.push(open.lines[0]);

  const fenceOf = (i) => fences.within[i];
  const findings = [];
  const quoted = [];

  for (const markers of conflicts) {
    const fence = fenceOf(markers[0]);
    if (fence !== -1 && markers.every((i) => fenceOf(i) === fence)) {
      quoted.push(markers[0] + 1);
      continue;
    }
    const where = markers.map((i) => `${MARKER_TEXT[markerOf(lines[i])]} at ${i + 1}`).join(', ');
    findings.push({ line: markers[0] + 1, what: `an unresolved conflict (${where})` });
  }
  for (const i of strays) {
    if (fenceOf(i) !== -1) {
      quoted.push(i + 1);
      continue;
    }
    findings.push({
      line: i + 1,
      what: `a stray ${MARKER_TEXT[markerOf(lines[i])]} line, left by a resolution that removed the rest of its conflict`,
    });
  }

  return {
    quoted: quoted.sort((a, b) => a - b),
    findings: findings
      .map((f) => {
        const fence = fences.unclosed.filter((n) => n < f.line).at(-1);
        return fence === undefined
          ? f
          : { ...f, what: `${f.what}; the fence opened at line ${fence} never closes, so it quotes nothing` };
      })
      .sort((a, b) => a.line - b.line),
  };
}

/**
 * The conflicts inside fences that `declared` does not account for, as
 * findings. A file that quotes fewer than it declares is one too, with line 0
 * for the file as a whole: a declaration nothing uses would excuse the next
 * conflict that lands in a fence there.
 */
export function quotationFindings(quoted, declared = QUOTATIONS) {
  const findings = [];
  const files = [...new Set([...Object.keys(quoted), ...Object.keys(declared)])].sort();
  for (const file of files) {
    const lines = quoted[file] ?? [];
    const want = declared[file] ?? 0;
    if (lines.length === want) continue;
    if (lines.length < want) {
      findings.push({
        file,
        line: 0,
        what:
          `QUOTATIONS declares ${want} quoted conflict(s) in this file and it holds ${lines.length}: ` +
          'put the quotation back, or take it out of QUOTATIONS in scripts/conflict-markers.mjs',
      });
      continue;
    }
    for (const line of lines) {
      findings.push({
        file,
        line,
        what:
          want === 0
            ? 'a conflict inside a fenced block, in a file that declares no quotation: a real one ' +
              'can land in a fence whole, so resolve it, or declare it in QUOTATIONS in ' +
              'scripts/conflict-markers.mjs if it quotes one on purpose'
            : `one of ${lines.length} conflicts inside fenced blocks, where QUOTATIONS declares ${want}: ` +
              'resolve the one that is not a quotation, or declare it',
      });
    }
  }
  return findings;
}

/** git's own test for binary: a NUL in the first 8,000 bytes. */
export const isBinary = (bytes) => bytes.subarray(0, 8000).includes(0);

/**
 * Every file `git ls-files` lists under `root`, untracked ones included, read
 * and judged. `findings` holds both the conflicts and the quotations
 * `declared` does not account for.
 */
export function scanTree(root = REPO_ROOT, declared = QUOTATIONS) {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // A path mid-merge is listed once per stage; once is enough.
  const files = [...new Set(listing.split('\0').filter(Boolean))].sort();

  const scanned = [];
  const binary = [];
  const findings = [];
  const quoted = {};
  for (const file of files) {
    const path = join(root, file);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      // In the index, gone from the working tree: no content, no marker. Any
      // other failure to read is a failure, not a pass.
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
    const verdict = conflictsIn(file, bytes.toString('utf8'));
    for (const f of verdict.findings) findings.push({ file, ...f });
    if (verdict.quoted.length > 0) quoted[file] = verdict.quoted;
  }
  findings.push(...quotationFindings(quoted, declared));
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { scanned, binary, findings, quoted };
}

/** The failure message: every file and line, and what to do about each. */
export function verdictMessage(found) {
  const files = new Set(found.map((f) => f.file)).size;
  return [
    `${files} file(s) hold a merge conflict nobody finished resolving:`,
    '',
    ...found.map((f) => `  ${f.file}${f.line > 0 ? `:${f.line}` : ''}  ${f.what}`),
    '',
    'Resolve each one: keep what the merge should have produced and delete every marker line.',
    'A generated file (docs/LESSONS.md, the index in docs/workplans/README.md, docs/adr/OPERATIVE.md,',
    'pnpm-lock.yaml) is resolved by regenerating it on the merged tree, never by hand.',
    'If a Markdown file QUOTES a conflict on purpose, put the whole quotation inside one fenced',
    'code block (``` or ~~~) and declare it in QUOTATIONS in scripts/conflict-markers.mjs:',
    'that is the only place this check accepts one.',
  ].join('\n');
}

/** `--check`: the exit status, with the verdict printed. */
export function main(argv = process.argv.slice(2), root = REPO_ROOT) {
  if (argv.length !== 1 || argv[0] !== '--check') {
    console.error('usage: conflict-markers.mjs --check');
    return 2;
  }
  const tree = scanTree(root);
  if (tree.findings.length > 0) {
    console.error(verdictMessage(tree.findings));
    return 1;
  }
  const quotations = Object.values(tree.quoted).reduce((n, lines) => n + lines.length, 0);
  console.log(
    `no merge conflict in ${tree.scanned.length} files (${tree.binary.length} binary passed over); ` +
      `${quotations} declared quotation(s) of one, in ${Object.keys(tree.quoted).sort().join(', ') || 'no file'}`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
