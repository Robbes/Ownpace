// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECRET A PULL REQUEST COULD ADD (workplan 0163 T6; the owner's decision D4
 * of 2026-11-20: gitleaks may ignore test-file paths and the one placeholder
 * doc, with no inline ignore comments, and fails the build).
 *
 * Nothing in CI read a commit for a secret before it merged. A value committed
 * once stays in the history for good, even when a later commit of the same
 * branch removes it, and a merge brings that history to main. An outside,
 * read-only check of 2026-11-20 found no secret in this tree, and gitleaks
 * 8.30.1 found none either: its 67 hits in the files and 77 in the history
 * were test files' fake tokens and documentation placeholders (0163 §4.2). So
 * ci.yml's `gitleaks` job reads every commit a pull request adds, and a
 * finding fails it. This holds:
 *
 *  1. THE CONFIG IS GITLEAKS' DEFAULT RULES AND ONE ALLOWLIST OF PATHS, unit
 *     and integration test files and docs/o365-setup.md, line for line: no
 *     rule turned off or added, no regex, stopword or commit allowed. The
 *     paths match what they name and nothing else this repository holds.
 *  2. NO LINE EXCUSES ITSELF: the report runs gitleaks with
 *     `--ignore-gitleaks-allow`, so a `gitleaks:allow` comment does nothing;
 *     no `.gitleaksignore` is in the tree, and the report refuses to run while
 *     one exists, since gitleaks reads it whatever its flags say.
 *  3. THE JOB READS WHAT A PULL REQUEST ADDS AND GATES IT: on pull requests
 *     only, as commit-convention does, on a GitHub-hosted runner, with the
 *     whole history fetched, both ends of the range passed through `env:`, no
 *     `continue-on-error` and no `if:` on a step; ci-complete needs it, and its
 *     SHOULD_RUN says it runs exactly where the job's `if:` does. The pinned
 *     install is `gitleaksPin`'s, held in a-pin-that-knows-it-is-behind.
 *  4. THE REPORT, RUN AGAINST A STUBBED GITLEAKS AND GIT, fails the job on any
 *     finding and on any scan that did not finish, and prints a finding's
 *     rule, file, line and commit, never its value, the text it matched, or
 *     the commit's author, address or message.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CONFIG, IGNORE_FILE, LEAK_EXIT, REPORT, readReport, report, run, saidOf, scanArgs, type Ran } from './gitleaks-report.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const WORKFLOW = '.github/workflows/ci.yml';
const JOB = 'gitleaks';
const ONLY_ON_PULL_REQUESTS = "github.event_name == 'pull_request'";
const SCAN = 'node scripts/gitleaks-report.mjs "$BASE_SHA" "$HEAD_SHA"';

/** `.gitleaks.toml` without its comments and blank lines: exactly this (1). */
const CONFIG_LINES = [
  `title = "Ownpace: gitleaks' default rules; test files and one placeholder doc allowed"`,
  '[extend]',
  'useDefault = true',
  '[[allowlists]]',
  `description = "Unit and integration test files' fake tokens, and docs/o365-setup.md's placeholders (workplan 0163 D4)"`,
  'paths = [',
  "'''\\.unit\\.test\\.ts$''',",
  "'''\\.integration\\.test\\.ts$''',",
  "'''^docs/o365-setup\\.md$''',",
  ']',
];

/** The meaningful lines of a TOML text: no comment, no blank line, each trimmed. */
const meaningful = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

/** The allowlist's path patterns, as gitleaks reads them (Go's regexp; these use nothing JavaScript reads otherwise). */
function allowedPaths(text: string): RegExp[] {
  return [...text.matchAll(/^\s*'''(.+)''',?\s*$/gm)].map((m) => new RegExp(m[1]!));
}

/** Every file git tracks. */
const tracked = (): string[] => execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);

interface Step {
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
  readonly needs?: unknown;
  readonly env?: Record<string, unknown>;
  readonly steps?: ReadonlyArray<Step>;
  readonly 'continue-on-error'?: unknown;
}

/** What is wrong with ci.yml's gitleaks job and ci-complete's account of it (3); empty when both hold. */
export function jobProblems(text: string): string[] {
  const out: string[] = [];
  const jobs = (parseYaml(text) as { jobs?: Record<string, Job> }).jobs ?? {};
  const job = jobs[JOB];
  if (!job) return [`${WORKFLOW} has no ${JOB} job`];
  if (job.if !== ONLY_ON_PULL_REQUESTS) out.push(`its if: is ${JSON.stringify(job.if)}, not \`${ONLY_ON_PULL_REQUESTS}\`: it reads what a pull request adds, never main's history`);
  if (typeof job['runs-on'] !== 'string' || !/^ubuntu-\d/.test(job['runs-on'])) out.push(`runs-on is ${JSON.stringify(job['runs-on'])}, not a GitHub-hosted ubuntu runner`);
  const steps = job.steps ?? [];
  const swallowing: Array<[string, unknown]> = [['the job', job['continue-on-error']], ...steps.map((s, i): [string, unknown] => [`step ${i + 1}`, s['continue-on-error']])];
  for (const [where, value] of swallowing) {
    if (value !== undefined) out.push(`${where} sets continue-on-error (${String(value)}): a finding would pass`);
  }
  for (const [i, s] of steps.entries()) if (s.if !== undefined) out.push(`step ${i + 1} has an if: (${String(s.if)}), so a run can skip it`);
  const checkout = steps.find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  if (!checkout) out.push('it checks nothing out');
  else {
    if (String(checkout.with?.['fetch-depth']) !== '0') out.push(`its checkout's fetch-depth is ${JSON.stringify(checkout.with?.['fetch-depth'])}, not 0: the range's two ends must be in the history`);
    if (String(checkout.with?.['persist-credentials']) !== 'false') out.push('its checkout keeps the token (persist-credentials is not false)');
  }
  const runs = steps.filter((s) => typeof s.run === 'string');
  const scans = runs.filter((s) => s.run!.includes('gitleaks-report.mjs'));
  if (scans.length !== 1 || scans[0]!.run!.trim() !== SCAN) out.push(`its scan step runs ${JSON.stringify(scans.map((s) => s.run))}, not the one \`${SCAN}\``);
  else {
    const env = scans[0]!.env ?? {};
    if (env['BASE_SHA'] !== '${{ github.event.pull_request.base.sha }}' || env['HEAD_SHA'] !== '${{ github.event.pull_request.head.sha }}') {
      out.push("its scan step does not take BASE_SHA and HEAD_SHA from the pull request's base and head, through env:");
    }
    if (Object.hasOwn(env, 'GITLEAKS')) out.push('its scan step names its own GITLEAKS, not the binary the install step checked');
  }
  if (runs.length !== 2) out.push(`it has ${runs.length} run steps, not the install and the scan`);
  const aggregator = jobs['ci-complete'];
  const needs = Array.isArray(aggregator?.needs) ? (aggregator.needs as unknown[]) : [];
  if (!needs.includes(JOB)) out.push(`ci-complete does not need ${JOB}, so a finding would not stop the merge`);
  const should = String(aggregator?.env?.['SHOULD_RUN'] ?? '');
  if (!should.includes(`"${JOB}": \${{ ${ONLY_ON_PULL_REQUESTS} }},`)) out.push(`ci-complete's SHOULD_RUN does not say ${JOB} runs where its if: does (${ONLY_ON_PULL_REQUESTS})`);
  return out;
}

describe('the config: gitleaks’ default rules and one allowlist of paths (1, 2)', () => {
  const text = read(CONFIG);

  it('is exactly the default rules, extended, and the three paths D4 allows, with nothing turned off or added', () => {
    expect(meaningful(text)).toEqual(CONFIG_LINES);
  });

  it('refuses a rule turned off, a rule added, a regex or a commit allowed, or a fourth path, by a change to the real file', () => {
    const changed = (from: string, to: string): string[] => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return meaningful(next);
    };
    expect(changed('useDefault = true', 'useDefault = true\ndisabledRules = ["generic-api-key"]')).not.toEqual(CONFIG_LINES);
    expect(changed('[[allowlists]]', '[[rules]]\nid = "x"\nregex = \'\'\'x\'\'\'\n\n[[allowlists]]')).not.toEqual(CONFIG_LINES);
    expect(changed('paths = [', "regexes = ['''.*''']\npaths = [")).not.toEqual(CONFIG_LINES);
    expect(changed('paths = [', 'commits = ["0123456789abcdef0123456789abcdef01234567"]\npaths = [')).not.toEqual(CONFIG_LINES);
    expect(changed("'''^docs/o365-setup\\.md$''',", "'''^docs/o365-setup\\.md$''',\n  '''\\.md$''',")).not.toEqual(CONFIG_LINES);
  });

  it('allows unit and integration test files and docs/o365-setup.md, and nothing else this repository holds', () => {
    const paths = allowedPaths(text);
    expect(paths).toHaveLength(3);
    const allowed = (file: string): boolean => paths.some((re) => re.test(file));
    for (const file of ['scripts/redact-evidence.unit.test.ts', 'apps/api/src/routes/billing/billing.integration.test.ts', 'docs/o365-setup.md']) expect(allowed(file), file).toBe(true);
    for (const file of ['docs/o365-setup.md.bak', 'old/docs/o365-setup.md', 'apps/api/src/index.ts', 'scripts/unit.test.ts.mjs', 'deploy/compose/managed.env.example', '.env', 'a.unit.test.tsx']) {
      expect(allowed(file), file).toBe(false);
    }
    const files = tracked();
    expect(files.length).toBeGreaterThan(1000);
    const strays = files.filter((f) => allowed(f) && !/\.(?:unit|integration)\.test\.ts$/.test(f) && f !== 'docs/o365-setup.md');
    expect(strays, 'the allowlist matches a file that is neither a unit or integration test file nor docs/o365-setup.md').toEqual([]);
    expect(files, 'docs/o365-setup.md, which the allowlist names, is gone: take it out of the list').toContain('docs/o365-setup.md');
  });

  it('has no .gitleaksignore beside it, in the tree or on disk, and the report turns gitleaks:allow off', () => {
    expect(tracked().filter((f) => f === IGNORE_FILE || f.endsWith(`/${IGNORE_FILE}`))).toEqual([]);
    expect(existsSync(join(REPO_ROOT, IGNORE_FILE))).toBe(false);
    expect(scanArgs({ base: 'a'.repeat(40), head: 'b'.repeat(40), report: '/r.json' })).toContain('--ignore-gitleaks-allow');
  });
});

describe('ci.yml’s gitleaks job: a pull request’s own commits, and ci-complete waits for it (3)', () => {
  const text = read(WORKFLOW);

  it('reads the range a pull request adds, on a hosted runner, with nothing to swallow a finding, and ci-complete needs it where it runs', () => {
    expect(jobProblems(text)).toEqual([]);
  });

  it('refuses each way the job could read the wrong commits, pass a finding, or leave the merge ungated, by a change to the real file', () => {
    const mutate = (from: string | RegExp, to: string): string => {
      const next = text.replace(from, to);
      expect(next, String(from)).not.toBe(text);
      return jobProblems(next).join('\n');
    };
    const job = /\n {2}gitleaks:\n {4}name: gitleaks\n/;
    const scanStep = `        run: ${SCAN}\n`;
    expect(mutate(job, '\n  gitleaks:\n    name: gitleaks\n    continue-on-error: true\n')).toMatch(/the job sets continue-on-error/);
    expect(mutate(scanStep, `${scanStep}        continue-on-error: true\n`)).toMatch(/sets continue-on-error \(true\)/);
    expect(mutate(scanStep, `${scanStep}        if: always()\n`)).toMatch(/has an if: \(always\(\)\)/);
    expect(mutate(`run: ${SCAN}`, 'run: node scripts/gitleaks-report.mjs "$BASE_SHA" "$HEAD_SHA" || true')).toMatch(/not the one/);
    expect(mutate('BASE_SHA: ${{ github.event.pull_request.base.sha }}\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n        run: node scripts/gitleaks-report.mjs', 'BASE_SHA: ${{ github.event.before }}\n          HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n        run: node scripts/gitleaks-report.mjs')).toMatch(
      /does not take BASE_SHA and HEAD_SHA from the pull request/,
    );
    const gitleaksIf = /(\n {2}gitleaks:\n[\s\S]*?\n {4}if: )github\.event_name == 'pull_request'/;
    expect(mutate(gitleaksIf, '$1always()')).toMatch(/its if: is "always\(\)"/);
    expect(mutate('\n      - gitleaks\n', '\n')).toMatch(/ci-complete does not need gitleaks/);
    expect(mutate(`          "gitleaks": \${{ ${ONLY_ON_PULL_REQUESTS} }},\n`, '          "gitleaks": true,\n')).toMatch(/SHOULD_RUN does not say gitleaks runs where its if: does/);
    const fetchDepth = /(\n {2}gitleaks:\n[\s\S]*?)fetch-depth: 0\n/;
    expect(mutate(fetchDepth, '$1fetch-depth: 1\n')).toMatch(/fetch-depth is 1, not 0/);
  });

  it('is the only gitleaks job in any workflow', () => {
    const dir = join(REPO_ROOT, '.github/workflows');
    const named = execFileSync('git', ['ls-files', '.github/workflows'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => readFileSync(join(REPO_ROOT, f), 'utf8').includes('gitleaks-report.mjs'));
    expect(named).toEqual([WORKFLOW]);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('the gitleaks report, run against a stubbed gitleaks and git (4)', () => {
  const BASE = '1'.repeat(40);
  const HEAD = '2'.repeat(40);
  const made: string[] = [];
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'gitleaks-report-'));
    made.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  /** A finding as gitleaks writes it, every field it has, the dangerous ones carrying text this must never print. */
  const finding = (over: Record<string, unknown> = {}) => ({
    RuleID: 'generic-api-key',
    Description: 'Detected a Generic API Key, potentially exposing access to various services and sensitive operations.',
    StartLine: 12,
    EndLine: 12,
    StartColumn: 3,
    EndColumn: 40,
    Match: 'api_key = "MATCHED-TEXT-NEVER-PRINTED"',
    Secret: 'SECRET-VALUE-NEVER-PRINTED',
    File: 'apps/api/src/config.ts',
    SymlinkFile: '',
    Commit: '3'.repeat(40),
    Entropy: 4.2,
    Author: 'AUTHOR-NEVER-PRINTED',
    Email: 'ADDRESS-NEVER-PRINTED',
    Date: '2026-11-21T00:00:00Z',
    Message: 'MESSAGE-NEVER-PRINTED',
    Tags: [],
    Fingerprint: `${'3'.repeat(40)}:apps/api/src/config.ts:generic-api-key:12`,
    ...over,
  });
  const NEVER = ['SECRET-VALUE-NEVER-PRINTED', 'MATCHED-TEXT-NEVER-PRINTED', 'AUTHOR-NEVER-PRINTED', 'ADDRESS-NEVER-PRINTED', 'MESSAGE-NEVER-PRINTED'];

  /** A git that counts `commits` in any range, and a gitleaks that writes `reported` (raw text) and exits `status`. */
  const stubs = (o: { commits?: number; countFails?: boolean; status?: number | null; reported?: string | null; stderr?: string; error?: Error & { code?: string } } = {}) => {
    const calls: { git: string[][]; gitleaks: Array<{ binary: string; args: string[] }> } = { git: [], gitleaks: [] };
    const git = (args: string[]): Ran => {
      calls.git.push(args);
      return o.countFails ? { status: 128, stdout: '', stderr: "fatal: bad revision '1111..2222'" } : { status: 0, stdout: `${o.commits ?? 2}\n`, stderr: '' };
    };
    const gitleaks = (binary: string, args: string[]): Ran => {
      calls.gitleaks.push({ binary, args });
      if (o.error) return { status: null, error: o.error };
      const at = args[args.indexOf('--report-path') + 1]!;
      if (o.reported !== null) writeFileSync(at, o.reported ?? '[]');
      return { status: o.status === undefined ? 0 : o.status, stdout: '', stderr: o.stderr ?? '' };
    };
    return { calls, git, gitleaks };
  };
  const at = (s: ReturnType<typeof stubs>, o: { argv?: string[]; root?: string; env?: Record<string, string> } = {}) => {
    const out = scratch();
    return { out, result: run({ root: o.root ?? REPO_ROOT, argv: o.argv ?? [BASE, HEAD], env: o.env ?? { RUNNER_TEMP: '/runner/temp' }, git: s.git, gitleaks: s.gitleaks, out }) };
  };

  it('counts the range, then runs gitleaks once over it with the config, a merge as git’s remerge diff, redacted, allow comments off and its own exit code for a finding', () => {
    const s = stubs();
    const { out, result } = at(s);
    expect(s.calls.git).toEqual([['rev-list', '--count', `${BASE}..${HEAD}`]]);
    expect(s.calls.gitleaks).toHaveLength(1);
    expect(s.calls.gitleaks[0]!.binary).toBe('/runner/temp/gitleaks-bin/gitleaks');
    expect(s.calls.gitleaks[0]!.args).toEqual([
      'git',
      '--config', CONFIG,
      '--log-opts', `--diff-merges=remerge ${BASE}..${HEAD}`,
      '--redact',
      '--ignore-gitleaks-allow',
      '--exit-code', String(LEAK_EXIT),
      '--report-format', 'json',
      '--report-path', join(out, REPORT),
      '--no-banner',
      '--no-color',
      '.',
    ]);
    expect(LEAK_EXIT).not.toBe(1);
    expect(result.code).toBe(0);
    expect(result.lines.at(-1)).toBe('Nothing found.');
    expect(result.markdown).toContain(`(\`${BASE.slice(0, 12)}..${HEAD.slice(0, 12)}\`, 2 commits)`);
  });

  it('runs the binary GITLEAKS names when it is set', () => {
    const s = stubs();
    at(s, { env: { GITLEAKS: '/opt/gitleaks', RUNNER_TEMP: '/runner/temp' } });
    expect(s.calls.gitleaks[0]!.binary).toBe('/opt/gitleaks');
  });

  it('fails on a finding, naming its rule, file, line and commit, and never its value, what it matched, or the commit’s author, address or message', () => {
    const s = stubs({ status: LEAK_EXIT, reported: JSON.stringify([finding(), finding({ File: 'deploy/compose/a,b:c.env', StartLine: 3, RuleID: 'private-key' })]) });
    const { result } = at(s);
    expect(result.code).toBe(1);
    expect(result.markdown).toContain(`| \`apps/api/src/config.ts\` | 12 | generic-api-key | \`${'3'.repeat(12)}\` |`);
    const marked = result.lines.filter((l) => l.startsWith('::error file='));
    expect(marked).toHaveLength(2);
    expect(marked[0]).toMatch(new RegExp(`^::error file=apps/api/src/config\\.ts,line=12,title=gitleaks generic-api-key::gitleaks' generic-api-key matched a line commit ${'3'.repeat(12)} adds\\.`));
    expect(marked[1]).toMatch(/^::error file=deploy\/compose\/a%2Cb%3Ac\.env,line=3,title=gitleaks private-key::/);
    expect(result.lines.at(-1)).toBe('2 findings: this pull request adds a secret, or something shaped like one.');
    const said = `${result.markdown}\n${result.lines.join('\n')}`;
    for (const word of NEVER) expect(said, word).not.toContain(word);
  });

  it('fails a scan that did not finish: an error exit, an unknown flag, a stop, a run that could not start', () => {
    const cases: Array<[ReturnType<typeof stubs>, RegExp]> = [
      [stubs({ status: 1, reported: null }), /gitleaks exited 1, not 0 \(nothing found\) or 3 \(a finding\)/],
      [stubs({ status: 126, reported: null }), /gitleaks exited 126/],
      [stubs({ status: null, reported: null }), /gitleaks exited without a status/],
      [stubs({ error: Object.assign(new Error('spawnSync gitleaks ENOENT'), { code: 'ENOENT' }) }), /gitleaks could not be run \(ENOENT\)/],
    ];
    for (const [s, why] of cases) {
      const { result } = at(s);
      expect(result.code, why.source).toBe(1);
      expect(result.markdown.split('### The scan did not finish')[1] ?? '', why.source).toMatch(why);
      expect(result.lines.at(-1)).toBe('The scan did not finish.');
    }
  });

  it('fails a report it cannot read, one not in its shape, and one that disagrees with the exit code', () => {
    const cases: Array<[ReturnType<typeof stubs>, RegExp]> = [
      [stubs({ status: 0, reported: null }), /gitleaks wrote no report/],
      [stubs({ status: LEAK_EXIT, reported: '[{"RuleID":' }), /gitleaks' report is not JSON/],
      [stubs({ status: 0, reported: '{"findings": []}' }), /not a list of findings/],
      [stubs({ status: LEAK_EXIT, reported: JSON.stringify([{ RuleID: 'x', File: 'a.ts' }]) }), /a finding without a rule, a file, a line and a commit/],
      [stubs({ status: 0, reported: JSON.stringify([finding()]) }), /gitleaks exited 0 and its report lists 1 finding: the two disagree/],
      [stubs({ status: LEAK_EXIT, reported: '[]' }), /gitleaks exited 3, a finding, and its report lists none/],
    ];
    for (const [s, why] of cases) {
      const { result } = at(s);
      expect(result.code, why.source).toBe(1);
      expect(result.markdown, why.source).toMatch(why);
    }
  });

  it('reads no report an earlier run left behind', () => {
    const s = stubs({ status: 0, reported: null });
    const out = scratch();
    writeFileSync(join(out, REPORT), JSON.stringify([finding()]));
    const result = run({ root: REPO_ROOT, argv: [BASE, HEAD], env: {}, git: s.git, gitleaks: s.gitleaks, out });
    expect(result.code).toBe(1);
    expect(result.markdown).toContain('gitleaks wrote no report');
  });

  it('runs nothing, and fails, on a range that is not two commit ids, holds no commit, or git cannot count', () => {
    for (const argv of [[], [BASE], ['main', HEAD], [BASE, `${HEAD}x`], [BASE.slice(0, 12), HEAD]]) {
      const s = stubs();
      const { result } = at(s, { argv });
      expect(result.code, JSON.stringify(argv)).toBe(1);
      expect(s.calls.git, JSON.stringify(argv)).toEqual([]);
      expect(s.calls.gitleaks).toEqual([]);
    }
    const empty = stubs({ commits: 0 });
    expect(at(empty).result.markdown).toMatch(/holds no commit, so there would be nothing to read/);
    expect(empty.calls.gitleaks).toEqual([]);
    const lost = stubs({ countFails: true });
    expect(at(lost).result.markdown).toMatch(/git could not count the commits in .*: fatal: bad revision/);
    expect(lost.calls.gitleaks).toEqual([]);
  });

  it('runs nothing, and fails, while a .gitleaksignore exists or the config is missing', () => {
    const root = scratch();
    copyFileSync(join(REPO_ROOT, CONFIG), join(root, CONFIG));
    writeFileSync(join(root, IGNORE_FILE), `${'3'.repeat(40)}:apps/api/src/config.ts:generic-api-key:12\n`);
    const s = stubs();
    const ignored = at(s, { root }).result;
    expect(ignored.code).toBe(1);
    expect(ignored.markdown).toMatch(/\.gitleaksignore exists, and gitleaks would read it whatever its flags say/);
    expect(s.calls.git).toEqual([]);
    expect(s.calls.gitleaks).toEqual([]);
    const bare = scratch();
    const missing = at(stubs(), { root: bare }).result;
    expect(missing.code).toBe(1);
    expect(missing.markdown).toMatch(/there is no \.gitleaks\.toml at the repository's root/);
  });

  it('repeats only gitleaks’ closing lines from its log, which carry no value', () => {
    const stderr = [
      '12:01AM INF 2 commits scanned.',
      '12:01AM WRN some line that quotes MATCHED-TEXT-NEVER-PRINTED',
      '12:01AM INF scanned ~1234 bytes (1.23 KB) in 45ms',
      '12:01AM INF no leaks found',
    ].join('\n');
    expect(saidOf(stderr)).toEqual(['scanned ~1234 bytes (1.23 KB) in 45ms', 'no leaks found']);
    expect(saidOf('12:01AM WRN leaks found: 2\n')).toEqual(['leaks found: 2']);
    const { result } = at(stubs({ stderr }));
    expect(result.lines).toContain('gitleaks said: scanned ~1234 bytes (1.23 KB) in 45ms');
    expect(result.lines.join('\n')).not.toContain('MATCHED-TEXT-NEVER-PRINTED');
  });

  it('keeps of a finding only its rule, file, line and commit, sorted by file and line', () => {
    const path = join(scratch(), REPORT);
    writeFileSync(path, JSON.stringify([finding({ File: 'b.ts', StartLine: 2 }), finding({ File: 'a.ts', StartLine: 9 }), finding({ File: 'a.ts', StartLine: 1 })]));
    expect(readReport(path)).toEqual({
      findings: [
        { rule: 'generic-api-key', file: 'a.ts', line: 1, commit: '3'.repeat(40) },
        { rule: 'generic-api-key', file: 'a.ts', line: 9, commit: '3'.repeat(40) },
        { rule: 'generic-api-key', file: 'b.ts', line: 2, commit: '3'.repeat(40) },
      ],
    });
    expect(report({ base: BASE, head: HEAD, commits: 1, status: 0, read: { findings: [] } }).code).toBe(0);
  });
});
