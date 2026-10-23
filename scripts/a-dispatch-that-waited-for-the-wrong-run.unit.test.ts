// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DISPATCH THAT WAITED FOR THE WRONG RUN: a workflow dispatch takes a branch or a tag and never a commit, answers without saying which run it started unless asked, and a dispatch sent twice starts two publishers on one tag (the design review of the Release workflow, 2026-10-22).
 *
 * ## What `scripts/release-dispatch.mjs` does about each
 *
 * - **Which run.** It asks the API for the run's id (`return_run_details`).
 *   When the answer has none, it looks for the run by workflow, ref, commit
 *   and the moment it dispatched. Every run it accepts must have run the
 *   commit, on the ref, of the workflow it named: a green run of anything
 *   else is not this run's green.
 * - **Never twice.** A dispatch is sent once. On an error or a timeout it
 *   looks for the run before anything else, and when it finds none it stops
 *   and says the outcome is unknown, rather than send it again: two
 *   `images.yml` runs on one tag race for the same version tag, and two
 *   Security Scan runs append the release body twice.
 * - **A failed publisher is re-run, not re-dispatched.** On a tag, a run that
 *   already exists for that commit is reused when it passed, waited for when
 *   it is running, and has its failed jobs re-run when it failed
 *   (`rerun-failed-jobs`), once, and then the same run is waited for. A new
 *   dispatch would rebuild and re-push every image, moving digests that legs
 *   which had succeeded had already signed.
 * - **Green means success.** `cancelled` and `skipped` are not green. A
 *   run's answer is read again until its attempt is the one asked for, so the
 *   red of the attempt being re-run is not read as its outcome.
 * - **The tag, checked before each publisher** (the review of 2026-10-23).
 *   A dispatch names the tag by its short name, which a branch of the same
 *   name would answer to as well, and the run's `head_branch` could not tell
 *   them apart. So before anything is dispatched on the tag, the tag must
 *   still be Release's annotated tag at the commit, and no branch may share
 *   its name.
 * - **The gate branch** (`release-gate/<version>`), which lets Security Scan
 *   be dispatched on exactly the commit, is made only at a commit on `main`
 *   (`compare`, ahead or identical: a dispatch on it runs that commit's own
 *   workflow file with a write token), and deleted only while it still
 *   points at that commit. The gate scan passes only when it was the
 *   repository scan alone: every image job skipped, as `image_scans=false`
 *   asks, so a scan on the tag cannot go red on an image after the release
 *   body is attached.
 * - **The rehearsal tag** (`rehearsal-<run number>`) cannot be named like a
 *   release, and the rehearsal passes only when Security Scan on it failed
 *   at the names check, before anything installed, with no release made.
 *
 * ## What this test holds
 *
 * Each of those, against an API that answers as scripted and records what it
 * was sent, and the rehearsal's verdict against alpha.1's real red tag scan
 * (run 37523297841, which failed later, at the advisory gate).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chooseRun,
  judgeRun,
  dispatchRun,
  waitForRun,
  publish,
  openGate,
  closeGate,
  gateBranch,
  gateScan,
  tagStillOurs,
  rehearsalTagName,
  assertNotARelease,
  judgeRehearsal,
} from './release-dispatch.mjs';
import type { Run, Client } from './release-dispatch.mjs';
import { ApiError } from './release-github.mjs';
import { tagMessage } from './release-cut-tag.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'release', name), 'utf8')) as T;

const C = '721c6ea82bf0214e2d132c37e84d8da2d43247bc';
const OTHER = '91b49de91f1ce654b103a5a1b5485aba8926b349';
const V = 'v0.2.0-alpha.2';
const noSleep = async () => {};

type Answer = { status: number; json?: unknown };
type Call = { method: string; path: string; body?: unknown };

/** An API that answers from `handle` and records every call. */
function fake(handle: (call: Call, calls: Call[]) => Answer): Client & { calls: Call[] } {
  const calls: Call[] = [];
  const answer = (call: Call) => {
    calls.push(call);
    const a = handle(call, calls);
    return { status: a.status, json: a.json ?? null };
  };
  return {
    calls,
    async get(path: string, options: { allow404?: boolean } = {}) {
      const a = answer({ method: 'GET', path });
      if (a.status >= 200 && a.status < 300) return a.json;
      if (a.status === 404 && options.allow404) return null;
      throw new ApiError('GET', path, a.status, a.json);
    },
    async send(method: string, path: string, body?: unknown) {
      return answer({ method, path, body });
    },
  };
}

const run = (over: Partial<Run> = {}): Run => ({
  id: 100,
  run_number: 4800,
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  head_sha: C,
  head_branch: V,
  path: '.github/workflows/images.yml',
  created_at: '2026-10-26T10:05:00Z',
  ...over,
});

const posts = (calls: Call[], suffix: string) => calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix));

// The tag as Release made it: annotated, at C, its message naming Release run
// 4242, whose tag job ran; and no branch named like it.
const RELEASE_RUN = 4242;
const TAG_OBJECT = 'a'.repeat(40);
type Over = (call: Call) => Answer | undefined;
function tagged(over: Over = () => undefined): Over {
  return (call) => {
    const special = over(call);
    if (special) return special;
    if (call.method !== 'GET') return undefined;
    if (call.path === `git/ref/tags/${V}`) return { status: 200, json: { ref: `refs/tags/${V}`, object: { type: 'tag', sha: TAG_OBJECT } } };
    if (call.path === `git/tags/${TAG_OBJECT}`) {
      const message = tagMessage({ version: V, runUrl: `https://github.com/Robbes/Ownpace/actions/runs/${RELEASE_RUN}`, proof: 'p' });
      return { status: 200, json: { sha: TAG_OBJECT, tag: V, message, object: { type: 'commit', sha: C } } };
    }
    if (call.path === `actions/runs/${RELEASE_RUN}`) {
      return {
        status: 200,
        json: { id: RELEASE_RUN, path: '.github/workflows/release.yml', head_branch: 'main', event: 'workflow_dispatch', display_title: `Release ${V} (release)` },
      };
    }
    if (call.path === `actions/runs/${RELEASE_RUN}/jobs?filter=all&per_page=100`) {
      return { status: 200, json: { jobs: [{ name: 'tag', status: 'completed', conclusion: 'success' }] } };
    }
    if (call.path === `git/ref/heads/${V}`) return { status: 404 };
    return undefined;
  };
}
/** `fake`, with the tag answered as Release made it before `handle` is asked. */
const onTag = (handle: (call: Call, calls: Call[]) => Answer, over: Over = () => undefined) =>
  fake((call, calls) => tagged(over)(call) ?? handle(call, calls));

describe('choosing what to do about a publisher on a tag', () => {
  it('dispatches when nothing ran the commit, and ignores runs of other commits', () => {
    expect(chooseRun([], C).action).toBe('dispatch');
    expect(chooseRun([run({ head_sha: OTHER })], C).action).toBe('dispatch');
  });

  it('reuses a green run, waits for a running one, and re-runs a failed one', () => {
    expect(chooseRun([run()], C)).toMatchObject({ action: 'reuse', run: { id: 100 } });
    expect(chooseRun([run({ status: 'in_progress', conclusion: null })], C).action).toBe('wait');
    expect(chooseRun([run({ conclusion: 'failure' })], C).action).toBe('rerun');
    expect(chooseRun([run({ conclusion: 'cancelled' })], C).action).toBe('rerun');
  });
});

describe('judging a run', () => {
  const want = { sha: C, workflow: 'images.yml', ref: V };

  it('passes only a success of the named workflow, on the ref, that ran the commit', () => {
    expect(judgeRun(run(), want).kind).toBe('pass');
    expect(judgeRun(run({ head_sha: OTHER }), want).sentence).toMatch(/ran 91b49de91f1c, not 721c6ea82bf0/);
    expect(judgeRun(run({ path: '.github/workflows/security-scan.yml' }), want).kind).toBe('refuse');
    expect(judgeRun(run({ head_branch: 'main' }), want).kind).toBe('refuse');
  });

  it('does not count cancelled or skipped as green', () => {
    expect(judgeRun(run({ conclusion: 'cancelled' }), want).kind).toBe('refuse');
    expect(judgeRun(run({ conclusion: 'skipped' }), want).kind).toBe('refuse');
    expect(judgeRun(run({ status: 'in_progress', conclusion: null }), want).kind).toBe('refuse');
  });
});

describe('a dispatch is sent once', () => {
  const args = { workflow: 'images.yml', ref: V, sha: C, inputs: {}, since: '2026-10-26T10:00:00Z', sleep: noSleep };

  it('takes the run id the API gives back', async () => {
    const api = fake(() => ({ status: 200, json: { workflow_run_id: 555 } }));
    expect(await dispatchRun(api, args)).toBe(555);
    expect(posts(api.calls, '/dispatches')).toHaveLength(1);
    expect(posts(api.calls, '/dispatches')[0]!.body).toMatchObject({ ref: V, return_run_details: true });
  });

  it('looks the run up when the API answers 204 with no id', async () => {
    const api = fake((call) =>
      call.method === 'POST' ? { status: 204 } : { status: 200, json: { workflow_runs: [run({ id: 556 })] } },
    );
    expect(await dispatchRun(api, args)).toBe(556);
  });

  it('after an error, looks for the run and does not send the dispatch again', async () => {
    const found = fake((call) =>
      call.method === 'POST' ? { status: 502 } : { status: 200, json: { workflow_runs: [run({ id: 557 })] } },
    );
    expect(await dispatchRun(found, args)).toBe(557);
    expect(posts(found.calls, '/dispatches')).toHaveLength(1);

    const lost = fake((call) => (call.method === 'POST' ? { status: 502 } : { status: 200, json: { workflow_runs: [] } }));
    await expect(dispatchRun(lost, args)).rejects.toThrow(/not sent again/);
    expect(posts(lost.calls, '/dispatches')).toHaveLength(1);
  });

  it('a refused dispatch (422) says why and starts nothing', async () => {
    const api = fake(() => ({ status: 422, json: { message: 'Unexpected inputs provided: ["image_scans"]' } }));
    await expect(dispatchRun(api, args)).rejects.toThrow(/Unexpected inputs/);
    expect(posts(api.calls, '/dispatches')).toHaveLength(1);
  });
});

describe('waiting', () => {
  it('reads the run again until the attempt asked for has finished', async () => {
    const answers = [
      run({ conclusion: 'failure', run_attempt: 1 }),
      run({ status: 'queued', conclusion: null, run_attempt: 2 }),
      run({ conclusion: 'success', run_attempt: 2 }),
    ];
    let n = 0;
    const api = fake(() => ({ status: 200, json: answers[Math.min(n++, answers.length - 1)] }));
    const done = await waitForRun(api, { id: 100, minAttempt: 2, sleep: noSleep, pollMs: 1, timeoutMs: 60_000 });
    expect(done).toMatchObject({ conclusion: 'success', run_attempt: 2 });
  });
});

describe('publishing on the tag', () => {
  const opts = { workflow: 'images.yml', ref: V, sha: C, inputs: {}, sleep: noSleep, pollMs: 1 };

  it('re-runs a failed run’s failed jobs, once, and never dispatches a second run', async () => {
    let attempt = 1;
    const api = onTag((call) => {
      if (call.method === 'POST' && call.path === 'actions/runs/100/rerun-failed-jobs') {
        attempt = 2;
        return { status: 201 };
      }
      if (call.path.startsWith('actions/workflows/images.yml/runs')) {
        return { status: 200, json: { workflow_runs: [run({ conclusion: 'failure' })] } };
      }
      if (call.path === 'actions/runs/100') {
        return { status: 200, json: attempt === 2 ? run({ run_attempt: 2 }) : run({ conclusion: 'failure' }) };
      }
      return { status: 404 };
    });
    const lines = await publish(api, opts);
    expect(lines.map((l) => l.kind)).not.toContain('refuse');
    expect(posts(api.calls, '/rerun-failed-jobs')).toHaveLength(1);
    expect(posts(api.calls, '/dispatches')).toHaveLength(0);
  });

  it('refuses when the re-run fails too, without a third try', async () => {
    let attempt = 1;
    const api = onTag((call) => {
      if (call.method === 'POST') {
        attempt = 2;
        return { status: 201 };
      }
      if (call.path.startsWith('actions/workflows/')) return { status: 200, json: { workflow_runs: [run({ conclusion: 'failure' })] } };
      return { status: 200, json: run({ conclusion: 'failure', run_attempt: attempt }) };
    });
    const lines = await publish(api, opts);
    expect(lines.map((l) => l.kind)).toContain('refuse');
    expect(posts(api.calls, '/rerun-failed-jobs')).toHaveLength(1);
    expect(posts(api.calls, '/dispatches')).toHaveLength(0);
  });

  it('reuses a run that already passed, and dispatches nothing', async () => {
    const api = onTag((call) =>
      call.path.startsWith('actions/workflows/') ? { status: 200, json: { workflow_runs: [run()] } } : { status: 404 },
    );
    const lines = await publish(api, opts);
    expect(lines.map((l) => `${l.kind} ${l.check}`)).toEqual(['pass tag-ref', 'pass publish-images']);
    expect(api.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('dispatches once on the tag when nothing ran it yet, after checking the tag', async () => {
    const api = onTag((call) => {
      if (call.method === 'POST') return { status: 200, json: { workflow_run_id: 101 } };
      if (call.path.startsWith('actions/workflows/')) return { status: 200, json: { workflow_runs: [] } };
      if (call.path === 'actions/runs/101') return { status: 200, json: run({ id: 101 }) };
      return { status: 404 };
    });
    const lines = await publish(api, opts);
    expect(lines.map((l) => l.kind)).not.toContain('refuse');
    expect(posts(api.calls, '/dispatches')).toHaveLength(1);
    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.indexOf(`GET git/ref/heads/${V}`)).toBeLessThan(paths.indexOf('POST actions/workflows/images.yml/dispatches'));
  });

  // The review of 2026-10-23: a dispatch on the short name runs a branch of
  // that name as readily as the tag, and a moved tag publishes the other
  // commit before the run's commit is ever compared.
  it('dispatches nothing when a branch shares the tag’s name, the tag moved, or it is gone', async () => {
    const nothingRan = (call: Call): Answer =>
      call.path.startsWith('actions/workflows/') ? { status: 200, json: { workflow_runs: [] } } : { status: 404 };
    const cases: Array<[string, Over]> = [
      ['a branch named like the tag', (call) => (call.path === `git/ref/heads/${V}` ? { status: 200, json: { object: { sha: C } } } : undefined)],
      [
        'the tag at another commit',
        (call) =>
          call.path === `git/tags/${TAG_OBJECT}`
            ? { status: 200, json: { sha: TAG_OBJECT, message: `Release run: https://github.com/Robbes/Ownpace/actions/runs/${RELEASE_RUN}`, object: { type: 'commit', sha: OTHER } } }
            : undefined,
      ],
      ['no tag', (call) => (call.path === `git/ref/tags/${V}` ? { status: 404 } : undefined)],
    ];
    for (const [what, over] of cases) {
      const api = onTag(nothingRan, over);
      const lines = await publish(api, opts);
      expect(lines.map((l) => l.kind), what).toContain('refuse');
      expect(api.calls.filter((c) => c.method !== 'GET'), what).toEqual([]);
    }
    const ok = await tagStillOurs(onTag(nothingRan), { version: V, sha: C, currentRunId: 0 });
    expect(ok.kind).toBe('pass');
  });

  it('says so before re-running a scan whose release already has its generated body', async () => {
    let attempt = 1;
    const body = 'cosign verify ghcr.io/robbes/ownpace-selfhost:0.2.0-alpha.2 \\';
    const api = onTag((call) => {
      if (call.method === 'POST') {
        attempt = 2;
        return { status: 201 };
      }
      if (call.path.startsWith('actions/workflows/')) {
        return { status: 200, json: { workflow_runs: [run({ conclusion: 'failure', path: '.github/workflows/security-scan.yml' })] } };
      }
      if (call.path === `releases/tags/${V}`) return { status: 200, json: { tag_name: V, body, assets: [] } };
      return {
        status: 200,
        json: run({ path: '.github/workflows/security-scan.yml', run_attempt: attempt, conclusion: attempt === 2 ? 'success' : 'failure' }),
      };
    });
    const lines = await publish(api, { ...opts, workflow: 'security-scan.yml', inputs: { image_scans: 'false' } });
    const notes = lines.filter((l) => l.kind === 'note').map((l) => l.sentence).join('\n');
    expect(notes).toMatch(/half-published/);
    expect(notes).toMatch(/a second generated block/);
  });
});

describe('the gate branch', () => {
  const onMain = (status = 'ahead') => (call: Call): Answer | undefined =>
    call.method === 'GET' && call.path === `compare/${C}...main` ? { status: 200, json: { status } } : undefined;
  const gate = (handle: (call: Call) => Answer, status = 'ahead') => fake((call) => onMain(status)(call) ?? handle(call));

  it('is named after the version, and reused only when it points at the commit', async () => {
    expect(gateBranch(V)).toBe(`release-gate/${V}`);
    const made = gate(() => ({ status: 201, json: {} }));
    expect((await openGate(made, { version: V, sha: C })).kind).toBe('pass');
    const ours = gate((call) => (call.method === 'POST' ? { status: 422 } : { status: 200, json: { object: { sha: C } } }));
    expect((await openGate(ours, { version: V, sha: C })).kind).toBe('pass');
    const theirs = gate((call) => (call.method === 'POST' ? { status: 422 } : { status: 200, json: { object: { sha: OTHER } } }));
    expect((await openGate(theirs, { version: V, sha: C })).kind).toBe('refuse');
    expect((await openGate(gate(() => ({ status: 201, json: {} }), 'identical'), { version: V, sha: C })).kind).toBe('pass');
  });

  // The review of 2026-10-23: a branch at a commit that is not on main runs
  // that commit's own security-scan.yml, write token and runner included.
  it('is made only at a commit on main, and nothing is written otherwise', async () => {
    for (const status of ['diverged', 'behind']) {
      const api = gate(() => ({ status: 201, json: {} }), status);
      expect((await openGate(api, { version: V, sha: C })).kind, status).toBe('refuse');
      expect(api.calls.filter((c) => c.method !== 'GET'), status).toEqual([]);
    }
    const unknown = fake(() => ({ status: 404 }));
    expect((await openGate(unknown, { version: V, sha: C })).kind).toBe('refuse');
    expect(unknown.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('passes the gate scan only when it was the repository scan alone, every image job skipped', async () => {
    const jobs = (image: string) => [
      { name: 'security-scan', status: 'completed', conclusion: 'success' },
      { name: 'Images the stacks run', status: 'completed', conclusion: image },
      { name: 'Image scan (${{ matrix.name }})', status: 'completed', conclusion: image },
      { name: 'Image scan report', status: 'completed', conclusion: image },
    ];
    const scanned = (image: string) =>
      gate((call) => {
        if (call.method === 'POST' && call.path === 'git/refs') return { status: 201, json: {} };
        if (call.method === 'POST') return { status: 200, json: { workflow_run_id: 300 } };
        if (call.path === 'actions/runs/300') {
          return { status: 200, json: run({ id: 300, path: '.github/workflows/security-scan.yml', head_branch: gateBranch(V) }) };
        }
        if (call.path === 'actions/runs/300/jobs?filter=latest&per_page=100') return { status: 200, json: { jobs: jobs(image) } };
        return { status: 404 };
      });
    const quiet = await gateScan(scanned('skipped'), { version: V, sha: C, sleep: noSleep, pollMs: 1 });
    expect(quiet.lines.map((l) => l.kind)).not.toContain('refuse');
    const loud = await gateScan(scanned('success'), { version: V, sha: C, sleep: noSleep, pollMs: 1 });
    expect(loud.lines.filter((l) => l.kind === 'refuse').map((l) => l.sentence).join('\n')).toMatch(/image_scans=false/);
  });

  it('is deleted only while it still points at the commit', async () => {
    const ours = fake((call) => (call.method === 'GET' ? { status: 200, json: { object: { sha: C } } } : { status: 204 }));
    await closeGate(ours, { version: V, sha: C });
    expect(ours.calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([`git/refs/heads/release-gate/${V}`]);
    const moved = fake(() => ({ status: 200, json: { object: { sha: OTHER } } }));
    await closeGate(moved, { version: V, sha: C });
    expect(moved.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });
});

describe('the rehearsal tag', () => {
  it('can never be a release name', () => {
    expect(rehearsalTagName(12)).toBe('rehearsal-12');
    expect(() => assertNotARelease('v0.2.0-alpha.2')).toThrow();
    expect(() => assertNotARelease('rehearsal-12')).not.toThrow();
  });

  type Job = { name: string; status: string; conclusion: string | null; steps: Array<{ number: number; name: string; status: string; conclusion: string | null }> };
  const alpha1 = fixture<{ jobs: Job[] }>('security-scan-jobs-37523297841.json').jobs;
  const red = run({ conclusion: 'failure', path: '.github/workflows/security-scan.yml', head_branch: 'rehearsal-12' });

  it('refuses alpha.1’s red scan as a rehearsal: it failed at the advisory gate, after the names check passed', () => {
    const lines = judgeRehearsal({ run: red, jobs: alpha1, release: null, tag: 'rehearsal-12' });
    expect(lines.map((l) => l.kind)).toContain('refuse');
    expect(lines.map((l) => l.sentence).join('\n')).toMatch(/names check ended success/);
  });

  it('passes a scan that failed at the names check, before the install, and made no release', () => {
    const expected: Job[] = alpha1.map((job) => ({
      ...job,
      steps: job.steps.map((s) =>
        s.name === 'The tag, package.json and the changelog name one release'
          ? { ...s, conclusion: 'failure' }
          : s.number > 3 && s.name !== 'The scan produced a report, and it was uploaded' && !s.name.startsWith('Complete')
            ? { ...s, conclusion: 'skipped' }
            : s,
      ),
    }));
    expect(judgeRehearsal({ run: red, jobs: expected, release: null, tag: 'rehearsal-12' }).map((l) => l.kind)).not.toContain('refuse');
    const made = judgeRehearsal({ run: red, jobs: expected, release: { tag_name: 'rehearsal-12' }, tag: 'rehearsal-12' });
    expect(made.map((l) => l.kind)).toContain('refuse');
    const green = judgeRehearsal({ run: { ...red, conclusion: 'success' }, jobs: expected, release: null, tag: 'rehearsal-12' });
    expect(green.map((l) => l.kind)).toContain('refuse');
  });
});
