// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ZIP NO WINDOWS HAD STARTED: every release tag attached a Windows zip that no Windows machine had run, because the only Windows check was a person's, by hand, and it was owed (workplan 0119, Status 2026-11-02).
 *
 * `.github/workflows/windows-payload.yml` staged the appliance on Linux and,
 * on a tag, zipped it and attached it to the release from the same job. What
 * proved the zip ran on Windows was `docs/windows-appliance-runbook.md`, done
 * by the owner on a Windows 11 laptop, last on 2026-08-13. Node 24.19, 24.22
 * and 26.13 each reached the zip after that, and each time the check was
 * written down as owed (0119's Status, 2026-10-21 and 2026-11-01; 0146's
 * alpha.4 gates). On 2026-11-02 the owner said: "I wont do windows...". So
 * nothing would ever have run a zip before a customer did.
 *
 * Since that day a `smoke` job runs Phases 1 and 2 of the runbook on a
 * GitHub-hosted Windows runner, against the upload `build` made, and the
 * attach is a `release` job that needs it. This holds that arrangement:
 *
 * - One job of the workflow runs on Windows, on a pinned image label
 *   (`windows-<year>`, never `windows-latest`, so the Windows major version
 *   changes only by a reviewed edit; GitHub still updates the image itself
 *   about weekly), after `build`, bounded by `timeout-minutes`, and with no
 *   `continue-on-error` on it or its steps.
 * - It downloads the artefact `build` uploaded, by the name `build` gave it,
 *   rather than rebuilding the commit: the zip a tag attaches is that upload,
 *   so the check has to be of that upload.
 * - Its PowerShell is strict (`$ErrorActionPreference = 'Stop'`) and its
 *   `shell: pwsh` is on each step, where the bash guards look for it
 *   (`a-workflow-step-bash-cannot-parse`). It stops only what it started:
 *   no `taskkill`, `Stop-Process` or `Get-Process`. Every wait is bounded:
 *   each `WaitForExit` and `WaitAll` names a timeout, each `Invoke-WebRequest`
 *   a `-TimeoutSec`, and each polling loop a deadline.
 * - It checks what the runbook's Phases 1 and 2 check, each by the words the
 *   payload prints (`scripts/package-appliance.mjs`'s `start.mjs`, the
 *   migration runner): the payload at the top of the download, the build
 *   stamp, `.\node.exe --version`, `SHA256SUMS.txt` by `Get-FileHash`, the
 *   first line, a first start that migrates and a second that does not, `/ui`
 *   and `/status`, and the two data directories outside the payload.
 * - It keeps the appliance's logs as an artefact when it fails, and each of
 *   its PowerShell steps has a time limit of its own, below the job's: a
 *   step that runs out of time fails, and the upload's `failure()` holds,
 *   while a job that runs out is cancelled, and the upload is skipped.
 * - A run that does not start the payload on Windows (win-arm64) says so in
 *   `build`'s summary, beside the download.
 * - Every job of the workflow that publishes needs `smoke`, with no status
 *   function in its `if:` that would let it run after `smoke` failed, and
 *   zips the same upload by the same name.
 *
 * The rule a job is judged by is run on small jobs first, so a rule that went
 * blind fails here rather than passing everything.
 *
 * ## What this does not prove
 *
 * That the job passes: that is the run's, on GitHub. It reads the workflow's
 * text; whether PowerShell parses it, or Windows Server 2025 behaves as the
 * runbook's Windows 11 did, only a run shows. Nor does it cover what the job
 * says it leaves to a person: the refusal under `C:\Program Files\`, a clean
 * Ctrl+C, Task Scheduler, the operator scripts, SmartScreen, and win-arm64.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'windows-payload.yml');

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: unknown;
  'timeout-minutes'?: unknown;
  with?: Record<string, unknown>;
  'continue-on-error'?: unknown;
};
type Job = {
  name?: string;
  needs?: string | string[];
  if?: unknown;
  'runs-on'?: unknown;
  'timeout-minutes'?: unknown;
  'continue-on-error'?: unknown;
  outputs?: Record<string, string>;
  steps?: Step[];
};
type Workflow = { jobs?: Record<string, Job> };

const workflow = (): Workflow => parseYaml(readFileSync(WORKFLOW, 'utf8')) as Workflow;
const needsOf = (job: Job): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);
const action = (step: Step): string => (typeof step.uses === 'string' ? step.uses.split('@')[0]! : '');

/** Whether a step publishes to a release: an action that does, or a `gh release` that writes. */
function publishes(step: Step): boolean {
  if (/release|publish/i.test(action(step).split('/')[1] ?? '')) return true;
  return typeof step.run === 'string' && /\bgh\s+release\s+(?:create|upload|edit)\b/.test(step.run);
}

/** A status function in an `if:`, which replaces the implicit success() that skips a job after a failed need. */
const STATUS_FUNCTION = /\b(?:always|failure|cancelled)\s*\(\s*\)/;

/** Why a publishing job could attach a zip the Windows job did not pass, or null when it could not. */
function attachFlaw(id: string, job: Job, smokeId: string): string | null {
  if (!(job.steps ?? []).some(publishes)) return null;
  if (!needsOf(job).includes(smokeId)) return `${id} publishes and does not need ${smokeId}`;
  if (job.if !== undefined && STATUS_FUNCTION.test(String(job.if))) {
    return `${id} publishes with \`if: ${String(job.if)}\`, which runs it whatever ${smokeId} did`;
  }
  return null;
}

/** The Windows job, by the image it runs on. */
function windowsJobs(doc: Workflow): Array<[string, Job]> {
  return Object.entries(doc.jobs ?? {}).filter(([, job]) => /^windows-/.test(String(job['runs-on'] ?? '')));
}

describe('the rule a publishing job is judged by', () => {
  const attach: Step = { uses: 'softprops/action-gh-release@0000000000000000000000000000000000000000' };

  it('knows a step that publishes', () => {
    expect(publishes(attach)).toBe(true);
    expect(publishes({ run: 'gh release upload "$GITHUB_REF_NAME" dist/x.zip' })).toBe(true);
    expect(publishes({ uses: 'actions/upload-artifact@0000000000000000000000000000000000000000' })).toBe(false);
    expect(publishes({ uses: 'actions/download-artifact@0000000000000000000000000000000000000000' })).toBe(false);
    expect(publishes({ run: 'zip -qr x.zip x' })).toBe(false);
  });

  it('refuses a publisher that does not need the Windows job, or runs whatever it did', () => {
    expect(attachFlaw('release', { needs: ['build', 'smoke'], steps: [attach] }, 'smoke')).toBeNull();
    expect(attachFlaw('release', { needs: 'smoke', if: "startsWith(github.ref, 'refs/tags/')", steps: [attach] }, 'smoke')).toBeNull();
    expect(attachFlaw('build', { steps: [{ run: 'zip -qr x.zip x' }] }, 'smoke')).toBeNull();
    expect(attachFlaw('release', { needs: ['build'], steps: [attach] }, 'smoke')).toContain('does not need smoke');
    expect(attachFlaw('build', { steps: [attach] }, 'smoke')).toContain('does not need smoke');
    expect(attachFlaw('release', { needs: ['smoke'], if: "always() && startsWith(github.ref, 'refs/tags/')", steps: [attach] }, 'smoke')).toContain(
      'whatever smoke did',
    );
    expect(attachFlaw('release', { needs: ['smoke'], if: '${{ !cancelled() }}', steps: [attach] }, 'smoke')).toContain('whatever smoke did');
  });
});

describe('windows-payload.yml runs the payload on Windows before a tag attaches it', () => {
  const doc = workflow();
  const jobs = doc.jobs ?? {};
  const windows = windowsJobs(doc);
  const [smokeId, smoke] = windows[0] ?? ['', {} as Job];
  const steps = smoke.steps ?? [];
  const scripts = steps.filter((s) => typeof s.run === 'string');
  const powershell = scripts.map((s) => s.run!).join('\n');
  /** The PowerShell as it runs: whole-line comments, which may name what it must not do, left out. */
  const code = powershell
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('has one Windows job, on a pinned image, after build, bounded, and allowed to fail nothing', () => {
    expect(windows.map(([id]) => id)).toEqual(['smoke']);
    expect(String(smoke['runs-on']), 'a pinned label: windows-latest moves under the check').toMatch(/^windows-\d{4}$/);
    expect(needsOf(smoke)).toContain('build');
    expect(String(smoke.if)).toContain("'win-x64'");
    expect(typeof smoke['timeout-minutes']).toBe('number');
    expect(smoke['timeout-minutes'] as number).toBeLessThanOrEqual(30);
    expect(smoke['continue-on-error']).toBeUndefined();
    expect(steps.filter((s) => s['continue-on-error'] !== undefined).map((s) => s.name)).toEqual([]);
  });

  it('runs the very upload build made, by the name build gave it', () => {
    const build = jobs.build!;
    const upload = (build.steps ?? []).find((s) => action(s) === 'actions/upload-artifact');
    expect(upload?.with?.name).toBe('${{ steps.pack.outputs.name }}-${{ github.sha }}');
    expect(build.outputs?.artifact).toBe(upload?.with?.name);
    const download = steps.find((s) => action(s) === 'actions/download-artifact');
    expect(download?.with?.name).toBe('${{ needs.build.outputs.artifact }}');
    expect(steps.some((s) => action(s) === 'actions/checkout'), 'nothing checked out: the payload leans on nothing else').toBe(false);
  });

  it('is strict PowerShell, says so on each step, and stops only what it started', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const s of scripts) {
      expect(s.shell, s.name).toBe('pwsh');
      expect(s.run, s.name).toContain("$ErrorActionPreference = 'Stop'");
      expect(s.run, s.name).toContain('Set-StrictMode -Version Latest');
    }
    expect(code).not.toMatch(/\btaskkill\b|\bStop-Process\b|\bGet-Process\b/i);
  });

  it('bounds every wait', () => {
    expect(code).toMatch(/\.WaitForExit\(\d+\)/);
    expect(code).not.toMatch(/\.WaitForExit\(\s*\)/);
    expect(code).not.toMatch(/::WaitAll\((?![^\n]*,\s*\d+\))/);
    const requests = code.split('\n').filter((l) => /\bInvoke-WebRequest\b/.test(l));
    expect(requests.length).toBeGreaterThan(0);
    for (const line of requests) expect(line).toMatch(/-TimeoutSec\s+\d+/);
    const loops = code.match(/\bwhile\s*\(/g) ?? [];
    const deadlines = code.match(/-gt\s+\$deadline\b/g) ?? [];
    expect(loops.length, 'each polling loop has a deadline').toBe(deadlines.length);
  });

  it("checks what the runbook's Phases 1 and 2 check, by the words the payload prints", () => {
    const packager = readFileSync(join(ROOT, 'scripts', 'package-appliance.mjs'), 'utf8');
    const migrate = readFileSync(join(ROOT, 'packages', 'ledger', 'src', 'migrate.ts'), 'utf8');
    // The words, where the payload prints them, so a reworded line fails here first.
    expect(packager).toContain('const BUILD = __BUILD_IDENTITY__;');
    expect(packager).toContain('console.log(\\`[appliance] build \\${BUILD.version} (\\${BUILD.commit})\\`);');
    expect(packager).toContain('console.log(\\`[appliance] listening on http://\\${process.env.HOST ?? \'127.0.0.1\'}:\\${handle.port}\\`);');
    expect(packager).toContain('The appliance cannot write its \\${label} directory:');
    expect(migrate).toMatch(/schema up to date at/);
    expect(migrate).toMatch(/applied \$\{[^}]+\} migration\(s\); now at/);
    for (const check of [
      "'start.mjs', 'appliance.mjs', 'node.exe'", // the payload at the top: no zip in a zip
      "'^const BUILD = (\\{[^}]*\\});$'", // the build stamp
      '--version', // .\node.exe, the version the build pinned
      'EXPECT_NODE',
      'Get-FileHash -LiteralPath', // SHA256SUMS.txt, with no sha256sum on Windows
      'SHA256SUMS.txt',
      '"[appliance] build $env:EXPECT_VERSION ($commit)"', // the first line
      '"[appliance] listening on $($Run.Base)"',
      "migration(s); now at $last",
      '"[migrate] schema up to date at $last"', // the second start migrates nothing
      "'/ui'",
      "'/status'",
      'The appliance cannot write its database directory:',
      'SELFHOST_PGLITE_DIR = $pgliteDir; CONFIG_DIR = $configDir', // Phase 2: data outside the payload
    ]) {
      expect(powershell, check).toContain(check);
    }
  });

  it('is the one the runbook describes: the image it runs on, and an In CI section under each phase it runs', () => {
    const runbook = readFileSync(join(ROOT, 'docs', 'windows-appliance-runbook.md'), 'utf8');
    expect(runbook).toContain(`\`${String(smoke['runs-on'])}\``);
    expect(runbook.match(/^### In CI \(since 2026-11-02\)$/gm) ?? []).toHaveLength(2);
    // The by-hand Program Files refusal stays in the runbook, said to be out of the job's reach.
    expect(runbook.replace(/\s+/g, ' ')).toContain('cannot show the refusal under `C:\\Program Files\\`');
  });

  it('keeps the logs when it fails, and a slow step fails rather than the job being cancelled', () => {
    const keep = steps.find((s) => action(s) === 'actions/upload-artifact');
    expect(keep?.if).toBe('failure()');
    expect(String(keep?.with?.path)).toBe('${{ runner.temp }}/appliance-logs');
    expect(powershell).toContain("Join-Path $env:RUNNER_TEMP 'appliance-logs'");
    // A job's timeout-minutes cancels it, failure() is then false and the
    // upload is skipped; a step's fails that step. So each PowerShell step
    // has its own limit, and together they leave the job's room for the
    // download and the upload.
    const limits = scripts.map((s) => s['timeout-minutes']);
    for (const [i, limit] of limits.entries()) expect(typeof limit, scripts[i]!.name).toBe('number');
    const total = (limits as number[]).reduce((a, b) => a + b, 0);
    expect(total, 'the steps’ limits together').toBeLessThanOrEqual((smoke['timeout-minutes'] as number) - 4);
  });

  it('says, in build’s summary, when a run starts nothing on Windows (win-arm64)', () => {
    const build = jobs.build!;
    const said = (build.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes('GITHUB_STEP_SUMMARY') && s.run.includes('Not started on Windows'));
    expect(said).toHaveLength(1);
    expect(String(said[0]!.if)).toBe("matrix.platform != 'win-x64'");
    // The same platform test as the Windows job's, the other way round.
    expect(String(smoke.if)).toBe("needs.build.outputs.platform == 'win-x64'");
  });

  it('attaches nothing a tag publishes before the Windows job has passed, and zips that same upload', () => {
    const flaws = Object.entries(jobs)
      .map(([id, job]) => attachFlaw(id, job, smokeId))
      .filter((f) => f !== null);
    expect(flaws).toEqual([]);
    const publishers = Object.entries(jobs).filter(([, job]) => (job.steps ?? []).some(publishes));
    expect(publishers.map(([id]) => id), 'the attach is a job of its own (a-release-that-names-itself)').toEqual(['release']);
    for (const [, job] of publishers) {
      const download = (job.steps ?? []).find((s) => action(s) === 'actions/download-artifact');
      expect(download?.with?.name).toBe('${{ needs.build.outputs.artifact }}');
    }
  });
});
