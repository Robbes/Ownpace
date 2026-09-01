// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The lessons index cannot drift from the guards it indexes.
 *
 * `docs/LESSONS.md` exists because this repository's best documentation is in
 * the headers of the guards in `scripts/` — and those can only be found BY
 * NAME. On 2026-09-01 an agent writing a Postgres probe was saved by
 * `the-check-postgres-never-made` purely because the file happened to be next
 * to something else it was reading, and on the same day it reconstructed
 * `docs/rls-guide.md` §1 and §2 from the migrations without ever finding the
 * guide. Neither was an absence of documentation. Both were an absence of a
 * ROUTE from "I am about to touch this file" to "here is what is already known
 * about it".
 *
 * So the index is GENERATED — OPERATIVE.md's reason exactly (ADR-0038): a
 * hand-written second list of what the guards cover is the thing it replaces,
 * and a summary that can disagree with its source is worse than none. This
 * regenerates and diffs.
 *
 * AND IT MAKES ONE NEW DEMAND, which is the interesting half: every guard must
 * open with a sentence worth reading. A guard with no header is a defect nobody
 * recorded — the file name says what is checked and nothing says what it cost.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_DIR = join(REPO_ROOT, 'scripts');
const GENERATOR = join(REPO_ROOT, 'scripts', 'lessons.mjs');
const LESSONS = join(REPO_ROOT, 'docs', 'LESSONS.md');

/**
 * What the index ended up SAYING about one guard.
 *
 * Read out of the generated file rather than by importing the generator's
 * extractor. Two reasons, and the second is the better one: `.mjs` has no
 * declaration file so the import needs typing machinery to say nothing; and a
 * test that calls the extractor proves the extractor works, while this proves
 * the ARTIFACT does — which is what somebody actually opens.
 */
const headlineInIndex = (text: string, guard: string): string => {
  const heading = `](../scripts/${guard})`;
  const at = text.indexOf(heading, text.indexOf('## 2. By guard'));
  if (at === -1) return '';
  const after = text.slice(text.indexOf('\n', at) + 1);
  return after.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
};

const guards = readdirSync(GUARD_DIR)
  .filter((f) => f.endsWith('.unit.test.ts'))
  .sort();

describe('LESSONS.md is build output, not a second source', () => {
  it('matches a fresh regeneration exactly — the drift guard', () => {
    // The real generator in check mode, rather than a reimplementation here:
    // a reimplementation could drift from the generator, which would guard
    // nothing. `adr-operative.unit.test.ts` says the same and does the same.
    const r = execFileSync('node', [GENERATOR, '--check'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(r).toContain('LESSONS.md is current');
  });

  it('covers every guard in scripts/, so the index cannot go quietly stale', () => {
    // Never vacuous, and this is the assertion that catches a guard added in a
    // hurry: the file exists, the test passes, and nothing routes anybody to it.
    expect(guards.length, 'no guards found at all').toBeGreaterThan(20);
    const text = readFileSync(LESSONS, 'utf8');
    for (const guard of guards) {
      expect(text, `${guard} is not in the index`).toContain(`../scripts/${guard}`);
    }
  });
});

describe('every guard says what it is about', () => {
  it.each(guards.map((g) => [g]))('%s opens with a sentence', (guard) => {
    const line = headlineInIndex(readFileSync(LESSONS, 'utf8'), guard);
    expect(line, `${guard} has no entry in §2 at all`).not.toBe('_(no header)_');
    expect(
      line.length,
      `${guard} has no readable header.\n\n` +
        'A guard whose file name says WHAT is checked and whose header says ' +
        'nothing about\nWHY leaves the next person the filename and a shrug. ' +
        'Open it with one sentence\nnaming the defect — the other guards in ' +
        'this directory are the pattern.',
    ).toBeGreaterThan(20);
  });
});

describe('the index points at files that exist', () => {
  it('never invents a path', () => {
    // The extractor resolves bare filenames through `git ls-files`, and an
    // ambiguous basename is dropped rather than guessed. A lesson filed against
    // a path that does not exist is worse than one filed nowhere: it sends
    // somebody to look for a file, and it makes the whole index untrustworthy.
    const text = readFileSync(LESSONS, 'utf8');
    const headings = [...text.matchAll(/^### `(?<path>[^`]+)`$/gm)].map((m) => m.groups!.path!);
    expect(headings.length, 'section 1 indexes nothing').toBeGreaterThan(20);
    for (const path of headings) {
      expect(existsSync(join(REPO_ROOT, path)), `LESSONS.md lists ${path}, which is not here`).toBe(
        true,
      );
    }
  });

  it('routes the files this session actually got wrong', () => {
    // The three that cost real time on 2026-09-01, named so this index cannot
    // silently stop covering the case it was built for.
    const text = readFileSync(LESSONS, 'utf8');
    for (const path of [
      'deploy/compose/smoke-managed.sh',
      'deploy/compose/managed.yml',
      'apps/api/src/scripts/seed-managed.ts',
    ]) {
      expect(text, `nothing routes an editor of ${path}`).toContain(`### \`${path}\``);
    }
  });
});
