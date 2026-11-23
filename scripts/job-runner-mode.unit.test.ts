// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE READER FOR WHICH RUNNER THE JOBS RUN ON (workplan 0167 T7, ADR-0054).
 *
 * alpha.16 and alpha.17 ran the managed edition's jobs on one of two runners,
 * chosen by `OWNPACE_JOB_RUNNER`: `trigger` (Trigger.dev's plane) or `pg-boss`
 * (the worker). alpha.18 removed Trigger.dev (workplan 0167 T9), so `pg-boss`
 * is the only value, and unset or empty means it. The key keeps its reader so
 * that an old .env that still says `trigger` fails loudly, in one sentence
 * that says Trigger.dev was removed in alpha.18, instead of being ignored.
 * `deploy/compose/job-runner.sh` is that reader, and it reads the value as
 * Compose does, so that its answer is what the containers get: this shell's
 * value, else the `.env`'s, else `managed.yml`'s `${OWNPACE_JOB_RUNNER:-…}`
 * default, else `pg-boss`. A managed.yml that never names the switch is a
 * release from before alpha.16, which only ran Trigger.dev: refused. Any other
 * value is refused in one sentence that does not print it.
 *
 * HOW IT RUNS. The file is sourced in a bash of its own, from a directory
 * holding it, `env-read.sh`, a `managed.yml` and a `.env` a case writes, and
 * each function is called as the scripts call it. No Docker.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

const yml = (defaults: string[] = [], services = ['api']): string =>
  [
    'name: ownpace-managed',
    'services:',
    ...services.flatMap((s, i) => [
      `  ${s}:`,
      '    image: example',
      ...(defaults[i] !== undefined ? ['    environment:', `      OWNPACE_JOB_RUNNER: \${OWNPACE_JOB_RUNNER:-${defaults[i]}}`] : []),
    ]),
    'volumes:',
    '  worker:',
    '',
  ].join('\n');

function aDir(managed: string, env?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-runner-'));
  tempDirs.push(dir);
  for (const f of ['job-runner.sh', 'env-read.sh']) copyFileSync(join(COMPOSE_DIR, f), join(dir, f));
  writeFileSync(join(dir, 'managed.yml'), managed);
  if (env !== undefined) writeFileSync(join(dir, '.env'), env);
  return dir;
}

function sh(dir: string, call: string, env: Record<string, string> = {}): { status: number | null; out: string; err: string } {
  const script = ['set -euo pipefail', `SCRIPT_DIR='${dir}'`, '. "${SCRIPT_DIR}/job-runner.sh"', call].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, ...env },
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const mode = (dir: string, env: Record<string, string> = {}) =>
  sh(dir, 'if job_runner_mode "$SCRIPT_DIR"; then echo "mode=$JOB_RUNNER"; else echo "why=$JOB_RUNNER_WHY"; exit 1; fi', env);

const REMOVED = /^why=OWNPACE_JOB_RUNNER in .+ is trigger, but Trigger\.dev was removed in alpha\.18, so remove the key from the \.env or set it to pg-boss; nothing has run\.\n$/;

describe('job_runner_mode: the value Compose would hand the containers', () => {
  it("managed.yml's default, when the .env says nothing or says it empty: pg-boss", () => {
    expect(mode(aDir(yml(['pg-boss']))).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss']), 'POSTGRES_DB=ownpace\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss', 'pg-boss'], ['api', 'worker']))).out).toBe('mode=pg-boss\n');
  });

  it('a switch with an empty default is pg-boss too', () => {
    expect(mode(aDir(yml(['']))).out).toBe('mode=pg-boss\n');
  });

  it(".env's line: the last one, one pair of double quotes removed, a comment dropped", () => {
    expect(mode(aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=pg-boss\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER="pg-boss"\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=trigger\nOWNPACE_JOB_RUNNER=pg-boss # now\n')).out).toBe(
      'mode=pg-boss\n',
    );
  });

  it("this shell's value over the .env's, as Compose interpolates it; an empty one is no value", () => {
    const dir = aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=trigger\n');
    expect(mode(dir, { OWNPACE_JOB_RUNNER: 'pg-boss' }).out).toBe('mode=pg-boss\n');
    expect(mode(dir, { OWNPACE_JOB_RUNNER: '' }).out).toMatch(REMOVED);
  });

  it.each([
    ['an old .env', yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=trigger\n', {}],
    ['an old .env, quoted', yml(['pg-boss']), 'OWNPACE_JOB_RUNNER="trigger"\n', {}],
    ['this shell', yml(['pg-boss']), '', { OWNPACE_JOB_RUNNER: 'trigger' }],
    ["an old managed.yml's default", yml(['trigger']), '', {}],
  ])('trigger, from %s, fails loudly: Trigger.dev was removed in alpha.18', (_label, managed, env, shellEnv) => {
    const r = mode(aDir(managed, env), shellEnv);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(REMOVED);
    expect(r.out.trim().split('\n')).toHaveLength(1);
  });

  it.each([
    ['a .env value that is not pg-boss', yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=Trigger.dev-secret-ish\n', {}, /in .*\.env is not pg-boss/],
    ['a shell value that is not pg-boss', yml(['pg-boss']), '', { OWNPACE_JOB_RUNNER: 'pgboss' }, /in this shell's environment is not pg-boss/],
    ['a default that is not pg-boss', yml(['both']), '', {}, /managed\.yml's default is not pg-boss/],
    ['two defaults that disagree', yml(['trigger', 'pg-boss'], ['api', 'worker']), '', {}, /two different defaults/],
    ['a managed.yml with no switch (before alpha.16)', yml(), 'OWNPACE_JOB_RUNNER=pg-boss\n', {}, /names no OWNPACE_JOB_RUNNER: it is a release from before alpha\.16/],
  ])('%s is refused in one sentence, without the value', (_label, managed, env, shellEnv, why) => {
    const r = mode(aDir(managed, env), shellEnv);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(why);
    expect(r.out.trim().split('\n')).toHaveLength(1);
    expect(r.out).not.toContain('secret-ish');
    expect(r.out).not.toContain('pgboss');
    expect(r.out).not.toMatch(/:-both/);
  });

  it('managed.yml today: its default is pg-boss, so a .env without the key runs pg-boss', () => {
    const real = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
    expect(mode(aDir(real)).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(real, 'OWNPACE_JOB_RUNNER=trigger\n')).out).toMatch(REMOVED);
  });

  it('job_runner_mode_at reads the managed.yml a commit holds, with the .env it is given', () => {
    const repo = mkdtempSync(join(tmpdir(), 'job-runner-repo-'));
    tempDirs.push(repo);
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    execFileSync('mkdir', ['-p', join(repo, 'deploy/compose')]);
    writeFileSync(join(repo, 'deploy/compose/managed.yml'), yml());
    git('add', '.');
    git('commit', '-q', '-m', 'old');
    const old = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'deploy/compose/managed.yml'), yml(['pg-boss']));
    git('commit', '-q', '-am', 'flip');
    const flip = git('rev-parse', 'HEAD');
    const dir = aDir(yml(['pg-boss']), 'POSTGRES_DB=x\n');
    const at = (commit: string, env = `${dir}/.env`) =>
      sh(dir, `if job_runner_mode_at '${repo}' '${commit}' '${env}'; then echo "mode=$JOB_RUNNER"; else echo "why=$JOB_RUNNER_WHY"; fi`).out;
    expect(at(old)).toMatch(/^why=managed\.yml at [0-9a-f]+ names no OWNPACE_JOB_RUNNER/);
    expect(at(flip)).toBe('mode=pg-boss\n');
    writeFileSync(join(dir, '.env'), 'OWNPACE_JOB_RUNNER=trigger\n');
    expect(at(flip)).toMatch(REMOVED);
    // A commit this clone does not hold reads as a managed.yml with no switch.
    expect(at('0'.repeat(40))).toMatch(/names no OWNPACE_JOB_RUNNER/);
  });
});

describe('job_runner_has_service: a service at the top of services:, nothing else', () => {
  const has = (text: string, svc: string) => {
    const dir = aDir(text);
    return sh(dir, `job_runner_has_service "$(cat "$SCRIPT_DIR/managed.yml")" ${svc} && echo yes || echo no`).out.trim();
  };

  it('finds the worker in services:, and not a volume, a nested key or a comment of that name', () => {
    expect(has(yml([], ['api', 'worker']), 'worker')).toBe('yes');
    expect(has(yml([], ['api']), 'worker')).toBe('no');
    expect(has('services:\n  api:\n    worker:\n      x: 1\n  # worker:\n', 'worker')).toBe('no');
  });

  it('managed.yml today is read: it defines api and the worker, and no trigger-api', () => {
    const real = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
    expect(has(real, 'api')).toBe('yes');
    expect(has(real, 'worker')).toBe('yes');
    expect(has(real, 'trigger-api')).toBe('no');
  });
});

describe('every script that reads the switch reads it here', () => {
  const SOURCES = [
    'bootstrap-managed.sh',
    'deploy-live.sh',
    'stand-up-live.sh',
    'setup-managed-demo.sh',
    'rehearse-capacity.sh',
    'remove-trigger-plane.sh',
  ];

  it.each(SOURCES)('%s sources job-runner.sh, and reads OWNPACE_JOB_RUNNER nowhere else', (file) => {
    const text = readFileSync(join(COMPOSE_DIR, file), 'utf8');
    expect(text).toMatch(/^\s*\. "\$\{SCRIPT_DIR\}\/job-runner\.sh"$/m);
    const own = text
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .filter((l) => /env_value[^\n]*OWNPACE_JOB_RUNNER|\$\{OWNPACE_JOB_RUNNER|\$OWNPACE_JOB_RUNNER/.test(l));
    expect(own, `${file} reads the switch itself`).toEqual([]);
  });
});
