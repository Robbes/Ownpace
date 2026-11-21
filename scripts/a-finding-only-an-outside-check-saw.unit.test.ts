// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FINDING ONLY AN OUTSIDE CHECK SAW (workplan 0163 T3; the owner's decision
 * D3 of 2026-11-20: Semgrep with a named list of rules, report only first, the
 * two ReDoS rules never blocking, CodeQL not now).
 *
 * An outside, read-only check of 2026-11-20 listed five classes of finding in
 * this tree, and no check in CI had a rule for any of them: a regular
 * expression built at run time (its finding 5), a path joined from a value
 * (6), a secret compared in time that depends on it (7), the browser sent to
 * an address a function returned (8), and a React link to an address from a
 * value (9). Semgrep's community rules have one for each but 7 (0163 §4.3),
 * and three more found a spot each when that plan measured Semgrep on this
 * tree. `semgrep.yml` runs them,
 * report only, through `scripts/semgrep-report.mjs`. So this holds:
 *
 *  1. THE RULES ARE THE EIGHT WORKPLAN 0163 NAMES (§5, step 3), each by its
 *     registry id and fetched by it (`--config r/<id>`), so a rule is named
 *     here, never copied; the two ReDoS rules, and only they, never block;
 *  2. THE IMAGE IS SEMGREP'S BY A RELEASE TAG AND ITS INDEX DIGEST, the
 *     reference read on 2026-11-21 (`SEMGREP`, below), in one
 *     `SEMGREP_IMAGE`, and the comment above it names that digest, the
 *     release, both platforms and the day it was read, so a digest moved
 *     without its reading fails;
 *  3. THE JOB IS REPORT ONLY: not in ci.yml, so ci-complete never waits for
 *     it, and not among docs/testing.md's required checks; no
 *     `continue-on-error`, and no `if:` on the job or its scan step, to read
 *     a broken run as green; and its report, run against a stubbed `docker`,
 *     exits 0 on every finding, and on a pull request whatever happened, and
 *     1 on a push or a dispatch only when the scan did not finish;
 *  4. ITS SARIF GOES TO CODE SCANNING FROM A PUSH TO MAIN, NEVER FROM A PULL
 *     REQUEST, where code scanning's own check could fail on a new alert; and
 *     what goes is the spots of the six rules that may block: the two that
 *     never block stay in the job's summary only;
 *  5. THE WORKFLOW SAYS WHEN IT BECOMES BLOCKING, rule by rule, and names the
 *     two rules that never do;
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
 *     so is a report with no timing section; and no rule blocks yet.
 *
 * Finding 7 has no community rule, and the owner set it aside on 2026-11-20
 * (0163 T10). The pin watch's row for this image is held with the others, in
 * `a-pin-that-knows-it-is-behind`.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  type Ran,
} from './semgrep-report.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const WORKFLOW = '.github/workflows/semgrep.yml';
const JOB = 'semgrep';
/** The scan step's id, whose output names the SARIF report. */
const STEP_ID = 'semgrep';
/** The one condition the upload runs under: a push (to main, the only push the workflow takes), and a SARIF the scan finished. */
const UPLOAD_IF = "github.event_name == 'push' && steps.semgrep.outputs.sarif != ''";

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
  if (typeof job['runs-on'] !== 'string' || !/^ubuntu-\d/.test(job['runs-on'])) {
    out.push(`runs-on is ${JSON.stringify(job['runs-on'])}, not a GitHub-hosted ubuntu runner`);
  }
  if (job.if !== undefined) out.push(`the job has an if: (${String(job.if)}), so a run can skip it and read green`);
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
  if (!header.includes('IT BECOMES BLOCKING rule by rule')) out.push('the header does not say when the job becomes blocking (IT BECOMES BLOCKING rule by rule …)');
  for (const rule of RULES.filter((r) => r.never)) {
    if (!header.includes(nameOf(rule.id))) out.push(`the header does not name ${nameOf(rule.id)}, which never blocks`);
  }
  return out;
}

/** What would make the job gate a merge: a job in ci.yml, or a place among docs/testing.md's required checks (3). */
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
  else if (/semgrep/i.test(testing.slice(start).split('\n\n')[0] ?? '')) out.push("docs/testing.md's required checks name Semgrep, which is report only");
  return out;
}

describe('Semgrep in CI, report only (workplan 0163 T3, the owner’s decision D3 of 2026-11-20)', () => {
  const text = read(WORKFLOW);

  it('runs Semgrep by tag and index digest, in one job that hides nothing, uploads from main only and says when it becomes blocking', () => {
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
    expect(mutate(UPLOAD_IF, "always() && steps.semgrep.outputs.sarif != ''")).toMatch(/from a push to main only, never from a pull request/);
    expect(mutate(UPLOAD_IF, "github.event_name != 'workflow_dispatch'")).toMatch(/from a push to main only, never from a pull request/);
    expect(mutate('sarif_file: ${{ steps.semgrep.outputs.sarif }}', 'sarif_file: semgrep.sarif')).toMatch(/not the report the scan step names/);
    expect(mutate('IT BECOMES BLOCKING rule by rule', 'IT TURNS')).toMatch(/does not say when the job becomes blocking/);
    expect(mutate('detect-non-literal-regexp and detect-redos, never do', 'the ReDoS ones, never do')).toMatch(/does not name detect-non-literal-regexp/);
  });

  it('is not in ci.yml, so ci-complete never waits for it, and docs/testing.md does not require it', () => {
    const ci = read('.github/workflows/ci.yml');
    const testing = read('docs/testing.md');
    expect(gateProblems(ci, testing)).toEqual([]);
    const job = '  semgrep:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: node scripts/semgrep-report.mjs\n';
    expect(ci.endsWith('\n'), 'ci.yml does not end in a newline, so the job below would not be one of its jobs').toBe(true);
    expect(gateProblems(`${ci}${job}`, testing)).toEqual([expect.stringMatching(/^ci\.yml runs Semgrep in semgrep: ci-complete waits/)]);
    const required = '**Required status checks** on `main` are four: ';
    expect(testing, `docs/testing.md does not open its required checks with "${required}"`).toContain(required);
    expect(gateProblems(ci, testing.replace(required, `${required}\`Semgrep (report only)\`, `))).toEqual([expect.stringMatching(/required checks name Semgrep/)]);
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

  it('marks the two ReDoS rules, and only they, as never blocking, and pairs each rule with the finding it answers', () => {
    expect(RULES.filter((r) => r.never).map((r) => nameOf(r.id))).toEqual(['detect-non-literal-regexp', 'detect-redos']);
    expect(RULES.map((r) => r.finding)).toEqual([5, 5, 6, 8, 9, null, null, null]);
  });

  it('blocks on no rule yet (7)', () => {
    // Step 5 turns a rule blocking in a pull request of its own, which also
    // makes a finding of that rule fail the job and says here which rule.
    expect(
      RULES.filter((r) => r.blocks !== false).map((r) => nameOf(r.id)),
      'a rule blocks: its findings must fail the job too (0163 §5, step 5), and this test name it',
    ).toEqual([]);
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

describe('the Semgrep report, run against a stubbed docker (6, and 3’s exit)', () => {
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

  /** What Semgrep writes for these spots: its JSON report and its SARIF report, in their shapes. */
  const reports = (
    spots: ReadonlyArray<Spot>,
    o: { version?: string; scanned?: number; ran?: ReadonlyArray<string>; notes?: ReadonlyArray<object>; timeouts?: ReadonlyArray<object | null> | null } = {},
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
      paths: { scanned: Array.from({ length: o.scanned ?? 2400 }, (_, i) => `apps/f${i}.ts`) },
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
    return { rule: r.id, path: known ?? `apps/web/src/spot-${i}.ts`, line: 10 + i };
  });

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
    const s = stub(reports(everyRule));
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
    expect(args.slice(args.indexOf(image), args.indexOf(image) + 7)).toEqual([image, 'semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--time']);
    expect(args.slice(-2)).toEqual([`--json-output=/out/${JSON_REPORT}`, `--sarif-output=/out/${SARIF_REPORT}`]);
    // Report only, and no exclusion of its own: no --error, no --exclude, no baseline.
    for (const flag of ['--error', '--exclude', '--include', '--baseline-commit', '--severity']) expect(said).not.toContain(flag);
    // The reports' directory is open to the image's user, whose uid is not the runner's.
    expect(statSync(out.out).mode & 0o777).toBe(0o777);
    expect(out.code).toBe(0);
  });

  it('gives code scanning the spots of the six rules that may block, and keeps Semgrep\'s own report whole', async () => {
    const out = await at('push', stub(reports(everyRule)));
    expect(out.code).toBe(0);
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

  it('exits 0 on a pull request, a push and a dispatch when every rule found a spot: none fails the job', async () => {
    for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
      const out = await at(event, stub(reports(everyRule)));
      expect(out.code, event).toBe(0);
      expect(out.sarif, event).toBe(join(out.out, CODE_SCANNING_REPORT));
      expect(out.markdown).toContain('| **8 rules** | | **8** | **0** | **2** | **4** |');
      expect(out.markdown).toContain('**8 spots from 8 rules: 2 under the two rules that never block, 2 known, 4 to read.**');
      expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files.`);
      expect(out.lines).toContain(`Semgrep ${version} scanned 2,400 files.`);
      for (const rule of RULES) expect(out.markdown).toContain(`[\`${nameOf(rule.id)}\`](https://semgrep.dev/r/${rule.id})`);
      expect(out.lines.filter((l) => l.startsWith('::error') || l.startsWith('::warning::'))).toEqual([]);
      // A spot a rule that may block reports, and no entry explains, is marked on its line; the rest are not.
      const marked = out.lines.filter((l) => l.startsWith('::warning file='));
      expect(marked).toHaveLength(4);
      for (const spot of everyRule.filter((sp) => !RULES.find((r) => r.id === sp.rule)!.never && !knownAs(nameOf(sp.rule), sp.path))) {
        expect(marked).toContain(`::warning file=${spot.path},line=${spot.line},title=Semgrep ${nameOf(spot.rule)} (report only)::${nameOf(spot.rule)} says so`);
      }
      for (const spot of everyRule) expect(out.lines.some((l) => l.startsWith(`${nameOf(spot.rule)} ${spot.path}:${spot.line}`)), spot.path).toBe(true);
    }
  });

  it('passes a pull request, and warns, when the image cannot be pulled; fails a push or a dispatch', async () => {
    for (const [event, code, annotation] of [['pull_request', 0, '::warning::'], ['push', 1, '::error::'], ['workflow_dispatch', 1, '::error::']] as const) {
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

  it('reads each way a scan can end short as one that did not finish, on a pull request a warning, elsewhere a failure', async () => {
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
      for (const [event, code] of [['pull_request', 0], ['push', 1]] as const) {
        const out = await at(event, s);
        expect(out.code, `${what}, ${event}`).toBe(code);
        expect(out.sarif, `${what}: a scan that did not finish names no SARIF to upload`).toBe('');
        const said = out.markdown.split('### The scan did not finish')[1] ?? '';
        expect(said, what).toMatch(why);
        expect(out.lines.at(-1), what).toMatch(event === 'pull_request' ? /^::warning::Semgrep: the scan did not finish/ : /^::error::Semgrep: the scan did not finish/);
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

  it('runs nothing, and fails only outside a pull request, when SEMGREP_IMAGE is not semgrep by a release tag and its digest', async () => {
    for (const wrong of ['', 'semgrep/semgrep:1.186.0', `semgrep/semgrep:latest@sha256:${'0'.repeat(64)}`, `ghcr.io/semgrep/semgrep:1.186.0@sha256:${'0'.repeat(64)}`, `returntocorp/semgrep:1.186.0@sha256:${'0'.repeat(64)}`]) {
      for (const [event, code] of [['pull_request', 0], ['push', 1]] as const) {
        const s = stub(reports(everyRule));
        const out = await at(event, s, { SEMGREP_IMAGE: wrong });
        expect(s.calls, wrong).toEqual([]);
        expect(out.code, `${event} ${wrong}`).toBe(code);
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
    expect(out.markdown).toContain('**2 spots from 8 rules: 0 under the two rules that never block, 1 known, 1 to read.**');
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
    expect(out.markdown).toContain('| never blocks |');
    expect(out.markdown).toContain('This rule never blocks (D3). 3 spots of 4 are in test files.');
    expect(out.markdown).toContain('<details><summary>Every spot</summary>');
    expect(out.markdown).toContain('**4 spots from 8 rules: 4 under the two rules that never block, 0 known, 0 to read.**');
    expect(out.lines.filter((l) => l.startsWith('::')), 'a rule that never blocks marks no line').toEqual([]);
  });

  it('writes what a rule says into a workflow command as one line, its file and title escaped, so nothing it says starts another command', () => {
    const redirect = RULES.find((r) => nameOf(r.id) === 'js-open-redirect-from-function')!;
    const message = 'line one\n::error::not from us\r\n100% sure';
    const out = report({ image, event: 'pull_request', version, scanned: 2400, findings: [{ rule: redirect.id, path: 'apps/web/a,b:c.tsx', line: 4, message }], notes: [], ran: RULES.map((r) => r.id), sarif: '/tmp/x.sarif' });
    const marked = out.lines.filter((l) => l.startsWith('::warning file='));
    expect(marked).toEqual(['::warning file=apps/web/a%2Cb%3Ac.tsx,line=4,title=Semgrep js-open-redirect-from-function (report only)::line one%0A::error::not from us%0D%0A100%25 sure']);
    expect(out.lines.some((l) => l.startsWith('::error'))).toBe(false);
  });

  it("lists Semgrep's notes on what it could not read in full, which do not stop the scan", async () => {
    // As Semgrep writes one: its kind first in a list, and a message over more than one line.
    const note = { code: 3, level: 'warn', type: ['PartialParsing', [{ path: 'apps/web/src/a.tsx' }]], path: 'apps/web/src/a.tsx', message: 'Syntax error at line apps/web/src/a.tsx:3:\n `<` was unexpected' };
    const out = await at('push', stub(reports(everyRule, { notes: [note] })));
    expect(out.code).toBe(0);
    expect(out.sarif).toBe(join(out.out, CODE_SCANNING_REPORT));
    expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files, with 1 note (below).`);
    expect(out.lines).toContain(`Semgrep ${version} scanned 2,400 files, with 1 note on what it could not read in full.`);
    expect(out.markdown).toContain('| warn | PartialParsing | `apps/web/src/a.tsx` | Syntax error at line apps/web/src/a.tsx:3: |');
  });

  it('lists each place Semgrep read only in part, marks one where a rule that may block can have timed out, and fails nothing while no rule blocks (7)', async () => {
    const [regexp] = RULES;
    const redirect = RULES.find((r) => nameOf(r.id) === 'js-open-redirect-from-function')!;
    const timeouts = [
      timeout('apps/web/src/pages/a-long-page.tsx', 1, 5, regexp!.id),
      timeout('scripts/a-guard.unit.test.ts', 1, 1, regexp!.id),
      timeout('apps/web/src/pages/a-pay-page.tsx', 335, 1, redirect.id),
    ];
    for (const event of ['pull_request', 'push']) {
      const out = await at(event, stub(reports(everyRule, { timeouts })));
      expect(out.code, event).toBe(0);
      expect(out.sarif, event).toBe(join(out.out, CODE_SCANNING_REPORT));
      expect(out.markdown).toContain(`Semgrep ${version} scanned 2,400 files and read 3 places in them only in part (below).`);
      expect(out.lines).toContain(`Semgrep ${version} scanned 2,400 files and read 3 places in them only in part, where its taint analysis timed out.`);
      const section = out.markdown.split('### Read only in part')[1]?.split('\n###')[0] ?? '';
      expect(section, 'no section lists the places').toContain('and no rule blocks yet.');
      expect(section).toContain('| `apps/web/src/pages/a-long-page.tsx` | 1 | 5 | `detect-non-literal-regexp` | of a rule that may block |');
      expect(section).toContain('| `scripts/a-guard.unit.test.ts` | 1 | 1 | `detect-non-literal-regexp` | only of a rule that never blocks |');
      expect(section).toContain('| `apps/web/src/pages/a-pay-page.tsx` | 335 | 1 | `js-open-redirect-from-function` | of a rule that may block |');
      expect(out.lines).toContain('read only in part apps/web/src/pages/a-long-page.tsx:1: 5 rules timed out, the first detect-non-literal-regexp');
      expect(out.lines).toContain('read only in part scripts/a-guard.unit.test.ts:1: 1 rule timed out, the first detect-non-literal-regexp [never blocks]');
      // Marked on its line where a spot of a rule that may block can be missing, and only there.
      expect(out.lines.filter((l) => l.includes('title=Semgrep read this only in part'))).toEqual([
        "::warning file=apps/web/src/pages/a-long-page.tsx,line=1,title=Semgrep read this only in part (report only)::Semgrep's taint analysis timed out here for 5 rules, the first detect-non-literal-regexp: a spot of a rule that may block can be missing.",
        "::warning file=apps/web/src/pages/a-pay-page.tsx,line=335,title=Semgrep read this only in part (report only)::Semgrep's taint analysis timed out here for 1 rule, the first js-open-redirect-from-function: a spot of a rule that may block can be missing.",
      ]);
      expect(out.markdown).not.toContain('### The scan did not finish');
      expect(out.lines.filter((l) => l.startsWith('::error') || l.startsWith('::warning::'))).toEqual([]);
    }
    // With no place read only in part, the summary has no such section.
    const none = await at('push', stub(reports(everyRule)));
    expect(none.markdown).not.toContain('### Read only in part');
    expect(none.markdown).toContain(`Semgrep ${version} scanned 2,400 files.`);
  });

  it('counts a place where a rule that blocks can have timed out as a scan that did not finish, and no other place (7)', () => {
    const [regexp] = RULES;
    const redirect = RULES.find((r) => nameOf(r.id) === 'js-open-redirect-from-function')!;
    const href = RULES.find((r) => nameOf(r.id) === 'react-href-var')!;
    // As step 5 will one day turn one rule blocking.
    const rules = RULES.map((r) => (r === redirect ? { ...r, blocks: true } : r));
    const dir = reportsDir();
    const scanOf = (timeouts: ReadonlyArray<object>) => {
      const written = reports(everyRule, { timeouts });
      writeFileSync(join(dir, JSON_REPORT), JSON.stringify(written.json));
      writeFileSync(join(dir, SARIF_REPORT), JSON.stringify(written.sarif));
      return readScan({ status: 0 }, dir);
    };
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
      for (const [event, code] of [['pull_request', 0], ['push', 1]] as const) {
        const out = report({ ...scanOf([entry]), image, event, rules });
        expect(out.code, `${what}, ${event}`).toBe(code);
        expect(out.sarif, `${what}: a scan that did not finish names no SARIF to upload`).toBe('');
        expect(out.markdown.split('### The scan did not finish')[1] ?? '', what).toMatch(why);
        expect(out.markdown, what).toContain('| of js-open-redirect-from-function, which blocks: the scan did not finish |');
        expect(out.lines.filter((l) => l.includes('title=Semgrep read this only in part'))[0], what).toMatch(/: a spot of a rule that blocks can be missing\.$/);
      }
    }
    // One rule timed out, and Semgrep names one that does not block: nothing that blocks is missing.
    for (const entry of [timeout('apps/web/src/pages/a-long-page.tsx', 1, 1, regexp!.id), timeout('apps/web/src/components/a-consent-link.tsx', 593, 1, href.id)]) {
      const out = report({ ...scanOf([entry]), image, event: 'push', rules });
      expect(out.code, JSON.stringify(entry)).toBe(0);
      expect(out.markdown).not.toContain('### The scan did not finish');
      expect(out.markdown).not.toContain('no rule blocks yet');
    }
  });

  it('reads an entry in another shape as a place any rule can have timed out in, and keeps what Semgrep wrote on one line (7)', () => {
    const [regexp] = RULES;
    const dir = reportsDir();
    const written = reports(everyRule, {
      timeouts: [
        // No location: the place is read from the message.
        { message: `Fixpoint timeout while performing taint analysis at apps/web/src/b.ts:12:3 [rules: 1, first: ${regexp!.id}]` },
        null,
        { message: 'Fixpoint timeout, said another way', location: { path: 'apps/web/src/c.ts', start: { line: 7 } } },
        { location: { path: 'apps/web/x\n::error::y.ts', start: { line: 2 } } },
      ],
    });
    writeFileSync(join(dir, JSON_REPORT), JSON.stringify(written.json));
    writeFileSync(join(dir, SARIF_REPORT), JSON.stringify(written.sarif));
    const scan = readScan({ status: 0 }, dir);
    expect(scan.timeouts).toEqual([
      { path: 'apps/web/src/b.ts', line: 12, rules: 1, first: regexp!.id },
      { path: '', line: 0, rules: null, first: null },
      { path: 'apps/web/src/c.ts', line: 7, rules: null, first: null },
      { path: 'apps/web/x\n::error::y.ts', line: 2, rules: null, first: null },
    ]);
    // The first alone when Semgrep counts one rule and names one RULES has; any rule otherwise.
    expect(timedOut(scan.timeouts![0]!)).toEqual([regexp]);
    expect(timedOut(scan.timeouts![1]!)).toEqual(RULES);
    expect(timedOut({ path: 'a.ts', line: 1, rules: 2, first: regexp!.id })).toEqual(RULES);
    expect(timedOut({ path: 'a.ts', line: 1, rules: 1, first: 'javascript.lang.security.audit.detect-eval-with-expression.detect-eval-with-expression' })).toEqual(RULES);
    const out = report({ ...scan, image, event: 'push' });
    expect(out.code).toBe(0);
    expect(out.markdown).toContain('| not named |  | not said | not said | of a rule that may block |');
    expect(out.lines).toContain('read only in part a place Semgrep did not name: the rules not said');
    expect(out.lines).toContain(
      "::warning title=Semgrep read this only in part (report only)::Semgrep's taint analysis timed out here for rules its report does not name: a spot of a rule that may block can be missing.",
    );
    // A line break in a path starts no workflow command of its own.
    expect(out.lines).toContain('read only in part apps/web/x ::error::y.ts:2: the rules not said');
    expect(out.lines).toContain(
      "::warning file=apps/web/x%0A%3A%3Aerror%3A%3Ay.ts,line=2,title=Semgrep read this only in part (report only)::Semgrep's taint analysis timed out here for rules its report does not name: a spot of a rule that may block can be missing.",
    );
    expect(out.lines.some((l) => l.includes('\n'))).toBe(false);
    expect(out.lines.some((l) => l.startsWith('::error'))).toBe(false);
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
