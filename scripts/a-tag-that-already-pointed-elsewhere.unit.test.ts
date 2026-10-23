// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAG THAT ALREADY POINTED ELSEWHERE: a release tag is what `deploy-live.sh` trusts, and the workflow that cuts it has to know, at the moment it cuts it, that the name is free or already its own at the same commit, and that what it proved is still true (the design review of the Release workflow, 2026-10-22).
 *
 * ## What `scripts/release-cut-tag.mjs` does, in this order
 *
 * 1. **The tag, peeled.** Annotated at the commit, and made by Release:
 *    carry on, this is a re-run, and nothing else is read (the review of
 *    2026-10-23: a re-run after the tag was made must not be refused by
 *    nights that ran since). Anything else but absent refuses: a lightweight
 *    tag, a tag at another commit, or an annotated one whose message names a
 *    run that was not Release's. A tag counts as Release's only when the run
 *    its message names is, read from the API, a `workflow_dispatch` of
 *    `.github/workflows/release.yml` on `main` in release mode for this
 *    version, AND that run's `tag` job ran to success (or is running, in
 *    this very run): anybody with write access can type the words
 *    "Release run:" into `git tag -a`, naming a run that stopped at its
 *    preflight.
 * 2. **The nights, read again**, only when the tag is to be made. The
 *    preflight read them, and then the approval may have waited for days. A
 *    night that went red since, or a newer night on another commit, means
 *    the commit no longer qualifies.
 * 3. **The commit is still on `main`** (`compare`, ahead or identical).
 * 4. **The tag, peeled again**, right before the write.
 * 5. **The two calls.** `POST git/tags` makes the annotated tag object
 *    (`type: commit`, a message naming the run and what proved it), and
 *    `POST git/refs` makes `refs/tags/v<version>`. A 422 there means the ref
 *    appeared in between; it is peeled again, and passes only if it is now
 *    this run's tag at this commit. A tag ref is never force-moved.
 * 6. **Read back**: annotated, on origin, `v` plus the version, at the
 *    commit: what `deploy/compose/release-tag.sh` requires of a tag before
 *    live runs it.
 *
 * ## What this test holds
 *
 * Each of those, against an API that answers as scripted and records what it
 * was sent: nothing is posted after a refusal, and what is posted is the
 * annotated tag `release-tag.sh` accepts.
 */

import { describe, it, expect } from 'vitest';
import { releaseRunId, tagMessage, isReleaseRun, madeByItsTagJob, tagDecision, cutTag } from './release-cut-tag.mjs';
import type { Client } from './release-cut-tag.mjs';
import { ApiError } from './release-github.mjs';
import type { Line } from './release-github.mjs';

const C = '721c6ea82bf0214e2d132c37e84d8da2d43247bc';
const OTHER = '91b49de91f1ce654b103a5a1b5485aba8926b349';
const TAG_OBJECT = 'a'.repeat(40);
const V = 'v0.2.0-alpha.2';
const RUN = 4242;
const URL = `https://github.com/Robbes/Ownpace/actions/runs/${RUN}`;

const releaseRun = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  path: '.github/workflows/release.yml',
  head_branch: 'main',
  event: 'workflow_dispatch',
  display_title: `Release ${V} (release)`,
  ...over,
});
const tagJob = (status: string, conclusion: string | null) => ({ name: 'tag', status, conclusion });
const ran = [tagJob('completed', 'success')];
const running = [tagJob('in_progress', null)];
const skipped = [tagJob('completed', 'skipped')];
const annotated = { ref: `refs/tags/${V}`, object: { type: 'tag', sha: TAG_OBJECT } };
const objectAt = (sha: string, message = tagMessage({ version: V, runUrl: URL, proof: 'p' })) => ({
  sha: TAG_OBJECT,
  tag: V,
  message,
  object: { type: 'commit', sha },
});

describe('the tag’s message names the run that made it', () => {
  it('reads the run id back out of the message it writes', () => {
    const message = tagMessage({ version: V, runUrl: URL, proof: 'CI #4694; E2E (managed) #270 #271' });
    expect(message).toMatch(/^Ownpace v0\.2\.0-alpha\.2\n\nRelease run: https:\/\/github\.com\/Robbes\/Ownpace\/actions\/runs\/4242\nProved by: /);
    expect(releaseRunId(message)).toBe(RUN);
    expect(releaseRunId('Ownpace v0.2.0-alpha.1')).toBeNull();
  });

  it('counts a run as Release’s only from what the API says about it', () => {
    expect(isReleaseRun(releaseRun(), V)).toBe(true);
    expect(isReleaseRun(releaseRun({ path: '.github/workflows/ci.yml' }), V)).toBe(false);
    expect(isReleaseRun(releaseRun({ head_branch: 'an-edited-copy' }), V)).toBe(false);
    expect(isReleaseRun(releaseRun({ event: 'push' }), V)).toBe(false);
    expect(isReleaseRun(releaseRun({ display_title: `Release ${V} (rehearse)` }), V)).toBe(false);
    expect(isReleaseRun(null, V)).toBe(false);
  });
});

describe('what to do with the name', () => {
  const decide = (over: Partial<Parameters<typeof tagDecision>[0]>) =>
    tagDecision({ ref: null, tagObject: null, commit: C, releaseRun: null, releaseJobs: null, currentRunId: 0, version: V, ...over }).action;

  it('creates a free name', () => {
    expect(decide({})).toBe('create');
  });

  it('carries on over its own annotated tag at the commit', () => {
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun(), releaseJobs: ran })).toBe('reuse');
  });

  it('refuses a lightweight tag, a tag at another commit, and one whose message names no Release run', () => {
    expect(decide({ ref: { ref: `refs/tags/${V}`, object: { type: 'commit', sha: C } } })).toBe('refuse');
    expect(decide({ ref: annotated, tagObject: objectAt(OTHER), releaseRun: releaseRun(), releaseJobs: ran })).toBe('refuse');
    expect(decide({ ref: annotated, tagObject: objectAt(C, 'Ownpace v0.2.0-alpha.2'), releaseRun: null })).toBe('refuse');
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun({ head_branch: 'edited' }), releaseJobs: ran })).toBe('refuse');
  });

  // The review of 2026-10-23: a tag pushed by hand at C can name an earlier
  // release-mode run that stopped at its preflight; the run is Release's,
  // and its tag job never ran.
  it('refuses a tag naming a Release run whose tag job never ran', () => {
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun(), releaseJobs: skipped })).toBe('refuse');
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun(), releaseJobs: [] })).toBe('refuse');
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun(), releaseJobs: null })).toBe('refuse');
    const failed = [tagJob('completed', 'failure')];
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun(), releaseJobs: failed })).toBe('refuse');
  });

  it('counts a tag job that is running only in this very run: the tag job reading back its own tag', () => {
    expect(madeByItsTagJob(running, { id: RUN, currentRunId: RUN })).toBe(true);
    expect(madeByItsTagJob(running, { id: RUN, currentRunId: RUN + 1 })).toBe(false);
    expect(madeByItsTagJob([...skipped, ...ran], { id: RUN, currentRunId: 0 })).toBe(true);
    expect(decide({ ref: annotated, tagObject: objectAt(C), releaseRun: releaseRun(), releaseJobs: running, currentRunId: RUN })).toBe('reuse');
  });
});

type Call = { method: string; path: string; body?: unknown };

function fake(handle: (call: Call, calls: Call[]) => { status: number; json?: unknown }): Client & { calls: Call[] } {
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

const green = async () => ({ verdict: 'pass' as const, lines: [], proof: 'E2E (managed) #270 #271; E2E (self-hosted) #290 #291 #292 #293' });
const red = async () => ({
  verdict: 'refuse' as const,
  lines: [{ kind: 'refuse', check: 'nights', sentence: 'E2E (managed) #272 ended failure' }],
  proof: '',
});

/** The repository as it is just before the tag: no tag, the commit on main. */
function repository(over: (call: Call, made: { ref: boolean }) => { status: number; json?: unknown } | undefined = () => undefined) {
  const made = { ref: false };
  return fake((call) => {
    const special = over(call, made);
    if (special) return special;
    if (call.method === 'GET' && call.path === `git/ref/tags/${V}`) return made.ref ? { status: 200, json: annotated } : { status: 404 };
    if (call.method === 'GET' && call.path === `git/tags/${TAG_OBJECT}`) return { status: 200, json: objectAt(C, tagMessage({ version: V, runUrl: URL, proof: 'p' })) };
    if (call.method === 'GET' && call.path === `actions/runs/${RUN}`) return { status: 200, json: releaseRun() };
    if (call.method === 'GET' && call.path === `actions/runs/${RUN}/jobs?filter=all&per_page=100`) return { status: 200, json: { jobs: running } };
    if (call.method === 'GET' && call.path === `compare/${C}...main`) return { status: 200, json: { status: 'ahead' } };
    if (call.method === 'POST' && call.path === 'git/tags') return { status: 201, json: { sha: TAG_OBJECT } };
    if (call.method === 'POST' && call.path === 'git/refs') {
      made.ref = true;
      return { status: 201, json: annotated };
    }
    return { status: 404 };
  });
}

type Nights = () => Promise<{ verdict: 'pass' | 'refuse'; lines: Line[]; proof: string }>;
const cut = (client: Client, nights: Nights = green) =>
  cutTag(client, { version: V, commit: C, runId: RUN, runUrl: URL, proof: 'CI #4694, Security Scan #4710, gate scan run 9', readNights: nights });
const posted = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

describe('cutting it', () => {
  it('posts the annotated tag object, then the ref, and reads it back', async () => {
    const api = repository();
    const lines = await cut(api);
    expect(lines.filter((l) => l.kind === 'refuse')).toEqual([]);
    const [object, ref] = posted(api.calls);
    expect(object).toMatchObject({ path: 'git/tags', body: { tag: V, object: C, type: 'commit' } });
    expect((object!.body as { message: string }).message).toContain(`Release run: ${URL}`);
    expect(ref).toMatchObject({ path: 'git/refs', body: { ref: `refs/tags/${V}`, sha: TAG_OBJECT } });
  });

  it('posts nothing when a night has gone red since the preflight', async () => {
    const api = repository();
    const lines = await cut(api, red);
    expect(lines.map((l) => l.kind)).toContain('refuse');
    expect(posted(api.calls)).toEqual([]);
  });

  it('posts nothing when the tag appeared at another commit since the preflight', async () => {
    const api = repository((call) => {
      if (call.method === 'GET' && call.path === `git/ref/tags/${V}`) return { status: 200, json: annotated };
      if (call.method === 'GET' && call.path === `git/tags/${TAG_OBJECT}`) return { status: 200, json: objectAt(OTHER) };
      return undefined;
    });
    expect((await cut(api)).map((l) => l.kind)).toContain('refuse');
    expect(posted(api.calls)).toEqual([]);
  });

  it('posts nothing when the commit is no longer on main', async () => {
    for (const status of ['behind', 'diverged']) {
      const api = repository((call) => (call.path === `compare/${C}...main` ? { status: 200, json: { status } } : undefined));
      expect((await cut(api)).map((l) => l.kind)).toContain('refuse');
      expect(posted(api.calls)).toEqual([]);
    }
  });

  it('a ref that appeared between the two calls passes only if it is this run’s, at the commit', async () => {
    const ours = repository((call, made) => {
      if (call.method === 'POST' && call.path === 'git/refs') {
        made.ref = true;
        return { status: 422, json: { message: 'Reference already exists' } };
      }
      return undefined;
    });
    expect((await cut(ours)).filter((l) => l.kind === 'refuse')).toEqual([]);

    const theirs = repository((call, made) => {
      if (call.method === 'POST' && call.path === 'git/refs') {
        made.ref = true;
        return { status: 422, json: { message: 'Reference already exists' } };
      }
      if (call.method === 'GET' && call.path === `git/tags/${TAG_OBJECT}`) return { status: 200, json: objectAt(OTHER) };
      return undefined;
    });
    expect((await cut(theirs)).map((l) => l.kind)).toContain('refuse');
    expect(posted(theirs.calls).filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('re-uses its own tag on a re-run, and posts nothing', async () => {
    const api = repository((call) => (call.method === 'GET' && call.path === `git/ref/tags/${V}` ? { status: 200, json: annotated } : undefined));
    const lines = await cut(api);
    expect(lines.filter((l) => l.kind === 'refuse')).toEqual([]);
    expect(posted(api.calls)).toEqual([]);
  });

  // The review of 2026-10-23: the tag job re-run after its POST git/refs had
  // succeeded must carry on, even when newer nights ran another commit since.
  it('re-uses its own tag without reading the nights again', async () => {
    const api = repository((call) => (call.method === 'GET' && call.path === `git/ref/tags/${V}` ? { status: 200, json: annotated } : undefined));
    let read = 0;
    const lines = await cut(api, async () => {
      read += 1;
      return red();
    });
    expect(lines.filter((l) => l.kind === 'refuse')).toEqual([]);
    expect(read).toBe(0);
    expect(posted(api.calls)).toEqual([]);
  });

  it('posts nothing over a tag pushed by hand that names an earlier Release run whose tag job never ran', async () => {
    const EARLIER = 4100;
    const message = tagMessage({ version: V, runUrl: `https://github.com/Robbes/Ownpace/actions/runs/${EARLIER}`, proof: 'p' });
    const api = repository((call) => {
      if (call.method === 'GET' && call.path === `git/ref/tags/${V}`) return { status: 200, json: annotated };
      if (call.method === 'GET' && call.path === `git/tags/${TAG_OBJECT}`) return { status: 200, json: objectAt(C, message) };
      if (call.method === 'GET' && call.path === `actions/runs/${EARLIER}`) return { status: 200, json: releaseRun({ id: EARLIER }) };
      if (call.method === 'GET' && call.path === `actions/runs/${EARLIER}/jobs?filter=all&per_page=100`) return { status: 200, json: { jobs: skipped } };
      return undefined;
    });
    const lines = await cut(api);
    expect(lines.filter((l) => l.kind === 'refuse').map((l) => l.sentence).join('\n')).toMatch(/tag job/);
    expect(posted(api.calls)).toEqual([]);
  });

  it('peels the tag again right before it writes, after the nights', async () => {
    const api = repository();
    await cut(api);
    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    const peels = paths.map((p, i) => (p === `GET git/ref/tags/${V}` ? i : -1)).filter((i) => i >= 0);
    const tagged = paths.indexOf('POST git/tags');
    const compared = paths.indexOf(`GET compare/${C}...main`);
    expect(peels.filter((i) => i < tagged)).toHaveLength(2);
    expect(peels.filter((i) => i < tagged).at(-1)).toBeGreaterThan(compared);
  });
});
