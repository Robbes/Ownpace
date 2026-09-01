#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// lessons.mjs — assemble docs/LESSONS.md from the guard tests in scripts/.
//
// WHY THIS EXISTS. This repository's best documentation is not in docs/. It is
// in the headers of sixty-odd guard tests whose filenames are sentences:
// `the-check-postgres-never-made`, `a-refusal-that-named-no-remedy`,
// `no-pipeline-its-own-consumer-can-kill`. Each one records a defect that
// actually happened, what it cost, and the property that now cannot regress.
//
// AND THEY CAN ONLY BE FOUND BY NAME. On 2026-09-01 an agent writing a Postgres
// probe was saved by `the-check-postgres-never-made` — by luck, because the
// file happened to be adjacent to something else it was reading. On the same
// day it reconstructed `docs/rls-guide.md` §1 and §2 by grepping migrations,
// never having found the guide, and got there slowly. Neither was an absence of
// documentation. Both were an absence of a ROUTE: nothing leads from "I am
// about to touch this file" to "here is what this repository already knows
// about it".
//
// So this inverts the index. Every guard is read for the paths it constrains,
// and the result is grouped BY THE FILE SOMEBODY IS ABOUT TO EDIT.
//
// Usage:
//   node scripts/lessons.mjs --check   # exit 1 + diff hint on drift (CI/test)
//   node scripts/lessons.mjs --write   # regenerate docs/LESSONS.md
//
// GENERATED, for OPERATIVE.md's reason (ADR-0038): a hand-written second list
// of what the guards cover is the thing it exists to replace. Edit the guard's
// own header, run --write, and `scripts/lessons.unit.test.ts` fails any state
// where the two disagree.
//
// SCOPE: `scripts/*.unit.test.ts`. Those are the cross-cutting guards — the
// ones whose subject is a file somewhere else in the repository. A colocated
// unit test is found by being next to the code it tests and needs no index.
// Widening this to all 400+ test files would produce a document nobody reads,
// which is the failure mode this replaces rather than a bigger version of it.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_DIR = join(REPO_ROOT, 'scripts');
const OUT = join(REPO_ROOT, 'docs', 'LESSONS.md');

/** Extensions a guard plausibly reads. Anything else is not a file it protects. */
const EXTENSIONS = ['ts', 'tsx', 'mjs', 'sh', 'yml', 'yaml', 'md', 'sql', 'json', 'example'];

/** The guard files, by location. */
export function guardFiles(dir = GUARD_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.unit.test.ts'))
    .sort();
}

/**
 * Every tracked file in the repo, indexed by basename.
 *
 * `git ls-files` rather than a walk: it already excludes node_modules, build
 * output and anything gitignored, and it is one process instead of thousands
 * of stats. A basename with more than one match is AMBIGUOUS and deliberately
 * dropped — guessing which `index.ts` a guard meant would put a lesson on the
 * wrong file, which is worse than leaving it off.
 *
 * `--others --exclude-standard` alongside `--cached`, which is not decoration.
 * Without it the listing is what is STAGED, so the same working tree generates
 * two different documents depending on whether `git add` has run yet — and the
 * drift test then fails after a commit for a reason that has nothing to do with
 * the guards. Found on 2026-09-01 by rebasing: files written and indexed while
 * untracked appeared the moment they were committed. The output must be a
 * function of the tree, or it cannot be a build artifact.
 */
export function repoIndex(root = REPO_ROOT) {
  const listing = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  );
  const byBase = new Map();
  const all = new Set();
  for (const path of listing.split('\n')) {
    if (!path) continue;
    all.add(path);
    const base = basename(path);
    if (byBase.has(base)) byBase.set(base, null); // ambiguous from here on
    else byBase.set(base, path);
  }
  return { byBase, all };
}

/**
 * The first thing a guard's header says about itself.
 *
 * These headers open with a sentence naming the defect — often a capitalised
 * title line, sometimes straight into prose. Taking the first SENTENCE of the
 * first paragraph gets both shapes right, and a header that opens with
 * something useless is a header to fix rather than a case to special-case.
 */
export function headline(text) {
  // The copyright line first, then the header block, in either comment style.
  const body = text.replace(/^\/\/ Copyright[^\n]*\n/, '');
  const block =
    /^\s*\/\*\*(?<jsdoc>[\s\S]*?)\*\//.exec(body)?.groups?.jsdoc ??
    /^(?<line>(?:\s*\/\/[^\n]*\n)+)/.exec(body)?.groups?.line ??
    '';
  const lines = block
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\*|\/\/)\s?/, '').trim())
    .filter((l) => !l.startsWith('Copyright'));
  const paragraph = [];
  for (const line of lines) {
    if (line === '') {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line);
  }
  const prose = paragraph.join(' ').trim();
  if (!prose) return '';
  // First sentence, but never cut mid-abbreviation on a `§` or a version dot.
  const stop = /(?<=[.?!])\s+(?=[A-Z(`])/.exec(prose);
  const first = stop ? prose.slice(0, stop.index) : prose;
  return (first.length > 240 ? `${first.slice(0, 237)}…` : first).replace(/\s+/g, ' ');
}

/**
 * The repo files one guard reads.
 *
 * Two shapes, because the guards use two. A full relative path in a string
 * literal is taken as-is when it exists; a bare filename — the `read('x.sh')`
 * idiom, where the directory is a constant defined at the top — is resolved
 * through the basename index. Anything that resolves to nothing is dropped
 * silently: a guard mentioning `0001_baseline.sql` in prose is not a claim
 * about a path, and inventing one would make this file lie.
 */
export function guardedPaths(text, index, self) {
  const found = new Set();
  const extensions = EXTENSIONS.join('|');
  const literal = new RegExp(`['"\`]([\\w./@-]+\\.(?:${extensions}))['"\`]`, 'g');
  for (const match of text.matchAll(literal)) {
    const raw = match[1];
    if (raw === self || basename(raw) === self) continue;
    if (raw.includes('/')) {
      const cleaned = raw.replace(/^\.\//, '');
      if (index.all.has(cleaned)) found.add(cleaned);
      continue;
    }
    const resolved = index.byBase.get(raw);
    if (resolved) found.add(resolved);
  }
  return [...found].sort();
}

export function collect(dir = GUARD_DIR, index = repoIndex()) {
  return guardFiles(dir).map((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    return {
      file,
      name: file.replace(/\.unit\.test\.ts$/, ''),
      headline: headline(text),
      paths: guardedPaths(text, index, file),
    };
  });
}

export function assemble(dir = GUARD_DIR, index = repoIndex()) {
  const guards = collect(dir, index);

  /** path -> guards that read it */
  const byPath = new Map();
  for (const guard of guards) {
    for (const path of guard.paths) {
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(guard);
    }
  }

  const out = [
    '<!-- GENERATED by scripts/lessons.mjs — DO NOT EDIT THIS FILE. -->',
    '<!-- Edit the guard test’s own header comment, then run: -->',
    '<!--   node scripts/lessons.mjs --write -->',
    '',
    '# What this repository has already learned',
    '',
    `Assembled from the ${guards.length} cross-cutting guards in [\`scripts/\`](../scripts/) —`,
    'the tests whose subject is a file somewhere else, and whose filenames are',
    'sentences. Each one records a defect that actually happened and the property',
    'that now cannot regress.',
    '',
    '**Read §1 before editing a file it lists.** That is the whole point: the',
    'knowledge was always here, in headers nobody could search by subject. A',
    'colocated unit test is not indexed — it is found by sitting next to its code.',
    '',
    'Paths are extracted from what each guard actually reads, so a guard that stops',
    'reading a file drops off its entry by itself.',
    '',
    '## 1. By file — what constrains the thing you are about to edit',
    '',
  ];

  for (const path of [...byPath.keys()].sort()) {
    out.push(`### \`${path}\``, '');
    for (const guard of byPath.get(path)) {
      out.push(`- [${guard.name}](../scripts/${guard.file}) — ${guard.headline}`);
    }
    out.push('');
  }

  out.push('## 2. By guard — what each one is about', '');
  for (const guard of guards) {
    out.push(`### [${guard.name}](../scripts/${guard.file})`, '');
    out.push(guard.headline || '_(no header)_', '');
    if (guard.paths.length) {
      out.push('Reads:', '');
      for (const path of guard.paths) out.push(`- \`${path}\``);
      out.push('');
    }
  }

  return `${out.join('\n').trimEnd()}\n`;
}

const mode = process.argv[2];
if (mode === '--write') {
  writeFileSync(OUT, assemble());
  console.log(`wrote ${OUT}`);
} else if (mode === '--check') {
  const want = assemble();
  let have = '';
  try {
    have = readFileSync(OUT, 'utf8');
  } catch {
    /* missing counts as drift */
  }
  if (have !== want) {
    console.error('docs/LESSONS.md is out of date with the guards in scripts/.');
    console.error('Regenerate it:  node scripts/lessons.mjs --write');
    process.exit(1);
  }
  console.log('LESSONS.md is current');
} else if (mode !== undefined) {
  console.error('usage: lessons.mjs [--check | --write]');
  process.exit(2);
}
