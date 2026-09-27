// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDENTIAL THE NEXT STEP PRINTED.
 *
 * The live-target lane (`e2e-live-target.yml`) armed itself by appending every
 * `LIVE_*` line of the persisted `.env` to `$GITHUB_ENV`, under a comment
 * saying "GITHUB_ENV writes do not appear in the log". The write does not. The
 * runner then lists every variable it holds under `env:` in the header of
 * each later step, the way `PNPM_HOME` from `pnpm/action-setup` shows in every
 * run of this repository, and it masks registered secrets only. These are not
 * secrets, by design: they live in the owner's `.env`. So the first armed run
 * would have printed the catch-all's and Soverin's passwords and the API token
 * in the header of "Run the lane", in a public log. Found in a read-only sweep
 * on 2026-09-27, before any run was armed (the latest said `0 LIVE_* line(s)`).
 *
 * THE RULE: a step that reads a `.env` does not write `$GITHUB_ENV` or
 * `$GITHUB_OUTPUT`. Values are read, with `env_value`, inside the step whose
 * process needs them, and anything that looks like a credential is masked
 * before that process can print it.
 *
 * The lane's step is RUN here, with a `pnpm` that reports what it was handed,
 * because the property is about what arrives and what is printed, and a
 * `.env` may single-quote a value that a raw `export "$line"` would keep the
 * quotes of.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

type Step = { name?: string; run?: string };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

/** Shell comments removed: a comment may name a file without reading it. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function workflows(): string[] {
  return spawnSync('git', ['ls-files', '.github/workflows'], { cwd: ROOT, encoding: 'utf8' })
    .stdout.split('\n')
    .filter((f) => /\.ya?ml$/.test(f));
}

/** A path to a dotenv file, as opposed to `process.env.X`. */
const READS_A_DOTENV = /(^|[\s"'/}=])\.env\b(?![.\w])/;

describe('no workflow routes a .env through the files the runner prints', () => {
  it('finds no step that reads a .env and writes $GITHUB_ENV or $GITHUB_OUTPUT', () => {
    const wrong: string[] = [];
    let steps = 0;
    for (const file of workflows()) {
      const wf = parse(read(file)) as Workflow;
      for (const [job, def] of Object.entries(wf.jobs ?? {})) {
        for (const step of def.steps ?? []) {
          const run = code(step.run ?? '');
          if (!run) continue;
          steps += 1;
          if (READS_A_DOTENV.test(run) && /GITHUB_(ENV|OUTPUT)\b/.test(run)) {
            wrong.push(`${file} ${job}: ${step.name ?? run.split('\n')[0]}`);
          }
        }
      }
    }
    expect(steps, 'no run: steps found: the scan is looking at nothing').toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });

  it('tells a dotenv path from process.env, so the scan is not vacuous', () => {
    expect(READS_A_DOTENV.test(`grep -E '^LIVE_' "\${PERSIST_DIR}/.env" >> "$GITHUB_ENV"`)).toBe(true);
    expect(READS_A_DOTENV.test('cp deploy/compose/.env x')).toBe(true);
    expect(READS_A_DOTENV.test('fs.appendFileSync(process.env.GITHUB_ENV, lines)')).toBe(false);
    expect(READS_A_DOTENV.test('cat > deploy/selfhost/.env.example')).toBe(false);
  });
});

describe('the live-target lane', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'live-lane-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const PASSWORD = 'catchall-pw-9f3e';
  const TOKEN = 'live-api-token-77aa';

  function runTheLane(): { status: number | null; stdout: string; stderr: string; handed: string; githubEnv: string } {
    const wf = parse(read('.github/workflows/e2e-live-target.yml')) as Workflow;
    const steps = wf.jobs!['live-target']!.steps!;
    const lane = steps.find((s) => code(s.run ?? '').includes('scripts/live-target-nightly.ts'));
    expect(lane, 'no step runs the lane').toBeDefined();

    const persist = join(dir, 'persist');
    mkdirSync(persist);
    writeFileSync(
      join(persist, '.env'),
      [
        'WEB_BIND=100.64.0.1',
        'LIVE_CATCHALL_HOST=imap.example.org',
        'LIVE_CATCHALL_USER=catchall@example.org',
        `LIVE_CATCHALL_PASSWORD='${PASSWORD}'`,
        `LIVE_TARGET_API_TOKEN=${TOKEN}   # from the issuer`,
        'LIVE_TARGET_API_URL=http://localhost:3001',
        '',
      ].join('\n'),
    );
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nenv | grep -E "^(LIVE_|WEB_BIND=)" | sort > "$HANDED"\n');
    chmodSync(join(bin, 'pnpm'), 0o755);
    const script = join(dir, 'step.sh');
    writeFileSync(script, lane!.run!);
    const githubEnv = join(dir, 'github_env');
    writeFileSync(githubEnv, '');
    const handed = join(dir, 'handed');
    writeFileSync(handed, '');
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      MANAGED_ENV_PERSIST_DIR: persist,
      GITHUB_ENV: githubEnv,
      HANDED: handed,
    };
    delete env.COMPOSE_PROJECT_NAME;
    // As the runner runs a `run:` block.
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], { cwd: ROOT, encoding: 'utf8', env });
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      handed: readFileSync(handed, 'utf8'),
      githubEnv: readFileSync(githubEnv, 'utf8'),
    };
  }

  it('hands the lane its values, unquoted, and nothing else from the .env', () => {
    const r = runTheLane();
    expect(r.status, r.stderr).toBe(0);
    expect(r.handed).toContain(`LIVE_CATCHALL_PASSWORD=${PASSWORD}\n`);
    expect(r.handed).toContain(`LIVE_TARGET_API_TOKEN=${TOKEN}\n`);
    expect(r.handed).toContain('LIVE_CATCHALL_HOST=imap.example.org\n');
    expect(r.handed).not.toContain('WEB_BIND');
  });

  it('writes none of it where the runner prints it, and masks the credentials first', () => {
    const r = runTheLane();
    expect(r.githubEnv).toBe('');
    const printed = r.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::'));
    for (const secret of [PASSWORD, TOKEN]) {
      expect(r.stdout, `${secret} was not masked`).toContain(`::add-mask::${secret}`);
      expect(printed.join('\n') + r.stderr).not.toContain(secret);
    }
    // A host is not a credential; masking one would only blank it out of the
    // lane's own diagnosis.
    expect(r.stdout).not.toContain('::add-mask::imap.example.org');
  });

  it('no longer says GITHUB_ENV writes stay out of the log', () => {
    expect(read('.github/workflows/e2e-live-target.yml')).not.toMatch(/GITHUB_ENV writes do not appear in the log/);
  });
});
