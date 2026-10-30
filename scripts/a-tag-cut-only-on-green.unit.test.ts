// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAG CUT ONLY ON GREEN: `v0.2.0-alpha.1` published signed images and a Windows zip while its own Security Scan was red, because nothing a tag fires waits for anything else (workplan 0146, Status of 2026-10-23).
 *
 * ## What happened
 *
 * The tag was pushed by hand on 2026-10-06 (`90a23e9b`). Four workflows
 * listened for it and ran side by side. Security Scan, run 37523297841,
 * failed at its advisory gate on advisories published since the same commit's
 * green scan on `main` that morning (seroval and proxy-addr); every step
 * after it was skipped, so the release got no body and no `bom.json`.
 * `images.yml` had already pushed and signed all three images, and
 * `windows-payload.yml` created the release, bodiless, to attach its zip. CI
 * on the tag finished forty minutes after all of it. The only check that
 * could hold a publish back was the names check.
 *
 * ## What holds it now
 *
 * `.github/workflows/release.yml`, dispatched from `main`, on GitHub-hosted
 * runners only. It reads the record first (preflight), waits for the owner's
 * recorded say-so (the `release` environment), scans exactly the commit
 * minutes before the tag, re-reads the nights and the tag just before it
 * creates it, and only then dispatches the publishers on the tag, the scan
 * first and the images and the zip only after the scan is green. A tag made
 * with the workflow's own token starts no `push` workflows, so the order is
 * Release's to keep.
 *
 * ## What this test holds, read from the parsed YAML
 *
 * - Dispatch only, with exactly the inputs `version`, `commit`, `mode` and
 *   `waive_nights`, `mode` defaulting to the read-only `preflight` and
 *   `waive_nights` to empty, which is no waiver.
 * - The owner's waiver (the owner, 2026-10-30, for alpha.3: "I approve
 *   alpha.3 tag now, we skip the waiting days. No one is in the alpha
 *   yet."): `waive_nights` reaches the three jobs that read it, the
 *   preflight, the tag and the tag rehearsal, as a job's `env:` and nowhere
 *   else: not a `run:`, an `if:`, a step's `env:` or the run's name, which
 *   the tag job reads back to know Release's own runs. The tag rehearsal
 *   reads no nights and refuses it before it makes anything. The tag job
 *   uses it only when the preflight did: the check step's `waived`, the
 *   preflight's output, reaches the tag job as `PREFLIGHT_WAIVED` (the review
 *   of 2026-10-30).
 * - No permission at the top; each job exactly the permissions it uses, and
 *   none ever `packages` or `id-token`: Release never builds, pushes or signs.
 * - The order: the tag needs the preflight, the approval and the gate scan;
 *   the images and the zip need the scan on the tag; the verify needs them.
 *   The gate scan starts only on a commit the preflight found on `main`,
 *   rehearsal included, and nothing but the two clean-ups runs after a
 *   cancel (`!cancelled()`, never `always()`, on a job).
 * - The candidate's own code (its names check and its install) runs in steps
 *   with no token in them.
 * - The environment on the approval job only; every runner GitHub-hosted;
 *   every checkout without a persisted token; no `${{ }}` inside a `run:`,
 *   so an input reaches a shell only as an environment variable.
 * - One group, never cancelled.
 * - Nothing else creates a `v*` tag: no workflow pushes one, and only
 *   `release-cut-tag.mjs` writes a tag ref; the rehearsal's throwaway tag
 *   cannot be named like a release.
 * - The three publishers still offer both ways in: `workflow_dispatch` for
 *   Release, `push` on `v*` tags for the hand-pushed break-glass tag.
 * - `security-scan.yml`'s `image_scans` input, which Release passes `false`.
 * - `ci.yml`'s trigger comment and `docs/release.md` §3 no longer say CI runs
 *   on every release tag: it runs on a hand-pushed one, never on one Release
 *   makes.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { rehearsalTagName } from './release-dispatch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

type Step = { name?: string; id?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = {
  name?: string;
  if?: string;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  needs?: string | string[];
  'runs-on'?: string;
  environment?: unknown;
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  steps?: Step[];
};
type Workflow = {
  name?: string;
  on?: Record<string, unknown>;
  permissions?: unknown;
  concurrency?: { group?: string; 'cancel-in-progress'?: unknown };
  jobs: Record<string, Job>;
};

const RELEASE_FILE = '.github/workflows/release.yml';
const release = parse(read(RELEASE_FILE)) as Workflow;
const jobs = release.jobs;
const needs = (job: string) => [jobs[job]?.needs ?? []].flat();

describe(`${RELEASE_FILE}: who can start it, and with what`, () => {
  it('is dispatch only', () => {
    expect(Object.keys(release.on ?? {})).toEqual(['workflow_dispatch']);
  });

  it('takes exactly a version, a commit, a mode and the owner’s waiver; the mode defaults to the read-only preflight, the waiver to none', () => {
    const inputs = (release.on!.workflow_dispatch as { inputs: Record<string, Record<string, unknown>> }).inputs;
    expect(Object.keys(inputs)).toEqual(['version', 'commit', 'mode', 'waive_nights']);
    expect(inputs.version).toMatchObject({ type: 'string', required: true });
    expect(inputs.commit).toMatchObject({ type: 'string', required: false, default: '' });
    expect(inputs.mode).toMatchObject({ type: 'choice', default: 'preflight' });
    expect(inputs.mode!.options).toEqual(['preflight', 'rehearse', 'rehearse-tag', 'release', 'verify']);
    expect(inputs.waive_nights).toMatchObject({ type: 'string', required: false, default: '' });
  });

  // The owner, 2026-10-30. The text is the owner's words and is read as
  // hostile: it reaches a script only as an environment variable, and only
  // in the jobs that read it.
  it('passes the waiver to the preflight, the tag and the tag rehearsal as a job’s env, and nowhere else', () => {
    const found: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        if (value.includes('waive_nights')) found.push(`${path} = ${value}`);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(release, '');
    const expression = '${{ inputs.waive_nights }}';
    expect(found.sort()).toEqual([
      `jobs.preflight.env.WAIVE_NIGHTS = ${expression}`,
      `jobs.tag-rehearsal.env.WAIVE_NIGHTS = ${expression}`,
      `jobs.tag.env.WAIVE_NIGHTS = ${expression}`,
    ]);
    // The tag job knows Release's own runs by this name; a waiver in it would change it.
    expect((release as { 'run-name'?: string })['run-name']).toBe('Release ${{ inputs.version }} (${{ inputs.mode }})');
  });

  // The review of 2026-10-30: the preflight's summary said the waiver was
  // not used when the nights held, and the tag job used it anyway.
  it('binds the tag job to whether the preflight used the waiver', () => {
    expect(jobs.preflight!.outputs?.waived).toBe('${{ steps.check.outputs.waived }}');
    expect(jobs.preflight!.steps?.find((s) => s.id === 'check')?.run).toBe('node scripts/release-preflight.mjs check --candidate candidate');
    expect(jobs.tag!.env?.PREFLIGHT_WAIVED).toBe('${{ needs.preflight.outputs.waived }}');
    const mentions = JSON.stringify(jobs).match(/outputs\.waived/g) ?? [];
    expect(mentions, 'read by the tag job and nowhere else').toHaveLength(2);
  });

  it('the tag rehearsal refuses a waiver before it makes anything', () => {
    const rehearse = (waiver: string) =>
      spawnSync(process.execPath, [join(ROOT, 'scripts', 'release-dispatch.mjs'), 'rehearse-tag'], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          GITHUB_ACTIONS: 'false',
          // Nothing listens here, and the ref is not main: a script that went
          // on past the waiver would refuse for the ref, with nothing sent.
          GITHUB_API_URL: 'http://127.0.0.1:9',
          GITHUB_REF: 'refs/heads/not-main',
          VERSION: 'v0.2.0-alpha.3',
          GITHUB_ACTOR: 'example-owner',
          WAIVE_NIGHTS: waiver,
        },
      });
    const waived = rehearse('No one is in the alpha yet.');
    expect(waived.status).toBe(1);
    expect(waived.stdout.trim()).toBe('refuse waiver: waive_nights is set, and rehearse-tag mode reads no nights: dispatch it again with waive_nights empty');
    const plain = rehearse('');
    expect(plain.status).toBe(1);
    expect(plain.stdout.trim()).toBe('refuse rehearsal-tag: dispatched from refs/heads/not-main: the rehearsal runs from main');
  });
});

describe(`${RELEASE_FILE}: what each job may do`, () => {
  it('grants nothing at the top', () => {
    expect(release.permissions).toEqual({});
  });

  it('gives each job exactly what it uses, and no job may push a package or sign', () => {
    const want: Record<string, Record<string, string>> = {
      preflight: { contents: 'read', actions: 'read', 'security-events': 'read' },
      approve: {},
      'gate-scan': { contents: 'write', actions: 'write' },
      tag: { contents: 'write', actions: 'read' },
      'publish-scan': { contents: 'read', actions: 'write' },
      'publish-images': { contents: 'read', actions: 'write' },
      'publish-payload': { contents: 'read', actions: 'write' },
      verify: { contents: 'read' },
      'tag-rehearsal': { contents: 'write', actions: 'write' },
    };
    expect(Object.keys(jobs).sort()).toEqual(Object.keys(want).sort());
    for (const [name, permissions] of Object.entries(want)) {
      expect(jobs[name]!.permissions, name).toEqual(permissions);
    }
  });

  it('runs every job on a GitHub-hosted runner, never on the machine that runs the stacks', () => {
    for (const [name, job] of Object.entries(jobs)) expect(job['runs-on'], name).toBe('ubuntu-24.04');
  });

  it('puts a time limit on every job', () => {
    for (const [name, job] of Object.entries(jobs)) expect(job['timeout-minutes'], name).toBeGreaterThan(0);
  });

  it('asks for the owner’s say-so in the approve job, on the release environment, and only there', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'approve') expect(job.environment).toBe('release');
      else expect(job.environment, name).toBeUndefined();
    }
    expect(jobs.approve!.if).toBe("inputs.mode == 'release'");
    expect(needs('approve')).toEqual(['preflight']);
  });

  it('checks every checkout out without leaving the token on disk', () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials'], name).toBe(false);
      }
    }
  });

  it('never writes an expression into a shell: inputs arrive as environment variables', () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps ?? []) {
        if (step.run !== undefined) expect(step.run, `${name}: ${step.name ?? step.run}`).not.toContain('${{');
      }
    }
  });

  it('holds one group, and never cancels a run in it', () => {
    expect(release.concurrency).toEqual({ group: 'release-tag', 'cancel-in-progress': false });
  });
});

describe(`${RELEASE_FILE}: the order, which is the point`, () => {
  it('tags only after the preflight, the approval and a green gate scan, and only in release mode', () => {
    expect(needs('tag').sort()).toEqual(['approve', 'gate-scan', 'preflight']);
    expect(jobs.tag!.if).toBe("inputs.mode == 'release'");
    expect(needs('gate-scan').sort()).toEqual(['approve', 'preflight']);
    expect(jobs['gate-scan']!.if).toContain("needs.preflight.result == 'success'");
    expect(jobs['gate-scan']!.if).toContain("needs.approve.result == 'success'");
  });

  // The review of 2026-10-23: the gate scan makes a branch at the commit and
  // runs that commit's own security-scan.yml with a write token, so it starts
  // only on a commit the resolve step found on main's first-parent line, in
  // every mode, rehearse included.
  it('scans only a commit the preflight found on main, rehearsal or release', () => {
    const outputs = jobs.preflight!.outputs ?? {};
    expect(outputs.candidate).toBe('${{ steps.resolve.outputs.candidate }}');
    expect(jobs['gate-scan']!.if).toContain("needs.preflight.outputs.candidate == 'true'");
  });

  it('stops when the run is cancelled: only the two clean-ups run whatever happened', () => {
    for (const [name, job] of Object.entries(jobs)) expect(job.if ?? '', name).not.toContain('always()');
    expect(jobs['gate-scan']!.if).toMatch(/^!cancelled\(\) && /);
    expect(jobs.verify!.if).toMatch(/^!cancelled\(\) && /);
    const always = Object.entries(jobs).flatMap(([name, job]) =>
      (job.steps ?? []).filter((s) => (s.if ?? '').includes('always()')).map((s) => `${name}: ${s.run ?? s.name}`),
    );
    expect(always).toEqual([
      'gate-scan: node scripts/release-dispatch.mjs drop-gate',
      'tag-rehearsal: node scripts/release-dispatch.mjs drop-rehearsal-tag',
    ]);
  });

  it('dispatches the scan on the tag first, and the images and the zip only after it', () => {
    expect(needs('publish-scan').sort()).toEqual(['preflight', 'tag']);
    expect(needs('publish-images').sort()).toEqual(['preflight', 'publish-scan']);
    expect(needs('publish-payload').sort()).toEqual(['preflight', 'publish-scan']);
    expect(needs('verify').sort()).toEqual(['preflight', 'publish-images', 'publish-payload', 'publish-scan', 'tag']);
  });

  it('runs each script where the design puts it', () => {
    const runs = (job: string) => (jobs[job]!.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(runs('preflight')).toContain('node scripts/release-preflight.mjs resolve');
    expect(runs('preflight')).toContain('node scripts/release-preflight.mjs names --candidate candidate');
    expect(runs('preflight')).toContain('node scripts/release-preflight.mjs check --candidate candidate');
    expect(runs('preflight')).toContain('node scripts/release-preflight.mjs callees --candidate candidate');
    expect(runs('preflight')).toContain('node scripts/release-upgrade-gates.mjs');
    expect(runs('preflight')).toContain('node scripts/release-preflight.mjs verdict');
    expect(runs('gate-scan')).toContain('node scripts/release-dispatch.mjs gate');
    expect(runs('tag')).toContain('node scripts/release-cut-tag.mjs');
    expect(runs('publish-scan')).toContain('--workflow security-scan.yml --input image_scans=false');
    expect(runs('publish-images')).toContain('--workflow images.yml');
    expect(runs('publish-payload')).toContain('--workflow windows-payload.yml --input platform=win-x64');
    expect(runs('verify')).toContain('node scripts/release-verify.mjs');
    expect(runs('tag-rehearsal')).toContain('node scripts/release-dispatch.mjs rehearse-tag');
  });

  it('removes the gate branch and the rehearsal tag whatever happened', () => {
    const drop = (job: string, command: string) =>
      (jobs[job]!.steps ?? []).find((s) => (s.run ?? '').includes(command));
    expect(drop('gate-scan', 'release-dispatch.mjs drop-gate')?.if).toBe('always()');
    expect(drop('tag-rehearsal', 'release-dispatch.mjs drop-rehearsal-tag')?.if).toBe('always()');
  });

  it('cuts the tag in the tag job and nowhere else', () => {
    for (const [name, job] of Object.entries(jobs)) {
      const text = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
      if (name !== 'tag') expect(text, name).not.toContain('release-cut-tag.mjs');
    }
  });

  it('never publishes anything itself: no build, push, sign or release action', () => {
    const text = read(RELEASE_FILE);
    expect(text).not.toMatch(/cosign (sign|attest)|docker push|build-push-action|action-gh-release|gh release (create|upload|edit)/);
  });

  it('runs the candidate’s own code, its names check and its install, in steps with no token in reach', () => {
    const steps = jobs.preflight!.steps ?? [];
    const env = jobs.preflight!.env ?? {};
    expect(JSON.stringify(env), 'the preflight job’s own env').not.toMatch(/TOKEN|secrets\./);
    for (const needle of ['preflight.mjs names', 'install --frozen-lockfile']) {
      const step = steps.find((s) => (s.run ?? '').includes(needle));
      expect(step, needle).toBeDefined();
      expect(JSON.stringify(step!.env ?? {}), needle).not.toMatch(/TOKEN|secrets\./);
    }
  });

  it('reads before anything writes, in the order the design gives', () => {
    const order = (jobs.preflight!.steps ?? []).map((s) => s.run ?? s.uses ?? '');
    const at = (needle: string) => order.findIndex((s) => s.includes(needle));
    expect(at('preflight.mjs resolve')).toBeLessThan(at('git worktree add'));
    expect(at('git worktree add')).toBeLessThan(at('preflight.mjs names'));
    expect(at('preflight.mjs names')).toBeLessThan(at('preflight.mjs check'));
    expect(at('preflight.mjs check')).toBeLessThan(at('install --frozen-lockfile'));
    expect(at('install --frozen-lockfile')).toBeLessThan(at('preflight.mjs callees'));
  });
});

describe('nothing else creates a release tag', () => {
  const workflows = execFileSync('git', ['ls-files', '.github/workflows'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.ya?ml$/.test(f));

  it('no workflow pushes or makes a tag in a shell', () => {
    for (const file of workflows) {
      const w = parse(read(file)) as Workflow;
      for (const job of Object.values(w.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          expect(step.run ?? '', `${file}: ${step.name ?? ''}`).not.toMatch(/git\s+tag\s|git\s+push\b[^\n]*(--tags|refs\/tags|\bv\$|\bv\d)/);
        }
      }
    }
  });

  it('only the tag job’s script and the rehearsal write a tag ref, and the rehearsal’s cannot be a release name', () => {
    const scripts = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((f) => f.endsWith('.mjs'));
    const writers = scripts.filter((f) => /['"`]git\/refs['"`]/.test(read(f))).sort();
    expect(writers).toEqual(['scripts/release-cut-tag.mjs', 'scripts/release-dispatch.mjs']);
    expect(rehearsalTagName(7)).toBe('rehearsal-7');
    expect(rehearsalTagName(7)).not.toMatch(/^v/);
  });

  it('the three publishers keep both ways in: dispatch for Release, a pushed v* tag for the break-glass path', () => {
    for (const file of ['images.yml', 'security-scan.yml', 'windows-payload.yml']) {
      const on = (parse(read(`.github/workflows/${file}`)) as Workflow).on ?? {};
      expect(Object.keys(on), file).toContain('workflow_dispatch');
      expect((on.push as { tags?: string[] } | undefined)?.tags, file).toEqual(['v*']);
    }
  });
});

describe('what the dispatched workflows offer Release', () => {
  it('security-scan.yml takes image_scans, a boolean that defaults to scanning', () => {
    const on = (parse(read('.github/workflows/security-scan.yml')) as Workflow).on!;
    const inputs = (on.workflow_dispatch as { inputs?: Record<string, Record<string, unknown>> }).inputs ?? {};
    expect(inputs.image_scans).toMatchObject({ type: 'boolean', default: true });
  });

  it('windows-payload.yml still offers win-x64', () => {
    const on = (parse(read('.github/workflows/windows-payload.yml')) as Workflow).on!;
    const inputs = (on.workflow_dispatch as { inputs: Record<string, { options?: string[] }> }).inputs;
    expect(inputs.platform!.options).toContain('win-x64');
  });
});

describe('no text says CI runs on a tag Release makes', () => {
  it('ci.yml’s trigger comment says CI runs on a pushed tag, not on one the workflow token made', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toContain('Release refs are test-gated (release-readiness, 2026-08-10): before');
    expect(ci).toMatch(/release\.yml/);
    expect(ci).toMatch(/runs no CI/);
  });

  it('docs/release.md §3 says the same, and names the push run on main that stands in for it', () => {
    const doc = read('docs/release.md');
    expect(doc).toMatch(/runs no CI/);
    expect(doc).not.toMatch(/\| `ci\.yml` \| the test gate on the release ref \| green before announcing \|/);
  });
});
