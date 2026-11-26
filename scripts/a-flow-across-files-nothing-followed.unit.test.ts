// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FLOW ACROSS FILES NOTHING FOLLOWED (workplan 0178 T5; the owner's D1 (a)
 * and D8 (a) of 2026-11-26).
 *
 * Semgrep's free engine follows a value within one function, and in this code
 * a body is read in a route and used in a store or a client, in another file.
 * Nothing in CI followed such a value until `codeql.yml`: CodeQL's default
 * suite for JavaScript and TypeScript, report only, uploading to code scanning
 * beside Trivy and Semgrep. So this holds:
 *
 *  1. IT REPORTS ONLY, AND NEVER ON A PULL REQUEST: a push to main, a weekly
 *     schedule and a dispatch, nothing else, since on a pull request code
 *     scanning adds a check of its own that can fail on a new alert, and this
 *     repository decides itself what blocks (0178 §4.1). No query fails the
 *     job, the ReDoS queries included (D8 (a)): a query blocks later only
 *     through a report of its own, one at a time (T9).
 *  2. IT IS PINNED AS THE REPOSITORY PINS: every action by its commit with
 *     the version beside it; `github/codeql-action` at the same commit as the
 *     other workflows' copies, so one Dependabot move takes them together;
 *     the default suite and the CodeQL bundle that release ships, so no
 *     `queries:`, and `tools: linked`, never the runner's cached CodeQL. The pin watch has a row
 *     for it (a-pin-that-knows-it-is-behind).
 *  3. LEAST PERMISSIONS, A HOSTED RUNNER, NO SECRET: nothing at the top, and
 *     the job reads the tree and writes code scanning's list and nothing else;
 *     `ubuntu-24.04`; no `secrets.*`; a run on main is never cancelled by the
 *     next (a-run-that-was-cancelled-and-called-green).
 *  4. A PROOF THAT IT READS WHAT IT SHOULD (0178 §8 step 2, §10): a dispatch
 *     with `proof` reads the tree and one known-bad fixture, uploads nothing,
 *     and is red unless `js/sql-injection` and `js/reflected-xss` are both
 *     reported in the fixture. The ordinary run leaves the fixture out, and
 *     the two configurations differ by that line alone. Nothing shipped names
 *     the fixture's folder.
 *  5. A SCAN THAT DID NOT FINISH IS NEVER GREEN (security-scan.yml's rule):
 *     the report reads the SARIF, and fails when it is missing, when a file
 *     could not be extracted, or when a source file the checkout tracks is not
 *     among those CodeQL says it extracted (0178 §4.1: CodeQL parses
 *     TypeScript with its own compiler, not this repository's 7). It never
 *     fails on an alert.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  FIXTURE,
  MIN_EXTRACTED,
  PROOF_QUERIES,
  expectedFiles,
  readSarif,
  report,
} from './codeql-report.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');
const WORKFLOW_PATH = '.github/workflows/codeql.yml';
const workflowText = read(WORKFLOW_PATH);

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
  readonly 'continue-on-error'?: unknown;
}
interface Job {
  readonly name?: string;
  readonly 'runs-on'?: unknown;
  readonly 'timeout-minutes'?: number;
  readonly permissions?: Record<string, string>;
  readonly steps: ReadonlyArray<Step>;
  readonly if?: unknown;
  readonly 'continue-on-error'?: unknown;
}
interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly concurrency?: { readonly group: string; readonly 'cancel-in-progress': unknown };
  readonly jobs: Record<string, Job>;
}
const workflow = parse(workflowText) as Workflow;
const jobs = Object.values(workflow.jobs);
const job = jobs[0]!;
const stepUsing = (action: string): Step => {
  const found = job.steps.filter((s) => s.uses?.startsWith(`${action}@`));
  expect(found, `codeql.yml runs ${action} ${found.length} times, not once`).toHaveLength(1);
  return found[0]!;
};

describe('1. it reports only, and never on a pull request', () => {
  it('runs on a push to main, once a week and on dispatch, and on nothing else', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'schedule', 'workflow_dispatch']);
    expect(workflow.on.push).toEqual({ branches: ['main'] });
    expect(workflow.on.schedule).toHaveLength(1);
    const cron = (workflow.on.schedule as Array<{ cron: string }>)[0]!.cron;
    expect(cron.split(' '), 'weekly: one day of the week, every week').toHaveLength(5);
    expect(cron.split(' ').slice(2, 4)).toEqual(['*', '*']);
    expect(cron.split(' ')[4]).toMatch(/^[0-6]$/);
  });

  it('is one job, with nothing that turns a failure green and nothing that skips it', () => {
    expect(jobs).toHaveLength(1);
    expect(job.if).toBeUndefined();
    expect(job['continue-on-error']).toBeUndefined();
    for (const step of job.steps) expect(step['continue-on-error'], step.name ?? step.uses).toBeUndefined();
  });

  it('names no query and no pack, so it runs the default suite and nothing fails on an alert', () => {
    const init = stepUsing('github/codeql-action/init');
    expect(Object.keys(init.with ?? {}).sort()).toEqual(['build-mode', 'config-file', 'languages', 'tools']);
    expect(init.with).toMatchObject({ languages: 'javascript-typescript', 'build-mode': 'none' });
    expect(workflowText).not.toMatch(/security-extended|security-and-quality|^\s*queries:|^\s*packs:/m);
  });
});

describe('2. it is pinned as the repository pins', () => {
  const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

  it('names every action by its commit, with its version beside it', () => {
    const lines = workflowText.split('\n').filter((l) => /^\s*(?:- )?uses:/.test(l));
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.replace(/^\s*(?:- )?uses:\s*/, ''), line).toMatch(PINNED);
  });

  it('runs github/codeql-action at the commit every other workflow runs it at', () => {
    const copies = new Map<string, string>();
    for (const file of ['codeql.yml', 'semgrep.yml', 'security-scan.yml']) {
      for (const m of read(`.github/workflows/${file}`).matchAll(/uses:\s*github\/codeql-action\/[\w-]+@([0-9a-f]{40}) # (v[\d.]+)/g)) {
        copies.set(`${file}@${m.index}: ${m[0]}`, `${m[1]} ${m[2]}`);
      }
    }
    expect(copies.size).toBeGreaterThanOrEqual(5);
    expect(new Set(copies.values()), [...copies.keys()].join('\n')).toHaveProperty('size', 1);
  });

  it('runs the CodeQL bundle that release ships, named as `linked`, never the runner\'s cached one', () => {
    // Left unnamed, the action took the runner's tool cache: run 45886149663, the
    // first on main, ran CodeQL 2.27.6 from /opt/hostedtoolcache while v4.39.4
    // ships 2.27.5 (0178 T6). `linked` is the bundle the pinned release names.
    expect(stepUsing('github/codeql-action/init').with!.tools).toBe('linked');
    expect(workflowText.match(/^\s*tools:/gm)).toHaveLength(1);
  });
});

describe('3. least permissions, a hosted runner, no secret', () => {
  it('grants nothing at the top, and the job reads the tree and writes code scanning only', () => {
    expect(workflow.permissions).toEqual({});
    expect(job.permissions).toEqual({ contents: 'read', 'security-events': 'write' });
  });

  it('runs on a GitHub-hosted runner, with a time limit, and reads no secret', () => {
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(workflowText).not.toMatch(/secrets\.|environment:/);
  });

  it('checks out without keeping a credential, and never cancels a run on main', () => {
    expect(stepUsing('actions/checkout').with).toEqual({ 'persist-credentials': false });
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('gives each event its own queue, so a push to main never replaces a dispatch waiting behind another push', () => {
    // GitHub keeps one waiting run per group: with the group on the ref alone,
    // the proof dispatch of 2026-11-26 waited behind the first push run on main,
    // and a second push would have replaced it (0178 T6).
    expect(workflow.concurrency?.group).toBe('codeql-${{ github.event_name }}-${{ github.ref }}');
  });
});

describe('4. a proof that it reads what it should', () => {
  const dispatch = workflow.on.workflow_dispatch as { inputs: Record<string, { type: string; default: unknown }> };

  it('is a dispatch input, off unless asked for', () => {
    expect(Object.keys(dispatch.inputs)).toEqual(['proof']);
    expect(dispatch.inputs.proof).toMatchObject({ type: 'boolean', default: false });
  });

  it('reads the fixture only in a proof run, and uploads nothing from one', () => {
    const init = stepUsing('github/codeql-action/init');
    expect(init.with!['config-file']).toBe(
      "${{ inputs.proof && './.github/codeql/codeql-proof.yml' || './.github/codeql/codeql.yml' }}",
    );
    const analyze = stepUsing('github/codeql-action/analyze');
    expect(analyze.with!.upload).toBe("${{ inputs.proof && 'never' || 'always' }}");
    expect(analyze.with!.output).toBe('${{ runner.temp }}/codeql-sarif');
    const reported = job.steps.filter((s) => s.run?.includes('scripts/codeql-report.mjs'));
    expect(reported).toHaveLength(1);
    expect(reported[0]!.env).toEqual({ PROOF: '${{ inputs.proof }}', SARIF_DIR: '${{ runner.temp }}/codeql-sarif' });
    expect(reported[0]!.run!.trim()).toBe('node scripts/codeql-report.mjs');
    expect(job.steps.at(-1)).toBe(reported[0]);
  });

  it('has two configurations that differ by the fixture alone', () => {
    const ordinary = parse(read('.github/codeql/codeql.yml')) as Record<string, unknown>;
    const proof = parse(read('.github/codeql/codeql-proof.yml')) as Record<string, unknown>;
    expect(ordinary).toEqual({ ...proof, 'paths-ignore': [FIXTURE] });
  });

  it('keeps its fixture where nothing shipped can reach it', () => {
    expect(FIXTURE).toBe('scripts/fixtures/codeql-known-bad');
    expect(read(`${FIXTURE}/handler.mjs`)).toMatch(/req\.query[\s\S]*pool\.query\("SELECT[\s\S]*res\.send\('<p>' \+ name/);
    // git grep exits 1 when nothing matches, which is the answer wanted here.
    const grep = spawnSync('git', ['grep', '-l', 'codeql-known-bad', '--', 'apps', 'packages', 'site', 'deploy', 'test'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(grep.status, grep.stderr).toBe(1);
    expect(grep.stdout).toBe('');
  });
});

/** A SARIF of the shape CodeQL writes, as far as the report reads it. */
const sarif = (results: Array<[string, string]>, extracted: string[], problems: Array<[string, string]> = []) =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.5' } },
        results: results.map(([ruleId, uri]) => ({
          ruleId,
          message: { text: 'a flow' },
          locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 7 } } }],
        })),
        invocations: [
          {
            executionSuccessful: true,
            toolExecutionNotifications: [
              ...extracted.map((uri) => ({
                descriptor: { id: 'js/diagnostics/successfully-extracted-files' },
                level: 'none',
                locations: [{ physicalLocation: { artifactLocation: { uri } } }],
              })),
              ...problems.map(([uri, text]) => ({
                descriptor: { id: 'js/diagnostics/extraction-errors' },
                level: 'warning',
                message: { text },
                locations: [{ physicalLocation: { artifactLocation: { uri } } }],
              })),
            ],
          },
        ],
      },
    ],
  });

const TREE = Array.from({ length: MIN_EXTRACTED }, (_, i) => `packages/p/src/f${i}.ts`);
const FIXTURE_FILE = `${FIXTURE}/handler.mjs`;
const TRACKED = [...TREE, FIXTURE_FILE, 'docs/testing.md', 'node_modules/x/index.js', 'apps/web/vendor.min.js'];

describe('5. a scan that did not finish is never green, and an alert never fails it', () => {
  it('expects every tracked source file, but those CodeQL leaves out by default, and the fixture outside a proof', () => {
    expect(expectedFiles(TRACKED, { proof: false })).toEqual(TREE);
    expect(expectedFiles(TRACKED, { proof: true })).toEqual([...TREE, FIXTURE_FILE]);
  });

  it('reads results, what was extracted and what was not, from CodeQL\'s SARIF', () => {
    const read = readSarif(sarif([['js/sql-injection', 'a.ts']], ['a.ts'], [['b.ts', 'Unexpected token']]));
    expect(read.results).toEqual([{ rule: 'js/sql-injection', uri: 'a.ts', line: 7 }]);
    expect([...read.extracted]).toEqual(['a.ts']);
    expect(read.problems).toEqual([{ uri: 'b.ts', text: 'Unexpected token' }]);
  });

  it('passes an ordinary run with alerts, and lists them by query', () => {
    const out = report({ sarifs: [sarif([['js/redos', TREE[0]!], ['js/redos', TREE[1]!], ['js/xss', TREE[2]!]], TREE)], tracked: TRACKED, proof: false });
    expect(out.code).toBe(0);
    expect(out.markdown).toMatch(/\| `js\/redos` \| 2 \|/);
    expect(out.markdown).toMatch(/\| `js\/xss` \| 1 \|/);
    expect(out.markdown).toMatch(/report only/i);
  });

  it('fails when there is no SARIF, or one with no run', () => {
    expect(report({ sarifs: [], tracked: TRACKED, proof: false }).code).toBe(1);
    expect(report({ sarifs: [JSON.stringify({ version: '2.1.0', runs: [] })], tracked: TRACKED, proof: false }).code).toBe(1);
  });

  it('fails when a file could not be extracted, and names it', () => {
    const out = report({ sarifs: [sarif([], TREE, [[TREE[3]!, 'Unexpected token']])], tracked: TRACKED, proof: false });
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain(`${TREE[3]}: Unexpected token`);
  });

  it('fails when a tracked source file is not among those extracted, and names it', () => {
    const out = report({ sarifs: [sarif([], TREE.slice(1))], tracked: TRACKED, proof: false });
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain(TREE[0]);
  });

  it('fails when the SARIF names fewer extracted files than a tree this size has', () => {
    const few = TREE.slice(0, 10);
    expect(report({ sarifs: [sarif([], few)], tracked: few, proof: false }).code).toBe(1);
  });

  it('a proof run passes only with both queries reported in the fixture', () => {
    const extracted = [...TREE, FIXTURE_FILE];
    const both = sarif(PROOF_QUERIES.map((q) => [q, FIXTURE_FILE] as [string, string]), extracted);
    expect(PROOF_QUERIES).toEqual(['js/sql-injection', 'js/reflected-xss']);
    expect(report({ sarifs: [both], tracked: TRACKED, proof: true }).code).toBe(0);
    for (const missing of PROOF_QUERIES) {
      const one = sarif(PROOF_QUERIES.filter((q) => q !== missing).map((q) => [q, FIXTURE_FILE] as [string, string]), extracted);
      const out = report({ sarifs: [one], tracked: TRACKED, proof: true });
      expect(out.code, missing).toBe(1);
      expect(out.lines.join('\n')).toContain(missing);
    }
    // Reported elsewhere is not reported in the fixture.
    const elsewhere = sarif(PROOF_QUERIES.map((q) => [q, TREE[0]!] as [string, string]), extracted);
    expect(report({ sarifs: [elsewhere], tracked: TRACKED, proof: true }).code).toBe(1);
  });

  it('an ordinary run that reports in the fixture is one that read what it should have left out', () => {
    const out = report({ sarifs: [sarif([['js/sql-injection', FIXTURE_FILE]], TREE)], tracked: TRACKED, proof: false });
    expect(out.code).toBe(1);
    expect(out.lines.join('\n')).toContain(FIXTURE);
  });
});
