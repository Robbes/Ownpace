// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * How hard we push a customer's server is ONE number, in one place.
 *
 * Found on 2026-08-07 during a sweep for checks that pass while proving
 * nothing. `DEFAULT_CONCURRENCY` existed four times:
 *
 *   - `packages/core/src/reconcile.ts`            — the mail pass
 *   - `packages/core/src/domain-sync.ts`          — calendar, contacts, files
 *   - `apps/worker/src/build-deps.ts`             — the worker's own copy
 *   - `apps/worker/src/build-deps-from-mapping.ts` — a bare `?? 4`
 *
 * The third carried a comment reading "Matches `DEFAULT_CONCURRENCY` in
 * @openmig/core — kept in step deliberately, so the managed and self-host paths
 * do not quietly disagree about how hard they push a customer's server."
 * Nothing kept it in step. The fourth is the MANAGED path and did not reference
 * any constant at all, so retuning the default would have moved the appliance
 * and left the managed service where it was — hard rule 5's edition split,
 * arriving as a rate limit on somebody else's mail server.
 *
 * The value is now exported once from `concurrency.ts` and imported, which
 * makes that particular drift impossible rather than merely discouraged. What
 * this file guards is the NEXT copy: a `?? 4` written in a hurry six months
 * from now looks completely reasonable in review, and is the same bug again.
 *
 * Modelled on `no-raw-console.unit.test.ts`, including its second test — a
 * source-scanning check whose paths have gone stale examines nothing and passes
 * loudly, which is the failure mode this whole sweep is about.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_CONCURRENCY } from './concurrency';

/** Product source that could plausibly default a concurrency. */
const ROOTS = [
  'packages/core/src',
  'packages/engines/src',
  'packages/connectors/src',
  'packages/shared/src',
  'apps/worker/src',
  'apps/selfhost/src',
  'apps/api/src',
];

/** The one module allowed to state the number. */
const HOME = 'packages/shared/src/concurrency.ts';

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFilesUnder(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

const repoRoot = (): string => resolve(__dirname, '../../..');

describe('one default concurrency', () => {
  it('is stated in exactly one module', () => {
    const root = repoRoot();
    const offenders: string[] = [];

    for (const r of ROOTS) {
      for (const file of tsFilesUnder(join(root, r))) {
        const rel = file.slice(root.length + 1);
        if (rel === HOME) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            // Comments discuss the number freely — several explain the 4 → 8 → 4
            // history, and rewriting those would lose the reason for the value.
            const code = line.replace(/\/\/.*$/, '');
            if (/^\s*\*/.test(line)) return;
            if (/\bDEFAULT_CONCURRENCY\s*=\s*\d/.test(code)) {
              offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }

    expect(
      offenders,
      `import DEFAULT_CONCURRENCY from @openmig/shared instead of re-declaring it, ` +
        `so the managed and self-host editions cannot disagree about how hard they ` +
        `push a customer's server (hard rule 5):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('is not smuggled back in as a literal fallback', () => {
    // `concurrency: config.concurrency ?? 4` is how the managed path came to
    // have its own default without ever naming one. It reads as harmless.
    const root = repoRoot();
    const offenders: string[] = [];

    for (const r of ROOTS) {
      for (const file of tsFilesUnder(join(root, r))) {
        const rel = file.slice(root.length + 1);
        if (rel === HOME) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '');
            if (/^\s*\*/.test(line)) return;
            if (/concurrency[^\n]{0,40}\?\?\s*\d/i.test(code)) {
              offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          });
      }
    }

    expect(
      offenders,
      `fall back to DEFAULT_CONCURRENCY, not to a literal:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('actually scans every root it claims to', () => {
    // Guards the guard, PER ROOT rather than in total.
    //
    // The first version of this asserted `scanned.length > 100` across all
    // seven roots, the way `no-raw-console.unit.test.ts` does. Renaming ONE
    // root to `packages/core/srcX` — deleting the entire mail and domain-sync
    // surface from the scan — left the total comfortably over 100 and the test
    // green. A check that cannot tell "I looked everywhere" from "I looked
    // almost everywhere" is the same shape as the bug this file exists for.
    const root = repoRoot();
    const empty = ROOTS.filter((r) => tsFilesUnder(join(root, r)).length === 0);
    expect(empty, `these roots resolved to nothing — stale paths scan nothing and pass`).toEqual([]);

    for (const r of ROOTS) {
      expect(tsFilesUnder(join(root, r)).length, r).toBeGreaterThan(2);
    }
  });

  it('is a number a target can actually take', () => {
    // Not a tautology against the constant's own value: these are the bounds
    // the choice has to satisfy. 0 would stall every pass; the ~500-item
    // Stalwart run that answered 429 is why the upper bound is where it is.
    expect(DEFAULT_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_CONCURRENCY).toBeLessThanOrEqual(8);
    expect(Number.isInteger(DEFAULT_CONCURRENCY)).toBe(true);
  });
});
