// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LANE ONE EDITION RUNS AND THE OTHER DOES NOT
 * (workplan 0117 T1 slice 2; owner decisions D6 and D4).
 *
 * `continuous` is a mapping that keeps copying after cutover. Making it RUN
 * means widening a gate — and there are four of them, in code that cannot see
 * each other:
 *
 *   appliance, startup          which mappings get a croner job at boot
 *   appliance, per pass         the status re-read before every firing
 *   appliance, POST /run        "Sync now"
 *   managed tick                `WHERE m.status = ...`, in SQL
 *
 * Every one was `=== 'active'`, written separately. Widen three and the fourth
 * is a migration that copies on a tick and refuses the button, or copies for
 * self-host customers and stands still for managed ones — which is the edition
 * split hard rule 5 forbids, in the half where nobody is watching.
 *
 * So the gates now ask ONE predicate, `runsPasses`, and the SQL reads the same
 * two states as a parameter rather than a literal. This guard is about that
 * agreement.
 *
 * **It is the wiring half.** The half that matters more — that a lane running
 * after cutover carries no deletion detector — is behavioural and lives beside
 * the loop it is about, in
 * `packages/core/src/a-lane-that-runs-with-the-detector-present.unit.test.ts`.
 * The two are one change and neither is complete alone: a lane that runs with
 * the detector present is 0117 §3a's loop restored, and a lane that cannot run
 * is not a lane.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isAfterCutover,
  runsPasses,
  sourceAuthorityFor,
  PASS_RUNNING_STATES,
} from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Whole-line comments stripped, so a guard never matches its own explanation. */
const source = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('the lane runs, in both editions and by one authority', () => {
  it('runsPasses and isAfterCutover overlap in exactly one state', () => {
    // The cell that makes D4 necessary: a pass that runs while the source is
    // no longer the authority. If this set ever holds two, the second one needs
    // its own answer to the same question, and this test is where that is
    // noticed.
    const states = ['paused', 'active', 'cutover', 'done', 'continuous'];
    expect(states.filter((s) => runsPasses(s) && isAfterCutover(s))).toEqual(['continuous']);
    expect(states.filter((s) => runsPasses(s))).toEqual(['active', 'continuous']);
    // The value the SQL reads must be the same two, in the same order as the
    // predicate answers — one definition, two consumers.
    expect([...PASS_RUNNING_STATES]).toEqual(states.filter((s) => runsPasses(s)));
  });

  it('the phase is derived from the lifecycle, never asserted', () => {
    expect(sourceAuthorityFor('active')).toEqual({ sourceIsAuthorityOnExistence: true });
    expect(sourceAuthorityFor('paused')).toEqual({ sourceIsAuthorityOnExistence: true });
    expect(sourceAuthorityFor('cutover')).toEqual({ sourceIsAuthorityOnExistence: false });
    expect(sourceAuthorityFor('done')).toEqual({ sourceIsAuthorityOnExistence: false });
    expect(sourceAuthorityFor('continuous')).toEqual({ sourceIsAuthorityOnExistence: false });
  });

  it("the appliance's three gates all ask the same predicate", () => {
    // Startup scheduling, the re-read before every pass, and "Sync now". They
    // were three separate `=== 'active'` comparisons in code that cannot see
    // each other; a lane missing from any one of them runs on a tick and stops
    // the moment somebody presses a button, or the reverse.
    const tick = source('apps/selfhost/src/index.ts');
    const asks = [...tick.matchAll(/runsPasses\(/g)].length;
    expect(
      asks,
      'the appliance no longer asks `runsPasses` three times (startup, per-pass ' +
        're-read, and the /run route). A gate that stopped asking it is a gate ' +
        'with its own opinion about which mappings copy.',
    ).toBe(3);
    // And none of them kept a literal beside it.
    expect(
      /(currentStatus|status) [!=]== 'active'/.test(tick),
      "a literal `status === 'active'` comparison is back in the appliance",
    ).toBe(false);
  });

  it('the managed tick asks it too, through a parameter rather than a literal', () => {
    const sql = source('apps/worker/src/jobs/managed-sync-tick.ts');
    expect(
      /WHERE m\.status = ANY\(\$\d+::text\[\]\)/.test(sql),
      "the managed tick's WHERE clause is not parameterised on the running states. " +
        'A literal there is how the managed edition would keep the accident the ' +
        'appliance no longer has — the same migration copying for one edition and ' +
        'standing still for the other (hard rule 5).',
    ).toBe(true);
    expect(sql).toContain('PASS_RUNNING_STATES');
    expect(
      /WHERE m\.status = 'active'/.test(sql),
      "the literal 'active' is back in the tick's WHERE clause",
    ).toBe(false);
  });

  it('both editions read the phase off the mapping row, and neither hard-codes it', () => {
    // The one value that must never be an opinion. `true` written into a
    // production dep builder is a continuous lane with the detectors back.
    for (const file of [
      'packages/orchestration/src/build-deps-from-mapping.ts',
      'packages/orchestration/src/orchestration.ts',
    ]) {
      const src = source(file);
      expect(src, `${file} no longer derives the phase from the lifecycle`).toContain(
        'sourceAuthorityFor(',
      );
      expect(
        /sourceIsAuthorityOnExistence:\s*(true|false)/.test(src),
        `${file} hard-codes the phase instead of reading it from the mapping's status`,
      ).toBe(false);
    }
  });

  it('the refusal stops telling somebody a post-cutover mapping never syncs', () => {
    // It said: "A mapping in cutover or done no longer syncs." True until
    // 2026-09-10, and false the moment a third post-cutover state copies.
    const tick = source('apps/selfhost/src/index.ts');
    expect(
      tick,
      'the /run refusal still claims that being past cutover is what stops a ' +
        'mapping syncing. A continuous mapping is past cutover and syncs.',
    ).not.toContain('A mapping in cutover or done no longer syncs.');
  });
});
