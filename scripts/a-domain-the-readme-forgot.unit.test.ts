// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DOCUMENTATION IS A FAN-OUT SITE, AND PROSE HAS NO TYPE CHECKER.
 *
 * Workplan 0113 added the task domain. #750 found the verification report had
 * no `tasks` key, #751 found the smoke's verify half skipped it, #752 found a
 * bare `else` running the file pass for it. Five sites, all in code, all
 * eventually caught by something that could fail.
 *
 * The README said "all four domains" until 2026-09-03 and nothing anywhere
 * could notice. It is the first thing a prospective user, contributor or
 * grant reviewer reads, and it undercounted what the product carries — the
 * quiet kind of wrong that survives because prose has no type checker.
 *
 * ## What this holds
 *
 * Any claim in the README of the form "N domains" must agree with
 * `VERIFICATION_DOMAINS`, which is the list the verification report is built
 * from and therefore the honest count of what a migration is checked across.
 *
 * ## What it deliberately does NOT hold
 *
 * It does not check the prose LISTS the right domains by name
 * ("calendar/contacts/files/tasks"). A regex over English would either miss
 * real drift or fail on a sentence that is fine, and a guard that cries wolf
 * gets weakened. The count is the part a machine can own; the naming stays
 * a reviewer's job. Saying so here is the point — an unstated gap in a guard
 * is how the next "four" gets written.
 *
 * Read as text: this file is at the repository root, where workspace imports
 * do not resolve, and the value being asserted lives in `@openmig/shared`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** The domains a verification report is built from — the honest count. */
function verificationDomainCount(): number {
  const src = readFileSync(
    join(REPO_ROOT, 'packages/shared/src/verification-report.ts'),
    'utf8',
  );
  const match = /export const VERIFICATION_DOMAINS = \[([^\]]*)\]/.exec(src);
  const members = match?.[1];
  expect(
    members,
    'VERIFICATION_DOMAINS is no longer a literal array in verification-report.ts — ' +
      'this guard reads it as text, so it must stay one (or this guard must change).',
  ).toBeDefined();
  return (members ?? '').split(',').filter((s) => s.trim().length > 0).length;
}

/** The English word for a count, or the digits if we ever exceed the list. */
function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

describe('the README counts the domains the product actually carries', () => {
  it('VERIFICATION_DOMAINS is still readable as a literal, and non-trivial', () => {
    const n = verificationDomainCount();
    // A guard that reads zero domains would pass every assertion below
    // vacuously. Five today; this floor only has to catch a parse that broke.
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('every "N domains" claim in the README matches that count', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    const expected = countWord(verificationDomainCount());

    const claims = [...readme.matchAll(/\b([a-z]+)\s+domains\b/gi)]
      .map((m) => m[1]?.toLowerCase())
      .filter((word): word is string => word !== undefined && NUMBER_WORDS.includes(word));

    // If the README stops counting domains in words this finds nothing, which
    // is not a failure — it is one fewer place to drift.
    for (const word of claims) {
      expect(
        word,
        `README says "${word} domains" but VERIFICATION_DOMAINS has ${verificationDomainCount()} ` +
          `(${expected}). Widening a domain means widening the README too.`,
      ).toBe(expected);
    }
  });
});
