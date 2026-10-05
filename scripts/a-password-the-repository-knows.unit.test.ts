// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD THE REPOSITORY KNOWS (workplan 0132 T2).
 *
 * Every stack brought up from this repository got its database passwords from
 * values anybody can read here: compose's defaults in `managed.yml` for a key
 * `.env` leaves empty, the first migration's `app_password` for `app_user`, and
 * the `change-me-…` values `managed.env.example` used to ship. The owner
 * changed the OTA stack's on 2026-10-05 (`rotate-db-passwords.sh --rotate
 * --with-trigger-stores`, T0 step 2). What is held here is that nothing in the
 * repository puts them back, and that the bring-up stops on them where they
 * cost something.
 *
 * TRIGGER-DB, THE FIRST AND SMALLEST PART (built 2026-09-28). `trigger-db`'s
 * password was a literal in `managed.yml` that no `.env` could reach. It is
 * `TRIGGER_DB_PASSWORD` now, read by `trigger-db`'s `POSTGRES_PASSWORD` and
 * `trigger-api`'s `DATABASE_URL` and `DIRECT_URL`, with today's literal as the
 * fallback: the OTA stack's `trigger_db_data` volume was initialised with it,
 * and Postgres keeps the password a role was created with. Were the fallback
 * anything else, or the key required, the next gate run would recreate
 * `trigger-api` with a password its own database refuses. For the same
 * reason `ensure-env-secrets.sh`, which the gate runs every night, never
 * writes it; `stand-up-live.sh` sets it on live's new volume. It is NOT
 * refused yet, on purpose (the session's scope decision of 2026-10-05): the
 * OTA stack's volume still holds the literal, and a refusal would stop the
 * nightly gate. Step A (0132 T2, 2026-10-05) taught
 * `rotate-db-passwords.sh --rotate --with-trigger-stores` to change it, held
 * by `rotate-db-passwords.unit.test.ts`. Step B follows the owner's run of
 * that on the OTA stack: then it is required and refused like the four below,
 * and the cases here that hold it apart change with it.
 *
 * THE REST OF T2 (built 2026-10-05). For `POSTGRES_PASSWORD`,
 * `APP_DB_PASSWORD`, `CLICKHOUSE_PASSWORD` and `MINIO_ROOT_PASSWORD`:
 *
 *   ONE LIST. `deploy/compose/shipped-passwords.sh` names the values once:
 *   the three Postgres values, ClickHouse's two and MinIO's two that
 *   `rotate-db-passwords.sh --check` tries, and trigger-db's literal. Each
 *   compose default and the migration's literal are read from their own files
 *   here and must be in it; the scripts that judge a value source it and
 *   spell none themselves.
 *   (a) A REAL ADDRESS REFUSES THEM. With `WEB_URL` https and not localhost
 *   (the test `note_mail_goes_nowhere_real` makes), every phase from `data`
 *   on stops in `load_env`, before any docker call, when one of the four is
 *   empty (compose's default then applies), a `change-me…` value or one on
 *   the list. The refusal names each key and never a value, and points to
 *   `rotate-db-passwords.sh` and "Changing the database passwords".
 *   (b) LOCALHOST ONLY NOTES. A developer's own stack is where the shipped
 *   values are right (D4, `--accept-defaults`): the phase goes on and says
 *   which keys.
 *   (c) THE DATA PHASE MAKES BOTH ROLES MATCH .env, ON EVERY RUN. Once
 *   postgres is healthy and before anything migrates, it creates `app_user`
 *   from `APP_DB_PASSWORD` when the role does not exist (0001 creates it only
 *   then, with `app_password`), sets its password when it does, and sets the
 *   owner's, in one transaction over the socket as the owner. Then, with the
 *   pooler up, it proves both over the stack's network and through PgBouncer.
 *   Every value reaches its container by name (`-e NAME`, and for
 *   `setup-auth.sql` the session setting `PGOPTIONS`), never on a command line
 *   and never in the SQL text a container is given. The `docker` stub records
 *   every argv and every stdin, and keeps each role's password. A value is
 *   read as Compose reads it (`KEY="…"` without its quotes), and one a URL
 *   does not carry is refused before either role changes.
 *   NO XTRACE. The bring-up and `ensure-env-secrets.sh` refuse it before they
 *   read `.env`. No 8 characters of a value appear in any output, argv or
 *   stdin, not only the whole value.
 *   ON LIVE the refusal names live's own way to change them (0132 T2 steps 3
 *   and 4, within live's hold), since `rotate-db-passwords.sh` only checks
 *   there.
 *   (d) `ensure-env-secrets.sh` GENERATES THE FOUR on a stack whose volume
 *   for the key does not exist yet, and replaces a shipped value there. Once
 *   the volume exists it writes nothing for that key and says why: Postgres
 *   keeps the password it was initialised with, and ClickHouse and MinIO take
 *   a new one only when the stores and trigger-api are recreated together
 *   (`rotate-db-passwords.sh --rotate --with-trigger-stores`). A value that
 *   is not shipped is never overwritten, and docker is not even asked. The
 *   gate's Fill step, run here on an `.env` like the OTA stack's after the
 *   owner's rotation, changes none of the four.
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
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const MANAGED = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
const EXAMPLE = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readIf = (rel: string): string => (existsSync(join(REPO_ROOT, rel)) ? read(rel) : '');

/** The literal the OTA stack's trigger_db_data volume was initialised with. */
const TODAYS_LITERAL = 'trigger_password';
const KEY = 'TRIGGER_DB_PASSWORD';
const READ = `\${${KEY}:-${TODAYS_LITERAL}}`;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
};

interface Service {
  environment?: Record<string, unknown>;
}
const compose = parseYaml(MANAGED) as { services: Record<string, Service> };

/** The three values that carry trigger-db's password, as written in managed.yml. */
const carriers = (): Record<string, string> => ({
  'trigger-db POSTGRES_PASSWORD': String(compose.services['trigger-db']?.environment?.POSTGRES_PASSWORD ?? ''),
  'trigger-api DATABASE_URL': String(compose.services['trigger-api']?.environment?.DATABASE_URL ?? ''),
  'trigger-api DIRECT_URL': String(compose.services['trigger-api']?.environment?.DIRECT_URL ?? ''),
});

/** Compose's `${NAME:-default}` for this one variable: set and non-empty wins. */
const render = (text: string, value: string | undefined): string =>
  text.replaceAll(READ, value === undefined || value === '' ? TODAYS_LITERAL : value);

// ---------------------------------------------------------------------------
// The four keys, and what was shipped for them
// ---------------------------------------------------------------------------

/** The four keys the bring-up refuses and ensure-env-secrets.sh generates, each with the volume whose existence ends that. */
const FOUR: Array<[string, string]> = [
  ['POSTGRES_PASSWORD', 'postgres_data'],
  ['APP_DB_PASSWORD', 'postgres_data'],
  ['CLICKHOUSE_PASSWORD', 'clickhouse_data_v2'],
  ['MINIO_ROOT_PASSWORD', 'minio_data'],
];
const FOUR_KEYS = FOUR.map(([k]) => k);

/** Compose's default for a key, read from managed.yml itself: what an empty key gives a container. */
const composeDefault = (key: string): string => {
  const m = new RegExp(`\\$\\{${key}:-([^}]*)\\}`).exec(MANAGED);
  return m?.[1] ?? '';
};
/** The first migration's password for app_user, read from the migration. */
const MIGRATION_LITERAL = /CREATE ROLE app_user LOGIN PASSWORD '([^']+)'/.exec(
  read('packages/ledger/migrations/0001_baseline.sql'),
)?.[1];
/** What managed.env.example shipped for the four until 2026-10-05; a .env copied from it may hold them still. */
const OLD_EXAMPLE = ['change-me-openmigrate', 'app_password', 'change-me-clickhouse', 'change-me-minio'];
/** Every value this repository publishes for one of the four, from its own files. */
const SHIPPED = [...new Set([...FOUR_KEYS.map(composeDefault), MIGRATION_LITERAL ?? '', ...OLD_EXAMPLE])].filter(Boolean);

/** Values the cases give a stack: none is shipped, each is distinctive enough to find in any output. */
const OWNER_PW = '0a11ce'.repeat(8);
const APP_PW = '0b0b0e'.repeat(8);
const CH_PW = '0c1c1e'.repeat(8);
const MINIO_PW = '0d1d1e'.repeat(8);
const PGB_PW = '0e1e1f'.repeat(8);
const GOOD: Record<string, string> = {
  POSTGRES_PASSWORD: OWNER_PW,
  APP_DB_PASSWORD: APP_PW,
  CLICKHOUSE_PASSWORD: CH_PW,
  MINIO_ROOT_PASSWORD: MINIO_PW,
};

/**
 * True when `text` shows `value` as a value. Most shipped values are words
 * no sentence uses; `password` is one every sentence about them uses, so for
 * it only an assignment or a quoted form counts.
 */
const shows = (text: string, value: string): boolean =>
  value === 'password'
    ? /(=|: )password\b|'password'|"password"/.test(text)
    : text.includes(value);

/**
 * True when `text` holds any 8 characters of a value nobody published: part
 * of a password printed is as bad as all of it. Every window is tried, so an
 * offset into the value is caught as well as its start.
 */
const showsAPiece = (text: string, value: string): boolean => {
  for (let i = 0; i + 8 <= value.length; i++) if (text.includes(value.slice(i, i + 8))) return true;
  return false;
};

// ---------------------------------------------------------------------------
// The stubs
// ---------------------------------------------------------------------------

interface Role {
  pw: string;
  login: boolean;
  super: boolean;
}
interface StubState {
  roles: Record<string, Role>;
  volumes: string[];
  /** docker answers nothing: a daemon that is not running. */
  daemonDown: boolean;
  /** The roles statement fails, as a catalog write would. */
  failRoles: boolean;
  /** Roles the pooler refuses whatever they present. */
  poolerRefuses: string[];
}
interface Call {
  kind: string;
  argv: string[];
  stdin?: string;
  sql?: string;
  user?: string;
  host?: string;
  network?: string;
  services?: string[];
  /** What the container was given by `-e NAME` (from this process's environment). */
  env?: Record<string, string>;
  /** Every `-e NAME=value`: a value on the command line. */
  inline?: string[];
  v?: Record<string, string>;
}

/**
 * `docker`, as a node script: it records every call (argv, and stdin where a
 * psql reads it), answers the volume listing, and keeps a small database in a
 * state file. A password question over the stack's network or the pooler is
 * answered from it. The roles statement is applied from the psql variables it
 * names, each read from the environment the container was given by name, and
 * only when it is one transaction kept out of the database's log.
 */
const DOCKER_STUB = `#!${process.execPath}
'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.STUB_STATE, 'utf8'));
const save = () => fs.writeFileSync(process.env.STUB_STATE, JSON.stringify(state));
const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);
const done = (c) => process.exit(c);
const readIn = () => { try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; } };
const log = (entry) => fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(Object.assign({ argv: argv }, entry)) + NL);
function byName(names) {
  const env = {}; const inline = [];
  for (const n of names) {
    const k = n.indexOf('=');
    if (k >= 0) { inline.push(n); env[n.slice(0, k)] = n.slice(k + 1); }
    else if (n in process.env) env[n] = process.env[n];
  }
  return { env: env, inline: inline };
}
const FLAGC = new RegExp('^-[A-Za-z]*c$');
function psqlArgs(a) {
  const o = { v: {} };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-h') o.h = a[++i];
    else if (x === '-p') o.p = a[++i];
    else if (x === '-U') o.U = a[++i];
    else if (x === '-d') o.d = a[++i];
    else if (x === '-f') o.f = a[++i];
    else if (x === '-F') i++;
    else if (x === '-v') { const s = a[++i]; const k = s.indexOf('='); o.v[s.slice(0, k)] = s.slice(k + 1); }
    else if (FLAGC.test(x)) o.c = a[++i];
  }
  return o;
}
function refused(user) {
  err('psql: error: connection to server failed: FATAL:  password authentication failed for user "' + user + '"' + NL);
  return 2;
}
function ask(user, pw) {
  const r = state.roles[user];
  if (r && r.login && pw && r.pw === pw) { out('1' + NL); return 0; }
  return refused(user);
}

if (argv[0] === 'volume') {
  log({ kind: 'volume' });
  if (state.daemonDown) { err('Cannot connect to the Docker daemon. Is the docker daemon running?' + NL); done(1); }
  if (argv[1] === 'ls') {
    let want = '';
    for (let i = 2; i < argv.length; i++) if (argv[i] === '--filter' || argv[i] === '-f') { const f = argv[++i]; if (f.startsWith('name=')) want = f.slice(5); }
    for (const v of state.volumes) if (v.indexOf(want) >= 0) out(v + NL);
    done(0);
  }
  if (argv[1] === 'inspect') done(state.volumes.indexOf(argv[argv.length - 1]) >= 0 ? 0 : 1);
  done(0);
}
if (state.daemonDown) { log({ kind: 'down' }); err('Cannot connect to the Docker daemon.' + NL); done(1); }

if (argv[0] === 'run') {
  let i = 1; const names = []; let network = '';
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rm' || a === '-i') continue;
    if (a === '-e') { names.push(argv[++i]); continue; }
    if (a === '--network') { network = argv[++i]; continue; }
    break;
  }
  const image = argv[i]; const p = psqlArgs(argv.slice(i + 2)); const e = byName(names);
  log({ kind: 'network', network: network, image: image, user: p.U, host: p.h, env: e.env, inline: e.inline });
  if (p.h !== 'postgres') { err('psql: error: could not translate host name' + NL); done(2); }
  done(ask(p.U, e.env.PGPASSWORD));
}

if (argv[0] !== 'compose') { log({ kind: 'other' }); done(0); }
let i = 1;
for (; i < argv.length; i++) { if (argv[i] === '-f' || argv[i] === '--env-file' || argv[i] === '-p') { i++; continue; } break; }
const sub = argv[i]; const rest = argv.slice(i + 1);
if (sub === 'config' || sub === 'version') { log({ kind: 'config' }); done(0); }
if (sub === 'up') { log({ kind: 'up', services: rest.filter((x) => !x.startsWith('-')) }); done(0); }
if (sub === 'ps') { log({ kind: 'ps' }); out('healthy' + NL); done(0); }
if (sub !== 'exec') { log({ kind: 'compose-' + sub }); done(0); }

let j = 0; const names = [];
for (; j < rest.length; j++) { if (rest[j] === '-T') continue; if (rest[j] === '-e') { names.push(rest[++j]); continue; } break; }
const svc = rest[j]; const cmd = rest.slice(j + 1); const e = byName(names); const p = psqlArgs(cmd.slice(1));

if (svc === 'pgbouncer' && cmd[0] === 'psql') {
  log({ kind: 'pooler', user: p.U, host: p.h, env: e.env, inline: e.inline });
  if (p.p !== '6432') { err('docker stub: the pooler asked off its own port' + NL); done(94); }
  if ((state.poolerRefuses || []).indexOf(p.U) >= 0) done(refused(p.U));
  done(ask(p.U, e.env.PGPASSWORD));
}
if (svc !== 'postgres' || cmd[0] !== 'psql') { log({ kind: 'exec-other', env: e.env, inline: e.inline }); done(0); }

if (p.c !== undefined) {
  log({ kind: 'socket-c', sql: p.c, user: p.U, env: e.env, inline: e.inline });
  if (p.c.indexOf('pg_roles') >= 0) {
    for (const name of Object.keys(state.roles).sort()) { const r = state.roles[name]; if (r.login) out(name + '|' + (r.super ? 't' : 'f') + '|t' + NL); }
  }
  done(0);
}
const sql = readIn();
if (p.f === '-') { log({ kind: 'setup-auth', stdin: sql, user: p.U, env: e.env, inline: e.inline }); done(0); }
if (sql.indexOf('ROLE :"') < 0) { log({ kind: 'socket-other', stdin: sql, user: p.U, env: e.env, inline: e.inline }); done(0); }

log({ kind: 'roles', stdin: sql, user: p.U, v: p.v, env: e.env, inline: e.inline });
if (!state.roles[p.U]) { err('psql: error: connection to server on socket failed: FATAL:  role "' + p.U + '" does not exist' + NL); done(2); }
const lines = sql.split(NL).map((l) => l.trim());
if (lines.indexOf('SET log_min_error_statement = panic;') < 0 || lines.indexOf('BEGIN;') < 0 || lines.indexOf('COMMIT;') < 0) {
  err('docker stub: the roles statement is not one transaction kept out of the log' + NL); done(95);
}
if (state.failRoles) { err('psql:<stdin>:9: ERROR:  could not write to the catalog (the failure this case asked for)' + NL); done(3); }
const vars = Object.assign({}, p.v); const conds = []; const changes = [];
for (const line of lines) {
  if (line === BS + 'else') { conds[conds.length - 1] = !conds[conds.length - 1]; continue; }
  if (line === BS + 'endif') { conds.pop(); continue; }
  if (line.startsWith(BS + 'if ')) { const name = line.slice(4).trim().replace(':', ''); conds.push(['t', 'true', 'on', '1', 'yes'].indexOf(String(vars[name])) >= 0); continue; }
  if (!conds.every((c) => c)) continue;
  if (line.startsWith(BS + 'set ')) {
    const name = line.split(' ')[1]; const a = line.indexOf('"$'); const b = line.lastIndexOf('"');
    vars[name] = a >= 0 && b > a ? (e.env[line.slice(a + 2, b)] || '') : '';
    continue;
  }
  if (line.indexOf('FROM pg_roles WHERE rolname = :') >= 0 && line.endsWith(BS + 'gset')) {
    const q = line.indexOf(":'") + 2; const name = line.slice(q, line.indexOf("'", q));
    const target = line.slice(line.indexOf(' AS ') + 4).split(' ')[0];
    const exists = Boolean(state.roles[vars[name]]);
    vars[target] = line.indexOf('NOT EXISTS') >= 0 ? (exists ? 'f' : 't') : (exists ? 't' : 'f');
    continue;
  }
  const create = line.startsWith('CREATE ROLE :"'); const alter = line.startsWith('ALTER ROLE :"');
  if (create || alter) {
    const a = line.indexOf(':"') + 2; const role = vars[line.slice(a, line.indexOf('"', a))];
    const q = line.indexOf(":'") + 2; const pw = vars[line.slice(q, line.indexOf("'", q))];
    changes.push({ create: create, role: role, pw: pw, login: line.indexOf(' LOGIN ') >= 0 });
  }
}
for (const c of changes) {
  if (!c.pw) { err('ERROR:  an empty password' + NL); done(3); }
  if (c.create && state.roles[c.role]) { err('ERROR:  role "' + c.role + '" already exists' + NL); done(3); }
  if (!c.create && !state.roles[c.role]) { err('ERROR:  role "' + c.role + '" does not exist' + NL); done(3); }
}
for (const c of changes) {
  if (c.create) state.roles[c.role] = { pw: c.pw, login: c.login, super: false };
  else state.roles[c.role].pw = c.pw;
}
save();
done(0);
`;

/** env-upsert.sh, wrapped: its argv recorded, then the real one run with the same stdin. */
const UPSERT_WRAPPER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"$UPSERT_LOG"
exec "$(dirname "$0")/env-upsert.real.sh" "$@"
`;

interface Stack {
  root: string;
  compose: string;
  envFile: string;
  statePath: string;
  logPath: string;
  upsertLog: string;
  env: NodeJS.ProcessEnv;
}

/** `.env` text: a key mapped to null is left out. */
const envText = (env: Record<string, string | null>): string =>
  `${Object.entries(env)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;

/**
 * A checkout of its own: every script in deploy/compose (so a helper a
 * script sources is there whatever its name), managed.yml, the example, the
 * pooler's files, and stubs on the PATH.
 */
function aStack(dotEnv: string, state: Partial<StubState> = {}): Stack {
  const root = tempDir('a-password-');
  const composeDir = join(root, 'deploy', 'compose');
  mkdirSync(join(composeDir, 'pgbouncer'), { recursive: true });
  for (const f of readdirSync(COMPOSE_DIR).filter((x) => x.endsWith('.sh'))) {
    copyFileSync(join(COMPOSE_DIR, f), join(composeDir, f));
    chmodSync(join(composeDir, f), 0o755);
  }
  for (const f of ['managed.yml', 'managed.env.example']) copyFileSync(join(COMPOSE_DIR, f), join(composeDir, f));
  for (const f of ['pgbouncer.ini', 'setup-auth.sql']) {
    copyFileSync(join(COMPOSE_DIR, 'pgbouncer', f), join(composeDir, 'pgbouncer', f));
  }
  copyFileSync(join(COMPOSE_DIR, 'env-upsert.sh'), join(composeDir, 'env-upsert.real.sh'));
  chmodSync(join(composeDir, 'env-upsert.real.sh'), 0o755);
  writeFileSync(join(composeDir, 'env-upsert.sh'), UPSERT_WRAPPER, { mode: 0o755 });
  const envFile = join(composeDir, '.env');
  writeFileSync(envFile, dotEnv, { mode: 0o600 });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), DOCKER_STUB, { mode: 0o755 });
  const statePath = join(root, 'state.json');
  const full: StubState = {
    roles: {
      pgowner: { pw: OWNER_PW, login: true, super: true },
      pgbouncer_auth: { pw: PGB_PW, login: true, super: false },
    },
    volumes: [],
    daemonDown: false,
    failRoles: false,
    poolerRefuses: [],
    ...state,
  };
  writeFileSync(statePath, JSON.stringify(full));
  const logPath = join(root, 'calls.jsonl');
  const upsertLog = join(root, 'upsert.log');
  writeFileSync(logPath, '');
  writeFileSync(upsertLog, '');
  const home = join(root, 'home');
  mkdirSync(home);
  return {
    root,
    compose: composeDir,
    envFile,
    statePath,
    logPath,
    upsertLog,
    env: {
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      LANG: 'C',
      STUB_STATE: statePath,
      STUB_LOG: logPath,
      UPSERT_LOG: upsertLog,
    },
  };
}

const callsOf = (s: Stack): Call[] =>
  readFileSync(s.logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Call);
const stateOf = (s: Stack): StubState => JSON.parse(readFileSync(s.statePath, 'utf8')) as StubState;

/** The .env of a stack at a real address, with values nobody published. */
const realEnv = (over: Record<string, string | null> = {}): Record<string, string | null> => ({
  WEB_URL: 'https://app.example.test',
  POSTGRES_USER: 'pgowner',
  POSTGRES_DB: 'openmigrate',
  APP_DB_USER: 'app_user',
  ...GOOD,
  PGBOUNCER_AUTH_PASSWORD: PGB_PW,
  ...over,
});

function bootstrap(s: Stack, args: string[]): { status: number; out: string; calls: Call[] } {
  const r = spawnSync(join(s.compose, 'bootstrap-managed.sh'), args, {
    encoding: 'utf8',
    env: s.env,
    cwd: s.root,
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, calls: callsOf(s) };
}

const CASE_MS = 60_000;

/** A script's code, without its comment lines. */
const codeOf = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

// ---------------------------------------------------------------------------
// trigger-db: the first half, built 2026-09-28
// ---------------------------------------------------------------------------

describe("managed.yml reads trigger-db's password from .env, and falls back to today's literal", () => {
  it('found the three places that carry it', () => {
    for (const [where, text] of Object.entries(carriers())) {
      expect(text, `${where} is missing from managed.yml`).not.toBe('');
    }
  });

  it('has no bare literal: every trigger_password is the fallback of the variable', () => {
    const bare = MANAGED.split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => line.split(READ).join('').includes(TODAYS_LITERAL))
      .map(({ n, line }) => `managed.yml:${n}: ${line.trim()}`);
    expect(bare, `write ${READ}: a literal is a password no .env can change`).toEqual([]);
  });

  it('each of the three reads the variable', () => {
    for (const [where, text] of Object.entries(carriers())) {
      expect(text, where).toContain(READ);
    }
  });

  it("the fallback is today's literal, so a stack that sets nothing renders what it rendered before", () => {
    // The OTA stack's volume keeps `trigger_password`; its .env sets no key.
    const fallbacks = [...MANAGED.matchAll(new RegExp(`\\$\\{${KEY}:-([^}]*)\\}`, 'g'))].map((m) => m[1]);
    expect(fallbacks.length).toBe(3);
    expect(new Set(fallbacks)).toEqual(new Set([TODAYS_LITERAL]));
    const c = carriers();
    expect(render(c['trigger-db POSTGRES_PASSWORD']!, undefined)).toBe(TODAYS_LITERAL);
    for (const url of [c['trigger-api DATABASE_URL']!, c['trigger-api DIRECT_URL']!]) {
      expect(render(url, undefined)).toBe(`postgresql://trigger:${TODAYS_LITERAL}@trigger-db:5432/triggerdb`);
      expect(render(url, '')).toBe(`postgresql://trigger:${TODAYS_LITERAL}@trigger-db:5432/triggerdb`);
    }
  });

  it('a stack that sets it gets the same value in the database and in both URLs', () => {
    const value = 'c0ffee'.repeat(8);
    const c = carriers();
    expect(render(c['trigger-db POSTGRES_PASSWORD']!, value)).toBe(value);
    expect(render(c['trigger-api DATABASE_URL']!, value)).toBe(`postgresql://trigger:${value}@trigger-db:5432/triggerdb`);
    expect(render(c['trigger-api DIRECT_URL']!, value)).toBe(`postgresql://trigger:${value}@trigger-db:5432/triggerdb`);
  });

  it('managed.env.example names the key, empty, with its note on a line of its own', () => {
    const lines = EXAMPLE.split('\n');
    const at = lines.findIndex((l) => l.startsWith(`${KEY}=`));
    expect(at, `${KEY} is not in managed.env.example`).toBeGreaterThan(-1);
    expect(lines[at]).toBe(`${KEY}=`);
    const note = lines.slice(Math.max(0, at - 20), at).join('\n');
    expect(note).toMatch(/stand-up-live\.sh/);
    expect(note).toMatch(/ensure-env-secrets\.sh/);
  });
});

describe('ensure-env-secrets.sh never writes TRIGGER_DB_PASSWORD', () => {
  /** A checkout with every script, and a docker that reports the stack's volumes. */
  function checkout(dotEnv: string, volumes: string[]) {
    const s = aStack(dotEnv, { volumes });
    const r = spawnSync(join(s.compose, 'ensure-env-secrets.sh'), [], { encoding: 'utf8', env: s.env, cwd: s.root });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, env: readFileSync(s.envFile, 'utf8') };
  }

  const keyValue = (env: string): string | undefined =>
    env
      .split('\n')
      .filter((l) => l.startsWith(`${KEY}=`))
      .map((l) => l.slice(KEY.length + 1))
      .at(-1);

  it("leaves it unset on a stack whose trigger_db_data volume exists (the OTA stack's case)", () => {
    const r = checkout('JWT_SECRET=\n', ['ownpace-managed_trigger_db_data', 'ownpace-managed_postgres_data']);
    expect(r.status, r.out).toBe(0);
    // It did run: the secrets it does know were generated.
    expect(r.env).toMatch(/^JWT_SECRET=[0-9a-f]{64}$/m);
    expect(keyValue(r.env)).toBeUndefined();
    expect(r.out).not.toContain(KEY);
  });

  it('leaves an empty line empty, volume or not', () => {
    for (const volumes of [['ownpace-managed_trigger_db_data'], []]) {
      const r = checkout(`JWT_SECRET=\n${KEY}=\n`, volumes);
      expect(r.status, r.out).toBe(0);
      expect(keyValue(r.env)).toBe('');
    }
  });

  it('does not generate it on a stack with no volume either: stand-up-live.sh is the one writer', () => {
    const r = checkout('JWT_SECRET=\n', []);
    expect(r.status, r.out).toBe(0);
    expect(keyValue(r.env)).toBeUndefined();
  });

  it("leaves the OTA stack's literal alone when a .env carries it", () => {
    const r = checkout(`JWT_SECRET=\n${KEY}=${TODAYS_LITERAL}\n`, ['ownpace-managed_trigger_db_data']);
    expect(r.status, r.out).toBe(0);
    expect(keyValue(r.env)).toBe(TODAYS_LITERAL);
  });

  it('is not refused by the bring-up yet: the OTA stack still holds the literal (split off, 2026-10-05)', () => {
    // A real address, the four set, and TRIGGER_DB_PASSWORD absent: what the OTA stack's .env holds now.
    const s = aStack(envText(realEnv()), { roles: { pgowner: { pw: OWNER_PW, login: true, super: true } } });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain(KEY);
  });
});

// ---------------------------------------------------------------------------
// One list
// ---------------------------------------------------------------------------

describe('the shipped values are named once', () => {
  const LIST = readIf('deploy/compose/shipped-passwords.sh');
  const code = codeOf;

  it('deploy/compose/shipped-passwords.sh holds them', () => {
    expect(LIST, 'deploy/compose/shipped-passwords.sh is missing').not.toBe('');
  });

  it("holds every compose default for the four, the migration's literal, the old example's values and trigger-db's", () => {
    expect(MIGRATION_LITERAL, "0001_baseline.sql's app_user password was not found").toBeTruthy();
    for (const key of FOUR_KEYS) expect(composeDefault(key), `managed.yml's default for ${key}`).not.toBe('');
    for (const value of [...SHIPPED, TODAYS_LITERAL]) {
      expect(code(LIST), `shipped-passwords.sh does not list ${value}`).toMatch(new RegExp(`(^|[\\s('"=])${value}([\\s)'"]|$)`, 'm'));
    }
  });

  it('names the four keys, each with its volume', () => {
    for (const [key, volume] of FOUR) expect(code(LIST)).toContain(`${key} ${volume}`);
    expect(code(LIST), 'TRIGGER_DB_PASSWORD is split off: not refused, not generated, until the OTA stack is rotated').not.toMatch(
      /TRIGGER_DB_PASSWORD trigger_db_data/,
    );
  });

  it.each(['rotate-db-passwords.sh', 'bootstrap-managed.sh', 'ensure-env-secrets.sh', 'stand-up-live.sh'])(
    '%s sources it and spells no shipped value itself',
    (script) => {
      const text = read(`deploy/compose/${script}`);
      expect(text).toMatch(/\. "\$\{SCRIPT_DIR\}\/shipped-passwords\.sh"/);
      for (const value of [...SHIPPED.filter((v) => v !== 'password'), TODAYS_LITERAL]) {
        expect(code(text), `${script} spells ${value}`).not.toMatch(new RegExp(`(^|[^A-Za-z0-9_-])${value}([^A-Za-z0-9_-]|$)`, 'm'));
      }
    },
  );
});

// ---------------------------------------------------------------------------
// (a) A real address refuses them
// ---------------------------------------------------------------------------

describe('(a) on a real address, a shipped database password stops every phase from data on, naming the key and no value', () => {
  /** [label, the line's value: null leaves the key out] */
  const forms = (key: string): Array<[string, string | null]> => [
    ['absent', null],
    ['empty', ''],
    ['a change-me value', 'change-me-q7'],
    ['empty double quotes', '""'],
    ...SHIPPED.map((v): [string, string] => [`the published ${v}`, v]),
    [`compose's default for ${key}, quoted`, `"${composeDefault(key)}"`],
  ];

  it.each(FOUR_KEYS)(
    '%s',
    (key) => {
      for (const [label, value] of forms(key)) {
        const s = aStack(envText(realEnv({ [key]: value })));
        const r = bootstrap(s, ['--only', 'data']);
        const what = `${key} ${label}`;
        expect(r.status, `${what}:\n${r.out}`).toBe(1);
        expect(r.out, what).toContain(key);
        for (const other of FOUR_KEYS.filter((k) => k !== key)) {
          expect(r.out, `${what}: ${other} holds a value nobody published, and was named`).not.toMatch(new RegExp(`\\b${other}\\b`));
        }
        const bare = value?.replace(/^"|"$/g, '') ?? '';
        if (bare) expect(shows(r.out, bare), `${what}: the value was printed`).toBe(false);
        for (const v of [...FOUR_KEYS.filter((k) => k !== key).map((k) => GOOD[k]!), PGB_PW]) {
          expect(showsAPiece(r.out, v), `${what}: part of a value nobody published was printed`).toBe(false);
        }
        expect(r.out, what).toContain('rotate-db-passwords.sh');
        expect(r.out, what).toContain('Changing the database passwords');
        expect(r.calls, `${what}: docker was called before the refusal`).toEqual([]);
        expect(r.out, `${what}: postgres was started`).not.toMatch(/postgres healthy/);
      }
    },
    CASE_MS,
  );

  it("names all four at once, and the gate's own command stops the same way", () => {
    const all = Object.fromEntries(FOUR_KEYS.map((k) => [k, composeDefault(k)]));
    for (const args of [
      ['--from', 'data', '--with-demo', '--no-smoke'],
      ['--only', 'data'],
      ['--only', 'app'],
      ['--only', 'tasks'],
    ]) {
      const s = aStack(envText(realEnv(all)));
      const r = bootstrap(s, args);
      expect(r.status, `${args.join(' ')}:\n${r.out}`).toBe(1);
      for (const key of FOUR_KEYS) expect(r.out, args.join(' ')).toContain(key);
      for (const value of Object.values(all)) expect(shows(r.out, value), `${args.join(' ')} printed ${value}`).toBe(false);
      expect(r.calls, `${args.join(' ')}: docker was called before the refusal`).toEqual([]);
    }
  });

  it('an application role renamed away from app_user is refused there too: 0001 would make app_user with its published password', () => {
    const s = aStack(envText(realEnv({ APP_DB_USER: 'tenant_rw' })));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('APP_DB_USER');
    expect(r.out).toMatch(/0132 T2,? step 5/);
    expect(r.calls).toEqual([]);
  });

  it("on live the way out is live's own: --rotate refuses live, so the refusal names 0132 T2 steps 3 and 4, by hand, within live's hold", () => {
    const s = aStack(envText(realEnv({ COMPOSE_PROJECT_NAME: 'ownpace-live', STACK_KIND: 'production', APP_DB_PASSWORD: '' })));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('APP_DB_PASSWORD');
    expect(r.out, 'advice --rotate refuses on live').not.toMatch(/--rotate/);
    expect(r.out).toMatch(/0132 T2 steps 3 and 4/);
    expect(r.out).toMatch(/hold \(T6\)/);
    expect(r.out).toContain('rotate-db-passwords.sh --check');
    for (const v of [OWNER_PW, CH_PW, MINIO_PW, PGB_PW]) expect(showsAPiece(r.out, v)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it('the refusal is in load_env, which every phase from data on passes through, and a real address is the mail note’s test', () => {
    const script = read('deploy/compose/bootstrap-managed.sh');
    const body = (name: string): string => {
      const at = script.indexOf(`\n${name}() {`);
      return at < 0 ? '' : script.slice(at, script.indexOf('\n}\n', at) + 3);
    };
    expect(body('load_env')).toMatch(/^\s+refuse_shipped_passwords$/m);
    for (const phase of ['data', 'demo', 'trigger', 'account', 'login', 'app', 'tasks', 'smoke']) {
      expect(body(`phase_${phase}`), `phase_${phase} does not pass through load_env`).toMatch(/^\s+load_env$/m);
    }
    expect(body('web_url_is_real'), 'no web_url_is_real').not.toBe('');
    expect(body('note_mail_goes_nowhere_real')).toContain('web_url_is_real');
    expect(body('refuse_shipped_passwords')).toContain('web_url_is_real');
  });
});

// ---------------------------------------------------------------------------
// (b) Localhost only notes
// ---------------------------------------------------------------------------

describe("(b) on localhost the data phase goes on, and says which keys are still the shipped ones", () => {
  it.each([
    ['http on localhost', 'http://localhost:3123'],
    ['https on localhost', 'https://localhost:3123'],
    // Plain http is no real address, as for the mail note: nothing a tester reaches is served so.
    ['http on a name', 'http://app.example.test'],
    ['no WEB_URL at all', null],
  ])('%s', (_label, web) => {
    const shipped = { POSTGRES_PASSWORD: '', APP_DB_PASSWORD: 'app_password', CLICKHOUSE_PASSWORD: 'change-me-clickhouse', MINIO_ROOT_PASSWORD: null };
    const s = aStack(envText(realEnv({ WEB_URL: web, ...shipped })), {
      roles: { pgowner: { pw: composeDefault('POSTGRES_PASSWORD'), login: true, super: true } },
    });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    for (const key of FOUR_KEYS) expect(r.out).toContain(key);
    expect(r.out).toMatch(/localhost/);
    for (const value of ['app_password', 'change-me-clickhouse', composeDefault('POSTGRES_PASSWORD')]) {
      expect(shows(r.out, value), `printed ${value}`).toBe(false);
    }
    expect(r.out).not.toMatch(/refused/i);
  });
});

// ---------------------------------------------------------------------------
// (c) The data phase makes both roles match .env, every value by name
// ---------------------------------------------------------------------------

describe('(c) the data phase sets both roles to .env, before anything migrates, and passes every value by name', () => {
  const VALUES = [OWNER_PW, APP_PW, CH_PW, MINIO_PW, PGB_PW];

  function nothingShown(r: { out: string; calls: Call[] }) {
    for (const v of VALUES) {
      expect(showsAPiece(r.out, v), 'a value, or part of one, in the output').toBe(false);
      for (const c of r.calls) {
        expect(showsAPiece(c.argv.join(' '), v), `a value, or part of one, on docker's command line: ${c.kind}`).toBe(false);
        expect(showsAPiece(c.stdin ?? '', v), `a value, or part of one, in the SQL text given to ${c.kind}`).toBe(false);
      }
    }
    for (const c of r.calls) expect(c.inline ?? [], `-e NAME=value in ${c.kind}`).toEqual([]);
  }

  it('creates app_user from APP_DB_PASSWORD when it does not exist, and sets the owner’s: a fresh stack', () => {
    const s = aStack(envText(realEnv()));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    const roles = stateOf(s).roles;
    expect(roles.app_user, 'app_user was not created').toBeDefined();
    expect(roles.app_user).toEqual({ pw: APP_PW, login: true, super: false });
    expect(roles.pgowner?.pw).toBe(OWNER_PW);
    nothingShown(r);
  });

  it('sets both when they hold other values: the shipped ones a stack was made with', () => {
    const s = aStack(envText(realEnv()), {
      roles: {
        pgowner: { pw: composeDefault('POSTGRES_PASSWORD'), login: true, super: true },
        app_user: { pw: MIGRATION_LITERAL ?? 'x', login: true, super: false },
        pgbouncer_auth: { pw: PGB_PW, login: true, super: false },
      },
    });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    const roles = stateOf(s).roles;
    expect(roles.app_user?.pw).toBe(APP_PW);
    expect(roles.pgowner?.pw).toBe(OWNER_PW);
    nothingShown(r);
  });

  it('over the socket as the owner, one transaction, once postgres is up and before the pooler, then proven where the stack connects', () => {
    const s = aStack(envText(realEnv()));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    const kinds = r.calls.map((c) => (c.kind === 'up' ? `up ${(c.services ?? []).join(' ')}` : c.kind));
    const roles = kinds.indexOf('roles');
    expect(roles, `no roles statement:\n${kinds.join('\n')}`).toBeGreaterThan(-1);
    expect(kinds.filter((k) => k === 'roles').length).toBe(1);
    expect(kinds.indexOf('up postgres')).toBeLessThan(roles);
    expect(roles, 'set after setup-auth.sql').toBeLessThan(kinds.indexOf('setup-auth'));
    expect(roles).toBeLessThan(kinds.indexOf('up pgbouncer'));
    const call = r.calls[roles]!;
    expect(call.user).toBe('pgowner');
    expect(call.host, 'asked over the network, not the socket').toBeUndefined();
    expect(call.v).toMatchObject({ owner_role: 'pgowner', app_role: 'app_user' });
    // Each value reached the container by name, from the environment.
    expect(Object.values(call.env ?? {})).toEqual(expect.arrayContaining([OWNER_PW, APP_PW]));
    // Proven over the stack's network and through the pooler, after the pooler is up.
    const pooler = kinds.indexOf('up pgbouncer');
    const asked = r.calls.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'network' || c.kind === 'pooler');
    for (const user of ['pgowner', 'app_user']) {
      for (const kind of ['network', 'pooler']) {
        const hit = asked.find(({ c }) => c.kind === kind && c.user === user);
        expect(hit, `${user} not asked ${kind === 'network' ? 'over the network' : 'through the pooler'}`).toBeDefined();
        expect(hit!.i).toBeGreaterThan(pooler);
        expect(hit!.c.env?.PGPASSWORD).toBe(user === 'pgowner' ? OWNER_PW : APP_PW);
      }
    }
    for (const { c } of asked.filter(({ c }) => c.kind === 'network')) expect(c.network).toBe('ownpace-managed_ownpace-network');
    expect(r.out).toMatch(/app_user/);
    nothingShown(r);
  });

  it("setup-auth.sql gets pgbouncer_auth's password as a session setting, PGOPTIONS passed by name", () => {
    const s = aStack(envText(realEnv()));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    const auth = r.calls.find((c) => c.kind === 'setup-auth');
    expect(auth, 'setup-auth.sql was not run').toBeDefined();
    expect(auth!.argv).toContain('PGOPTIONS');
    expect(auth!.env?.PGOPTIONS).toBe(`-c my.pw=${PGB_PW}`);
    nothingShown(r);
  });

  it('a failed statement stops the phase before the pooler, and prints no value', () => {
    const s = aStack(envText(realEnv()), { failRoles: true });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/app_user/);
    expect(r.calls.some((c) => c.kind === 'up' && (c.services ?? []).includes('pgbouncer')), 'the pooler came up').toBe(false);
    nothingShown(r);
  });

  it('a role that does not open where the stack connects stops the phase, naming the role and the channel', () => {
    const s = aStack(envText(realEnv()), { poolerRefuses: ['app_user'] });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/app_user[^\n]*pooler[^\n]*REFUSED/);
    nothingShown(r);
  });

  it('a double-quoted value is set as Compose reads it, without the quotes, and so are the role names', () => {
    const s = aStack(
      envText(
        realEnv({
          POSTGRES_USER: '"pgowner"',
          APP_DB_USER: '"app_user"',
          POSTGRES_PASSWORD: `"${OWNER_PW}"`,
          APP_DB_PASSWORD: `"${APP_PW}"`,
        }),
      ),
      {
        roles: {
          pgowner: { pw: composeDefault('POSTGRES_PASSWORD'), login: true, super: true },
          pgbouncer_auth: { pw: PGB_PW, login: true, super: false },
        },
      },
    );
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    const roles = stateOf(s).roles;
    expect(Object.keys(roles).sort()).toEqual(['app_user', 'pgbouncer_auth', 'pgowner']);
    expect(roles.pgowner?.pw, "the owner holds .env's value with its quotes, which no container presents").toBe(OWNER_PW);
    expect(roles.app_user?.pw, "app_user holds .env's value with its quotes, which no container presents").toBe(APP_PW);
    nothingShown(r);
  });

  it('on localhost `POSTGRES_PASSWORD=""` is empty, as Compose reads it: the owner gets the default the containers get', () => {
    const s = aStack(envText(realEnv({ WEB_URL: 'http://localhost:3123', POSTGRES_PASSWORD: '""' })));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(stateOf(s).roles.pgowner?.pw).toBe(composeDefault('POSTGRES_PASSWORD'));
  });

  it.each(['POSTGRES_PASSWORD', 'APP_DB_PASSWORD'])(
    '%s with a character a URL does not carry: refused before either role changes, naming the key and no value',
    (key) => {
      const s = aStack(envText(realEnv({ [key]: `${GOOD[key]}/${GOOD[key]}` })));
      const before = stateOf(s).roles;
      const r = bootstrap(s, ['--only', 'data']);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(key);
      expect(r.out).toMatch(/URL/);
      expect(r.calls.some((c) => c.kind === 'roles'), 'the roles statement ran').toBe(false);
      expect(stateOf(s).roles).toEqual(before);
      nothingShown(r);
    },
  );

  it('db-roles.sh is the one place the statement lives: the bring-up and rotate-db-passwords.sh --sync both call db_roles_set', () => {
    const boot = read('deploy/compose/bootstrap-managed.sh');
    const rotate = read('deploy/compose/rotate-db-passwords.sh');
    const helper = read('deploy/compose/db-roles.sh');
    expect(boot).toMatch(/db_roles_set "\$DB_ROLES_OWNER_PASSWORD" "\$DB_ROLES_APP_PASSWORD"/);
    expect(rotate).toMatch(/db_roles_set "\$DB_ROLES_OWNER_PASSWORD" "\$DB_ROLES_APP_PASSWORD"/);
    expect(codeOf(boot), 'the bring-up writes an ALTER ROLE of its own').not.toMatch(/ALTER ROLE/);
    expect(helper).toMatch(/CREATE ROLE :"app_role" LOGIN PASSWORD :'app_pw';/);
  });
});

// ---------------------------------------------------------------------------
// Nothing that handles them runs under xtrace
// ---------------------------------------------------------------------------

describe('the bring-up and ensure-env-secrets.sh refuse xtrace, which prints every value a command is given', () => {
  it.each([
    ['xtrace in SHELLOPTS', { SHELLOPTS: 'xtrace' }],
    ['BASH_XTRACEFD set', { BASH_XTRACEFD: '2' }],
  ])('%s: refused before .env is read, and no value printed', (_label, extra) => {
    for (const [script, args] of [
      ['bootstrap-managed.sh', ['--only', 'data']],
      ['ensure-env-secrets.sh', []],
    ] as Array<[string, string[]]>) {
      const s = aStack(envText(realEnv()));
      const r = spawnSync(join(s.compose, script), args, {
        encoding: 'utf8',
        env: { ...s.env, ...extra },
        cwd: s.root,
        timeout: 60_000,
      });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      expect(r.status, `${script}:\n${out}`).toBe(1);
      expect(out, script).toMatch(/xtrace/);
      for (const v of [...Object.values(GOOD), PGB_PW]) expect(showsAPiece(out, v), `${script} printed a value`).toBe(false);
      expect(callsOf(s), `${script}: docker was called`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// (d) ensure-env-secrets.sh
// ---------------------------------------------------------------------------

describe('(d) ensure-env-secrets.sh generates the four while their volumes do not exist, and never overwrites one', () => {
  function ensure(env: Record<string, string | null>, state: Partial<StubState> = {}) {
    const s = aStack(envText(env), state);
    const r = spawnSync(join(s.compose, 'ensure-env-secrets.sh'), [], { encoding: 'utf8', env: s.env, cwd: s.root });
    const text = readFileSync(s.envFile, 'utf8');
    const value = (key: string): string | undefined =>
      text
        .split('\n')
        .filter((l) => l.startsWith(`${key}=`))
        .map((l) => l.slice(key.length + 1))
        .at(-1);
    return {
      status: r.status ?? -1,
      out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      value,
      upserts: readFileSync(s.upsertLog, 'utf8'),
      calls: callsOf(s),
    };
  }
  const vol = (name: string) => `ownpace-managed_${name}`;
  const ALL_VOLUMES = [...new Set(FOUR.map(([, v]) => vol(v)))];

  it('a fresh stack: each absent key generated, 48 hex digits, distinct, and none on env-upsert.sh’s command line', () => {
    const r = ensure({ JWT_SECRET: '' });
    expect(r.status, r.out).toBe(0);
    const made = FOUR_KEYS.map((k) => r.value(k) ?? '');
    for (const [i, key] of FOUR_KEYS.entries()) {
      expect(made[i], key).toMatch(/^[0-9a-f]{48}$/);
      expect(r.out).toMatch(new RegExp(`generated ${key}\\b`));
    }
    expect(new Set(made).size).toBe(4);
    for (const v of made) {
      expect(showsAPiece(r.upserts, v), 'a generated password, or part of one, on env-upsert.sh’s argv').toBe(false);
      expect(showsAPiece(r.out, v), 'a generated password, or part of one, printed').toBe(false);
    }
  });

  it.each(SHIPPED.map((v) => [v]))('a fresh stack holding %s: replaced', (shipped) => {
    const r = ensure(Object.fromEntries(FOUR_KEYS.map((k) => [k, shipped])));
    expect(r.status, r.out).toBe(0);
    for (const key of FOUR_KEYS) {
      expect(r.value(key), key).toMatch(/^[0-9a-f]{48}$/);
      expect(r.out).toMatch(new RegExp(`REPLACED ${key}\\b`));
    }
    expect(shows(r.out, shipped)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['absent', null],
    ['change-me', 'change-me-openmigrate'],
    ['the migration’s', 'app_password'],
  ])('volumes that exist, %s: nothing written for the four, each named, with the way to change it', (_label, value) => {
    const env = Object.fromEntries(FOUR_KEYS.map((k) => [k, value]));
    const r = ensure(env, { volumes: ALL_VOLUMES });
    expect(r.status, r.out).toBe(0);
    for (const key of FOUR_KEYS) {
      expect(r.value(key), `${key} was written over a volume that exists`).toBe(value ?? undefined);
      expect(r.out).toContain(key);
    }
    expect(r.out).toContain('rotate-db-passwords.sh');
    expect(r.out).toContain('Changing the database passwords');
    if (value) expect(shows(r.out, value), 'the value was printed').toBe(false);
  });

  it('each key is judged by its own volume: postgres_data there, the stores new', () => {
    const r = ensure({ JWT_SECRET: '' }, { volumes: [vol('postgres_data')] });
    expect(r.status, r.out).toBe(0);
    expect(r.value('POSTGRES_PASSWORD')).toBeUndefined();
    expect(r.value('APP_DB_PASSWORD')).toBeUndefined();
    expect(r.value('CLICKHOUSE_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
    expect(r.value('MINIO_ROOT_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
  });

  it('a value nobody published is never overwritten, volume or not, and docker is not asked', () => {
    for (const volumes of [[], ALL_VOLUMES]) {
      const r = ensure({ ...GOOD, JWT_SECRET: '' }, { volumes });
      expect(r.status, r.out).toBe(0);
      for (const key of FOUR_KEYS) expect(r.value(key)).toBe(GOOD[key]);
      expect(r.calls.filter((c) => c.kind === 'volume'), 'docker was asked about volumes').toEqual([]);
      for (const key of FOUR_KEYS) expect(r.out).not.toMatch(new RegExp(`(generated|REPLACED) ${key}\\b`));
    }
  });

  it('a daemon that does not answer: nothing written for the four, and it says why', () => {
    const r = ensure({ JWT_SECRET: '' }, { daemonDown: true });
    expect(r.status, r.out).toBe(0);
    for (const key of FOUR_KEYS) expect(r.value(key), key).toBeUndefined();
    expect(r.out).toMatch(/docker/);
    expect(r.value('JWT_SECRET')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the gate's Fill step, on an .env like the OTA stack's after the owner's rotation, keeps the four", () => {
  interface Step {
    name?: string;
    run?: string;
  }
  const gate = parseYaml(read('.github/workflows/e2e-managed.yml')) as { jobs: Record<string, { steps: Step[] }> };
  const fill = Object.values(gate.jobs)
    .flatMap((j) => j.steps)
    .find((st) => st.name?.startsWith('Fill in everything the repo already knows how to supply'));

  it('runs, and changes none of them in the checkout or the persisted file, without asking docker', () => {
    expect(fill?.run, 'no Fill step in e2e-managed.yml').toBeTruthy();
    const ota = { TRIGGER_PROJECT_REF: 'proj_example', TRIGGER_SECRET_KEY: 'tr_prod_example', NODE_ENV: 'development', ...GOOD };
    const s = aStack(envText(ota), { volumes: ['postgres_data', 'clickhouse_data_v2', 'minio_data', 'trigger_db_data'].map((v) => `ownpace-managed_${v}`) });
    const persist = tempDir('a-password-persist-');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', fill?.run ?? 'exit 99'], {
      cwd: s.root,
      env: { ...s.env, MANAGED_ENV_PERSIST_DIR: persist },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out).toBe(0);
    for (const file of [s.envFile, join(persist, '.env')]) {
      const text = readFileSync(file, 'utf8');
      for (const key of FOUR_KEYS) {
        expect(text.split('\n').filter((l) => l.startsWith(`${key}=`)), `${key} in ${file}`).toEqual([`${key}=${GOOD[key]}`]);
      }
      expect(text, 'the gate wrote TRIGGER_DB_PASSWORD').not.toMatch(/^TRIGGER_DB_PASSWORD=/m);
    }
    expect(callsOf(s).filter((c) => c.kind === 'volume')).toEqual([]);
    for (const v of Object.values(GOOD)) expect(showsAPiece(out, v)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The example, and the docs
// ---------------------------------------------------------------------------

describe('managed.env.example ships the four empty, each with its note on a line of its own', () => {
  const lines = EXAMPLE.split('\n');

  it.each(FOUR_KEYS)('%s', (key) => {
    const at = lines.findIndex((l) => l.startsWith(`${key}=`));
    expect(at, `${key} is not in managed.env.example`).toBeGreaterThan(-1);
    expect(lines.filter((l) => l.startsWith(`${key}=`))).toEqual([`${key}=`]);
    let from = at;
    while (from > 0 && /^#/.test(lines[from - 1]!)) from -= 1;
    const note = lines.slice(from, at).join(' ');
    expect(note, `${key}'s note`).toMatch(/ensure-env-secrets\.sh/);
  });

  it('carries none of the values it used to', () => {
    for (const value of OLD_EXAMPLE) expect(EXAMPLE).not.toMatch(new RegExp(`^[A-Z_]+=${value}$`, 'm'));
  });
});

describe('the docs say what the code does', () => {
  const bringUp = read('docs/managed-bring-up.md');
  const section = (text: string, heading: string): string => {
    const at = text.indexOf(heading);
    if (at < 0) return '';
    const next = text.indexOf('\n### ', at + heading.length);
    return text.slice(at, next < 0 ? undefined : next);
  };

  it("the bring-up's phase 2: generated while the volume is new, refused on a real address", () => {
    const env = section(bringUp, '### 2. `env`');
    expect(env).toMatch(/ensure-env-secrets\.sh/);
    for (const key of FOUR_KEYS) expect(env).toContain(key);
    expect(env).toMatch(/real address/);
    expect(env).not.toMatch(/Change them before the `data` phase/i);
  });

  it("the bring-up's phase 3: the two roles set to .env on every run", () => {
    const data = section(bringUp, '### 3. `data`');
    expect(data).toMatch(/app_user/);
    expect(data).toMatch(/every run/);
    expect(data).toMatch(/PGOPTIONS/);
  });

  it("the runbook's section on the roles says the bring-up sets them", () => {
    const runbook = section(read('docs/operator-runbook.md'), '### The database roles');
    expect(runbook).toMatch(/`data` phase/);
    expect(runbook).toMatch(/real address/);
  });
});
