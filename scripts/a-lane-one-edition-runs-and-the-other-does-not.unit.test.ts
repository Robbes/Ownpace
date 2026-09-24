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
    //
    // Since 0128 T2 the predicate is `runsPassesNow`, because a cutover copies
    // until its grace period ends and the status alone cannot say when that
    // is. The appliance asks it through ONE wrapper, `passesRunNow`, which
    // reads the cutover's window by the SQL the managed tick schedules by.
    const tick = source('apps/selfhost/src/index.ts');
    const asks = [...tick.matchAll(/passesRunNow\(m, /g)].length;
    expect(
      asks,
      'the appliance no longer asks `passesRunNow` three times (startup, per-pass ' +
        're-read, and the /run route). A gate that stopped asking it is a gate ' +
        'with its own opinion about which mappings copy.',
    ).toBe(3);
    // No gate reads the status alone: that is a cutover that never copies
    // through its grace period on one gate and does on another.
    expect(tick, 'a gate reads `runsPasses` again, without the cutover window').not.toMatch(/\brunsPasses\(/);
    const wrapper = tick.slice(tick.indexOf('const passesRunNow = '));
    const body = wrapper.slice(0, wrapper.indexOf('\n\n'));
    expect(body).toContain('runsPassesNow(');
    expect(body, 'the wrapper no longer asks the one SQL rule the tick asks').toContain('CUTOVER_STILL_COPIES_WHERE');
    // And none of them kept a literal beside it.
    expect(
      /(currentStatus|status) [!=]== 'active'/.test(tick),
      "a literal `status === 'active'` comparison is back in the appliance",
    ).toBe(false);
  });

  it('the managed tick asks it too, through a parameter rather than a literal', () => {
    const sql = source('apps/worker/src/jobs/managed-sync-tick.ts');
    expect(
      /WHERE \(m\.status = ANY\(\$\d+::text\[\]\)/.test(sql),
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
    // The one state named in it runs for a while (0128 T2), and only by the
    // rule the appliance's gates ask too.
    expect(sql).toMatch(/OR \(m\.status = 'cutover'\s+AND EXISTS \(SELECT 1 FROM cutover_state c[\s\S]*?\$\{CUTOVER_STILL_COPIES_WHERE\}/);
  });

  it("both editions read each data type's own phase, and neither hard-codes it", () => {
    // The one value that must never be an opinion. `true` written into a
    // production dep builder is a continuous lane with the detectors back.
    //
    // And since 0128 T5 (the owner's D8: the cutover is per data type), the
    // opinion must be the DATA TYPE's: a phase read through `readPathPhases`
    // and handed over as a `PathPhase`, never the migration's own status.
    // Today the two are the same answer; the day mail can be cut over on its
    // own, a builder still asking the migration would give mail's pass the
    // detectors back while the migration reads `active` for its files.
    for (const file of [
      'packages/orchestration/src/build-deps-from-mapping.ts',
      'packages/orchestration/src/orchestration.ts',
    ]) {
      const src = source(file);
      const calls = src
        .split('\n')
        .filter((line) => line.includes('sourceAuthorityFor(') && !line.trimStart().startsWith('*') && !line.includes('import'));
      expect(calls.length, `${file} no longer derives the phase from the lifecycle`).toBeGreaterThan(0);
      for (const line of calls) {
        expect(line, `${file} asks the migration's status, not a data type's phase`).toMatch(
          /sourceAuthorityFor\([^)]*(\([^)]*\))?\.phase\)/,
        );
      }
      expect(
        /sourceIsAuthorityOnExistence:\s*(true|false)/.test(src),
        `${file} hard-codes the phase instead of reading it from the database`,
      ).toBe(false);
    }
  });

  it('each asks the one reader, for the data type it is building', () => {
    // Managed: mail asks for mail's phase, and the other four for their own,
    // through `readPathPhases`, the reader the pass's stop check asks too.
    const managed = source('packages/orchestration/src/build-deps-from-mapping.ts');
    expect(managed.match(/readPathPhases\(txDb, tenantId, mappingId\)/g)?.length).toBe(2);
    expect(managed).toContain(".phaseOf('email')");
    expect(managed).toContain('sourceAuthorityFor(phaseOf(domain).phase)');
    // The appliance: the pass is handed the reader's phases, read just before
    // it, and asks that one reading both questions — whether each data type
    // still runs, and whether its source still decides what exists.
    const appliance = source('apps/selfhost/src/index.ts');
    const pass = appliance.slice(appliance.indexOf('const results = await runAllDomains('));
    expect(appliance).toContain('readPathPhases(tdb, tenantId, mappingId)');
    expect(appliance).toContain('const phaseOf = phases?.phaseOf ?? phasesOfTheMigration(currentStatus);');
    expect(pass.slice(0, pass.indexOf(');'))).toMatch(
      /statusStore,\s*phaseOf,\s*ledgerOptions,\s*\(domain\) => pathRunsNow\(phaseOf\(domain\)\),/,
    );
    expect(source('packages/orchestration/src/orchestration.ts')).toContain(
      'const authority = (domain: DiscoveryDomain) => sourceAuthorityFor(phaseOf(domain).phase);',
    );
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
