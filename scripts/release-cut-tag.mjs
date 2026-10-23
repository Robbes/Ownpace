#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TAG, CUT BY THE RELEASE WORKFLOW AND BY NOTHING ELSE IN IT (the
 * `tag` job of `.github/workflows/release.yml`; `docs/release.md` §2).
 *
 * Right before it writes, it reads again what the preflight read and the
 * approval may have waited days on:
 *
 * 1. the nights (`release-nights.mjs`), for this commit: a night that went
 *    red since, or a newer night on another commit, stops it;
 * 2. the tag: absent, it is created; annotated at the commit and made by a
 *    Release run, this is a re-run and nothing is written; anything else
 *    refuses. A tag counts as Release's only when the run its message names
 *    is, by the API's own account, a `workflow_dispatch` of
 *    `.github/workflows/release.yml` on `main` in release mode for this
 *    version: the words "Release run:" alone can be typed into `git tag -a`;
 * 3. the commit is still on `main` (`compare`: ahead or identical).
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
 * GITHUB_RUN_ID. Exit 0 when the tag is there and is this release's.
 */

import { pathToFileURL } from 'node:url';
import { github, pass, refuse, note, report, output, runUrl as urlOfRun, short } from './release-github.mjs';
import { readNights } from './release-nights.mjs';

export const RELEASE_WORKFLOW = '.github/workflows/release.yml';

/** The run id a tag's message names, or null. */
export function releaseRunId(message) {
  const m = /^Release run: \S*\/actions\/runs\/(\d+)\s*$/m.exec(message ?? '');
  return m ? Number(m[1]) : null;
}

/** The annotated tag's message: what it is, the run that made it, and what proved it. */
export function tagMessage({ version, runUrl, proof }) {
  return `Ownpace ${version}\n\nRelease run: ${runUrl}\nProved by: ${proof}\n`;
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
 * Create, reuse or refuse, from the tag ref (null when absent), its tag
 * object (for an annotated tag) and the run its message names.
 */
export function tagDecision({ ref, tagObject, commit, releaseRun, version }) {
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
  return { action: 'reuse', why: `${version} exists at C, made by Release run ${id}: a re-run carries on`, runId: id };
}

/** The tag as the API has it: its ref, its tag object, and the run its message names. */
export async function peelTag(client, version) {
  const ref = await client.get(`git/ref/tags/${version}`, { allow404: true });
  if (!ref || ref.object?.type !== 'tag') return { ref, tagObject: null, releaseRun: null };
  const tagObject = await client.get(`git/tags/${ref.object.sha}`);
  const id = releaseRunId(tagObject?.message);
  const releaseRun = id === null ? null : await client.get(`actions/runs/${id}`, { allow404: true });
  return { ref, tagObject, releaseRun };
}

/**
 * Read again, then write. `readNights` answers the nights for the commit;
 * `proof` names the preflight's and the gate's runs.
 */
export async function cutTag(client, { version, commit, runId, runUrl, proof, readNights: nights }) {
  const lines = [];
  const fresh = await nights();
  if (fresh.verdict !== 'pass') {
    lines.push(...fresh.lines.filter((l) => l.kind === 'refuse'));
    lines.push(refuse('tag', 'the nights no longer hold for C, read again just before the tag: nothing was written'));
    return lines;
  }
  lines.push(pass('nights-again', `read again before the tag: ${fresh.proof}`));

  const before = tagDecision({ commit, version, ...(await peelTag(client, version)) });
  if (before.action === 'refuse') return [...lines, refuse('tag', `${before.why}. Nothing was written.`)];
  if (before.action === 'reuse') return [...lines, pass('tag', before.why)];

  const compared = await client.get(`compare/${commit}...main`, { allow404: true });
  if (!['ahead', 'identical'].includes(compared?.status)) {
    return [...lines, refuse('tag', `C ${short(commit)} is ${compared?.status ?? 'unknown'} against main, not on it: nothing was written`)];
  }

  const message = tagMessage({ version, runUrl, proof: [proof, fresh.proof].filter(Boolean).join('; ') });
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

  const after = tagDecision({ commit, version, ...(await peelTag(client, version)) });
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
  const client = github();
  const lines = await cutTag(client, {
    version,
    commit,
    runId,
    runUrl: urlOfRun(runId),
    proof: [proof, gate ? `gate scan ${urlOfRun(gate)}` : ''].filter(Boolean).join('; '),
    readNights: () => readNights(client, { commit }),
  });
  report(lines);
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
