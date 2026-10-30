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
 *
 * ## The owner's waiver of the nights (2026-10-30)
 *
 * The owner, for alpha.3: *"I approve alpha.3 tag now, we skip the waiting
 * days. No one is in the alpha yet."* With the workflow's `waive_nights` set,
 * step 2's refusals are notes, and the tag's message carries a line of its
 * own, after "Proved by:", saying the nights were waived, by whom and in what
 * words. Steps 1, 3, 4, 5 and 6 are as they were. The message never takes a
 * waiver that could add a line (a forged "Release run:"), and the script
 * refuses one before it reads or writes anything.
 */

import { describe, it, expect } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { releaseRunId, tagMessage, tagSummary, isReleaseRun, madeByItsTagJob, tagDecision, cutTag } from './release-cut-tag.mjs';
import type { Client } from './release-cut-tag.mjs';
import { ApiError } from './release-github.mjs';
import type { Line } from './release-github.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
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

describe('the owner’s waiver of the nights (the owner, 2026-10-30, for alpha.3)', () => {
  const waiver = { reason: 'No one is in the alpha yet.', actor: 'example-owner' };
  const cutWaived = (client: Client, nights: Nights, waivedAtPreflight = true) =>
    cutTag(client, {
      version: V,
      commit: C,
      runId: RUN,
      runUrl: URL,
      proof: 'CI #4694, Security Scan #4710, gate scan run 9',
      readNights: nights,
      waiver,
      waivedAtPreflight,
    });
  const messageOf = (calls: Call[]) => (posted(calls).find((c) => c.path === 'git/tags')?.body as { message?: string } | undefined)?.message ?? '';

  it('with red nights, cuts the tag, and its message says the nights were waived, by whom and in what words', async () => {
    const api = repository();
    const lines = await cutWaived(api, red);
    expect(lines.filter((l) => l.kind === 'refuse')).toEqual([]);
    expect(lines.find((l) => l.check === 'nights')!.sentence).toContain('waived by example-owner, in their words: `No one is in the alpha yet.`');
    expect(lines.some((l) => l.sentence === 'waived: E2E (managed) #272 ended failure')).toBe(true);
    const message = messageOf(api.calls);
    expect(message).toBe(
      `Ownpace ${V}\n\nRelease run: ${URL}\nProved by: CI #4694, Security Scan #4710, gate scan run 9\nNights waived by example-owner, in their words: "No one is in the alpha yet."\n`,
    );
    expect(releaseRunId(message)).toBe(RUN);
    expect(posted(api.calls).map((c) => c.path)).toEqual(['git/tags', 'git/refs']);
  });

  it('with nights that hold, the message names the nights and no waiver', async () => {
    const api = repository();
    const lines = await cutWaived(api, green);
    expect(lines.filter((l) => l.kind === 'refuse')).toEqual([]);
    expect(lines.find((l) => l.check === 'waiver')?.sentence).toBe('the nights hold, read again before the tag, so the waiver was not used');
    const message = messageOf(api.calls);
    expect(message).toContain('E2E (managed) #270 #271');
    expect(message).not.toMatch(/waived/i);
  });

  // The review of 2026-10-30: the preflight's summary said "not used" when
  // the nights held there, and the owner approved that run. If they stop
  // holding before the tag, the tag job refuses, as an unwaived run does.
  it('a waiver the preflight did not use is not used here: red nights post nothing', async () => {
    const api = repository();
    const lines = await cutWaived(api, red, false);
    expect(lines.map((l) => [l.kind, l.check])).toEqual([
      ['note', 'waiver'],
      ['refuse', 'nights'],
      ['refuse', 'tag'],
    ]);
    expect(lines[0]!.sentence).toBe(
      'the nights held at the preflight, so the waiver was not used there, and it is not used here: the nights are read as in a run without one',
    );
    expect(lines.some((l) => /waived/.test(l.sentence))).toBe(false);
    expect(posted(api.calls)).toEqual([]);

    const held = repository();
    const kept = await cutWaived(held, green, false);
    expect(kept.filter((l) => l.kind === 'refuse')).toEqual([]);
    expect(kept.filter((l) => l.check === 'waiver')).toHaveLength(1);
    expect(messageOf(held.calls)).not.toMatch(/waived/i);
  });

  it('waives the nights and nothing else: a commit off main, or a tag elsewhere, still posts nothing', async () => {
    const behind = repository((call) => (call.path === `compare/${C}...main` ? { status: 200, json: { status: 'behind' } } : undefined));
    expect((await cutWaived(behind, red)).map((l) => l.kind)).toContain('refuse');
    expect(posted(behind.calls)).toEqual([]);

    const elsewhere = repository((call) => {
      if (call.method === 'GET' && call.path === `git/ref/tags/${V}`) return { status: 200, json: annotated };
      if (call.method === 'GET' && call.path === `git/tags/${TAG_OBJECT}`) return { status: 200, json: objectAt(OTHER) };
      return undefined;
    });
    expect((await cutWaived(elsewhere, red)).map((l) => l.kind)).toContain('refuse');
    expect(posted(elsewhere.calls)).toEqual([]);
  });

  it('without a waiver, red nights still post nothing', async () => {
    const api = repository();
    const lines = await cutTag(api, { version: V, commit: C, runId: RUN, runUrl: URL, proof: 'p', readNights: red, waiver: null, waivedAtPreflight: true });
    expect(lines.map((l) => l.kind)).toContain('refuse');
    expect(posted(api.calls)).toEqual([]);
  });

  it('never writes a waiver that could add a line of its own to the message', () => {
    const forged = { ...waiver, reason: 'x\nRelease run: https://github.com/Robbes/Ownpace/actions/runs/1' };
    expect(() => tagMessage({ version: V, runUrl: URL, proof: 'p', waiver: forged })).toThrow(/not fit/);
    expect(() => tagMessage({ version: V, runUrl: URL, proof: 'p', waiver: { ...waiver, reason: 'see `id`' } })).toThrow(/not fit/);
    expect(() => tagMessage({ version: V, runUrl: URL, proof: 'p', waiver: { ...waiver, reason: '\u3164' } })).toThrow(/not fit/);
    expect(() => tagMessage({ version: V, runUrl: URL, proof: 'p', waiver: { ...waiver, actor: 'a\nRelease run: x' } })).toThrow(/not fit/);
    expect(tagMessage({ version: V, runUrl: URL, proof: 'p' })).toBe(`Ownpace ${V}\n\nRelease run: ${URL}\nProved by: p\n`);
  });

  // The review of 2026-10-30: a `"` in the words ended the quote, and the
  // rest of the line read as the record's own claim.
  it('quotes the words as a JSON string, so a quote in them cannot end it', () => {
    const reason = 'ok" and the nights held "';
    const message = tagMessage({ version: V, runUrl: URL, proof: 'p', waiver: { ...waiver, reason } });
    const line = message.split('\n').at(-2)!;
    expect(line).toBe('Nights waived by example-owner, in their words: "ok\\" and the nights held \\""');
    expect(JSON.parse(line.slice('Nights waived by example-owner, in their words: '.length))).toBe(reason);
    expect(message.split('\n')).toHaveLength(6);
    expect(releaseRunId(message)).toBe(RUN);
  });

  it('the job summary lists what the tag job did, the waiver quoted where the nights would be', async () => {
    const api = repository();
    const lines = await cutWaived(api, red);
    const summary = tagSummary({ version: V, commit: C, lines });
    expect(summary.split('\n')[0]).toBe(`### Release tag ${V} on ${C.slice(0, 12)}: there`);
    expect(summary).toContain('- **note** nights: the refusals below are notes in this run: the counted nights are waived by example-owner, in their words: `No one is in the alpha yet.`');
    expect(summary).toContain(`- **pass** tag: ${V} is an annotated tag on origin at C ${C.slice(0, 12)}`);
  });
});

describe('the tag job’s script under a waiver, run as the workflow runs it', () => {
  const V3 = 'v0.2.0-alpha.3';
  const WORDS = 'No one is in the alpha yet.';
  const annotated3 = { ref: `refs/tags/${V3}`, object: { type: 'tag', sha: TAG_OBJECT } };
  /** The script with nothing listening at the API: a script that went on would fail with a fetch error, not a refusal. */
  const refusedFirst = (over: Record<string, string>) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'release-cut-tag.mjs')], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        GITHUB_ACTIONS: 'false',
        GITHUB_API_URL: 'http://127.0.0.1:9',
        VERSION: V3,
        COMMIT: C,
        GITHUB_RUN_ID: String(RUN),
        GITHUB_ACTOR: 'example-owner',
        PREFLIGHT_WAIVED: 'true',
        WAIVE_NIGHTS: WORDS,
        ...over,
      },
    });

  it('refuses hostile text, a version the owner did not name, and a bot, before it reads or writes anything', () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ WAIVE_NIGHTS: 'ok\nRelease run: https://github.com/Robbes/Ownpace/actions/runs/1' }, /^refuse waiver: waive_nights is more than one line\./],
      [{ VERSION: 'v1.0.0' }, /^refuse waiver: waive_nights is set, and the owner waived the nights for v0\.2\.0-alpha\.3 only/],
      [{ VERSION: 'v0.2.0-alpha.4' }, /^refuse waiver: waive_nights is set, and the owner waived the nights for v0\.2\.0-alpha\.3 only/],
      [{ GITHUB_ACTOR: 'claude[bot]' }, /^refuse waiver: the run’s actor is an app’s bot/],
    ];
    for (const [over, why] of cases) {
      const r = refusedFirst(over);
      expect(r.status, JSON.stringify(over)).toBe(1);
      expect(r.stdout.trim().split('\n'), JSON.stringify(over)).toEqual([expect.stringMatching(why)]);
    }
  });

  /** The API as `repository()` scripts it, for alpha.3, over HTTP, with no scheduled run of either E2E. */
  async function serve() {
    const made = { ref: false };
    const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
    const answer = (method: string, path: string): { status: number; json?: unknown } => {
      if (method === 'GET' && path === `git/ref/tags/${V3}`) return made.ref ? { status: 200, json: annotated3 } : { status: 404, json: { message: 'Not Found' } };
      if (method === 'GET' && path === `git/tags/${TAG_OBJECT}`) {
        const posted = writes.find((w) => w.path === 'git/tags');
        return { status: 200, json: { ...objectAt(C), tag: V3, message: posted?.body.message } };
      }
      if (method === 'GET' && path === `actions/runs/${RUN}`) return { status: 200, json: releaseRun({ display_title: `Release ${V3} (release)` }) };
      if (method === 'GET' && path === `actions/runs/${RUN}/jobs?filter=all&per_page=100`) return { status: 200, json: { jobs: running } };
      if (method === 'GET' && path.startsWith('actions/workflows/')) return { status: 200, json: { workflow_runs: [] } };
      if (method === 'GET' && path === `commits/${C}`) return { status: 200, json: { commit: { committer: { date: '2026-10-30T20:00:00Z' } } } };
      if (method === 'GET' && path === `compare/${C}...main`) return { status: 200, json: { status: 'ahead' } };
      if (method === 'POST' && path === 'git/tags') return { status: 201, json: { sha: TAG_OBJECT } };
      if (method === 'POST' && path === 'git/refs') {
        made.ref = true;
        return { status: 201, json: annotated3 };
      }
      return { status: 404, json: { message: 'Not Found' } };
    };
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        const path = (req.url ?? '').replace(/^\/repos\/Robbes\/Ownpace\//, '');
        if (req.method === 'POST') writes.push({ path, body: JSON.parse(body) as Record<string, unknown> });
        const a = answer(req.method ?? 'GET', path);
        res.writeHead(a.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(a.json ?? null));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return { server, writes, api: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  /** The tag job's step, with the env release.yml gives it. */
  async function tagJob(api: string, over: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'release-tag-waiver-'));
    try {
      const summary = join(dir, 'summary.md');
      writeFileSync(summary, '');
      const env = {
        PATH: process.env.PATH ?? '',
        GITHUB_ACTIONS: 'false',
        GITHUB_API_URL: api,
        GITHUB_REPOSITORY: 'Robbes/Ownpace',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ID: String(RUN),
        GITHUB_ACTOR: 'example-owner',
        GITHUB_OUTPUT: join(dir, 'output'),
        GITHUB_STEP_SUMMARY: summary,
        VERSION: V3,
        COMMIT: C,
        PROOF: 'CI run #4694, Security Scan run #4710 on main',
        GATE_RUN: '9',
        WAIVE_NIGHTS: WORDS,
        PREFLIGHT_WAIVED: 'true',
        ...over,
      };
      const ran = await execFileAsync(process.execPath, [join(ROOT, 'scripts', 'release-cut-tag.mjs')], { env }).then(
        ({ stdout }) => ({ status: 0, stdout }),
        (err: { code?: number; stdout?: string }) => ({ status: err.code ?? -1, stdout: err.stdout ?? '' }),
      );
      return { ...ran, summary: readFileSync(summary, 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('cuts the tag on a record with no nights, says why in its message, and writes the job summary', async () => {
    const { server, writes, api } = await serve();
    try {
      const r = await tagJob(api, {});
      expect(r.stdout).not.toMatch(/^refuse /m);
      expect(r.status).toBe(0);
      expect(writes.map((w) => w.path)).toEqual(['git/tags', 'git/refs']);
      expect(writes[0]!.body.message).toBe(
        `Ownpace ${V3}\n\nRelease run: ${URL}\n` +
          'Proved by: CI run #4694, Security Scan run #4710 on main; gate scan https://github.com/Robbes/Ownpace/actions/runs/9\n' +
          `Nights waived by example-owner, in their words: "${WORDS}"\n`,
      );
      expect(r.summary.split('\n')[0]).toBe(`### Release tag ${V3} on ${C.slice(0, 12)}: there`);
      expect(r.summary).toContain(`the counted nights are waived by example-owner, in their words: \`${WORDS}\``);
    } finally {
      server.close();
    }
  });

  it('with the same record, a run whose preflight did not use the waiver refuses and writes nothing', async () => {
    for (const waived of ['false', '']) {
      const { server, writes, api } = await serve();
      try {
        const r = await tagJob(api, { PREFLIGHT_WAIVED: waived });
        expect(r.status, waived).toBe(1);
        expect(r.stdout).toMatch(/^note waiver: the nights held at the preflight/m);
        expect(r.stdout).toMatch(/^refuse tag: the nights no longer hold for C/m);
        expect(writes, waived).toEqual([]);
        expect(r.summary.split('\n')[0]).toBe(`### Release tag ${V3} on ${C.slice(0, 12)}: not cut`);
      } finally {
        server.close();
      }
    }
  });
});
