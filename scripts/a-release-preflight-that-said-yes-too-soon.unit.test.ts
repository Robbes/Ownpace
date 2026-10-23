// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RELEASE PREFLIGHT THAT SAID YES TOO SOON: on 2026-10-22 the names check passed `v0.2.0-alpha.2` while `CHANGELOG.md`'s `[Unreleased]` still held about 170 lines above a section dated 2026-10-11 (workplan 0146 T2, the fold not done).
 *
 * ## What it is
 *
 * `scripts/release-preflight.mjs` is the first job of the Release workflow.
 * It reads, writes nothing, and prints one line per check, `pass` or
 * `refuse`, so the owner sees every reason at once instead of the first. In
 * release mode one refusal stops the run before anything is written; in
 * preflight mode the run is red with the list; in rehearse mode the list is
 * carried to the end of the run, which then says the real run would have
 * stopped there.
 *
 * ## The order, and why (the critique of 2026-10-22)
 *
 * 1. `resolve`: the inputs; dispatched from `main`; the commit (given, or the
 *    one the nights pick, or the existing tag's in verify mode); the release
 *    before it; and whether the commit is on `main`'s first-parent line, by
 *    `git merge-base` BEFORE a worktree is made, so a commit that is not on
 *    `main` is a refusal and not a git error.
 * 2. `names`, a step of its own with no token in it: the candidate's own
 *    `release-names-agree.mjs`. A process can read its parent's environment,
 *    so the token is kept out of the step, not only out of the spawn (the
 *    review of 2026-10-23).
 * 3. `check`, with the candidate checked out beside `main`: the tag is free
 *    (or Release's own, at the commit), no branch is named like it, the API
 *    contract's version, the changelog folded, CI's push run on the commit
 *    with lint, unit, UI and integration actually run, Security Scan's push
 *    run on it, and the nights.
 * 4. The install, with no token in the step.
 * 5. `callees`: the workflows Release will dispatch, read from the
 *    candidate with the candidate's own YAML parser (`createRequire`), offer
 *    the inputs Release passes.
 * 6. The upgrade gates (`release-upgrade-gates.mjs`).
 * 7. `verdict`: counts, and refuses any check that should have run and did
 *    not, and any step that ended in an error rather than a line.
 *
 * ## What this test holds
 *
 * Each check refuses the shape that would have let a bad tag through, on
 * real inputs where there are any: `main`'s `CHANGELOG.md` as it stood on
 * 2026-10-23, frozen (entries under `[Unreleased]`, a section twelve days
 * old), `main`'s `openapi.yaml`, CI's jobs of run 39866562875, the workflows
 * as they are. And in rehearse mode it carries the record's refusals to the
 * end of the run, but never one that says which commit this is: a commit
 * that is not on `main` never reaches the gate scan.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  MODES,
  REQUIRED_CI_JOBS,
  validateInputs,
  dispatchedFromMain,
  previousTag,
  candidateOnMain,
  changelogFolded,
  openapiAgrees,
  ciGreen,
  scanGreenOnMain,
  tagFree,
  refUnambiguous,
  calleesDispatchable,
  approvalNote,
  alertsNote,
  candidateEnv,
  verdict,
} from './release-preflight.mjs';
import type { Line } from './release-preflight.mjs';
import { tagDecision } from './release-cut-tag.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const fixture = <T>(name: string): T => JSON.parse(read(`scripts/fixtures/release/${name}`)) as T;

const C = '721c6ea82bf0214e2d132c37e84d8da2d43247bc';
const OTHER = '91b49de91f1ce654b103a5a1b5485aba8926b349';
const V = 'v0.2.0-alpha.2';
const kinds = (lines: Line[]) => lines.map((l) => l.kind);
const refused = (lines: Line[]) => lines.filter((l) => l.kind === 'refuse');

describe('the inputs', () => {
  it('knows the five modes', () => {
    expect(MODES).toEqual(['preflight', 'rehearse', 'rehearse-tag', 'release', 'verify']);
  });

  it('takes a v and a SemVer version, a full commit or none, and a known mode', () => {
    expect(refused(validateInputs({ version: V, commit: '', mode: 'release' }))).toEqual([]);
    expect(refused(validateInputs({ version: V, commit: C, mode: 'rehearse' }))).toEqual([]);
    expect(refused(validateInputs({ version: '0.2.0-alpha.2', commit: '', mode: 'release' }))).toHaveLength(1);
    expect(refused(validateInputs({ version: 'v0.2', commit: '', mode: 'release' }))).toHaveLength(1);
    expect(refused(validateInputs({ version: V, commit: '721c6ea8', mode: 'release' }))).toHaveLength(1);
    expect(refused(validateInputs({ version: V, commit: '', mode: 'ship' }))).toHaveLength(1);
  });

  it('runs from main, as main has it', () => {
    const repository = 'Robbes/Ownpace';
    const at = (ref: string) => `${repository}/.github/workflows/release.yml@${ref}`;
    expect(dispatchedFromMain({ ref: 'refs/heads/main', workflowRef: at('refs/heads/main'), repository }).kind).toBe('pass');
    expect(dispatchedFromMain({ ref: 'refs/heads/edited', workflowRef: at('refs/heads/edited'), repository }).kind).toBe('refuse');
  });

  it('finds the release before this one, by SemVer, among the release tags only', () => {
    const tags = ['v0.1.0-rc.1', 'v0.2.0-alpha.1', 'v0.2.0-alpha.2', 'rehearsal-3', 'vnext'];
    expect(previousTag(tags, V)).toBe('v0.2.0-alpha.1');
    expect(previousTag(tags, 'v0.2.0-alpha.1')).toBe('v0.1.0-rc.1');
    expect(previousTag(['v0.2.0-alpha.2'], V)).toBeNull();
  });
});

describe('the commit', () => {
  it('is on main’s own line: an ancestor of main, and on its first-parent history', () => {
    expect(candidateOnMain({ commit: C, isAncestor: true, firstParent: true }).kind).toBe('pass');
    expect(candidateOnMain({ commit: C, isAncestor: false, firstParent: false }).kind).toBe('refuse');
    // A commit from a merged branch is an ancestor and never was main.
    expect(candidateOnMain({ commit: C, isAncestor: true, firstParent: false }).kind).toBe('refuse');
  });

  it('a tag already at another commit, or a lightweight one, refuses; a free name passes', () => {
    expect(tagFree(tagDecision({ ref: null, tagObject: null, commit: C, releaseRun: null, version: V })).kind).toBe('pass');
    const lightweight = { ref: `refs/tags/${V}`, object: { type: 'commit', sha: C } };
    expect(tagFree(tagDecision({ ref: lightweight, tagObject: null, commit: C, releaseRun: null, version: V })).kind).toBe('refuse');
    const annotated = { ref: `refs/tags/${V}`, object: { type: 'tag', sha: 'f'.repeat(40) } };
    const elsewhere = { sha: 'f'.repeat(40), message: 'Ownpace', object: { type: 'commit', sha: OTHER } };
    expect(tagFree(tagDecision({ ref: annotated, tagObject: elsewhere, commit: C, releaseRun: null, version: V })).kind).toBe('refuse');
  });

  it('a branch named like the tag makes the dispatch ref ambiguous, and a gate branch elsewhere is not ours', () => {
    expect(kinds(refUnambiguous({ version: V, commit: C, branch: null, gate: null }))).toEqual(['pass']);
    expect(refused(refUnambiguous({ version: V, commit: C, branch: { object: { sha: C } }, gate: null }))).toHaveLength(1);
    expect(refused(refUnambiguous({ version: V, commit: C, branch: null, gate: { object: { sha: OTHER } } }))).toHaveLength(1);
    expect(refused(refUnambiguous({ version: V, commit: C, branch: null, gate: { object: { sha: C } } }))).toEqual([]);
  });
});

describe('the changelog is folded (the owner’s rule: [Unreleased] empty, the section dated the day of the fold)', () => {
  // main's CHANGELOG.md as it stood on 2026-10-23 (`a5ae29d1`), through the
  // alpha.2 heading, frozen: the fold this file asks for changes the live
  // one, and a guard that read it would go red on the fold's own pull request.
  it('refuses main’s CHANGELOG.md as it stood on 2026-10-23: entries under [Unreleased], and a section twelve days old', () => {
    const lines = changelogFolded(read('scripts/fixtures/release/changelog-2026-10-23.md'), V, '2026-10-23');
    const said = refused(lines).map((l) => l.sentence).join('\n');
    expect(said).toMatch(/\[Unreleased\] still holds \d+ lines/);
    expect(said).toMatch(/dated 2026-10-11, 12 days before/);
  });

  it('answers for the live CHANGELOG.md at every stage, before the fold and after it', () => {
    const root = (JSON.parse(read('package.json')) as { version: string }).version;
    const lines = changelogFolded(read('CHANGELOG.md'), `v${root}`, new Date());
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.check === 'changelog-folded')).toBe(true);
  });

  const folded = (date: string, unreleased = '') =>
    `# Changelog\n\n## [Unreleased]\n${unreleased}\n## [0.2.0-alpha.2] - ${date}\n\n### Added\n\n- something\n\n## [0.2.0-alpha.1] - 2026-10-07\n`;

  it('passes a fold dated within the week before the run, or the day after (the owner’s own time zone)', () => {
    expect(refused(changelogFolded(folded('2026-10-24'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-19'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-27'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-18'), V, '2026-10-26'))).toHaveLength(1);
    expect(refused(changelogFolded(folded('2026-10-28'), V, '2026-10-26'))).toHaveLength(1);
  });

  it('a heading with nothing under it is not an entry; a line is', () => {
    expect(refused(changelogFolded(folded('2026-10-24', '\n### Added\n\n'), V, '2026-10-26'))).toEqual([]);
    expect(refused(changelogFolded(folded('2026-10-24', '\n- a late fix\n'), V, '2026-10-26'))).toHaveLength(1);
  });

  it('a version with no section refuses', () => {
    expect(refused(changelogFolded(folded('2026-10-24'), 'v0.2.0-alpha.3', '2026-10-26')).length).toBeGreaterThan(0);
  });
});

describe('the API contract names the version', () => {
  it('passes main’s openapi.yaml for the root version, and refuses the version after it', () => {
    const openapi = read('apps/api/docs/openapi.yaml');
    const root = (JSON.parse(read('package.json')) as { version: string }).version;
    // The next one, derived, so the bump to it does not turn this red.
    const next = root.replace(/(\d+)$/, (n) => String(Number(n) + 1));
    expect(next).not.toBe(root);
    expect(openapiAgrees(openapi, `v${root}`).kind).toBe('pass');
    expect(openapiAgrees(openapi, `v${next}`).kind).toBe('refuse');
  });
});

describe('CI and the scan on main ran the commit, and ran the suite', () => {
  const jobs = fixture<{ jobs: Array<{ name: string; status: string; conclusion: string | null }> }>('ci-jobs-39866562875.json').jobs;
  const run = { id: 39866562875, run_number: 4694, event: 'push', status: 'completed', conclusion: 'success', head_sha: C, head_branch: 'main' };

  it('names the jobs it requires', () => {
    expect(REQUIRED_CI_JOBS).toEqual(['lint', 'unit-tests (all)', 'ui-tests', 'integration-tests (self-hosted)', 'ci-complete']);
  });

  it('passes run 4694 on 721c6ea8, where every one of them ran', () => {
    expect(ciGreen(run, jobs, C).kind).toBe('pass');
  });

  it('refuses a green run that skipped the unit tests: a docs-only merge reports success over a tree nothing tested', () => {
    const skipped = jobs.map((j) => (j.name === 'unit-tests (all)' ? { ...j, conclusion: 'skipped' } : j));
    expect(ciGreen(run, skipped, C).sentence).toMatch(/unit-tests \(all\) was skipped/);
  });

  it('refuses a cancelled run, a running one, none, and one on another commit', () => {
    expect(ciGreen({ ...run, conclusion: 'cancelled' }, jobs, C).kind).toBe('refuse');
    expect(ciGreen({ ...run, status: 'in_progress', conclusion: null }, jobs, C).kind).toBe('refuse');
    expect(ciGreen(null, null, C).kind).toBe('refuse');
    expect(ciGreen({ ...run, head_sha: OTHER }, jobs, C).kind).toBe('refuse');
  });

  it('refuses a red Security Scan push run, and the absence of one', () => {
    const scan = { ...run, id: 39866564070, run_number: 4710 };
    expect(scanGreenOnMain(scan, C).kind).toBe('pass');
    expect(scanGreenOnMain({ ...scan, conclusion: 'failure' }, C).kind).toBe('refuse');
    expect(scanGreenOnMain(null, C).kind).toBe('refuse');
  });
});

describe('the workflows Release dispatches can be dispatched as it will', () => {
  const workflow = (file: string) => parse(read(`.github/workflows/${file}`)) as Record<string, unknown>;
  const now = () => ({
    'security-scan.yml': workflow('security-scan.yml'),
    'images.yml': workflow('images.yml'),
    'windows-payload.yml': workflow('windows-payload.yml'),
  });

  it('passes the workflows as they are', () => {
    expect(refused(calleesDispatchable(now()))).toEqual([]);
  });

  it('refuses a candidate whose security-scan.yml has no image_scans input: the dispatch would answer 422', () => {
    const callees = now();
    const scan = structuredClone(callees['security-scan.yml']) as { on: Record<string, unknown> };
    scan.on.workflow_dispatch = null;
    expect(refused(calleesDispatchable({ ...callees, 'security-scan.yml': scan }))).toHaveLength(1);
  });

  it('refuses a publisher with no dispatch trigger, and a payload without win-x64', () => {
    const callees = now();
    const images = structuredClone(callees['images.yml']) as { on: Record<string, unknown> };
    delete images.on.workflow_dispatch;
    expect(refused(calleesDispatchable({ ...callees, 'images.yml': images }))).toHaveLength(1);
    const payload = structuredClone(callees['windows-payload.yml']) as {
      on: { workflow_dispatch: { inputs: { platform: { options: string[] } } } };
    };
    payload.on.workflow_dispatch.inputs.platform.options = ['win-arm64'];
    expect(refused(calleesDispatchable({ ...callees, 'windows-payload.yml': payload }))).toHaveLength(1);
  });
});

describe('the approval and the token', () => {
  it('says whether the release environment asks for a reviewer, and never refuses on it', () => {
    const reviewed = { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] };
    expect(approvalNote(reviewed)).toMatchObject({ kind: 'note' });
    expect(approvalNote(reviewed).sentence).toMatch(/asks a reviewer/);
    expect(approvalNote({ protection_rules: [] }).sentence).toMatch(/passes without a click/);
    expect(approvalNote(null).sentence).toMatch(/does not exist yet/);
  });

  it('reports open code-scanning alerts and never refuses on them (the owner’s decision 11)', () => {
    expect(alertsNote({ critical: 1, high: 2 })).toMatchObject({ kind: 'note' });
    expect(alertsNote({ critical: 1, high: 2 }).sentence).toMatch(/1 critical and 2 high .*reported, not refused/);
    expect(alertsNote({ critical: 0, high: 0 }).kind).toBe('note');
    expect(alertsNote(null).kind).toBe('note');
  });

  it('spawns the candidate’s own scripts with no token in their environment', () => {
    const env = candidateEnv({ PATH: '/usr/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'y', ACTIONS_RUNTIME_TOKEN: 'z', HOME: '/h' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/h' });
  });
});

describe('the verdict', () => {
  const all = (mode: string): Line[] =>
    [
      'inputs',
      'dispatched-from-main',
      'candidate-on-main',
      'tag-free',
      'ref-unambiguous',
      'names-agree',
      'openapi-agrees',
      'changelog-folded',
      'ci-green',
      'scan-green-on-main',
      'nights',
      'callees-dispatchable',
      'upgrade-ledger',
      'upgrade-managed',
    ].map((check) => ({ kind: 'pass', check, sentence: `${mode} ok` }));
  const outcomes = { resolve: 'success', check: 'success', install: 'success', callees: 'success', gates: 'success' };

  it('lets a release through only when every check ran and passed', () => {
    expect(verdict({ lines: all('release'), mode: 'release', outcomes }).exitCode).toBe(0);
  });

  it('stops a release on one refusal, and on a check that never ran', () => {
    const one = [...all('release'), { kind: 'refuse', check: 'nights', sentence: 'no' }];
    expect(verdict({ lines: one, mode: 'release', outcomes })).toMatchObject({ exitCode: 1, refused: 1 });
    const missing = all('release').filter((l) => l.check !== 'upgrade-managed');
    const v = verdict({ lines: missing, mode: 'release', outcomes });
    expect(v.exitCode).toBe(1);
    expect(v.summary).toMatch(/upgrade-managed: this check did not run/);
  });

  it('refuses a step that ended in an error instead of a line', () => {
    expect(verdict({ lines: all('release'), mode: 'release', outcomes: { ...outcomes, gates: 'failure' } }).exitCode).toBe(1);
  });

  it('carries refusals through a rehearsal, and is red in preflight mode', () => {
    const one = [...all('rehearse'), { kind: 'refuse', check: 'nights', sentence: 'no' }];
    expect(verdict({ lines: one, mode: 'rehearse', outcomes, commit: C })).toMatchObject({ exitCode: 0, refused: 1 });
    expect(verdict({ lines: one, mode: 'preflight', outcomes, commit: C })).toMatchObject({ exitCode: 1, refused: 1 });
  });

  // The review of 2026-10-23: rehearse carried every refusal, so a commit that
  // is not on main still reached the gate scan, which makes a branch at it and
  // runs ITS security-scan.yml with a write token. What the rehearsal carries
  // is the record's refusals, never the ones that say which commit it is.
  it('stops a rehearsal on a commit that is not on main’s first-parent line, or on none', () => {
    const offMain = all('rehearse').map((l) => (l.check === 'candidate-on-main' ? { ...l, kind: 'refuse' } : l));
    expect(verdict({ lines: offMain, mode: 'rehearse', outcomes, commit: C })).toMatchObject({ exitCode: 1, refused: 1 });
    for (const check of ['inputs', 'dispatched-from-main', 'commit', 'previous-release']) {
      const lines = [...all('rehearse'), { kind: 'refuse', check, sentence: 'no' }];
      expect(verdict({ lines, mode: 'rehearse', outcomes, commit: C }).exitCode, check).toBe(1);
    }
    // The resolve step stopped before candidate-on-main: it "did not run".
    const stopped = [
      { kind: 'pass', check: 'inputs', sentence: 'ok' },
      { kind: 'pass', check: 'dispatched-from-main', sentence: 'ok' },
      { kind: 'refuse', check: 'commit', sentence: 'the nights pick no commit' },
    ];
    expect(verdict({ lines: stopped, mode: 'rehearse', outcomes: {}, commit: '' }).exitCode).toBe(1);
    expect(verdict({ lines: all('rehearse'), mode: 'rehearse', outcomes: { ...outcomes, worktree: 'failure' }, commit: C }).exitCode).toBe(1);
  });
});
