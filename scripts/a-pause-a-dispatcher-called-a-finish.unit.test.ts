// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Both dispatchers must tell a stop from a finish, and neither may bill a
 * negative hour for it.
 *
 * ## The defect
 *
 * `runDomainSync` has returned a `budgetPause` since workplan 0090 T4
 * (2026-08-26) and nothing read it. Both dispatchers — `runOneDomain` in
 * `packages/orchestration/src/orchestration.ts` for the appliance, and the
 * domain loop in `apps/worker/src/jobs/run-delta-sync.ts` for the managed
 * stack — dropped it and called `markCompleted`. So a mail pass that stopped
 * at Gmail's 2 500 MB daily ceiling reported the mailbox finished, with a
 * "last synced" time beside a mailbox that was half copied and would not move
 * again for hours.
 *
 * Two dispatchers of identical shape and separate code: a fix to one is not a
 * fix to the other, which is what `a-domain-the-dispatchers-forgot` was
 * written for and why this holds them together the same way.
 *
 * ## And the money half
 *
 * The managed dispatcher meters compute per domain pass. It used to re-read
 * `migration_status` and subtract `completedAt - startedAt`, gated on
 * `completedAt` being set. `markInProgress` writes `started_at = now()` at the
 * top of THIS pass while `completed_at` still holds the PREVIOUS pass's
 * finish, so for any pass that ran and did not complete the subtraction is
 * negative — a negative quantity and a negative cost, a credit, for a pass
 * that copied somebody's mail. Making pauses ordinary makes that case
 * ordinary, so it is pinned here beside the fix that caused it.
 *
 * Read as text: what is asserted is the SHAPE of a branch chain and which
 * clock a metering call is handed, and no runtime call can observe either
 * without a database, two DAV servers and a Trigger.dev runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The same text with its comments removed — a comment is prose about code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const read = (rel: string): string => code(readFileSync(join(REPO_ROOT, rel), 'utf8'));

const APPLIANCE = 'packages/orchestration/src/orchestration.ts';
const MANAGED = 'apps/worker/src/jobs/run-delta-sync.ts';

describe('a pass that stopped at the day’s ceiling is not marked completed', () => {
  for (const [what, path] of [
    ['the appliance (orchestration.runOneDomain)', APPLIANCE],
    ['the managed worker (run-delta-sync)', MANAGED],
  ] as const) {
    it(`${what} records the pause`, () => {
      const src = read(path);
      expect(src, `${path} no longer reads the pass's budgetPause`).toContain('budgetPause');
      expect(src, `${path} no longer records a pause on the status row`).toContain('markPaused');
    });

    it(`${what} turns it into the customer's own vocabulary`, () => {
      // Through the ONE conversion, so the sentence a customer reads cannot
      // differ between the editions (hard rule 5).
      expect(read(path)).toContain('budgetPauseToReason');
    });
  }

  it('the appliance carries the pause out of EVERY domain branch', () => {
    // The branch chain runs five passes and each returns its own result. A
    // sixth domain whose branch forgets this line would pause invisibly —
    // the exact shape of the defect, one domain along.
    const src = read(APPLIANCE);
    const carried = src.match(/budgetPause = result\.budgetPause;/g) ?? [];
    expect(
      carried.length,
      'every domain branch in runOneDomain must carry its pass\'s budgetPause out',
    ).toBe(5);
  });
});

describe('the managed worker times the pass it ran, and bills nothing', () => {
  const src = read(MANAGED);

  /**
   * SUPERSEDED, and stronger for it (workplan 0121 T3, 2026-09-08).
   *
   * This used to assert that the metering call was handed
   * `startedAt: domainPassStartedAt` — the pass's own wall clock — because
   * reading `completedAt` off the status row produced a NEGATIVE duration for
   * any pass that ran and did not complete, and billed a credit for copying
   * somebody's mail.
   *
   * There is no metering call here any more: compute derives from the `run`
   * row this task already opens and closes. A dispatcher that bills nothing
   * cannot bill a negative hour, so the property this guard exists for is now
   * structural. What is still asserted is the clock — `domainSeconds` measures
   * from the same per-pass start, and is the thing the derivation's per-domain
   * split is built from — and, in place of the old assertion, that the two
   * writes really are gone rather than moved somewhere quieter.
   */
  it('measures each domain from the pass’s own start', () => {
    expect(src).toContain('const domainPassStartedAt = new Date();');
    expect(src).toMatch(/domainSeconds\[domain\][\s\S]{0,120}domainPassStartedAt\.getTime\(\)/);
  });

  it('never times a pass by a completion the row is still carrying', () => {
    // The negative-duration bug, in one line: `domainStatus.completedAt` from
    // a PREVIOUS pass, subtracted from THIS pass's start.
    expect(
      src.includes('domainStatus.completedAt'),
      'metering must not read a completion time off the status row — see this file’s comment',
    ).toBe(false);
  });

  it('writes no billing row from inside the domain pass', () => {
    // Both upserts sat one line above the catch that calls markFailed, so a
    // billing write that threw was reported as a failed mail migration.
    expect(src).not.toContain('recordComputeForRun');
    expect(src).not.toContain('recordApiCallForRun');
  });
});
