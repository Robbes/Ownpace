// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every 500 the API can answer with goes through `serverFault` (workplan 0081).
 *
 * 0079 converted the eleven routes that leaked `String(error)` and left
 * forty-three others answering `{ error: 'Internal server error', message:
 * 'Failed to list mappings' }`. That body is safe — it leaks nothing — and it
 * is still the wrong answer, for the reason 0068 T10c gave: it hands the person
 * in front of the screen no way to reach the stack. Reference `e133a809` is the
 * only reason the create-route 500 was diagnosed rather than guessed at, and it
 * existed because *that one route* had been fixed by hand.
 *
 * **This is a test rather than a grep because a grep is what failed.** 0079's
 * own verification was `grep -v test`, which filters LINES, not files — and the
 * one line it should have caught reads `error: 'test_failed'`, so the finding
 * hid inside the filter meant to exclude test files. The count looked right.
 * A check that only runs when somebody remembers to run it, written freshly
 * each time, is a check that can be written wrong each time; this one runs on
 * every push and states its allow-list out loud.
 *
 * The allow-list is the honest part. Two 500s are NOT faults with a reference:
 * they are configuration refusals whose message *is* the fix, and wrapping them
 * in "something went wrong on our side" would destroy the only actionable words
 * they carry. They are named here so that adding a third is a deliberate edit
 * to this file rather than a silent drift back.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname);

/**
 * Sites that answer 500 without a reference, on purpose.
 *
 * Each entry is a source line that must still be present verbatim. If one is
 * reworded the test fails and the exception gets re-decided, rather than the
 * allow-list quietly covering something new.
 */
const DELIBERATE: ReadonlyArray<{ file: string; marker: string; why: string }> = [
  {
    file: 'middleware/auth.ts',
    marker: "error: 'Server Configuration Error',",
    why:
      "AuthNotConfiguredError's message names the environment variable the operator " +
      'has to set. That sentence is the fix, and a reference id replaces it with nothing.',
  },
  {
    file: 'routes/billing/index.ts',
    marker: "error: 'Configuration error',",
    why:
      '"Mollie API key not configured" is the same shape: an operator-facing ' +
      'configuration answer, not a bug to be looked up in a log.',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    // Exclude by PATH, not by whether the word "test" appears on a line —
    // which is the mistake this whole file exists to make unrepeatable.
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/** Every `res.status(500)` in the API source, as `relative path` + line. */
function five_hundreds(): Array<{ file: string; line: number; text: string }> {
  const found: Array<{ file: string; line: number; text: string }> = [];
  for (const full of sourceFiles(SRC)) {
    if (relative(SRC, full) === 'server-fault.ts') continue;
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (text.includes('status(500)')) {
        found.push({ file: relative(SRC, full), line: i + 1, text: text.trim() });
      }
    });
  }
  return found;
}

describe('every 500 carries a reference', () => {
  it('has no hand-rolled 500 outside serverFault and the named exceptions', () => {
    const allowedFiles = new Set(DELIBERATE.map((d) => d.file));
    const stray = five_hundreds().filter((f) => !allowedFiles.has(f.file));
    // Named, not counted: a bare count tells the next person nothing about
    // which route stopped being diagnosable.
    expect(stray.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
  });

  it('still contains each deliberate exception, worded as it was decided', () => {
    for (const { file, marker, why } of DELIBERATE) {
      const source = readFileSync(join(SRC, file), 'utf8');
      expect(source, `${file} no longer contains the allow-listed 500 (${why})`).toContain(marker);
    }
  });

  it('gives each operating queue its own code, not one shared operating_failed', () => {
    // Owner decision, workplan 0081 T6. These nineteen routes serve six
    // different queues; one shared code puts a caller back where this workplan
    // started — a fault it cannot tell apart from a different fault. Pinned
    // because the way this regresses is a copy-pasted catch block, which no
    // amount of care at review time reliably catches.
    const source = readFileSync(join(SRC, 'routes/migrations/operating-routes.ts'), 'utf8');
    const codes = [...source.matchAll(/serverError\(res, '([a-z_]+)',/g)].flatMap((m) =>
      m[1] ? [m[1]] : [],
    );
    expect(codes.length).toBe(19);
    // Named, not counted: a Set-size comparison would report "18 !== 19" and
    // leave the next person to find WHICH two collided.
    const seen = new Set<string>();
    const collisions = codes.filter((c) => (seen.has(c) ? true : (seen.add(c), false)));
    expect(collisions).toEqual([]);
  });

  it('reaches the routes it claims to — the sweep is not silently empty', () => {
    // A file walk that finds nothing would pass the first test perfectly.
    const files = sourceFiles(SRC).map((f) => relative(SRC, f));
    expect(files).toContain('routes/migrations/index.ts');
    expect(files).toContain('routes/billing/index.ts');
    expect(files.length).toBeGreaterThan(20);
    // And it must exclude test files by path, including the one whose own
    // content would have slipped through a line filter.
    expect(files.some((f) => f.endsWith('.test.ts'))).toBe(false);
  });
});
