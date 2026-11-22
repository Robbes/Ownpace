#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * SEMGREP OVER THE TREE, EIGHT NAMED RULES, ONE OF THEM BLOCKING (workplan
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
 * ONE RULE BLOCKS, THE REST REPORT (0163 T5, §5 step 5). A rule turns
 * blocking once it reports nothing on `main` and none of its time-outs can
 * leave a scan unfinished there, one at a time, each in a pull request that
 * says so (`blocks` in `RULES`). `run-shell-injection` reports nothing on
 * `main` and, a YAML rule without taint mode, never reaches the taint
 * analysis's time limit, so it blocks. Semgrep's other limits still hold
 * for it: its per-file time limit (`--timeout`, 5 seconds by default) and a
 * file it could not parse land in its errors, and a note on a workflow or
 * action file (`isHome`), or on no file naming the rule that blocks, is a
 * scan that did not finish. A note on other YAML, the lock file or a compose
 * file GitHub never runs, is a note. A spot of it fails this
 * job, on a pull request, a push and a dispatch alike, and is marked on its
 * line as an error. No entry excuses it: `KNOWN_FINDINGS` holds none for a
 * rule that blocks, and none is read for one (NOTHING IN THE TREE SWITCHES A
 * RULE OFF, below). Every other rule reports only: its spots are listed, the ones no
 * entry explains marked on their lines as warnings, and they fail nothing.
 * Semgrep itself runs without `--error`; this decides.
 *
 * `react-href-var` also reports nothing on `main`, and does not block yet: it
 * is a taint rule over JavaScript and TypeScript, and `main`'s run at
 * `0683eb04` (45025731298) read 13 places only in part, 10 of them in a
 * JavaScript or TypeScript file where more than one rule timed out, one of
 * them naming it first. Blocking, it would make every such run a scan that
 * did not finish (READ ONLY IN PART, below).
 *
 * A SCAN THAT DID NOT FINISH FAILS THE JOB, on every event: on a pull request
 * the job vouches for the rule that blocks, and on a push or a dispatch the
 * run is the record, and a scan that skipped itself is not green
 * (security-scan.yml's rule). Not finished means: the image not pulled,
 * Semgrep exiting anything but 0, a report it did not write or not in its
 * shape (its timing section included), a Semgrep that does not call itself
 * the pinned release, a named rule it did not run, a rule it ran that is not
 * named, fewer than `MIN_FILES` files scanned, or a place it read only in
 * part where a rule that blocks can have timed out (READ ONLY IN PART,
 * below), a note on a file a rule that blocks reads, a `.semgrepignore` the
 * checkout tracks, or git not listing what it tracks. The rules are fetched
 * from Semgrep's registry by id as the job runs, not pinned: a registry that
 * does not answer fails a pull request until a re-run; a rule renamed or
 * withdrawn upstream fails every pull request, and a re-run does not help;
 * and an upstream edit to the rule that blocks changes what blocks with no
 * change here.
 *
 * READ ONLY IN PART. Semgrep's taint analysis gives each function, and each
 * file's top level, a time limit of its own. A rule that reaches it there
 * reads on without that analysis, so a spot it would have reported there is
 * not reported, and Semgrep still exits 0: a run of this on `main` read one
 * spot fewer than its pull request's last run on the same tree (0163's
 * Status, 2026-11-21). Semgrep names such a place only in its timing
 * section, which `--time` adds to its JSON report as
 * `time.fixpoint_timeouts`, never among its errors: one entry per function,
 * with how many rules timed out there and the first of them. So this runs
 * it with `--time` and lists each place under "Read only in part". A place
 * where only a rule that never blocks timed out is listed. One where a rule
 * that may block can have timed out is marked on its line as well, as a spot
 * of that rule is. One where a rule that blocks can have timed out is a scan
 * that did not finish, since a spot that rule would fail on can be missing.
 * Which rules can have timed out at a place (`timedOut`): Semgrep names the
 * first and counts the rest, so the first alone when it counts one, and
 * otherwise every rule whose languages include the file there (`languages`
 * in `RULES`, by `languageOf` its extension), since a rule never reads a file
 * outside its languages. A place whose file has no language here, or whose
 * first rule's languages do not include it, can have any rule timed out.
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
 * `--disable-version-check`, so it sends nothing else. With no `.semgrepignore`
 * here, Semgrep's own built-in ignore list leaves directories out at any
 * depth, `test/`, `tests/`, `testsuite/`, `node_modules/`, `dist/`, `build/`
 * and `vendor/` among them (its `Semgrepignore.ml`); it also skips a file
 * over its size limit, a link, and an extension in a case its languages do
 * not name. This adds no exclusion of its own.
 *
 * NOTHING IN THE TREE SWITCHES A RULE OFF. Semgrep runs with
 * `--disable-nosem`, so an inline `nosemgrep` comment silences no spot:
 * without it, Semgrep leaves such a spot out of the JSON report this reads
 * (its SARIF keeps it, marked suppressed), and a pull request could switch
 * the rule that blocks off in the line it adds, as `zizmor.yml` refuses with
 * `--no-ignores`. And a `.semgrepignore` the checkout tracks, at any depth
 * (`trackedIgnores`, read with `git ls-files` before anything runs), is a
 * scan that did not finish: one at `.github/` would leave every workflow out,
 * the YAML rule would read nothing, and the rest would still count more than
 * `MIN_FILES`. And every workflow and action file the checkout tracks
 * (`isWorkflowFile`, from the same `git ls-files`) must be among the files
 * Semgrep scanned (`paths.scanned`): one it left out for any reason above,
 * which it says nothing of, is a scan that did not finish, said by name.
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

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
/** What code scanning receives: SARIF_REPORT without the rules that never block (forCodeScanning). */
export const CODE_SCANNING_REPORT = 'semgrep-code-scanning.sarif';

/**
 * The rules, by their registry id, in the order the summary lists them, with
 * the outside check's finding each answers (null for the three the measure
 * runs added), what it reports, whether it may ever block (`never`, D3),
 * whether it blocks now (`blocks`, ONE RULE BLOCKS above), and the languages
 * its own `languages:` names (`languages`, read for a time-out, READ ONLY IN
 * PART above). The languages were read from each rule's source in Semgrep's
 * rules repository on 2026-11-22, at `a5ad1714` of 2026-11-10, the source
 * its registry publishes; the four taint rules there are
 * `detect-non-literal-regexp`, `path-join-resolve-traversal`,
 * `js-open-redirect-from-function` and `react-href-var` (`mode: taint`).
 */
export const RULES = [
  {
    id: 'javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp',
    finding: 5,
    never: true,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'a regular expression built at run time from a value',
  },
  {
    id: 'javascript.lang.security.audit.detect-redos.detect-redos',
    finding: 5,
    never: true,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'a regular expression whose own shape can backtrack for a long time',
  },
  {
    id: 'javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal',
    finding: 6,
    never: false,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'a path joined or resolved from a value',
  },
  {
    id: 'javascript.browser.security.open-redirect-from-function.js-open-redirect-from-function',
    finding: 8,
    never: false,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'the browser sent to an address a function returned',
  },
  {
    id: 'typescript.react.security.audit.react-href-var.react-href-var',
    finding: 9,
    never: false,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'a React link to an address from a value, which can be a `javascript:` address',
  },
  {
    id: 'javascript.node-crypto.security.gcm-no-tag-length.gcm-no-tag-length',
    finding: null,
    never: false,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'an AES-GCM decipher that does not name its tag length',
  },
  {
    id: 'yaml.github-actions.security.run-shell-injection.run-shell-injection',
    finding: null,
    never: false,
    blocks: true,
    languages: ['yaml'],
    what: 'a workflow expression written into a `run:` script',
  },
  {
    id: 'javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag',
    finding: null,
    never: false,
    blocks: false,
    languages: ['javascript', 'typescript'],
    what: 'a value written inside a `<script>` tag',
  },
];

/**
 * The SARIF code scanning receives (workplan 0163, Status 2026-11-21): Semgrep's
 * own, with each result of a rule that never blocks taken out (`never`, the
 * two ReDoS rules, D3). Their spots stay in the job's summary, counted and
 * listed; code scanning lists the spots of the six rules that may block. The
 * rules Semgrep lists as run stay whole, and Semgrep's report is not changed.
 * Returns `{ sarif, kept, dropped }`.
 */
export function forCodeScanning(sarif, rules = RULES) {
  let kept = 0;
  let dropped = 0;
  const runs = (Array.isArray(sarif?.runs) ? sarif.runs : []).map((run) => ({
    ...run,
    results: (Array.isArray(run?.results) ? run.results : []).filter((result) => {
      const never = ruleOf(result?.ruleId ?? '', rules)?.never === true;
      if (never) dropped += 1;
      else kept += 1;
      return !never;
    }),
  }));
  return { sarif: { ...sarif, runs }, kept, dropped };
}

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
 * each file by its path from the repository's root. `--time` adds the timing
 * section to its JSON report, where the places it read only in part are
 * (READ ONLY IN PART, above).
 */
export function scanArgs(image, { root, out }, rules = RULES) {
  return [
    'run', '--rm', '--pull', 'never',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--user', SEMGREP_USER,
    '--volume', `${root}:/src:ro`, '--volume', `${out}:/out`, '--workdir', '/src',
    image,
    'semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--time', '--disable-nosem',
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
 * files it scanned and its notes, and in its timing section the places it
 * read only in part (`timeouts`, null when the report has no such section);
 * its SARIF report, the rules it ran, which it lists whether or not they
 * matched.
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
    // The rule a note is about, when Semgrep names one: a note on no file is still that rule's.
    rule: typeof e?.rule_id === 'string' ? e.rule_id : '',
    message: firstLine(e?.message),
  }));
  const timing = report.time?.fixpoint_timeouts;
  return {
    version: typeof report.version === 'string' ? report.version : '',
    scanned: report.paths.scanned.length,
    // Each file Semgrep scanned, by its path from the checkout's root, as git names it.
    scannedPaths: report.paths.scanned.map((f) => String(f).replace(/^\.\//, '')),
    findings,
    notes,
    timeouts: Array.isArray(timing) ? timing.map(readTimeout) : null,
    ran: listed.map((r) => r.id),
    ...toCodeScanning(sarif.value, out),
  };
}

/** Writes CODE_SCANNING_REPORT beside Semgrep's SARIF, and says how many results it kept and left out. */
function toCodeScanning(sarif, out) {
  const upload = forCodeScanning(sarif);
  writeFileSync(join(out, CODE_SCANNING_REPORT), JSON.stringify(upload.sarif));
  return { sarif: join(out, CODE_SCANNING_REPORT), uploaded: { kept: upload.kept, dropped: upload.dropped } };
}

/**
 * The message Semgrep gives a place it read only in part (`Taint_rule_inst`'s
 * `check_timeouts_and_warn`): the file, line and column of the function, or
 * of the file's top level, how many rules timed out there, and the first.
 */
const TIMED_OUT = /^Fixpoint timeout while performing (?:inter-file )?taint analysis at (.+):(\d+):(\d+) \[rules: (\d+), first: ([^\]]+)\]$/;

/**
 * One entry of `time.fixpoint_timeouts`: its file and line, from its location
 * or else its message, and from its message how many rules timed out there
 * and the first. What it does not say is null (rules, first), empty (the
 * file) or 0 (the line); such an entry is still a place, and any rule can
 * have timed out there (`timedOut`).
 */
function readTimeout(entry) {
  const said = TIMED_OUT.exec(String(entry?.message ?? '').trim());
  const path = typeof entry?.location?.path === 'string' && entry.location.path ? entry.location.path : (said?.[1] ?? '');
  const line = Number.isInteger(entry?.location?.start?.line) ? entry.location.start.line : Number(said?.[2] ?? 0);
  const rules = said ? Number(said[4]) : 0;
  return { path, line, rules: rules >= 1 ? rules : null, first: said ? said[5].trim() : null };
}

/**
 * The file extensions of each language a rule names, and the ones Semgrep
 * leaves out of it, as Semgrep 1.186.0's `lang.json` gives them (`exts` and
 * `excluded_exts`, in its `semgrep_interfaces` at the release's commit
 * `a5844e7c`, read on 2026-11-22): the extension of a file says which rules
 * read it.
 */
export const EXTENSIONS = {
  javascript: ['.cjs', '.js', '.jsx', '.mjs'],
  typescript: ['.ts', '.tsx'],
  yaml: ['.yml', '.yaml'],
};
export const EXCLUDED = {
  javascript: ['.min.js'],
  typescript: ['.d.ts'],
  yaml: [],
};

/**
 * The language of a file by its extension (EXTENSIONS, less EXCLUDED), as
 * written: Semgrep matches an extension by its case, so `a.YML` is no YAML
 * it reads. Null for a file no language here reads, or no file. A null reads
 * as any rule where a place is read (`timedOut`).
 */
export function languageOf(path) {
  const name = String(path ?? '').split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot);
  return Object.keys(EXTENSIONS).find((lang) => own(EXTENSIONS, lang).includes(ext) && !own(EXCLUDED, lang).some((x) => name.endsWith(x))) ?? null;
}

/**
 * A workflow GitHub runs (`.github/workflows/<name>.yml` or `.yaml`) or a
 * composite action's `action.yml` or `action.yaml`, anywhere: the files
 * `run-shell-injection` is there for, since it reads any YAML with `steps:`.
 * In any case, since a file Semgrep would not read by its extension's case is
 * still one GitHub may run.
 */
export function isWorkflowFile(path) {
  const p = String(path ?? '');
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p) || /(^|\/)action\.ya?ml$/i.test(p);
}

/**
 * The files a rule that blocks is there for: a YAML rule's, the workflow and
 * action files (`isWorkflowFile`), not every YAML file GitHub never runs; any
 * other rule's, the files of its languages.
 */
export function isHome(rule, path) {
  const languages = Array.isArray(rule.languages) ? rule.languages : [];
  if (languages.includes('yaml')) return isWorkflowFile(path);
  const language = languageOf(path);
  return language !== null && languages.includes(language);
}

/**
 * The rules that can have timed out at a place (READ ONLY IN PART, above):
 * the first alone, when Semgrep counts one rule there and names it as one of
 * `rules`; otherwise each of `rules` whose languages include the file there,
 * since Semgrep names only the first of several, and an entry that does not
 * say names none. Every one of `rules` when the file has no language here,
 * or when the first Semgrep names does not read that language, since then
 * the place is not read as this says.
 */
export function timedOut(timeout, rules = RULES) {
  const first = timeout.first === null ? null : ruleOf(timeout.first, rules);
  const language = languageOf(timeout.path);
  if (language === null) return timeout.rules === 1 && first ? [first] : [...rules];
  const reading = rules.filter((r) => Array.isArray(r.languages) && r.languages.includes(language));
  if (first && !reading.includes(first)) return [...rules];
  return timeout.rules === 1 && first ? [first] : reading;
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

/** A small count in words, as the summary says it: "the two rules that never block". */
const inWords = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][n] ?? String(n);

/** "the two rules that never block", "the one rule that blocks". */
const theRules = (n, that) => `the ${inWords(n)} ${n === 1 ? `rule that ${that}s` : `rules that ${that}`}`;

/** Text Semgrep gave, a path or a rule's id, on one line: no line break in it starts a workflow command. */
const oneLine = (text) => String(text).replace(/[\r\n]+/g, ' ');

/** Rules by their own names, joined as a sentence says them. */
const namesOf = (list) => {
  const names = list.map((r) => nameOf(r.id));
  return names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
};

/**
 * The report of one run: the job summary's Markdown, the log's lines, the exit
 * code (ONE RULE BLOCKS and A SCAN THAT DID NOT FINISH, above), and the SARIF
 * report's path when the scan finished. `stopped` says why there is no reading at all; `timeouts` is null
 * when Semgrep's report has no timing section (READ ONLY IN PART, above).
 */
export function report({ image, event, stopped = null, version = '', scanned = 0, scannedPaths = null, mustScan = [], findings = [], notes = [], timeouts = [], ran = [], sarif = '', uploaded = null, rules = RULES, known = KNOWN_FINDINGS }) {
  const pr = event === 'pull_request';
  const tag = IMAGE.exec(image)?.[1] ?? '';
  // Each place read only in part, with the rules that can have timed out there.
  const places = (timeouts ?? []).map((t) => {
    const first = t.first === null ? null : ruleOf(t.first, rules);
    const can = timedOut(t, rules);
    return {
      ...t,
      where: t.path ? `${oneLine(t.path)}:${t.line}` : 'a place Semgrep did not name',
      firstName: first ? nameOf(first.id) : oneLine(t.first ?? ''),
      blocking: can.filter((r) => r.blocks === true),
      mayBlock: can.some((r) => !r.never),
    };
  });
  /** For which rules a place timed out, in words. */
  const forRules = (t) => (t.rules === null ? 'for rules its report does not name' : `for ${plural(t.rules, 'rule')}, the first ${t.firstName}`);
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
    if (timeouts === null) problems.push("Semgrep's JSON report has no time.fixpoint_timeouts, which --time writes, so what it read only in part is not known");
    const blockingRules = rules.filter((r) => r.blocks === true);
    // A note on a file a rule that blocks is there for (`isHome`): Semgrep's per-file time limit, or a
    // file it could not parse, which it reads around. A spot that rule would fail on can be missing
    // there. A note on no file that names a rule that blocks can have been on any of its files.
    for (const n of notes) {
      const readers = n.path ? blockingRules.filter((r) => isHome(r, n.path)) : blockingRules.filter((r) => n.rule && ruleOf(n.rule, [r]));
      if (readers.length === 0) continue;
      const one = readers.length === 1;
      const what = `${oneLine(n.type || n.level || 'a note')}`;
      problems.push(
        n.path
          ? `Semgrep could not read ${oneLine(n.path)} in full (${what}), and ${namesOf(readers)}, which ${one ? 'blocks' : 'block'}, ${one ? 'reads' : 'read'} it: a spot ${one ? 'it' : 'they'} would fail on can be missing there`
          : `Semgrep could not read a file it did not name in full (${what}), and ${namesOf(readers)}, which ${one ? 'blocks' : 'block'}, wrote it: a spot ${one ? 'it' : 'they'} would fail on can be missing`,
      );
    }
    // A workflow or action file the checkout tracks that Semgrep did not scan: a directory its own
    // ignore list leaves out (build/, vendor/, test/ …), a file over its size limit, a link, an
    // extension in another case. Semgrep says nothing of any of them.
    const scannedSet = new Set(scannedPaths ?? []);
    for (const f of mustScan) {
      if (scannedSet.has(f)) continue;
      const readers = blockingRules.filter((r) => isHome(r, f));
      if (readers.length === 0) continue;
      const one = readers.length === 1;
      problems.push(`Semgrep did not scan ${oneLine(f)}, a workflow or action file the checkout tracks, which ${namesOf(readers)}, which ${one ? 'blocks' : 'block'}, ${one ? 'is' : 'are'} there for`);
    }
    for (const t of places) {
      if (t.blocking.length === 0) continue;
      const one = t.blocking.length === 1;
      problems.push(`Semgrep read ${t.where} only in part: its taint analysis timed out there ${forRules(t)}, and ${namesOf(t.blocking)} ${one ? 'blocks' : 'block'}, so a spot ${one ? 'it' : 'they'} would fail on can be missing there`);
    }
  }
  const failed = problems.length > 0;

  const byRule = rules.map((rule) => {
    const spots = findings
      .filter((f) => ruleOf(f.rule, [rule]))
      // A rule that blocks is never excused: no entry is read for it (ONE RULE BLOCKS, above).
      .map((f) => ({ ...f, known: rule.blocks === true ? null : knownAs(nameOf(rule.id), f.path, known) }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const knownCount = spots.filter((s) => s.known).length;
    return { rule, spots, known: knownCount, toRead: rule.never ? 0 : spots.length - knownCount, tests: spots.filter((s) => TEST_FILE.test(s.path)).length };
  });
  const total = byRule.reduce((n, r) => n + r.spots.length, 0);
  const knownTotal = byRule.reduce((n, r) => n + r.known, 0);
  const neverTotal = byRule.filter((r) => r.rule.never).reduce((n, r) => n + r.spots.length - r.known, 0);
  const toRead = byRule.reduce((n, r) => n + r.toRead, 0);
  const blocking = byRule.filter((r) => r.rule.blocks === true);
  const blocked = blocking.reduce((n, r) => n + r.spots.length, 0);
  const code = failed || blocked > 0 ? 1 : 0;
  const blockNames = namesOf(blocking.map((r) => r.rule));
  const never = rules.filter((r) => r.never).length;

  const lines = [`Semgrep: ${image || '(no image)'}, ${plural(rules.length, 'rule')} fetched by id, over the checkout; ${blocking.length ? `${blockNames} ${blocking.length === 1 ? 'blocks' : 'block'}` : 'no rule blocks'}`];
  const md = [
    '## Semgrep',
    '',
    `\`${image || '(no image)'}\` with the ${plural(rules.length, 'rule')} \`RULES\` names in \`scripts/semgrep-report.mjs\`, each fetched from Semgrep's registry by its id, over the checkout. ` +
      (blocking.length ? `A spot of a rule that blocks fails this job: ${blocking.map((r) => `\`${nameOf(r.rule.id)}\``).join(', ')} (workplan 0163 T5). ` : 'No rule blocks yet. ') +
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
      `Semgrep ${cell(version || '(no version)')} scanned ${plural(scanned, 'file')}${notes.length ? `, with ${plural(notes.length, 'note')} (below)` : ''}${places.length ? `${notes.length ? ',' : ''} and read ${plural(places.length, 'place')} in them only in part (below)` : ''}.`,
      '',
    );
    lines.push(
      `Semgrep ${version || '(no version)'} scanned ${plural(scanned, 'file')}${notes.length ? `, with ${plural(notes.length, 'note')} on what it could not read in full` : ''}${places.length ? `${notes.length ? ',' : ''} and read ${plural(places.length, 'place')} in them only in part, where its taint analysis timed out` : ''}.`,
    );
    for (const r of byRule) {
      for (const s of r.spots) lines.push(`${nameOf(r.rule.id)} ${s.path}:${s.line}${s.known ? ' [known]' : ''}${r.rule.never ? ' [never blocks]' : ''}${r.rule.blocks === true ? ' [blocks]' : ''}`);
      if (r.spots.length === 0) continue;
      md.push(`### ${ruleLink(r.rule)}: ${cell(r.rule.what)}`, '');
      const rows = ['| file | line | known |', '| --- | ---: | --- |', ...r.spots.map((s) => `| \`${cell(s.path)}\` | ${s.line} | ${s.known ? 'KNOWN_FINDINGS' : ''} |`)];
      if (r.rule.never) {
        md.push(`This rule never blocks (D3). ${plural(r.tests, 'spot')} of ${r.spots.length} ${r.tests === 1 ? 'is' : 'are'} in test files.`, '', '<details><summary>Every spot</summary>', '', ...rows, '', '</details>');
      } else {
        if (r.rule.blocks === true) md.push('**This rule blocks** (workplan 0163 T5): each spot below fails this job.', '');
        md.push(`What Semgrep says: ${cell(r.spots[0].message)}`, '', ...rows);
      }
      const reasons = [...new Map(r.spots.filter((s) => s.known).map((s) => [s.path, s.known]))];
      if (reasons.length) md.push('', ...reasons.map(([path, why]) => `- **\`${cell(path)}\`**: ${cell(why)}`));
      md.push('');
    }
    if (places.length) {
      md.push(
        '### Read only in part',
        '',
        "Semgrep's taint analysis reached its own time limit in each place below, a function or a file's top level, and read on without it, so a spot a rule would have reported there can be missing. " +
          'Semgrep names these places only in its timing section (`--time`), never among its errors. ' +
          'A place where a rule that may block can have timed out is marked on its line; one where a rule that blocks can have timed out is a scan that did not finish' +
          (rules.some((r) => r.blocks === true) ? '.' : ', and no rule blocks yet.'),
        '',
        '| file | line | rules timed out | the first | a spot missing there can be |',
        '| --- | ---: | ---: | --- | --- |',
      );
      for (const t of places) {
        const can = t.blocking.length
          ? `of ${namesOf(t.blocking)}, which ${t.blocking.length === 1 ? 'blocks' : 'block'}: the scan did not finish`
          : t.mayBlock
            ? 'of a rule that may block'
            : 'only of a rule that never blocks';
        md.push(`| ${t.path ? `\`${cell(t.path)}\`` : 'not named'} | ${t.line || ''} | ${t.rules ?? 'not said'} | ${t.firstName ? `\`${cell(t.firstName)}\`` : 'not said'} | ${cell(can)} |`);
        lines.push(`read only in part ${t.where}: ${t.rules === null ? 'the rules not said' : `${plural(t.rules, 'rule')} timed out, the first ${t.firstName}`}${t.blocking.length ? ' [a rule that blocks]' : t.mayBlock ? '' : ' [never blocks]'}`);
      }
      md.push('');
    }
    if (notes.length) {
      md.push(
        '### Notes',
        '',
        'What Semgrep could not read in full, which it reads around. A note on a workflow or action file, or on no file naming a rule that blocks, is a scan that did not finish.',
        '',
        '| level | kind | file | what it says |',
        '| --- | --- | --- | --- |',
      );
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
        const [kind, how] = r.rule.blocks === true ? ['error', 'blocks'] : ['warning', 'report only'];
        lines.push(`::${kind} file=${commandProperty(s.path)},line=${s.line},title=${commandProperty(`Semgrep ${nameOf(r.rule.id)} (${how})`)}::${commandData(s.message)}`);
      }
    }
    // So is a place where such a rule can have timed out: a spot of it can be missing there.
    for (const t of places.filter((x) => x.mayBlock)) {
      const at = t.path ? `file=${commandProperty(t.path)},${t.line ? `line=${t.line},` : ''}` : '';
      const said = `Semgrep's taint analysis timed out here ${forRules(t)}: a spot of a rule that ${t.blocking.length ? 'blocks' : 'may block'} can be missing.`;
      lines.push(`::warning ${at}title=${commandProperty('Semgrep read this only in part')}::${commandData(said)}`);
    }
  }

  if (failed) {
    md.push('### The scan did not finish', '', ...problems.map((p) => `- ${cell(p)}`), '');
    md.push(
      pr
        ? 'That fails this job: a scan that did not finish vouches for no rule that blocks.'
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
    lines.push(`::error::Semgrep: ${plural(blocked, 'spot')} of ${namesOf(blocking.filter((r) => r.spots.length).map((r) => r.rule))}, which ${blocking.filter((r) => r.spots.length).length === 1 ? 'blocks' : 'block'} (workplan 0163 T5); each is marked on its line.`);
  }
  if (!failed && uploaded) {
    const said = `Code scanning, from a push to main: ${plural(uploaded.kept, 'spot')} of the rules that may block. ${plural(uploaded.dropped, 'spot')} of the two that never block ${uploaded.dropped === 1 ? 'is' : 'are'} in this summary only.`;
    md.push(said, '');
    lines.push(said);
  }
  if (failed) {
    lines.push('::error::Semgrep: the scan did not finish, so it vouches for no rule that blocks, and this job fails (the summary says why).');
  }
  return { markdown: `${md.join('\n')}\n`, lines, code, sarif: failed ? '' : sarif };
}

/** The real `docker`: its status, its output and its error, never a throw. */
const realDocker = (args) =>
  spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: args[0] === 'pull' ? 300_000 : 600_000 });

/** The real `git`, as `docker` is run. */
const realGit = (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });

/**
 * Each `.semgrepignore` the checkout at `root` tracks, at any depth (NOTHING
 * IN THE TREE SWITCHES A RULE OFF, above): `{ ignores }`, or `{ error }` when
 * git could not say, which is a scan that did not finish as well.
 */
export function trackedIgnores(root, git = realGit) {
  const ran = git(['-C', root, 'ls-files', '-z']);
  if (ran.error || ran.status !== 0) {
    const why = ran.error ? `git could not be run (${ran.error.code ?? ran.error.message})` : `git exited ${ran.status}${firstLine(ran.stderr) ? `: ${firstLine(ran.stderr)}` : ''}`;
    return { error: `git could not list the files the checkout tracks (${why}), so whether one leaves files out of the scan is not known` };
  }
  const tracked = String(ran.stdout ?? '').split('\0').filter(Boolean);
  return { tracked, ignores: tracked.filter((f) => f === '.semgrepignore' || f.endsWith('/.semgrepignore')) };
}

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
  git = realGit,
  out = join(env.RUNNER_TEMP || tmpdir(), 'semgrep-report'),
} = {}) {
  const event = env.GITHUB_EVENT_NAME ?? '';
  const image = env.SEMGREP_IMAGE ?? '';
  const base = { image, event };
  if (!IMAGE.test(image)) {
    return report({ ...base, stopped: `SEMGREP_IMAGE is ${image ? `\`${image}\`` : 'not set'}, not semgrep/semgrep:<x.y.z>@sha256:<index digest>` });
  }
  const tracked = trackedIgnores(root, git);
  if (tracked.error) return report({ ...base, stopped: tracked.error });
  if (tracked.ignores.length) {
    return report({ ...base, stopped: tracked.ignores.map((f) => `the checkout tracks ${f}, which would leave out of the scan files Semgrep reads, the rule that blocks among them`).join('; ') });
  }
  mkdirSync(out, { recursive: true });
  chmodSync(out, 0o777);
  for (const file of [JSON_REPORT, SARIF_REPORT, CODE_SCANNING_REPORT]) rmSync(join(out, file), { force: true });
  const pulled = await pull(image, docker, wait);
  if (pulled) return report({ ...base, stopped: pulled });
  // Every workflow and action file the checkout tracks must be among what Semgrep scanned.
  const mustScan = tracked.tracked.filter((f) => isWorkflowFile(f));
  return report({ ...base, mustScan, ...readScan(docker(scanArgs(image, { root, out })), out) });
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
