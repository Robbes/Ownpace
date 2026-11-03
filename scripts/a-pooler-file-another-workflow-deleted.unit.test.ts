// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A POOLER FILE ANOTHER WORKFLOW DELETED (2026-11-03, workplan 0132).
 *
 * The OTA stack is brought up by the nightly managed gate, from the
 * self-hosted runner's work folder. Its `pgbouncer` bind-mounted
 * `./pgbouncer/userlist.txt` from there: a gitignored file, which the gate's
 * restore copied in from the persisted directory on every run because
 * `actions/checkout`'s clean (`git clean -ffdx`) deletes ignored files. But
 * every workflow of this repository that runs on that runner checks out into
 * the same folder, and ci.yml runs there on a push to `main`. At 02:51 UTC its
 * checkout deleted the file under the running pgbouncer. A running container
 * keeps the file it opened, so nothing showed until the Docker daemon
 * restarted for the host's Docker upgrade at 03:58: the restarted container's
 * bind source was missing, Docker made a DIRECTORY there, and the pooler
 * failed (`error mounting ".../pgbouncer/userlist.txt" to rootfs at
 * "/etc/pgbouncer/userlist.txt": ... not a directory`, exit 127). Every API
 * call that needs the database went through it. A host reboot would have done
 * the same.
 *
 * And the copy the restore made it from was STALE: its password no longer
 * matched the container's PGBOUNCER_AUTH_PASSWORD or the database role
 * (`password authentication failed for user "pgbouncer_auth"`).
 * `ensure-env-secrets.sh` rewrote the checkout's file from the `.env` on every
 * run, and the gate persisted the `.env` back, but only TOLD a human to copy
 * the userlist. The owner wrote the file by hand from the container's own
 * value at about 04:31.
 *
 * THE FIX: ONE FILE, THE ONE MOUNTED, OUTSIDE EVERY CHECKOUT.
 * `managed.yml` mounts `${PGBOUNCER_USERLIST:-./pgbouncer/userlist.txt}`. The
 * gate's Fill step sets `PGBOUNCER_USERLIST` in the OTA stack's `.env` to
 * `${PERSIST_DIR}/userlist.txt`, before `ensure-env-secrets.sh`, which writes
 * that file in place from the `.env`'s password; the step's copy-back persists
 * the key with the `.env`. Live's `.env` does not set it, so live's mount, its
 * file and everything written for it are what they were.
 *
 * WHAT IS ASSERTED.
 *
 *   managed.yml: pgbouncer's userlist mount is exactly that, and its default
 *   is the file live has always used.
 *
 *   `pgbouncer_userlist` (env-read.sh), run: Compose's resolution (the
 *   environment over the `.env`, then the default), refusing a shell that
 *   disagrees with the `.env` (Compose would follow the shell, the way a
 *   `set -a; . .env` from the other stack's checkout leaks) and a relative
 *   path.
 *
 *   `ensure-env-secrets.sh`, run: with the key, it writes the named file, in
 *   place (same inode, which a running container's bind mount holds), 0644,
 *   from the `.env`'s password, and nothing in the checkout; without it, the
 *   checkout's file, as before. A directory there is refused by name, and a
 *   shell that disagrees is refused before anything is written. No password
 *   in what it prints.
 *
 *   The gate, read: the restore copies no userlist into the checkout and no
 *   step tells anybody to copy one; the Fill step sets the key from the same
 *   PERSIST_DIR the restore uses, without `--if-absent`, before
 *   `ensure-env-secrets.sh`, and copies the `.env` back after it. And run:
 *   the Fill step's own `run:` under `bash -eo pipefail`, twice, on a stale
 *   persisted userlist: the file is current after the first run, the same
 *   inode, unchanged by the second; the persisted `.env` carries the key once;
 *   the checkout holds no userlist; the log holds no password. With the
 *   repository variable unset, the file is `$HOME/.persistent/<project>/`'s.
 *
 *   The bring-up: `load_env` asks `refuse_a_userlist_docker_would_make_a_directory`
 *   before it sources the `.env` and before Compose; run, the function refuses
 *   a named file that is missing (and leaves nothing at that path) or a
 *   directory, passes a file, refuses a disagreeing shell, and leaves live's
 *   default alone even when its file is missing. The data phase's mode repair
 *   follows the same path.
 *
 *   The runbook no longer tells the owner to copy the userlist by hand.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const ENV_READ = join(COMPOSE_DIR, 'env-read.sh');
const MANAGED_YML = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
const BOOTSTRAP = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
const GATE_REL = '.github/workflows/e2e-managed.yml';
const MOUNT = '${PGBOUNCER_USERLIST:-./pgbouncer/userlist.txt}:/etc/pgbouncer/userlist.txt:ro';
/** The OTA stack's project: managed.yml's own `name:`, read rather than spelled. */
const PROJECT = /^name:\s*(\S+)/m.exec(MANAGED_YML)?.[1] ?? '';

/** A password that must never reach a log. */
const PASSWORD = 'pgb-sentinel-5d2e71';
const userlistLine = (pw: string): string => `"pgbouncer_auth" "${pw}"\n`;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pooler-file-'));
  tempDirs.push(dir);
  return dir;
}
// Many large temp folders can outlast vitest's 10 s hook timeout on a loaded run.
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}, 120_000);

/** The lines a shell runs: comments and blank lines dropped. */
const code = (text: string): string[] =>
  text.split('\n').filter((l) => l.trim() !== '' && !/^\s*#/.test(l));

/**
 * A checkout holding what the scripts under test source and call, with a
 * `docker` that answers nothing: ensure-env-secrets.sh asks it which volumes
 * exist before it generates a database password, and must never ask the
 * machine's own.
 */
function aCheckout(dotEnv: string): { root: string; compose: string; home: string; bin: string } {
  const root = tempDir();
  const home = tempDir();
  const compose = join(root, 'deploy/compose');
  mkdirSync(compose, { recursive: true });
  for (const f of [
    'managed.yml',
    'managed.env.example',
    'env-upsert.sh',
    'env-read.sh',
    'stack-kind.sh',
    'shipped-passwords.sh',
    'ensure-env-secrets.sh',
    'refuse-live-env.sh',
  ]) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  writeFileSync(join(compose, '.env'), dotEnv);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  return { root, compose, home, bin };
}

function bash(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; bin?: string } = {},
): { status: number | null; out: string } {
  const r = spawnSync('bash', ['--noprofile', '--norc', ...args], {
    cwd: opts.cwd,
    env: { PATH: `${opts.bin ? `${opts.bin}:` : ''}${process.env.PATH ?? '/usr/bin:/bin'}`, ...opts.env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---------------------------------------------------------------------------
// managed.yml
// ---------------------------------------------------------------------------

describe("managed.yml mounts the userlist the .env names, and live's by default", () => {
  const services = (parseYaml(MANAGED_YML) as { services: Record<string, { volumes?: unknown[] }> }).services;
  const volumes = (services.pgbouncer?.volumes ?? []).map(String);

  it('pgbouncer mounts exactly one userlist, from ${PGBOUNCER_USERLIST:-./pgbouncer/userlist.txt}', () => {
    const userlists = volumes.filter((v) => v.includes(':/etc/pgbouncer/userlist.txt'));
    expect(
      userlists,
      'a source in the checkout alone is the file the next checkout of another workflow deletes under a running pgbouncer',
    ).toEqual([MOUNT]);
  });

  it('nothing else mounts it, so no other service can follow a stale or missing one', () => {
    const others = Object.entries(services)
      .filter(([name]) => name !== 'pgbouncer')
      .filter(([, s]) => (s.volumes ?? []).map(String).some((v) => /PGBOUNCER_USERLIST|userlist\.txt/.test(v)))
      .map(([name]) => name);
    expect(others).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pgbouncer_userlist (env-read.sh)
// ---------------------------------------------------------------------------

describe('pgbouncer_userlist finds the file the way Compose does, and refuses a shell that disagrees', () => {
  function resolve(dotEnv: string | null, env: NodeJS.ProcessEnv = {}): { status: number | null; out: string; dir: string } {
    const dir = tempDir();
    if (dotEnv !== null) writeFileSync(join(dir, '.env'), dotEnv);
    const r = bash(['-c', `. "${ENV_READ}"; pgbouncer_userlist "${dir}"`], { env });
    return { ...r, dir };
  }

  it("no key, no .env: pgbouncer/userlist.txt beside managed.yml, live's file as it always was", () => {
    const r = resolve(null);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toBe(`${r.dir}/pgbouncer/userlist.txt`);
    const empty = resolve('PGBOUNCER_USERLIST=\nOTHER=1\n');
    expect(empty.out).toBe(`${empty.dir}/pgbouncer/userlist.txt`);
  });

  it.each([
    ['bare', 'PGBOUNCER_USERLIST=/kept/elsewhere/userlist.txt'],
    ['double-quoted, which Compose reads without its quotes', 'PGBOUNCER_USERLIST="/kept/elsewhere/userlist.txt"'],
    ['single-quoted', "PGBOUNCER_USERLIST='/kept/elsewhere/userlist.txt'"],
    ['the last of two, as Compose takes it', 'PGBOUNCER_USERLIST=/first\nPGBOUNCER_USERLIST=/kept/elsewhere/userlist.txt'],
  ])('the key in the .env, %s: that file', (_label, line) => {
    const r = resolve(`${line}\n`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toBe('/kept/elsewhere/userlist.txt');
  });

  it('a shell that exports the same value as the .env is followed', () => {
    const r = resolve('PGBOUNCER_USERLIST=/kept/elsewhere/userlist.txt\n', {
      PGBOUNCER_USERLIST: '/kept/elsewhere/userlist.txt',
    });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toBe('/kept/elsewhere/userlist.txt');
  });

  it.each([
    ["another stack's value, the .env setting none (live's checkout after the OTA .env was sourced)", '', '/the/other/stack/userlist.txt'],
    ['another value than the .env', 'PGBOUNCER_USERLIST=/kept/elsewhere/userlist.txt\n', '/the/other/stack/userlist.txt'],
    ['set but empty, which hands Compose the default', 'PGBOUNCER_USERLIST=/kept/elsewhere/userlist.txt\n', ''],
  ])('a shell with %s is refused, naming both and the fix', (_label, dotEnv, exported) => {
    const r = resolve(dotEnv, { PGBOUNCER_USERLIST: exported });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`PGBOUNCER_USERLIST='${exported}'`);
    expect(r.out).toContain('unset PGBOUNCER_USERLIST');
  });

  it('a relative path is refused: Compose would resolve it inside the checkout', () => {
    const r = resolve('PGBOUNCER_USERLIST=pgbouncer/userlist.txt\n');
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/not an absolute path/);
  });
});

// ---------------------------------------------------------------------------
// ensure-env-secrets.sh
// ---------------------------------------------------------------------------

describe('ensure-env-secrets.sh writes the file managed.yml mounts, in place', () => {
  function ensure(c: { root: string; bin: string; home: string }, env: NodeJS.ProcessEnv = {}) {
    return bash(['./deploy/compose/ensure-env-secrets.sh'], { cwd: c.root, bin: c.bin, env: { HOME: c.home, ...env } });
  }

  it("the key set: the named file holds the .env's password, the same inode, 0644, and the checkout holds none", () => {
    const persist = tempDir();
    const file = join(persist, 'userlist.txt');
    writeFileSync(file, userlistLine('stale-from-a-month-ago'));
    // 0600, as a hand-written copy can be: the 0644 below is then the script's
    // chmod, not this process's umask (pgbouncer reads it as another user).
    chmodSync(file, 0o600);
    const inode = statSync(file).ino;
    const c = aCheckout(`PGBOUNCER_AUTH_PASSWORD=${PASSWORD}\nPGBOUNCER_USERLIST=${file}\n`);
    const r = ensure(c);
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(userlistLine(PASSWORD));
    expect(statSync(file).ino, 'replaced, not written in place: a running bind mount keeps the old file').toBe(inode);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    expect(existsSync(join(c.compose, 'pgbouncer/userlist.txt')), 'a userlist in the checkout').toBe(false);
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).toContain(`wrote ${file}`);
  });

  it("the key unset: the checkout's pgbouncer/userlist.txt, as live's always was", () => {
    const c = aCheckout(`PGBOUNCER_AUTH_PASSWORD=${PASSWORD}\n`);
    const r = ensure(c);
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(join(c.compose, 'pgbouncer/userlist.txt'), 'utf8')).toBe(userlistLine(PASSWORD));
    expect(r.out).not.toContain(PASSWORD);
  });

  it('a directory where the file belongs, as Docker leaves one, is refused by name and left as it is', () => {
    const persist = tempDir();
    const file = join(persist, 'userlist.txt');
    mkdirSync(file);
    const c = aCheckout(`PGBOUNCER_AUTH_PASSWORD=${PASSWORD}\nPGBOUNCER_USERLIST=${file}\n`);
    const r = ensure(c);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain(`${file} is a directory`);
    expect(r.out).toContain(`rmdir ${file}`);
    expect(r.out).not.toContain(PASSWORD);
    expect(readdirSync(file)).toEqual([]);
  });

  it('a shell that exports another value is refused before anything is written', () => {
    const persist = tempDir();
    const file = join(persist, 'userlist.txt');
    const other = join(tempDir(), 'userlist.txt');
    const dotEnv = `PGBOUNCER_AUTH_PASSWORD=${PASSWORD}\nPGBOUNCER_USERLIST=${file}\n`;
    const c = aCheckout(dotEnv);
    const r = ensure(c, { PGBOUNCER_USERLIST: other });
    expect(r.status, r.out).toBe(1);
    expect(readFileSync(join(c.compose, '.env'), 'utf8'), 'the .env was written before the refusal').toBe(dotEnv);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(other), "this stack's password reached the other stack's file").toBe(false);
    expect(existsSync(join(c.compose, 'pgbouncer'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

interface Step {
  name?: string;
  run?: string;
}
const gate = parseYaml(readFileSync(join(REPO_ROOT, GATE_REL), 'utf8')) as { jobs: Record<string, { steps: Step[] }> };
const steps = Object.values(gate.jobs).flatMap((j) => j.steps);
const restore = steps.find((s) => s.name?.startsWith('Restore the one-time setup'));
const fill = steps.find((s) => s.name?.startsWith('Fill in everything the repo already knows how to supply'));
const PERSIST_LINE = 'PERSIST_DIR="${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/${COMPOSE_PROJECT}}"';

describe('the gate mounts the persisted userlist, writes it every run, and copies none into the checkout', () => {
  it('found the restore and the Fill step', () => {
    expect(restore?.run, `${GATE_REL} has no step "Restore the one-time setup …"`).toBeTruthy();
    expect(fill?.run, `${GATE_REL} has no step "Fill in everything the repo already knows how to supply"`).toBeTruthy();
  });

  it('the restore copies the .env and no userlist into the checkout', () => {
    const lines = code(restore?.run ?? '');
    expect(lines.some((l) => l.includes('cp "${PERSIST_DIR}/.env" deploy/compose/.env')), 'the landmark is gone').toBe(true);
    expect(
      lines.filter((l) => /userlist/.test(l)),
      'a userlist in the checkout is the file the next checkout of another workflow deletes',
    ).toEqual([]);
  });

  it('no step copies a userlist, or tells anybody to', () => {
    const copies = steps.flatMap((s) => code(s.run ?? '')).filter((l) => /\bcp\b[^\n]*userlist/.test(l));
    expect(copies, 'a copy is how the persisted file went stale').toEqual([]);
  });

  it('the Fill step sets PGBOUNCER_USERLIST from the restore\'s PERSIST_DIR, before ensure-env-secrets.sh, and persists the .env after it', () => {
    const lines = code(fill?.run ?? '');
    const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const persistDir = lines.findIndex((l) => l.trim() === PERSIST_LINE);
    const project = at(/^\s*COMPOSE_PROJECT="\$\(compose_project deploy\/compose\)"\s*$/);
    const upsert = at(/^\s*\.\/deploy\/compose\/env-upsert\.sh deploy\/compose\/\.env "PGBOUNCER_USERLIST=\$\{PERSIST_DIR\}\/userlist\.txt"\s*$/);
    const ensure = at(/^\s*\.\/deploy\/compose\/ensure-env-secrets\.sh\s*$/);
    const copyBack = at(/^\s*cp deploy\/compose\/\.env "\$\{PERSIST_DIR\}\/\.env"\s*$/);
    expect(code(restore?.run ?? '').some((l) => l.trim() === PERSIST_LINE), "the restore's PERSIST_DIR is not this one").toBe(true);
    expect(project, 'the Fill step does not ask compose_project').toBeGreaterThanOrEqual(0);
    expect(persistDir, 'the Fill step does not compute PERSIST_DIR as the restore does').toBeGreaterThan(project);
    expect(upsert, 'the Fill step no longer sets PGBOUNCER_USERLIST, plainly (never --if-absent)').toBeGreaterThan(persistDir);
    expect(ensure, 'ensure-env-secrets.sh runs before the key is set, so it writes the checkout\'s file').toBeGreaterThan(upsert);
    expect(copyBack, 'the .env, and the key with it, is no longer persisted after ensure-env-secrets.sh').toBeGreaterThan(ensure);
    // Nothing between the computation and the copy-back changes where it points.
    expect(lines.slice(persistDir + 1, copyBack).filter((l) => /\bPERSIST_DIR=/.test(l))).toEqual([]);
  });

  /** The Fill step's own `run:`, under `bash -eo pipefail`, as the runner runs it. */
  function runFill(c: ReturnType<typeof aCheckout>, env: NodeJS.ProcessEnv) {
    return bash(['-eo', 'pipefail', '-c', fill?.run ?? 'exit 99'], { cwd: c.root, bin: c.bin, env: { HOME: c.home, ...env } });
  }
  const OTA_ENV = [
    'TRIGGER_PROJECT_REF=proj_example',
    'TRIGGER_SECRET_KEY=tr_prod_example',
    'NODE_ENV=development',
    `PGBOUNCER_AUTH_PASSWORD=${PASSWORD}`,
    '',
  ].join('\n');
  const keyLines = (text: string): string[] => text.split('\n').filter((l) => /^(export\s+)?PGBOUNCER_USERLIST=/.test(l));

  it('run twice on a stale persisted userlist: current after the first, unchanged by the second, in place, and never in the checkout', () => {
    const c = aCheckout(OTA_ENV);
    const persist = tempDir();
    const file = join(persist, 'userlist.txt');
    writeFileSync(file, userlistLine('stale-from-a-month-ago'));
    // 0600, as a hand-written copy can be: the 0644 below is then the script's
    // chmod, not this process's umask (pgbouncer reads it as another user).
    chmodSync(file, 0o600);
    const inode = statSync(file).ino;

    const first = runFill(c, { MANAGED_ENV_PERSIST_DIR: persist });
    expect(first.status, first.out).toBe(0);
    expect(readFileSync(file, 'utf8'), 'the mounted file is not the .env\'s password').toBe(userlistLine(PASSWORD));
    expect(statSync(file).ino).toBe(inode);
    expect(statSync(file).mode & 0o777).toBe(0o644);
    const persisted = readFileSync(join(persist, '.env'), 'utf8');
    expect(keyLines(persisted), 'the persisted .env, which the operator\'s checkout links').toEqual([`PGBOUNCER_USERLIST=${file}`]);
    expect(keyLines(readFileSync(join(c.compose, '.env'), 'utf8'))).toEqual([`PGBOUNCER_USERLIST=${file}`]);
    expect(existsSync(join(c.compose, 'pgbouncer/userlist.txt')), 'a userlist in the checkout').toBe(false);
    expect(first.out).not.toContain(PASSWORD);

    // The next night, from a fresh checkout restored from the persisted .env.
    const next = aCheckout(persisted);
    const second = runFill(next, { MANAGED_ENV_PERSIST_DIR: persist });
    expect(second.status, second.out).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(userlistLine(PASSWORD));
    expect(statSync(file).ino).toBe(inode);
    expect(keyLines(readFileSync(join(persist, '.env'), 'utf8'))).toEqual([`PGBOUNCER_USERLIST=${file}`]);
    expect(second.out).not.toContain(PASSWORD);
  });

  it("the repository variable unset: the stack's own persisted directory under $HOME", () => {
    expect(PROJECT, "managed.yml has no `name:`").not.toBe('');
    const c = aCheckout(OTA_ENV);
    const r = runFill(c, { MANAGED_ENV_PERSIST_DIR: '' });
    expect(r.status, r.out).toBe(0);
    const file = join(c.home, '.persistent', PROJECT, 'userlist.txt');
    expect(readFileSync(file, 'utf8')).toBe(userlistLine(PASSWORD));
    expect(keyLines(readFileSync(join(c.home, '.persistent', PROJECT, '.env'), 'utf8'))).toEqual([`PGBOUNCER_USERLIST=${file}`]);
  });
});

// ---------------------------------------------------------------------------
// The bring-up
// ---------------------------------------------------------------------------

describe('the bring-up refuses a named userlist that is not a file, before Compose can make a directory of it', () => {
  const FN = 'refuse_a_userlist_docker_would_make_a_directory';
  const start = BOOTSTRAP.indexOf(`\n${FN}() {`);
  const body = BOOTSTRAP.slice(start + 1, BOOTSTRAP.indexOf('\n}\n', start) + 3);

  it('load_env asks it before it sources the .env and before it asks Compose', () => {
    expect(start, `no ${FN} in bootstrap-managed.sh`).toBeGreaterThan(-1);
    const at = BOOTSTRAP.indexOf('\nload_env() {');
    const loadEnv = BOOTSTRAP.slice(at + 1, BOOTSTRAP.indexOf('\n}\n', at) + 3);
    const lines = code(loadEnv);
    const call = lines.findIndex((l) => l.trim() === FN);
    expect(call, `load_env does not call ${FN} on a line of its own`).toBeGreaterThan(-1);
    expect(call, 'after the source, a shell value the .env does not set is no longer told apart').toBeLessThan(
      lines.findIndex((l) => l.trim() === '. "$ENV_FILE"'),
    );
    expect(call).toBeLessThan(lines.findIndex((l) => l.includes('config -q')));
  });

  function refuse(dotEnv: string, env: NodeJS.ProcessEnv = {}): { status: number | null; out: string; dir: string } {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), dotEnv);
    const script = [
      'set -euo pipefail',
      `. "${ENV_READ}"`,
      'die() { echo "!!! $*" >&2; exit 1; }',
      `SCRIPT_DIR="${dir}"`,
      body,
      FN,
    ].join('\n');
    return { ...bash(['-c', script], { env }), dir };
  }

  it('a named file that is missing: refused, naming it and ensure-env-secrets.sh, and nothing is made there', () => {
    const file = join(tempDir(), 'userlist.txt');
    const r = refuse(`PGBOUNCER_USERLIST=${file}\n`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`${file}, which PGBOUNCER_USERLIST names`);
    expect(r.out).toContain('ensure-env-secrets.sh');
    expect(existsSync(file)).toBe(false);
  });

  it('a directory, as Docker leaves one: refused, with rmdir', () => {
    const file = join(tempDir(), 'userlist.txt');
    mkdirSync(file);
    const r = refuse(`PGBOUNCER_USERLIST=${file}\n`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`rmdir ${file}`);
  });

  it('a file: passes', () => {
    const file = join(tempDir(), 'userlist.txt');
    writeFileSync(file, userlistLine(PASSWORD));
    const r = refuse(`PGBOUNCER_USERLIST=${file}\n`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toBe('');
  });

  it('a shell that exports another value: refused', () => {
    const file = join(tempDir(), 'userlist.txt');
    writeFileSync(file, userlistLine(PASSWORD));
    const r = refuse('', { PGBOUNCER_USERLIST: file });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('unset PGBOUNCER_USERLIST');
  });

  it("live's default is left as it was, even with its file missing", () => {
    const r = refuse('OTHER=1\n');
    expect(r.status, r.out).toBe(0);
    expect(existsSync(join(r.dir, 'pgbouncer'))).toBe(false);
  });

  it("the data phase's mode repair follows the same file", () => {
    const at = BOOTSTRAP.indexOf('\nphase_data() {');
    const phase = BOOTSTRAP.slice(at + 1, BOOTSTRAP.indexOf('\n}\n', at) + 3);
    expect(code(phase).some((l) => l.includes('pgbouncer_userlist "$SCRIPT_DIR"'))).toBe(true);
    expect(code(phase).filter((l) => l.includes('pgbouncer/userlist.txt'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The runbook
// ---------------------------------------------------------------------------

describe('the runbook no longer asks the owner to copy the userlist', () => {
  const doc = readFileSync(join(REPO_ROOT, 'docs/managed-bring-up.md'), 'utf8');

  it('no command copies a userlist into the persisted directory, and the key is explained', () => {
    expect(doc.split('\n').filter((l) => /^\s*cp\b[^\n]*userlist/.test(l))).toEqual([]);
    expect(doc).toContain('PGBOUNCER_USERLIST');
  });
});
