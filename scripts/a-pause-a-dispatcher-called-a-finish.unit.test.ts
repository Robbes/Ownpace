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
const SELFHOST = 'apps/selfhost/src/index.ts';

/** The nearest `if (` before `call` in `src`, up to the call: the condition that guards it. */
function guardOf(src: string, call: string): string {
  const at = src.indexOf(call);
  expect(at, `${call} is no longer made at all`).toBeGreaterThan(-1);
  const before = src.slice(0, at);
  return before.slice(before.lastIndexOf('if ('));
}

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

/**
 * A PASS TOLD TO STOP WHILE IT COPIED IS NOT A FINISH EITHER (2026-09-29).
 *
 * The owner pressed Pause during a file pass and the writes went on for most
 * of an hour: neither dispatcher could tell the loop, only refuse the next data
 * type. Both now hand every data type's pass a question to ask from inside
 * (`whyItStops`), and the loop answers a yes with a third pause, `haltPause`.
 * The same two holes the byte ceiling fell into are open for it: a branch
 * that drops the pause calls a stopped data type completed, and a relocation
 * auto-apply run after it removes copies on the target after the owner said
 * stop.
 */
describe('a pass told to stop while it copied is not marked completed', () => {
  for (const [what, path] of [
    ['the appliance (orchestration.runOneDomain)', APPLIANCE],
    ['the managed worker (run-delta-sync)', MANAGED],
  ] as const) {
    it(`${what} reads the pass's haltPause`, () => {
      expect(read(path), `${path} no longer reads the pass's haltPause`).toContain('haltPause');
    });
  }

  it('the appliance carries the stop out of EVERY domain branch, and hands each the question', () => {
    const src = read(APPLIANCE);
    expect((src.match(/haltPause = result\.haltPause;/g) ?? []).length).toBe(5);
    expect((src.match(/\.\.\.askedWhy\(domain\)/g) ?? []).length).toBe(5);
  });

  it('the managed worker hands the question to all five passes, and no bare deadline to any', () => {
    const src = read(MANAGED);
    for (const run of ['runShadowPass', 'runCalendarSync', 'runContactSync', 'runTaskSync', 'runFileSync']) {
      expect(src, `${run} is not handed ...passStops`).toMatch(new RegExp(`${run}\\(\\{\\s*\\.\\.\\.deps,\\s*\\.\\.\\.passStops,`));
    }
    // Once, where the question is built beside it; never again at a call,
    // where it would be a deadline without its question.
    expect((src.match(/deadline: typeDeadline/g) ?? []).length).toBe(1);
  });

  it('the managed mail branch carries the stop through the result it reshapes by hand', () => {
    expect(read(MANAGED)).toContain('...(pass.haltPause ? { haltPause: pass.haltPause } : {})');
  });

  it('neither dispatcher auto-applies a relocation after a pass that was told to stop', () => {
    // It removes the old copy on the target: exactly the write a Pause, a
    // withdrawal or a close forbids.
    expect(guardOf(read(MANAGED), 'await autoApplyOpenRelocations(')).toMatch(/toldToStop === null/);
    expect(guardOf(read(APPLIANCE), 'await autoApplyRelocations(')).toMatch(/toldToStop === null/);
  });

  it('and both ask the question again right before it, not only read what the pass last heard', () => {
    // Found in review (2026-09-29). The pass asks at its gates, at most once
    // every PASS_REREAD_EVERY_MS, and its last gate is before its last item:
    // a Pause pressed during the last large upload was never heard, the
    // pass's haltPause stayed empty, and the apply ran on it. So the answer
    // the apply is guarded by is the pass's, or a fresh asking when it has
    // none.
    expect(read(MANAGED)).toMatch(
      /const toldToStop =\s*result\.haltPause\?\.reason \?\? \(await whyThisDataTypeStops\(pool, tenantId, mappingId, 'file'\)\);/,
    );
    expect(read(APPLIANCE)).toMatch(
      /const toldToStop = haltPause\?\.reason \?\? \(whyItStops \? await whyItStops\('file'\) : null\);/,
    );
  });

  it('the appliance asks the migration, per data type, from the reader every gate asks', () => {
    const src = read(SELFHOST);
    const call = src.slice(src.indexOf('await runAllDomains('));
    expect(call.slice(0, call.indexOf(');'))).toMatch(/stopReasonOf\(stepFrom\(/);
  });
});

