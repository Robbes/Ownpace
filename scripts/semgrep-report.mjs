#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * SEMGREP OVER THE TREE, EIGHT NAMED RULES, TWO OF THEM BLOCKING (workplan
 * 0163 T3 and T5; the owner's decision D3 of 2026-11-20: a named list of
 * rules, not whole packs, report only first, the two ReDoS rules never
 * blocking; then a rule blocks once it reports nothing on `main`).
 *
 * An outside, read-only check of 2026-11-20 listed five classes of finding in
 * this tree that no check in CI had a rule for. Semgrep's community rules have
 * one for four of them (0163 §4.3): a regular expression built at run time
 * (ReDoS, its finding 5, two rules), a path joined from a value (6), the
 * browser sent to an address a function returned (8), and a React link to an
 * address from a value (9). Three more rules found a spot each when that plan
 * measured Semgrep on this tree: an AES-GCM decipher with no tag length, a
 * workflow expression inside a `run:` script, and a value written inside a
 * `<script>` tag. So
 * `.github/workflows/semgrep.yml` runs this, which runs Semgrep with those
 * eight rules (`RULES`) over the checkout and writes what each found, spot by
 * spot, to the job's summary.
 *
 * THE RULES ARE FETCHED BY ID, from Semgrep's registry, when the job runs
 * (`--config r/<id>`). No copy of a rule is kept in this repository, so the
 * Semgrep Rules License, which governs a copy, is not in question (0163 D3).
 * A rule renamed or withdrawn upstream makes the fetch fail, and that is a
 * scan that did not finish, below.
 *
 * KNOWN, NOT IGNORED. A spot workplan 0163 read and left as it stands
 * (`KNOWN_FINDINGS`, by rule and file) is marked known, with its reason, and
 * is still listed. A known one Semgrep did not report is named too, so the
 * record can shrink as files change. The two ReDoS rules never block (D3):
 * each flags how a pattern is built, not what reaches it, and every one of
 * their spots outside the tests was read as fed a constant or an escaped
 * value. Their spots are listed under them and counted apart.
 *
 * TWO RULES BLOCK, THE REST REPORT (0163 T5, §5 step 5). A rule turns
 * blocking once it reports nothing on `main`, one at a time, each in a pull
 * request that says so (`blocks` in `RULES`). `react-href-var` and
 * `run-shell-injection` reported nothing on `main` at `5d5c5f55` (run
 * 44881711422), so they block. A spot of either fails this job, on a pull
 * request, a push and a dispatch alike, and is marked on its line as an
 * error. No entry excuses it: `KNOWN_FINDINGS` holds none for a rule that
 * blocks, and none is read for one. Every other rule reports only: its spots
 * are listed, the ones no entry explains marked on their lines as warnings,
 * and they fail nothing. Semgrep itself runs without `--error`; this decides.
 *
 * A SCAN THAT DID NOT FINISH FAILS THE JOB, on every event: on a pull request
 * the job is a required check that vouches for the rules that block, and on a
 * push or a dispatch the run is the record, and a scan that skipped itself is
 * not green (security-scan.yml's rule). Not finished means: the image not
 * pulled, Semgrep exiting anything but 0, a report it did not write or not in
 * its shape, a Semgrep that does not call itself the pinned release, a named
 * rule it did not run, a rule it ran that is not named, or fewer than
 * `MIN_FILES` files scanned.
 *
 * HOW IT RUNS SEMGREP. The image by tag and index digest (`SEMGREP_IMAGE`, the
 * workflow's), pulled once, in three attempts 5 and 15 seconds apart, then run
 * with `--pull never`, no capability, no new privilege, as the image's own
 * `semgrep` user (`SEMGREP_USER`, uid 1000, whose home holds the git setting
 * that lets it read /src), with the checkout mounted read-only and one
 * directory mounted for its two reports: JSON, read here, and SARIF, which the
 * workflow sends to code scanning from a push to `main`. That directory is the
 * runner's own temporary one, opened to that user. It has the network, which
 * the rules' fetch needs, and runs with `--metrics=off` and
 * `--disable-version-check`, so it sends nothing else. With no `.semgrepignore` here, Semgrep's own default
 * leaves out `test/`, `tests/`, `node_modules/`, `dist/` and `build/`; this
 * adds no exclusion of its own.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs in a CI step on
 * a bare checkout, with no `node_modules`, and needs no type stripping. Its
 * guard, `scripts/a-finding-only-an-outside-check-saw.unit.test.ts`, runs it
 * with a stubbed `docker`.
 *
 * Usage:  SEMGREP_IMAGE=semgrep/semgrep:<x.y.z>@sha256:<digest> node scripts/semgrep-report.mjs
 * Exit: 0 when the scan finished and no rule that blocks found a spot; 1
 * otherwise, on every event.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The image this runs: Semgrep's own, by a release tag and its index digest. */
export const IMAGE = /^semgrep\/semgrep:(\d+\.\d+\.\d+)@sha256:[0-9a-f]{64}$/;

/** The seconds between the pull's attempts: three attempts, then the image is not there. */
export const PULL_DELAYS = [5, 15];

/** The image's own user, `semgrep`, by number: `adduser -u 1000` in its build, with /src a safe git directory in its home. */
export const SEMGREP_USER = '1000:1000';

/**
 * The fewest files a finished scan reads. The three measure runs of workplan
 * 0163 read 2,209 to 2,929 per pack; a scan that reads fewer than this read
 * another directory, or a checkout that is not there.
 */
export const MIN_FILES = 1000;

/** The two reports' file names, in the directory mounted for them. */
export const JSON_REPORT = 'semgrep.json';
export const SARIF_REPORT = 'semgrep.sarif';

/**
 * The rules, by their registry id, in the order the summary lists them, with
 * the outside check's finding each answers (null for the three the measure
 * runs added), what it reports, whether it may ever block (`never`, D3), and
 * whether it blocks now (`blocks`, TWO RULES BLOCK above).
 */
export const RULES = [
  {
    id: 'javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp',
    finding: 5,
    never: true,
    blocks: false,
    what: 'a regular expression built at run time from a value',
  },
  {
    id: 'javascript.lang.security.audit.detect-redos.detect-redos',
    finding: 5,
    never: true,
    blocks: false,
    what: 'a regular expression whose own shape can backtrack for a long time',
  },
  {
    id: 'javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal',
    finding: 6,
    never: false,
    blocks: false,
    what: 'a path joined or resolved from a value',
  },
  {
    id: 'javascript.browser.security.open-redirect-from-function.js-open-redirect-from-function',
    finding: 8,
    never: false,
    blocks: false,
    what: 'the browser sent to an address a function returned',
  },
  {
    id: 'typescript.react.security.audit.react-href-var.react-href-var',
    finding: 9,
    never: false,
    blocks: true,
    what: 'a React link to an address from a value, which can be a `javascript:` address',
  },
  {
    id: 'javascript.node-crypto.security.gcm-no-tag-length.gcm-no-tag-length',
    finding: null,
    never: false,
    blocks: false,
    what: 'an AES-GCM decipher that does not name its tag length',
  },
  {
    id: 'yaml.github-actions.security.run-shell-injection.run-shell-injection',
    finding: null,
    never: false,
    blocks: true,
    what: 'a workflow expression written into a `run:` script',
  },
  {
    id: 'javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag',
    finding: null,
    never: false,
    blocks: false,
    what: 'a value written inside a `<script>` tag',
  },
];

/** A rule's own name: the last part of its registry id. */
export const nameOf = (id) => String(id).split('.').at(-1) ?? '';

/**
 * Which named rule an id Semgrep reports is: the id itself, the id with a
 * prefix Semgrep put before it, or the rule's own name. Null for none.
 */
export function ruleOf(reported, rules = RULES) {
  const id = String(reported);
  return rules.find((r) => id === r.id || id.endsWith(`.${r.id}`) || nameOf(id) === nameOf(r.id)) ?? null;
}

/**
 * What workplan 0163 read and left as it stands, by rule (its own name) and
 * file, with why. Known in the summary, never ignored.
 */
export const KNOWN_FINDINGS = {
  'path-join-resolve-traversal': {
    'apps/worker/src/index.ts':
      "the path is the worker CLI's own `--config` argument, given by whoever runs the command, not a value a request carries (workplan 0163 §4.3)",
  },
  'unknown-value-with-script-tag': {
    'apps/api/src/routes/migrations/google-consent.ts':
      'what goes inside the script travels as a JSON string, through `jsString`, so no word in it can end the string or the script (workplan 0163 §4.3)',
  },
};

/** A test file, by its path: `*.test.*`, or a file in a `__tests__` or `__testing__` directory. */
export const TEST_FILE = /\.test\.[cm]?[jt]sx?$|(^|\/)__(tests|testing)__\//;

/** What Semgrep's exit codes say (its `error.py`); 0 is the only one a finished scan gives here. */
export const EXIT_MEANINGS = {
  1: 'findings under --error, which this does not pass',
  2: 'a fatal error',
  3: 'a file it could not parse, under --strict',
  4: 'a rule it could not parse',
  5: 'a config that is not valid YAML',
  7: 'a config it could not find or fetch',
  8: 'a language it does not know',
  13: 'an API key it did not accept',
};

/** `table[key]` when the table holds that key itself: a path or a name is never one of Object's own. */
const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The first line of what a command wrote, at most 300 characters, as a reason. */
const firstLine = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 300);

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Why a spot of `rule` (its own name) in `file` stands, when KNOWN_FINDINGS says: the reason, or null. */
export function knownAs(rule, file, known = KNOWN_FINDINGS) {
  return own(own(known, rule) ?? {}, file) ?? null;
}

/**
 * The `docker run` that scans the checkout (HOW IT RUNS SEMGREP, above).
 * Semgrep scans its working directory, the checkout, so its findings name
 * each file by its path from the repository's root.
 */
export function scanArgs(image, { root, out }, rules = RULES) {
  return [
    'run', '--rm', '--pull', 'never',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', SEMGREP_USER,
    '--volume', `${root}:/src:ro`, '--volume', `${out}:/out`, '--workdir', '/src',
    image,
    'semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet',
    ...rules.flatMap((r) => ['--config', `r/${r.id}`]),
    `--json-output=/out/${JSON_REPORT}`,
    `--sarif-output=/out/${SARIF_REPORT}`,
  ];
}

/** A JSON file, parsed, or why it could not be read: `{ value }` or `{ error }`. */
function readJson(path, what) {
  if (!existsSync(path)) return { error: `Semgrep wrote no ${what}` };
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { error: `Semgrep's ${what} is not JSON (${firstLine(e instanceof Error ? e.message : e)})` };
  }
}

/**
 * What one run of Semgrep left: the scan's reading, or why there is none
 * (`stopped`). Semgrep without `--error` exits 0 whatever it found; any other
 * exit is a scan that did not finish. Its JSON report gives the findings, the
 * files it scanned and its notes; its SARIF report, the rules it ran, which
 * it lists whether or not they matched.
 */
export function readScan(ran, out) {
  const { status, stderr, error, signal } = ran;
  if (error) return { stopped: `docker could not be run (${error.code ?? error.message})` };
  if (status !== 0) {
    if (status === null) return { stopped: `docker was stopped by ${signal ?? 'a signal'}` };
    const meaning = own(EXIT_MEANINGS, String(status));
    return { stopped: `Semgrep exited ${status}${meaning ? ` (${meaning})` : ''}${firstLine(stderr) ? `: ${firstLine(stderr)}` : ''}` };
  }
  const json = readJson(join(out, JSON_REPORT), 'JSON report');
  if (json.error) return { stopped: json.error };
  const report = json.value;
  if (!report || typeof report !== 'object' || !Array.isArray(report.results) || !Array.isArray(report.errors) || !Array.isArray(report.paths?.scanned)) {
    return { stopped: "Semgrep's JSON report has no results, errors and scanned paths, the shape it writes" };
  }
  const findings = [];
  for (const r of report.results) {
    if (!r || typeof r.check_id !== 'string' || typeof r.path !== 'string' || !Number.isInteger(r.start?.line) || typeof r.extra?.message !== 'string') {
      return { stopped: `Semgrep's JSON report holds a finding without a rule, a path, a line and a message: ${JSON.stringify(r).slice(0, 300)}` };
    }
    findings.push({ rule: r.check_id, path: r.path, line: r.start.line, message: r.extra.message });
  }
  const sarif = readJson(join(out, SARIF_REPORT), 'SARIF report');
  if (sarif.error) return { stopped: sarif.error };
  const listed = sarif.value?.runs?.[0]?.tool?.driver?.rules;
  if (!Array.isArray(listed) || listed.some((r) => typeof r?.id !== 'string')) {
    return { stopped: "Semgrep's SARIF report lists no rules it ran, the shape it writes" };
  }
  const notes = report.errors.map((e) => ({
    level: String(e?.level ?? ''),
    type: Array.isArray(e?.type) ? String(e.type[0]) : String(e?.type ?? ''),
    path: typeof e?.path === 'string' ? e.path : '',
    message: firstLine(e?.message),
  }));
  return {
    version: typeof report.version === 'string' ? report.version : '',
    scanned: report.paths.scanned.length,
    findings,
    notes,
    ran: listed.map((r) => r.id),
    sarif: join(out, SARIF_REPORT),
  };
}

/** A table cell: one line, its bars escaped, nothing a renderer reads as HTML or as code. */
const cell = (text) =>
  String(text).replace(/\s*\n\s*/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`/g, "'").replace(/\|/g, '\\|');

/** A workflow command's message, and one of its properties, escaped as GitHub reads them. */
const commandData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const commandProperty = (text) => commandData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** A rule's page in the registry. */
const ruleLink = (rule) => `[\`${nameOf(rule.id)}\`](https://semgrep.dev/r/${rule.id})`;

/** What the summary says the outside check called a rule's class. */
const findingOf = (rule) => (rule.finding === null ? 'none (found by the measure runs)' : String(rule.finding));

/** Whether a rule blocks, as the summary's table says it. */
const blocksOf = (rule) => (rule.never ? 'never (D3)' : rule.blocks ? '**yes**' : 'not yet');

/** A small count in words, as the summary says it: "the two rules that block". */
const inWords = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][n] ?? String(n);

/** "the two rules that block", "the one rule that never blocks". */
const theRules = (n, that) => `the ${inWords(n)} ${n === 1 ? `rule that ${that}s` : `rules that ${that}`}`;

/** Names in a sentence: `a`, `a and b`, `a, b and c`. */
const inSentence = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * The report of one run: the job summary's Markdown, the log's lines, the exit
 * code (TWO RULES BLOCK and A SCAN THAT DID NOT FINISH, above), and the SARIF
 * report's path when the scan finished. `stopped` says why there is no reading
 * at all.
 */
export function report({ image, event, stopped = null, version = '', scanned = 0, findings = [], notes = [], ran = [], sarif = '', rules = RULES, known = KNOWN_FINDINGS }) {
  const pr = event === 'pull_request';
  const tag = IMAGE.exec(image)?.[1] ?? '';
  const problems = [];
  if (stopped) {
    problems.push(stopped);
  } else {
    if (version !== tag) problems.push(`the Semgrep this ran calls itself ${version || 'nothing'}, not ${tag}, the release SEMGREP_IMAGE pins`);
    for (const rule of rules) if (!ran.some((id) => ruleOf(id, [rule]))) problems.push(`Semgrep did not run ${rule.id}`);
    for (const id of ran) if (!ruleOf(id, rules)) problems.push(`Semgrep ran ${id}, which RULES does not name`);
    const strays = [...new Set(findings.filter((f) => !ruleOf(f.rule, rules)).map((f) => f.rule))];
    for (const id of strays) problems.push(`Semgrep reported ${id}, which RULES does not name`);
    if (scanned < MIN_FILES) problems.push(`Semgrep scanned ${plural(scanned, 'file')}, fewer than the ${plural(MIN_FILES, 'file')} a scan of this tree reads`);
  }
  const failed = problems.length > 0;

  const byRule = rules.map((rule) => {
    const spots = findings
      .filter((f) => ruleOf(f.rule, [rule]))
      // A rule that blocks is never excused: no entry is read for it (TWO RULES BLOCK, above).
      .map((f) => ({ ...f, known: rule.blocks ? null : knownAs(nameOf(rule.id), f.path, known) }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const knownCount = spots.filter((s) => s.known).length;
    return { rule, spots, known: knownCount, toRead: rule.never ? 0 : spots.length - knownCount, tests: spots.filter((s) => TEST_FILE.test(s.path)).length };
  });
  const total = byRule.reduce((n, r) => n + r.spots.length, 0);
  const knownTotal = byRule.reduce((n, r) => n + r.known, 0);
  const neverTotal = byRule.filter((r) => r.rule.never).reduce((n, r) => n + r.spots.length - r.known, 0);
  const toRead = byRule.reduce((n, r) => n + r.toRead, 0);
  const blocking = byRule.filter((r) => r.rule.blocks);
  const blocked = blocking.reduce((n, r) => n + r.spots.length, 0);
  const code = failed || blocked > 0 ? 1 : 0;
  const blockNames = inSentence(blocking.map((r) => `\`${nameOf(r.rule.id)}\``));
  const never = rules.filter((r) => r.never).length;

  const lines = [`Semgrep: ${image || '(no image)'}, ${plural(rules.length, 'rule')} fetched by id, over the checkout; ${blocking.length ? `${blockNames.replace(/`/g, '')} block` : 'no rule blocks'}`];
  const md = [
    '## Semgrep',
    '',
    `\`${image || '(no image)'}\` with the ${plural(rules.length, 'rule')} \`RULES\` names in \`scripts/semgrep-report.mjs\`, each fetched from Semgrep's registry by its id, over the checkout. ` +
      (blocking.length ? `A spot of a rule that blocks fails this job: ${blockNames} (workplan 0163 T5). ` : 'No rule blocks yet. ') +
      `The others report only, until each reports nothing on \`main\` and turns blocking in a pull request of its own, and ${theRules(never, 'never block')} (D3). ` +
      'A known spot is one `KNOWN_FINDINGS` in that script records, listed with why it stands; no entry excuses a rule that blocks.',
    '',
  ];

  if (!stopped) {
    md.push(
      "| rule | the outside check's finding | blocks | spots | in test files | known | to read |",
      '| --- | --- | --- | ---: | ---: | ---: | ---: |',
      ...byRule.map((r) => `| ${ruleLink(r.rule)} | ${findingOf(r.rule)} | ${blocksOf(r.rule)} | ${r.spots.length} | ${r.tests} | ${r.known} | ${r.rule.never ? '' : r.toRead} |`),
      `| **${plural(rules.length, 'rule')}** | | | **${total}** | **${byRule.reduce((n, r) => n + r.tests, 0)}** | **${knownTotal}** | **${toRead}** |`,
      '',
      `Semgrep ${cell(version || '(no version)')} scanned ${plural(scanned, 'file')}${notes.length ? `, with ${plural(notes.length, 'note')} (below)` : ''}.`,
      '',
    );
    lines.push(`Semgrep ${version || '(no version)'} scanned ${plural(scanned, 'file')}${notes.length ? `, with ${plural(notes.length, 'note')} on what it could not read in full` : ''}.`);
    for (const r of byRule) {
      for (const s of r.spots) lines.push(`${nameOf(r.rule.id)} ${s.path}:${s.line}${s.known ? ' [known]' : ''}${r.rule.never ? ' [never blocks]' : ''}${r.rule.blocks ? ' [blocks]' : ''}`);
      if (r.spots.length === 0) continue;
      md.push(`### ${ruleLink(r.rule)}: ${cell(r.rule.what)}`, '');
      const rows = ['| file | line | known |', '| --- | ---: | --- |', ...r.spots.map((s) => `| \`${cell(s.path)}\` | ${s.line} | ${s.known ? 'KNOWN_FINDINGS' : ''} |`)];
      if (r.rule.never) {
        md.push(`This rule never blocks (D3). ${plural(r.tests, 'spot')} of ${r.spots.length} ${r.tests === 1 ? 'is' : 'are'} in test files.`, '', '<details><summary>Every spot</summary>', '', ...rows, '', '</details>');
      } else {
        if (r.rule.blocks) md.push('**This rule blocks** (workplan 0163 T5): each spot below fails this job.', '');
        md.push(`What Semgrep says: ${cell(r.spots[0].message)}`, '', ...rows);
      }
      const reasons = [...new Map(r.spots.filter((s) => s.known).map((s) => [s.path, s.known]))];
      if (reasons.length) md.push('', ...reasons.map(([path, why]) => `- **\`${cell(path)}\`**: ${cell(why)}`));
      md.push('');
    }
    if (notes.length) {
      md.push('### Notes', '', 'What Semgrep could not read in full, which it reads around; none stops the scan.', '', '| level | kind | file | what it says |', '| --- | --- | --- | --- |');
      for (const n of notes) md.push(`| ${cell(n.level)} | ${cell(n.type)} | ${n.path ? `\`${cell(n.path)}\`` : ''} | ${cell(n.message)} |`);
      md.push('');
    }
    const stale = [];
    for (const [rule, files] of Object.entries(known)) {
      for (const path of Object.keys(files)) {
        if (!findings.some((f) => nameOf(f.rule) === rule && f.path === path)) stale.push(`\`${path}\`: ${rule} is known, and Semgrep did not report it here; if the spot is gone, the entry goes`);
      }
    }
    if (stale.length) {
      md.push('### Known, and not reported this run', '', ...stale.map((s) => `- ${s}`), '');
      lines.push(...stale.map((s) => s.replace(/`/g, '')));
    }
    // Each spot of a rule that blocks is an error on its line. A spot of a rule
    // that only reports, and no entry explains, is a warning there, so a pull
    // request that adds one sees it on the line.
    for (const r of byRule) {
      if (r.rule.never) continue;
      for (const s of r.spots.filter((x) => !x.known)) {
        const [kind, how] = r.rule.blocks ? ['error', 'blocks'] : ['warning', 'report only'];
        lines.push(`::${kind} file=${commandProperty(s.path)},line=${s.line},title=${commandProperty(`Semgrep ${nameOf(r.rule.id)} (${how})`)}::${commandData(s.message)}`);
      }
    }
  }

  if (failed) {
    md.push('### The scan did not finish', '', ...problems.map((p) => `- ${cell(p)}`), '');
    md.push(
      pr
        ? 'That fails this job: a scan that did not finish vouches for no rule that blocks, and on a pull request this job is a required check.'
        : 'That fails this job: here the run is the record, and a record of a scan that did not finish is not green.',
      '',
    );
    for (const p of problems) lines.push(`not finished: ${p}`);
  }

  const tally = stopped
    ? 'No reading: the scan did not run.'
    : `${plural(total, 'spot')} from ${plural(rules.length, 'rule')}: ${blocked} under ${theRules(blocking.length, 'block')}, ${neverTotal} under ${theRules(never, 'never block')}, ${knownTotal} known, ${toRead} to read.`;
  md.push(`**${tally}**`, '');
  if (!stopped && blocked > 0) md.push(`**${plural(blocked, 'spot')} of a rule that blocks: this job fails.**`, '');
  lines.push(`${tally} ${stopped ? '' : blocked > 0 ? `The rules that block found ${plural(blocked, 'spot')}: this job fails.` : 'No rule that blocks found a spot.'}`.trim());
  if (!stopped && blocked > 0) {
    lines.push(`::error::Semgrep: ${plural(blocked, 'spot')} of ${blockNames.replace(/`/g, '')}, which block (workplan 0163 T5); each is marked on its line.`);
  }
  if (failed) {
    lines.push('::error::Semgrep: the scan did not finish, so it vouches for no rule that blocks, and this job fails (the summary says why).');
  }
  return { markdown: `${md.join('\n')}\n`, lines, code, sarif: failed ? '' : sarif };
}

/** The real `docker`: its status, its output and its error, never a throw. */
const realDocker = (args) =>
  spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: args[0] === 'pull' ? 300_000 : 600_000 });

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
 * One run: the image checked, pulled, and run once over the checkout, then
 * reported. `docker` and `wait` are the guard's to stub, and `out` the
 * directory the reports land in: under the runner's temporary directory,
 * cleared of an earlier run's reports, and writable by the image's user,
 * whose uid is not the runner's. The event is `GITHUB_EVENT_NAME`, which
 * Actions sets.
 */
export async function run({
  root = REPO_ROOT,
  env = process.env,
  docker = realDocker,
  wait = sleep,
  out = join(env.RUNNER_TEMP || tmpdir(), 'semgrep-report'),
} = {}) {
  const event = env.GITHUB_EVENT_NAME ?? '';
  const image = env.SEMGREP_IMAGE ?? '';
  const base = { image, event };
  if (!IMAGE.test(image)) {
    return report({ ...base, stopped: `SEMGREP_IMAGE is ${image ? `\`${image}\`` : 'not set'}, not semgrep/semgrep:<x.y.z>@sha256:<index digest>` });
  }
  mkdirSync(out, { recursive: true });
  chmodSync(out, 0o777);
  for (const file of [JSON_REPORT, SARIF_REPORT]) rmSync(join(out, file), { force: true });
  const pulled = await pull(image, docker, wait);
  if (pulled) return report({ ...base, stopped: pulled });
  return report({ ...base, ...readScan(docker(scanArgs(image, { root, out })), out) });
}

async function main() {
  const out = await run();
  for (const line of out.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, out.markdown);
  const output = process.env.GITHUB_OUTPUT;
  if (output && out.sarif) appendFileSync(output, `sarif=${out.sarif}\n`);
  return out.code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      // A fault here vouches for no rule that blocks: the job fails, on every event (A SCAN THAT DID NOT FINISH, above).
      console.log(`::error::semgrep-report stopped: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
