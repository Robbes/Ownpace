#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE RELEASE PREFLIGHT: everything that can be read before a tag, read, and
 * nothing written (the `preflight` job of `.github/workflows/release.yml`;
 * `docs/release.md` §1).
 *
 * Every check prints one line, `pass`, `refuse` or `note`, and all of them
 * are printed, so the owner sees every reason at once. The steps, in the
 * order the job runs them:
 *
 *   resolve   the inputs; dispatched from main; the commit C (the input, or
 *             the one the nights pick, or the tag's in verify mode); the
 *             release before; and C on main's first-parent line, by
 *             `git merge-base`, before any worktree is made
 *   names     with C checked out in `candidate/`, in a step of its own with
 *             no token in it: the candidate's own names check. Its parent
 *             process is this script, and a process can read its parent's
 *             environment, so the token is kept out of the step and not only
 *             out of the spawn (the review of 2026-10-23)
 *   check     the tag free (or Release's own at C), no branch named like it,
 *             the API contract's version, the changelog folded, CI's and
 *             Security Scan's push runs on C, the nights; and notes: the
 *             approval, the open code-scanning alerts on main by tool and
 *             category, main after C, the release before, what this does not
 *             check
 *   callees   after the install: the workflows Release dispatches, read with
 *             the candidate's own YAML parser, take the inputs it passes
 *   verdict   counts; refuses a check that never ran and a step that ended
 *             in an error; writes the step summary
 *
 * In release and preflight mode any refusal makes the run red. In rehearse
 * mode the record's refusals are carried to the end of the run
 * (`rehearsal-verdict`), which then says the real run would have stopped
 * here; a refusal of the resolve step is not carried, it ends the run there.
 * The gate scan makes a branch at C and runs C's own security-scan.yml with a
 * write token, so it runs only on a commit the resolve step found on main's
 * first-parent line (the review of 2026-10-23).
 *
 * THE OWNER'S WAIVER of the nights (`WAIVE_NIGHTS`, the workflow's
 * `waive_nights` input; the owner, 2026-10-30, for alpha.3). The resolve step
 * reads it (`readWaiver` in `release-nights.mjs`): set in verify mode, unfit
 * for the record, or with no actor to name, it is a refusal that ends the run
 * there, a rehearsal included. Taken, the commit must be given, since there
 * are no nights to pick one; the check step turns the nights' refusals into
 * notes that quote it; and the verdict's summary says, under its title, that
 * the nights are waived, by whom and in what words. Every other check refuses
 * as it does without it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { github, pass, refuse, note, report, output, short, getAll, slimAlert } from './release-github.mjs';
import { parseSemVer, compareSemVer } from './release-names-agree.mjs';
import { readNights, readWaiver, waiveNights } from './release-nights.mjs';
import { tagDecision, peelTag } from './release-cut-tag.mjs';
import { withoutTokens } from './release-upgrade-gates.mjs';
import { checkRelease } from './release-verify.mjs';
import { gateBranch } from './release-dispatch.mjs';

export const MODES = ['preflight', 'rehearse', 'rehearse-tag', 'release', 'verify'];
export const REQUIRED_CI_JOBS = ['lint', 'unit-tests (all)', 'ui-tests', 'integration-tests (self-hosted)', 'ci-complete'];
export const EXPECTED_CHECKS = {
  full: [
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
  ],
  verify: ['inputs', 'dispatched-from-main', 'tag-exists'],
};
/**
 * The resolve step's checks, and the two steps that must work for C to be
 * checked out: they say which commit this is, and whether there is one. A
 * rehearsal carries every other refusal to its end; one of these ends it at
 * the preflight, before the gate scan makes a branch at the commit.
 */
export const RESOLVE_CHECKS = ['inputs', 'waiver', 'dispatched-from-main', 'commit', 'previous-release', 'candidate-on-main', 'step-resolve', 'step-worktree'];
/** The changelog section's date: the day the fold merged, in the owner's zone. */
export const FOLD_WINDOW = { daysBefore: 7, daysAfter: 1 };

const bare = (version) => version.replace(/^v/, '');
const DAY = 86_400_000;
const utcDay = (d) => new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// The checks, pure
// ---------------------------------------------------------------------------

export function validateInputs({ version, commit, mode }) {
  const lines = [];
  if (typeof version !== 'string' || !version.startsWith('v') || parseSemVer(version.slice(1)) === null) {
    lines.push(refuse('inputs', `version ${JSON.stringify(version)} is not v and a SemVer version, such as v0.2.0-alpha.2`));
  }
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) {
    lines.push(refuse('inputs', `commit ${JSON.stringify(commit)} is not a full 40-character commit: leave it empty for the commit the nights pick`));
  }
  if (!MODES.includes(mode)) lines.push(refuse('inputs', `mode ${JSON.stringify(mode)} is not one of ${MODES.join(', ')}`));
  return lines.length > 0 ? lines : [pass('inputs', `${version}, ${commit ? `commit ${short(commit)}` : 'the commit the nights pick'}, mode ${mode}`)];
}

/** From main, as main has it: a guard against accidents, not a boundary (docs/release.md §2). */
export function dispatchedFromMain({ ref, workflowRef, repository }) {
  const want = `${repository}/.github/workflows/release.yml@refs/heads/main`;
  return ref === 'refs/heads/main' && workflowRef === want
    ? pass('dispatched-from-main', 'dispatched from main, running main’s copy of release.yml')
    : refuse('dispatched-from-main', `dispatched from ${ref} (${workflowRef}): Release runs from main`);
}

/** The highest release tag below `version`, by SemVer, or null. */
export function previousTag(tags, version) {
  const below = tags
    .map((t) => t.trim())
    .filter((t) => t.startsWith('v') && parseSemVer(t.slice(1)) !== null && compareSemVer(t.slice(1), bare(version)) < 0)
    .sort((a, b) => compareSemVer(b.slice(1), a.slice(1)));
  return below[0] ?? null;
}

export function candidateOnMain({ commit, isAncestor, firstParent }) {
  if (!isAncestor) return refuse('candidate-on-main', `C ${short(commit)} is not on main`);
  if (!firstParent) {
    return refuse('candidate-on-main', `C ${short(commit)} is in main’s history only through a merged branch: a release is cut from a commit main itself was at`);
  }
  return pass('candidate-on-main', `C ${short(commit)} is on main’s first-parent line`);
}

/** `[Unreleased]` empty, and the version's section dated within the window. */
export function changelogFolded(changelog, version, today) {
  const lines = [];
  const text = changelog ?? '';
  const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/m.exec(text);
  if (!unreleased) {
    lines.push(refuse('changelog-folded', 'CHANGELOG.md has no [Unreleased] heading: the fold starts a fresh, empty one'));
  } else {
    const entries = unreleased[1].split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#') && !l.trim().startsWith('<!--'));
    if (entries.length > 0) {
      lines.push(
        refuse(
          'changelog-folded',
          `[Unreleased] still holds ${entries.length} lines: fold them into ## [${bare(version)}] in the pull request that merges last before the nights`,
        ),
      );
    }
  }
  const heading = new RegExp(`^## \\[${bare(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\](?: - (\\d{4}-\\d{2}-\\d{2}))?`, 'm').exec(text);
  if (!heading) {
    lines.push(refuse('changelog-folded', `CHANGELOG.md has no section for ${bare(version)}`));
  } else if (!heading[1]) {
    lines.push(refuse('changelog-folded', `the section for ${bare(version)} has no date`));
  } else {
    const days = Math.round((new Date(`${utcDay(today)}T00:00:00Z`).getTime() - new Date(`${heading[1]}T00:00:00Z`).getTime()) / DAY);
    if (days > FOLD_WINDOW.daysBefore) {
      lines.push(
        refuse(
          'changelog-folded',
          `the section for ${bare(version)} is dated ${heading[1]}, ${days} days before this run: it is dated the day the fold merges, which is before the two nights`,
        ),
      );
    } else if (days < -FOLD_WINDOW.daysAfter) {
      lines.push(refuse('changelog-folded', `the section for ${bare(version)} is dated ${heading[1]}, ${-days} days after this run`));
    } else if (lines.length === 0) {
      lines.push(pass('changelog-folded', `[Unreleased] is empty, and ${bare(version)} is dated ${heading[1]}`));
    }
  }
  return lines;
}

/** The API contract's `info.version` is the version. */
export function openapiAgrees(openapi, version) {
  const info = /^info:\s*\n((?:[ \t]+[^\n]*\n|\s*\n)*)/m.exec(openapi ?? '');
  const said = info ? /^[ \t]+version:\s*['"]?([^'"\s]+)/m.exec(info[1])?.[1] : undefined;
  return said === bare(version)
    ? pass('openapi-agrees', `apps/api/docs/openapi.yaml's info.version is ${said}`)
    : refuse('openapi-agrees', `apps/api/docs/openapi.yaml's info.version is ${said ?? 'missing'}, not ${bare(version)}`);
}

/** C's own push run of CI on main, with the suite actually run (owner decision 6). */
export function ciGreen(run, jobs, commit) {
  if (!run) return refuse('ci-green', `no CI push run on main for C ${short(commit)}`);
  const name = `CI run #${run.run_number} on main`;
  if (run.head_sha !== commit) return refuse('ci-green', `${name} ran ${short(run.head_sha)}, not C ${short(commit)}`);
  if (run.status !== 'completed') return refuse('ci-green', `${name} is ${run.status}`);
  if (run.conclusion !== 'success') return refuse('ci-green', `${name} ended ${run.conclusion}`);
  const problems = [];
  for (const job of REQUIRED_CI_JOBS) {
    const found = (jobs ?? []).find((j) => j.name === job);
    if (!found) problems.push(`${job} did not run`);
    else if (found.conclusion === 'skipped') problems.push(`${job} was skipped`);
    else if (found.conclusion !== 'success') problems.push(`${job} ended ${found.conclusion}`);
  }
  return problems.length === 0
    ? pass('ci-green', `${name}: ${REQUIRED_CI_JOBS.join(', ')} ran and passed on C`)
    : refuse('ci-green', `${name} is green, and ${problems.join('; ')}: the merge before the nights must be one that runs the suite`);
}

export function scanGreenOnMain(run, commit) {
  if (!run) return refuse('scan-green-on-main', `no Security Scan push run on main for C ${short(commit)}`);
  const name = `Security Scan run #${run.run_number} on main`;
  if (run.head_sha !== commit) return refuse('scan-green-on-main', `${name} ran ${short(run.head_sha)}, not C`);
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    return refuse('scan-green-on-main', `${name} is ${run.status === 'completed' ? `red (${run.conclusion})` : run.status}`);
  }
  return pass('scan-green-on-main', `${name} is green on C (the gate scan runs again minutes before the tag)`);
}

/** The tag's name, from `tagDecision`. */
export function tagFree(decision) {
  return decision.action === 'refuse' ? refuse('tag-free', decision.why) : pass('tag-free', decision.why);
}

/** No branch named like the tag, and no gate branch at another commit. */
export function refUnambiguous({ version, commit, branch, gate }) {
  const lines = [];
  if (branch) lines.push(refuse('ref-unambiguous', `a branch named ${version} exists: a dispatch on ${version} would not name the tag alone`));
  if (gate && gate.object?.sha !== commit) {
    lines.push(refuse('ref-unambiguous', `${gateBranch(version)} exists at ${short(gate.object?.sha)}, not at C: delete it by hand if it is a leftover`));
  }
  if (lines.length > 0) return lines;
  return [pass('ref-unambiguous', `no branch is named ${version}${gate ? `, and ${gateBranch(version)} is at C from an earlier run` : ''}`)];
}

/** The workflows Release dispatches, as the candidate has them, take what it passes. */
export function calleesDispatchable(workflows) {
  const on = (file) => workflows[file]?.on ?? {};
  const dispatch = (file) => on(file).workflow_dispatch;
  const lines = [];
  const scans = dispatch('security-scan.yml')?.inputs?.image_scans;
  lines.push(
    scans?.type === 'boolean'
      ? pass('callees-dispatchable', 'security-scan.yml takes the boolean image_scans')
      : refuse('callees-dispatchable', 'security-scan.yml at C has no boolean image_scans input: Release’s dispatches of it would be refused (422)'),
  );
  lines.push(
    'workflow_dispatch' in on('images.yml')
      ? pass('callees-dispatchable', 'images.yml can be dispatched')
      : refuse('callees-dispatchable', 'images.yml at C has no workflow_dispatch trigger'),
  );
  const platforms = dispatch('windows-payload.yml')?.inputs?.platform?.options ?? [];
  lines.push(
    platforms.includes('win-x64')
      ? pass('callees-dispatchable', 'windows-payload.yml offers platform win-x64')
      : refuse('callees-dispatchable', 'windows-payload.yml at C does not offer platform win-x64'),
  );
  return lines;
}

/** Whether the approval will wait for a click. Never a refusal: the owner sets it up (docs/release.md). */
export function approvalNote(environment, readable = true) {
  if (!readable) return note('approval', 'the release environment could not be read with this token; check its reviewers in the repository settings');
  if (!environment) {
    return note(
      'approval',
      'the release environment does not exist yet: the approve job would create it with no reviewer and pass without a click. Create it first, with yourself as reviewer',
    );
  }
  const reviewers = (environment.protection_rules ?? []).find((r) => r.type === 'required_reviewers');
  return reviewers && (reviewers.reviewers ?? []).length > 0
    ? note('approval', 'the release environment asks a reviewer: the approve job waits for that click, the recorded say-so')
    : note('approval', 'the release environment has no required reviewer: the approve job passes without a click, and the dispatch is then the only say-so');
}

/**
 * Open code-scanning alerts on main, reported and never refused (the owner's
 * decision 11 of 2026-10-23): the pull request's `Trivy` check blocks new
 * ones, and the advisory gate is what refuses a tag.
 *
 * Read whole, a page of 100 at a time (the first run's "100 high" was one
 * page), and printed as a total and then one note per tool and analysis
 * category: the repository's filesystem scan, and each image of the weekly
 * image scan, which uploads one category per image, `trivy-image-<name>`
 * (`scripts/image-scan.mjs` says how the names are made). Each note names the
 * group's most alerted rule ids, critical first. Only the fields
 * `slimAlert` keeps are read, and every string from the API is printed as
 * one line with no `@`.
 */
export const ALERT_SEVERITIES = ['critical', 'high'];
/** How many rule ids one group's note names. */
export const TOP_RULES = 5;
/** The category of security-scan.yml's repository scan, whose upload names none of its own. */
export const REPOSITORY_SCAN_CATEGORY = '.github/workflows/security-scan.yml:security-scan';
const IMAGE_CATEGORY = /^trivy-image-(.+)$/;

/** A string from the API as a note prints it: one line, no `@`, and short. */
function printable(value, max) {
  const text = String(value ?? '')
    .replace(/[^\w .,:;/?&=+()'#-]/g, '?')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rank = (severity) => ALERT_SEVERITIES.indexOf(severity);

/** The open critical and high alerts on main, every page, as the whitelist keeps them. */
export async function readOpenAlerts(client) {
  const byNumber = new Map();
  for (const severity of ALERT_SEVERITIES) {
    for (const answered of await getAll(client, `code-scanning/alerts?state=open&ref=refs/heads/main&severity=${severity}`)) {
      const alert = slimAlert(answered);
      alert.rule = { ...alert.rule, security_severity_level: alert.rule?.security_severity_level ?? severity };
      byNumber.set(alert.number ?? `${severity} ${byNumber.size}`, alert);
    }
  }
  return [...byNumber.values()];
}

/** The alerts by tool and category, each with its rules: the most critical group first. */
export function alertGroups(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    const severity = alert.rule?.security_severity_level;
    if (!ALERT_SEVERITIES.includes(severity)) continue;
    const tool = alert.tool?.name ?? '';
    // The upload ends a category it was given with a slash; the name is without it.
    const category = (alert.most_recent_instance?.category ?? '').replace(/\/+$/, '');
    const key = JSON.stringify([tool, category]);
    if (!groups.has(key)) groups.set(key, { tool, category, image: IMAGE_CATEGORY.exec(category)?.[1] ?? null, critical: 0, high: 0, rules: new Map() });
    const group = groups.get(key);
    group[severity] += 1;
    const id = alert.rule?.id ?? '';
    const rule = group.rules.get(id) ?? { id, severity, alerts: 0 };
    if (rank(severity) < rank(rule.severity)) rule.severity = severity;
    rule.alerts += 1;
    group.rules.set(id, rule);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rules: [...g.rules.values()].sort((a, b) => rank(a.severity) - rank(b.severity) || b.alerts - a.alerts || order(a.id, b.id)) }))
    .sort((a, b) => b.critical - a.critical || b.critical + b.high - (a.critical + a.high) || order(a.tool, b.tool) || order(a.category, b.category));
}

/** The total line. `reason` says why the alerts could not be read, when they could not. */
export function alertsNote(counts, reason) {
  if (!counts) {
    return note('code-scanning', `the open code-scanning alerts could not be read${reason ? `: ${printable(reason, 240)}` : ' with this token'}`);
  }
  const { critical, high, groups } = counts;
  return note(
    'code-scanning',
    critical + high === 0
      ? 'no open critical or high code-scanning alert on main'
      : `${critical} critical and ${high} high code-scanning alert(s) open on main${groups ? `, in ${groups} group(s) by tool and category below` : ''}: reported, not refused`,
  );
}

/** One group's line: its tool, its category (and image), its counts, its most alerted rules. */
function groupNote(group) {
  const category = printable(group.category, 100);
  const where =
    group.image !== null
      ? `image ${printable(group.image, 80)} (category ${category})`
      : group.category === REPOSITORY_SCAN_CATEGORY
        ? `the repository’s filesystem scan (category ${category})`
        : group.category
          ? `category ${category}`
          : 'no category';
  const top = group.rules.slice(0, TOP_RULES).map((r) => `${printable(r.id, 60) || 'no rule id'} (${r.severity}, ${r.alerts})`);
  const more = group.rules.length - top.length;
  return note(
    'code-scanning',
    `${printable(group.tool, 40) || 'no tool name'}, ${where}: ${group.critical} critical and ${group.high} high in ${group.rules.length} rule(s); most: ${top.join(', ')}${more > 0 ? `, and ${more} more` : ''}`,
  );
}

/** The total, then a line per tool and category; or why the alerts could not be read. */
export function alertsNotes(alerts, reason) {
  if (!alerts) return [alertsNote(null, reason)];
  const groups = alertGroups(alerts);
  const count = (severity) => groups.reduce((n, g) => n + g[severity], 0);
  return [alertsNote({ critical: count('critical'), high: count('high'), groups: groups.length }), ...groups.map(groupNote)];
}

/** The check step's alert notes: read, then printed; or, when the API refuses, why. */
export async function openAlertsNotes(client) {
  let alerts;
  try {
    alerts = await readOpenAlerts(client);
  } catch (err) {
    return alertsNotes(null, err instanceof Error ? err.message : String(err));
  }
  return alertsNotes(alerts);
}

/** The environment a candidate's own code runs with: no token of any kind. */
export const candidateEnv = withoutTokens;

/** What this does not check, every time, so nobody reads the list as complete. */
export function notChecked() {
  return [
    note('not-checked', 'the upgrade drill on a Docker host (scripts/upgrade-drill.sh), or its recorded skip'),
    note('not-checked', 'the CHANGELOG prose, and the release body’s prose'),
    note('not-checked', 'CI and production on separate machines before the first non-demo tenant (docs/release.md §1)'),
    note('not-checked', 'the announcement, and everything in docs/release.md §5: the deploy to live is by hand'),
  ];
}

/**
 * The line under the summary's title when the run carries the owner's
 * waiver: whether it was used, and what it does not waive. The reason sits in
 * a code span, which Markdown renders as text.
 */
export function waiverSummary(waiver, lines) {
  if (lines.some((l) => l.check === 'nights' && l.kind === 'pass')) {
    return `**The nights hold**, so the waiver ${waiver.actor} gave was not used.`;
  }
  return (
    `**The counted nights are waived** by ${waiver.actor}, in their words: \`${waiver.reason}\`\n\n` +
    'Nothing else is waived: the names, the version, the changelog fold, C on main’s first-parent line, CI’s full suite on C, ' +
    'the gate scan and the approval still hold (docs/release.md, “When the owner waives the nights”).'
  );
}

/** Count, refuse what never ran or ended in an error, and decide the exit. */
export function verdict({ lines, mode, outcomes = {}, commit, waiver = null }) {
  const expected = mode === 'verify' ? EXPECTED_CHECKS.verify : EXPECTED_CHECKS.full;
  const extra = [];
  for (const check of expected) {
    if (!lines.some((l) => l.check === check)) extra.push(refuse(check, 'this check did not run'));
  }
  for (const [step, outcome] of Object.entries(outcomes)) {
    if (outcome === 'failure' || outcome === 'cancelled') extra.push(refuse(`step-${step}`, `the ${step} step ended ${outcome} without a verdict of its own: read its log`));
  }
  const all = [...lines, ...extra];
  const refused = all.filter((l) => l.kind === 'refuse').length;
  let exitCode = refused > 0 ? 1 : 0;
  if (mode === 'rehearse') exitCode = all.some((l) => l.kind === 'refuse' && RESOLVE_CHECKS.includes(l.check)) ? 1 : 0;
  const row = (l) => `- **${l.kind}** ${l.check}: ${l.sentence}`;
  const summary = [
    `### Release preflight (${mode})${commit ? ` on ${short(commit)}` : ''}: ${refused === 0 ? 'nothing refused' : `${refused} refused`}`,
    '',
    ...(waiver ? [waiverSummary(waiver, all), ''] : []),
    ...all.filter((l) => l.kind === 'refuse').map(row),
    ...all.filter((l) => l.kind !== 'refuse').map(row),
    '',
  ].join('\n');
  return { refused, exitCode, summary, lines: all, extra };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

const git = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/**
 * The resolve step: the inputs, the owner's waiver, main, C and the release
 * before. With a waiver, C is the commit given or a refusal: the nights are
 * not read to pick one.
 */
export async function resolveStep(client, env) {
  const { VERSION: version, COMMIT_INPUT: given = '', MODE: mode } = env;
  const lines = [...validateInputs({ version, commit: given, mode })];
  const { waiver, lines: waived } = readWaiver({ text: env.WAIVE_NIGHTS, mode, actor: env.GITHUB_ACTOR });
  lines.push(...waived);
  lines.push(dispatchedFromMain({ ref: env.GITHUB_REF, workflowRef: env.GITHUB_WORKFLOW_REF, repository: env.GITHUB_REPOSITORY }));
  const out = { commit: '', previous: '', candidate: 'false' };
  if (lines.some((l) => l.kind === 'refuse')) return { lines, out };

  if (mode === 'verify') {
    const peeled = await peelTag(client, version);
    if (!peeled.ref) {
      lines.push(refuse('tag-exists', `there is no tag ${version} to verify`));
    } else {
      out.commit = peeled.tagObject?.object?.sha ?? peeled.ref.object?.sha;
      const how = peeled.tagObject ? 'annotated' : 'lightweight';
      lines.push(pass('tag-exists', `${version} is ${how === 'annotated' ? 'an' : 'a'} ${how} tag at ${short(out.commit)}`));
    }
    return { lines, out };
  }

  let commit = given;
  if (!commit && waiver) {
    lines.push(
      refuse('commit', 'the nights are waived, so they pick no commit: dispatch it again with commit set to the full commit to tag, on main’s first-parent line'),
    );
  } else if (!commit) {
    const nights = await readNights(client, { commit: null });
    if (nights.verdict === 'pass' && nights.commit) {
      commit = nights.commit;
      lines.push(note('commit', `the nights pick ${short(commit)}: ${nights.proof}`));
    } else if (mode === 'preflight') {
      commit = env.GITHUB_SHA;
      const why = nights.lines.find((l) => l.kind === 'refuse')?.sentence;
      lines.push(note('commit', `the nights pick no commit${why ? ` (${why})` : ''}, so the other checks read main’s head ${short(commit)}`));
    } else if (mode === 'rehearse') {
      lines.push(
        refuse('commit', 'the nights pick no commit, so a rehearsal needs one: dispatch it again with commit set to a commit on main’s first-parent line, such as its head'),
      );
    } else {
      lines.push(refuse('commit', 'the nights pick no commit, and a release is cut only on a commit the nights passed'));
    }
  } else {
    lines.push(note('commit', `given: ${short(commit)}`));
  }
  if (!commit) return { lines, out };

  const tags = git(['tag', '--list', 'v*']).split('\n').filter(Boolean);
  const previous = previousTag(tags, version);
  if (!previous) lines.push(refuse('previous-release', `no release tag sorts below ${version}, so there is nothing to upgrade from`));

  let known = true;
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    known = false;
  }
  const isAncestor = known && spawnSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']).status === 0;
  const firstParent = isAncestor && git(['rev-list', '--first-parent', 'origin/main']).split('\n').includes(commit);
  lines.push(candidateOnMain({ commit, isAncestor, firstParent }));
  out.commit = commit;
  out.previous = previous ?? '';
  out.candidate = lines.some((l) => l.kind === 'refuse') ? 'false' : 'true';
  return { lines, out };
}

/**
 * The check step, with C checked out in `candidate`. The nights are read for
 * C, and under the owner's waiver their refusals are notes (`waiveNights`).
 */
export async function checkStep(client, env, candidate) {
  const { VERSION: version, COMMIT: commit, PREVIOUS: previous, MODE: mode } = env;
  const lines = [];

  lines.push(tagFree(tagDecision({ commit, version, ...(await peelTag(client, version)) })));
  lines.push(
    ...refUnambiguous({
      version,
      commit,
      branch: await client.get(`git/ref/heads/${version}`, { allow404: true }),
      gate: await client.get(`git/ref/heads/${gateBranch(version)}`, { allow404: true }),
    }),
  );

  const readCandidate = (file) => (existsSync(join(candidate, file)) ? readFileSync(join(candidate, file), 'utf8') : '');
  lines.push(openapiAgrees(readCandidate('apps/api/docs/openapi.yaml'), version));
  lines.push(...changelogFolded(readCandidate('CHANGELOG.md'), version, new Date()));

  const newest = async (workflow) =>
    (await client.get(`actions/workflows/${workflow}/runs?head_sha=${commit}&event=push&branch=main&per_page=5`))?.workflow_runs?.[0] ?? null;
  const ci = await newest('ci.yml');
  const ciJobs = ci ? (await client.get(`actions/runs/${ci.id}/jobs?filter=latest&per_page=100`))?.jobs ?? [] : null;
  lines.push(ciGreen(ci, ciJobs, commit));
  const scan = await newest('security-scan.yml');
  lines.push(scanGreenOnMain(scan, commit));

  const { waiver } = readWaiver({ text: env.WAIVE_NIGHTS, mode, actor: env.GITHUB_ACTOR });
  const nights = waiveNights(await readNights(client, { commit }), waiver);
  lines.push(...nights.lines);

  if (mode !== 'verify') {
    try {
      lines.push(approvalNote(await client.get('environments/release', { allow404: true })));
    } catch {
      lines.push(approvalNote(null, false));
    }
  }
  lines.push(...(await openAlertsNotes(client)));
  try {
    const after = git(['rev-list', '--count', `${commit}..origin/main`]).trim();
    lines.push(note('main-after-candidate', `${after} commit(s) on main after C${after === '0' ? '' : ': the freeze (0141 T14) did not hold, or has not started'}`));
  } catch {
    lines.push(note('main-after-candidate', 'could not count the commits on main after C'));
  }
  if (previous) {
    const before = await client.get(`releases/tags/${encodeURIComponent(previous)}`, { allow404: true });
    const gaps = checkRelease(before, previous).filter((l) => l.kind === 'refuse').map((l) => l.sentence);
    lines.push(note('previous-release', gaps.length === 0 ? `${previous}'s release is complete` : `${previous}'s release: ${gaps.join('; ')}`));
  }
  lines.push(...notChecked());
  const proof = [ci ? `CI run #${ci.run_number}` : '', scan ? `Security Scan run #${scan.run_number} on main` : ''].filter(Boolean).join(', ');
  return { lines, proof };
}

/**
 * The candidate's own `release-names-agree.mjs`. The workflow runs this in a
 * step with no token in its environment; the spawn strips tokens as well, for
 * a run by hand.
 */
export function namesStep(candidate, version, env = process.env) {
  const names = spawnSync('node', [join(candidate, 'scripts', 'release-names-agree.mjs'), version], {
    cwd: candidate,
    env: { ...candidateEnv(env), GITHUB_ACTIONS: 'false' },
    encoding: 'utf8',
  });
  const said = `${names.stdout ?? ''}`.trim().split('\n').filter(Boolean);
  return names.status === 0
    ? pass('names-agree', `the candidate’s own check: ${said.at(-1) ?? 'agreed'}`)
    : refuse('names-agree', `the candidate’s own check refused: ${said.filter((l) => l.startsWith('refused:')).map((l) => l.slice(9)).join(' ') || said.join(' ')}`);
}

function calleesStep(candidate) {
  const req = createRequire(join(candidate, 'package.json'));
  const { parse } = req('yaml');
  const workflows = {};
  for (const file of ['security-scan.yml', 'images.yml', 'windows-payload.yml']) {
    const path = join(candidate, '.github', 'workflows', file);
    workflows[file] = existsSync(path) ? parse(readFileSync(path, 'utf8')) : {};
  }
  return calleesDispatchable(workflows);
}

function readLines(file) {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function main(argv) {
  const [command] = argv;
  const env = process.env;
  const at = argv.indexOf('--candidate');
  const candidate = resolve(at >= 0 ? argv[at + 1] : 'candidate');
  if (command === 'names') {
    // No client here: this step has no token, and needs none.
    report([namesStep(candidate, env.VERSION, env)]);
    return 0;
  }
  const client = github();
  switch (command) {
    case 'resolve': {
      const { lines, out } = await resolveStep(client, env);
      report(lines);
      output(out);
      return 0;
    }
    case 'check': {
      const { lines, proof } = await checkStep(client, env, candidate);
      report(lines);
      output({ proof });
      return 0;
    }
    case 'callees':
      report(calleesStep(candidate));
      return 0;
    case 'verdict': {
      const outcomes = Object.fromEntries(
        (env.OUTCOMES ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((p) => p.split('=')),
      );
      // The waiver read again from the input, not from the lines file, which
      // the candidate's own code could reach.
      const { waiver } = readWaiver({ text: env.WAIVE_NIGHTS, mode: env.MODE, actor: env.GITHUB_ACTOR });
      const v = verdict({ lines: readLines(env.RELEASE_LINES), mode: env.MODE, outcomes, commit: env.COMMIT ?? '', waiver });
      report(v.extra, { file: '' });
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, v.summary);
      output({ refused: v.refused });
      console.log(`${v.refused} refused (${env.MODE})`);
      return v.exitCode;
    }
    case 'rehearsal-verdict': {
      const refused = Number(env.REFUSED ?? 'NaN');
      if (refused === 0) {
        report([pass('rehearsal', 'the preflight refused nothing, and the gate scan passed: the real run would have gone on to the approval')], { file: '' });
        return 0;
      }
      report([refuse('rehearsal', `the gate scan ran, and the real run would have stopped at the preflight: ${Number.isNaN(refused) ? 'its count is unknown' : `${refused} refused`}`)], { file: '' });
      return 1;
    }
    default:
      console.error(
        'usage: node scripts/release-preflight.mjs resolve | names --candidate <dir> | check --candidate <dir> | callees --candidate <dir> | verdict | rehearsal-verdict',
      );
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      console.log(`refuse ${process.argv[2] ?? 'preflight'}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}
