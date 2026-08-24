// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST THAT LEAKS STILL PASSES, WHICH IS WHY NOTHING NOTICED FOR MONTHS.
 *
 * On 2026-08-24 this repository's own development box ran out of disk. Not the
 * managed stack, not a runaway container: 29GB of `/tmp/openmig-*` directories
 * left behind by the UNIT SUITE, one `mkdtempSync` at a time. Measured before
 * the fix: 24 directories, 322MB, PER RUN — a PGlite data directory is 41MB,
 * and twelve test files created them and never removed them.
 *
 * Everything downstream of that was confusing rather than obvious. `pnpm
 * vitest run` reported 235 test FILES failing to collect, with errors about
 * ports and undefined properties; the actual message, buried among them, was
 * `ENOSPC: no space left on device`. A disk that is full does not fail like a
 * disk that is full.
 *
 * IT IS NOT ONLY A LAPTOP PROBLEM. `unit-tests` and `integration-tests` run on
 * the SELF-HOSTED runner for pushes to main — the same Spark the managed stack
 * needs ~15GB free on, and the same box that spent yesterday having its disk
 * quietly filled by a backup drill that kept every dump (0099). Two unrelated
 * leaks on one machine in two days is a pattern, not bad luck: things that
 * write to disk on every run need somebody to say when they stop.
 *
 * THE RULE, AND ITS LIMIT: a test file that calls `mkdtempSync` must also
 * CALL `rmSync` — an import alone does not count, which is what several of
 * these files had.
 *
 * It deliberately does NOT insist the call sits in an `afterEach`/`afterAll`.
 * The first version did, and it was wrong twice over: `try { … } finally {
 * rmSync(dir) }` inside a test is a perfectly good scoped cleanup, and an
 * expression-bodied hook — `afterEach(() => rmSync(dir, { recursive: true }))`
 * — has no braced body at all, so a brace-scanner reads the OPTIONS OBJECT as
 * the hook and finds no cleanup in it. Eight healthy files were flagged.
 *
 * So this checks the thing that actually went wrong: twelve files that made
 * temp directories and never removed any of them, anywhere. A file that
 * cleans two paths out of three still passes here, and that is an accepted
 * limit — a guard that cries wolf gets disabled, and a weaker rule that is
 * right beats a stronger one that is not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function testFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-selfhost', 'build', '.git', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFiles(full, acc);
    else if (/\.(unit\.test|integration\.test|e2e\.test|ui\.test)\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Does this file make a temp directory and never remove one? */
export function leaksTempDirs(source: string): boolean {
  if (!/\bmkdtempSync\s*\(/.test(source)) return false;
  return !/\brmSync\s*\(/.test(source);
}

describe('the scanner tells a call from an import', () => {
  it('flags a file that makes a temp dir and never removes it', () => {
    expect(leaksTempDirs('const d = mkdtempSync(join(tmpdir(), "x-"));')).toBe(true);
  });

  it('flags a file that IMPORTS rmSync without ever calling it', () => {
    // Exactly what the leaking files looked like once a previous fix had added
    // the import and stopped there.
    const source = [
      "import { mkdtempSync, rmSync } from 'node:fs';",
      'const d = mkdtempSync(join(tmpdir(), "x-"));',
    ].join('\n');
    expect(leaksTempDirs(source)).toBe(true);
  });

  it('accepts cleanup in afterAll', () => {
    const source = [
      'const d = mkdtempSync(join(tmpdir(), "x-"));',
      'afterAll(() => { rmSync(d, { recursive: true, force: true }); });',
    ].join('\n');
    expect(leaksTempDirs(source)).toBe(false);
  });

  it('accepts an expression-bodied hook, which has no braces to scan', () => {
    const source = [
      'const d = mkdtempSync(join(tmpdir(), "x-"));',
      'afterEach(() => rmSync(d, { recursive: true, force: true }));',
    ].join('\n');
    expect(leaksTempDirs(source)).toBe(false);
  });

  it('accepts try/finally inside a test, which is a scoped cleanup and fine', () => {
    const source = [
      'it("x", () => { const d = mkdtempSync(join(tmpdir(), "x-"));',
      '  try { work(d); } finally { rmSync(d, { recursive: true, force: true }); } });',
    ].join('\n');
    expect(leaksTempDirs(source)).toBe(false);
  });

  it('leaves a file that makes no temp directory alone', () => {
    expect(leaksTempDirs('afterAll(() => {});')).toBe(false);
  });
});

describe('no test in this repository leaves its temp directories behind', () => {
  const files = testFiles(ROOT);

  it('found test files to check', () => {
    // A scanner that matches nothing passes forever.
    expect(files.length).toBeGreaterThan(100);
  });

  it('every one that makes a temp directory removes it', () => {
    const offenders = files
      .filter((f) => leaksTempDirs(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));

    expect(
      offenders,
      'these call mkdtempSync and never call rmSync at all. A PGlite data ' +
        'directory is 41MB, unit-tests run on the self-hosted runner, and the ' +
        'box that runs them also has to keep ~15GB free for the managed stack. ' +
        'Clean up in an afterEach/afterAll, or in a try/finally — either counts.',
    ).toEqual([]);
  });
});
