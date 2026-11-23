#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * HADOLINT OVER EVERY DOCKERFILE, REPORT ONLY (workplan 0119; the owner's
 * decisions of 2026-11-19: hadolint in CI, report only first, and no exact
 * apk or apt package versions).
 *
 * `a-dockerfile-that-ends-as-root` holds every Dockerfile git lists to six of
 * hadolint's rules by reading the files. Nothing ran hadolint itself: its
 * other rules, and ShellCheck's notes inside a RUN, were read once, by a
 * read-only check of 2026-11-19, and by nothing since. So
 * `.github/workflows/hadolint.yml` runs this, which runs hadolint over
 * each Dockerfile git lists, found as that guard finds them (`dockerfiles()`
 * below, which the guard calls), one `docker run` per file, with
 * `.hadolint.yaml`, and writes what hadolint says, file by file, to the job's
 * summary.
 *
 * KNOWN, NOT IGNORED. The config ignores DL3008 and DL3018 and nothing else.
 * A finding the guard's EXCEPTIONS explain (its rule, by hadolint's code:
 * `RULE_CODES`), or one workplan 0119 read and left (`KNOWN_FINDINGS`), is
 * marked known, with its reason, and is still listed. A known one hadolint
 * did not report is named too, so the record can shrink as files are fixed.
 * EXCEPTIONS live here, not in the guard, so that a bare checkout can read
 * them.
 *
 * REPORT ONLY. It was to stay so until the two Trigger.dev Dockerfiles had had
 * their pass (`deploy/compose/trigger.dev/Dockerfile` and
 * `deploy/compose/supervisor/Dockerfile`); alpha.18 removed both with
 * Trigger.dev (workplan 0167 T9), so the condition is gone, and making it
 * blocking is a pull request of its own (workplan 0119). A finding fails nothing: hadolint runs with
 * `--no-fail`, and this exits 0 whatever it found. On a pull request this
 * exits 0 whatever happened, and warns when a Dockerfile went unlinted. On a
 * push or a dispatch it exits 1 when a Dockerfile went unlinted (the image not
 * pulled, hadolint answering with anything but a list of findings, or with a
 * finding of a rule `.hadolint.yaml` ignores, which says the config was not
 * read) or when there was none to lint: there the run is the record, and a
 * scan that skipped itself is not green (security-scan.yml's rule).
 *
 * HOW IT RUNS HADOLINT. The image by tag and index digest (`HADOLINT_IMAGE`,
 * the workflow's), pulled once, in three attempts 5 and 15 seconds apart, then
 * run with `--pull never`, no network, a read-only root, no capability, no
 * new privilege, as the runner's own user, with the checkout mounted
 * read-only. The image is one file, `/bin/hadolint`, and sets no locale; a
 * Haskell program's text handles take the locale's encoding, and most
 * Dockerfiles here carry text outside ASCII, so LANG is C.UTF-8.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs in a CI step on
 * a bare checkout, with no `node_modules`, and needs no type stripping. Its
 * guard, `scripts/a-dockerfile-that-ends-as-root.unit.test.ts`, runs it with a
 * stubbed `docker`.
 *
 * Usage:  HADOLINT_IMAGE=hadolint/hadolint:v<x.y.z>@sha256:<digest> node scripts/hadolint-report.mjs
 * Exit: 0 every Dockerfile was linted, whatever hadolint found, or this is a
 * pull request; 1 on any other event, when a Dockerfile went unlinted or there
 * was none.
 */

import { appendFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The config, at the repository's root, where hadolint run by hand from there finds it by itself. */
export const CONFIG = '.hadolint.yaml';

/**
 * What `.hadolint.yaml` ignores: a package installed without an exact
 * version, by apt (DL3008) and by apk (DL3018). The guard holds the file to
 * this list and nothing else.
 */
export const IGNORED = ['DL3008', 'DL3018'];

/** The image this runs: hadolint's own, by a release tag and its index digest. */
export const IMAGE = /^hadolint\/hadolint:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/;

/** A Dockerfile, by its path as git lists it: `Dockerfile`, `Containerfile`, `Dockerfile.<x>`, `<x>.Dockerfile`, in any case. */
export const DOCKERFILE = /(^|\/)(Dockerfile|Containerfile)([.-][^/]*)?$|\.(Dockerfile|Containerfile)$/i;

/** The seconds between the pull's attempts: three attempts, then the image is not there. */
export const PULL_DELAYS = [5, 15];

/** Every Dockerfile in the repository, as git lists them, tracked or new, that is on disk. */
export function dockerfiles(root = REPO_ROOT) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((f) => DOCKERFILE.test(f) && existsSync(join(root, f)))
    .sort();
}

/**
 * hadolint's codes for the six rules `a-dockerfile-that-ends-as-root` holds,
 * by that guard's name for each, as its header pairs them.
 */
export const RULE_CODES = {
  'non-root': ['DL3002'],
  'numeric-user': ['DL3066'],
  'exec-form': ['DL3025'],
  pipefail: ['DL4006'],
  'no-add': ['DL3020'],
  tagged: ['DL3006', 'DL3007'],
};

/**
 * The files that keep a rule of `a-dockerfile-that-ends-as-root` broken, by
 * rule, with why. That guard checks each still breaks it, so one fixed since
 * fails until it leaves this list; here, a finding of that rule's code in that
 * file is known, with this reason.
 */
export const EXCEPTIONS = {
  'deploy/compose/pgbouncer/Dockerfile': {
    'numeric-user':
      "`USER root` for the one RUN apk needs and `USER postgres` after it, by the name upstream's config gives its user: " +
      "images.yml's build (pgbouncer) holds the built image's User to upstream's, and the RUN after it proves postgres is uid 70",
  },
};

/**
 * What hadolint reports that no rule of the guard holds, read and left as it
 * stands (workplan 0119, Status of 2026-11-19), by file and code, with why.
 * Known in the summary, never ignored.
 */
export const KNOWN_FINDINGS = {
};

/** `table[key]` when the table holds that key itself: a path or a code is never one of Object's own names. */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The first line of what a command wrote, at most 300 characters, as a reason. */
const firstLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 300);

/**
 * The `docker run` that lints one file (HOW IT RUNS HADOLINT, above). The file
 * is named by its path from the repository's root, so hadolint's findings name
 * it the same way.
 */
export function lintArgs(image, file, { root, uid, gid }) {
  return [
    'run', '--rm', '--pull', 'never',
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', `${uid}:${gid}`,
    '--env', 'LANG=C.UTF-8',
    '--volume', `${root}:/repo:ro`, '--workdir', '/repo',
    image,
    '/bin/hadolint', '--config', CONFIG, '--no-fail', '--format', 'json', file,
  ];
}

/**
 * What one run said about `file`: its findings, by line, or why there are none
 * to read. hadolint with `--no-fail --format json` exits 0 and prints one JSON
 * list, `[]` for none; anything else is no reading of the file. Neither is a
 * finding of a rule the config ignores: it says the config was not read.
 */
export function findingsOf(file, ran) {
  const { status, stdout, stderr, error, signal } = ran;
  if (error) return { file, error: `docker could not be run (${error.code ?? error.message})` };
  if (status !== 0) {
    return { file, error: status === null ? `docker was stopped by ${signal ?? 'a signal'}` : `docker exited ${status}${firstLine(stderr) ? `: ${firstLine(stderr)}` : ''}` };
  }
  let listed;
  try {
    listed = JSON.parse(stdout);
  } catch {
    return { file, error: `hadolint printed no list of findings (${String(stdout ?? '').trim() === '' ? 'nothing' : firstLine(stdout)})` };
  }
  if (!Array.isArray(listed)) return { file, error: `hadolint printed JSON that is not a list of findings: ${firstLine(stdout)}` };
  const findings = [];
  for (const f of listed) {
    if (!f || typeof f.code !== 'string' || !Number.isInteger(f.line) || typeof f.level !== 'string' || typeof f.message !== 'string') {
      return { file, error: `hadolint printed a finding without a code, a line, a level and a message: ${JSON.stringify(f).slice(0, 300)}` };
    }
    if (IGNORED.includes(f.code)) return { file, error: `hadolint reported ${f.code}, which ${CONFIG} ignores: the config was not read` };
    findings.push({ line: f.line, code: f.code, level: f.level, message: f.message });
  }
  findings.sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
  return { file, findings };
}

/** Why a finding of `code` in `file` stands, when EXCEPTIONS or KNOWN_FINDINGS say: `{ by, why }`, or null. */
export function knownAs(file, code, exceptions = EXCEPTIONS, known = KNOWN_FINDINGS) {
  for (const [rule, why] of Object.entries(own(exceptions, file) ?? {})) {
    if ((own(RULE_CODES, rule) ?? []).includes(code)) return { by: `EXCEPTIONS, ${rule}`, why };
  }
  const why = own(own(known, file) ?? {}, code);
  return why ? { by: 'KNOWN_FINDINGS', why } : null;
}

/** Each known entry of a linted file that hadolint did not report: `{ file, by, codes }`. */
function unreported(results, exceptions, known) {
  const out = [];
  for (const { file, findings } of results) {
    if (!findings) continue;
    const seen = new Set(findings.map((f) => f.code));
    for (const rule of Object.keys(own(exceptions, file) ?? {})) {
      const codes = own(RULE_CODES, rule) ?? [];
      if (!codes.some((c) => seen.has(c))) out.push({ file, by: `EXCEPTIONS, ${rule}`, codes });
    }
    for (const code of Object.keys(own(known, file) ?? {})) {
      if (!seen.has(code)) out.push({ file, by: 'KNOWN_FINDINGS', codes: [code] });
    }
  }
  return out;
}

/** A table cell: one line, its bars escaped, nothing a renderer reads as HTML or as code. */
const cell = (text) =>
  String(text).replace(/\s*\n\s*/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, "'").replace(/\|/g, '\\|');

/** A rule's page: hadolint's wiki for its own, ShellCheck's for ShellCheck's. */
const ruleLink = (code) =>
  /^DL\d{4}$/.test(code)
    ? `[${code}](https://github.com/hadolint/hadolint/wiki/${code})`
    : /^SC\d{4}$/.test(code)
      ? `[${code}](https://www.shellcheck.net/wiki/${code})`
      : cell(code);

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The report of one run: the job summary's Markdown, the log's lines and the
 * exit code (REPORT ONLY, above). `stopped` says why nothing was linted at
 * all; otherwise `results` holds one entry per file, in `files` order.
 */
export function report({ image, event, files, results = [], stopped = null, exceptions = EXCEPTIONS, known = KNOWN_FINDINGS }) {
  const pr = event === 'pull_request';
  const unlinted = stopped ? files.map((file) => ({ file, error: stopped })) : results.filter((r) => r.error);
  const failed = Boolean(stopped) || files.length === 0 || unlinted.length > 0;
  const code = failed && !pr ? 1 : 0;
  const linted = stopped ? [] : results.filter((r) => r.findings);
  const counted = linted.map((r) => {
    const findings = r.findings.map((f) => ({ ...f, known: knownAs(r.file, f.code, exceptions, known) }));
    return { file: r.file, findings, known: findings.filter((f) => f.known).length };
  });
  const total = counted.reduce((n, r) => n + r.findings.length, 0);
  const knownTotal = counted.reduce((n, r) => n + r.known, 0);
  const stale = unreported(linted, exceptions, known);

  const lines = [`hadolint: ${image || '(no image)'}, with ${CONFIG}, over ${plural(files.length, 'Dockerfile')} git lists; report only`];
  const md = [
    '## hadolint, report only',
    '',
    `\`${image || '(no image)'}\` with \`${CONFIG}\`, which ignores ${IGNORED.join(' and ')} and nothing else, one run per Dockerfile git lists. ` +
      'No finding fails this job: it is report only, until a pull request of its own makes it blocking (workplan 0119). ' +
      "A known finding is one that `a-dockerfile-that-ends-as-root`'s EXCEPTIONS explain, or one KNOWN_FINDINGS records (both in " +
      '`scripts/hadolint-report.mjs`), and is listed with why it stands.',
    '',
  ];

  if (stopped) {
    lines.push(`not linted: ${stopped}`);
  } else {
    md.push('| Dockerfile | findings | known | to read |', '| --- | ---: | ---: | ---: |');
    for (const r of results) {
      const c = counted.find((x) => x.file === r.file);
      if (c) md.push(`| \`${r.file}\` | ${c.findings.length} | ${c.known} | ${c.findings.length - c.known} |`);
      else md.push(`| \`${r.file}\` | not linted | | |`);
    }
    md.push(`| **${plural(files.length, 'Dockerfile')}** | **${total}** | **${knownTotal}** | **${total - knownTotal}** |`, '');
    for (const r of results) {
      const c = counted.find((x) => x.file === r.file);
      if (!c) {
        lines.push(`${r.file}: not linted: ${r.error}`);
        continue;
      }
      lines.push(`${r.file}: ${plural(c.findings.length, 'finding')}, ${c.known} known`);
      for (const f of c.findings) lines.push(`  ${f.line} ${f.code} ${f.level}: ${f.message}${f.known ? ` [known: ${f.known.by}]` : ''}`);
      if (c.findings.length === 0) continue;
      md.push(`### \`${r.file}\``, '', '| line | rule | level | what hadolint says | known |', '| ---: | --- | --- | --- | --- |');
      for (const f of c.findings) md.push(`| ${f.line} | ${ruleLink(f.code)} | ${cell(f.level)} | ${cell(f.message)} | ${f.known ? cell(f.known.by) : ''} |`);
      const reasons = new Map(c.findings.filter((f) => f.known).map((f) => [f.known.by, f.known.why]));
      if (reasons.size) md.push('', ...[...reasons].map(([by, why]) => `- **${by}**: ${why}`));
      md.push('');
    }
  }

  if (failed) {
    md.push('### Not linted', '');
    if (stopped) {
      md.push(`Nothing was linted: ${cell(stopped)}.`);
      if (files.length) md.push('', `The Dockerfiles git lists: ${files.map((f) => `\`${f}\``).join(', ')}.`);
    }
    for (const u of stopped ? [] : unlinted) md.push(`- \`${u.file}\`: ${cell(u.error)}`);
    md.push(
      '',
      pr
        ? 'On a pull request that is a warning, and this job passes all the same.'
        : 'Outside a pull request that fails this job: here the run is the record, and a record of what was not linted is not green.',
      '',
    );
  }

  if (stale.length) {
    md.push('### Known, and not reported this run', '');
    for (const s of stale) {
      const line = `\`${s.file}\`: ${s.codes.join(' or ')} (${s.by}) is known, and hadolint did not report it here; if the file no longer breaks the rule, the entry goes`;
      md.push(`- ${line}`);
      lines.push(line.replace(/`/g, ''));
    }
    md.push('');
  }

  const tally = `${plural(total, 'finding')} in ${plural(counted.length, 'Dockerfile')} linted of ${files.length}: ${knownTotal} known, ${total - knownTotal} to read.`;
  md.push(`**${tally}**`, '');
  lines.push(`${tally} Report only: no finding fails this job.`);
  if (failed) {
    const what = files.length === 0 ? 'no Dockerfile was linted' : `${unlinted.length} of ${plural(files.length, 'Dockerfile')} not linted`;
    lines.push(pr ? `::warning::hadolint: ${what}; on a pull request the job passes all the same (the summary says why).` : `::error::hadolint: ${what}; outside a pull request the run is the record, so it fails.`);
  }
  return { markdown: `${md.join('\n')}\n`, lines, code };
}

/** The real `docker`: its status, its output and its error, never a throw. */
const realDocker = (args) =>
  spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: args[0] === 'pull' ? 300_000 : 120_000 });

/** Pulls the image, in `PULL_DELAYS.length + 1` attempts. Null once pulled, or why it was not. */
async function pull(image, docker, wait) {
  let why = '';
  for (let attempt = 1; attempt <= PULL_DELAYS.length + 1; attempt += 1) {
    const ran = docker(['pull', '--quiet', image]);
    if (!ran.error && ran.status === 0) return null;
    why = ran.error ? `docker could not be run (${ran.error.code ?? ran.error.message})` : `docker exited ${ran.status}${firstLine(ran.stderr) ? `: ${firstLine(ran.stderr)}` : ''}`;
    if (attempt <= PULL_DELAYS.length) await wait(PULL_DELAYS[attempt - 1] * 1000);
  }
  return `${image} was not pulled in ${PULL_DELAYS.length + 1} attempts (the last: ${why})`;
}

/**
 * One run: the image checked, every Dockerfile listed, the image pulled, and
 * each file linted, then reported. `docker` and `wait` are the guard's to
 * stub; the event is `GITHUB_EVENT_NAME`, which Actions sets.
 */
export async function run({
  root = REPO_ROOT,
  env = process.env,
  docker = realDocker,
  wait = sleep,
  uid = process.getuid?.() ?? 0,
  gid = process.getgid?.() ?? 0,
} = {}) {
  const event = env.GITHUB_EVENT_NAME ?? '';
  const image = env.HADOLINT_IMAGE ?? '';
  const files = dockerfiles(root);
  const base = { image, event, files };
  if (!IMAGE.test(image)) {
    return report({ ...base, stopped: `HADOLINT_IMAGE is ${image ? `\`${image}\`` : 'not set'}, not hadolint/hadolint:v<x.y.z>@sha256:<index digest>` });
  }
  if (files.length === 0) return report({ ...base, stopped: 'git lists no Dockerfile here' });
  const pulled = await pull(image, docker, wait);
  if (pulled) return report({ ...base, stopped: pulled });
  return report({ ...base, results: files.map((file) => findingsOf(file, docker(lintArgs(image, file, { root, uid, gid })))) });
}

async function main() {
  const out = await run();
  for (const line of out.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, out.markdown);
  return out.code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      // A fault here is no finding either: a pull request passes, and the record fails (REPORT ONLY).
      const pr = process.env.GITHUB_EVENT_NAME === 'pull_request';
      console.log(`${pr ? '::warning::' : '::error::'}hadolint-report stopped: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = pr ? 0 : 1;
    },
  );
}
