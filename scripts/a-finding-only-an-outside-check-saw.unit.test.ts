// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FINDING ONLY AN OUTSIDE CHECK SAW (workplan 0163 T3 and T5; the owner's
 * decision D3 of 2026-11-20: Semgrep with a named list of rules, report only
 * first, the two ReDoS rules never blocking, CodeQL not now; then a rule
 * blocks once it reports nothing on main).
 *
 * An outside, read-only check of 2026-11-20 listed five classes of finding in
 * this tree, and no check in CI had a rule for any of them: a regular
 * expression built at run time (its finding 5), a path joined from a value
 * (6), a secret compared in time that depends on it (7), the browser sent to
 * an address a function returned (8), and a React link to an address from a
 * value (9). Semgrep's community rules have one for each but 7 (0163 §4.3),
 * and three more found a spot each when that plan measured Semgrep on this
 * tree. `semgrep.yml` runs them through `scripts/semgrep-report.mjs`, one of
 * them blocking. So this holds:
 *
 *  1. THE RULES ARE THE EIGHT WORKPLAN 0163 NAMES (§5, step 3), each by its
 *     registry id and fetched by it (`--config r/<id>`), so a rule is named
 *     here, never copied; the two ReDoS rules, and only they, never block;
 *  2. THE IMAGE IS SEMGREP'S BY A RELEASE TAG AND ITS INDEX DIGEST, the
 *     reference read on 2026-11-21 (`SEMGREP`, below), in one
 *     `SEMGREP_IMAGE`, and the comment above it names that digest, the
 *     release, both platforms and the day it was read, so a digest moved
 *     without its reading fails;
 *  3. THE JOB BLOCKS ON ONE RULE AND IS TO BE A REQUIRED CHECK BY ITS NAME:
 *     `run-shell-injection`, which reports nothing on main and never reaches
 *     the taint analysis's time limit, and only it, blocks; the job is named `Semgrep`, the name
 *     docs/testing.md's required checks give it, and is not in ci.yml, whose
 *     ci-complete cannot wait for another file's job; no
 *     `continue-on-error`, and no `if:` on the job or its scan step, to read
 *     a broken run as green; and its report, run against a stubbed `docker`,
 *     exits 1 on a spot of a rule that blocks, which no `KNOWN_FINDINGS`
 *     entry excuses, and on a scan that did not finish, on every event, and
 *     0 when only the rules that report found spots;
 *  4. ITS SARIF GOES TO CODE SCANNING FROM A PUSH TO MAIN, also when the rule
 *     that blocks failed the job, NEVER FROM A PULL REQUEST, where code
 *     scanning's own check could fail on a new alert; and what goes is the
 *     spots of the six rules that may block: the two that never block stay in
 *     the job's summary only;
 *  5. THE WORKFLOW SAYS WHICH RULE BLOCKS AND WHEN THE OTHERS DO, rule by
 *     rule, and names the two rules that never do;
 *  6. THE REPORT RUNS SEMGREP ONCE, after one pull, sandboxed, as the image's
 *     own user, over the checkout mounted read-only; calls a scan finished
 *     only when Semgrep exited 0, wrote both reports in their shape, calls
 *     itself the pinned release, ran every named rule and no other, and read
 *     at least `MIN_FILES` files; and calls known exactly what
 *     `KNOWN_FINDINGS` explains, each entry a file that is here;
 *  7. A PLACE SEMGREP READ ONLY IN PART IS NAMED: Semgrep runs with `--time`,
 *     and each place its taint analysis timed out in is listed; one where a
 *     rule that may block can have timed out is marked on its line; one where
 *     a rule that blocks can have timed out is a scan that did not finish, and
 *     so is a report with no timing section; a place where more than one rule
 *     timed out counts against each rule whose languages include its file,
 *     and no other, so `main`'s own reading (run 45025731298) is a scan that
 *     finished with `run-shell-injection` blocking, and would not be with
 *     `react-href-var` blocking.
 *
 * Finding 7 has no community rule, and the owner set it aside on 2026-11-20
 * (0163 T10). The pin watch's row for this image is held with the others, in
 * `a-pin-that-knows-it-is-behind`.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  IMAGE,
  JSON_REPORT,
  KNOWN_FINDINGS,
  MIN_FILES,
  PULL_DELAYS,
  RULES,
  SARIF_REPORT,
  CODE_SCANNING_REPORT,
  forCodeScanning,
  SEMGREP_USER,
  knownAs,
  nameOf,
  report,
  ruleOf,
  run,
  readScan,
  scanArgs,
  timedOut,
  languageOf,
  EXTENSIONS,
  EXCLUDED,
  trackedIgnores,
  isWorkflowFile,
  type Ran,
} from './semgrep-report.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const WORKFLOW = '.github/workflows/semgrep.yml';
const JOB = 'semgrep';
/** The job's name, which docs/testing.md's required checks name: the check a merge is to wait for (3). */
const NAME = 'Semgrep';
/** The rules that block, by their own names: the one that reports nothing on main and never reaches the taint analysis's time limit (3). */
const BLOCKING = ['run-shell-injection'];
/** The scan step's id, whose output names the SARIF report. */
const STEP_ID = 'semgrep';
/**
 * The one condition the upload runs under: a push (to main, the only push the
 * workflow takes), and a SARIF the scan finished, also when the rule that
 * blocks failed the scan's step (`!cancelled()`).
 */
const UPLOAD_IF = "!cancelled() && github.event_name == 'push' && steps.semgrep.outputs.sarif != ''";

/**
 * The image read on 2026-11-21: Semgrep 1.186.0's index, as the
 * Docker-Content-Digest of its manifest through mirror.gcr.io (whose body
 * hashes to it) and as Docker Hub's tag API gives it. Moving the image means
 * reading the new one the same way and moving this with it, in the pull
 * request that moves it, since a release can read more or fewer spots.
 */
const SEMGREP = 'semgrep/semgrep:1.186.0@sha256:6e1b04340e60e910fbb4ddbf3c857ab0918f064417ad5ac530014ccb3cf8c8f1';

/** The rules workplan 0163 names (§5, step 3), by their own names, in the order the summary lists them. */
const NAMED = [
  'detect-non-literal-regexp',
  'detect-redos',
  'path-join-resolve-traversal',
  'js-open-redirect-from-function',
  'react-href-var',
  'gcm-no-tag-length',
  'run-shell-injection',
  'unknown-value-with-script-tag',
];

interface Step {
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: unknown;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly 'continue-on-error'?: unknown;
}

interface Job {
  readonly name?: unknown;
  readonly 'runs-on'?: unknown;
  readonly if?: unknown;
  readonly env?: Record<string, unknown>;
  readonly steps?: ReadonlyArray<Step>;
  readonly 'continue-on-error'?: unknown;
}

interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly jobs?: Record<string, Job>;
}

/** What is wrong with the Semgrep job, read from its workflow's text (2 to 5 in the header); empty when it holds. */
export function jobProblems(text: string): string[] {
  const out: string[] = [];
  const wf = parseYaml(text) as Workflow;
  const names = Object.keys(wf.jobs ?? {});
  if (names.join(' ') !== JOB) out.push(`its jobs are ${JSON.stringify(names)}, not the one \`${JOB}\``);
  const job = wf.jobs?.[JOB];
  if (!job) return out;
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
    if (!Object.hasOwn(wf.on ?? {}, event)) out.push(`it does not run on ${event}`);
  }
  // A required check must report on every pull request: no filter on its pull_request trigger may silence it.
  const pr = (wf.on ?? {})['pull_request'];
  for (const key of ['paths', 'paths-ignore', 'types', 'branches', 'branches-ignore']) {
    if (pr && typeof pr === 'object' && Object.hasOwn(pr, key)) out.push(`its pull_request trigger has \`${key}:\`, so some pull requests never see the check a merge is to wait for`);
  }
  if (typeof job['runs-on'] !== 'string' || !/^ubuntu-\d/.test(job['runs-on'])) {
    out.push(`runs-on is ${JSON.stringify(job['runs-on'])}, not a GitHub-hosted ubuntu runner`);
  }
  if (job.if !== undefined) out.push(`the job has an if: (${String(job.if)}), so a run can skip it and read green`);
  if (job.name !== NAME) out.push(`the job's name is ${JSON.stringify(job.name)}, not \`${NAME}\`, the required check's name: a merge would wait for a check that never reports`);
  const steps = job.steps ?? [];
  const swallowing: Array<[string, unknown]> = [['the job', job['continue-on-error']], ...steps.map((s, i): [string, unknown] => [`step ${i + 1}`, s['continue-on-error']])];
  for (const [where, value] of swallowing) {
    if (value !== undefined) {
      out.push(`${where} sets continue-on-error (${String(value)}): the report decides its own exit, and this would read a scan that did not finish as green`);
    }
  }
  const runs = steps.filter((s) => typeof s.run === 'string');
  if (runs.length !== 1 || runs[0]!.run!.trim() !== 'node scripts/semgrep-report.mjs') {
    out.push(`its run steps are ${JSON.stringify(runs.map((s) => s.run))}, not the one \`node scripts/semgrep-report.mjs\``);
  }
  for (const s of runs) {
    if (s.if !== undefined) out.push(`the scan step has an if: (${String(s.if)})`);
    if (s.id !== STEP_ID) out.push(`the scan step's id is ${JSON.stringify(s.id)}, not \`${STEP_ID}\`, which the upload reads`);
    for (const key of ['SEMGREP_IMAGE', 'GITHUB_EVENT_NAME']) if (s.env && Object.hasOwn(s.env, key)) out.push(`the scan step sets ${key} itself`);
  }
  const uploads = steps.filter((s) => typeof s.uses === 'string' && s.uses.startsWith('github/codeql-action/upload-sarif@'));
  if (uploads.length !== 1) {
    out.push(`it uploads SARIF in ${uploads.length} steps, not one`);
  } else {
    const [upload] = uploads;
    if (upload!.if !== UPLOAD_IF) out.push(`the upload runs if ${JSON.stringify(upload!.if)}, not \`${UPLOAD_IF}\`: from a push to main only, never from a pull request`);
    if (upload!.with?.['sarif_file'] !== '${{ steps.semgrep.outputs.sarif }}') {
      out.push(`the upload sends ${JSON.stringify(upload!.with?.['sarif_file'])}, not the report the scan step names`);
    }
    if (steps.indexOf(upload!) < steps.indexOf(runs[0]!)) out.push('the upload comes before the scan');
  }
  const image = job.env?.['SEMGREP_IMAGE'];
  if (typeof image !== 'string' || !IMAGE.test(image)) {
    out.push(`SEMGREP_IMAGE is ${JSON.stringify(image)}, not semgrep/semgrep:<x.y.z>@sha256:<index digest>`);
  } else {
    // The comment right above the pin: the digest it carries, its release, both platforms, the day it was read.
    const at = text.indexOf(`SEMGREP_IMAGE: ${image}`);
    const above: string[] = [];
    for (const line of text.slice(0, at).split('\n').reverse().slice(1)) {
      if (!/^\s*#/.test(line)) break;
      above.push(line);
    }
    const comment = above.reverse().join('\n');
    const [named, digest] = image.split('@sha256:') as [string, string];
    const tag = named.slice(named.indexOf(':') + 1);
    if (!comment.includes(digest.slice(0, 12))) {
      out.push(`the comment above SEMGREP_IMAGE does not name the digest it carries (${digest.slice(0, 12)}…): read the new image, then say what it is`);
    }
    if (!comment.includes(`Semgrep ${tag} `)) out.push(`the comment above SEMGREP_IMAGE does not name the release it pins (Semgrep ${tag})`);
    for (const platform of ['linux/amd64', 'linux/arm64']) {
      if (!comment.includes(platform)) out.push(`the comment above SEMGREP_IMAGE does not say its index holds ${platform}`);
    }
    if (!/read on \d{4}-\d{2}-\d{2}/.test(comment)) out.push('the comment above SEMGREP_IMAGE does not say the day its digest was read');
  }
  const images = [...text.matchAll(/semgrep\/semgrep:[^\s'"]+/g)].map((m) => m[0]);
  if (images.length !== 1) out.push(`the workflow names a Semgrep image ${images.length} times, not once: ${images.join(', ')}`);
  const header = text.slice(0, Math.max(0, text.search(/^name:/m)));
  if (!header.includes('IT BECOMES BLOCKING rule by rule')) out.push('the header does not say when the other rules become blocking (IT BECOMES BLOCKING rule by rule …)');
  for (const rule of RULES.filter((r) => r.never)) {
    if (!header.includes(nameOf(rule.id))) out.push(`the header does not name ${nameOf(rule.id)}, which never blocks`);
  }
  for (const rule of RULES.filter((r) => r.blocks)) {
    if (!header.includes(nameOf(rule.id))) out.push(`the header does not name ${nameOf(rule.id)}, which blocks`);
  }
  return out;
}

/** What would leave the job out of the gate, or put it in twice: a job in ci.yml, or no place by its name among docs/testing.md's required checks (3). */
export function gateProblems(ciText: string, testing: string): string[] {
  const out: string[] = [];
  const ci = parseYaml(ciText) as Workflow;
  const there = Object.entries(ci.jobs ?? {})
    .filter(([, job]) => /semgrep/i.test(JSON.stringify(job)))
    .map(([name]) => name);
  if (there.length) out.push(`ci.yml runs Semgrep in ${there.join(', ')}: ci-complete waits for every job there and fails on one that does not pass`);
  const marker = '**Required status checks**';
  const start = testing.indexOf(marker);
  if (start < 0) out.push(`docs/testing.md has no "${marker}" paragraph to read`);
  else if (!(testing.slice(start).split('\n\n')[0] ?? '').includes(`\`${NAME}\``)) out.push(`docs/testing.md's required checks do not name \`${NAME}\`, the check a rule that blocks makes a gate`);
  return out;
}

describe('Semgrep in CI, one rule blocking (workplan 0163 T3 and T5, the owner’s decision D3 of 2026-11-20)', () => {
  const text = read(WORKFLOW);

  it('runs Semgrep by tag and index digest, in one job named as the required check that hides nothing, uploads from main only and says which rule blocks', () => {
    expect(jobProblems(text)).toEqual([]);
    const image = (parseYaml(text) as Workflow).jobs![JOB]!.env!['SEMGREP_IMAGE'];
    expect(image, `${WORKFLOW} runs another Semgrep than the one read: read the new one as SEMGREP says, then move both`).toBe(SEMGREP);
  });

  it('refuses a pin moved without its reading, a tag alone, a channel, a second image and another registry', () => {
    const pin = /^ {6}SEMGREP_IMAGE: (\S+)$/m.exec(text)?.[1];
    expect(pin, `${WORKFLOW} pins no SEMGREP_IMAGE to mutate`).toBeDefined();
    const mutate = (from: string, to: string): string[] => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return jobProblems(next);
    };
    expect(mutate(pin!, pin!.replace(/@sha256:[0-9a-f]{64}/, `@sha256:${'0'.repeat(64)}`))).toEqual([
      expect.stringMatching(/does not name the digest it carries \(000000000000…\)/),
    ]);
    expect(mutate(pin!, pin!.replace(/@sha256:.*/, '')).join('\n')).toMatch(/not semgrep\/semgrep:<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace(/:[\d.]+@/, ':latest@')).join('\n')).toMatch(/not semgrep\/semgrep:<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, `ghcr.io/${pin!}`).join('\n')).toMatch(/not semgrep\/semgrep:<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace('1.186.0', '1.186.1')).join('\n')).toMatch(/does not name the release it pins \(Semgrep 1\.186\.1\)/);
    expect(mutate('linux/arm64', 'arm64').join('\n')).toMatch(/does not say its index holds linux\/arm64/);
    expect(mutate('read on 2026-11-21', 'read').join('\n')).toMatch(/does not say the day its digest was read/);
    expect(mutate('run: node scripts/semgrep-report.mjs', 'run: docker run --rm -v "$PWD:/src" semgrep/semgrep:latest semgrep scan --config auto').join('\n')).toMatch(
      /names a Semgrep image 2 times, not once/,
    );
  });

  it('refuses each way the job could read a broken run as green, upload from a pull request, or land where it should not', () => {
    const mutate = (from: string, to: string): string => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return jobProblems(next).join('\n');
    };
    const step = '        run: node scripts/semgrep-report.mjs\n';
    expect(mutate('    timeout-minutes: 15\n', '    timeout-minutes: 15\n    continue-on-error: true\n')).toMatch(/the job sets continue-on-error \(true\)/);
    expect(mutate(step, `${step}        continue-on-error: true\n`)).toMatch(/step 3 sets continue-on-error \(true\)/);
    expect(mutate('    timeout-minutes: 15\n', "    timeout-minutes: 15\n    if: github.event_name != 'pull_request'\n")).toMatch(/the job has an if:/);
    expect(mutate(step, `${step}        if: always()\n`)).toMatch(/the scan step has an if:/);
    expect(mutate(step, `        env:\n          GITHUB_EVENT_NAME: pull_request\n${step}`)).toMatch(/the scan step sets GITHUB_EVENT_NAME itself/);
    expect(mutate(step, '        run: node scripts/semgrep-report.mjs || true\n')).toMatch(/not the one `node scripts\/semgrep-report\.mjs`/);
    expect(mutate('        id: semgrep\n', '')).toMatch(/the scan step's id is undefined/);
    expect(mutate('runs-on: ubuntu-24.04', 'runs-on: self-hosted')).toMatch(/not a GitHub-hosted ubuntu runner/);
    expect(mutate('  pull_request:\n', '')).toMatch(/it does not run on pull_request/);
    for (const [key, value] of [['paths', "['.github/**']"], ['paths-ignore', "['docs/**']"], ['types', '[opened]'], ['branches', '[main]'], ['branches-ignore', '[x]']]) {
      expect(mutate('  pull_request:\n', `  pull_request:\n    ${key}: ${value}\n`), key).toMatch(new RegExp(`its pull_request trigger has \`${key}:\``));
    }
    expect(mutate(UPLOAD_IF, "always() && steps.semgrep.outputs.sarif != ''")).toMatch(/from a push to main only, never from a pull request/);
    expect(mutate(UPLOAD_IF, "github.event_name != 'workflow_dispatch'")).toMatch(/from a push to main only, never from a pull request/);
    expect(mutate(UPLOAD_IF, "github.event_name == 'push' && steps.semgrep.outputs.sarif != ''")).toMatch(/from a push to main only, never from a pull request/);
    expect(mutate('    name: Semgrep\n', '    name: Semgrep (report only)\n')).toMatch(/the job's name is "Semgrep \(report only\)", not `Semgrep`, the required check's name/);
    const header = text.slice(0, text.search(/^name:/m));
    expect(header.split('run-shell-injection').length - 1, 'the header names the rule that blocks').toBeGreaterThan(0);
    expect(jobProblems(text.replace(header, header.replaceAll('run-shell-injection', 'the YAML rule'))).join('\n')).toMatch(/does not name run-shell-injection, which blocks/);
    expect(mutate('sarif_file: ${{ steps.semgrep.outputs.sarif }}', 'sarif_file: semgrep.sarif')).toMatch(/not the report the scan step names/);
    expect(mutate('IT BECOMES BLOCKING rule by rule', 'IT TURNS')).toMatch(/does not say when the other rules become blocking/);
    expect(mutate('detect-non-literal-regexp and detect-redos, never do', 'the ReDoS ones, never do')).toMatch(/does not name detect-non-literal-regexp/);
  });

  it('is not in ci.yml, whose ci-complete cannot wait for it, and docs/testing.md requires it by its name', () => {
    const ci = read('.github/workflows/ci.yml');
    const testing = read('docs/testing.md');
    expect(gateProblems(ci, testing)).toEqual([]);
    const job = '  semgrep:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: node scripts/semgrep-report.mjs\n';
    expect(ci.endsWith('\n'), 'ci.yml does not end in a newline, so the job below would not be one of its jobs').toBe(true);
    expect(gateProblems(`${ci}${job}`, testing)).toEqual([expect.stringMatching(/^ci\.yml runs Semgrep in semgrep: ci-complete waits/)]);
    const named = '`Check for committed artifacts`, and `Semgrep`.';
    expect(testing, `docs/testing.md's required checks do not end with "${named}"`).toContain(named);
    const without = (to: string) => testing.replace(named, to).replace(/`Semgrep` joins them/, 'It joins them').replace(/a red `Semgrep` shows/, 'a red one shows');
    expect(gateProblems(ci, without('`Check for committed artifacts`.'))).toEqual([expect.stringMatching(/required checks do not name `Semgrep`/)]);
    expect(gateProblems(ci, without('`Check for committed artifacts`, and `Semgrep (report only)`.'))).toEqual([expect.stringMatching(/required checks do not name `Semgrep`/)]);
  });
});

describe('the rules: the eight workplan 0163 names, each by its registry id (1)', () => {
  it('names exactly those eight, in that order, each fetched by its id', () => {
    expect(RULES.map((r) => nameOf(r.id))).toEqual(NAMED);
    for (const rule of RULES) {
      // A registry id: its language, its path in the registry, and the rule's own name last.
      expect(rule.id, rule.id).toMatch(/^(javascript|typescript|yaml)(\.[a-z0-9-]+){3,}$/);
      expect(rule.what.length, rule.id).toBeGreaterThan(20);
    }
    const args = scanArgs(SEMGREP, { root: '/repo', out: '/out-dir' });
    const configs = args.flatMap((a, i) => (a === '--config' ? [args[i + 1]] : []));
    expect(configs).toEqual(RULES.map((r) => `r/${r.id}`));
    // Fetched by id, never a pack, a local file or Semgrep's own choice of rules.
    for (const config of configs) expect(config).not.toMatch(/^(p\/|auto$|\.|\/)/);
  });

  it('marks the two ReDoS rules, and only they, as never blocking, run-shell-injection, and only it, as blocking, and pairs each rule with the finding it answers', () => {
    expect(RULES.filter((r) => r.never).map((r) => nameOf(r.id))).toEqual(['detect-non-literal-regexp', 'detect-redos']);
    expect(RULES.filter((r) => r.blocks).map((r) => nameOf(r.id))).toEqual(BLOCKING);
    for (const rule of RULES) {
      expect(typeof rule.blocks, rule.id).toBe('boolean');
      expect(rule.never && rule.blocks, `${rule.id} cannot both never block and block`).toBe(false);
    }
    expect(RULES.map((r) => r.finding)).toEqual([5, 5, 6, 8, 9, null, null, null]);
  });

  it('names each rule\'s languages as its own source does: JavaScript and TypeScript, and YAML for the one workflow rule (7)', () => {
    // Read from each rule's `languages:` in Semgrep's rules repository on
    // 2026-11-22, at a5ad1714 of 2026-11-10 (semgrep-report.mjs, RULES).
    for (const rule of RULES) {
      expect(rule.languages, rule.id).toEqual(rule.id.startsWith('yaml.') ? ['yaml'] : ['javascript', 'typescript']);
    }
    // The registry id starts with its language: the one YAML rule is the workflow rule.
    expect(RULES.filter((r) => r.languages.includes('yaml')).map((r) => nameOf(r.id))).toEqual(['run-shell-injection']);
  });

  it('knows a rule by its id, by its id under a prefix, or by its own name, and nothing else', () => {
    const [redos] = RULES;
    expect(ruleOf(redos!.id)).toBe(redos);
    expect(ruleOf(`src.${redos!.id}`)).toBe(redos);
    expect(ruleOf('detect-non-literal-regexp')).toBe(redos);
    expect(ruleOf('javascript.lang.security.audit.detect-eval-with-expression.detect-eval-with-expression')).toBeNull();
    expect(ruleOf('constructor')).toBeNull();
  });

  it('records in KNOWN_FINDINGS only rules that may block and files that are here, each with its reason', () => {
    expect(Object.keys(KNOWN_FINDINGS).length).toBeGreaterThan(0);
    for (const [rule, files] of Object.entries(KNOWN_FINDINGS)) {
      const named = RULES.find((r) => nameOf(r.id) === rule);
      expect(named, `${rule} is not a rule RULES names`).toBeDefined();
      expect(named!.never, `${rule} never blocks: its spots need no entry`).toBe(false);
      expect(named!.blocks, `${rule} blocks: no entry may excuse a spot of it, so it may have none`).toBe(false);
      for (const [file, why] of Object.entries(files)) {
        expect(existsSync(join(REPO_ROOT, file)), `${rule}: ${file} is not in the repository`).toBe(true);
        expect(why.length, `${rule} ${file}`).toBeGreaterThan(40);
        expect(why, `${rule} ${file}`).toMatch(/workplan 0163/);
      }
    }
    expect(knownAs('path-join-resolve-traversal', 'apps/worker/src/index.ts')).toBe(KNOWN_FINDINGS['path-join-resolve-traversal']!['apps/worker/src/index.ts']);
    expect(knownAs('path-join-resolve-traversal', 'apps/api/src/no-route-here.ts')).toBeNull();
    expect(knownAs('constructor', 'apps/worker/src/index.ts')).toBeNull();
  });
});

describe('the Semgrep report, run against a stubbed docker (6, and 3’s exits)', () => {
  const image = (parseYaml(read(WORKFLOW)) as Workflow).jobs![JOB]!.env!['SEMGREP_IMAGE'] as string;
  const version = IMAGE.exec(image)![1]!;
  /** Each run's reports directory, made here and removed when the block is done. */
  const made: string[] = [];
  const reportsDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'semgrep-report-'));
    made.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  interface Spot {
    readonly rule: string;
    readonly path: string;
    readonly line: number;
    readonly message?: string;
  }

  /** The workflow and action files this checkout tracks, which a finished scan must have scanned. */
  const GATED = (trackedIgnores(REPO_ROOT).tracked ?? []).filter((f) => isWorkflowFile(f));
  /** `n` scanned paths: the gated files but those named, then other files. */
  const scannedOf = (n: number, unscanned: ReadonlyArray<string>) => {
    const gated = GATED.filter((f) => !unscanned.includes(f)).slice(0, n);
    return [...gated, ...Array.from({ length: n - gated.length }, (_, i) => `apps/f${i}.ts`)];
  };

  /** What Semgrep writes for these spots: its JSON report and its SARIF report, in their shapes. */
  const reports = (
    spots: ReadonlyArray<Spot>,
    o: { version?: string; scanned?: number; unscanned?: ReadonlyArray<string>; ran?: ReadonlyArray<string>; notes?: ReadonlyArray<object>; timeouts?: ReadonlyArray<object | null> | null } = {},
  ) => ({
    json: {
      version: o.version ?? version,
      results: spots.map((s) => ({
        check_id: s.rule,
        path: s.path,
        start: { line: s.line, col: 5, offset: 0 },
        end: { line: s.line, col: 9, offset: 4 },
        extra: { message: s.message ?? `${nameOf(s.rule)} says so`, severity: 'WARNING', metadata: {}, lines: 'requires login' },
      })),
      errors: o.notes ?? [],
      // What Semgrep scanned: every workflow and action file the checkout tracks among them, unless `unscanned` names one it did not.
      paths: { scanned: scannedOf(o.scanned ?? 2400, o.unscanned ?? []) },
      // The timing section `--time` adds; null leaves it out.
      ...(o.timeouts === null ? {} : { time: { targets: [], fixpoint_timeouts: o.timeouts ?? [] } }),
    },
    sarif: {
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'Semgrep OSS', semanticVersion: o.version ?? version, rules: (o.ran ?? RULES.map((r) => r.id)).map((id) => ({ id, name: id })) } },
          results: spots.map((s) => ({
            ruleId: s.rule,
            message: { text: s.message ?? `${nameOf(s.rule)} says so` },
            locations: [{ physicalLocation: { artifactLocation: { uri: s.path }, region: { startLine: s.line } } }],
          })),
        },
      ],
    },
  });

  /**
   * A place Semgrep's taint analysis timed out in, as its timing section
   * writes one: the message `Taint_rule_inst.check_timeouts_and_warn` gives,
   * with the function's place, line 1 for a file's top level.
   */
  const timeout = (path: string, line: number, rules: number, first: string) => ({
    error_type: 'Fixpoint timeout',
    severity: 'warn',
    message: `Fixpoint timeout while performing taint analysis at ${path}:${line}:${line === 1 ? 0 : 9} [rules: ${rules}, first: ${first}]`,
    location: { path, start: { line, col: line === 1 ? 1 : 10, offset: 0 }, end: { line, col: 20, offset: 10 } },
  });

  /** One spot per rule, the two known ones among them at the files KNOWN_FINDINGS names. */
  const everyRule: Spot[] = RULES.map((r, i) => {
    const name = nameOf(r.id);
    const known = Object.keys(KNOWN_FINDINGS[name] ?? {})[0];
    return { rule: r.id, path: known ?? (r.languages.includes('yaml') ? `.github/workflows/spot-${i}.yml` : `apps/web/src/spot-${i}.ts`), line: 10 + i };
  });
  /** The same, without the spot of the rule that blocks: what main's tree reads like. */
  const reportOnly: Spot[] = everyRule.filter((sp) => !RULES.find((r) => r.id === sp.rule)!.blocks);

  /**
   * A docker that pulls, and whose run writes `what` into the directory
   * mounted at /out, or answers as `answer` says; it writes down what it was
   * asked and how long it was made to wait.
   */
  const stub = (what: { json?: unknown; sarif?: unknown; rawJson?: string } | null, answer: (args: string[]) => Ran | null = () => null) => {
    const calls: string[][] = [];
    const waits: number[] = [];
    const docker = (args: string[]): Ran => {
      calls.push(args);
      const answered = answer(args);
      if (answered) return answered;
      if (args[0] === 'pull') return { status: 0, stdout: '', stderr: '' };
      const mount = args[args.indexOf('--volume', args.indexOf('--volume') + 1) + 1]!;
      const out = mount.slice(0, mount.lastIndexOf(':/out'));
      if (what?.rawJson !== undefined) writeFileSync(join(out, JSON_REPORT), what.rawJson);
      else if (what?.json !== undefined) writeFileSync(join(out, JSON_REPORT), JSON.stringify(what.json));
      if (what?.sarif !== undefined) writeFileSync(join(out, SARIF_REPORT), JSON.stringify(what.sarif));
      return { status: 0, stdout: 'Ran 8 rules on 2400 files: 8 findings.', stderr: '' };
    };
    return { calls, waits, docker, wait: async (ms: number) => void waits.push(ms) };
  };

  const at = (event: string, s: ReturnType<typeof stub>, env: Record<string, string> = {}) => {
    const out = reportsDir();
    return run({ root: REPO_ROOT, env: { SEMGREP_IMAGE: image, GITHUB_EVENT_NAME: event, ...env }, docker: s.docker, wait: s.wait, out }).then((r) => ({ ...r, out }));
  };

  it('pulls the workflow’s image once, then runs Semgrep once over the checkout, sandboxed, as the image’s user, with every rule by id', async () => {
    const s = stub(reports(reportOnly));
    const out = await at('pull_request', s);
    expect(s.calls[0]).toEqual(['pull', '--quiet', image]);
    expect(s.calls).toHaveLength(2);
    const args = s.calls[1]!;
    expect(args).toEqual(scanArgs(image, { root: REPO_ROOT, out: out.out }));
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--pull', 'never']);
    const said = args.join(' ');
    for (const flag of ['--cap-drop ALL', '--security-opt no-new-privileges', `--user ${SEMGREP_USER}`, `--volume ${REPO_ROOT}:/src:ro`, `--volume ${out.out}:/out`, '--workdir /src']) {
      expect(said).toContain(flag);
    }
    expect(SEMGREP_USER).toBe('1000:1000');
    expect(args.slice(args.indexOf(image), args.indexOf(image) + 8)).toEqual([image, 'semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--time', '--disable-nosem']);
    // No inline `nosemgrep` comment silences a spot: without --disable-nosem Semgrep drops it from the JSON report this reads.
    expect(args).toContain('--disable-nosem');
    expect(said).not.toContain('--enable-nosem');
    expect(args.slice(-2)).toEqual([`--json-output=/out/${JSON_REPORT}`, `--sarif-output=/out/${SARIF_REPORT}`]);
    // This decides what blocks, and Semgrep excludes nothing of its own: no --error, no --exclude, no baseline.
    for (const flag of ['--error', '--exclude', '--include', '--baseline-commit', '--severity']) expect(said).not.toContain(flag);
    // The reports' directory is open to the image's user, whose uid is not the runner's.
    expect(statSync(out.out).mode & 0o777).toBe(0o777);
    expect(out.code).toBe(0);
  });

  it('gives code scanning the spots of the six rules that may block, also when the rule that blocks failed the job, and keeps Semgrep\'s own report whole', async () => {
    const out = await at('push', stub(reports(everyRule)));
    // The rule that blocks found its spot, so the job fails; the scan finished, so its SARIF is named for the upload.
    expect(out.code).toBe(1);
    expect(out.sarif).toBe(join(out.out, CODE_SCANNING_REPORT));
    const uploaded = JSON.parse(readFileSync(out.sarif, 'utf8'));
    const sent = uploaded.runs[0].results.map((r: { ruleId: string }) => r.ruleId);
    expect(sent).toEqual(RULES.filter((r) => !r.never).map((r) => r.id));
    expect(sent).toHaveLength(6);
    // The rules Semgrep ran stay listed, all eight.
    expect(uploaded.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toEqual(RULES.map((r) => r.id));
    // Semgrep's own SARIF is not changed.
    expect(JSON.parse(readFileSync(join(out.out, SARIF_REPORT), 'utf8')).runs[0].results).toHaveLength(8);
    const said = 'Code scanning, from a push to main: 6 spots of the rules that may block. 2 spots of the two that never block are in this summary only.';
    expect(out.markdown).toContain(said);
    expect(out.lines).toContain(said);
  });

  it('fails a pull request, a push and a dispatch when the rule that blocks found a spot, an error on its line, and the rules that report fail nothing', async () => {
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      const out = await at(event, stub(reports(everyRule)));
      expect(out.code, event).toBe(1);
      expect(out.sarif, `${event}: the scan finished, so its SARIF is named for the upload`).toBe(join(out.out, CODE_SCANNING_REPORT));
      expect(out.markdown).toContain('| **8 rules** | | | **8** | **0** | **2** | **4** |');
      expect(out.markdown).toContain('**8 spots from 8 rules: 1 under the one rule that blocks, 2 under the two rules that never block, 2 known, 4 to read.**');
      expect(out.markdown).toContain('**1 spot of a rule that blocks: this job fails.**');
      expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files.`);
      expect(out.lines).toContain(`Semgrep ${version} scanned 2,400 files.`);
      for (const rule of RULES) expect(out.markdown).toContain(`[\`${nameOf(rule.id)}\`](https://semgrep.dev/r/${rule.id})`);
      for (const name of BLOCKING) {
        const rule = RULES.find((r) => nameOf(r.id) === name)!;
        expect(out.markdown).toContain(`| [\`${name}\`](https://semgrep.dev/r/${rule.id}) | none (found by the measure runs) | **yes** | 1 | 0 | 0 | 1 |`);
      }
      const href = RULES.find((r) => nameOf(r.id) === 'react-href-var')!;
      expect(out.markdown).toContain(`| [\`react-href-var\`](https://semgrep.dev/r/${href.id}) | 9 | not yet | 1 | 0 | 0 | 1 |`);
      expect(out.markdown.match(/\*\*This rule blocks\*\* \(workplan 0163 T5\): each spot below fails this job\./g)).toHaveLength(1);
      expect(out.lines.filter((l) => l.startsWith('::error::') || l.startsWith('::warning::'))).toEqual([
        '::error::Semgrep: 1 spot of run-shell-injection, which blocks (workplan 0163 T5); each is marked on its line.',
      ]);
      // A spot of a rule that blocks is an error on its line; one of a rule that reports, which no entry explains, a warning; the rest are not marked.
      const errors = out.lines.filter((l) => l.startsWith('::error file='));
      const warnings = out.lines.filter((l) => l.startsWith('::warning file='));
      expect(errors).toHaveLength(1);
      expect(warnings).toHaveLength(3);
      for (const spot of everyRule) {
        const rule = RULES.find((r) => r.id === spot.rule)!;
        const name = nameOf(spot.rule);
        if (rule.blocks) expect(errors).toContain(`::error file=${spot.path},line=${spot.line},title=Semgrep ${name} (blocks)::${name} says so`);
        else if (!rule.never && !knownAs(name, spot.path)) expect(warnings).toContain(`::warning file=${spot.path},line=${spot.line},title=Semgrep ${name} (report only)::${name} says so`);
        expect(out.lines.some((l) => l.startsWith(`${name} ${spot.path}:${spot.line}`)), spot.path).toBe(true);
      }
    }
  });

  it('exits 0 on a pull request, a push and a dispatch when only the rules that report found spots', async () => {
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      const out = await at(event, stub(reports(reportOnly)));
      expect(out.code, event).toBe(0);
      expect(out.sarif, event).toBe(join(out.out, CODE_SCANNING_REPORT));
      expect(out.markdown).toContain('**7 spots from 8 rules: 0 under the one rule that blocks, 2 under the two rules that never block, 2 known, 3 to read.**');
      expect(out.markdown).not.toContain('this job fails');
      expect(out.lines.filter((l) => l.startsWith('::error'))).toEqual([]);
      expect(out.lines.filter((l) => l.startsWith('::warning file='))).toHaveLength(3);
      expect(out.lines).toContain('7 spots from 8 rules: 0 under the one rule that blocks, 2 under the two rules that never block, 2 known, 3 to read. No rule that blocks found a spot.');
    }
  });

  it('excuses no spot of a rule that blocks, whatever KNOWN_FINDINGS says', () => {
    const shell = RULES.find((r) => nameOf(r.id) === 'run-shell-injection')!;
    const path = '.github/workflows/a-title-in-a-script.yml';
    const known = { ...KNOWN_FINDINGS, 'run-shell-injection': { [path]: 'an entry no rule that blocks may have, written here to see it read as nothing (workplan 0163)' } };
    const out = report({ image, event: 'pull_request', version, scanned: 2400, findings: [{ rule: shell.id, path, line: 3, message: 'github context in run' }], notes: [], ran: RULES.map((r) => r.id), sarif: '/tmp/x.sarif', known });
    expect(out.code).toBe(1);
    expect(out.markdown).toContain(`| \`${path}\` | 3 |  |`);
    expect(out.markdown).not.toContain('an entry no rule that blocks may have');
    expect(out.lines).toContain(`::error file=${path},line=3,title=Semgrep run-shell-injection (blocks)::github context in run`);
    expect(out.markdown).toContain('**1 spot from 8 rules: 1 under the one rule that blocks, 0 under the two rules that never block, 0 known, 1 to read.**');
  });

  it('fails a pull request, a push and a dispatch when the image cannot be pulled', async () => {
    for (const [event, code, annotation] of [['pull_request', 1, '::error::'], ['push', 1, '::error::'], ['workflow_dispatch', 1, '::error::']] as const) {
      const s = stub(null, () => ({ status: 1, stdout: '', stderr: 'toomanyrequests: You have reached your unauthenticated pull rate limit' }));
      const out = await at(event, s);
      expect(out.code, event).toBe(code);
      expect(out.sarif).toBe('');
      expect(s.calls.map((c) => c[0]), 'it ran Semgrep on an image it did not have').toEqual(['pull', 'pull', 'pull']);
      expect(s.waits).toEqual(PULL_DELAYS.map((d) => d * 1000));
      expect(out.markdown).toMatch(/### The scan did not finish\n\n- .* was not pulled in 3 attempts \(the last: docker exited 1: toomanyrequests/);
      expect(out.lines.at(-1)).toMatch(new RegExp(`^${annotation}Semgrep: the scan did not finish`));
    }
  });

  it('reads each way a scan can end short as one that did not finish, which fails every event', async () => {
    const full = reports(everyRule);
    const cases: Array<[string, ReturnType<typeof stub>, RegExp]> = [
      ['an exit', stub(null, (a) => (a[0] === 'run' ? { status: 7, stdout: '', stderr: 'Failed to download configuration from https://semgrep.dev/c/r/x' } : null)), /Semgrep exited 7 \(a config it could not find or fetch\): Failed to download/],
      ['a fatal exit', stub(null, (a) => (a[0] === 'run' ? { status: 2, stdout: '', stderr: '' } : null)), /Semgrep exited 2 \(a fatal error\)$/m],
      ['docker not run', stub(null, (a) => (a[0] === 'run' ? { status: null, error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }) } : null)), /docker could not be run \(ETIMEDOUT\)/],
      ['no JSON report', stub({ sarif: full.sarif }), /Semgrep wrote no JSON report/],
      ['a JSON report that is not JSON', stub({ rawJson: '{"results": [', sarif: full.sarif }), /Semgrep's JSON report is not JSON/],
      ['a JSON report in another shape', stub({ json: { results: [] }, sarif: full.sarif }), /has no results, errors and scanned paths/],
      ['a finding with no line', stub({ json: { ...full.json, results: [{ check_id: RULES[2]!.id, path: 'a.ts', extra: { message: 'm' } }] }, sarif: full.sarif }), /a finding without a rule, a path, a line and a message/],
      ['no SARIF report', stub({ json: full.json }), /Semgrep wrote no SARIF report/],
      ['a SARIF report with no rules', stub({ json: full.json, sarif: { runs: [{ tool: { driver: {} } }] } }), /lists no rules it ran/],
      ['another release', stub(reports(everyRule, { version: '1.178.0' })), new RegExp(`calls itself 1\\.178\\.0, not ${version.replace(/\./g, '\\.')}`)],
      ['a rule not run', stub(reports([], { ran: RULES.slice(1).map((r) => r.id) })), /Semgrep did not run javascript\.lang\.security\.audit\.detect-non-literal-regexp/],
      ['a rule not named', stub(reports([], { ran: [...RULES.map((r) => r.id), 'javascript.lang.security.audit.detect-eval-with-expression.detect-eval-with-expression'] })), /Semgrep ran javascript\.lang\.security\.audit\.detect-eval-with-expression\.detect-eval-with-expression, which RULES does not name/],
      ['a finding of a rule not named', stub(reports([{ rule: 'javascript.express.security.audit.xss.direct-response-write', path: 'a.ts', line: 1 }])), /Semgrep reported javascript\.express\.security\.audit\.xss\.direct-response-write, which RULES does not name/],
      ['too few files', stub(reports(everyRule, { scanned: MIN_FILES - 1 })), /Semgrep scanned 999 files, fewer than the 1,000 files a scan of this tree reads/],
      ['no timing section', stub(reports(everyRule, { timeouts: null })), /Semgrep's JSON report has no time\.fixpoint_timeouts, which --time writes, so what it read only in part is not known/],
      ['a timing section without its time-outs', stub({ json: { ...full.json, time: { targets: [] } }, sarif: full.sarif }), /has no time\.fixpoint_timeouts/],
    ];
    for (const [what, s, why] of cases) {
      for (const event of ['pull_request', 'push']) {
        const out = await at(event, s);
        expect(out.code, `${what}, ${event}`).toBe(1);
        expect(out.sarif, `${what}: a scan that did not finish names no SARIF to upload`).toBe('');
        const said = out.markdown.split('### The scan did not finish')[1] ?? '';
        expect(said, what).toMatch(why);
        expect(said, what).toMatch(event === 'pull_request' ? /a scan that did not finish vouches for no rule that blocks/ : /here the run is the record/);
        expect(out.lines.at(-1), what).toMatch(/^::error::Semgrep: the scan did not finish, so it vouches for no rule that blocks/);
      }
    }
  });

  it('reads no report an earlier run left behind', async () => {
    const out = reportsDir();
    const left = reports(everyRule);
    writeFileSync(join(out, JSON_REPORT), JSON.stringify(left.json));
    writeFileSync(join(out, SARIF_REPORT), JSON.stringify(left.sarif));
    const s = stub({});
    const r = await run({ root: REPO_ROOT, env: { SEMGREP_IMAGE: image, GITHUB_EVENT_NAME: 'push' }, docker: s.docker, wait: s.wait, out });
    expect(r.code).toBe(1);
    expect(r.markdown).toContain('Semgrep wrote no JSON report');
  });

  it('runs nothing, and fails every event, when SEMGREP_IMAGE is not semgrep by a release tag and its digest', async () => {
    for (const wrong of ['', 'semgrep/semgrep:1.186.0', `semgrep/semgrep:latest@sha256:${'0'.repeat(64)}`, `ghcr.io/semgrep/semgrep:1.186.0@sha256:${'0'.repeat(64)}`, `returntocorp/semgrep:1.186.0@sha256:${'0'.repeat(64)}`]) {
      for (const event of ['pull_request', 'push']) {
        const s = stub(reports(reportOnly));
        const out = await at(event, s, { SEMGREP_IMAGE: wrong });
        expect(s.calls, wrong).toEqual([]);
        expect(out.code, `${event} ${wrong}`).toBe(1);
        expect(out.markdown).toContain('SEMGREP_IMAGE is ');
      }
    }
  });

  it('calls known exactly what KNOWN_FINDINGS explains, with the reason, and names a known one Semgrep did not report', () => {
    const traversal = RULES.find((r) => nameOf(r.id) === 'path-join-resolve-traversal')!;
    const script = RULES.find((r) => nameOf(r.id) === 'unknown-value-with-script-tag')!;
    const worker = 'apps/worker/src/index.ts';
    const findings = [
      { rule: traversal.id, path: worker, line: 92, message: 'Detected possible user input | <here>' },
      { rule: traversal.id, path: 'apps/api/src/routes/files.ts', line: 7, message: 'Detected possible user input | <here>' },
    ];
    const out = report({ image, event: 'push', version, scanned: 2400, findings, notes: [], ran: RULES.map((r) => r.id), sarif: '/tmp/x.sarif' });
    expect(out.code).toBe(0);
    expect(out.markdown).toContain(`| \`${worker}\` | 92 | KNOWN_FINDINGS |`);
    expect(out.markdown).toContain('| `apps/api/src/routes/files.ts` | 7 |  |');
    expect(out.markdown).toContain(`- **\`${worker}\`**: ${KNOWN_FINDINGS['path-join-resolve-traversal']![worker]!.replace(/`/g, "'")}`);
    expect(out.markdown).toContain('What Semgrep says: Detected possible user input \\| &lt;here&gt;');
    const unreported = out.markdown.split('### Known, and not reported this run')[1] ?? '';
    for (const file of Object.keys(KNOWN_FINDINGS[nameOf(script.id)]!)) {
      expect(unreported).toContain(`\`${file}\`: unknown-value-with-script-tag is known, and Semgrep did not report it here`);
    }
    expect(unreported, 'the worker’s spot was reported').not.toContain(worker);
    expect(out.markdown).toContain('**2 spots from 8 rules: 0 under the one rule that blocks, 0 under the two rules that never block, 1 known, 1 to read.**');
    expect(out.lines.filter((l) => l.startsWith('::warning file='))).toEqual([
      '::warning file=apps/api/src/routes/files.ts,line=7,title=Semgrep path-join-resolve-traversal (report only)::Detected possible user input | <here>',
    ]);
  });

  it('lists the spots of a rule that never blocks, folded, and counts those in test files', () => {
    const [regexp] = RULES;
    const findings = [
      { rule: regexp!.id, path: 'packages/shared/src/a-pattern-built-here.ts', line: 60, message: 'RegExp() called with a variable' },
      { rule: regexp!.id, path: 'scripts/a-guard.unit.test.ts', line: 3, message: 'RegExp() called with a variable' },
      { rule: regexp!.id, path: 'packages/connectors/src/__testing__/fake.ts', line: 9, message: 'RegExp() called with a variable' },
      { rule: regexp!.id, path: 'apps/api/src/__tests__/a-door-helper.ts', line: 12, message: 'RegExp() called with a variable' },
    ];
    const out = report({ image, event: 'pull_request', version, scanned: 2400, findings, notes: [], ran: RULES.map((r) => r.id), sarif: '/tmp/x.sarif' });
    expect(out.markdown).toContain(`| [\`detect-non-literal-regexp\`](https://semgrep.dev/r/${regexp!.id}) | 5 | never (D3) | 4 | 3 | 0 |  |`);
    expect(out.markdown).toContain('This rule never blocks (D3). 3 spots of 4 are in test files.');
    expect(out.markdown).toContain('<details><summary>Every spot</summary>');
    expect(out.markdown).toContain('**4 spots from 8 rules: 0 under the one rule that blocks, 4 under the two rules that never block, 0 known, 0 to read.**');
    expect(out.lines.filter((l) => l.startsWith('::')), 'a rule that never blocks marks no line').toEqual([]);
  });

  it('writes what a rule says into a workflow command as one line, its file and title escaped, so nothing it says starts another command', () => {
    const redirect = RULES.find((r) => nameOf(r.id) === 'js-open-redirect-from-function')!;
    const message = 'line one\n::error::not from us\r\n100% sure';
    const out = report({ image, event: 'pull_request', version, scanned: 2400, findings: [{ rule: redirect.id, path: 'apps/web/a,b:c.tsx', line: 4, message }], notes: [], ran: RULES.map((r) => r.id), sarif: '/tmp/x.sarif' });
    const marked = out.lines.filter((l) => l.startsWith('::warning file='));
    expect(marked).toEqual(['::warning file=apps/web/a%2Cb%3Ac.tsx,line=4,title=Semgrep js-open-redirect-from-function (report only)::line one%0A::error::not from us%0D%0A100%25 sure']);
    expect(out.lines.some((l) => l.startsWith('::error'))).toBe(false);
    const shell = RULES.find((r) => nameOf(r.id) === 'run-shell-injection')!;
    const blocked = report({ image, event: 'pull_request', version, scanned: 2400, findings: [{ rule: shell.id, path: '.github/workflows/a,b:c.yml', line: 4, message }], notes: [], ran: RULES.map((r) => r.id), sarif: '/tmp/x.sarif' });
    expect(blocked.lines.filter((l) => l.startsWith('::error file='))).toEqual(['::error file=.github/workflows/a%2Cb%3Ac.yml,line=4,title=Semgrep run-shell-injection (blocks)::line one%0A::error::not from us%0D%0A100%25 sure']);
  });

  it("lists Semgrep's notes on what it could not read in full, which do not stop the scan", async () => {
    // As Semgrep writes one: its kind first in a list, and a message over more than one line.
    const note = { code: 3, level: 'warn', type: ['PartialParsing', [{ path: 'apps/web/src/a.tsx' }]], path: 'apps/web/src/a.tsx', message: 'Syntax error at line apps/web/src/a.tsx:3:\n `<` was unexpected' };
    const out = await at('push', stub(reports(reportOnly, { notes: [note] })));
    expect(out.code).toBe(0);
    expect(out.sarif).toBe(join(out.out, CODE_SCANNING_REPORT));
    expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files, with 1 note (below).`);
    expect(out.lines).toContain(`Semgrep ${version} scanned 2,400 files, with 1 note on what it could not read in full.`);
    expect(out.markdown).toContain('| warn | PartialParsing | `apps/web/src/a.tsx` | Syntax error at line apps/web/src/a.tsx:3: |');
  });

  it('reads a note on a workflow or action file, or on no file naming the rule that blocks, as a scan that did not finish, on every event, and any other note as a note', async () => {
    // Semgrep's per-file time limit and a file it could not parse land in its errors, never as a time-out of the taint analysis.
    const shellId = RULES.find((r) => nameOf(r.id) === 'run-shell-injection')!.id;
    const cases = [
      { code: 3, level: 'warn', type: ['Timeout', []], path: '.github/workflows/ci.yml', rule_id: shellId, message: 'Timeout when running run-shell-injection on .github/workflows/ci.yml' },
      { code: 3, level: 'warn', type: ['Syntax error', []], path: '.github/workflows/a-broken.yaml', message: 'Syntax error at line .github/workflows/a-broken.yaml:3' },
      { code: 3, level: 'warn', type: ['Timeout', []], path: '.github/actions/build/action.yml', message: 'Timeout' },
    ];
    for (const note of cases) {
      for (const event of ['pull_request', 'push']) {
        const out = await at(event, stub(reports(reportOnly, { notes: [note] })));
        expect(out.code, `${note.path}, ${event}`).toBe(1);
        expect(out.sarif, note.path).toBe('');
        expect(out.markdown.split('### The scan did not finish')[1] ?? '', note.path).toMatch(
          new RegExp(`Semgrep could not read ${note.path.replace(/\./g, '\\.')} in full \\(${note.type[0]}\\), and run-shell-injection, which blocks, reads it`),
        );
        expect(out.markdown, note.path).toContain(`| ${note.type[0]} | \`${note.path}\` |`);
        expect(out.markdown).toContain('A note on a workflow or action file, or on no file naming a rule that blocks, is a scan that did not finish.');
      }
    }
    // A note on no file that names the rule that blocks: it can have been on any file that rule reads.
    const unnamed = await at('pull_request', stub(reports(reportOnly, { notes: [{ code: 3, level: 'warn', type: ['Timeout', []], rule_id: shellId, message: 'Timeout' }] })));
    expect(unnamed.code).toBe(1);
    expect(unnamed.markdown.split('### The scan did not finish')[1] ?? '').toMatch(/Semgrep could not read a file it did not name in full \(Timeout\), and run-shell-injection, which blocks, wrote it/);
    // A note with no file, or on a file the rule that blocks is not there for, YAML GitHub never runs among them: listed, and the scan finished.
    for (const note of [
      { code: 3, level: 'warn', type: ['Timeout', []], path: 'apps/web/src/a.tsx', message: 'Timeout' },
      { code: 3, level: 'warn', type: ['Timeout', []], path: 'pnpm-lock.yaml', rule_id: shellId, message: 'Timeout' },
      { code: 3, level: 'warn', type: ['Timeout', []], path: 'apps/api/openapi.yaml', message: 'Timeout' },
      { code: 3, level: 'warn', type: ['Syntax error', []], path: 'deploy/compose/managed.yml', message: 'Syntax error' },
      { code: 3, level: 'warn', type: ['Other', []], message: 'A note on no file' },
      { code: 3, level: 'warn', type: ['Timeout', []], rule_id: RULES[2]!.id, message: 'Timeout of a rule that reports' },
    ]) {
      const out = await at('push', stub(reports(reportOnly, { notes: [note] })));
      expect(out.code, JSON.stringify(note)).toBe(0);
      expect(out.markdown).not.toContain('### The scan did not finish');
    }
  });

  it('reads a workflow or action file the checkout tracks and Semgrep did not scan as a scan that did not finish, by its name (an ignored directory, a size limit, a link)', async () => {
    expect(GATED.length, 'this checkout tracks no workflow to hold').toBeGreaterThan(10);
    const tracked = [...GATED, '.github/actions/build/action.yml', '.github/workflows/A-SHOUTED.YML', 'apps/api/src/x.ts'];
    const git = () => ({ status: 0, stdout: `${tracked.join('\0')}\0`, stderr: '' });
    for (const event of ['pull_request', 'push']) {
      const unscanned = ['.github/actions/build/action.yml', '.github/workflows/A-SHOUTED.YML', GATED[0]!];
      const s = stub(reports(reportOnly, { unscanned }));
      const r = await run({ root: REPO_ROOT, env: { SEMGREP_IMAGE: image, GITHUB_EVENT_NAME: event }, docker: s.docker, wait: s.wait, out: reportsDir(), git });
      expect(r.code, event).toBe(1);
      expect(r.sarif).toBe('');
      const said = r.markdown.split('### The scan did not finish')[1] ?? '';
      for (const f of unscanned) expect(said, f).toContain(`Semgrep did not scan ${f}, a workflow or action file the checkout tracks, which run-shell-injection, which blocks, is there for`);
      // A tracked file of no gate that Semgrep did not scan is no problem.
      expect(said).not.toContain('apps/api/src/x.ts');
    }
    // Every tracked one scanned: the scan finished.
    const s = stub(reports(reportOnly));
    const r = await run({ root: REPO_ROOT, env: { SEMGREP_IMAGE: image, GITHUB_EVENT_NAME: 'pull_request' }, docker: s.docker, wait: s.wait, out: reportsDir(), git: () => ({ status: 0, stdout: `${GATED.join('\0')}\0`, stderr: '' }) });
    expect(r.code).toBe(0);
    // Semgrep's paths read as git's: a leading ./ is the same file.
    const dir = reportsDir();
    const written = reports(reportOnly);
    writeFileSync(join(dir, JSON_REPORT), JSON.stringify({ ...written.json, paths: { scanned: written.json.paths.scanned.map((f: string) => `./${f}`) } }));
    writeFileSync(join(dir, SARIF_REPORT), JSON.stringify(written.sarif));
    const scan = readScan({ status: 0 }, dir);
    expect(scan.scannedPaths).toEqual(written.json.paths.scanned);
    expect(report({ ...scan, image, event: 'push', mustScan: GATED }).code).toBe(0);
  });

  it('knows a workflow or action file by its path, in any case, and nothing else', () => {
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/a.yaml', '.github/workflows/A.YML', '.github/actions/build/action.yml', 'action.yaml', 'tools/x/ACTION.YML']) expect(isWorkflowFile(f), f).toBe(true);
    for (const f of ['.github/workflows/sub/ci.yml', '.github/dependabot.yml', 'pnpm-lock.yaml', 'apps/api/openapi.yaml', 'deploy/compose/managed.yml', '.github/workflows/README.md', 'my-action.yml', '']) expect(isWorkflowFile(f), f).toBe(false);
  });

  it('runs nothing, and fails every event, when the checkout tracks a .semgrepignore at any depth, or git cannot list what it tracks', async () => {
    for (const tracked of [['.semgrepignore'], ['apps/api/src/x.ts', '.github/.semgrepignore'], ['deploy/compose/a/.semgrepignore']]) {
      for (const event of ['pull_request', 'push']) {
        const s = stub(reports(reportOnly));
        const out = reportsDir();
        const r = await run({ root: REPO_ROOT, env: { SEMGREP_IMAGE: image, GITHUB_EVENT_NAME: event }, docker: s.docker, wait: s.wait, out, git: () => ({ status: 0, stdout: `${tracked.join('\0')}\0`, stderr: '' }) });
        expect(s.calls, tracked.join(' ')).toEqual([]);
        expect(r.code, `${tracked.join(' ')}, ${event}`).toBe(1);
        const ignore = tracked.find((t) => t.endsWith('.semgrepignore'))!;
        expect(r.markdown.split('### The scan did not finish')[1] ?? '').toContain(`the checkout tracks ${ignore}, which would leave out of the scan files Semgrep reads, the rule that blocks among them`);
      }
    }
    const s = stub(reports(reportOnly));
    const r = await run({ root: REPO_ROOT, env: { SEMGREP_IMAGE: image, GITHUB_EVENT_NAME: 'pull_request' }, docker: s.docker, wait: s.wait, out: reportsDir(), git: () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' }) });
    expect(s.calls).toEqual([]);
    expect(r.code).toBe(1);
    expect(r.markdown).toContain('git could not list the files the checkout tracks (git exited 128: fatal: not a git repository)');
  });

  it('exits as its report says when run as the workflow runs it, a docker on PATH standing in for the real one, and 1 when it faults', () => {
    const dir = reportsDir();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // A docker that pulls, and whose run copies the reports in STUB_REPORTS into the directory mounted at /out.
    writeFileSync(
      join(bin, 'docker'),
      [
        '#!/usr/bin/env node',
        "const { copyFileSync } = require('node:fs');",
        "const { join } = require('node:path');",
        'const args = process.argv.slice(2);',
        "if (args[0] === 'run') {",
        "  const mount = args.filter((a, i) => args[i - 1] === '--volume').find((v) => v.endsWith(':/out'));",
        "  const out = mount.slice(0, mount.lastIndexOf(':/out'));",
        `  for (const f of ['${JSON_REPORT}', '${SARIF_REPORT}']) copyFileSync(join(process.env.STUB_REPORTS, f), join(out, f));`,
        '}',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const reportsOf = (spots: ReadonlyArray<Spot>) => {
      const at = mkdtempSync(join(dir, 'reports-'));
      const written = reports(spots);
      writeFileSync(join(at, JSON_REPORT), JSON.stringify(written.json));
      writeFileSync(join(at, SARIF_REPORT), JSON.stringify(written.sarif));
      return at;
    };
    const asTheWorkflowRunsIt = (env: Record<string, string | undefined>) => {
      const temp = mkdtempSync(join(dir, 'runner-'));
      const summary = join(temp, 'summary.md');
      const output = join(temp, 'output');
      const ran = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/semgrep-report.mjs')], {
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: process.env.HOME, RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'pull_request', SEMGREP_IMAGE: image, ...env },
      });
      return { ...ran, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '', output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
    };
    // A spot of the rule that blocks: 1, on a pull request, with the summary and the SARIF for the upload written.
    const blocked = asTheWorkflowRunsIt({ STUB_REPORTS: reportsOf(everyRule) });
    expect(blocked.status, blocked.stdout + blocked.stderr).toBe(1);
    expect(blocked.stdout).toContain('::error::Semgrep: 1 spot of run-shell-injection, which blocks (workplan 0163 T5); each is marked on its line.');
    expect(blocked.summary).toContain('**1 spot of a rule that blocks: this job fails.**');
    expect(blocked.output).toMatch(new RegExp(`^sarif=.*${CODE_SCANNING_REPORT.replace(/\./g, '\\.')}\n$`));
    // Only the rules that report found spots: 0.
    const clean = asTheWorkflowRunsIt({ STUB_REPORTS: reportsOf(reportOnly), GITHUB_EVENT_NAME: 'push' });
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);
    expect(clean.stdout).toContain('No rule that blocks found a spot.');
    // No image to run: 1, on a pull request too, and docker never asked.
    const none = asTheWorkflowRunsIt({ SEMGREP_IMAGE: undefined });
    expect(none.status).toBe(1);
    expect(none.stdout).toContain('::error::Semgrep: the scan did not finish');
    // A fault (the runner's temporary directory is a file, so the reports' directory cannot be made): 1, on a pull request too.
    const file = join(dir, 'a-file');
    writeFileSync(file, '');
    const fault = asTheWorkflowRunsIt({ STUB_REPORTS: reportsOf(reportOnly), RUNNER_TEMP: file });
    expect(fault.status).toBe(1);
    expect(fault.stdout).toMatch(/^::error::semgrep-report stopped: /m);
  });

  it('reads this checkout as tracking no .semgrepignore', () => {
    const listed = trackedIgnores(REPO_ROOT);
    expect(listed.ignores).toEqual([]);
    expect(listed.tracked!.length, 'git listed almost nothing: the reading would be vacuous').toBeGreaterThan(MIN_FILES);
  });

  it('lists each place Semgrep read only in part, marks one where a rule that may block can have timed out, and fails nothing when no rule that blocks can have (7)', async () => {
    const [regexp] = RULES;
    const redirect = RULES.find((r) => nameOf(r.id) === 'js-open-redirect-from-function')!;
    const timeouts = [
      timeout('apps/web/src/pages/a-long-page.tsx', 1, 5, regexp!.id),
      timeout('scripts/a-guard.unit.test.ts', 1, 1, regexp!.id),
      timeout('apps/web/src/pages/a-pay-page.tsx', 335, 1, redirect.id),
    ];
    for (const event of ['pull_request', 'push']) {
      const out = await at(event, stub(reports(reportOnly, { timeouts })));
      expect(out.code, event).toBe(0);
      expect(out.sarif, event).toBe(join(out.out, CODE_SCANNING_REPORT));
      expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files and read 3 places in them only in part (below).`);
      expect(out.lines).toContain(`Semgrep ${version} scanned 2,400 files and read 3 places in them only in part, where its taint analysis timed out.`);
      const section = out.markdown.split('### Read only in part')[1]?.split('\n###')[0] ?? '';
      expect(section, 'no section lists the places').toContain('one where a rule that blocks can have timed out is a scan that did not finish.');
      expect(section).toContain('| `apps/web/src/pages/a-long-page.tsx` | 1 | 5 | `detect-non-literal-regexp` | of a rule that may block |');
      expect(section).toContain('| `scripts/a-guard.unit.test.ts` | 1 | 1 | `detect-non-literal-regexp` | only of a rule that never blocks |');
      expect(section).toContain('| `apps/web/src/pages/a-pay-page.tsx` | 335 | 1 | `js-open-redirect-from-function` | of a rule that may block |');
      expect(out.lines).toContain('read only in part apps/web/src/pages/a-long-page.tsx:1: 5 rules timed out, the first detect-non-literal-regexp');
      expect(out.lines).toContain('read only in part scripts/a-guard.unit.test.ts:1: 1 rule timed out, the first detect-non-literal-regexp [never blocks]');
      // Marked on its line where a spot of a rule that may block can be missing, and only there.
      expect(out.lines.filter((l) => l.includes('title=Semgrep read this only in part'))).toEqual([
        "::warning file=apps/web/src/pages/a-long-page.tsx,line=1,title=Semgrep read this only in part::Semgrep's taint analysis timed out here for 5 rules, the first detect-non-literal-regexp: a spot of a rule that may block can be missing.",
        "::warning file=apps/web/src/pages/a-pay-page.tsx,line=335,title=Semgrep read this only in part::Semgrep's taint analysis timed out here for 1 rule, the first js-open-redirect-from-function: a spot of a rule that may block can be missing.",
      ]);
      expect(out.markdown).not.toContain('### The scan did not finish');
      expect(out.lines.filter((l) => l.startsWith('::error') || l.startsWith('::warning::'))).toEqual([]);
    }
    // With no place read only in part, the summary has no such section.
    const none = await at('push', stub(reports(reportOnly)));
    expect(none.markdown).not.toContain('### Read only in part');
    expect(none.markdown).toContain(`Semgrep ${version} scanned 2,400 files.`);
  });

  /** readScan over Semgrep's two reports with these places read only in part, and the spots of the rules that report. */
  const scanWith = (timeouts: ReadonlyArray<object | null>, spots: ReadonlyArray<Spot> = reportOnly) => {
    const dir = reportsDir();
    const written = reports(spots, { timeouts });
    writeFileSync(join(dir, JSON_REPORT), JSON.stringify(written.json));
    writeFileSync(join(dir, SARIF_REPORT), JSON.stringify(written.sarif));
    return readScan({ status: 0 }, dir);
  };

  it('counts a place where a rule that blocks can have timed out as a scan that did not finish, on every event, and no other place (7)', () => {
    const [regexp] = RULES;
    const redirect = RULES.find((r) => nameOf(r.id) === 'js-open-redirect-from-function')!;
    const href = RULES.find((r) => nameOf(r.id) === 'react-href-var')!;
    // As step 5 may one day turn a taint rule blocking.
    const rules = RULES.map((r) => (r === redirect ? { ...r, blocks: true } : r));
    // No spot of the rule this turns blocking, so only a time-out can fail the scan.
    const spots = reportOnly.filter((sp) => sp.rule !== redirect.id);
    const cases = [
      [
        'the rule that blocks, alone',
        timeout('apps/web/src/pages/a-pay-page.tsx', 760, 1, redirect.id),
        /Semgrep read apps\/web\/src\/pages\/a-pay-page\.tsx:760 only in part: its taint analysis timed out there for 1 rule, the first js-open-redirect-from-function, and js-open-redirect-from-function blocks, so a spot it would fail on can be missing there/,
      ],
      [
        'several rules, the first one that never blocks',
        timeout('apps/web/src/pages/a-long-page.tsx', 1, 3, regexp!.id),
        /a-long-page\.tsx:1 only in part: its taint analysis timed out there for 3 rules, the first detect-non-literal-regexp, and js-open-redirect-from-function blocks/,
      ],
      [
        'an entry that names no rule',
        { error_type: 'Fixpoint timeout', location: { path: 'apps/web/src/a.tsx', start: { line: 4 } } },
        /a\.tsx:4 only in part: its taint analysis timed out there for rules its report does not name, and js-open-redirect-from-function blocks/,
      ],
    ] as const;
    for (const [what, entry, why] of cases) {
      for (const event of ['pull_request', 'push']) {
        const out = report({ ...scanWith([entry], spots), image, event, rules });
        expect(out.code, `${what}, ${event}`).toBe(1);
        expect(out.sarif, `${what}: a scan that did not finish names no SARIF to upload`).toBe('');
        const said = out.markdown.split('### The scan did not finish')[1] ?? '';
        expect(said, what).toMatch(why);
        // A JavaScript or TypeScript place: the YAML rule that blocks is not one that can have timed out there.
        expect(said, what).not.toMatch(/run-shell-injection/);
        expect(out.markdown, what).toContain('| of js-open-redirect-from-function, which blocks: the scan did not finish |');
        expect(out.lines.filter((l) => l.includes('title=Semgrep read this only in part'))[0], what).toMatch(/: a spot of a rule that blocks can be missing\.$/);
      }
    }
    // One rule timed out, and Semgrep names one that does not block: nothing that blocks is missing.
    for (const entry of [timeout('apps/web/src/pages/a-long-page.tsx', 1, 1, regexp!.id), timeout('apps/web/src/components/a-consent-link.tsx', 593, 1, href.id)]) {
      const out = report({ ...scanWith([entry], spots), image, event: 'push', rules });
      expect(out.code, JSON.stringify(entry)).toBe(0);
      expect(out.markdown).not.toContain('### The scan did not finish');
    }
  });

  it('reads a file by its extension as Semgrep does, and a place as read by the rules whose languages include its file (7)', () => {
    // Semgrep 1.186.0's lang.json (its semgrep_interfaces at a5844e7c): each language's extensions, and the ones it leaves out.
    expect(EXTENSIONS).toEqual({ javascript: ['.cjs', '.js', '.jsx', '.mjs'], typescript: ['.ts', '.tsx'], yaml: ['.yml', '.yaml'] });
    expect(EXCLUDED).toEqual({ javascript: ['.min.js'], typescript: ['.d.ts'], yaml: [] });
    const said: Array<[string, string | null]> = [
      ['apps/web/src/pages/Docs.tsx', 'typescript'],
      ['scripts/a-guard.unit.test.ts', 'typescript'],
      ['scripts/semgrep-report.d.mts', null],
      ['scripts/a.cts', null],
      ['apps/web/src/vite-env.d.ts', null],
      ['site/vendor/a.min.js', null],
      ['scripts/semgrep-report.mjs', 'javascript'],
      // Semgrep reads an extension as written: an upper-case one is no language of its.
      ['site/a.JS', null],
      ['.github/workflows/a.YML', null],
      ['.github/workflows/ci.yml', 'yaml'],
      ['deploy/compose/managed.yaml', 'yaml'],
      ['deploy/compose/postgres/Dockerfile', null],
      ['docs/testing.md', null],
      ['.github/workflows/.yml', null],
      ['a.ts/README', null],
      ['', null],
    ];
    for (const [path, language] of said) expect(languageOf(path), path).toBe(language);

    const [regexp] = RULES;
    const shell = RULES.find((r) => nameOf(r.id) === 'run-shell-injection')!;
    const href = RULES.find((r) => nameOf(r.id) === 'react-href-var')!;
    const jsTs = RULES.filter((r) => r !== shell);
    const at = (path: string, rules: number | null, first: string | null) => ({ path, line: 1, rules, first });
    // Several rules in a TypeScript file: every JavaScript and TypeScript rule, never the YAML one.
    expect(timedOut(at('apps/selfhost/src/index.ts', 4, RULES[3]!.id))).toEqual(jsTs);
    expect(timedOut(at('apps/web/src/pages/Docs.tsx', 2, null))).toEqual(jsTs);
    expect(timedOut(at('scripts/x.mjs', null, null))).toEqual(jsTs);
    // In a workflow: the YAML rule alone, which is the only one that reads it.
    expect(timedOut(at('.github/workflows/ci.yml', 2, null))).toEqual([shell]);
    // One rule, named: that rule alone, whatever the file.
    expect(timedOut(at('apps/web/src/pages/Docs.tsx', 1, href.id))).toEqual([href]);
    expect(timedOut(at('', 1, regexp!.id))).toEqual([regexp]);
    // A file of no language here, or no file: any rule.
    expect(timedOut(at('deploy/compose/postgres/Dockerfile', 2, regexp!.id))).toEqual(RULES);
    expect(timedOut(at('', 3, null))).toEqual(RULES);
    // Semgrep names first a rule that does not read the file: not read as this says, so any rule.
    expect(timedOut(at('apps/web/src/pages/Docs.tsx', 2, shell.id))).toEqual(RULES);
    expect(timedOut(at('.github/workflows/ci.yml', 1, href.id))).toEqual(RULES);
  });

  /**
   * The thirteen places main's Semgrep run 45025731298 read only in part, at
   * 0683eb04 on 2026-11-22: its log's lines, word for word, which give the
   * file, the line, how many rules timed out, and the first Semgrep names.
   */
  const MAIN_READ_IN_PART = [
    'read only in part apps/api/src/routes/migrations/index.ts:1: 2 rules timed out, the first js-open-redirect-from-function',
    'read only in part apps/selfhost/src/index.ts:382: 4 rules timed out, the first js-open-redirect-from-function',
    'read only in part apps/web/src/components/AccountForm.tsx:1: 2 rules timed out, the first path-join-resolve-traversal',
    'read only in part apps/web/src/pages/Docs.tsx:1: 4 rules timed out, the first js-open-redirect-from-function',
    'read only in part apps/worker/src/jobs/run-delta-sync.ts:1: 2 rules timed out, the first js-open-redirect-from-function',
    'read only in part packages/connectors/src/graph-calendar-source.ts:507: 2 rules timed out, the first js-open-redirect-from-function',
    'read only in part packages/core/src/domain-sync.ts:1209: 1 rule timed out, the first js-open-redirect-from-function',
    'read only in part scripts/a-binary-the-stack-never-runs.unit.test.ts:1: 2 rules timed out, the first path-join-resolve-traversal',
    'read only in part scripts/a-deploy-from-a-named-tag.unit.test.ts:1: 3 rules timed out, the first react-href-var',
    'read only in part scripts/a-password-the-repository-knows.unit.test.ts:1: 1 rule timed out, the first detect-non-literal-regexp [never blocks]',
    'read only in part scripts/a-pin-that-knows-it-is-behind.unit.test.ts:1: 2 rules timed out, the first path-join-resolve-traversal',
    'read only in part scripts/an-image-nobody-scanned.unit.test.ts:1: 1 rule timed out, the first path-join-resolve-traversal',
    'read only in part scripts/one-copy-before-each-update.unit.test.ts:1: 2 rules timed out, the first path-join-resolve-traversal',
  ];
  const mainTimeouts = () =>
    MAIN_READ_IN_PART.map((line) => {
      const [, path, at, n, first] = /^read only in part (\S+):(\d+): (\d+) rules? timed out, the first ([\w-]+)/.exec(line)!;
      return timeout(path!, Number(at), Number(n), RULES.find((r) => nameOf(r.id) === first)!.id);
    });

  it("reads main's own run as a scan that finished with run-shell-injection blocking, on a pull request and a push (7)", () => {
    for (const event of ['pull_request', 'push']) {
      const out = report({ ...scanWith(mainTimeouts()), image, event });
      expect(out.code, event).toBe(0);
      expect(out.markdown, event).not.toContain('### The scan did not finish');
      expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files and read 13 places in them only in part (below).`);
      // The report writes the same lines as main's run did.
      for (const line of MAIN_READ_IN_PART) expect(out.lines).toContain(line);
      // Twelve places name or may hide a rule that may block, and are marked; the thirteenth names a rule that never blocks.
      expect(out.lines.filter((l) => l.includes('title=Semgrep read this only in part'))).toHaveLength(12);
      expect(out.lines.filter((l) => l.startsWith('::error'))).toEqual([]);
    }
  });

  it("would read main's own run as a scan that did not finish with react-href-var blocking: in ten places it can have timed out, in one Semgrep names it (7)", () => {
    const rules = RULES.map((r) => (nameOf(r.id) === 'react-href-var' ? { ...r, blocks: true } : r));
    const href = RULES.find((r) => nameOf(r.id) === 'react-href-var')!;
    const out = report({ ...scanWith(mainTimeouts(), reportOnly.filter((sp) => sp.rule !== href.id)), image, event: 'push', rules });
    expect(out.code).toBe(1);
    expect(out.markdown, 'no spot of react-href-var: only its time-outs fail the scan').not.toContain('of a rule that blocks: this job fails');
    const said = (out.markdown.split('### The scan did not finish')[1] ?? '').split('\n').filter((l) => l.startsWith('- '));
    expect(said).toHaveLength(10);
    for (const line of said) expect(line).toMatch(/and react-href-var blocks, so a spot it would fail on can be missing there$/);
    expect(said.join('\n')).toContain('a-deploy-from-a-named-tag.unit.test.ts:1 only in part: its taint analysis timed out there for 3 rules, the first react-href-var');
    // The places where one rule timed out and Semgrep names another are not among them.
    expect(said.join('\n')).not.toMatch(/domain-sync|a-password-the-repository-knows|an-image-nobody-scanned/);
  });

  it('reads an entry in another shape as a place any rule can have timed out in, and keeps what Semgrep wrote on one line (7)', () => {
    const [regexp] = RULES;
    const shell = RULES.find((r) => nameOf(r.id) === 'run-shell-injection')!;
    const scan = scanWith([
      // No location: the place is read from the message.
      { message: `Fixpoint timeout while performing taint analysis at apps/web/src/b.ts:12:3 [rules: 1, first: ${regexp!.id}]` },
      null,
      { message: 'Fixpoint timeout, said another way', location: { path: 'apps/web/src/c.ts', start: { line: 7 } } },
      { location: { path: 'apps/web/x\n::error::y.ts', start: { line: 2 } } },
    ]);
    expect(scan.timeouts).toEqual([
      { path: 'apps/web/src/b.ts', line: 12, rules: 1, first: regexp!.id },
      { path: '', line: 0, rules: null, first: null },
      { path: 'apps/web/src/c.ts', line: 7, rules: null, first: null },
      { path: 'apps/web/x\n::error::y.ts', line: 2, rules: null, first: null },
    ]);
    // The first alone when Semgrep counts one rule and names one RULES has; any rule whose languages read the file otherwise; any rule at all for no file.
    expect(timedOut(scan.timeouts![0]!)).toEqual([regexp]);
    expect(timedOut(scan.timeouts![1]!)).toEqual(RULES);
    expect(timedOut(scan.timeouts![2]!)).toEqual(RULES.filter((r) => r !== shell));
    expect(timedOut({ path: 'a.ts', line: 1, rules: 1, first: 'javascript.lang.security.audit.detect-eval-with-expression.detect-eval-with-expression' })).toEqual(RULES.filter((r) => r !== shell));
    const out = report({ ...scan, image, event: 'push' });
    // A place Semgrep did not name can be in a workflow, and the rule that blocks reads workflows: a scan that did not finish.
    expect(out.code).toBe(1);
    expect(out.markdown.split('### The scan did not finish')[1] ?? '').toMatch(
      /Semgrep read a place Semgrep did not name only in part: its taint analysis timed out there for rules its report does not name, and run-shell-injection blocks/,
    );
    expect(out.markdown).toContain('| not named |  | not said | not said | of run-shell-injection, which blocks: the scan did not finish |');
    expect(out.lines).toContain('read only in part a place Semgrep did not name: the rules not said [a rule that blocks]');
    expect(out.lines).toContain(
      "::warning title=Semgrep read this only in part::Semgrep's taint analysis timed out here for rules its report does not name: a spot of a rule that blocks can be missing.",
    );
    // A line break in a path starts no workflow command of its own.
    expect(out.lines).toContain('read only in part apps/web/x ::error::y.ts:2: the rules not said');
    expect(out.lines).toContain(
      "::warning file=apps/web/x%0A%3A%3Aerror%3A%3Ay.ts,line=2,title=Semgrep read this only in part::Semgrep's taint analysis timed out here for rules its report does not name: a spot of a rule that may block can be missing.",
    );
    expect(out.lines.some((l) => l.includes('\n'))).toBe(false);
    // The only errors are the report's own: none comes from what Semgrep wrote.
    expect(out.lines.filter((l) => l.startsWith('::error'))).toEqual([expect.stringMatching(/^::error::Semgrep: the scan did not finish/)]);
  });
});

describe('what code scanning receives: the spots of the six rules that may block (forCodeScanning)', () => {
  const at = (ruleId: string, line = 1) => ({ ruleId, message: { text: 'says so' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'apps/x.ts' }, region: { startLine: line } } }] });
  const never = RULES.filter((r) => r.never);
  const may = RULES.filter((r) => !r.never);

  it('the two that never block are the ReDoS rules, and every other named rule may block', () => {
    expect(never.map((r) => nameOf(r.id))).toEqual(['detect-non-literal-regexp', 'detect-redos']);
    expect(may).toHaveLength(6);
  });

  it('takes out a spot of a rule that never blocks, by its id, a prefixed id or its own name, and keeps every other', () => {
    const sarif = {
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'Semgrep OSS', rules: RULES.map((r) => ({ id: r.id })) } },
          results: [at(never[0]!.id, 1), at(`tmp.${never[1]!.id}`, 2), at(nameOf(never[0]!.id), 3), ...may.map((r, i) => at(r.id, 10 + i)), at('a.rule.no.one.named', 99)],
        },
      ],
    };
    const before = JSON.stringify(sarif);
    const { sarif: sent, kept, dropped } = forCodeScanning(sarif);
    expect(dropped).toBe(3);
    expect(kept).toBe(7);
    expect(sent.runs[0]!.results.map((r) => r.ruleId)).toEqual([...may.map((r) => r.id), 'a.rule.no.one.named']);
    expect(sent.runs[0]!.tool).toEqual(sarif.runs[0]!.tool);
    // The report it was given is not changed.
    expect(JSON.stringify(sarif)).toBe(before);
  });

  it('keeps a report with no results, or no runs, in its shape', () => {
    expect(forCodeScanning({ version: '2.1.0', runs: [{ tool: {}, results: [] }] })).toEqual({ sarif: { version: '2.1.0', runs: [{ tool: {}, results: [] }] }, kept: 0, dropped: 0 });
    expect(forCodeScanning({ version: '2.1.0', runs: [] })).toEqual({ sarif: { version: '2.1.0', runs: [] }, kept: 0, dropped: 0 });
  });
});
