#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DISPATCH, WAIT, AND JUDGE THE RIGHT RUN (the gate scan, the three
 * publishers and the tag rehearsal of `.github/workflows/release.yml`).
 *
 * A tag made with the workflow's own token starts no `push` workflow, so
 * Release dispatches each publisher on the tag ref itself, in its order, and
 * waits. What that takes, each written down because each is easy to get
 * wrong:
 *
 * - **The run is found by its id**, asked for with `return_run_details`;
 *   when the answer has none, by workflow, ref, commit and time. A run is
 *   accepted only when it ran that commit, on that ref, of that workflow.
 * - **A dispatch is sent once.** After an error or a timeout the run is
 *   looked for; when none appears the job stops and says the outcome is
 *   unknown. Two `images.yml` runs on one tag race for the version tag, and
 *   two Security Scan runs append the release body twice.
 * - **On a tag, an existing run comes first.** A run of that workflow on
 *   that tag at that commit is reused when it passed, waited for when it is
 *   running, and has its failed jobs re-run once when it failed
 *   (`rerun-failed-jobs`); the same run is then waited for. A fresh dispatch
 *   would rebuild every image and move the digests that legs which had
 *   succeeded had already signed.
 * - **Only success is green.** `cancelled` and `skipped` are not, and a run
 *   is read again until it reports the attempt asked for.
 * - **The tag, checked before each publisher.** A dispatch names the tag by
 *   its short name, which a branch of that name answers to as well, and the
 *   run's `head_branch` is the same short name either way. So before a
 *   publisher is reused, waited for, re-run or dispatched, the tag must still
 *   be Release's annotated tag at C (`peelTag`, `tagDecision`) and
 *   `git/ref/heads/<version>` must answer 404 (the review of 2026-10-23).
 * - **The gate.** A dispatch takes a branch or a tag and never a commit. To
 *   scan exactly C minutes before the tag, a branch `release-gate/<version>`
 *   is made at C, Security Scan is dispatched on it with
 *   `image_scans=false`, and the branch is deleted afterwards while it still
 *   points at C. The branch is made only when `compare` says C is on `main`
 *   (ahead or identical): a dispatch runs the workflow file of the commit it
 *   names, with this job's write token, so a commit that is not on `main`
 *   never gets one. And the gate passes only when every image job of that
 *   run was skipped, as `image_scans=false` asks: an image leg that ran
 *   could fail the scan on the tag after it had attached the release body.
 * - **The tag rehearsal** makes an annotated tag `rehearsal-<run number>` at
 *   `main`'s head with the same token and calls, dispatches Security Scan on
 *   it, expects the names check to refuse it ("not a release name") before
 *   anything installs, and deletes it. It proves the two calls, a tag-ref
 *   dispatch and the handling of a red run before a real tag depends on them.
 *   It reads no nights, so it refuses the owner's waiver of them
 *   (`WAIVE_NIGHTS`) before it makes anything.
 *
 * Usage (in the Release workflow; GH_TOKEN, VERSION, COMMIT in the env):
 *
 *   node scripts/release-dispatch.mjs gate
 *   node scripts/release-dispatch.mjs drop-gate
 *   node scripts/release-dispatch.mjs publish --workflow <file> [--input k=v]...
 *   node scripts/release-dispatch.mjs rehearse-tag
 *   node scripts/release-dispatch.mjs drop-rehearsal-tag
 */

import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { github, pass, refuse, note, report, output, runUrl, short } from './release-github.mjs';
import { generatedBlocks } from './release-verify.mjs';
import { peelTag, tagDecision } from './release-cut-tag.mjs';
import { readWaiver } from './release-nights.mjs';

const time = (t) => new Date(t).getTime();
const newestFirst = (runs) => [...runs].sort((a, b) => time(b.created_at) - time(a.created_at));
const enc = encodeURIComponent;

export const GATE_PREFIX = 'release-gate/';
export const REHEARSAL_PREFIX = 'rehearsal-';
export const NAMES_STEP = 'The tag, package.json and the changelog name one release';
/** Security Scan's own job; every other job in it scans images. */
export const SCAN_JOB = 'security-scan';

/** The branch the gate scan runs on. */
export const gateBranch = (version) => `${GATE_PREFIX}${version}`;

/** A throwaway tag name can never be a release name. */
export function assertNotARelease(name) {
  if (/^v\d/.test(name)) throw new Error(`${name} would be a release name; a rehearsal tag never is`);
}

/** The rehearsal's throwaway tag, named after the Release run. */
export function rehearsalTagName(runNumber) {
  const name = `${REHEARSAL_PREFIX}${runNumber}`;
  assertNotARelease(name);
  return name;
}

/** Reuse, wait, re-run or dispatch, from the runs already on the ref. */
export function chooseRun(runs, sha) {
  const mine = newestFirst(runs.filter((r) => r.head_sha === sha));
  const green = mine.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (green) return { action: 'reuse', run: green };
  const going = mine.find((r) => r.status !== 'completed');
  if (going) return { action: 'wait', run: going };
  if (mine.length > 0) return { action: 'rerun', run: mine[0] };
  return { action: 'dispatch' };
}

/** Pass only a success of the named workflow, on the ref, that ran the commit. */
export function judgeRun(run, { sha, workflow, ref, check = `publish-${workflow.replace(/\.ya?ml$/, '')}` }) {
  if (!run) return refuse(check, `no run of ${workflow} on ${ref} was found`);
  const name = `${workflow} run ${run.run_number ?? run.id} (${runUrl(run.id)})`;
  if (run.path !== `.github/workflows/${workflow}`) return refuse(check, `${name} is a run of ${run.path}, not of ${workflow}`);
  if (run.head_branch !== ref) return refuse(check, `${name} ran on ${run.head_branch}, not on ${ref}`);
  if (run.head_sha !== sha) return refuse(check, `${name} ran ${short(run.head_sha)}, not ${short(sha)}`);
  if (run.status !== 'completed') return refuse(check, `${name} is ${run.status}`);
  if (run.conclusion !== 'success') return refuse(check, `${name} ended ${run.conclusion}: only success is green`);
  return pass(check, `${name} is green on ${ref} at ${short(sha)}`);
}

/** The newest workflow_dispatch run of a workflow on a ref at a commit, created since `since`. */
export async function findRun(client, { workflow, ref, sha, since }) {
  const created = since ? `&created=${enc(`>=${since}`)}` : '';
  const listed = await client.get(
    `actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${enc(ref)}&head_sha=${sha}&per_page=20${created}`,
  );
  const runs = (listed?.workflow_runs ?? []).filter((r) => r.head_sha === sha && (!since || time(r.created_at) >= time(since)));
  return newestFirst(runs)[0] ?? null;
}

/**
 * Dispatch once and return the run's id. A refusal (4xx) starts nothing and
 * says why; a 204, a 5xx or no answer is followed by a search, never by a
 * second dispatch.
 */
export async function dispatchRun(client, { workflow, ref, sha, inputs = {}, since, sleep = (ms) => delay(ms), searchTries = 6, searchMs = 10_000 }) {
  let answer = null;
  let error = null;
  try {
    answer = await client.send('POST', `actions/workflows/${workflow}/dispatches`, { ref, inputs, return_run_details: true });
  } catch (err) {
    error = err;
  }
  const id = answer?.json?.workflow_run_id;
  if (answer && answer.status >= 200 && answer.status < 300 && id) return id;
  if (answer && answer.status >= 400 && answer.status < 500) {
    const said = answer.json?.message ? `: ${answer.json.message}` : '';
    throw new Error(`the dispatch of ${workflow} on ${ref} was refused (${answer.status}${said}); nothing started`);
  }
  for (let i = 0; i < searchTries; i += 1) {
    const run = await findRun(client, { workflow, ref, sha, since });
    if (run) return run.id;
    await sleep(searchMs);
  }
  const what = error ? `failed (${error instanceof Error ? error.message : String(error)})` : `answered ${answer?.status}`;
  throw new Error(
    `the dispatch of ${workflow} on ${ref} ${what}, and no run of it appeared since ${since}. It is not sent again: ` +
      'look in the Actions tab, and a re-run of this job looks for the run before it dispatches',
  );
}

/** Read a run until it has finished the attempt asked for. */
export async function waitForRun(client, { id, minAttempt = 1, sleep = (ms) => delay(ms), pollMs = 30_000, timeoutMs = 120 * 60_000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await client.get(`actions/runs/${id}`);
    if (run?.status === 'completed' && (run.run_attempt ?? 1) >= minAttempt) return run;
    if (Date.now() > deadline) {
      throw new Error(`run ${id} had not finished attempt ${minAttempt} after ${Math.round(timeoutMs / 60_000)} minutes (${run?.status})`);
    }
    await sleep(pollMs);
  }
}

/**
 * The tag is still Release's annotated tag at C, and no branch shares its
 * name: what a dispatch on the short name needs to run the tag and only it.
 */
export async function tagStillOurs(client, { version, sha, currentRunId }) {
  const decision = tagDecision({ commit: sha, version, ...(await peelTag(client, version, { currentRunId })) });
  if (decision.action !== 'reuse') {
    const why = decision.action === 'create' ? `${version} does not exist` : decision.why;
    return refuse('tag-ref', `${why}: nothing is dispatched on it`);
  }
  const branch = await client.get(`git/ref/heads/${version}`, { allow404: true });
  if (branch) {
    return refuse('tag-ref', `a branch named ${version} exists: a dispatch on ${version} could run it instead of the tag, so nothing is dispatched`);
  }
  return pass('tag-ref', `${version} is Release’s annotated tag at ${short(sha)}, and no branch shares its name`);
}

/**
 * One publisher on the tag: check the tag, then reuse, wait for, re-run or
 * dispatch it, and judge the run.
 */
export async function publish(
  client,
  { workflow, ref, sha, inputs = {}, sleep = (ms) => delay(ms), pollMs = 30_000, timeoutMs, now = () => new Date(), currentRunId = Number(process.env.GITHUB_RUN_ID) || null },
) {
  const check = `publish-${workflow.replace(/\.ya?ml$/, '')}`;
  const want = { sha, workflow, ref, check };
  const wait = (id, minAttempt) => waitForRun(client, { id, minAttempt, sleep, pollMs, timeoutMs });
  const tag = await tagStillOurs(client, { version: ref, sha, currentRunId });
  if (tag.kind === 'refuse') return [tag];
  const lines = [tag];
  const listed = await client.get(`actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${enc(ref)}&head_sha=${sha}&per_page=20`);
  const choice = chooseRun(listed?.workflow_runs ?? [], sha);
  let run;
  if (choice.action === 'reuse') {
    return [...lines, judgeRun(choice.run, want)];
  } else if (choice.action === 'wait') {
    lines.push(note(check, `run ${choice.run.run_number} of ${workflow} is already ${choice.run.status} on ${ref}: waiting for it, not dispatching another`));
    run = await wait(choice.run.id, 1);
  } else if (choice.action === 'rerun') {
    const failed = choice.run;
    if (workflow === 'security-scan.yml') {
      const release = await client.get(`releases/tags/${enc(ref)}`, { allow404: true });
      if (release && generatedBlocks(release.body ?? '', ref) > 0) {
        lines.push(
          note(
            check,
            `half-published: the release for ${ref} already holds the body Security Scan generated, so re-running it appends ` +
              'a second generated block. The verify job refuses two until one is deleted from the release body by hand (docs/release.md §3)',
          ),
        );
      }
    }
    const rerun = await client.send('POST', `actions/runs/${failed.id}/rerun-failed-jobs`);
    if (rerun.status !== 201) {
      return [...lines, refuse(check, `run ${failed.run_number} ended ${failed.conclusion}, and re-running its failed jobs answered ${rerun.status}`)];
    }
    const attempt = (failed.run_attempt ?? 1) + 1;
    lines.push(
      note(check, `run ${failed.run_number} of ${workflow} ended ${failed.conclusion} on ${ref}: re-running its failed jobs as attempt ${attempt}, not dispatching a new run`),
    );
    run = await wait(failed.id, attempt);
  } else {
    const since = new Date(now().getTime() - 60_000).toISOString();
    const id = await dispatchRun(client, { workflow, ref, sha, inputs, since, sleep });
    lines.push(note(check, `dispatched ${workflow} on ${ref}: ${runUrl(id)}`));
    run = await wait(id, 1);
  }
  lines.push(judgeRun(run, want));
  return lines;
}

/** Make the gate branch at C, only when C is on main, or accept one already there at C. */
export async function openGate(client, { version, sha }) {
  const branch = gateBranch(version);
  const compared = await client.get(`compare/${sha}...main`, { allow404: true });
  if (!['ahead', 'identical'].includes(compared?.status)) {
    return refuse(
      'gate-branch',
      `C ${short(sha)} is ${compared?.status ?? 'unknown'} against main, not on it: no ${branch} is made, and nothing is dispatched on it`,
    );
  }
  const made = await client.send('POST', 'git/refs', { ref: `refs/heads/${branch}`, sha });
  if (made.status === 201) return pass('gate-branch', `${branch} made at C ${short(sha)}`);
  if (made.status === 422) {
    const ref = await client.get(`git/ref/heads/${branch}`, { allow404: true });
    if (ref?.object?.sha === sha) return pass('gate-branch', `${branch} was already at C ${short(sha)}, left by an earlier run`);
    return refuse('gate-branch', `${branch} exists at ${short(ref?.object?.sha)}, not at C: delete it by hand if it is a leftover`);
  }
  return refuse('gate-branch', `making ${branch} answered ${made.status}${made.json?.message ? `: ${made.json.message}` : ''}`);
}

/** Delete the gate branch, only while it still points at C. */
export async function closeGate(client, { version, sha }) {
  const branch = gateBranch(version);
  const ref = await client.get(`git/ref/heads/${branch}`, { allow404: true });
  if (!ref) return note('gate-branch', `${branch} is already gone`);
  if (ref.object?.sha !== sha) return refuse('gate-branch', `${branch} points at ${short(ref.object?.sha)}, not at C: left alone`);
  const gone = await client.send('DELETE', `git/refs/heads/${branch}`);
  return gone.status === 204 ? pass('gate-branch', `${branch} deleted`) : refuse('gate-branch', `deleting ${branch} answered ${gone.status}`);
}

/** Every job of a Security Scan run but the repository scan was skipped, as `image_scans=false` asks. */
export function imageJobsSkipped(jobs, check) {
  return (jobs ?? [])
    .filter((j) => j.name !== SCAN_JOB && j.conclusion !== 'skipped')
    .map((j) => refuse(check, `the job "${j.name}" ended ${j.conclusion}: image_scans=false should have skipped it`));
}

/** The gate: Security Scan on exactly C, minutes before the tag, the repository scan alone. */
export async function gateScan(client, { version, sha, sleep, pollMs, now = () => new Date() }) {
  const opened = await openGate(client, { version, sha });
  if (opened.kind === 'refuse') return { lines: [opened], id: null };
  const ref = gateBranch(version);
  const since = new Date(now().getTime() - 60_000).toISOString();
  const id = await dispatchRun(client, { workflow: 'security-scan.yml', ref, sha, inputs: { image_scans: 'false' }, since, sleep });
  const run = await waitForRun(client, { id, sleep, pollMs, timeoutMs: 80 * 60_000 });
  const jobs = (await client.get(`actions/runs/${id}/jobs?filter=latest&per_page=100`))?.jobs ?? [];
  return { lines: [opened, judgeRun(run, { sha, workflow: 'security-scan.yml', ref, check: 'gate-scan' }), ...imageJobsSkipped(jobs, 'gate-scan')], id };
}

/** Whether Security Scan on a rehearsal tag refused it at the names check and nowhere later. */
export function judgeRehearsal({ run, jobs, release, tag }) {
  const lines = [];
  const check = 'rehearsal-scan';
  if (!run || run.path !== '.github/workflows/security-scan.yml' || run.head_branch !== tag) {
    return [refuse(check, `no Security Scan run on ${tag} was judged`)];
  }
  if (run.conclusion !== 'failure') {
    lines.push(refuse(check, `Security Scan on ${tag} ended ${run.conclusion}: a tag that is not a release name must be refused`));
  }
  const scan = (jobs ?? []).find((j) => j.name === SCAN_JOB);
  const steps = scan?.steps ?? [];
  const names = steps.find((s) => s.name === NAMES_STEP);
  if (!names) {
    lines.push(refuse(check, `the run has no step "${NAMES_STEP}"`));
  } else if (names.conclusion !== 'failure') {
    lines.push(refuse(check, `the names check ended ${names.conclusion}: the run failed somewhere else, or not at all`));
  }
  for (const s of steps.filter((x) => /pnpm install|pnpm audit|Attach SBOM/.test(x.name))) {
    if (s.conclusion !== 'skipped') lines.push(refuse(check, `"${s.name}" ended ${s.conclusion}: something ran after the names check refused`));
  }
  lines.push(...imageJobsSkipped(jobs, check));
  if (release) lines.push(refuse(check, `a release exists for ${tag}: nothing may be published under a tag that is not a release name`));
  if (lines.length === 0) {
    lines.push(
      pass(
        check,
        `Security Scan run ${run.run_number} on ${tag} failed at the names check, before the install, and made no release: ` +
          'a tag-ref dispatch, its wait and a red run are handled as the release needs',
      ),
    );
  }
  return lines;
}

/** Make the throwaway tag at C, dispatch Security Scan on it, and judge the refusal. */
export async function rehearseTag(client, { version, sha, runNumber, url, sleep, pollMs, now = () => new Date() }) {
  const name = rehearsalTagName(runNumber);
  const lines = [];
  const object = await client.send('POST', 'git/tags', {
    tag: name,
    message: `Release rehearsal for ${version}: not a release, and deleted when the rehearsal ends\n\nRelease run: ${url}\n`,
    object: sha,
    type: 'commit',
  });
  if (object.status !== 201 || !object.json?.sha) return [refuse('rehearsal-tag', `POST git/tags answered ${object.status}`)];
  const ref = await client.send('POST', 'git/refs', { ref: `refs/tags/${name}`, sha: object.json.sha });
  if (ref.status !== 201) return [refuse('rehearsal-tag', `POST git/refs for refs/tags/${name} answered ${ref.status}${ref.json?.message ? `: ${ref.json.message}` : ''}`)];
  lines.push(pass('rehearsal-tag', `the workflow token made the annotated tag ${name} at ${short(sha)} (POST git/tags, then git/refs)`));
  const since = new Date(now().getTime() - 60_000).toISOString();
  const id = await dispatchRun(client, { workflow: 'security-scan.yml', ref: name, sha, inputs: { image_scans: 'false' }, since, sleep });
  lines.push(note('rehearsal-scan', `dispatched Security Scan on the tag ${name}: ${runUrl(id)}`));
  const run = await waitForRun(client, { id, sleep, pollMs, timeoutMs: 30 * 60_000 });
  const jobs = (await client.get(`actions/runs/${id}/jobs?filter=latest&per_page=100`))?.jobs ?? [];
  const release = await client.get(`releases/tags/${enc(name)}`, { allow404: true });
  return [...lines, ...judgeRehearsal({ run, jobs, release, tag: name })];
}

/** Delete the throwaway tag, only while it still points at C. */
export async function dropRehearsalTag(client, { runNumber, sha }) {
  const name = rehearsalTagName(runNumber);
  const ref = await client.get(`git/ref/tags/${name}`, { allow404: true });
  if (!ref) return note('rehearsal-tag', `${name} is already gone`);
  const object = ref.object?.type === 'tag' ? await client.get(`git/tags/${ref.object.sha}`) : null;
  const at = object?.object?.sha ?? ref.object?.sha;
  if (at !== sha) return refuse('rehearsal-tag', `${name} points at ${short(at)}, not at ${short(sha)}: left alone`);
  const gone = await client.send('DELETE', `git/refs/tags/${name}`);
  return gone.status === 204 ? pass('rehearsal-tag', `${name} deleted`) : refuse('rehearsal-tag', `deleting ${name} answered ${gone.status}`);
}

function inputsFrom(argv) {
  const inputs = {};
  argv.forEach((a, i) => {
    if (a === '--input') {
      const [k, ...v] = argv[i + 1].split('=');
      inputs[k] = v.join('=');
    }
  });
  return inputs;
}

async function main(argv) {
  const [command] = argv;
  const client = github();
  const { VERSION: version, COMMIT: sha } = process.env;
  const done = (lines) => {
    report(lines);
    return lines.some((l) => l.kind === 'refuse') ? 1 : 0;
  };
  switch (command) {
    case 'gate': {
      const { lines, id } = await gateScan(client, { version, sha });
      if (id) output({ run: id });
      return done(lines);
    }
    case 'drop-gate':
      return done([await closeGate(client, { version, sha })]);
    case 'publish': {
      const at = argv.indexOf('--workflow');
      const workflow = argv[at + 1];
      const currentRunId = Number(process.env.GITHUB_RUN_ID) || null;
      return done(await publish(client, { workflow, ref: version, sha, inputs: inputsFrom(argv), timeoutMs: 140 * 60_000, currentRunId }));
    }
    case 'rehearse-tag': {
      const waived = readWaiver({ text: process.env.WAIVE_NIGHTS, mode: 'rehearse-tag', actor: process.env.GITHUB_ACTOR }).lines;
      if (waived.length > 0) return done(waived);
      if (process.env.GITHUB_REF !== 'refs/heads/main') {
        return done([refuse('rehearsal-tag', `dispatched from ${process.env.GITHUB_REF}: the rehearsal runs from main`)]);
      }
      const runNumber = process.env.GITHUB_RUN_NUMBER;
      return done(await rehearseTag(client, { version, sha: process.env.GITHUB_SHA, runNumber, url: runUrl(process.env.GITHUB_RUN_ID) }));
    }
    case 'drop-rehearsal-tag':
      return done([await dropRehearsalTag(client, { runNumber: process.env.GITHUB_RUN_NUMBER, sha: process.env.GITHUB_SHA })]);
    default:
      console.error('usage: node scripts/release-dispatch.mjs gate | drop-gate | publish --workflow <file> [--input k=v] | rehearse-tag | drop-rehearsal-tag');
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.log(`refuse ${process.argv[2] ?? 'dispatch'}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
