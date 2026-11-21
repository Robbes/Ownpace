#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GITLEAKS OVER THE COMMITS A PULL REQUEST ADDS, AND A FINDING FAILS IT
 * (workplan 0163 T6; the owner's decision D4 of 2026-11-20).
 *
 * Nothing in CI read a commit for a secret before it merged. An outside,
 * read-only check of 2026-11-20 found none in this tree, and gitleaks found
 * none either (0163 §4.2): every hit was a test file's fake token or a
 * documentation placeholder. A secret committed once stays in the history for
 * good, even when a later commit removes it, and a merge brings it to main. So
 * ci.yml's `gitleaks` job runs this on every pull request, over the commits the
 * pull request adds, and fails it on any finding.
 *
 * WHAT IT RUNS. `gitleaks git` over `<base>..<head>`, which gitleaks hands to
 * `git log -p -U0` (its `--log-opts`), so it reads the lines each of those
 * commits adds, with `.gitleaks.toml` (gitleaks' default rules and one
 * allowlist of paths: unit and integration test files, and
 * `docs/o365-setup.md`), the report as JSON in the runner's temporary
 * directory, and:
 *  - `--redact`: no value is printed, in the log or in the report;
 *  - `--ignore-gitleaks-allow`: a `gitleaks:allow` comment excuses nothing;
 *  - `--exit-code 3`: gitleaks exits 1 for a finding and for a failure alike
 *    (its README's exit codes), so a finding is told apart by a code of its
 *    own.
 * gitleaks also reads a `.gitleaksignore` at the repository's root, whatever
 * its flags say (its cmd/root.go at v8.30.1), so this refuses to run while one
 * exists: D4 allows no ignore the allowlist does not hold.
 *
 * FAILS THE JOB (exit 1) on any finding, and on a scan that did not finish:
 * the base or the head not a commit id, a range with no commit in it, a
 * `.gitleaksignore`, no `.gitleaks.toml`, gitleaks not run or exiting anything
 * but 0 or 3, a report it did not write or not in its shape, or a report that
 * disagrees with its exit code. The job runs on pull requests only, where the
 * run is the gate.
 *
 * WHAT IT PRINTS. For each finding, its rule, file, line and commit: a table in
 * the job's summary, and an error annotation on the line. Never the value, the
 * text it matched, or the commit's author, address or message: the log of a
 * pull request to a public repository is public.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs in a CI step on a
 * bare checkout, with no `node_modules`, and needs no type stripping. Its guard,
 * `scripts/a-secret-a-pull-request-could-add.unit.test.ts`, runs it with a
 * stubbed gitleaks and git.
 *
 * Usage:  node scripts/gitleaks-report.mjs <base-sha> <head-sha>
 *   GITLEAKS  the binary to run (default: $RUNNER_TEMP/gitleaks-bin/gitleaks)
 * Exit: 0 when gitleaks read every commit the range adds and found nothing; 1 otherwise.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The config, at the repository's root. */
export const CONFIG = '.gitleaks.toml';

/** The ignore list gitleaks reads by itself, which D4 does not allow. */
export const IGNORE_FILE = '.gitleaksignore';

/** The exit code gitleaks is told to give for a finding: 1 is also its code for a failure. */
export const LEAK_EXIT = 3;

/** The report's file name, in the directory the report lands in. */
export const REPORT = 'gitleaks.json';

/** A full commit id. */
export const SHA = /^[0-9a-f]{40}$/;

/** The first line of what a command wrote, at most 300 characters, as a reason. */
const firstLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 300);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The `gitleaks` arguments that read `<base>..<head>` (WHAT IT RUNS, above). */
export function scanArgs({ base, head, report }) {
  return [
    'git',
    '--config', CONFIG,
    '--log-opts', `${base}..${head}`,
    '--redact',
    '--ignore-gitleaks-allow',
    '--exit-code', String(LEAK_EXIT),
    '--report-format', 'json',
    '--report-path', report,
    '--no-banner',
    '--no-color',
    '.',
  ];
}

/**
 * What the report holds: each finding as `{ rule, file, line, commit }`, or
 * why it cannot be read. Nothing else of a finding is kept, so nothing else can
 * reach the log.
 */
export function readReport(path) {
  if (!existsSync(path)) return { error: 'gitleaks wrote no report' };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: `gitleaks' report is not JSON (${firstLine(e instanceof Error ? e.message : e)})` };
  }
  if (!Array.isArray(parsed)) return { error: "gitleaks' report is not a list of findings" };
  const findings = [];
  for (const f of parsed) {
    if (!f || typeof f.RuleID !== 'string' || typeof f.File !== 'string' || !Number.isInteger(f.StartLine) || typeof f.Commit !== 'string') {
      return { error: "gitleaks' report holds a finding without a rule, a file, a line and a commit" };
    }
    findings.push({ rule: f.RuleID, file: f.File, line: f.StartLine, commit: f.Commit });
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { findings };
}

/**
 * gitleaks' own closing lines, which say what it read and found and carry no
 * value: `scanned ~<n> bytes (…) in <time>`, `no leaks found`, `leaks found:
 * <n>`. Any other line of its log is not repeated.
 */
export const SAID = /\b(?:scanned ~\d+ bytes\b.*|no leaks found|leaks found: \d+|partial scan completed\b.*)$/;

export function saidOf(stderr) {
  return String(stderr ?? '')
    .split('\n')
    .map((l) => SAID.exec(l.trim())?.[0])
    .filter((l) => l !== undefined);
}

/** A table cell: one line, its bars escaped, nothing a renderer reads as HTML or as code. */
const cell = (text) =>
  String(text).replace(/\s*\n\s*/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, "'").replace(/\|/g, '\\|');

/** A workflow command's message, and one of its properties, escaped as GitHub reads them. */
const commandData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const commandProperty = (text) => commandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/**
 * The verdict on one run: the summary's Markdown, the log's lines and the exit
 * code. `stopped` says why nothing was scanned; otherwise `status` is gitleaks'
 * exit and `read` what its report held.
 */
export function report({ base = '', head = '', commits = 0, stopped = null, status = null, read = null, said = [] }) {
  const problems = [];
  let findings = [];
  if (stopped) {
    problems.push(stopped);
  } else if (status !== 0 && status !== LEAK_EXIT) {
    problems.push(`gitleaks exited ${status === null ? 'without a status' : status}, not 0 (nothing found) or ${LEAK_EXIT} (a finding): the scan did not finish`);
  } else if (read?.error) {
    problems.push(read.error);
  } else {
    findings = read?.findings ?? [];
    if (status === 0 && findings.length > 0) problems.push(`gitleaks exited 0 and its report lists ${plural(findings.length, 'finding')}: the two disagree`);
    if (status === LEAK_EXIT && findings.length === 0) problems.push(`gitleaks exited ${LEAK_EXIT}, a finding, and its report lists none: the two disagree`);
  }
  const code = problems.length > 0 || findings.length > 0 ? 1 : 0;
  const range = base && head ? `${base.slice(0, 12)}..${head.slice(0, 12)}` : '(no range)';
  const lines = [`gitleaks over ${range}, ${plural(commits, 'commit')} this pull request adds, with ${CONFIG}`, ...said.map((l) => `gitleaks said: ${l}`)];
  const md = [
    '## gitleaks',
    '',
    `gitleaks over the commits this pull request adds (\`${range}\`, ${plural(commits, 'commit')}), with its default rules and \`${CONFIG}\`, ` +
      'which allows unit and integration test files and `docs/o365-setup.md` and nothing else. No value is printed here, and no ' +
      '`gitleaks:allow` comment counts (workplan 0163 D4).',
    '',
  ];
  if (findings.length > 0) {
    md.push('| file | line | rule | commit |', '| --- | ---: | --- | --- |');
    for (const f of findings) {
      md.push(`| \`${cell(f.file)}\` | ${f.line} | ${cell(f.rule)} | \`${cell(f.commit.slice(0, 12))}\` |`);
      lines.push(
        `::error file=${commandProperty(f.file)},line=${f.line},title=${commandProperty(`gitleaks ${f.rule}`)}::` +
          commandData(
            `gitleaks' ${f.rule} matched a line commit ${f.commit.slice(0, 12)} adds. A later commit that removes it leaves it in the history: ` +
              'take it out of the commit that added it, and treat the value as exposed. If it is a test fixture, it belongs in a unit or integration test file.',
          ),
      );
    }
    md.push(
      '',
      'A later commit that removes a value leaves it in the history, and a merge would bring it to `main`: take it out of the commit that ' +
        'added it (amend or rewrite that commit, then push the branch), and treat the value as exposed, so rotate it if it was ever real. A ' +
        "fake token belongs in a unit or integration test file, which the allowlist holds; nothing else excuses a line.",
      '',
    );
  }
  if (problems.length > 0) {
    md.push('### The scan did not finish', '', ...problems.map((p) => `- ${cell(p)}`), '', 'A scan that did not finish fails this job: here the run is the gate.', '');
    for (const p of problems) lines.push(`::error::gitleaks: ${commandData(p)}`);
  }
  const tally = problems.length > 0 ? 'The scan did not finish.' : findings.length > 0 ? `${plural(findings.length, 'finding')}: this pull request adds a secret, or something shaped like one.` : 'Nothing found.';
  md.push(`**${tally}**`, '');
  lines.push(tally);
  return { markdown: `${md.join('\n')}\n`, lines, code };
}

/** The real git, from the repository's root: its status and output, never a throw. */
const realGit = (args, root) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

/** The real gitleaks, from the repository's root. */
const realGitleaks = (binary, args, root) => spawnSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });

/**
 * One run: the range checked, gitleaks run once over it, its report read.
 * `git` and `gitleaks` are the guard's to stub; `out` is where the report
 * lands (the runner's temporary directory, cleared of an earlier report).
 */
export function run({ root = REPO_ROOT, argv = process.argv.slice(2), env = process.env, git = realGit, gitleaks = realGitleaks, out = join(env.RUNNER_TEMP || tmpdir(), 'gitleaks-report') } = {}) {
  const [base = '', head = ''] = argv;
  if (!SHA.test(base) || !SHA.test(head)) {
    return report({ base, head, stopped: `the range's two ends must be full commit ids, and they are ${JSON.stringify(base)} and ${JSON.stringify(head)}` });
  }
  if (existsSync(join(root, IGNORE_FILE))) {
    return report({ base, head, stopped: `${IGNORE_FILE} exists, and gitleaks would read it whatever its flags say: workplan 0163 D4 allows no ignore list besides ${CONFIG}'s paths` });
  }
  if (!existsSync(join(root, CONFIG))) return report({ base, head, stopped: `there is no ${CONFIG} at the repository's root` });
  const counted = git(['rev-list', '--count', `${base}..${head}`], root);
  const commits = Number.parseInt(String(counted.stdout ?? '').trim(), 10);
  if (counted.error || counted.status !== 0 || !Number.isInteger(commits)) {
    return report({ base, head, stopped: `git could not count the commits in ${base.slice(0, 12)}..${head.slice(0, 12)}${firstLine(counted.stderr) ? `: ${firstLine(counted.stderr)}` : ''}` });
  }
  if (commits < 1) return report({ base, head, commits, stopped: `${base.slice(0, 12)}..${head.slice(0, 12)} holds no commit, so there would be nothing to read` });
  mkdirSync(out, { recursive: true });
  const path = join(out, REPORT);
  rmSync(path, { force: true });
  const binary = env.GITLEAKS || join(env.RUNNER_TEMP || tmpdir(), 'gitleaks-bin', 'gitleaks');
  const ran = gitleaks(binary, scanArgs({ base, head, report: path }), root);
  if (ran.error) return report({ base, head, commits, stopped: `gitleaks could not be run (${ran.error.code ?? ran.error.message})` });
  return report({ base, head, commits, status: ran.status, read: ran.status === 0 || ran.status === LEAK_EXIT ? readReport(path) : null, said: saidOf(ran.stderr) });
}

function main() {
  const out = run();
  for (const line of out.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, out.markdown);
  return out.code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    // A fault here is a scan that did not finish, and the job is the gate.
    console.log(`::error::gitleaks-report stopped: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
