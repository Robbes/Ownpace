// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The aggregate CI check actually aggregates.
 *
 * `ci-complete` exists so branch protection has ONE required status check
 * whose name does not change when a job gains, loses or renames a matrix leg.
 * That indirection buys stability and costs a new way to be silently wrong:
 * **the aggregator cannot notice a gate it was never told about.** Add a job
 * to ci.yml, forget to add it to `ci-complete.needs`, and the required check
 * goes on reporting green while covering less than it did yesterday. Nothing
 * fails, nothing warns, and the gap is invisible in the pull request UI —
 * which is the same shape as the uncollected test file, the vacuous backup
 * drill and the upgrade gate that skipped silently green.
 *
 * So the coverage is asserted here rather than remembered.
 *
 * Parses the workflow with a real YAML parser for the same reason
 * `openapi-spec.unit.test.ts` does: a regex over `needs:` would pass on a file
 * GitHub cannot run, and "the CI config is valid YAML" is worth knowing on its
 * own.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const CI_PATH = fileURLToPath(new URL('./.github/workflows/ci.yml', import.meta.url));
const AGGREGATOR = 'ci-complete';

interface Job {
  readonly needs?: string | string[];
  readonly if?: unknown;
  readonly steps?: ReadonlyArray<{ if?: unknown; name?: string }>;
}

const workflow = parse(readFileSync(CI_PATH, 'utf8')) as { jobs: Record<string, Job> };
const jobs = workflow.jobs ?? {};
const jobNames = Object.keys(jobs);
const gated = jobNames.filter((n) => n !== AGGREGATOR);

/**
 * The aggregator job itself.
 *
 * A module-level throw rather than `jobs[AGGREGATOR]!` at five call sites:
 * `noUncheckedIndexedAccess` is right that a lookup can miss, and the honest
 * answer is that this whole file is meaningless if it does. The vacuity guard
 * below asserts the same thing as a test, so a rename of the job fails with a
 * sentence rather than with `Cannot read properties of undefined`.
 */
const aggregator = jobs[AGGREGATOR];
if (!aggregator) {
  throw new Error(`ci.yml has no \`${AGGREGATOR}\` job — this file's entire premise is gone`);
}

describe('ci-complete is a truthful aggregate of every CI gate', () => {
  it('has gates to aggregate at all', () => {
    // The vacuity guard. Every assertion below passes trivially against an
    // empty or unparsed jobs map — a wrong path here would report perfect
    // coverage of nothing, which is precisely the failure this file exists to
    // prevent one level up.
    expect(jobNames, `no jobs parsed out of ${CI_PATH}`).toContain(AGGREGATOR);
    expect(gated.length, 'ci.yml parsed with almost no jobs — check the path').toBeGreaterThan(5);
  });

  it('waits for EVERY other job in the workflow', () => {
    const needs = new Set(
      Array.isArray(aggregator.needs)
        ? (aggregator.needs as string[])
        : [aggregator.needs as string],
    );
    const uncovered = gated.filter((j) => !needs.has(j));

    expect(
      uncovered,
      `these ci.yml jobs are NOT in ci-complete's \`needs\`, so the one check ` +
        `branch protection requires would pass without them:\n` +
        uncovered.map((j) => `  - ${j}`).join('\n') +
        `\nAdd them to the \`needs\` list in .github/workflows/ci.yml.`,
    ).toEqual([]);
  });

  it('runs even when an upstream gate fails', () => {
    // Without `if: always()` a failure upstream SKIPS this job. A skipped
    // required check reports no failure, so the gate would stop gating at
    // exactly the moment something broke — green by absence.
    expect(
      String(aggregator.if ?? ''),
      'ci-complete needs `if: always()` or it is skipped by an upstream failure',
    ).toContain('always()');
  });

  it('has no step its own `if:` can skip', () => {
    // `if: always()` alone would make this job green no matter what happened,
    // so a step in it inspects the results and exits non-zero.
    //
    // This test used to assert the opposite of what it asserts now: that some
    // step's `if:` named `needs.*.result` and `failure`. On 2026-10-05 that
    // step — `if: contains(needs.*.result, 'failure') || contains(needs.*.result,
    // 'cancelled')` — was SKIPPED over four runs whose gates never got a
    // runner, because GitHub reported those as `abandoned`, and the job went
    // green. A step that decides must not be one GitHub can skip; it runs
    // every time and decides inside. Whether it decides RIGHTLY is held by
    // scripts/a-run-that-was-cancelled-and-called-green.unit.test.ts, which
    // runs this job's steps against the recorded runs.
    const conditional = (aggregator.steps ?? [])
      .filter((s) => s.if !== undefined && !/^\s*(\$\{\{\s*)?always\(\)(\s*\}\})?\s*$/.test(String(s.if)))
      .map((s) => `${s.name ?? '(unnamed step)'}: if: ${String(s.if)}`);
    expect(
      conditional,
      'these ci-complete steps run only when their `if:` holds, so a result their `if:` did ' +
        'not foresee skips them and the job reports green. Drop the `if:` and decide inside ' +
        'the step.',
    ).toEqual([]);
  });
});
