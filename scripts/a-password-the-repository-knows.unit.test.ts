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
 * TRIGGER.DEV'S THREE (2026-09-28 to alpha.18). `trigger-db`'s password,
 * ClickHouse's and MinIO's were three more of the keys below from 0132 T2
 * step B (2026-10-05), and the trigger phase set trigger-db's role to `.env`'s
 * value on every run. alpha.18 removed Trigger.dev's plane (workplan 0167 T9),
 * and the three keys, their stores and the phase with it; two keys are left.
 *
 * THE REST OF T2 (built 2026-10-05). For `POSTGRES_PASSWORD` and
 *   `APP_DB_PASSWORD`:
 *
 *   ONE LIST. `deploy/compose/shipped-passwords.sh` names the values once:
 *   the three Postgres values `rotate-db-passwords.sh --check` tries. Each
 *   compose default and the migration's literal are read from their own files
 *   here and must be in it; the scripts that judge a value source it and
 *   spell none themselves.
 *   (a) A REAL ADDRESS REFUSES THEM. With `WEB_URL` https and not localhost
 *   (the test `note_mail_goes_nowhere_real` makes), every phase from `data`
 *   on stops in `load_env`, before any docker call, when one of the two is
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
 *   (d) `ensure-env-secrets.sh` GENERATES THE TWO on a stack whose volume,
 *   `postgres_data`, does not exist yet, and replaces a shipped value there.
 *   Once the volume exists it writes nothing for them and says why: Postgres
 *   keeps the password it was initialised with (`rotate-db-passwords.sh
 *   --rotate` changes them). A value that is not shipped is never
 *   overwritten, and docker is not even asked. The gate's Fill step, run here
 *   on an `.env` like the OTA stack's after the owner's rotation, changes
 *   neither.
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
import { DOCKER_SOCKET_STAT_DIR } from './docker-socket-stub.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const MANAGED = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
const EXAMPLE = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readIf = (rel: string): string => (existsSync(join(REPO_ROOT, rel)) ? read(rel) : '');


const tempDirs: string[] = [];
// Many large temp folders can outlast vitest's 10 s hook timeout on a loaded run.
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}, 120_000);
const tempDir = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
};

// ---------------------------------------------------------------------------
// The keys, and what was shipped for them
// ---------------------------------------------------------------------------

/**
 * The keys the bring-up refuses and ensure-env-secrets.sh generates, each
 * with the volume whose existence ends that. Five from 0132 T2 step B until
 * alpha.18 removed Trigger.dev's three stores (workplan 0167 T9).
 */
const KEYS: Array<[string, string]> = [
  ['POSTGRES_PASSWORD', 'postgres_data'],
  ['APP_DB_PASSWORD', 'postgres_data'],
];
const KEY_NAMES = KEYS.map(([k]) => k);
/** The three keys alpha.18 removed with Trigger.dev's stores: no script judges them any more. */
const REMOVED_KEYS = ['CLICKHOUSE_PASSWORD', 'MINIO_ROOT_PASSWORD', 'TRIGGER_DB_PASSWORD'];

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
/** Of those, the two keys' own. */
const OLD_EXAMPLE_PG = ['change-me-openmigrate', 'app_password'];
/** Every value this repository publishes for one of the keys, from its own files. */
const SHIPPED = [...new Set([...KEY_NAMES.map(composeDefault), MIGRATION_LITERAL ?? '', ...OLD_EXAMPLE_PG])].filter(Boolean);

/** Values the cases give a stack: none is shipped, each is distinctive enough to find in any output. */
const OWNER_PW = '0a11ce'.repeat(8);
const APP_PW = '0b0b0e'.repeat(8);
const PGB_PW = '0e1e1f'.repeat(8);
/** The jobs role's (ADR-0054), as ensure-env-secrets.sh leaves it. */
const JOBS_PW = '1a2b3c'.repeat(8);
const GOOD: Record<string, string> = {
  POSTGRES_PASSWORD: OWNER_PW,
  APP_DB_PASSWORD: APP_PW,
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
  /** What `compose ps -q postgres` answers, one per call: the container before the `up`, then after it. Empty: the same id every time. */
  dbIds?: string[];
  /** What the jobs role's fit question answers for a role that exists; the fit line when unset. */
  jobsFit?: string;
}
interface Call {
  kind: string;
  argv: string[];
  /** `compose ps -q postgres`: the container id the stub answered. */
  id?: string;
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
 * only when it is one transaction kept out of the database's log: the four
 * settings and BEGIN before the first statement that carries a password,
 * COMMIT after it, and psql told to stop at the first error.
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
const KEPT_OUT = ["SET log_statement = 'none';", 'SET log_min_duration_statement = -1;', 'SET log_min_error_statement = panic;',
  'SET pg_stat_statements.track_utility = off;', 'BEGIN;'];
function keptOut(lines, p) {
  const at = lines.findIndex((l) => l.startsWith('ALTER ROLE :"') || l.startsWith('CREATE ROLE :"'));
  if (at < 0) return 'no statement that sets a password';
  for (const line of KEPT_OUT) {
    const k = lines.indexOf(line);
    if (k < 0) return 'no ' + line;
    if (k > at) return line + ' comes after the statement it keeps out of the log';
  }
  if (lines.lastIndexOf('COMMIT;') < at) return 'no COMMIT after the statement';
  if (p.v.ON_ERROR_STOP !== '1') return 'psql was not told to stop at the first error';
  return '';
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
if (sub === 'ps' && rest.includes('-q') && rest.includes('postgres')) {
  const id = state.dbIds && state.dbIds.length ? state.dbIds.shift() : 'db-1'; save();
  log({ kind: 'ps-id', id: id }); out(id + NL); done(0);
}
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
// The jobs role (ADR-0054): jobs-role.sql makes the role with no password, the
// fit question answers from the state, and the set statement is kept as the
// roles statement is, its RESET lines required.
if (sql.indexOf('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ownpace_jobs') >= 0) {
  log({ kind: 'jobs-role', stdin: sql, user: p.U, v: p.v, env: e.env, inline: e.inline });
  if (p.v.ON_ERROR_STOP !== '1') { err('docker stub: jobs-role.sql run without ON_ERROR_STOP' + NL); done(95); }
  if (!state.roles.ownpace_jobs) { state.roles.ownpace_jobs = { pw: '', login: true, super: false }; save(); }
  done(0);
}
if (p.v.jobs_role !== undefined && sql.indexOf('r.rolinherit') >= 0) {
  log({ kind: 'jobs-fit', stdin: sql, user: p.U, v: p.v, env: e.env, inline: e.inline });
  if (state.roles[p.v.jobs_role]) out((state.jobsFit || 'f|f|f|f|f|t|f|0|0|t|0|0|0|0|f|f|0') + NL);
  done(0);
}
if (p.v.jobs_role !== undefined && sql.indexOf('ALTER ROLE :"jobs_role" PASSWORD') >= 0) {
  log({ kind: 'jobs-set', stdin: sql, user: p.U, v: p.v, env: e.env, inline: e.inline });
  const lines = sql.split(NL).map((l) => l.trim());
  { const why = keptOut(lines, p); if (why) { err('docker stub: the jobs role statement is not one transaction kept out of the log: ' + why + NL); done(95); } }
  if (lines.filter((l) => l.endsWith(' RESET ALL;')).length !== 2) { err('docker stub: the jobs role statement clears no setting' + NL); done(95); }
  let pw = '';
  for (const line of lines) {
    if (line.startsWith(BS + 'set jobs_pw ')) { const a = line.indexOf('"$'); const b = line.lastIndexOf('"'); pw = a >= 0 && b > a ? (e.env[line.slice(a + 2, b)] || '') : ''; }
  }
  if (!state.roles[p.v.jobs_role]) { err('ERROR:  role "' + p.v.jobs_role + '" does not exist' + NL); done(3); }
  if (!pw) { err('ERROR:  an empty password' + NL); done(3); }
  state.roles[p.v.jobs_role].pw = pw; save();
  done(0);
}
if (p.f === '-') { log({ kind: 'setup-auth', stdin: sql, user: p.U, env: e.env, inline: e.inline }); done(0); }
if (sql.indexOf('ROLE :"') < 0) { log({ kind: 'socket-other', stdin: sql, user: p.U, env: e.env, inline: e.inline }); done(0); }

log({ kind: 'roles', stdin: sql, user: p.U, v: p.v, env: e.env, inline: e.inline });
if (!state.roles[p.U]) { err('psql: error: connection to server on socket failed: FATAL:  role "' + p.U + '" does not exist' + NL); done(2); }
const lines = sql.split(NL).map((l) => l.trim());
{ const why = keptOut(lines, p); if (why) { err('docker stub: the roles statement is not one transaction kept out of the log: ' + why + NL); done(95); } }
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
  for (const f of ['managed.yml', 'managed.env.example', 'jobs-role.sql']) copyFileSync(join(COMPOSE_DIR, f), join(composeDir, f));
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
      PATH: `${bin}:${DOCKER_SOCKET_STAT_DIR}:${dirname(process.execPath)}:/usr/bin:/bin`,
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
  JOBS_DB_PASSWORD: JOBS_PW,
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

describe('the shipped values are named once', () => {
  const LIST = readIf('deploy/compose/shipped-passwords.sh');
  const code = codeOf;

  it('deploy/compose/shipped-passwords.sh holds them', () => {
    expect(LIST, 'deploy/compose/shipped-passwords.sh is missing').not.toBe('');
  });

  it("holds every compose default for the two, the migration's literal and the old example's values", () => {
    expect(MIGRATION_LITERAL, "0001_baseline.sql's app_user password was not found").toBeTruthy();
    for (const key of KEY_NAMES) expect(composeDefault(key), `managed.yml's default for ${key}`).not.toBe('');
    for (const value of SHIPPED) {
      expect(code(LIST), `shipped-passwords.sh does not list ${value}`).toMatch(new RegExp(`(^|[\\s('"=])${value}([\\s)'"]|$)`, 'm'));
    }
  });

  it('names the two keys, each with its volume, and none of the three alpha.18 removed', () => {
    for (const [key, volume] of KEYS) expect(code(LIST)).toContain(`'${key} ${volume}'`);
    for (const key of REMOVED_KEYS) expect(code(LIST), `${key} went with Trigger.dev in alpha.18`).not.toContain(key);
    expect(MANAGED, "managed.yml still reads a key of Trigger.dev's stores").not.toMatch(/\$\{(CLICKHOUSE_PASSWORD|MINIO_ROOT_PASSWORD|TRIGGER_DB_PASSWORD)\b/);
  });

  it.each(['rotate-db-passwords.sh', 'bootstrap-managed.sh', 'ensure-env-secrets.sh', 'stand-up-live.sh'])(
    '%s sources it and spells no shipped value itself',
    (script) => {
      const text = read(`deploy/compose/${script}`);
      expect(text).toMatch(/\. "\$\{SCRIPT_DIR\}\/shipped-passwords\.sh"/);
      for (const value of SHIPPED.filter((v) => v !== 'password')) {
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

  it.each(KEY_NAMES)(
    '%s',
    (key) => {
      for (const [label, value] of forms(key)) {
        const s = aStack(envText(realEnv({ [key]: value })));
        const r = bootstrap(s, ['--only', 'data']);
        const what = `${key} ${label}`;
        expect(r.status, `${what}:\n${r.out}`).toBe(1);
        expect(r.out, what).toContain(key);
        for (const other of KEY_NAMES.filter((k) => k !== key)) {
          expect(r.out, `${what}: ${other} holds a value nobody published, and was named`).not.toMatch(new RegExp(`\\b${other}\\b`));
        }
        const bare = value?.replace(/^"|"$/g, '') ?? '';
        if (bare) expect(shows(r.out, bare), `${what}: the value was printed`).toBe(false);
        for (const v of [...KEY_NAMES.filter((k) => k !== key).map((k) => GOOD[k]!), PGB_PW]) {
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

  it("names both at once, and the gate's own command stops the same way", () => {
    const all = Object.fromEntries(KEY_NAMES.map((k) => [k, composeDefault(k)]));
    for (const args of [
      ['--from', 'data', '--with-demo', '--no-smoke'],
      ['--only', 'data'],
      ['--only', 'app'],
      ['--only', 'plane'],
    ]) {
      const s = aStack(envText(realEnv(all)));
      const r = bootstrap(s, args);
      expect(r.status, `${args.join(' ')}:\n${r.out}`).toBe(1);
      for (const key of KEY_NAMES) expect(r.out, args.join(' ')).toContain(key);
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
    for (const v of [OWNER_PW, PGB_PW]) expect(showsAPiece(r.out, v)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it('the refusal is in load_env, which every phase from data on passes through, and a real address is the mail note’s test', () => {
    const script = read('deploy/compose/bootstrap-managed.sh');
    const body = (name: string): string => {
      const at = script.indexOf(`\n${name}() {`);
      return at < 0 ? '' : script.slice(at, script.indexOf('\n}\n', at) + 3);
    };
    expect(body('load_env')).toMatch(/^\s+refuse_shipped_passwords$/m);
    for (const phase of ['data', 'demo', 'plane', 'app', 'smoke']) {
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
    const shipped = {
      POSTGRES_PASSWORD: '',
      APP_DB_PASSWORD: 'app_password',
    };
    const s = aStack(envText(realEnv({ WEB_URL: web, ...shipped })), {
      roles: { pgowner: { pw: composeDefault('POSTGRES_PASSWORD'), login: true, super: true } },
    });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    for (const key of KEY_NAMES) expect(r.out).toContain(key);
    expect(r.out).toMatch(/localhost/);
    for (const value of ['app_password', composeDefault('POSTGRES_PASSWORD')]) {
      expect(shows(r.out, value), `printed ${value}`).toBe(false);
    }
    expect(r.out).not.toMatch(/refused/i);
  });
});

// ---------------------------------------------------------------------------
// (c) The data phase makes both roles match .env, every value by name
// ---------------------------------------------------------------------------

describe('(c) the data phase sets both roles to .env, before anything migrates, and passes every value by name', () => {
  const VALUES = [OWNER_PW, APP_PW, PGB_PW, JOBS_PW];

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
          JOBS_DB_PASSWORD: `"${JOBS_PW}"`,
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
    // ownpace_jobs is jobs-role.sql's name, never .env's (ADR-0054).
    expect(Object.keys(roles).sort()).toEqual(['app_user', 'ownpace_jobs', 'pgbouncer_auth', 'pgowner']);
    expect(roles.ownpace_jobs?.pw, "the jobs role holds .env's value with its quotes").toBe(JOBS_PW);
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

describe('(c2) a postgres the run replaced takes a new pooler before the proof (E2E (managed) #285, 2026-10-28)', () => {
  const recreated = (calls: Call[]) =>
    calls.filter((c) => c.kind === 'up' && (c.services ?? []).includes('pgbouncer') && c.argv.includes('--force-recreate'));

  it('recreates pgbouncer after postgres is up and before the roles are asked through it, when the container changed', () => {
    const s = aStack(envText(realEnv()), { dbIds: ['db-old', 'db-new'] });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/postgres was replaced by this run — recreating pgbouncer/);
    const again = recreated(r.calls);
    expect(again, 'one recreate of the pooler').toHaveLength(1);
    expect(again[0]!.argv).toEqual(expect.arrayContaining(['up', '-d', '--force-recreate', '--no-deps', 'pgbouncer']));
    const at = r.calls.indexOf(again[0]!);
    const postgresUp = r.calls.findIndex((c) => c.kind === 'up' && (c.services ?? []).includes('postgres'));
    const ids = r.calls.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'ps-id');
    expect(ids.map(({ c }) => c.id), 'asked before and after the up').toEqual(['db-old', 'db-new']);
    expect(ids[0]!.i).toBeLessThan(postgresUp);
    expect(ids[1]!.i).toBeGreaterThan(postgresUp);
    expect(at).toBeGreaterThan(postgresUp);
    const firstPooler = r.calls.findIndex((c) => c.kind === 'pooler');
    expect(firstPooler, 'the roles are asked through the pooler').toBeGreaterThan(-1);
    expect(at, 'before the pooler is asked').toBeLessThan(firstPooler);
  });

  it('leaves a serving pooler alone when postgres kept its container', () => {
    const s = aStack(envText(realEnv()), { dbIds: ['db-1', 'db-1'] });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toMatch(/recreating pgbouncer/);
    expect(recreated(r.calls)).toHaveLength(0);
  });

  it('leaves it alone on a first bring-up too, where no postgres ran before', () => {
    const s = aStack(envText(realEnv()), { dbIds: ['', 'db-new'] });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(recreated(r.calls)).toHaveLength(0);
  });
});

describe("(f) the data phase makes the jobs role and its schema, judges the role, sets .env's value on it and proves it (ADR-0054)", () => {
  const VALUES = [OWNER_PW, APP_PW, PGB_PW, JOBS_PW];
  function nothingShown(r: { out: string; calls: Call[] }, values: readonly string[] = VALUES) {
    for (const v of values) {
      expect(showsAPiece(r.out, v), 'a value, or part of one, in the output').toBe(false);
      for (const c of r.calls) {
        expect(showsAPiece(c.argv.join(' '), v), `a value, or part of one, on docker's command line: ${c.kind}`).toBe(false);
        expect(showsAPiece(c.stdin ?? '', v), `a value, or part of one, in the SQL text given to ${c.kind}`).toBe(false);
      }
    }
    for (const c of r.calls) expect(c.inline ?? [], `-e NAME=value in ${c.kind}`).toEqual([]);
  }
  const kindsOf = (calls: Call[]) => calls.map((c) => (c.kind === 'up' ? `up ${(c.services ?? []).join(' ')}` : c.kind));

  it('in order: the file once postgres is up, the question, the password, the pooler, then the proof where the worker will connect', () => {
    const s = aStack(envText(realEnv()));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    const kinds = kindsOf(r.calls);
    const file = kinds.indexOf('jobs-role');
    const fit = kinds.indexOf('jobs-fit');
    const set = kinds.indexOf('jobs-set');
    const pooler = kinds.indexOf('up pgbouncer');
    expect([file, fit, set].every((i) => i > -1), kinds.join('\n')).toBe(true);
    expect(kinds.filter((k) => k.startsWith('jobs-'))).toEqual(['jobs-role', 'jobs-fit', 'jobs-set']);
    expect(kinds.indexOf('up postgres')).toBeLessThan(file);
    expect(kinds.indexOf('roles'), 'after the two roles').toBeLessThan(file);
    expect(file).toBeLessThan(fit);
    expect(fit).toBeLessThan(set);
    expect(set).toBeLessThan(pooler);
    // The file is jobs-role.sql as it is, and the statements go as the owner, over the socket.
    expect(r.calls[file]!.stdin).toBe(read('deploy/compose/jobs-role.sql'));
    for (const i of [file, fit, set]) expect(r.calls[i]!.user).toBe('pgowner');
    expect(r.calls[fit]!.v).toMatchObject({ jobs_role: 'ownpace_jobs', jobs_schema: 'pgboss', ON_ERROR_STOP: '1' });
    expect(r.calls[set]!.v).toMatchObject({ jobs_role: 'ownpace_jobs' });
    expect(Object.values(r.calls[set]!.env ?? {})).toEqual([JOBS_PW]);
    expect(stateOf(s).roles.ownpace_jobs).toEqual({ pw: JOBS_PW, login: true, super: false });
    const asked = r.calls.map((c, i) => ({ c, i })).filter(({ c }) => (c.kind === 'network' || c.kind === 'pooler') && c.user === 'ownpace_jobs');
    expect(asked.map(({ c }) => c.kind).sort()).toEqual(['network', 'pooler']);
    for (const { c, i } of asked) {
      expect(i).toBeGreaterThan(pooler);
      expect(c.env?.PGPASSWORD).toBe(JOBS_PW);
    }
    expect(r.out).toMatch(/ownpace_jobs opens with JOBS_DB_PASSWORD over the stack's network and through the pooler/);
    nothingShown(r);
  });

  it('a second run makes nothing new and sets the same value', () => {
    const s = aStack(envText(realEnv()));
    expect(bootstrap(s, ['--only', 'data']).status).toBe(0);
    const first = stateOf(s).roles;
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(stateOf(s).roles).toEqual(first);
    nothingShown(r);
  });

  it.each([
    ['a superuser', 't|f|f|f|f|t|f|0|0|t|0|0|0|0|f|f|0', /it is a superuser/],
    ['one with BYPASSRLS', 'f|f|f|f|t|t|f|0|0|t|0|0|0|0|f|f|0', /it has BYPASSRLS/],
    ['one that inherits', 'f|f|f|f|f|t|t|0|0|t|0|0|0|0|f|f|0', /it inherits/],
    ['a member of a role', 'f|f|f|f|f|t|f|1|0|t|0|0|0|0|f|f|0', /it belongs to 1 role/],
    ['one a role belongs to', 'f|f|f|f|f|t|f|0|1|t|0|0|0|0|f|f|0', /1 role\(s\) belong to it/],
    ["one whose schema is another role's", 'f|f|f|f|f|t|f|0|0|f|0|0|0|0|f|f|0', /the schema pgboss belongs to another role/],
    ['one that owns things outside its schema', 'f|f|f|f|f|t|f|0|0|t|3|0|0|0|f|f|0', /it owns 3 object\(s\) outside pgboss/],
    ['one that may read the ledger', 'f|f|f|f|f|t|f|0|0|t|0|2|0|0|f|f|0', /it holds a privilege on 2 relation\(s\) of public/],
    ['one whose queue is granted to another role', 'f|f|f|f|f|t|f|0|0|t|0|0|1|0|f|f|0', /1 privilege\(s\) on pgboss or in it are granted/],
    ['one a grant names', 'f|f|f|f|f|t|f|0|0|t|0|0|0|2|f|f|0', /2 grant\(s\) name it/],
    ['one that may create a schema', 'f|f|f|f|f|t|f|0|0|t|0|0|0|0|t|f|0', /it may create a schema in this database/],
    ['one that may create in public', 'f|f|f|f|f|t|f|0|0|t|0|0|0|0|f|t|0', /it may create in the schema public/],
    ["one that may call the pooler's lookup", 'f|f|f|f|f|t|f|0|0|t|0|0|0|0|f|f|1', /it may call 1 function\(s\) of pgbouncer_auth/],
  ])('refuses %s before its password is set, naming why, and repairs nothing', (_what, line, why) => {
    const s = aStack(envText(realEnv()), { jobsFit: line });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/REFUSED, before its password is set: ownpace_jobs: /);
    expect(r.out).toMatch(why);
    const kinds = kindsOf(r.calls);
    expect(kinds).not.toContain('jobs-set');
    expect(kinds, 'the pooler came up').not.toContain('up pgbouncer');
    expect(stateOf(s).roles.ownpace_jobs?.pw).toBe('');
    nothingShown(r);
  });

  it('a role that does not open through the pooler stops the phase, naming the role and the channel', () => {
    const s = aStack(envText(realEnv()), { poolerRefuses: ['ownpace_jobs'] });
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/ownpace_jobs over the pooler: REFUSED/);
    nothingShown(r);
  });

  it('a value a URL does not carry as it is is refused before the role is made, and not printed', () => {
    const odd = 'abc@def-jobs-q7x';
    const s = aStack(envText(realEnv({ JOBS_DB_PASSWORD: odd })));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/JOBS_DB_PASSWORD holds a character a URL does not carry/);
    expect(kindsOf(r.calls).filter((k) => k.startsWith('jobs-'))).toEqual([]);
    nothingShown(r, [...VALUES, odd]);
  });

  it('load_env seeds a missing JOBS_DB_PASSWORD through ensure-env-secrets.sh --only, before any Compose call, and nothing else', () => {
    const s = aStack(envText(realEnv({ JOBS_DB_PASSWORD: null })));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/JOBS_DB_PASSWORD is not in \.env yet: generating it with ensure-env-secrets\.sh --only JOBS_DB_PASSWORD/);
    expect(r.out).toMatch(/\[ensure-env-secrets\] generated JOBS_DB_PASSWORD/);
    // That one key: realEnv has no JWT_SECRET, which a whole run would have generated.
    expect(r.out).not.toMatch(/generated JWT_SECRET/);
    const env = readFileSync(s.envFile, 'utf8');
    expect(env).not.toMatch(/^JWT_SECRET=/m);
    const seeded = /^JOBS_DB_PASSWORD=([0-9a-f]{48})$/m.exec(env)?.[1];
    expect(seeded, 'JOBS_DB_PASSWORD is not 48 hex characters in .env').toBeDefined();
    // Before the first Compose call, so the file Compose reads has it.
    expect(r.out.indexOf('generated JOBS_DB_PASSWORD')).toBeLessThan(r.out.indexOf('postgres healthy'));
    expect(callsOf(s).findIndex((c) => c.kind === 'config')).toBeGreaterThan(-1);
    expect(stateOf(s).roles.ownpace_jobs?.pw).toBe(seeded);
    nothingShown(r, [...VALUES, seeded!]);
  });

  it('a JOBS_DB_PASSWORD that is set is kept, and ensure-env-secrets.sh is not run', () => {
    const s = aStack(envText(realEnv()));
    const r = bootstrap(s, ['--only', 'data']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toMatch(/ensure-env-secrets/);
    expect(readFileSync(s.envFile, 'utf8')).toMatch(new RegExp(`^JOBS_DB_PASSWORD=${JOBS_PW}$`, 'm'));
  });
});

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

describe('(d) ensure-env-secrets.sh generates the two while their volume does not exist, and never overwrites one', () => {
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
  const ALL_VOLUMES = [...new Set(KEYS.map(([, v]) => vol(v)))];

  it('a fresh stack: each absent key generated, 48 hex digits, distinct, and none on env-upsert.sh’s command line', () => {
    const r = ensure({ JWT_SECRET: '' });
    expect(r.status, r.out).toBe(0);
    const made = KEY_NAMES.map((k) => r.value(k) ?? '');
    for (const [i, key] of KEY_NAMES.entries()) {
      expect(made[i], key).toMatch(/^[0-9a-f]{48}$/);
      expect(r.out).toMatch(new RegExp(`generated ${key}\\b`));
    }
    expect(new Set(made).size).toBe(KEY_NAMES.length);
    for (const v of made) {
      expect(showsAPiece(r.upserts, v), 'a generated password, or part of one, on env-upsert.sh’s argv').toBe(false);
      expect(showsAPiece(r.out, v), 'a generated password, or part of one, printed').toBe(false);
    }
  });

  it.each(SHIPPED.map((v) => [v]))('a fresh stack holding %s: replaced', (shipped) => {
    const r = ensure(Object.fromEntries(KEY_NAMES.map((k) => [k, shipped])));
    expect(r.status, r.out).toBe(0);
    for (const key of KEY_NAMES) {
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
  ])('volumes that exist, %s: nothing written for the two, each named, with the way to change it', (_label, value) => {
    const env = Object.fromEntries(KEY_NAMES.map((k) => [k, value]));
    const r = ensure(env, { volumes: ALL_VOLUMES });
    expect(r.status, r.out).toBe(0);
    for (const key of KEY_NAMES) {
      expect(r.value(key), `${key} was written over a volume that exists`).toBe(value ?? undefined);
      expect(r.out).toContain(key);
    }
    expect(r.out).toContain('rotate-db-passwords.sh');
    expect(r.out).toContain('Changing the database passwords');
    if (value) expect(shows(r.out, value), 'the value was printed').toBe(false);
  });

  it('the three keys alpha.18 removed with Trigger.dev are neither generated nor judged (workplan 0167 T9)', () => {
    const r = ensure({ JWT_SECRET: '' });
    expect(r.status, r.out).toBe(0);
    for (const key of REMOVED_KEYS) {
      expect(r.value(key), key).toBeUndefined();
      expect(r.out).not.toContain(key);
    }
  });

  it('a value nobody published is never overwritten, volume or not, and docker is not asked', () => {
    for (const volumes of [[], ALL_VOLUMES]) {
      const r = ensure({ ...GOOD, JWT_SECRET: '' }, { volumes });
      expect(r.status, r.out).toBe(0);
      for (const key of KEY_NAMES) expect(r.value(key)).toBe(GOOD[key]);
      expect(r.calls.filter((c) => c.kind === 'volume'), 'docker was asked about volumes').toEqual([]);
      for (const key of KEY_NAMES) expect(r.out).not.toMatch(new RegExp(`(generated|REPLACED) ${key}\\b`));
    }
  });

  it('a daemon that does not answer: nothing written for the two, and it says why', () => {
    const r = ensure({ JWT_SECRET: '' }, { daemonDown: true });
    expect(r.status, r.out).toBe(0);
    for (const key of KEY_NAMES) expect(r.value(key), key).toBeUndefined();
    expect(r.out).toMatch(/docker/);
    expect(r.value('JWT_SECRET')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the gate's Fill step, on an .env like the OTA stack's after the owner's rotation, keeps the two", () => {
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
    const ota = { NODE_ENV: 'development', ...GOOD };
    const s = aStack(envText(ota), { volumes: ['postgres_data'].map((v) => `ownpace-managed_${v}`) });
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
      for (const key of KEY_NAMES) {
        expect(text.split('\n').filter((l) => l.startsWith(`${key}=`)), `${key} in ${file}`).toEqual([`${key}=${GOOD[key]}`]);
      }
    }
    expect(callsOf(s).filter((c) => c.kind === 'volume')).toEqual([]);
    for (const v of Object.values(GOOD)) expect(showsAPiece(out, v)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The example, and the docs
// ---------------------------------------------------------------------------

describe('managed.env.example ships the two empty, each with its note on a line of its own', () => {
  const lines = EXAMPLE.split('\n');

  it.each(KEY_NAMES)('%s', (key) => {
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

  it('carries none of the three keys alpha.18 removed with Trigger.dev (workplan 0167 T9)', () => {
    for (const key of REMOVED_KEYS) expect(EXAMPLE).not.toMatch(new RegExp(`^${key}=`, 'm'));
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
    for (const key of KEY_NAMES) expect(env).toContain(key);
    expect(env).toMatch(/real address/);
    // The keys in one list, with the volume that ends each one's generation.
    const start = env.search(/\*\*The (?:\w+ )?database passwords\*\*/);
    expect(start, 'no "**The … database passwords**" paragraph').toBeGreaterThan(-1);
    const list = env.slice(start);
    const para = list.slice(0, list.indexOf('\n\n'));
    for (const key of REMOVED_KEYS) expect(para, `${key} went with Trigger.dev in alpha.18`).not.toContain(key);
    for (const [key, volume] of KEYS) {
      expect(para, key).toContain(`\`${key}\``);
      expect(para, volume).toContain(`\`${volume}\``);
    }
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
    // The keys a new stack's volume gets from ensure-env-secrets.sh.
    const at = runbook.search(/ensure-env-secrets\.sh` generates\s+`POSTGRES_PASSWORD`/);
    expect(at, 'no sentence on the keys ensure-env-secrets.sh generates').toBeGreaterThan(-1);
    for (const key of KEY_NAMES) expect(runbook.slice(at, at + 400), key).toContain(`\`${key}\``);
  });
});
