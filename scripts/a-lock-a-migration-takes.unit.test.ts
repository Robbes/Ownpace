// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A lock a migration takes, read before the merge, and reported only
 * (workplan 0165).
 *
 * An outside, read-only check measured "database changes that lock a table"
 * with squawk over both migration chains, after the merge. Nothing here read
 * that class: migration-lint's Atlas runs four analyzers for Postgres, and none
 * reads a lock. `.github/workflows/migration-locks.yml` now runs squawk over
 * every migration file, and `scripts/migration-locks-report.mjs` writes what it
 * says to the job summary.
 *
 * This holds:
 *   - the report: a finding in a file the change adds or changes is listed in
 *     full and annotated on its line; every other file is history and only
 *     counted; a rule no migration can meet while each file is one transaction
 *     is marked; a rule the runner meets for every file (its lock timeout) is
 *     marked as met and warned about nowhere; a file squawk could not read is
 *     listed and warned about, never dropped;
 *   - REPORT ONLY: the script exits 0 whatever squawk says, run end to end
 *     against a stand-in squawk;
 *   - squawk reads each file as `runMigrations` applies it: one transaction per
 *     file. If the runner stops wrapping a file in BEGIN/COMMIT, this fails, so
 *     the report's options and its "cannot be met" rules move with it; and if it
 *     stops setting a lock timeout per file, this fails, so the "met by the
 *     runner" rule moves with it;
 *   - the wiring: the workflow runs the script after the install step, on the
 *     paths of both chains, and it is not in ci.yml.
 *
 * The install step's pin is held by a-pin-that-knows-it-is-behind.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CANNOT_BE_MET, CHAINS, MET_BY_THE_RUNNER, SQUAWK_ARGS, migrationFiles, parseGcc, readRun, report } from './migration-locks-report.mjs';
import type { Run } from './migration-locks-report.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = '.github/workflows/migration-locks.yml';
const SCRIPT = 'scripts/migration-locks-report.mjs';
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'migration-locks-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("squawk's gcc output, read", () => {
  it('reads file, line, column, level, rule and message, and skips what is not a finding', () => {
    const out = [
      'packages/ledger/migrations/0070_x.sql:52:3: warning: constraint-missing-not-valid By default new constraints require a table scan',
      'Found 1 issue in 1 file',
      '',
    ].join('\n');
    expect(parseGcc(out)).toEqual([{ line: 52, column: 3, level: 'warning', rule: 'constraint-missing-not-valid', message: 'By default new constraints require a table scan' }]);
  });

  it('keeps a finding whose first word is not a rule name, under `unknown`, with its whole message', () => {
    expect(parseGcc('a.sql:1:1: error: Something squawk said')).toEqual([{ line: 1, column: 1, level: 'error', rule: 'unknown', message: 'Something squawk said' }]);
  });
});

describe('one squawk run over one file', () => {
  const finding = 'a.sql:3:1: warning: adding-foreign-key-constraint Adding a foreign key takes a lock';

  it('is read whenever it names a finding, whatever its exit code', () => {
    expect(readRun({ status: 1, stdout: finding })).toMatchObject({ findings: [{ rule: 'adding-foreign-key-constraint', line: 3 }] });
    expect(readRun({ status: 0, stdout: finding })).toMatchObject({ findings: [{ line: 3 }] });
  });

  it('found nothing when it exits 0 with no finding', () => {
    expect(readRun({ status: 0, stdout: '' })).toEqual({ findings: [] });
  });

  it('did not read the file when it exits otherwise with no finding, or did not start, and says why', () => {
    expect(readRun({ status: 2, stdout: '', stderr: 'error: unexpected argument' })).toEqual({ unread: 'squawk exited 2 and named no finding: error: unexpected argument' });
    expect(readRun({ status: null, stdout: '' })).toMatchObject({ unread: /exited by a signal/ });
    expect(readRun({ status: null, error: new Error('spawn squawk ENOENT') })).toEqual({ unread: 'squawk did not start: spawn squawk ENOENT' });
  });
});

describe('the summary', () => {
  const A = 'packages/ledger/migrations/0071_new.sql';
  const B = 'packages/ledger/migrations/0003_old.sql';
  const C = 'packages/managed/migrations/0001_old.sql';
  const F = (line: number, rule: string, message = `${rule} says so`) => ({ line, column: 1, level: 'warning', rule, message });
  const results = new Map<string, Run>([
    [A, { findings: [F(10, 'constraint-missing-not-valid', 'a | pipe'), F(12, 'require-concurrent-index-creation')] }],
    [B, { findings: [F(30, 'constraint-missing-not-valid'), F(51, 'require-concurrent-index-creation')] }],
    [C, { findings: [F(5, 'constraint-missing-not-valid')] }],
  ]);

  it('lists every finding of a changed file in full, with an annotation on its line, and marks a rule that cannot be met here', () => {
    const { markdown, annotations, warnings } = report({ version: 'squawk 2.73.0', files: [B, A, C], changed: new Set([A]), results });
    expect(markdown).toContain('### Files this change adds or changes (1)');
    expect(markdown).toContain(`| \`${A}:10\` | \`constraint-missing-not-valid\` | a \\| pipe |`);
    expect(markdown).toContain(`| \`${A}:12\` | \`require-concurrent-index-creation\` (cannot be met here) |`);
    expect(annotations).toEqual([
      `::warning file=${A},line=10,title=squawk constraint-missing-not-valid::a | pipe`,
      `::warning file=${A},line=12,title=squawk require-concurrent-index-creation::require-concurrent-index-creation says so`,
    ]);
    expect(warnings).toEqual([]);
  });

  it('counts every other file per rule, as history, and lists none of its lines', () => {
    const { markdown, annotations } = report({ version: 'squawk 2.73.0', files: [B, A, C], changed: new Set([A]), results });
    expect(markdown).toContain('### History: every other file (2)');
    expect(markdown).toContain('| `constraint-missing-not-valid` | 2 | 2 |  |');
    expect(markdown).toMatch(/\| `require-concurrent-index-creation` \| 1 \| 1 \| cannot be met here: /);
    expect(markdown).not.toContain(`${B}:30`);
    expect(annotations.some((a) => a.includes(B) || a.includes(C))).toBe(false);
  });

  it('says so when no migration changed, which is every dispatch', () => {
    const { markdown, annotations } = report({ version: 'squawk 2.73.0', files: [B, A, C], changed: new Set(), results });
    expect(markdown).toContain('No migration file changed in this run.');
    expect(markdown).toContain('### History: every other file (3)');
    expect(annotations).toEqual([]);
  });

  it('lists a file squawk could not read, warns, and never counts it as clean', () => {
    const unread = new Map<string, Run>([...results, [C, { unread: 'squawk exited 2 and named no finding' }]]);
    const { markdown, warnings } = report({ version: 'squawk 2.73.0', files: [B, A, C], changed: new Set([A]), results: unread });
    expect(markdown).toContain('2 of 3 files read.');
    expect(markdown).toContain(`### Not read (1)\n\n- \`${C}\`: squawk exited 2 and named no finding`);
    expect(warnings).toEqual(['squawk could not read 1 of 3 migration files; the summary lists them.']);
  });

  it('marks a rule the runner meets as met, counts it, and puts no warning on its line', () => {
    const met = new Map<string, Run>([
      [A, { findings: [F(1, 'require-lock-timeout'), F(10, 'constraint-missing-not-valid')] }],
      [B, { findings: [F(1, 'require-lock-timeout')] }],
    ]);
    const { markdown, annotations } = report({ version: 'squawk 2.73.0', files: [B, A], changed: new Set([A]), results: met });
    expect(markdown).toContain(`| \`${A}:1\` | \`require-lock-timeout\` (met by the runner) |`);
    expect(markdown).toMatch(/\| `require-lock-timeout` \| 1 \| 1 \| met by the runner: runMigrations sets lock_timeout/);
    expect(annotations).toEqual([`::warning file=${A},line=10,title=squawk constraint-missing-not-valid::constraint-missing-not-valid says so`]);
  });

  it('warns when there was nothing to read', () => {
    expect(report({ version: 'squawk 2.73.0', files: [], changed: new Set(), results: new Map() }).warnings).toEqual(['No migration file was found to read.']);
  });
});

describe('squawk reads each file as runMigrations applies it', () => {
  it('as one transaction, because the runner wraps each file in BEGIN and COMMIT', () => {
    const runner = read('packages/ledger/src/migrate.ts');
    const applyOne = runner.slice(runner.indexOf('async function applyOne'));
    expect(applyOne).toMatch(/client\.query\('BEGIN'\)[\s\S]*client\.exec\(sql\)[\s\S]*client\.query\('COMMIT'\)/);
    expect(SQUAWK_ARGS).toContain('--assume-in-transaction');
    // Not one migration file opens or ends a transaction of its own.
    for (const file of migrationFiles(ROOT)) {
      const code = read(file).replace(/--.*$/gm, '');
      expect(code, `${file} opens or ends a transaction itself`).not.toMatch(/^\s*(?:BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b\s*;/im);
    }
  });

  it('and the rule marked as met by the runner is the lock timeout, which applyOne sets in each file\'s transaction', () => {
    expect([...MET_BY_THE_RUNNER.keys()]).toEqual(['require-lock-timeout']);
    const runner = read('packages/ledger/src/migrate.ts');
    expect(runner).toMatch(/export const MIGRATION_LOCK_TIMEOUT = '[1-9][0-9]*(?:ms|s)';/);
    const applyOne = runner.slice(runner.indexOf('async function applyOne'));
    expect(applyOne).toMatch(/client\.query\('BEGIN'\)[\s\S]*SET LOCAL lock_timeout[\s\S]*client\.exec\(sql\)/);
  });

  it('and the rules marked as unmeetable are the CONCURRENTLY ones, which a transaction refuses', () => {
    expect([...CANNOT_BE_MET.keys()].sort()).toEqual(['require-concurrent-index-creation', 'require-concurrent-index-deletion']);
  });

  it('over both chains, every file in each', () => {
    expect([...CHAINS]).toEqual(['packages/ledger/migrations', 'packages/managed/migrations']);
    const files = migrationFiles(ROOT);
    for (const dir of CHAINS) {
      const sql = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.sql'));
      expect(sql.length, `${dir} has no migration`).toBeGreaterThan(10);
      expect(files.filter((f) => f.startsWith(`${dir}/`))).toEqual(sql.sort().map((f) => `${dir}/${f}`));
    }
  });
});

describe('report only, run end to end against a stand-in squawk', () => {
  /** Run the script with a stand-in `squawk` that names one finding in `noisy` and fails with nothing on `broken`. */
  function run(noisy: string, broken?: string) {
    const dir = mkdtempSync(join(scratch, 'run-'));
    const bin = join(dir, 'bin');
    const summary = join(dir, 'summary.md');
    spawnSync('mkdir', ['-p', bin]);
    const stub = join(bin, 'squawk');
    writeFileSync(
      stub,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "squawk 2.73.0"; exit 0; fi',
        'for last; do :; done',
        `if [ "$last" = "${noisy}" ]; then echo "$last:7:1: warning: constraint-missing-not-valid stand-in finding"; exit 1; fi`,
        broken ? `if [ "$last" = "${broken}" ]; then echo "error: could not parse" >&2; exit 2; fi` : '',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(stub, 0o755);
    const r = spawnSync(process.execPath, [join(ROOT, SCRIPT)], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, EVENT_NAME: 'workflow_dispatch', GITHUB_STEP_SUMMARY: summary },
    });
    return { status: r.status, stdout: r.stdout, summary: readFileSync(summary, 'utf8') };
  }

  const files = migrationFiles(ROOT);
  const noisy = files[3]!;
  const broken = files[5]!;

  it('exits 0 with a finding, and counts it as history on a dispatch', () => {
    const r = run(noisy);
    expect(r.status).toBe(0);
    expect(r.summary).toContain('squawk 2.73.0, one run per file');
    expect(r.summary).toContain(`${files.length} of ${files.length} files read.`);
    expect(r.summary).toContain('| `constraint-missing-not-valid` | 1 | 1 |  |');
  });

  it('exits 0 when squawk could not read a file, and lists and warns about it', () => {
    const r = run(noisy, broken);
    expect(r.status).toBe(0);
    expect(r.summary).toContain(`- \`${broken}\`: squawk exited 2 and named no finding: error: could not parse`);
    expect(r.stdout).toContain('::warning::squawk could not read 1 of');
  });
});

describe('the wiring', () => {
  type Step = { name?: string; run?: string; uses?: string };
  const wf = parseYaml(read(WORKFLOW)) as { on: Record<string, { paths?: string[] } | null>; jobs: Record<string, { name?: string; steps: Step[] }> };

  it('runs the report after the install step, in a job that says it is report only', () => {
    const job = wf.jobs.squawk!;
    expect(job.name).toBe('squawk (report only)');
    const install = job.steps.findIndex((s) => s.run?.includes('https://github.com/sbdchd/squawk/releases/download/'));
    const reportStep = job.steps.findIndex((s) => s.run?.trim() === `node ${SCRIPT}`);
    expect(install).toBeGreaterThan(-1);
    expect(reportStep).toBeGreaterThan(install);
    expect(job.steps.some((s) => /continue-on-error/.test(JSON.stringify(s)))).toBe(false);
  });

  it('runs on a pull request or push that touches either chain, the workflow or its script', () => {
    for (const trigger of ['pull_request', 'push'] as const) {
      expect(wf.on[trigger]?.paths).toEqual(expect.arrayContaining([...CHAINS.map((d) => `${d}/**`), WORKFLOW, SCRIPT]));
    }
  });

  it('is not part of ci.yml, so ci-complete never waits for it', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('migration-locks');
  });
});
