// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MALICIOUS PACKAGE NOTHING HERE WOULD HAVE NAMED (workplan 0163 T2; the
 * owner's D1 of 2026-11-20).
 *
 * The Security Scan's advisory gate reads `pnpm audit`, which names
 * vulnerabilities in packages people meant to install. OSV also keeps
 * records of packages published to do harm, `MAL-…`, from the OpenSSF
 * malicious-packages project, and until 2026-11-20 nothing in CI read them:
 * an outside, read-only check of the repository did, after the merge. A
 * typosquat that reached `pnpm-lock.yaml` would have been named by it a day
 * later, and by nothing in the pull request that brought it in.
 *
 * Asked whether osv-scanner should block only a malicious package and report
 * the rest, the owner answered *"yes"*. So the repository job runs osv-scanner
 * over the lockfile, and `scripts/osv-report.mjs` reads what it wrote.
 *
 * ## What this holds, and how each part could rot
 *
 *  1. **A `MAL-` record fails the job, by its id or by an alias.** Matching the
 *     id alone would let a record OSV files under another id through.
 *  2. **Every other advisory is listed and passes.** The audit is the
 *     vulnerability gate, with the owner's `--fail-at=high`; a second gate on
 *     the same advisories with another line would disagree with it.
 *  3. **A scan that did not finish fails.** An exit code other than 0 or 1, a
 *     report that cannot be read or is not osv-scanner's shape, findings that
 *     disagree with the exit code, no result for the lockfile, or fewer
 *     packages read than it holds. Each of those would otherwise read as
 *     "no malicious package", which is the one answer a malware check must
 *     not give for a scan that read nothing.
 *  4. **The Security Scan runs it as decided.** The scanner's own exit code
 *     reaches the report, the lockfile is named, every package is listed
 *     (`--all-packages`, so 3 can count them), and both steps run after a red
 *     audit, which must not hide a malicious package.
 *
 * The install step, a named release checked by its sha256, is held with the
 * other pinned downloads in `a-pin-that-knows-it-is-behind`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { EXIT_MEANINGS, LOCKFILE, MIN_PACKAGES, annotations, collect, isMalicious, judge, meaning, renderSummary } from './osv-report.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = join(REPO, 'scripts', 'osv-report.mjs');
const WORKFLOW = '.github/workflows/security-scan.yml';

/** A package as osv-scanner lists it, with these advisories. */
const pkg = (name: string, version: string, vulnerabilities: object[] = []) => ({ package: { name, version, ecosystem: 'npm' }, vulnerabilities });
/** `count` clean packages, as `--all-packages` lists the rest of the lockfile. */
const clean = (count: number) => Array.from({ length: count }, (_, i) => pkg(`clean-${i}`, '1.0.0'));
/** A report for the lockfile at an absolute path, as osv-scanner writes it on a runner. */
const report = (packages: object[]) => ({ results: [{ source: { path: `/runner/work/repo/${LOCKFILE}`, type: 'lockfile' }, packages }] });

const MODERATE = { id: 'GHSA-g3hv-75wg-m249', aliases: ['CVE-2026-118764'], summary: 'minimatch: an expression that backtracks' };
const MALWARE = { id: 'MAL-2026-4242', summary: 'Malicious code in left-pad-tools (npm)' };
const MALWARE_BY_ALIAS = { id: 'GHSA-xxxx-malw-are0', aliases: ['MAL-2026-4243'], summary: 'Embedded malicious code' };

describe('what the report reads', () => {
  it('calls a record malicious by its id or an alias, and nothing else', () => {
    expect(isMalicious(MALWARE)).toBe(true);
    expect(isMalicious(MALWARE_BY_ALIAS)).toBe(true);
    expect(isMalicious(MODERATE)).toBe(false);
    expect(isMalicious({ id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1', 'PYSEC-2026-MAL'] })).toBe(false);
  });

  it('counts the packages read from the lockfile, and names every advisory with its package', () => {
    const read = collect(report([...clean(10), pkg('minimatch', '10.2.6', [MODERATE]), pkg('left-pad-tools', '0.0.1', [MALWARE])]));
    expect(read.packagesRead).toBe(12);
    expect(read.findings.map((f) => [f.name, f.version, f.id, f.malicious])).toEqual([
      ['minimatch', '10.2.6', 'GHSA-g3hv-75wg-m249', false],
      ['left-pad-tools', '0.0.1', 'MAL-2026-4242', true],
    ]);
    expect(read.findings[0]!.aliases).toEqual(['CVE-2026-118764']);
  });

  it('refuses a report that is not in the shape osv-scanner writes, rather than reading less of it', () => {
    const shape = /not in the shape it writes/;
    expect(() => collect(null)).toThrow(shape);
    expect(() => collect({ results: {} })).toThrow(shape);
    expect(() => collect({ results: [{ packages: [] }] })).toThrow(/names no source path/);
    expect(() => collect({ results: [{ source: { path: LOCKFILE } }] })).toThrow(/has no `packages` list/);
    expect(() => collect(report([{ package: { name: 'x' } }]))).toThrow(/has no name and version/);
    expect(() => collect(report([{ package: { name: 'x', version: '1' }, vulnerabilities: {} }]))).toThrow(/is not a list/);
    expect(() => collect(report([pkg('x', '1', [{ aliases: [] }])]))).toThrow(/has no id/);
    expect(() => collect(report([pkg('x', '1', [{ id: 'GHSA-1', aliases: 'CVE-1' }])]))).toThrow(/aliases are not a list/);
  });
});

describe('what fails the job, and what only reports', () => {
  const lockfile = clean(MIN_PACKAGES);

  it('lists an advisory that is not a malicious package, and passes', () => {
    const verdict = judge(1, report([...lockfile, pkg('minimatch', '10.2.6', [MODERATE])]));
    expect(verdict.problems).toEqual([]);
    expect(verdict.malicious).toEqual([]);
    expect(verdict.findings).toHaveLength(1);
    expect(annotations(verdict.findings)).toEqual([
      '::warning::GHSA-g3hv-75wg-m249 on minimatch@10.2.6: minimatch: an expression that backtracks (listed, not blocking: pnpm audit is the vulnerability gate)',
    ]);
  });

  it('fails on a malicious package, by its id or an alias, naming the package and the record', () => {
    for (const record of [MALWARE, MALWARE_BY_ALIAS]) {
      const verdict = judge(1, report([...lockfile, pkg('left-pad-tools', '0.0.1', [record])]));
      expect(verdict.malicious.map((f) => f.id)).toEqual([record.id]);
      expect(annotations(verdict.malicious)[0]).toBe(
        `::error::left-pad-tools@0.0.1 is a malicious package by OSV's ${record.id}. Take it out of ${LOCKFILE}, and find what brought it in.`,
      );
    }
  });

  it('passes a clean lockfile read whole', () => {
    expect(judge(0, report(lockfile))).toEqual({ packagesRead: MIN_PACKAGES, findings: [], malicious: [], problems: [] });
  });

  it('fails a scan that did not finish, for every exit code but 0 and 1, without reading a report', () => {
    for (const code of [127, 128, 129, 130, 2]) {
      const verdict = judge(code, undefined);
      expect(verdict.problems).toEqual([`osv-scanner ${meaning(code)} (exit ${code}), so nothing was checked`]);
    }
    expect(meaning(129)).toBe('could not reach the OSV API');
    expect(meaning(2)).toBe('ended in a way osv-scanner does not document');
    expect(Object.keys(EXIT_MEANINGS).map(Number)).toEqual([0, 1, 127, 128, 129, 130]);
  });

  it('fails a report whose findings disagree with the exit code', () => {
    expect(judge(0, report([...lockfile, pkg('minimatch', '10.2.6', [MODERATE])])).problems).toEqual([
      'osv-scanner exited 0 (found no advisory) and its report lists 1 advisories: the status does not belong to the report',
    ]);
    expect(judge(1, report(lockfile)).problems).toEqual([
      'osv-scanner exited 1 (found advisories) and its report lists none: the status does not belong to the report',
    ]);
  });

  it('fails a scan that did not read the lockfile, or read almost none of it', () => {
    expect(judge(0, { results: [] }).problems).toEqual([`the report holds no result for ${LOCKFILE}, so the lockfile was not read`]);
    expect(judge(0, { results: [{ source: { path: '/runner/work/repo/package-lock.json' }, packages: lockfile }] }).problems).toHaveLength(1);
    expect(judge(0, report(clean(MIN_PACKAGES - 1))).problems).toEqual([
      `osv-scanner read ${MIN_PACKAGES - 1} package(s) from ${LOCKFILE}, fewer than ${MIN_PACKAGES}: that is not this lockfile read whole`,
    ]);
  });

  it('writes the summary with the malicious packages first, and a pipe in a summary kept in its cell', () => {
    const verdict = judge(1, report([...lockfile, pkg('minimatch', '10.2.6', [{ ...MODERATE, summary: 'a | b' }]), pkg('left-pad-tools', '0.0.1', [MALWARE])]));
    const summary = renderSummary(verdict);
    expect(summary).toContain(`${MIN_PACKAGES + 2} packages read; 2 advisories, 1 of them malicious-package records.`);
    const rows = summary.split('\n').filter((l) => l.startsWith('| **malicious**') || l.startsWith('| reported'));
    expect(rows).toEqual([
      '| **malicious** | left-pad-tools | 0.0.1 | MAL-2026-4242 |  | Malicious code in left-pad-tools (npm) |',
      '| reported | minimatch | 10.2.6 | GHSA-g3hv-75wg-m249 | CVE-2026-118764 | a \\| b |',
    ]);
  });
});

describe('the CLI the Security Scan runs', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'osv-report-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  /** Run the reporter as the step does, with osv-scanner's exit code and a report (or none) at a path. */
  const run = (code: string | undefined, body: string | undefined) => {
    const file = join(scratch, `report-${Math.random().toString(36).slice(2)}.json`);
    if (body !== undefined) writeFileSync(file, body);
    const summary = join(scratch, `summary-${Math.random().toString(36).slice(2)}.md`);
    const args = [REPORTER, ...(code === undefined ? [] : ['--exit-code', code]), file];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: summary } });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
  };

  it('passes a listed advisory, and writes it to the job summary', () => {
    const r = run('1', JSON.stringify(report([...clean(MIN_PACKAGES), pkg('minimatch', '10.2.6', [MODERATE])])));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('::warning::GHSA-g3hv-75wg-m249 on minimatch@10.2.6');
    expect(r.summary).toContain('| reported | minimatch | 10.2.6 | GHSA-g3hv-75wg-m249 |');
  });

  it('fails on a malicious package, naming it', () => {
    const r = run('1', JSON.stringify(report([...clean(MIN_PACKAGES), pkg('left-pad-tools', '0.0.1', [MALWARE])])));
    expect(r.status).toBe(1);
    expect(r.out).toContain("::error::left-pad-tools@0.0.1 is a malicious package by OSV's MAL-2026-4242.");
  });

  it('fails a scan that did not finish, with no report on disk, saying what the exit code means', () => {
    const r = run('129', undefined);
    expect(r.status).toBe(1);
    expect(r.out).toContain('::error::osv-scanner could not reach the OSV API (exit 129), so nothing was checked');
  });

  it('fails a report it cannot read, and a call without the exit code', () => {
    const unreadable = run('0', '{"results": [');
    expect(unreadable.status).toBe(1);
    expect(unreadable.out).toContain("::error::osv-scanner's report could not be read:");
    const bare = run(undefined, JSON.stringify(report(clean(MIN_PACKAGES))));
    expect(bare.status).toBe(1);
    expect(bare.out).toContain('::error::usage: node scripts/osv-report.mjs --exit-code');
  });
});

describe('the Security Scan runs it as decided', () => {
  type Step = { name?: string; if?: unknown; run?: unknown; env?: Record<string, unknown> };
  type Workflow = { on?: Record<string, unknown>; jobs?: Record<string, { if?: unknown; steps?: Step[] }> };
  const workflow = parseYaml(readFileSync(join(REPO, WORKFLOW), 'utf8')) as Workflow;
  const job = workflow.jobs?.['security-scan'];
  const steps = job?.steps ?? [];
  const index = (test: (s: Step) => boolean) => steps.findIndex(test);
  const audit = index((s) => typeof s.run === 'string' && s.run.includes('audit-advisories.mjs'));
  const install = index((s) => typeof s.run === 'string' && s.run.includes('https://github.com/google/osv-scanner/releases/download/'));
  const scan = index((s) => typeof s.run === 'string' && s.run.includes('osv-report.mjs'));

  it('runs on every pull request, before the merge, in the repository job', () => {
    expect(Object.keys(workflow.on ?? {})).toEqual(expect.arrayContaining(['pull_request', 'push', 'schedule']));
    expect(job, 'the security-scan job is gone').toBeDefined();
    expect(job?.if, 'a job-level if could skip it on a pull request').toBeUndefined();
    expect([audit, install, scan].every((i) => i >= 0), `audit ${audit}, install ${install}, scan ${scan}`).toBe(true);
    expect(audit < install && install < scan, 'the order is the audit, the install, then the scan').toBe(true);
  });

  it('runs both steps after a red audit, so a malicious package is never hidden behind it', () => {
    expect(steps[install]?.if).toBe('${{ !cancelled() }}');
    expect(steps[scan]?.if).toBe('${{ !cancelled() }}');
  });

  it("hands the scanner's own exit code, and the report it wrote of the whole lockfile, to the reporter", () => {
    const lines = String(steps[scan]?.run).trim().split('\n');
    expect(lines).toEqual([
      'code=0',
      '"$RUNNER_TEMP/osv-bin/osv-scanner" scan source --lockfile pnpm-lock.yaml --all-packages --format json --output-file osv-scanner.json || code=$?',
      'node scripts/osv-report.mjs --exit-code "$code" osv-scanner.json',
    ]);
    // The binary the install step put there, and no other.
    expect(String(steps[install]?.run)).toContain('install -m 0755 "$RUNNER_TEMP/osv-scanner-$OSV_SCANNER_VERSION-linux-$native" "$RUNNER_TEMP/osv-bin/osv-scanner"');
  });
});
