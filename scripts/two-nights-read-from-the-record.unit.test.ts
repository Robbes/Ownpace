// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO NIGHTS READ FROM THE RECORD: the nights a release tag waits for were counted by a person reading two `gh run list` commands, and on 2026-10-06 the alpha was tagged on one green night of two (workplan 0141 T14).
 *
 * ## What happened
 *
 * 0141 T14 is the owner's rule for which commit a release may be cut from:
 * the managed gate's last two scheduled runs green, and the appliance
 * nightly's runs over the same nights green. It said of itself "No code, so
 * there is no guard". `v0.2.0-alpha.1` was tagged on `90a23e9b`, which E2E
 * (managed) #245 ran green on 2026-10-06; #238 the night before had failed,
 * so the rule read 1 of 2, and no acceptance of fewer was written anywhere.
 * The run list also hides what a person reading it would need: #255 of
 * 2026-10-15 lists as `success`, and its first attempt failed. The list shows
 * only the last attempt.
 *
 * ## The rule, as `scripts/release-nights.mjs` reads it (the owner, 2026-10-23)
 *
 * - The newest two completed SCHEDULED runs of `e2e-managed.yml` on `main`
 *   are green, on every attempt, and BOTH ran the commit C. A run still
 *   queued or running at the top is named and passed over. Dispatched runs
 *   do not count.
 * - No night is missing: the newer is at most 30 hours old, and at most 30
 *   hours lie between the two. GitHub starts these schedules hours late and
 *   sometimes drops one; a dropped night is not a green one.
 * - The appliance nightly (`e2e.yml`, two schedules a night): the newest four
 *   completed scheduled runs created after C reached `main` and before the
 *   newer counted managed run, after the managed run before the two counted
 *   ones, each on C and green on every attempt. A failed scheduled appliance
 *   run on C after them resets the count too.
 * - The commit Release picks, when it is given none, is the one the newer
 *   counted night ran, and only when the whole rule holds for it.
 *
 * ## What this test holds
 *
 * The rule against real runs, recorded from the API through the fields
 * `scripts/release-github.mjs` keeps (`scripts/fixtures/release/`): today's
 * record refuses, `a6be6129`'s nights of 2026-09-30 and 10-01 pass, #255's
 * failed first attempt refuses, and each of the ways a count goes wrong
 * refuses with a sentence that names it. And the fixtures themselves: none
 * holds a commit message, an account, a runner's name or an `@`, because this
 * repository is public and the API's run objects carry all four.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countNights, pickCommit, NIGHTS, MAX_GAP_HOURS, COUNTED } from './release-nights.mjs';
import type { Run } from './release-nights.mjs';
import { NEVER_RECORDED, RUN_FIELDS } from './release-github.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'scripts', 'fixtures', 'release');
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;

const MANAGED = fixture<{ workflow_runs: Run[] }>('e2e-managed-scheduled-runs.json').workflow_runs;
const APPLIANCE = fixture<{ workflow_runs: Run[] }>('e2e-scheduled-runs.json').workflow_runs;
const ATTEMPTS = fixture<Record<string, Run[]>>('e2e-managed-attempts.json');

const A6 = 'a6be61291abbc00ce4eec66d3dee96a4bb388940';
const A6_MERGED = '2026-09-29T11:37:57Z';
const B21 = 'b21a973538c0cf3865e201ef218b6947e9d32890';
const B21_MERGED = '2026-10-14T05:29:11Z';
const N91 = '91b49de91f1ce654b103a5a1b5485aba8926b349';
const N91_MERGED = '2026-10-21T22:08:47Z';

const byNumber = (runs: Run[], n: number) => {
  const run = runs.find((r) => r.run_number === n);
  if (!run) throw new Error(`no run #${n} in the fixture`);
  return run;
};
const without = (runs: Run[], ...numbers: number[]) => runs.filter((r) => !numbers.includes(r.run_number));
const replaced = (runs: Run[], n: number, change: Partial<Run>) =>
  runs.map((r) => (r.run_number === n ? { ...r, ...change } : r));
const sentences = (lines: Array<{ kind: string; check: string; sentence: string }>, kind = 'refuse') =>
  lines.filter((l) => l.kind === kind).map((l) => l.sentence);

const a6 = (over: Partial<Parameters<typeof countNights>[0]> = {}) =>
  countNights({
    managedRuns: MANAGED,
    applianceRuns: APPLIANCE,
    attempts: ATTEMPTS,
    commit: A6,
    mergedAt: A6_MERGED,
    now: '2026-10-01T12:00:00Z',
    ...over,
  });

describe('the rule is the owner’s, written as constants', () => {
  it('counts two nights of the managed gate and the appliance nightly, and gives a night 30 hours', () => {
    expect(NIGHTS).toBe(2);
    expect(MAX_GAP_HOURS).toBe(30);
    expect(COUNTED.managed.workflow).toBe('e2e-managed.yml');
    expect(COUNTED.appliance.workflow).toBe('e2e.yml');
  });
});

describe('the record of 2026-10-22 (the day this was written)', () => {
  it('refuses: the two newest managed nights ran two different commits', () => {
    const v = countNights({
      managedRuns: MANAGED,
      applianceRuns: APPLIANCE,
      attempts: ATTEMPTS,
      commit: N91,
      mergedAt: N91_MERGED,
      now: '2026-10-23T00:00:00Z',
    });
    expect(v.verdict).toBe('refuse');
    const said = sentences(v.lines).join('\n');
    expect(said).toMatch(/#262 ran 29693244c8df/);
    // Under 0141 T14's older reading only the newer night had to run C, and
    // #265 did. The rule now asks both, so the commit the newer one ran is
    // offered as the pick and then refused.
    expect(pickCommit(MANAGED, '2026-10-23T00:00:00Z')).toBe(N91);
  });
});

describe('a commit the rule accepts, from the record', () => {
  it('passes a6be6129 on #226 and #227, with the four appliance runs #242 to #245', () => {
    const v = a6();
    expect(sentences(v.lines)).toEqual([]);
    expect(v.verdict).toBe('pass');
    expect(v.managed.map((r) => r.run_number)).toEqual([227, 226]);
    expect(v.appliance.map((r) => r.run_number)).toEqual([245, 244, 243, 242]);
    expect(v.proof).toBe('E2E (managed) #226 #227; E2E (self-hosted) #242 #243 #244 #245');
    expect(pickCommit(MANAGED, '2026-10-01T12:00:00Z')).toBe(A6);
  });
});

describe('every way the count goes wrong refuses, and says which', () => {
  it('a scheduled run whose first attempt failed does not count, though the list says success (#255)', () => {
    const v = countNights({
      managedRuns: MANAGED,
      applianceRuns: APPLIANCE,
      attempts: ATTEMPTS,
      commit: B21,
      mergedAt: B21_MERGED,
      now: '2026-10-16T12:00:00Z',
    });
    expect(byNumber(MANAGED, 255).conclusion).toBe('success');
    expect(byNumber(MANAGED, 255).run_attempt).toBe(2);
    expect(v.verdict).toBe('refuse');
    expect(sentences(v.lines).join('\n')).toMatch(/#255's attempt 1 ended failure/);
  });

  it('an attempt it could not read is a refusal, not a pass', () => {
    const v = countNights({
      managedRuns: MANAGED,
      applianceRuns: APPLIANCE,
      attempts: {},
      commit: B21,
      mergedAt: B21_MERGED,
      now: '2026-10-16T12:00:00Z',
    });
    expect(v.verdict).toBe('refuse');
    expect(sentences(v.lines).join('\n')).toMatch(/#255's attempt 1 was not read/);
  });

  it('a failed or cancelled scheduled night is a reset', () => {
    for (const conclusion of ['failure', 'cancelled']) {
      const v = a6({ managedRuns: replaced(MANAGED, 227, { conclusion }) });
      expect(v.verdict).toBe('refuse');
      expect(sentences(v.lines).join('\n')).toMatch(new RegExp(`#227 ended ${conclusion}`));
    }
  });

  it('a dispatched run is not a night, green or red', () => {
    const dispatched = (conclusion: string): Run => ({
      ...byNumber(MANAGED, 227),
      id: 1,
      run_number: 9999,
      event: 'workflow_dispatch',
      conclusion,
      created_at: '2026-10-01T11:00:00Z',
    });
    for (const conclusion of ['success', 'failure']) {
      const v = a6({ managedRuns: [dispatched(conclusion), ...MANAGED] });
      expect(v.verdict).toBe('pass');
      expect(v.managed.map((r) => r.run_number)).toEqual([227, 226]);
    }
  });

  it('a night GitHub dropped is missing, not green', () => {
    // Without #227, at noon on 10-02 the two newest are #228 and #226: two
    // days apart.
    const v = a6({ managedRuns: without(MANAGED, 227), now: '2026-10-02T12:00:00Z' });
    expect(v.verdict).toBe('refuse');
    expect(sentences(v.lines).join('\n')).toMatch(/a night is missing between #226 and #228/);
  });

  it('a newest night older than a day and a bit is a night missing since', () => {
    const v = a6({ now: '2026-10-02T18:00:00Z', managedRuns: without(MANAGED, 228, 229) });
    expect(v.verdict).toBe('refuse');
    expect(sentences(v.lines).join('\n')).toMatch(/#227 is 31 hours old/);
  });

  it('a night with one appliance run instead of two is short', () => {
    const v = a6({ applianceRuns: without(APPLIANCE, 244) });
    expect(v.verdict).toBe('refuse');
    expect(sentences(v.lines).join('\n')).toMatch(/3 scheduled E2E \(self-hosted\) runs/);
  });

  it('an appliance run on another commit, or red, inside the two nights refuses', () => {
    const other = a6({ applianceRuns: replaced(APPLIANCE, 243, { head_sha: N91 }) });
    expect(other.verdict).toBe('refuse');
    expect(sentences(other.lines).join('\n')).toMatch(/#243 ran 91b49de91f1c/);
    const red = a6({ applianceRuns: replaced(APPLIANCE, 243, { conclusion: 'failure' }) });
    expect(red.verdict).toBe('refuse');
  });

  it('a red appliance run on C after the counted nights resets the count', () => {
    const later: Run = {
      ...byNumber(APPLIANCE, 245),
      id: 2,
      run_number: 9998,
      conclusion: 'failure',
      created_at: '2026-10-01T11:30:00Z',
    };
    const v = a6({ applianceRuns: [later, ...APPLIANCE] });
    expect(v.verdict).toBe('refuse');
    expect(sentences(v.lines).join('\n')).toMatch(/#9998 ended failure/);
  });

  it('a run still going at the top is named and passed over', () => {
    const running: Run = {
      ...byNumber(MANAGED, 227),
      id: 3,
      run_number: 9997,
      status: 'in_progress',
      conclusion: null,
      created_at: '2026-10-01T11:50:00Z',
    };
    const v = a6({ managedRuns: [running, ...MANAGED] });
    expect(v.verdict).toBe('pass');
    expect(sentences(v.lines, 'note').join('\n')).toMatch(/#9997 is in_progress/);
  });

  it('the pick names a commit only where two completed scheduled nights exist', () => {
    expect(pickCommit(MANAGED, '2026-09-13T12:00:00Z')).toBeNull();
  });
});

describe('the fixtures carry nothing private (this repository is public)', () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));

  it('there are fixtures to read', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files)('%s holds no commit message, account, runner name or address', (file) => {
    const text = readFileSync(join(FIXTURES, file), 'utf8');
    for (const key of NEVER_RECORDED) expect(text, `${file} holds "${key}"`).not.toContain(`"${key}"`);
    expect(text, `${file} holds an "@"`).not.toContain('@');
  });

  it('a recorded run keeps only the fields the rule reads', () => {
    for (const run of [...MANAGED, ...APPLIANCE]) {
      for (const key of Object.keys(run)) expect(RUN_FIELDS).toContain(key);
    }
  });
});
