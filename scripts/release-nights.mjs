#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE NIGHTS A RELEASE TAG WAITS FOR, READ FROM THE RECORD (workplan 0141
 * T14, the owner's rule as decided on 2026-09-27 and read strictly on
 * 2026-10-23).
 *
 * A commit C may be tagged only when:
 *
 * - **The managed gate.** The newest two completed scheduled runs of
 *   `e2e-managed.yml` on `main` both ran C, and both are green on every
 *   attempt. A run still queued or running at the top is named and passed
 *   over; a dispatched run is not a night. A failed or cancelled night, or a
 *   failed earlier attempt of a run the list shows green, resets the count.
 * - **No night is missing.** The newer counted run is at most 30 hours old,
 *   and at most 30 hours lie between the two. GitHub starts these schedules
 *   hours late and sometimes drops one.
 * - **The appliance nightly** (`e2e.yml`, two schedules a night). Between C
 *   reaching `main` (or the managed run before the two counted ones, if that
 *   is later) and the newer counted managed run, the newest four completed
 *   scheduled runs each ran C and are green on every attempt. A failed
 *   scheduled appliance run on C after them resets the count too.
 *
 * The live-target lane (`e2e-live-target.yml`) joins the rule when 0141 T13
 * arms it; it is the commented line in COUNTED.
 *
 * Usage (read-only; GH_TOKEN optional on this public repository):
 *
 *   node scripts/release-nights.mjs --commit <sha>
 *   node scripts/release-nights.mjs --pick
 *
 * `--pick` evaluates the commit the newer managed night ran and prints it
 * when the rule holds for it. Exit 0 when the rule holds, 1 when it does not.
 */

import { pathToFileURL } from 'node:url';
import { github, pass, refuse, note, report, short } from './release-github.mjs';

export const NIGHTS = 2;
export const APPLIANCE_RUNS = 4;
export const MAX_GAP_HOURS = 30;

export const COUNTED = {
  managed: { workflow: 'e2e-managed.yml', name: 'E2E (managed)' },
  appliance: { workflow: 'e2e.yml', name: 'E2E (self-hosted)' },
  // liveTarget: { workflow: 'e2e-live-target.yml', name: 'E2E (live target)' }, // when 0141 T13 arms it
};

const HOUR = 3_600_000;
const time = (t) => new Date(t).getTime();
const newestFirst = (runs) => [...runs].sort((a, b) => time(b.created_at) - time(a.created_at));

/** Scheduled runs on main created no later than `now`, newest first. */
function scheduled(runs, now) {
  return newestFirst(runs.filter((r) => r.event === 'schedule' && r.head_branch === 'main' && time(r.created_at) <= time(now)));
}

/**
 * The commit the newer of the two newest completed scheduled managed nights
 * ran, or null when there are not two. Whether the rule holds for it is
 * `countNights`'s question.
 */
export function pickCommit(managedRuns, now = new Date()) {
  const completed = scheduled(managedRuns, now).filter((r) => r.status === 'completed');
  return completed.length >= NIGHTS ? completed[0].head_sha : null;
}

/** Why one run does not count, or null when it does. */
function runProblem(run, name, commit, attempts) {
  if (run.status !== 'completed') return `${name} #${run.run_number} is ${run.status}: a night counts once it has finished`;
  if (run.conclusion !== 'success') {
    return `${name} #${run.run_number} ended ${run.conclusion}: a failed or cancelled scheduled run resets the count`;
  }
  if (run.head_sha !== commit) {
    return `${name} #${run.run_number} ran ${short(run.head_sha)}, not C ${short(commit)}: every counted run must run C`;
  }
  for (let n = 1; n < (run.run_attempt ?? 1); n += 1) {
    const earlier = (attempts[String(run.id)] ?? []).find((a) => a.run_attempt === n);
    if (!earlier) {
      return `${name} #${run.run_number}'s attempt ${n} was not read, and the list shows only the last attempt`;
    }
    if (earlier.conclusion !== 'success') {
      return `${name} #${run.run_number}'s attempt ${n} ended ${earlier.conclusion}: a run with a failed attempt does not count, though the list shows it green`;
    }
  }
  return null;
}

/**
 * The rule, for commit C. `attempts` maps a run id to the earlier attempts
 * of that run; `mergedAt` is when C reached main.
 */
export function countNights({ managedRuns, applianceRuns, attempts = {}, commit, mergedAt, now = new Date() }) {
  const lines = [];
  const { managed: M, appliance: A } = COUNTED;
  const all = scheduled(managedRuns, now);
  const completed = all.filter((r) => r.status === 'completed');
  for (const r of all) {
    if (r.status !== 'completed' && (completed.length === 0 || time(r.created_at) > time(completed[0].created_at))) {
      lines.push(note('nights', `${M.name} #${r.run_number} is ${r.status}: not counted until it completes`));
    }
  }

  const counted = completed.slice(0, NIGHTS);
  let appliance = [];
  if (counted.length < NIGHTS) {
    lines.push(refuse('nights', `only ${counted.length} completed scheduled ${M.name} run(s) on main: ${NIGHTS} nights are needed`));
  } else {
    for (const run of counted) {
      const problem = runProblem(run, M.name, commit, attempts);
      if (problem) lines.push(refuse('nights', problem));
    }
    const newest = counted[0];
    const age = Math.floor((time(now) - time(newest.created_at)) / HOUR);
    if (time(now) - time(newest.created_at) > MAX_GAP_HOURS * HOUR) {
      lines.push(refuse('nights', `${M.name} #${newest.run_number} is ${age} hours old: a night is missing since it`));
    }
    for (let i = 0; i + 1 < counted.length; i += 1) {
      if (time(counted[i].created_at) - time(counted[i + 1].created_at) > MAX_GAP_HOURS * HOUR) {
        lines.push(
          refuse('nights', `a night is missing between #${counted[i + 1].run_number} and #${counted[i].run_number}: more than ${MAX_GAP_HOURS} hours apart`),
        );
      }
    }

    // The appliance runs of the counted nights.
    const before = completed[NIGHTS];
    const start = Math.max(time(mergedAt), before ? time(before.created_at) : -Infinity);
    const end = time(newest.created_at);
    const apps = scheduled(applianceRuns, now);
    const within = apps.filter((r) => time(r.created_at) > start && time(r.created_at) < end);
    const done = within.filter((r) => r.status === 'completed');
    appliance = done.slice(0, APPLIANCE_RUNS);
    if (Number.isNaN(start) || mergedAt === undefined || mergedAt === null) {
      lines.push(refuse('nights', 'when C reached main was not read, so the appliance runs of its nights cannot be told apart'));
    } else if (time(mergedAt) >= end) {
      lines.push(refuse('nights', `C reached main after ${M.name} #${newest.run_number}: no counted night has run it yet`));
    } else if (appliance.length < APPLIANCE_RUNS) {
      lines.push(
        refuse(
          'nights',
          `only ${appliance.length} scheduled ${A.name} runs completed between C reaching main and ${M.name} #${newest.run_number}: ` +
            `${APPLIANCE_RUNS} are needed, two a night`,
        ),
      );
    }
    for (const r of within.filter((x) => x.status !== 'completed')) {
      lines.push(refuse('nights', `${A.name} #${r.run_number}, inside the counted nights, is ${r.status}`));
    }
    for (const run of appliance) {
      const problem = runProblem(run, A.name, commit, attempts);
      if (problem) lines.push(refuse('nights', problem));
    }
    // A red scheduled appliance run on C after the counted nights resets the count.
    for (const r of apps.filter((x) => time(x.created_at) >= end && x.status === 'completed')) {
      if (r.head_sha === commit && r.conclusion !== 'success') {
        lines.push(refuse('nights', `${A.name} #${r.run_number} ended ${r.conclusion} on C after the counted nights: a failed scheduled run resets the count`));
      } else if (r.head_sha !== commit) {
        lines.push(note('nights', `${A.name} #${r.run_number} ran ${short(r.head_sha)}: main has moved past C since the counted nights`));
      }
    }
  }

  const proof =
    `${M.name} ${[...counted].reverse().map((r) => `#${r.run_number}`).join(' ')}; ` +
    `${A.name} ${[...appliance].reverse().map((r) => `#${r.run_number}`).join(' ')}`;
  const refused = lines.some((l) => l.kind === 'refuse');
  if (!refused) {
    lines.push(
      pass(
        'nights',
        `${proof}: green on C ${short(commit)}, every attempt, no night missing (0141 T14)`,
      ),
    );
  }
  return { verdict: refused ? 'refuse' : 'pass', lines, managed: counted, appliance, proof };
}

/** Every run's earlier attempts, for the runs that have them. */
async function earlierAttempts(client, runs) {
  const attempts = {};
  for (const run of runs) {
    for (let n = 1; n < (run.run_attempt ?? 1); n += 1) {
      const a = await client.get(`actions/runs/${run.id}/attempts/${n}`, { allow404: true });
      if (a) (attempts[String(run.id)] ??= []).push(a);
    }
  }
  return attempts;
}

/** When a commit reached main: its committer date, which GitHub sets when it merges. */
export async function mergedAtOf(client, commit) {
  const c = await client.get(`commits/${commit}`, { allow404: true });
  return c?.commit?.committer?.date ?? null;
}

/**
 * The rule read from the API, for `commit`, or for the commit the nights
 * pick when `commit` is null. `commit` in the answer is the one evaluated.
 */
export async function readNights(client, { commit = null, now = new Date() } = {}) {
  const runs = async (workflow, perPage) =>
    (await client.get(`actions/workflows/${workflow}/runs?event=schedule&branch=main&per_page=${perPage}`)).workflow_runs ?? [];
  const managedRuns = await runs(COUNTED.managed.workflow, 30);
  const applianceRuns = await runs(COUNTED.appliance.workflow, 40);
  const candidate = commit ?? pickCommit(managedRuns, now);
  if (!candidate) {
    return {
      commit: null,
      verdict: 'refuse',
      lines: [refuse('nights', `no two completed scheduled ${COUNTED.managed.name} runs on main to pick a commit from`)],
      managed: [],
      appliance: [],
      proof: '',
    };
  }
  const attempts = await earlierAttempts(
    client,
    [...managedRuns, ...applianceRuns].filter((r) => (r.run_attempt ?? 1) > 1),
  );
  const mergedAt = await mergedAtOf(client, candidate);
  return { commit: candidate, ...countNights({ managedRuns, applianceRuns, attempts, commit: candidate, mergedAt, now }) };
}

async function main(argv) {
  const at = argv.indexOf('--commit');
  const commit = at >= 0 ? argv[at + 1] : null;
  if (!commit && !argv.includes('--pick')) {
    console.error('usage: node scripts/release-nights.mjs --commit <sha> | --pick');
    return 2;
  }
  const verdict = await readNights(github(), { commit });
  report(verdict.lines);
  if (argv.includes('--pick') && verdict.verdict === 'pass') console.log(`picked ${verdict.commit}`);
  return verdict.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.log(`refuse nights: the record could not be read: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
