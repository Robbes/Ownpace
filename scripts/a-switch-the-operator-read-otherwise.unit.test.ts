// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SWITCH THE OPERATOR READ OTHERWISE (workplan 0167 T7; ADR-0054).
 *
 * `managed.env.example` leaves `OWNPACE_JOB_RUNNER=` empty, and since the
 * switch is on `deploy/compose/managed.yml` hands the api and the worker
 * `${OWNPACE_JOB_RUNNER:-pg-boss}`: a stack whose `.env` says nothing runs its
 * jobs on pg-boss. `operator.sh` sources the same `.env` on the host and runs
 * `operator-jobs.ts`, which, like every reader in code, takes an empty value
 * for `trigger`. So on exactly the stack the default makes, `operator.sh jobs`
 * said "the jobs run on Trigger.dev" and exited 1: the one view of the jobs
 * there is, refused where the jobs are. Found when the switch was turned on,
 * before any stack ran it.
 *
 * What holds: for `jobs`, `operator.sh` asks job-runner.sh, the scripts' one
 * reader of the switch, and hands its answer to the command, so an empty
 * `.env` is pg-boss, `trigger` is trigger, a value that is neither stops it
 * before Node runs, and no other verb is handed anything.
 *
 * Run with stand-ins for `docker` (the published port) and `pnpm` (prints the
 * value it was handed).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(ROOT, 'deploy', 'compose');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function run(dotEnv: string, args: string[]): { status: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'operator-switch-'));
  dirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  const bin = join(root, 'bin');
  mkdirSync(compose, { recursive: true });
  mkdirSync(bin);
  for (const f of ['operator.sh', 'env-read.sh', 'stack-kind.sh', 'job-runner.sh', 'managed.yml']) copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  chmodSync(join(compose, 'operator.sh'), 0o755);
  writeFileSync(join(compose, '.env'), `POSTGRES_PASSWORD=pw\n${dotEnv}`);
  writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\necho "0.0.0.0:55432"\n');
  writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\necho "handed OWNPACE_JOB_RUNNER=${OWNPACE_JOB_RUNNER-<unset>}"\n');
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'pnpm'), 0o755);
  const r = spawnSync('bash', [join(compose, 'operator.sh'), ...args], {
    env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: root },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("operator.sh jobs reads the switch as the containers are told it (0167 T7)", () => {
  it("an empty OWNPACE_JOB_RUNNER in .env is managed.yml's default, pg-boss", () => {
    const r = run('OWNPACE_JOB_RUNNER=\n', ['jobs']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('handed OWNPACE_JOB_RUNNER=pg-boss');
  });

  it('an absent one too', () => {
    expect(run('', ['jobs']).out).toContain('handed OWNPACE_JOB_RUNNER=pg-boss');
  });

  it('trigger, the way back, is trigger', () => {
    expect(run('OWNPACE_JOB_RUNNER=trigger\n', ['jobs']).out).toContain('handed OWNPACE_JOB_RUNNER=trigger');
  });

  it('a value that is neither stops it before Node runs', () => {
    const r = run('OWNPACE_JOB_RUNNER=both\n', ['jobs']);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/FATAL: OWNPACE_JOB_RUNNER in .* is neither trigger nor pg-boss/);
    expect(r.out).not.toContain('handed');
  });

  it('another verb is handed nothing new', () => {
    expect(run('OWNPACE_JOB_RUNNER=\n', ['list']).out).toContain('handed OWNPACE_JOB_RUNNER=');
    expect(run('OWNPACE_JOB_RUNNER=\n', ['list']).out).not.toContain('handed OWNPACE_JOB_RUNNER=pg-boss');
  });
});
