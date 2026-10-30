#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TAG, CUT BY THE RELEASE WORKFLOW AND BY NOTHING ELSE IN IT (the
 * `tag` job of `.github/workflows/release.yml`; `docs/release.md` §2).
 *
 * Right before it writes, it reads again what the preflight read and the
 * approval may have waited days on, in this order:
 *
 * 1. the tag: annotated at the commit and made by a Release run, this is a
 *    re-run, nothing is written and nothing else is read (a tag job re-run
 *    after its tag was made carries on, whatever nights ran since); absent,
 *    it goes on to be made; anything else refuses. A tag counts as Release's
 *    only when the run its message names is, by the API's own account, a
 *    `workflow_dispatch` of `.github/workflows/release.yml` on `main` in
 *    release mode for this version, and that run's `tag` job ran to success
 *    (or is running, in this very run): the words "Release run:" alone can
 *    be typed into `git tag -a`, and can name a run that stopped at its
 *    preflight;
 * 2. the nights (`release-nights.mjs`), for this commit, only when the tag
 *    is to be made: a night that went red since, or a newer night on another
 *    commit, stops it, unless the owner waived the nights (`WAIVE_NIGHTS`,
 *    `readWaiver`) and the preflight used the waiver (`PREFLIGHT_WAIVED`, its
 *    output `waived`): nights that held there are read here as in a run
 *    without one. Under the waiver their refusals are notes, the first
 *    quoting it, and the tag's message has a line of its own saying the
 *    nights were waived, by whom and in what words, the words a JSON string.
 *    Nothing else is waived;
 * 3. the commit is still on `main` (`compare`: ahead or identical);
 * 4. the tag, peeled again, right before the write.
 *
 * Then two calls: `POST git/tags` (an annotated tag object, `type: commit`,
 * its message naming the run and what proved it) and `POST git/refs`
 * (`refs/tags/<version>`). A 422 on the second means the ref appeared in
 * between; it is peeled again and passes only as Release's tag at this
 * commit. A tag ref is never moved. Last, it reads the tag back: annotated,
 * on origin, `v` plus the version, at the commit, which is what
 * `deploy/compose/release-tag.sh` requires before live runs a tag.
 *
 * Environment: GH_TOKEN (contents: write, actions: read), VERSION, COMMIT,
 * PROOF (the preflight's runs), GATE_RUN (the gate scan's run id),
 * GITHUB_RUN_ID, and WAIVE_NIGHTS with GITHUB_ACTOR (the owner's waiver; empty
 * is none) and PREFLIGHT_WAIVED ('true' when the preflight used it). Exit 0
 * when the tag is there and is this release's. With a waiver, the job's
 * summary lists what it did.
 * (The review of 2026-10-23 put the peel before the nights, and added the
 * tag job to what makes a tag Release's.)
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { github, pass, refuse, note, report, output, runUrl as urlOfRun, short } from './release-github.mjs';
import { readNights, readWaiver, waiveNights, waiverProblems } from './release-nights.mjs';

export const RELEASE_WORKFLOW = '.github/workflows/release.yml';
/** The job of release.yml that writes the tag, by its name. */
export const TAG_JOB = 'tag';

/** The run id a tag's message names, or null. */
export function releaseRunId(message) {
  const m = /^Release run: \S*\/actions\/runs\/(\d+)\s*$/m.exec(message ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * The annotated tag's message: what it is, the run that made it, what proved
 * it, and, when the nights were waived, a line that says so, the owner's
 * words as a JSON string, so a `"` in them cannot end the quote. A waiver
 * that could add a line of its own (a forged "Release run:") is never written.
 */
export function tagMessage({ version, runUrl, proof, waiver = null }) {
  if (waiver && (waiverProblems(waiver.reason).length > 0 || /\s/.test(waiver.actor))) {
    throw new Error('the waiver is not fit for the tag’s message');
  }
  const waived = waiver ? `Nights waived by ${waiver.actor}, in their words: ${JSON.stringify(waiver.reason)}\n` : '';
  return `Ownpace ${version}\n\nRelease run: ${runUrl}\nProved by: ${proof}\n${waived}`;
}

/** The tag job's summary, written when the run carries a waiver: what it did, line by line. */
export function tagSummary({ version, commit, lines }) {
  const ok = !lines.some((l) => l.kind === 'refuse');
  return [`### Release tag ${version} on ${short(commit)}: ${ok ? 'there' : 'not cut'}`, '', ...lines.map((l) => `- **${l.kind}** ${l.check}: ${l.sentence}`), ''].join('\n');
}

/** Whether the API's account of a run makes it a release-mode Release run for this version. */
export function isReleaseRun(run, version) {
  return Boolean(
    run &&
      run.path === RELEASE_WORKFLOW &&
      run.head_branch === 'main' &&
      run.event === 'workflow_dispatch' &&
      run.display_title === `Release ${version} (release)`,
  );
}

/**
 * Whether the named run's `tag` job made the tag: it succeeded in some
 * attempt of that run, or this is that run and its tag job is running now
 * (the tag job reading back the tag it just made).
 */
export function madeByItsTagJob(jobs, { id, currentRunId }) {
  const tagJobs = (jobs ?? []).filter((j) => j.name === TAG_JOB);
  if (tagJobs.some((j) => j.conclusion === 'success')) return true;
  return id === currentRunId && tagJobs.some((j) => j.status === 'in_progress');
}

/**
 * Create, reuse or refuse, from the tag ref (null when absent), its tag
 * object (for an annotated tag), the run its message names, that run's jobs
 * in every attempt, and this run's id.
 */
export function tagDecision({ ref, tagObject, commit, releaseRun, releaseJobs = null, currentRunId = null, version }) {
  if (!ref) return { action: 'create', why: `${version} is free` };
  if (ref.object?.type !== 'tag') {
    return { action: 'refuse', why: `${version} exists as a lightweight tag at ${short(ref.object?.sha)}: a release tag is annotated` };
  }
  const at = tagObject?.object?.sha;
  if (at !== commit) {
    return { action: 'refuse', why: `${version} exists at ${short(at)}, not at C ${short(commit)}: a tag is never moved` };
  }
  const id = releaseRunId(tagObject?.message);
  if (id === null) {
    return { action: 'refuse', why: `${version} exists at C, and its message names no Release run: it was not made by this workflow` };
  }
  if (!isReleaseRun(releaseRun, version)) {
    return {
      action: 'refuse',
      why:
        `${version} exists at C, and run ${id}, which its message names, is not a release-mode dispatch of ` +
        `${RELEASE_WORKFLOW} on main for it`,
    };
  }
  if (!madeByItsTagJob(releaseJobs, { id, currentRunId })) {
    return {
      action: 'refuse',
      why:
        `${version} exists at C, and Release run ${id}, which its message names, never ran its ${TAG_JOB} job to success: ` +
        'a tag pushed by hand can name a Release run. If that run’s tag job failed after it made the tag, re-run that run’s failed jobs',
    };
  }
  return { action: 'reuse', why: `${version} exists at C, made by Release run ${id}: a re-run carries on`, runId: id };
}

/**
 * The tag as the API has it: its ref, its tag object, the run its message
 * names, and that run's jobs in every attempt (`filter=all`).
 */
export async function peelTag(client, version, { currentRunId = Number(process.env.GITHUB_RUN_ID) || null } = {}) {
  const ref = await client.get(`git/ref/tags/${version}`, { allow404: true });
  if (!ref || ref.object?.type !== 'tag') return { ref, tagObject: null, releaseRun: null, releaseJobs: null, currentRunId };
  const tagObject = await client.get(`git/tags/${ref.object.sha}`);
  const id = releaseRunId(tagObject?.message);
  const releaseRun = id === null ? null : await client.get(`actions/runs/${id}`, { allow404: true });
  const releaseJobs = releaseRun ? ((await client.get(`actions/runs/${id}/jobs?filter=all&per_page=100`, { allow404: true }))?.jobs ?? []) : null;
  return { ref, tagObject, releaseRun, releaseJobs, currentRunId };
}

/**
 * Read again, then write. `readNights` answers the nights for the commit;
 * `proof` names the preflight's and the gate's runs; `waiver` is the owner's,
 * or null; `waivedAtPreflight` is whether the preflight used it. The waiver
 * is used here only when it was there: the approver read that summary.
 */
export async function cutTag(client, { version, commit, runId, runUrl, proof, readNights: nights, waiver = null, waivedAtPreflight = false }) {
  const lines = [];
  const decide = async () => tagDecision({ commit, version, ...(await peelTag(client, version, { currentRunId: runId })) });
  // Peeled first: a re-run over Release's own tag carries on, whatever ran since.
  const first = await decide();
  if (first.action === 'refuse') return [refuse('tag', `${first.why}. Nothing was written.`)];
  if (first.action === 'reuse') return [pass('tag', first.why)];

  const used = waiver && waivedAtPreflight ? waiver : null;
  if (waiver && !used) {
    lines.push(note('waiver', 'the nights held at the preflight, so the waiver was not used there, and it is not used here: the nights are read as in a run without one'));
  }
  const fresh = waiveNights(await nights(), used);
  if (fresh.verdict === 'waived') {
    lines.push(...fresh.lines);
  } else if (fresh.verdict !== 'pass') {
    lines.push(...fresh.lines.filter((l) => l.kind === 'refuse'));
    lines.push(refuse('tag', 'the nights no longer hold for C, read again just before the tag: nothing was written'));
    return lines;
  } else {
    lines.push(pass('nights-again', `read again before the tag: ${fresh.proof}`));
    if (used) lines.push(note('waiver', 'the nights hold, read again before the tag, so the waiver was not used'));
  }

  const compared = await client.get(`compare/${commit}...main`, { allow404: true });
  if (!['ahead', 'identical'].includes(compared?.status)) {
    return [...lines, refuse('tag', `C ${short(commit)} is ${compared?.status ?? 'unknown'} against main, not on it: nothing was written`)];
  }

  // Peeled again, right before the write.
  const before = await decide();
  if (before.action === 'refuse') return [...lines, refuse('tag', `${before.why}. Nothing was written.`)];
  if (before.action === 'reuse') return [...lines, pass('tag', before.why)];

  const message = tagMessage({ version, runUrl, proof: [proof, fresh.proof].filter(Boolean).join('; '), waiver: fresh.waived ? used : null });
  const object = await client.send('POST', 'git/tags', { tag: version, message, object: commit, type: 'commit' });
  if (object.status !== 201 || !object.json?.sha) {
    return [...lines, refuse('tag', `POST git/tags answered ${object.status}${object.json?.message ? `: ${object.json.message}` : ''}`)];
  }
  const made = await client.send('POST', 'git/refs', { ref: `refs/tags/${version}`, sha: object.json.sha });
  if (made.status === 422) {
    lines.push(note('tag', `refs/tags/${version} appeared between the two calls (422); peeling it again`));
  } else if (made.status !== 201) {
    return [
      ...lines,
      refuse(
        'tag',
        `POST git/refs answered ${made.status}: whether the ref exists is unknown, so a re-run of this job peels it before anything else`,
      ),
    ];
  }

  const after = await decide();
  if (after.action !== 'reuse') {
    return [...lines, refuse('tag', `read back, ${after.why}`)];
  }
  if (made.status === 201 && after.runId !== runId) {
    return [...lines, refuse('tag', `read back, ${version} names run ${after.runId}, not this run ${runId}`)];
  }
  lines.push(pass('tag', `${version} is an annotated tag on origin at C ${short(commit)}, made by Release run ${after.runId}`));
  return lines;
}

async function main() {
  const { VERSION: version, COMMIT: commit, PROOF: proof = '', GATE_RUN: gate = '' } = process.env;
  const runId = Number(process.env.GITHUB_RUN_ID);
  // The tag job runs in release mode only. A waiver the preflight would have
  // refused is refused here too, before anything is read or written. This
  // job's env comes from the input, not from anything C's code could touch.
  const { waiver, lines: said } = readWaiver({ text: process.env.WAIVE_NIGHTS, mode: 'release', actor: process.env.GITHUB_ACTOR, version });
  if (said.some((l) => l.kind === 'refuse')) {
    report(said);
    return 1;
  }
  const client = github();
  const lines = await cutTag(client, {
    version,
    commit,
    runId,
    runUrl: urlOfRun(runId),
    proof: [proof, gate ? `gate scan ${urlOfRun(gate)}` : ''].filter(Boolean).join('; '),
    readNights: () => readNights(client, { commit }),
    waiver,
    waivedAtPreflight: process.env.PREFLIGHT_WAIVED === 'true',
  });
  report(lines);
  if (waiver && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, tagSummary({ version, commit, lines }));
  const ok = !lines.some((l) => l.kind === 'refuse');
  if (ok) output({ tag: version });
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => (process.exitCode = code),
    (err) => {
      console.log(`refuse tag: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
