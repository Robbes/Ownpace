// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RETENTION THE BRING-UP STATES (workplan 0134 T1).
 *
 * Since #1435 (2026-10-04) the api refuses to start when `OWNPACE_STAGE` is
 * `alpha` and `BACKUP_RETENTION_DAYS` is blank. An `.env` from before that
 * carries the line blank, as `managed.env.example` ships it, so the first
 * pull after it left the OTA stack's api crash-looping (the Spark,
 * 2026-10-05) with nothing in the deploy saying why.
 *
 * `ensure-env-secrets.sh`, which the bring-up's env phase and the gate's Fill
 * step both run, fills it where the answer is known:
 *
 *   OFF LIVE, 0. `copy-before-update.sh`, the only thing that copies a stack's
 *   databases, runs on live only, so nothing keeps a copy, and the line says
 *   so. Written once, and said.
 *   ON LIVE, NOTHING. Live's number is the owner's (7); the script names it
 *   and the command, and writes nothing.
 *   A VALUE THAT IS THERE is never touched, and a stack that is not the alpha
 *   is left as it is: the api only warns there.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** The four database passwords, set to values nobody publishes, so docker is never asked. */
const DB_PASSWORDS = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'CLICKHOUSE_PASSWORD', 'MINIO_ROOT_PASSWORD']
  .map((k, i) => `${k}=${String(i + 1).repeat(48)}`)
  .join('\n');

/** Run ensure-env-secrets.sh in a checkout of its own, on this .env. */
function ensure(lines: string): { status: number; out: string; env: string } {
  const root = mkdtempSync(join(tmpdir(), 'a-retention-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of readdirSync(COMPOSE_DIR).filter((x) => x.endsWith('.sh'))) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  copyFileSync(join(COMPOSE_DIR, 'managed.yml'), join(compose, 'managed.yml'));
  const envFile = join(compose, '.env');
  writeFileSync(envFile, `${DB_PASSWORDS}\n${lines}\n`, { mode: 0o600 });
  const home = join(root, 'home');
  mkdirSync(home);
  const r = spawnSync(join(compose, 'ensure-env-secrets.sh'), [], {
    encoding: 'utf8',
    cwd: root,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, LANG: 'C' },
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, env: readFileSync(envFile, 'utf8') };
}

/** The value in force, as Compose takes it: the last line for the key. */
const retention = (env: string): string | undefined =>
  env
    .split('\n')
    .filter((l) => l.startsWith('BACKUP_RETENTION_DAYS='))
    .map((l) => l.slice('BACKUP_RETENTION_DAYS='.length))
    .at(-1);

describe('ensure-env-secrets.sh states the retention an alpha stack needs to start', () => {
  it.each([
    ['blank', 'OWNPACE_STAGE=alpha\nBACKUP_RETENTION_DAYS='],
    ['absent', 'OWNPACE_STAGE=alpha'],
    ['quoted empty, stage in another case', 'OWNPACE_STAGE=" Alpha"\nBACKUP_RETENTION_DAYS=""'],
  ])('writes 0 off live when the line is %s, and says why', (_, lines) => {
    const r = ensure(lines);
    expect(r.status, r.out).toBe(0);
    expect(retention(r.env)).toBe('0');
    expect(r.env.match(/^BACKUP_RETENTION_DAYS=/gm)).toHaveLength(1);
    expect(r.out).toMatch(/wrote BACKUP_RETENTION_DAYS=0/);
    expect(r.out).toMatch(/copy-before-update\.sh runs on live only/);
  });

  it('writes nothing on live, and names live’s number and the command', () => {
    const r = ensure('STACK_KIND=production\nOWNPACE_STAGE=alpha\nBACKUP_RETENTION_DAYS=');
    expect(r.status, r.out).toBe(0);
    expect(retention(r.env)).toBe('');
    expect(r.out).toMatch(/LEFT AS IT IS: BACKUP_RETENTION_DAYS is blank on live's \.env/);
    expect(r.out).toMatch(/env-upsert\.sh \S+ BACKUP_RETENTION_DAYS=7/);
    expect(r.out).toMatch(/done, EXCEPT the key\(s\) named above/);
  });

  it.each(['0', '7', '14'])('keeps a value that is there (%s)', (days) => {
    const r = ensure(`OWNPACE_STAGE=alpha\nBACKUP_RETENTION_DAYS=${days}`);
    expect(r.status, r.out).toBe(0);
    expect(retention(r.env)).toBe(days);
    expect(r.out).not.toMatch(/BACKUP_RETENTION_DAYS/);
  });

  it.each([
    ['unset', ''],
    ['empty', 'OWNPACE_STAGE='],
    ['something else', 'OWNPACE_STAGE=beta'],
  ])('leaves a stack that is not the alpha alone (stage %s)', (_, stage) => {
    const r = ensure(`${stage}\nBACKUP_RETENTION_DAYS=`);
    expect(r.status, r.out).toBe(0);
    expect(retention(r.env)).toBe('');
    expect(r.out).not.toMatch(/BACKUP_RETENTION_DAYS/);
  });

  it('runs a second time without writing again', () => {
    const first = ensure('OWNPACE_STAGE=alpha\nBACKUP_RETENTION_DAYS=');
    expect(retention(first.env)).toBe('0');
    const second = ensure(first.env.split('\n').filter((l) => !/_PASSWORD=/.test(l)).join('\n'));
    expect(second.out).not.toMatch(/BACKUP_RETENTION_DAYS/);
    expect(retention(second.env)).toBe('0');
  });
});
