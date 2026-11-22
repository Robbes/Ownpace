// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE READER FOR WHICH RUNNER THE JOBS RUN ON (workplan 0167 T7, ADR-0054).
 *
 * Until alpha.17 removes Trigger.dev, the managed edition runs its jobs on one
 * of two runners, chosen by `OWNPACE_JOB_RUNNER`: `trigger` (the plane) or
 * `pg-boss` (the worker). The bring-up, the deploy and every script that only
 * means something to Trigger.dev branch on it, and a script that read it its
 * own way could stop the plane while another started it. So
 * `deploy/compose/job-runner.sh` is the one reader, and it reads the value as
 * Compose does, so that its answer is what the containers get: this shell's
 * value, else the `.env`'s, else `managed.yml`'s `${OWNPACE_JOB_RUNNER:-…}`
 * default, else `trigger` (alpha.14 and alpha.15 have no switch). Any other
 * value is refused in one sentence that does not print it.
 *
 * HOW IT RUNS. The file is sourced in a bash of its own, from a directory
 * holding it, `env-read.sh`, a `managed.yml` and a `.env` a case writes, and
 * each function is called as the scripts call it. No Docker.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('job_runner_mode: the value Compose would hand the containers', () => {
  it('a managed.yml without the switch (alpha.14, alpha.15) and no .env line: trigger', () => {
    expect(mode(aDir(yml())).out).toBe('mode=trigger\n');
    expect(mode(aDir(yml(), 'POSTGRES_DB=ownpace\n')).out).toBe('mode=trigger\n');
  });

  it('a managed.yml that never names the switch runs the one runner it has, whatever the .env or the shell says', () => {
    const plane = 'services:\n  trigger-api:\n    image: localhost/trigger.dev:${TRIGGER_IMAGE_TAG:-v4.8.8}-abc\n  worker:\n    image: w\n';
    expect(mode(aDir(plane, 'OWNPACE_JOB_RUNNER=pg-boss\n')).out).toBe('mode=trigger\n');
    expect(mode(aDir(plane), { OWNPACE_JOB_RUNNER: 'nonsense' }).out).toBe('mode=trigger\n');
    // A release after the plane's removal, with a worker and no switch.
    expect(mode(aDir(yml([], ['api', 'worker']), 'OWNPACE_JOB_RUNNER=trigger\n')).out).toBe('mode=pg-boss\n');
  });

  it("managed.yml's default, when the .env says nothing or says it empty", () => {
    expect(mode(aDir(yml(['pg-boss']))).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['trigger', 'trigger'], ['api', 'worker']))).out).toBe('mode=trigger\n');
  });

  it(".env's line over the default: the last one, one pair of double quotes removed, a comment dropped", () => {
    expect(mode(aDir(yml(['trigger']), 'OWNPACE_JOB_RUNNER=pg-boss\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['trigger']), 'OWNPACE_JOB_RUNNER="pg-boss"\n')).out).toBe('mode=pg-boss\n');
    expect(mode(aDir(yml(['pg-boss']), 'OWNPACE_JOB_RUNNER=pg-boss\nOWNPACE_JOB_RUNNER=trigger # back\n')).out).toBe(
      'mode=trigger\n',
    );
  });

  it("this shell's value over the .env's, as Compose interpolates it; an empty one is no value", () => {
    const dir = aDir(yml(['trigger']), 'OWNPACE_JOB_RUNNER=trigger\n');
    expect(mode(dir, { OWNPACE_JOB_RUNNER: 'pg-boss' }).out).toBe('mode=pg-boss\n');
    expect(mode(dir, { OWNPACE_JOB_RUNNER: '' }).out).toBe('mode=trigger\n');
  });

  it.each([
    ['a .env value that is neither', yml(['trigger']), 'OWNPACE_JOB_RUNNER=Trigger.dev-secret-ish\n', {}, /in .*\.env is neither trigger nor pg-boss/],
    ['a shell value that is neither', yml(['trigger']), '', { OWNPACE_JOB_RUNNER: 'pgboss' }, /in this shell's environment is neither/],
    ['a default that is neither', yml(['both']), '', {}, /managed\.yml's default is neither/],
    ['two defaults that disagree', yml(['trigger', 'pg-boss'], ['api', 'worker']), '', {}, /two different defaults/],
  ])('%s is refused in one sentence, without the value', (_label, managed, env, shellEnv, why) => {
    const r = mode(aDir(managed, env), shellEnv);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(why);
    expect(r.out.trim().split('\n')).toHaveLength(1);
    expect(r.out).not.toContain('secret-ish');
    expect(r.out).not.toContain('pgboss');
    expect(r.out).not.toMatch(/:-both/);
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
    const dir = aDir(yml(['trigger']), 'POSTGRES_DB=x\n');
    const at = (commit: string, env = `${dir}/.env`) =>
      sh(dir, `job_runner_mode_at '${repo}' '${commit}' '${env}' && echo "mode=$JOB_RUNNER"`).out;
    expect(at(old)).toBe('mode=trigger\n');
    expect(at(flip)).toBe('mode=pg-boss\n');
    writeFileSync(join(dir, '.env'), 'OWNPACE_JOB_RUNNER=trigger\n');
    expect(at(flip)).toBe('mode=trigger\n');
    // A commit this clone does not hold reads as a managed.yml with no switch.
    expect(at('0'.repeat(40))).toBe('mode=trigger\n');
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

  it('managed.yml today is read: it defines api and no service called nothing-like-this', () => {
    const real = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
    expect(has(real, 'api')).toBe('yes');
    expect(has(real, 'nothing-like-this')).toBe('no');
  });
});

describe('job_runner_refuse_in_pg_boss: a Trigger.dev-only script, in each mode', () => {
  const refuse = (managed: string, env: string) =>
    sh(aDir(managed, env), 'job_runner_refuse_in_pg_boss deploy-tasks.sh "it deploys the tasks to Trigger.dev"; echo went-on');

  it('trigger mode: goes on, says nothing', () => {
    const r = refuse(yml(['trigger']), '');
    expect(r.status).toBe(0);
    expect(r.out).toBe('went-on\n');
    expect(r.err).toBe('');
  });

  it('pg-boss mode: exit 1, one sentence naming the mode and what the script does, nothing run after', () => {
    const r = refuse(yml(['trigger']), 'OWNPACE_JOB_RUNNER=pg-boss\n');
    expect(r.status).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/^\[deploy-tasks\.sh\] refused: this stack's jobs run on pg-boss \(OWNPACE_JOB_RUNNER=pg-boss\), and it deploys the tasks to Trigger\.dev; .*Nothing was changed\.\n$/);
  });

  it('a value that is neither: exit 1 too, before anything runs', () => {
    const r = refuse(yml(['trigger']), 'OWNPACE_JOB_RUNNER=nope\n');
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/neither trigger nor pg-boss/);
    expect(r.out).toBe('');
  });
});

describe('every script that branches on the mode reads it here', () => {
  const SOURCES = [
    'bootstrap-managed.sh',
    'deploy-live.sh',
    'copy-before-update.sh',
    'stand-up-live.sh',
    'set-task-env.sh',
    'deploy-tasks.sh',
    'plane-limit.sh',
    'plane-tokens.sh',
    'trigger-version.sh',
    'trigger-credentials.sh',
    'trigger-magic-link.sh',
    'trigger-remember-token.sh',
    'reset-trigger.sh',
    'setup-managed-demo.sh',
    'rehearse-capacity.sh',
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

/**
 * The scripts that only mean something to Trigger.dev, RUN in each mode from
 * a copy of deploy/compose whose managed.yml hands the switch to its
 * containers (as alpha.16's does), with `docker`, `pnpm`, `npx` and `node`'s
 * friends stand-ins that record that they were called. In pg-boss mode each
 * refuses in one sentence and asks nothing; in trigger mode none of them says
 * a word about pg-boss.
 */
describe('the Trigger.dev-only scripts, run in each mode', () => {
  const REFUSERS: Array<[string, string[]]> = [
    ['set-task-env.sh', []],
    ['set-task-env.sh', ['--forget-owner-names']],
    ['deploy-tasks.sh', []],
    ['plane-limit.sh', []],
    ['plane-limit.sh', ['--check']],
    ['plane-tokens.sh', []],
    ['trigger-credentials.sh', ['--write']],
    ['trigger-magic-link.sh', []],
    ['trigger-remember-token.sh', []],
    ['reset-trigger.sh', ['--yes']],
    ['trigger-version.sh', ['backup']],
    ['trigger-version.sh', ['restore']],
    ['trigger-version.sh', ['drill']],
  ];

  function aStack(runner: 'trigger' | 'pg-boss'): { compose: string; bin: string; log: string } {
    const root = mkdtempSync(join(tmpdir(), `trigger-only-${runner}-`));
    tempDirs.push(root);
    const compose = join(root, 'deploy', 'compose');
    cpSync(COMPOSE_DIR, compose, { recursive: true, filter: (src) => !/\/\.env$/.test(src) });
    const real = readFileSync(join(compose, 'managed.yml'), 'utf8');
    const switched = real.replace(
      /\nservices:\n/,
      `\nservices:\n  worker:\n    environment:\n      OWNPACE_JOB_RUNNER: \${OWNPACE_JOB_RUNNER:-${runner}}\n`,
    );
    expect(switched).not.toBe(real);
    writeFileSync(join(compose, 'managed.yml'), switched);
    writeFileSync(join(compose, '.env'), 'TRIGGER_PROJECT_REF=proj_stand_in\n');
    const bin = join(root, 'bin');
    const log = join(root, 'calls');
    execFileSync('mkdir', ['-p', bin]);
    for (const tool of ['docker', 'pnpm', 'npx', 'psql', 'jq']) {
      writeFileSync(join(bin, tool), `#!/usr/bin/env bash\nprintf '%s %s\\n' ${tool} "$*" >>"${log}"\nexit 1\n`);
      chmodSync(join(bin, tool), 0o755);
    }
    return { compose, bin, log };
  }

  const pg = aStack('pg-boss');
  const tr = aStack('trigger');
  const runIt = (st: { compose: string; bin: string }, script: string, args: string[]) =>
    spawnSync(join(st.compose, script), args, {
      env: { PATH: `${st.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dirname(st.compose), TRIGGER_DB_PSQL: 'psql' },
      encoding: 'utf8',
      input: '',
      timeout: 30_000,
    });

  it.each(REFUSERS)('pg-boss mode: %s %j refuses in one sentence and calls nothing', (script, args) => {
    writeFileSync(pg.log, '');
    const r = runIt(pg, script, args);
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^\\[${script.replace('.', '\\.')}\\] refused: this stack's jobs run on pg-boss \\(OWNPACE_JOB_RUNNER=pg-boss\\), and .*Nothing was changed\\.\\n$`));
    expect(r.stdout).toBe('');
    expect(readFileSync(pg.log, 'utf8')).toBe('');
  });

  it.each(REFUSERS)('trigger mode: %s %j says nothing of pg-boss', (script, args) => {
    const r = runIt(tr, script, args);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/pg-boss/);
  });

  it.each([['pin'], ['probe'], ['list']])('pg-boss mode: trigger-version.sh %s is not refused: it reads or writes this checkout only', (cmd) => {
    const r = runIt(pg, 'trigger-version.sh', [cmd]);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/jobs run on pg-boss/);
  });
});
