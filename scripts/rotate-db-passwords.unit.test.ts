// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PASSWORDS THE REPOSITORY PRINTS, CHANGED WITHOUT PRINTING THE NEW ONES (workplan 0132 T0 step 2, T2).
 *
 * The OTA stack's two database roles were created with values this public
 * repository contains: `app_user` with `app_password` (the first migration),
 * the owner with compose's default or the example's `change-me-openmigrate`.
 * Changing `.env` does nothing to them, because Postgres keeps the password a
 * role was created with; the role has to be told, with `ALTER ROLE`. No script
 * did that, and the plan's own check tried the name `openmigrate` only, so an
 * owner that had been renamed (D2) would have been reported as refusing every
 * shipped value while it opened with one of them.
 *
 * `deploy/compose/rotate-db-passwords.sh` does it, with `db-roles.sh`, the
 * helper the bring-up's data phase calls on every run. What can go wrong, and what each case
 * below holds it to:
 *
 *   A value is seen. The new values are generated on the machine and written
 *   to `.env`; if one reached a command line, `ps` shows it to every user on
 *   the box, and if one reached the output, the terminal and whatever it is
 *   pasted into. The stubs record every argv and environment, and no
 *   generated value, and no value from `.env`, may appear in an argv, in the
 *   SQL text or in the output. They must appear in the environment of the one
 *   call that sets them: that is the channel, by name.
 *   A check that Postgres never made. Inside the database container the
 *   socket and the loopback are trusted, so a password asked there opens
 *   whatever it is (`the-check-postgres-never-made`). Every question about a
 *   password goes over the stack's network, or through PgBouncer's port,
 *   which asks every connection.
 *   The wrong name. The shipped values are tried against the owner's real
 *   name, and a role that does not exist is not asked, because Postgres
 *   answers "password authentication failed" for a missing role too.
 *   A role the rotation does not change. The owner's old name, left with
 *   LOGIN on a shipped value, would fail the rotation's own last check every
 *   time, after `.env` and both roles had changed. `--check` sends it to
 *   0132 T2 step 5 (`NOLOGIN`, never `DROP`), and `--rotate` refuses it first.
 *   A rotation where it must not run. Live's values are its own (0132 D8);
 *   a `.env` that is not the persisted file is overwritten by the next gate
 *   run; a run of the gate that overlaps copies its old `.env` back (the
 *   `pgrep` and `gh` stubs answer only the exact question: a worker in a
 *   process table beside the runner's listener, and the runs that are not
 *   completed); tracing prints every value; CI must never mint a password; a
 *   postgres that is not healthy cannot be set or proven. Each is refused
 *   before anything changes. The prompt waits for as long as nobody types,
 *   so the two questions about the gate are asked again once the name is
 *   typed, and a run that started meanwhile is refused before anything is
 *   written (the stubs' answer changes only once the prompt is on screen).
 *   `--sync` is refused on live too; `--check`, which changes nothing, runs
 *   on any stack, live included, because 0132 T0 step 5 runs it there.
 *   A rotation that stops halfway. A failed `ALTER`, a check after it that
 *   fails, or an interrupt, puts the old `.env` back (through the link) and
 *   the roles back to it, and says which step failed. A second interrupt, or
 *   TERM or HUP, while that runs does not stop it. When it cannot complete,
 *   the kept copy stays, mode 0600, and the output says what to run.
 *   Trigger.dev's own database, left on its published value (0132 T2, step
 *   A). `trigger-db`'s role `trigger` was made with managed.yml's fallback for
 *   an empty `TRIGGER_DB_PASSWORD`, and `--check` used to ask it and not
 *   count it. It counts it now, after a control of its own (`.env`'s value as
 *   Compose reads it), and points to `--rotate --with-trigger-stores`, which
 *   changes it with ClickHouse's and MinIO's: Trigger.dev's three stores,
 *   whose one client is `trigger-api`. The role is set over trigger-db's own
 *   socket as that superuser, the value by name and the statement kept out of
 *   the log and the statistics, proven over the network, and put back with
 *   the rest when anything after it fails: a refusal, a question that cannot
 *   be asked, the fallback still opening, an interrupt. Plain `--rotate` never
 *   touches it, not even when it fails, and `--sync --with-trigger-stores`
 *   sets it to `.env`'s value, which is the step printed when putting it back
 *   does not complete; that step says done only when trigger-db opens with it.
 *
 * HOW IT RUNS. Each case builds a checkout of its own: every script in
 * `deploy/compose`, the real `managed.yml`, a `.env` linked to
 * `~/.persistent/<project>/.env` under the case's own `HOME`. `docker`,
 * `pgrep`, `openssl`, `gh` and `pnpm` are stubs on the PATH, and
 * `env-upsert.sh` is wrapped so its argv is recorded too. The `docker` stub
 * keeps a small database in a state file: each role's password, super and
 * login flags. It answers a password over the network or the pooler only when
 * it matches, applies an `ALTER` only when the four settings that keep it out
 * of the log and `BEGIN` come before it, `COMMIT` after it, and psql was told
 * to stop at the first error (`-v ON_ERROR_STOP=1`): psql puts the value into
 * the text it sends, and a failed statement is logged with that text unless
 * the settings came first. It takes each value from the variable
 * the SQL names, from the environment Compose was told to pass by name. It
 * can also stop at a named point and wait, so a case can signal the script
 * while a step is running (`State.pause`).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'rotate-db-passwords.sh';
const HELPER = 'db-roles.sh';
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readIf = (rel: string): string => (existsSync(join(REPO_ROOT, rel)) ? read(rel) : '');

/** The OTA stack's project (managed.yml's `name:`), and live's. */
const OTA = 'ownpace-managed';
const LIVE = 'ownpace-live';
/** Every value the `openssl` stub generates starts with this. */
const GEN = 'c0ffee';
/** What the stubs' psql names as the server's address, and the mesh address in `.env`. */
const STUB_ADDR = '192.0.2.10';
const MESH = '100.64.0.1';

const CASE_MS = 90_000;

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The stubs
// ---------------------------------------------------------------------------

interface Role {
  super: boolean;
  login: boolean;
  pw: string;
}
interface State {
  project: string;
  roles: Record<string, Role>;
  /** trigger-db's role `trigger`: the password it holds. */
  trigger: string;
  /** trigger-db is not on the network at all: its name does not resolve. */
  triggerDown: boolean;
  /** trigger-db refuses, over the network, every value that starts with this. */
  triggerRefusesPrefix: string;
  /** trigger-db opens, over the network, with these values too, whatever its role holds (trust on the network, say). */
  triggerAlsoOpens: string[];
  /** A question to trigger-db with a value that starts with one of these cannot be asked: it times out. */
  triggerUnasked: string[];
  /** trigger-db's ALTERs that fail, by attempt (1 is the first). */
  triggerAlterFailAt: number[];
  triggerAlters: number;
  triggerAlterAttempts: number;
  clickhouse: { user: string; pw: string };
  minio: { user: string; pw: string; controlOpens: boolean };
  health: Record<string, string>;
  /** A Runner.Worker process in the stub's process table: a CI job is running on the machine. */
  runner: boolean;
  /** E2E (managed)'s runs, newest first, by status. */
  gh: { authed: boolean; runs: string[] };
  /** The next this many ALTERs fail. */
  alterFail: number;
  /** The ALTERs that fail, by attempt (1 is the first). */
  alterFailAt: number[];
  poolerRefusesPrefix: string;
  /** env-upsert.sh writes the first key it is given, then fails: a write that stops halfway. */
  upsertWritesOnlyFirst: boolean;
  /**
   * Where the docker stub stops and waits for the case: `prove-new`, the first
   * question asked with a generated value; `alter-<n>`, the n-th ALTER;
   * `trigger-alter-<n>`, the n-th ALTER in trigger-db. It writes
   * `paused-<point>` beside the state file and goes on at `resume-<point>`.
   */
  pause: string[];
  generated: string[];
  alters: number;
  alterAttempts: number;
}

/** Shared by every stub: argv and the whole environment, one JSON line per call. */
const STUB_HEAD = `#!${process.execPath}
'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.STUB_STATE, 'utf8'));
const save = () => fs.writeFileSync(process.env.STUB_STATE, JSON.stringify(state));
const log = (tool, extra) => fs.appendFileSync(process.env.STUB_LOG,
  JSON.stringify({ tool, argv, env: { ...process.env }, ...extra }) + '\\n');
const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);
const done = (code) => process.exit(code);
`;

const DOCKER_STUB = `${STUB_HEAD}
const ADDR = ${JSON.stringify(STUB_ADDR)};
const GEN = ${JSON.stringify(GEN)};
function pauseAt(point) {
  if (!(state.pause || []).includes(point)) return;
  state.pause = state.pause.filter((p) => p !== point); save();
  const dir = require('path').dirname(process.env.STUB_STATE);
  fs.writeFileSync(dir + '/paused-' + point, '');
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + 60000;
  while (!fs.existsSync(dir + '/resume-' + point) && Date.now() < until) Atomics.wait(cell, 0, 0, 20);
}
/** What a container is given: \`-e NAME\` from this process's environment, \`-e NAME=value\` as written. */
function containerEnv(names) {
  const env = {};
  for (const n of names) {
    const i = n.indexOf('=');
    if (i >= 0) env[n.slice(0, i)] = n.slice(i + 1);
    else if (n in process.env) env[n] = process.env[n];
  }
  return env;
}
function psqlArgs(args) {
  const o = { v: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h') o.h = args[++i];
    else if (a === '-p') o.p = args[++i];
    else if (a === '-U') o.U = args[++i];
    else if (a === '-d') o.d = args[++i];
    else if (a === '-F') i++;
    else if (/^-[A-Za-z]*c$/.test(a)) o.c = args[++i];
    else if (a === '-v') { const s = args[++i]; const k = s.indexOf('='); o.v[s.slice(0, k)] = s.slice(k + 1); }
  }
  return o;
}
/**
 * The statement that carries a password is kept out of the log only when the
 * four settings and BEGIN come before it, and psql stops at the first error:
 * psql puts the value into the text before it sends it, and a failed statement
 * is logged with its text at the image's log_min_error_statement. Every SET
 * after it, or a psql that goes on, is refused.
 */
const KEPT_OUT = ["SET log_statement = 'none';", 'SET log_min_duration_statement = -1;', 'SET log_min_error_statement = panic;',
  'SET pg_stat_statements.track_utility = off;', 'BEGIN;'];
function keptOut(sql, p) {
  const ls = sql.split('\\n').map((l) => l.trim());
  const at = ls.findIndex((l) => /^(ALTER|CREATE) ROLE /.test(l));
  if (at < 0) return 'no ALTER ROLE or CREATE ROLE';
  for (const line of KEPT_OUT) {
    const k = ls.indexOf(line);
    if (k < 0) return 'no ' + line;
    if (k > at) return line + ' comes after the statement it keeps out of the log';
  }
  const c = ls.lastIndexOf('COMMIT;');
  if (c < at) return 'no COMMIT after the statement';
  if (p.v.ON_ERROR_STOP !== '1') return 'psql was not given -v ON_ERROR_STOP=1, so it goes on after an error';
  return '';
}
function refused(host, user) {
  err('psql: error: connection to server at "' + host + '" (' + ADDR + '), port 5432 failed: FATAL:  password authentication failed for user "' + user + '"\\n');
  return 2;
}
function ask(channel, host, user, pw) {
  if (host === 'trigger-db') {
    if (state.triggerDown) { err('psql: error: could not translate host name "trigger-db" to address: Name does not resolve\\n'); return 2; }
    if ((state.triggerUnasked || []).some((x) => String(pw || '').startsWith(x))) {
      err('psql: error: connection to server at "trigger-db" (' + ADDR + '), port 5432 failed: timeout expired\\n');
      return 2;
    }
    if (state.triggerRefusesPrefix && String(pw || '').startsWith(state.triggerRefusesPrefix)) return refused(host, user);
    if (user === 'trigger' && pw && (pw === state.trigger || (state.triggerAlsoOpens || []).includes(pw))) { out('1\\n'); return 0; }
    return refused(host, user);
  }
  if (host !== 'postgres' && host !== '127.0.0.1') { err('psql: error: could not translate host name "' + host + '"\\n'); return 2; }
  if (String(pw || '').startsWith(GEN)) pauseAt('prove-new');
  if (channel === 'pooler' && state.poolerRefusesPrefix && String(pw || '').startsWith(state.poolerRefusesPrefix)) return refused(host, user);
  const r = state.roles[user];
  if (!r || !r.login || !pw || r.pw !== pw) return refused(host, user);
  out('1\\n');
  return 0;
}

if (argv[0] === 'run') {
  let i = 1; const names = []; let network = '';
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rm' || a === '-i') continue;
    if (a === '-e') { names.push(argv[++i]); continue; }
    if (a === '--network') { network = argv[++i]; continue; }
    break;
  }
  const image = argv[i]; const cmd = argv.slice(i + 1);
  const env = containerEnv(names);
  const p = psqlArgs(cmd.slice(1));
  log('docker', { kind: 'network', image, network, container: env, psql: p });
  if (cmd[0] !== 'psql') { err('docker stub: unexpected run: ' + argv.join(' ') + '\\n'); done(96); }
  if (network !== state.project + '_ownpace-network') { err('docker: Error response from daemon: network ' + network + ' not found.\\n'); done(125); }
  if (!p.h) { err('docker stub: a psql with no -h\\n'); done(93); }
  done(ask('network', p.h, p.U, env.PGPASSWORD));
}

if (argv[0] === 'inspect') { log('docker', { kind: 'inspect' }); done(0); }

if (argv[0] === 'exec') {
  // Plain docker exec, as zitadel-db-password.sh uses it.
  let i = 1; const names = [];
  for (; i < argv.length; i++) {
    if (argv[i] === '-i') continue;
    if (argv[i] === '-e') { names.push(argv[++i]); continue; }
    break;
  }
  const cmd = argv.slice(i + 1);
  const env = containerEnv(names);
  if (cmd[0] === 'sh') { log('docker', { kind: 'address' }); out('192.0.2.20\\n'); done(0); }
  const p = psqlArgs(cmd.slice(1));
  const sql = argv.includes('-i') ? fs.readFileSync(0, 'utf8') : '';
  log('docker', { kind: 'zitadel', container: env, psql: p, sql });
  const m = /ALTER ROLE "([^"]+)" WITH PASSWORD '([^']*)'/.exec(sql);
  if (m) {
    if (!state.roles[p.U] || state.roles[p.U].pw !== env.PGPASSWORD) done(refused('192.0.2.20', p.U));
    state.roles[m[1]].pw = m[2]; save(); done(0);
  }
  const r = state.roles[p.U];
  if (r && r.pw === env.PGPASSWORD) { out('1\\n'); done(0); }
  done(refused('192.0.2.20', p.U));
}

if (argv[0] !== 'compose') { err('docker stub: unexpected call: ' + argv.join(' ') + '\\n'); done(98); }
let i = 1;
for (; i < argv.length; i++) {
  if (argv[i] === '-f' || argv[i] === '--env-file' || argv[i] === '-p') { i++; continue; }
  break;
}
const sub = argv[i]; const rest = argv.slice(i + 1);
if (sub === 'ps') {
  const svc = rest[rest.length - 1];
  log('docker', { kind: 'ps', service: svc });
  out((state.health[svc] || '') + '\\n');
  done(0);
}
if (sub === 'port') { log('docker', { kind: 'port' }); out('0.0.0.0:55432\\n'); done(0); }
if (sub !== 'exec') { err('docker stub: unexpected compose call: ' + argv.join(' ') + '\\n'); done(97); }

let j = 0; const names = [];
for (; j < rest.length; j++) {
  if (rest[j] === '-T') continue;
  if (rest[j] === '-e') { names.push(rest[++j]); continue; }
  break;
}
const svc = rest[j]; const cmd = rest.slice(j + 1);
const env = containerEnv(names);

if (svc === 'postgres' && cmd[0] === 'psql') {
  const p = psqlArgs(cmd.slice(1));
  if (p.c && /pg_roles/.test(p.c)) {
    log('docker', { kind: 'socket', what: 'list', container: env, psql: p });
    if (!state.roles[p.U]) {
      err('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  role "' + p.U + '" does not exist\\n');
      done(2);
    }
    for (const name of Object.keys(state.roles).sort()) {
      const r = state.roles[name];
      if (r.login) out(name + '|' + (r.super ? 't' : 'f') + '|t\\n');
    }
    done(0);
  }
  const sql = fs.readFileSync(0, 'utf8');
  log('docker', { kind: 'socket', what: 'alter', container: env, psql: p, sql });
  if (!state.roles[p.U]) { err('psql: error: FATAL:  role "' + p.U + '" does not exist\\n'); done(2); }
  { const why = keptOut(sql, p); if (why) { err('docker stub: the ALTER is not one transaction kept out of the log: ' + why + '\\n'); done(95); } }
  state.alterAttempts += 1; save();
  pauseAt('alter-' + state.alterAttempts);
  if (state.alterFail > 0 || state.alterFailAt.includes(state.alterAttempts)) {
    if (state.alterFail > 0) state.alterFail -= 1;
    save();
    err('psql:<stdin>:7: ERROR:  could not write to the catalog (the failure this case asked for)\\n');
    done(3);
  }
  const vars = {}; const changes = [];
  for (const raw of sql.split('\\n')) {
    const line = raw.trim();
    let m = /^\\\\set (\\w+) \`printf '%s' "\\$(\\w+)"\`$/.exec(line);
    if (m) { vars[m[1]] = env[m[2]] || ''; continue; }
    m = /^ALTER ROLE :"(\\w+)" PASSWORD :'(\\w+)';$/.exec(line);
    if (m) changes.push([p.v[m[1]], vars[m[2]]]);
  }
  for (const [role, pw] of changes) {
    if (!state.roles[role]) { err('ERROR:  role "' + role + '" does not exist\\n'); done(3); }
    if (!pw) { err('ERROR:  an empty password\\n'); done(3); }
  }
  for (const [role, pw] of changes) state.roles[role].pw = pw;
  state.alters += 1;
  save();
  done(0);
}

// trigger-db, over its own socket as its bootstrap superuser: the only thing
// asked of it there is its role's password, set the way the two above are.
if (svc === 'trigger-db' && cmd[0] === 'psql') {
  const p = psqlArgs(cmd.slice(1));
  const sql = fs.readFileSync(0, 'utf8');
  log('docker', { kind: 'socket', what: 'alter', service: 'trigger-db', container: env, psql: p, sql });
  if (p.U !== 'trigger' || p.d !== 'triggerdb') {
    err('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  role "' + p.U + '" does not exist\\n');
    done(2);
  }
  { const why = keptOut(sql, p); if (why) { err('docker stub: the ALTER in trigger-db is not one transaction kept out of the log and the statistics: ' + why + '\\n'); done(95); } }
  state.triggerAlterAttempts += 1; save();
  pauseAt('trigger-alter-' + state.triggerAlterAttempts);
  if (state.triggerAlterFailAt.includes(state.triggerAlterAttempts)) {
    err('psql:<stdin>:7: ERROR:  could not write to the catalog (the failure this case asked for)\\n');
    done(3);
  }
  const vars = {}; let pw;
  for (const raw of sql.split('\\n')) {
    const line = raw.trim();
    let m = /^\\\\set (\\w+) \`printf '%s' "\\$(\\w+)"\`$/.exec(line);
    if (m) { vars[m[1]] = env[m[2]] || ''; continue; }
    m = /^ALTER ROLE :"(\\w+)" PASSWORD :'(\\w+)';$/.exec(line);
    if (m) {
      if (p.v[m[1]] !== 'trigger') { err('ERROR:  role "' + p.v[m[1]] + '" does not exist\\n'); done(3); }
      pw = vars[m[2]];
    }
  }
  if (!pw) { err('ERROR:  no password, or an empty one\\n'); done(3); }
  state.trigger = pw;
  state.triggerAlters += 1;
  save();
  done(0);
}

if (svc === 'pgbouncer' && cmd[0] === 'psql') {
  const p = psqlArgs(cmd.slice(1));
  log('docker', { kind: 'pooler', container: env, psql: p });
  if (p.h !== '127.0.0.1' || p.p !== '6432') { err('docker stub: the pooler asked off its own port\\n'); done(94); }
  done(ask('pooler', p.h, p.U, env.PGPASSWORD));
}

if (svc === 'clickhouse' && cmd[0] === 'clickhouse-client') {
  const u = cmd[cmd.indexOf('--user') + 1]; const pw = cmd[cmd.indexOf('--password') + 1];
  log('docker', { kind: 'clickhouse' });
  if (u === state.clickhouse.user && pw === state.clickhouse.pw) { out('1\\n'); done(0); }
  err('Code: 516. DB::Exception: Received from localhost:9000. DB::Exception: ' + u + ': Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED)\\n');
  done(4);
}

if (svc === 'minio' && cmd[0] === 'sh') {
  log('docker', { kind: 'minio-control', container: env });
  if (state.minio.controlOpens) done(0);
  err('mc: <ERROR> Unable to list folder. Get "http://127.0.0.1:9000/": dial tcp 127.0.0.1:9000: connect: connection refused\\n');
  done(1);
}
if (svc === 'minio' && cmd[0] === 'mc') {
  const m = /^http:\\/\\/([^:]*):([^@]*)@/.exec(env.MC_HOST_probe || '');
  log('docker', { kind: 'minio', container: env });
  if (m && m[1] === state.minio.user && m[2] === state.minio.pw) done(0);
  err('mc: <ERROR> Unable to list folder. The request signature we calculated does not match the signature you provided. Check your key and signing method.\\n');
  done(1);
}

err('docker stub: unexpected exec: ' + rest.join(' ') + '\\n');
done(92);
`;

/**
 * pgrep, over a process table: a runner machine always runs the runner's
 * listener, and a worker only while a job runs. The pattern is matched as
 * pgrep matches it (against the whole command line with -f), so a pattern
 * that also matched the listener, or matched neither, turns a case red.
 */
const PGREP_STUB = `${STUB_HEAD}
log('pgrep', {});
const table = [
  { pid: 811, comm: 'dockerd', cmd: '/usr/bin/dockerd -H fd://' },
  { pid: 903, comm: 'Runner.Listener', cmd: '/home/runner/actions-runner/bin/Runner.Listener run --startuptype service' },
  ...(state.runner ? [{ pid: 4242, comm: 'Runner.Worker', cmd: '/home/runner/actions-runner/bin/Runner.Worker spawnclient 118 121' }] : []),
];
const pattern = argv.filter((a) => !a.startsWith('-')).pop();
if (!pattern) { err('pgrep: no matching criteria specified\\n'); done(2); }
const re = new RegExp(pattern);
const hits = table.filter((p) => re.test(argv.includes('-f') ? p.cmd : p.comm.slice(0, 15)));
out(argv.includes('-c') ? hits.length + '\\n' : hits.map((p) => p.pid + '\\n').join(''));
done(hits.length ? 0 : 1);
`;

const OPENSSL_STUB = `${STUB_HEAD}
log('openssl', {});
if (argv.join(' ') !== 'rand -hex 24') { err('openssl stub: unexpected call\\n'); done(90); }
const v = ${JSON.stringify(GEN)} + (state.generated.length + 1).toString(16).padStart(42, '0');
state.generated.push(v); save();
out(v + '\\n');
done(0);
`;

/**
 * The filter that counts E2E (managed)'s runs that are not finished: queued,
 * in progress, waiting, anything but completed. The gh stub answers that
 * question and no other, so an inverted or narrowed filter is refused and
 * turns the cases that go through gh red.
 */
const ACTIVE_RUNS_FILTER = '[.[] | select(.status != "completed")] | length';

const GH_STUB = `${STUB_HEAD}
log('gh', {});
const flag = (name) => { const k = argv.indexOf(name); return k >= 0 ? argv[k + 1] : undefined; };
if (argv[0] === 'auth') done(state.gh.authed ? 0 : 1);
if (argv[0] === 'run' && argv[1] === 'list') {
  if (flag('--workflow') !== 'e2e-managed.yml') { err('could not find any workflows named ' + flag('--workflow') + '\\n'); done(1); }
  if (!String(flag('--json') || '').split(',').includes('status')) { err('gh stub: the runs were listed without their status\\n'); done(88); }
  if (flag('--jq') !== ${JSON.stringify(ACTIVE_RUNS_FILTER)}) { err('gh stub: a --jq filter this stub does not answer: ' + flag('--jq') + '\\n'); done(88); }
  const runs = state.gh.runs.slice(0, Number(flag('--limit') || 20));
  out(String(runs.filter((s) => s !== 'completed').length) + '\\n');
  done(0);
}
if (argv[0] === 'workflow' && argv[1] === 'run') done(0);
err('gh stub: unexpected call\\n');
done(89);
`;

const PNPM_STUB = `${STUB_HEAD}
log('pnpm', {});
out('Seed failed: password authentication failed for user "pgowner"\\n');
done(1);
`;

/** env-upsert.sh, wrapped: its argv recorded, then the real one run. */
const UPSERT_WRAPPER = `${STUB_HEAD}
log('env-upsert', {});
const real = require('path').join(__dirname, 'env-upsert.real.sh');
if (state.upsertWritesOnlyFirst) {
  // --from-env <file> KEY1 ...: the first key written, then a failure, as a full disk would leave it.
  require('child_process').spawnSync('bash', [real, ...argv.slice(0, 3)], { stdio: 'inherit' });
  err('env-upsert.sh: could not write the rest (the failure this case asked for)\\n');
  done(1);
}
const r = require('child_process').spawnSync('bash', [real, ...argv], { stdio: 'inherit' });
done(r.status === null ? 1 : r.status);
`;

// ---------------------------------------------------------------------------
// A checkout of its own
// ---------------------------------------------------------------------------

/** The values the cases give the OTA stack. None of them may ever be printed. */
const OWNER_PW = 'owner-secret-4d1f';
const APP_PW = 'app-secret-9b2e';
const CH_PW = 'clickhouse-secret-77aa';
const MINIO_PW = 'minio-secret-31cc';
/** trigger-db's, as stand-up-live.sh generates it on live, or as the rotation leaves it on the OTA stack. */
const TRIGGER_PW = 'trigger-secret-3c3c';
/** managed.yml's fallback for an empty TRIGGER_DB_PASSWORD, which the OTA stack's trigger_db_data still holds. */
const TRIGGER_LITERAL = 'trigger_password';

interface Fixture {
  root: string;
  compose: string;
  home: string;
  /** The file the values live in: ~/.persistent/<project>/.env */
  persisted: string;
  /** The checkout's .env, a link to `persisted` unless a case says otherwise. */
  checkoutEnv: string;
  statePath: string;
  logPath: string;
}

interface FixtureOpts {
  project?: string;
  env?: Record<string, string>;
  state?: Partial<State>;
  /** false: the checkout's .env is a file of its own, not a link. */
  linked?: boolean;
  /** Keys left out of .env altogether: the OTA stack's has no TRIGGER_DB_PASSWORD line. */
  unset?: string[];
}

function baseEnv(): Record<string, string> {
  return {
    POSTGRES_USER: 'pgowner',
    POSTGRES_PASSWORD: OWNER_PW,
    POSTGRES_DB: 'openmigrate',
    APP_DB_USER: 'app_user',
    APP_DB_PASSWORD: APP_PW,
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: CH_PW,
    MINIO_ROOT_USER: 'admin',
    MINIO_ROOT_PASSWORD: MINIO_PW,
    TRIGGER_DB_PASSWORD: TRIGGER_PW,
    JWT_SECRET: 'jwt-secret-5e5e',
    SECRET_ENCRYPTION_KEY: 'key-secret-6f6f',
    WEB_BIND: MESH,
  };
}

function baseState(project: string): State {
  return {
    project,
    roles: {
      app_user: { super: false, login: true, pw: APP_PW },
      pgbouncer_auth: { super: false, login: true, pw: 'lookup-secret-1a1a' },
      pgowner: { super: true, login: true, pw: OWNER_PW },
      zitadel: { super: false, login: true, pw: 'zitadel-secret-2b2b' },
    },
    trigger: TRIGGER_PW,
    triggerDown: false,
    triggerRefusesPrefix: '',
    triggerAlsoOpens: [],
    triggerUnasked: [],
    triggerAlterFailAt: [],
    triggerAlters: 0,
    triggerAlterAttempts: 0,
    clickhouse: { user: 'default', pw: CH_PW },
    minio: { user: 'admin', pw: MINIO_PW, controlOpens: true },
    health: { postgres: 'healthy', clickhouse: 'healthy', 'trigger-db': 'healthy' },
    runner: false,
    gh: { authed: false, runs: [] },
    alterFail: 0,
    alterFailAt: [],
    poolerRefusesPrefix: '',
    upsertWritesOnlyFirst: false,
    pause: [],
    generated: [],
    alters: 0,
    alterAttempts: 0,
  };
}

const envText = (env: Record<string, string>): string =>
  `${Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;

function fixture(opts: FixtureOpts = {}): Fixture {
  const project = opts.project ?? OTA;
  const root = mkdtempSync(join(tmpdir(), 'rotate-db-'));
  tempDirs.push(root);
  const compose = join(root, 'repo', 'deploy', 'compose');
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  mkdirSync(join(compose, 'pgbouncer'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const f of readdirSync(COMPOSE_DIR).filter((x) => x.endsWith('.sh') || x === 'managed.yml')) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  copyFileSync(join(COMPOSE_DIR, 'pgbouncer', 'pgbouncer.ini'), join(compose, 'pgbouncer', 'pgbouncer.ini'));
  copyFileSync(join(COMPOSE_DIR, 'env-upsert.sh'), join(compose, 'env-upsert.real.sh'));
  writeFileSync(join(compose, 'env-upsert.sh'), UPSERT_WRAPPER);
  chmodSync(join(compose, 'env-upsert.sh'), 0o755);

  const env: Record<string, string> = { ...baseEnv(), ...(opts.env ?? {}) };
  for (const key of opts.unset ?? []) delete env[key];
  const persistDir = join(home, '.persistent', project);
  mkdirSync(persistDir, { recursive: true });
  const persisted = join(persistDir, '.env');
  writeFileSync(persisted, envText(env), { mode: 0o600 });
  const checkoutEnv = join(compose, '.env');
  if (opts.linked === false) writeFileSync(checkoutEnv, envText(env));
  else symlinkSync(persisted, checkoutEnv);

  const state = { ...baseState(project), ...(opts.state ?? {}) };
  const statePath = join(root, 'state.json');
  const logPath = join(root, 'calls.jsonl');
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(logPath, '');
  for (const [name, body] of [
    ['docker', DOCKER_STUB],
    ['pgrep', PGREP_STUB],
    ['openssl', OPENSSL_STUB],
    ['gh', GH_STUB],
    ['pnpm', PNPM_STUB],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  return { root, compose, home, persisted, checkoutEnv, statePath, logPath };
}

interface RunOpts {
  input?: string;
  env?: Record<string, string>;
  bash?: string[];
  script?: string;
  /** start() only: stdin stays open, and the case writes to it when it is ready. */
  keepInput?: boolean;
}

/** Built from nothing, never from process.env: CI sets CI and GITHUB_ACTIONS, which --rotate refuses. */
function run(fx: Fixture, args: string[], opts: RunOpts = {}) {
  const r = spawnSync('bash', [...(opts.bash ?? []), join(fx.compose, opts.script ?? SCRIPT), ...args], {
    cwd: join(fx.root, 'repo'),
    env: {
      PATH: `${join(fx.root, 'bin')}:/usr/local/bin:/usr/bin:/bin`,
      HOME: fx.home,
      LANG: 'C.UTF-8',
      STUB_STATE: fx.statePath,
      STUB_LOG: fx.logPath,
      ...(opts.env ?? {}),
    },
    input: opts.input ?? '',
    encoding: 'utf8',
    timeout: CASE_MS - 5_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', output: `${r.stdout}\n${r.stderr}` };
}

/** As run(), but started, so a case can signal it while a stub waits (State.pause). */
function start(fx: Fixture, args: string[], opts: RunOpts = {}) {
  const child = spawn('bash', [join(fx.compose, SCRIPT), ...args], {
    cwd: join(fx.root, 'repo'),
    env: {
      PATH: `${join(fx.root, 'bin')}:/usr/local/bin:/usr/bin:/bin`,
      HOME: fx.home,
      LANG: 'C.UTF-8',
      STUB_STATE: fx.statePath,
      STUB_LOG: fx.logPath,
      ...(opts.env ?? {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
  if (!opts.keepInput) child.stdin.end(opts.input ?? '');
  const finished = new Promise<{ status: number | null; signal: string | null; stdout: string; stderr: string; output: string }>(
    (resolve) => {
      child.on('close', (status, signal) =>
        resolve({ status, signal, stdout, stderr, output: `${stdout}\n${stderr}` }),
      );
    },
  );
  return { child, finished, sofar: () => `${stdout}\n${stderr}` };
}

/** Until the script has printed <text>. */
async function shown(sofar: () => string, text: string): Promise<void> {
  const until = Date.now() + 60_000;
  while (!sofar().includes(text)) {
    if (Date.now() > until) throw new Error(`the script never printed ${JSON.stringify(text)}: ${sofar()}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Until the docker stub says it has stopped at <point>. */
async function pausedAt(fx: Fixture, point: string): Promise<void> {
  const file = join(fx.root, `paused-${point}`);
  const until = Date.now() + 60_000;
  while (!existsSync(file)) {
    if (Date.now() > until) throw new Error(`the docker stub never reached ${point}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const resume = (fx: Fixture, point: string) => writeFileSync(join(fx.root, `resume-${point}`), '');

interface Call {
  tool: string;
  argv: string[];
  env: Record<string, string>;
  kind?: string;
  what?: string;
  service?: string;
  network?: string;
  image?: string;
  container?: Record<string, string>;
  psql?: { h?: string; p?: string; U?: string; d?: string; c?: string; v: Record<string, string> };
  sql?: string;
}
const calls = (fx: Fixture): Call[] =>
  readFileSync(fx.logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Call);
const stateOf = (fx: Fixture): State => JSON.parse(readFileSync(fx.statePath, 'utf8')) as State;

/** Every value that must never be seen: the .env's own, the generated ones, and two addresses. */
function secrets(fx: Fixture): string[] {
  return [OWNER_PW, APP_PW, CH_PW, MINIO_PW, TRIGGER_PW, 'jwt-secret-5e5e', 'key-secret-6f6f', ...stateOf(fx).generated];
}

/** A value on any argv, in any SQL text, or in the output: each hit named, never the value. */
function leaks(fx: Fixture, output: string): string[] {
  const hits: string[] = [];
  for (const [i, value] of secrets(fx).entries()) {
    for (const c of calls(fx)) {
      if (c.argv.some((a) => a.includes(value))) hits.push(`value #${i} on the argv of ${c.tool} ${c.argv[0] ?? ''}`);
      if (c.sql?.includes(value)) hits.push(`value #${i} in the SQL text`);
    }
    if (output.includes(value)) hits.push(`value #${i} in the output`);
  }
  for (const address of [STUB_ADDR, MESH, '192.0.2.20']) {
    if (output.includes(address)) hits.push(`the address ${address} in the output`);
  }
  return hits;
}

const LINK_SHIPPED = ['app_password', 'openmigrate_password', 'change-me-openmigrate'];

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------

describe('--check: which shipped value still opens a role', () => {
  it(
    "tries every shipped value against the owner's real name, over the network, and exits 1 when one opens",
    () => {
      // D2: the names were changed. The owner here is `pgowner`, and it still
      // opens with the example's value; `openmigrate` is not a role at all.
      const fx = fixture({
        env: { POSTGRES_PASSWORD: 'change-me-openmigrate', APP_DB_PASSWORD: '' },
        state: {
          roles: {
            ...baseState(OTA).roles,
            pgowner: { super: true, login: true, pw: 'change-me-openmigrate' },
            app_user: { super: false, login: true, pw: 'app_password' },
          },
        },
      });
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(1);
      expect(r.stdout).toMatch(/pgowner.*the example's value.*OPENS/);
      expect(r.stdout).toMatch(/app_user.*the migration's default.*OPENS/);
      expect(r.stdout).toMatch(/openmigrate.*not a login role/);

      const asked = calls(fx).filter((c) => c.kind === 'network' && c.psql?.U === 'pgowner');
      for (const value of LINK_SHIPPED) {
        expect(
          asked.some((c) => c.container?.PGPASSWORD === value),
          `the shipped value ${value} was not tried against the owner's real name`,
        ).toBe(true);
      }
      // A role that does not exist is not asked: Postgres would say
      // "password authentication failed" and it would read as refused.
      expect(calls(fx).filter((c) => c.psql?.U === 'openmigrate')).toEqual([]);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "a login role --rotate does not change, on a shipped value: named, with 0132 T2 step 5's NOLOGIN, not sent to --rotate",
    () => {
      // The owner was renamed and its old name kept LOGIN: --rotate changes the
      // owner and app_user only, so it could never make this one refuse.
      const fx = fixture({
        state: { roles: { ...baseState(OTA).roles, openmigrate: { super: true, login: true, pw: 'openmigrate_password' } } },
      });
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(1);
      expect(r.stdout).toMatch(/openmigrate, compose's default: OPENS/);
      expect(r.stdout).toContain('ALTER ROLE openmigrate NOLOGIN');
      expect(r.stdout).toContain('0132 T2, step 5');
      expect(r.stdout).toContain('never DROP');
      expect(r.stdout, 'it sent the owner to --rotate, which refuses this').not.toContain('--rotate');
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'exits 0 when every control opens and no shipped value opens anything',
    () => {
      const fx = fixture();
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(0);
      expect(r.stdout).toMatch(/pgowner.*over the network.*opens/);
      expect(r.stdout).toMatch(/app_user.*through the pooler.*opens/);
      expect(r.stdout).not.toMatch(/OPENS/);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "counts trigger-db's published value like the others, and points to --rotate --with-trigger-stores (the OTA stack before the owner's run)",
    () => {
      // The OTA stack as it stands: no TRIGGER_DB_PASSWORD line, and a
      // trigger_db_data volume that still holds managed.yml's fallback.
      const fx = fixture({ unset: ['TRIGGER_DB_PASSWORD'], state: { trigger: TRIGGER_LITERAL } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(1);
      // The control is .env's value as Compose reads it: the fallback, since the key is empty.
      expect(r.stdout).toMatch(/trigger-db trigger: control, compose's default \(TRIGGER_DB_PASSWORD is empty in \.env\), over the network: opens/);
      expect(r.stdout).toMatch(/trigger-db trigger, compose's default: OPENS/);
      expect(r.stdout).toContain('RESULT: 1 shipped value(s) open');
      expect(r.stdout).toContain('--rotate --with-trigger-stores');
      expect(r.output, 'the old wording, from before the rotation could change it').not.toMatch(/not counted|waits for T2/);
      // Asked over the stack's network, as trigger-api asks it, and nothing changed.
      const asked = calls(fx).filter((c) => c.kind === 'network' && c.psql?.h === 'trigger-db');
      expect(asked.map((c) => [c.psql?.U, c.psql?.d])).toContainEqual(['trigger', 'triggerdb']);
      expect(asked.some((c) => c.container?.PGPASSWORD === TRIGGER_LITERAL)).toBe(true);
      expect(calls(fx).filter((c) => c.what === 'alter'), '--check altered a role').toEqual([]);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'a trigger-db that holds a value nobody published is left alone: its control opens, the fallback is refused, exit 0',
    () => {
      // Live, stood up by stand-up-live.sh, and the OTA stack after the owner's run.
      const fx = fixture();
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(0);
      expect(r.stdout).toMatch(/trigger-db trigger: control, TRIGGER_DB_PASSWORD from \.env, over the network: opens/);
      expect(r.stdout).toMatch(/trigger-db trigger, compose's default: refused/);
      expect(calls(fx).filter((c) => c.what === 'alter')).toEqual([]);
      expect(stateOf(fx).trigger).toBe(TRIGGER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "trigger-db's control refused is \"cannot tell\", 2, and points to --sync --with-trigger-stores; one that cannot be asked is 2 too",
    () => {
      const disagree = fixture({ env: { TRIGGER_DB_PASSWORD: 'not-what-trigger-db-has' } });
      const r = run(disagree, ['--check']);
      expect(r.status, r.output).toBe(2);
      expect(r.stdout).toMatch(/trigger-db trigger: control, TRIGGER_DB_PASSWORD from \.env, over the network: REFUSED/);
      expect(r.output).toContain('rotate-db-passwords.sh --sync --with-trigger-stores');
      expect(r.output).not.toContain('not-what-trigger-db-has');
      expect(leaks(disagree, r.output)).toEqual([]);

      const down = fixture({ state: { triggerDown: true } });
      const r2 = run(down, ['--check']);
      expect(r2.status, r2.output).toBe(2);
      expect(r2.stdout).toMatch(/trigger-db trigger: control, .*could not be asked/);
      expect(leaks(down, r2.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "a question to trigger-db that cannot be asked, its control's or the fallback's, is 2 on its own",
    () => {
      // Each is asked once; the other answers. A check that let either go
      // would call the stack clean without having asked it.
      for (const [unasked, which] of [
        ['trigger-secret', 'control'],
        [TRIGGER_LITERAL, 'fallback'],
      ] as const) {
        const fx = fixture({ state: { triggerUnasked: [unasked] } });
        const r = run(fx, ['--check']);
        expect(r.status, `${which}: ${r.output}`).toBe(2);
        expect(r.stdout).toContain('RESULT: NOT ESTABLISHED. A question above could not be asked');
        if (which === 'control') {
          expect(r.stdout).toMatch(/trigger-db trigger: control, TRIGGER_DB_PASSWORD from \.env, over the network: could not be asked/);
          expect(r.stdout).toMatch(/trigger-db trigger, compose's default: refused/);
        } else {
          expect(r.stdout).toMatch(/trigger-db trigger: control, TRIGGER_DB_PASSWORD from \.env, over the network: opens/);
          expect(r.stdout).toMatch(/trigger-db trigger, compose's default: could not be asked/);
        }
        expect(leaks(fx, r.output)).toEqual([]);
      }
    },
    CASE_MS,
  );

  it(
    'counts a shipped ClickHouse or MinIO value that opens',
    () => {
      const fx = fixture({
        state: {
          clickhouse: { user: 'default', pw: 'change-me-clickhouse' },
          minio: { user: 'admin', pw: 'very-safe-password', controlOpens: true },
        },
      });
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(1);
      expect(r.stdout).toMatch(/ClickHouse.*the example's value.*OPENS/);
      expect(r.stdout).toMatch(/MinIO.*compose's default.*OPENS/);
    },
    CASE_MS,
  );

  it(
    'a control that does not open is "cannot tell", 2, and points to --sync',
    () => {
      // .env and the role disagree, so a refused shipped value proves nothing.
      const fx = fixture({ env: { APP_DB_PASSWORD: 'not-what-the-role-has' } });
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(2);
      expect(r.output).toContain('--sync');
      expect(r.output).not.toContain('not-what-the-role-has');
    },
    CASE_MS,
  );

  it(
    'an owner name the database does not have is "cannot tell", and says why',
    () => {
      const fx = fixture({ env: { POSTGRES_USER: 'renamed_owner' } });
      const r = run(fx, ['--check']);
      expect(r.status, r.output).toBe(2);
      expect(r.output).toContain('POSTGRES_USER');
      expect(r.output).toContain('first initialisation');
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// Every password question over the network, never the socket
// ---------------------------------------------------------------------------

describe('every question about a password is asked the way the stack asks it', () => {
  it(
    'over the stack\'s own network or through the pooler\'s port, never the socket, in every mode',
    () => {
      const fx = fixture();
      run(fx, ['--check']);
      run(fx, ['--sync']);
      run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      const withPassword = calls(fx).filter((c) => c.tool === 'docker' && c.container && 'PGPASSWORD' in c.container);
      expect(withPassword.length, 'no password was asked at all: the scan is vacuous').toBeGreaterThan(10);
      const wrong = withPassword.filter((c) => {
        if (c.kind === 'network') {
          return !(c.network === `${OTA}_ownpace-network` && (c.psql?.h === 'postgres' || c.psql?.h === 'trigger-db'));
        }
        if (c.kind === 'pooler') return !(c.psql?.h === '127.0.0.1' && c.psql?.p === '6432');
        return true;
      });
      expect(wrong.map((c) => c.argv.join(' '))).toEqual([]);
      // The socket is for work, never for a question about a password.
      const socket = calls(fx).filter((c) => c.kind === 'socket');
      expect(socket.length).toBeGreaterThan(0);
      expect(socket.filter((c) => c.container && 'PGPASSWORD' in c.container)).toEqual([]);
      // And the client is the image the stack's own postgres runs, so the machine pulls nothing.
      const image = /postgres:\n\s+image:\s*(\S+)/.exec(read('deploy/compose/managed.yml'))?.[1];
      expect(image).toBeTruthy();
      expect(new Set(calls(fx).filter((c) => c.kind === 'network').map((c) => c.image))).toEqual(new Set([image]));
    },
    CASE_MS * 2,
  );
});

// ---------------------------------------------------------------------------
// Which stack each mode runs on, and what --rotate refuses: a refusal changes nothing
// ---------------------------------------------------------------------------

function unchanged(fx: Fixture, before: string, r: { status: number | null; output: string }) {
  expect(r.status, r.output).toBe(1);
  expect(readFileSync(fx.persisted, 'utf8'), '.env changed').toBe(before);
  expect(calls(fx).filter((c) => c.tool === 'openssl'), 'a value was generated').toEqual([]);
  expect(calls(fx).filter((c) => c.what === 'alter'), 'a role was altered').toEqual([]);
  expect(calls(fx).filter((c) => c.tool === 'env-upsert'), '.env was written').toEqual([]);
  expect(leaks(fx, r.output)).toEqual([]);
}

describe('which stack: --check on any, --sync and --rotate never on live', () => {
  it(
    "--rotate refuses live's marker, and anything that could be a slip of it",
    () => {
      for (const [kind, args] of [
        ['production', ['--rotate']],
        [' Prod ', ['--rotate']],
        ['production', ['--rotate', '--with-trigger-stores']],
      ] as const) {
        const fx = fixture({ project: LIVE, env: { COMPOSE_PROJECT_NAME: LIVE, STACK_KIND: kind } });
        const before = readFileSync(fx.persisted, 'utf8');
        const r = run(fx, [...args], { input: `${LIVE}\n` });
        unchanged(fx, before, r);
        expect(r.stderr).toContain('STACK_KIND');
        expect(r.stderr).not.toContain(kind.trim());
        expect(calls(fx).filter((c) => c.tool === 'docker'), 'it asked the stack before refusing').toEqual([]);
      }
    },
    CASE_MS,
  );

  it(
    '--sync refuses live: its roles are set by its own bring-up',
    () => {
      const fx = fixture({ project: LIVE, env: { COMPOSE_PROJECT_NAME: LIVE, STACK_KIND: 'production' } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--sync']);
      unchanged(fx, before, r);
      expect(r.stderr).toContain('STACK_KIND');
    },
    CASE_MS,
  );

  it(
    "--check runs on live's .env and changes nothing, --sync on the same .env refuses, and --help says both",
    () => {
      // --check is read-only, and 0132 T0 step 5 runs it on live, so it runs
      // on any stack. The two modes that write refuse one that may be live,
      // before they ask it anything.
      const fx = fixture({ project: LIVE, env: { COMPOSE_PROJECT_NAME: LIVE, STACK_KIND: 'production' } });
      const before = readFileSync(fx.persisted, 'utf8');
      const check = run(fx, ['--check']);
      expect(check.status, check.output).toBe(0);
      expect(check.stdout).toContain(`stack ${LIVE}`);
      expect(check.stdout).toContain('RESULT: every control opens');
      // Live's trigger-db was made with the value stand-up-live.sh generated
      // (D8), so managed.yml's fallback is refused there and the check stays 0.
      expect(check.stdout).toMatch(/trigger-db trigger, compose's default: refused/);
      const asked = calls(fx).filter((c) => c.kind === 'network');
      expect(asked.length, 'nothing was asked on live').toBeGreaterThan(0);
      expect(new Set(asked.map((c) => c.network))).toEqual(new Set([`${LIVE}_ownpace-network`]));
      expect(readFileSync(fx.persisted, 'utf8'), '--check changed .env').toBe(before);
      expect(calls(fx).filter((c) => c.what === 'alter'), '--check altered a role').toEqual([]);
      expect(leaks(fx, check.output)).toEqual([]);

      const seen = calls(fx).length;
      const sync = run(fx, ['--sync']);
      unchanged(fx, before, sync);
      expect(sync.stderr).toContain('STACK_KIND');
      expect(sync.stderr).toContain('--check may be run there; --sync and --rotate may not.');
      expect(calls(fx).slice(seen).filter((c) => c.tool === 'docker'), '--sync asked live before refusing').toEqual([]);

      const help = spawnSync('bash', [join(COMPOSE_DIR, SCRIPT), '--help'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
      expect(help.status, help.stderr).toBe(0);
      const text = help.stdout
        .split('\n')
        .map((l) => l.replace(/^#\s?/, ''))
        .join(' ')
        .replace(/\s+/g, ' ');
      expect(text).toContain('--check runs on any stack, live included');
      expect(text).toContain('--sync and --rotate refuse a stack that may be live');
    },
    CASE_MS,
  );
});

describe('--rotate refuses, before anything changes', () => {
  it(
    'a .env that is not the persisted file: it names the path and the keys that differ, never a value',
    () => {
      const fx = fixture({ linked: false });
      writeFileSync(fx.checkoutEnv, envText({ ...baseEnv(), POSTGRES_PASSWORD: 'drifted-secret-8888' }));
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      unchanged(fx, before, r);
      expect(r.stderr).toContain(fx.checkoutEnv);
      expect(r.stderr).toContain(fx.persisted);
      expect(r.stderr).toContain('POSTGRES_PASSWORD');
      expect(r.stderr).not.toContain('APP_DB_PASSWORD');
      expect(r.output).not.toContain('drifted-secret-8888');
    },
    CASE_MS,
  );

  it(
    'a start under xtrace, however it was asked for, and prints no value while refusing',
    () => {
      const ways: RunOpts[] = [{ bash: ['-x'] }, { env: { SHELLOPTS: 'xtrace' } }, { env: { BASH_XTRACEFD: '2' } }];
      for (const how of ways) {
        const fx = fixture();
        const before = readFileSync(fx.persisted, 'utf8');
        const r = run(fx, ['--rotate'], { input: `${OTA}\n`, ...how });
        unchanged(fx, before, r);
        expect(r.stderr).toContain('xtrace');
      }
    },
    CASE_MS,
  );

  it(
    'CI, which must never mint a password',
    () => {
      const ciEnvs: Array<Record<string, string>> = [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }];
      for (const env of ciEnvs) {
        const fx = fixture();
        const before = readFileSync(fx.persisted, 'utf8');
        const r = run(fx, ['--rotate'], { input: `${OTA}\n`, env });
        unchanged(fx, before, r);
        expect(r.stderr).toContain(Object.keys(env)[0]);
      }
    },
    CASE_MS,
  );

  it(
    'a CI job running on this machine, or an E2E (managed) run GitHub has queued',
    () => {
      const running = fixture({ state: { runner: true } });
      const before = readFileSync(running.persisted, 'utf8');
      const r = run(running, ['--rotate'], { input: `${OTA}\n` });
      unchanged(running, before, r);
      expect(r.stderr).toContain('Runner.Worker');

      // Queued, or in progress: anything but completed, among the latest runs.
      for (const runs of [
        ['completed', 'queued', 'completed'],
        ['in_progress', 'completed'],
      ]) {
        const queued = fixture({ state: { gh: { authed: true, runs } } });
        const before2 = readFileSync(queued.persisted, 'utf8');
        const r2 = run(queued, ['--rotate'], { input: `${OTA}\n` });
        unchanged(queued, before2, r2);
        expect(r2.stderr).toContain('E2E (managed) has 1 run(s) queued or in progress');
      }
    },
    CASE_MS,
  );

  it(
    'a CI job or an E2E (managed) run that starts while the prompt waits, refused once the name is typed',
    async () => {
      // Both questions answer "none" before the prompt. The answer changes
      // only once the prompt is on the screen, as it does when the schedule or
      // a dispatch starts the gate while nobody has typed yet.
      const ways: Array<{ gh: State['gh']; starts: (s: State) => void; says: string }> = [
        {
          gh: { authed: false, runs: [] },
          starts: (s) => {
            s.runner = true;
          },
          says: 'a GitHub Actions job is running on this machine, after the project name was typed',
        },
        {
          gh: { authed: true, runs: ['completed', 'completed'] },
          starts: (s) => {
            s.gh.runs = ['queued', 'completed', 'completed'];
          },
          says: 'E2E (managed) has 1 run(s) queued or in progress, after the project name was typed',
        },
      ];
      for (const way of ways) {
        const fx = fixture({ state: { gh: way.gh } });
        const before = readFileSync(fx.persisted, 'utf8');
        const { child, finished, sofar } = start(fx, ['--rotate'], { keepInput: true });
        await shown(sofar, `Type the project name (${OTA})`);
        const s = stateOf(fx);
        way.starts(s);
        writeFileSync(fx.statePath, JSON.stringify(s));
        child.stdin.end(`${OTA}\n`);
        const r = await finished;
        unchanged(fx, before, r);
        expect(r.stderr).toContain(way.says);
        expect(r.stderr).toContain('it started while this waited for the name');
        expect(readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-')), 'a copy was kept').toEqual([]);
      }
    },
    CASE_MS * 2,
  );

  it(
    'postgres that is not healthy: starting, or no health at all',
    () => {
      for (const health of ['starting', '']) {
        const fx = fixture({ state: { health: { postgres: health, clickhouse: 'healthy' } } });
        const before = readFileSync(fx.persisted, 'utf8');
        const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
        unchanged(fx, before, r);
        expect(r.stderr).toContain('postgres is not healthy');
        const asked = calls(fx).filter((c) => ['network', 'pooler', 'socket'].includes(c.kind ?? ''));
        expect(asked, 'it asked the database before refusing').toEqual([]);
      }
    },
    CASE_MS,
  );

  it(
    'with --with-trigger-stores: a trigger-db that is not healthy, or that refuses .env\'s value, points to --sync --with-trigger-stores',
    () => {
      // Its role is set and proven like the two above, so it must be up, and
      // hold what .env says: a new value set over one nobody knows could not
      // be put back.
      for (const health of ['starting', '']) {
        const fx = fixture({ state: { health: { postgres: 'healthy', clickhouse: 'healthy', 'trigger-db': health } } });
        const before = readFileSync(fx.persisted, 'utf8');
        const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
        unchanged(fx, before, r);
        expect(r.stderr).toContain('trigger-db is not healthy');
        expect(calls(fx).filter((c) => ['network', 'pooler', 'socket'].includes(c.kind ?? '')), 'it asked a database before refusing').toEqual([]);
      }
      const fx = fixture({ env: { TRIGGER_DB_PASSWORD: 'not-what-trigger-db-has' } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      unchanged(fx, before, r);
      expect(r.stderr).toMatch(/\.env and trigger-db already disagree/);
      expect(r.stderr).toContain('rotate-db-passwords.sh --sync --with-trigger-stores');
      expect(r.output).not.toContain('not-what-trigger-db-has');
      expect(stateOf(fx).trigger).toBe(TRIGGER_PW);
    },
    CASE_MS,
  );

  it(
    'a login role it does not change that a shipped value still opens: named, with 0132 T2 step 5, before anything changes',
    () => {
      // Its own check at the end tries this role too. Without this refusal it
      // wrote .env, changed both roles, failed that check, and put it all back,
      // every time.
      const fx = fixture({
        state: { roles: { ...baseState(OTA).roles, openmigrate: { super: true, login: true, pw: 'change-me-openmigrate' } } },
      });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      unchanged(fx, before, r);
      expect(r.stderr).toMatch(/refused: a shipped value opens openmigrate/);
      expect(r.stderr).toContain('ALTER ROLE openmigrate NOLOGIN');
      expect(r.stderr).toContain('0132 T2, step 5');
      expect(r.stderr).toContain('never DROP');
    },
    CASE_MS,
  );

  it(
    '.env and the database already disagree: it points to --sync',
    () => {
      const fx = fixture({ env: { POSTGRES_PASSWORD: 'not-the-roles-value' } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      unchanged(fx, before, r);
      expect(r.stderr).toContain('--sync');
    },
    CASE_MS,
  );

  it(
    'an owner that is not a login superuser, and an application role other than app_user',
    () => {
      const notSuper = fixture({
        state: { roles: { ...baseState(OTA).roles, pgowner: { super: false, login: true, pw: OWNER_PW } } },
      });
      const before = readFileSync(notSuper.persisted, 'utf8');
      const r = run(notSuper, ['--rotate'], { input: `${OTA}\n` });
      unchanged(notSuper, before, r);
      expect(r.stderr).toContain('superuser');

      const renamed = fixture({
        env: { APP_DB_USER: 'tenant_app' },
        state: { roles: { ...baseState(OTA).roles, tenant_app: { super: false, login: true, pw: APP_PW } } },
      });
      const before2 = readFileSync(renamed.persisted, 'utf8');
      const r2 = run(renamed, ['--rotate'], { input: `${OTA}\n` });
      unchanged(renamed, before2, r2);
      expect(r2.stderr).toContain('APP_DB_USER');
    },
    CASE_MS,
  );

  it(
    'anything but the project name typed back',
    () => {
      const fx = fixture();
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate'], { input: 'yes\n' });
      unchanged(fx, before, r);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// --rotate
// ---------------------------------------------------------------------------

describe('--rotate', () => {
  it(
    'changes .env and both roles, and no new value reaches an argv, the SQL or the output',
    () => {
      const fx = fixture();
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(0);
      const s = stateOf(fx);
      expect(s.generated, 'five values generated').toHaveLength(5);
      for (const v of s.generated) expect(v).toMatch(/^[0-9a-f]{48}$/);

      // .env, through its link, holds the five.
      expect(lstatSync(fx.checkoutEnv).isSymbolicLink(), 'the write replaced the link').toBe(true);
      const env = readFileSync(fx.persisted, 'utf8');
      const value = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(env)?.[1] ?? '';
      for (const k of ['APP_DB_PASSWORD', 'POSTGRES_PASSWORD', 'CLICKHOUSE_PASSWORD', 'MINIO_ROOT_PASSWORD', 'TRIGGER_DB_PASSWORD']) {
        expect(s.generated, `${k} is not one of the generated values`).toContain(value(k));
      }
      expect(new Set(s.generated.map((v) => v)).size).toBe(5);
      // The roles hold what .env holds, trigger-db's too.
      expect(s.roles.app_user?.pw).toBe(value('APP_DB_PASSWORD'));
      expect(s.roles.pgowner?.pw).toBe(value('POSTGRES_PASSWORD'));
      expect(s.trigger).toBe(value('TRIGGER_DB_PASSWORD'));
      // The backup was taken and, on success, removed.
      expect(readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-'))).toEqual([]);

      // By name: the ALTER's environment carried both values, and its SQL neither.
      const alter = calls(fx).find((c) => c.what === 'alter');
      expect(Object.values(alter?.container ?? {})).toEqual(
        expect.arrayContaining([value('APP_DB_PASSWORD'), value('POSTGRES_PASSWORD')]),
      );
      const upsert = calls(fx).filter((c) => c.tool === 'env-upsert');
      expect(upsert.length, 'env-upsert.sh was not used to write .env').toBeGreaterThan(0);
      expect(leaks(fx, r.output)).toEqual([]);

      // What it says: the keys, the outage, the next step, the record.
      for (const k of ['APP_DB_PASSWORD', 'POSTGRES_PASSWORD', 'CLICKHOUSE_PASSWORD', 'MINIO_ROOT_PASSWORD']) {
        expect(r.stdout).toContain(k);
      }
      expect(r.stdout).toContain('E2E (managed)');
      expect(r.stdout).toContain('0132 T0');
      expect(r.stdout).toContain('--check');
      expect(calls(fx).filter((c) => c.tool === 'gh' && c.argv[0] === 'workflow')).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "the owner's run on the OTA stack: --with-trigger-stores replaces trigger-db's published value, by name, and trigger-api is told to take it",
    () => {
      // The OTA stack before the run: no TRIGGER_DB_PASSWORD line, and
      // trigger-db on managed.yml's fallback.
      const fx = fixture({ unset: ['TRIGGER_DB_PASSWORD'], state: { trigger: TRIGGER_LITERAL } });
      const before = readFileSync(fx.persisted, 'utf8');
      expect(before).not.toMatch(/^TRIGGER_DB_PASSWORD=/m);
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(0);
      const s = stateOf(fx);
      const env = readFileSync(fx.persisted, 'utf8');
      const written = /^TRIGGER_DB_PASSWORD=(.*)$/m.exec(env)?.[1] ?? '';
      expect(s.generated, 'TRIGGER_DB_PASSWORD is not one of the generated values').toContain(written);
      expect(s.trigger, "trigger-db's role does not hold what .env holds").toBe(written);
      expect(s.triggerAlters).toBe(1);

      // Written by the one writer of .env, the key on its argv and the value in its environment.
      const upsert = calls(fx).filter((c) => c.tool === 'env-upsert');
      expect(upsert).toHaveLength(1);
      expect(upsert[0]?.argv).toContain('TRIGGER_DB_PASSWORD');
      expect(upsert[0]?.env.TRIGGER_DB_PASSWORD).toBe(written);

      // Set over trigger-db's own socket, as its superuser, the value passed by name.
      const alter = calls(fx).filter((c) => c.what === 'alter' && c.service === 'trigger-db');
      expect(alter).toHaveLength(1);
      expect(alter[0]?.psql?.U).toBe('trigger');
      expect(alter[0]?.psql?.d).toBe('triggerdb');
      expect(alter[0]?.argv).toContain('DB_ROLES_NEW_TRIGGER_PASSWORD');
      expect(alter[0]?.container?.DB_ROLES_NEW_TRIGGER_PASSWORD).toBe(written);
      expect(alter[0]?.container && 'PGPASSWORD' in alter[0].container, 'a password question over the socket').toBe(false);
      expect(alter[0]?.sql).toContain(`\\set trigger_pw \`printf '%s' "$DB_ROLES_NEW_TRIGGER_PASSWORD"\``);
      expect(alter[0]?.sql).not.toContain(written);

      // Proven over the network with the new value, and the fallback refused after.
      const asked = calls(fx).filter((c) => c.kind === 'network' && c.psql?.h === 'trigger-db');
      const proven = asked.findIndex((c) => c.container?.PGPASSWORD === written);
      expect(proven, 'the new value was not asked over the network').toBeGreaterThan(-1);
      expect(asked.slice(proven).some((c) => c.container?.PGPASSWORD === TRIGGER_LITERAL), 'the fallback was not asked after').toBe(true);
      expect(leaks(fx, r.output)).toEqual([]);

      // What it says: trigger-db changed, trigger-api has to be recreated, and the record.
      expect(r.stdout).toContain('TRIGGER_DB_PASSWORD');
      expect(r.stdout).toMatch(/trigger-db's trigger accepts its new value/);
      expect(r.stdout).toMatch(/trigger-api/);
      expect(r.stdout).toContain("trigger-db's with them");

      // And the check, run after the gate has recreated the containers, exits 0.
      const check = run(fx, ['--check']);
      expect(check.status, check.output).toBe(0);
      expect(check.stdout).toMatch(/trigger-db trigger, compose's default: refused/);
      expect(leaks(fx, check.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'from the stack as it stands: the owner on the example\'s value, app_user on the migration\'s, APP_DB_PASSWORD empty',
    () => {
      // The state T0 step 2 exists for. Every check before the prompt passes
      // on it, and the one at the end finds nothing shipped left.
      const fx = fixture({
        env: { POSTGRES_PASSWORD: 'change-me-openmigrate', APP_DB_PASSWORD: '' },
        state: {
          roles: {
            ...baseState(OTA).roles,
            pgowner: { super: true, login: true, pw: 'change-me-openmigrate' },
            app_user: { super: false, login: true, pw: 'app_password' },
          },
        },
      });
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(0);
      const s = stateOf(fx);
      expect(s.generated).toHaveLength(2);
      expect(s.generated).toContain(s.roles.pgowner?.pw);
      expect(s.generated).toContain(s.roles.app_user?.pw);
      const env = readFileSync(fx.persisted, 'utf8');
      expect(env).toContain(`POSTGRES_PASSWORD=${s.roles.pgowner?.pw}`);
      expect(env).toContain(`APP_DB_PASSWORD=${s.roles.app_user?.pw}`);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'without --with-trigger-stores it leaves ClickHouse, MinIO and trigger-db alone, and does not need trigger-db up',
    () => {
      const fx = fixture({
        unset: ['TRIGGER_DB_PASSWORD'],
        state: { trigger: TRIGGER_LITERAL, health: { postgres: 'healthy', clickhouse: 'healthy', 'trigger-db': '' } },
      });
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(0);
      expect(stateOf(fx).generated).toHaveLength(2);
      const env = readFileSync(fx.persisted, 'utf8');
      expect(env).toContain(`CLICKHOUSE_PASSWORD=${CH_PW}`);
      expect(env).toContain(`MINIO_ROOT_PASSWORD=${MINIO_PW}`);
      expect(env).not.toMatch(/^TRIGGER_DB_PASSWORD=/m);
      expect(stateOf(fx).trigger).toBe(TRIGGER_LITERAL);
      expect(calls(fx).filter((c) => c.service === 'trigger-db' || c.psql?.h === 'trigger-db'), 'trigger-db was asked').toEqual([]);
    },
    CASE_MS,
  );

  it(
    'dispatches E2E (managed) on main itself when gh is signed in',
    () => {
      const fx = fixture({ state: { gh: { authed: true, runs: ['completed', 'completed'] } } });
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(0);
      // Asked before the prompt, and again once the name is typed.
      const listed = calls(fx).filter((c) => c.tool === 'gh' && c.argv[0] === 'run');
      expect(listed, 'GitHub was not asked, before the prompt and after it, whether E2E (managed) is queued').toHaveLength(2);
      const dispatched = calls(fx).filter((c) => c.tool === 'gh' && c.argv[0] === 'workflow');
      expect(dispatched.map((c) => c.argv.join(' '))).toEqual(['workflow run e2e-managed.yml --ref main']);
    },
    CASE_MS,
  );

  it(
    'a failed ALTER puts .env back through its link, leaves the roles as they were, and names the step',
    () => {
      const fx = fixture({ state: { alterFail: 1 } });
      const before = readFileSync(fx.persisted, 'utf8');
      const rolesBefore = JSON.stringify(stateOf(fx).roles);
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(lstatSync(fx.checkoutEnv).isSymbolicLink()).toBe(true);
      expect(JSON.stringify(stateOf(fx).roles)).toBe(rolesBefore);
      expect(r.stderr).toContain('FAILED');
      expect(r.stderr).toMatch(/setting the roles/);
      expect(r.stderr).toMatch(/restored/);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'a check that fails after the ALTER sets the roles back to the old values too',
    () => {
      // The pooler refuses every generated value: the ALTER took, the proof did not.
      const fx = fixture({ state: { poolerRefusesPrefix: GEN } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      const s = stateOf(fx);
      expect(s.alters, 'the new values were set, then the old ones').toBe(2);
      expect(s.roles.app_user?.pw).toBe(APP_PW);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(r.stderr).toContain('FAILED');
      expect(r.stderr).toMatch(/restored/);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'a putting back that cannot complete keeps the old .env at mode 0600, and says what to do without a value',
    () => {
      // The pooler refuses every generated value, so the proof fails after the
      // ALTER took; the ALTER that would set the old values back fails too.
      const fx = fixture({ state: { poolerRefusesPrefix: GEN, alterFailAt: [2] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toContain('THE PUTTING BACK DID NOT COMPLETE');
      const kept = readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-'));
      expect(kept, 'the old .env was not kept').toHaveLength(1);
      const keptPath = join(dirname(fx.persisted), kept[0] ?? '');
      // It holds every secret .env holds.
      expect((statSync(keptPath).mode & 0o777).toString(8), 'the kept copy is readable by others').toBe('600');
      expect(readFileSync(keptPath, 'utf8')).toBe(before);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(r.stderr).toContain(`cp ${keptPath} ${realpathSync(fx.persisted)}`);
      expect(r.stderr).toContain('rotate-db-passwords.sh --sync');
      expect(r.stderr).toContain('rotate-db-passwords.sh --check');
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'an interrupt during the proof puts everything back, and INT, TERM or HUP while it does so do not stop it',
    async () => {
      const fx = fixture({ state: { pause: ['prove-new', 'alter-2'] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const { child, finished } = start(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      // Ctrl-C while the new values are being proven.
      await pausedAt(fx, 'prove-new');
      child.kill('SIGINT');
      resume(fx, 'prove-new');
      // And again, and TERM and HUP, while the old values are being set back.
      await pausedAt(fx, 'alter-2');
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) child.kill(sig);
      resume(fx, 'alter-2');
      const r = await finished;
      expect(r.signal, `killed while putting back: ${r.output}`).toBeNull();
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while proving the new values[^\n]*: interrupted/);
      expect(r.stderr).toMatch(/restored/);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      const s = stateOf(fx);
      expect(s.roles.app_user?.pw).toBe(APP_PW);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-'))).toEqual([]);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "a failed ALTER in trigger-db puts .env and both roles back, and trigger-db keeps the value it had",
    () => {
      const fx = fixture({ unset: ['TRIGGER_DB_PASSWORD'], state: { trigger: TRIGGER_LITERAL, triggerAlterFailAt: [1] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while setting trigger-db's role/);
      expect(r.stderr).toMatch(/restored/);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(lstatSync(fx.checkoutEnv).isSymbolicLink()).toBe(true);
      const s = stateOf(fx);
      expect(s.roles.app_user?.pw).toBe(APP_PW);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(s.trigger).toBe(TRIGGER_LITERAL);
      expect(readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-'))).toEqual([]);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "trigger-db refusing its new value after the ALTER: its role is set back to the old .env's value too, the published fallback on the OTA stack",
    () => {
      const fx = fixture({ unset: ['TRIGGER_DB_PASSWORD'], state: { trigger: TRIGGER_LITERAL, triggerRefusesPrefix: GEN } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while proving trigger-db's new value/);
      expect(r.stderr).toMatch(/restored/);
      const s = stateOf(fx);
      expect(s.triggerAlters, 'the new value was set, then the old one').toBe(2);
      expect(s.trigger).toBe(TRIGGER_LITERAL);
      expect(s.roles.app_user?.pw).toBe(APP_PW);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "an interrupt while trigger-db's ALTER runs puts trigger-db back too",
    async () => {
      const fx = fixture({ state: { pause: ['trigger-alter-1'] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const { child, finished } = start(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      // Ctrl-C while the ALTER is on its way: whether it took is not known.
      await pausedAt(fx, 'trigger-alter-1');
      child.kill('SIGINT');
      resume(fx, 'trigger-alter-1');
      const r = await finished;
      expect(r.signal, r.output).toBeNull();
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while setting trigger-db's role[^\n]*: interrupted/);
      expect(r.stderr).toMatch(/restored/);
      const s = stateOf(fx);
      expect(s.triggerAlters, 'the ALTER the interrupt arrived during, and the one that set it back').toBe(2);
      expect(s.trigger).toBe(TRIGGER_PW);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'a putting back of trigger-db that cannot complete keeps the old .env, and step 2 is --sync --with-trigger-stores',
    () => {
      // trigger-db refuses every generated value, so its proof fails after the
      // ALTER took; the ALTER that would set the old value back fails too.
      const fx = fixture({ state: { triggerRefusesPrefix: GEN, triggerAlterFailAt: [2] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toContain('THE PUTTING BACK DID NOT COMPLETE');
      expect(r.stderr).toMatch(/trigger-db's trigger does not accept its old value again/);
      const kept = readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-'));
      expect(kept, 'the old .env was not kept').toHaveLength(1);
      const keptPath = join(dirname(fx.persisted), kept[0] ?? '');
      expect((statSync(keptPath).mode & 0o777).toString(8)).toBe('600');
      expect(readFileSync(keptPath, 'utf8')).toBe(before);
      expect(r.stderr).toContain('rotate-db-passwords.sh --sync --with-trigger-stores');
      // The two roles went back: only trigger-db is left to do.
      expect(stateOf(fx).roles.pgowner?.pw).toBe(OWNER_PW);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "the fallback still opening trigger-db after its ALTER fails the rotation, and everything goes back",
    () => {
      // A trigger-db that opens with the published value whatever its role
      // holds (trust on the network, say): the new value proves nothing.
      const fx = fixture({ unset: ['TRIGGER_DB_PASSWORD'], state: { trigger: TRIGGER_LITERAL, triggerAlsoOpens: [TRIGGER_LITERAL] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stdout).toMatch(/trigger-db trigger, compose's default: OPENS/);
      expect(r.stderr).toMatch(/FAILED while checking that no shipped value opens a role: a shipped value still opens a role/);
      expect(r.stderr).toMatch(/restored/);
      expect(r.output, 'it said the fallback no longer opens').not.toMatch(/no longer opens it/);
      const s = stateOf(fx);
      expect(s.trigger).toBe(TRIGGER_LITERAL);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(s.roles.app_user?.pw).toBe(APP_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "the fallback that cannot be asked of trigger-db after its ALTER fails the rotation too",
    () => {
      const fx = fixture({ state: { triggerUnasked: [TRIGGER_LITERAL] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stdout).toMatch(/trigger-db trigger, compose's default: could not be asked/);
      expect(r.stderr).toMatch(/FAILED while checking that no shipped value opens a role: a shipped value could not be asked/);
      expect(r.stderr).toMatch(/restored/);
      expect(stateOf(fx).trigger).toBe(TRIGGER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "trigger-db's new value that cannot be asked over the network is not a proof: the rotation fails and puts it back",
    () => {
      const fx = fixture({ state: { triggerUnasked: [GEN] } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while proving trigger-db's new value over the network: trigger did not accept its new value/);
      expect(r.stderr).toMatch(/restored/);
      const s = stateOf(fx);
      expect(s.triggerAlters, 'the new value was set, then the old one').toBe(2);
      expect(s.trigger).toBe(TRIGGER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'plain --rotate that fails puts the two roles back and asks trigger-db nothing, even with trigger-db down',
    () => {
      // Without the flag trigger-db was never touched, so the putting back has
      // nothing to set there, and must not report it as left undone.
      const fx = fixture({
        state: { alterFail: 1, triggerDown: true, health: { postgres: 'healthy', clickhouse: 'healthy', 'trigger-db': '' } },
      });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while setting the roles/);
      expect(r.stderr).toMatch(/restored/);
      expect(r.stderr).not.toContain('THE PUTTING BACK DID NOT COMPLETE');
      expect(r.stderr).not.toContain("trigger-db's over the network");
      expect(calls(fx).filter((c) => c.service === 'trigger-db' || c.psql?.h === 'trigger-db'), 'trigger-db was asked').toEqual([]);
      expect(stateOf(fx).trigger).toBe(TRIGGER_PW);
      expect(readFileSync(fx.persisted, 'utf8')).toBe(before);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'a write of .env that stops halfway is put back through the link, and no role, trigger-db\'s included, is changed',
    () => {
      const fx = fixture({ state: { upsertWritesOnlyFirst: true } });
      const before = readFileSync(fx.persisted, 'utf8');
      const r = run(fx, ['--rotate', '--with-trigger-stores'], { input: `${OTA}\n` });
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toMatch(/FAILED while writing \.env: env-upsert\.sh refused/);
      expect(r.stderr).toMatch(/restored/);
      expect(readFileSync(fx.persisted, 'utf8'), 'the half-written .env was left').toBe(before);
      expect(lstatSync(fx.checkoutEnv).isSymbolicLink()).toBe(true);
      const s = stateOf(fx);
      expect(s.roles.pgowner?.pw).toBe(OWNER_PW);
      expect(s.roles.app_user?.pw).toBe(APP_PW);
      expect(s.triggerAlterAttempts, "trigger-db's ALTER was sent").toBe(0);
      expect(s.trigger).toBe(TRIGGER_PW);
      expect(readdirSync(dirname(fx.persisted)).filter((f) => f.startsWith('.env.before-rotation-'))).toEqual([]);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    'a leftover role that no shipped value opens, or that cannot log in, does not stop it',
    () => {
      for (const openmigrate of [
        { super: true, login: true, pw: 'leftover-secret-5a5a' },
        { super: true, login: false, pw: 'openmigrate_password' },
      ]) {
        const fx = fixture({ state: { roles: { ...baseState(OTA).roles, openmigrate } } });
        const r = run(fx, ['--rotate'], { input: `${OTA}\n` });
        expect(r.status, r.output).toBe(0);
        expect(stateOf(fx).roles.openmigrate).toEqual(openmigrate);
        expect(leaks(fx, r.output)).toEqual([]);
      }
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// --sync
// ---------------------------------------------------------------------------

describe('--sync', () => {
  it(
    'sets both roles to what .env holds, proves it over the network, and changes nothing the second time',
    () => {
      const fx = fixture({
        state: {
          roles: {
            ...baseState(OTA).roles,
            pgowner: { super: true, login: true, pw: 'openmigrate_password' },
            app_user: { super: false, login: true, pw: 'app_password' },
          },
        },
      });
      const r = run(fx, ['--sync']);
      expect(r.status, r.output).toBe(0);
      expect(stateOf(fx).roles.pgowner?.pw).toBe(OWNER_PW);
      expect(stateOf(fx).roles.app_user?.pw).toBe(APP_PW);
      const again = run(fx, ['--sync']);
      expect(again.status, again.output).toBe(0);
      expect(stateOf(fx).roles.pgowner?.pw).toBe(OWNER_PW);
      expect(leaks(fx, `${r.output}\n${again.output}`)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "with --with-trigger-stores it sets trigger-db's role to .env's value too, and plain --sync leaves trigger-db alone",
    () => {
      // A putting back that did not complete leaves trigger-db on a value .env
      // no longer holds: this is the step the script prints for it.
      const fx = fixture({ state: { trigger: `${GEN}stale` } });
      const plain = run(fx, ['--sync']);
      expect(plain.status, plain.output).toBe(0);
      expect(stateOf(fx).trigger).toBe(`${GEN}stale`);
      expect(calls(fx).filter((c) => c.service === 'trigger-db' || c.psql?.h === 'trigger-db')).toEqual([]);

      const r = run(fx, ['--sync', '--with-trigger-stores']);
      expect(r.status, r.output).toBe(0);
      expect(stateOf(fx).trigger).toBe(TRIGGER_PW);
      const alter = calls(fx).filter((c) => c.what === 'alter' && c.service === 'trigger-db');
      expect(alter).toHaveLength(1);
      expect(alter[0]?.container?.DB_ROLES_NEW_TRIGGER_PASSWORD).toBe(TRIGGER_PW);
      expect(r.stdout).toMatch(/trigger-db trigger, over the network: opens/);
      expect(leaks(fx, `${plain.output}\n${r.output}`)).toEqual([]);

      // It names no mode it does not belong to.
      expect(run(fx, ['--check', '--with-trigger-stores']).status).toBe(2);
    },
    CASE_MS,
  );

  it(
    "--sync --with-trigger-stores is not done when trigger-db refuses .env's value after the set",
    () => {
      // The step printed when a putting back does not complete: it must not
      // say done while trigger-api would still be refused.
      const fx = fixture({ state: { triggerRefusesPrefix: 'trigger-secret' } });
      const r = run(fx, ['--sync', '--with-trigger-stores']);
      expect(r.status, r.output).toBe(1);
      expect(r.stdout).toMatch(/trigger-db trigger, over the network: REFUSED/);
      expect(r.stderr).toContain('FAILED: the ALTER took and a role still refuses');
      expect(r.output).not.toMatch(/done: /);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    "--sync --with-trigger-stores is not done when trigger-db's set fails",
    () => {
      const fx = fixture({ state: { triggerAlterFailAt: [1] } });
      const r = run(fx, ['--sync', '--with-trigger-stores']);
      expect(r.status, r.output).toBe(1);
      expect(r.stderr).toContain("FAILED: trigger-db's role was not changed");
      expect(r.output).not.toMatch(/done: /);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it(
    '--sync --with-trigger-stores refuses a trigger-db that is not healthy before it sets anything',
    () => {
      for (const health of ['starting', '']) {
        const fx = fixture({ state: { health: { postgres: 'healthy', clickhouse: 'healthy', 'trigger-db': health } } });
        const before = readFileSync(fx.persisted, 'utf8');
        const r = run(fx, ['--sync', '--with-trigger-stores']);
        unchanged(fx, before, r);
        expect(r.stderr).toContain('trigger-db is not healthy');
        expect(calls(fx).filter((c) => ['network', 'pooler', 'socket'].includes(c.kind ?? '')), 'it asked a database before refusing').toEqual([]);
      }
    },
    CASE_MS,
  );

  it(
    "the helper refuses an empty value for trigger-db's role, which Postgres would take as no password, and asks docker nothing",
    () => {
      // --sync, --rotate and the putting back all set trigger-db through it.
      const fx = fixture();
      writeFileSync(
        join(fx.compose, 'trigger-set-empty.sh'),
        [
          'set -euo pipefail',
          'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
          '. "${SCRIPT_DIR}/db-roles.sh"',
          'COMPOSE=(docker compose)',
          'rc=0',
          'db_roles_trigger_set "" || rc=$?',
          'printf "rc=%s why=%s\\n" "$rc" "$DB_ROLES_WHY"',
        ].join('\n'),
      );
      const r = run(fx, [], { script: 'trigger-set-empty.sh' });
      expect(r.status, r.output).toBe(0);
      expect(r.stdout).toContain('rc=1 why=an empty password was given; nothing was set');
      expect(calls(fx).filter((c) => c.tool === 'docker'), 'docker was asked').toEqual([]);
      expect(stateOf(fx).trigger).toBe(TRIGGER_PW);
    },
    CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The script's own text
// ---------------------------------------------------------------------------

describe("the script's own text", () => {
  const script = readIf(`deploy/compose/${SCRIPT}`);
  const helper = readIf(`deploy/compose/${HELPER}`);
  const list = readIf('deploy/compose/shipped-passwords.sh');
  const code = (text: string) =>
    text
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

  it('exists, beside its helper', () => {
    expect(script, `deploy/compose/${SCRIPT} is missing`).not.toBe('');
    expect(helper, `deploy/compose/${HELPER} is missing`).not.toBe('');
  });

  it('reads the shell flags and switches tracing off before anything else runs', () => {
    const first = code(script)
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#!'))[0];
    expect(first).toMatch(/\$-/);
    expect(first).toMatch(/set \+x/);
  });

  it('never traces, never runs `compose up`, never hands a container `-e NAME=value`', () => {
    for (const [name, text] of [
      [SCRIPT, code(script)],
      [HELPER, code(helper)],
    ] as const) {
      // As a command, where a line or a `;`, `&&` or `||` starts one: the
      // refusal's own words name `set -x`, and that is not tracing.
      expect(text, name).not.toMatch(/(^|[;&|])\s*set\s+-[a-z]*x/m);
      expect(text, name).not.toMatch(/compose\b[^\n]*\bup\b/);
      expect(text, name).not.toMatch(/\s-e\s+["']?[A-Z_]+=/);
    }
  });

  it("compose's defaults in the helper are managed.yml's", () => {
    // A default that drifted would test the wrong value and call it the right one.
    const yml = read('deploy/compose/managed.yml');
    for (const [key, value] of [
      ['POSTGRES_USER', 'openmigrate'],
      ['POSTGRES_PASSWORD', 'openmigrate_password'],
      ['POSTGRES_DB', 'openmigrate'],
      ['APP_DB_USER', 'app_user'],
      ['APP_DB_PASSWORD', 'app_password'],
      ['CLICKHOUSE_PASSWORD', 'password'],
      ['MINIO_ROOT_PASSWORD', 'very-safe-password'],
    ]) {
      expect(yml, `managed.yml's default for ${key}`).toContain(`\${${key}:-${value}}`);
      expect(`${helper}\n${script}\n${list}`, `the default for ${key}`).toMatch(new RegExp(`${key}\\b[^\\n]*\\b${value}\\b`));
    }
    // What managed.env.example shipped until 2026-10-05, when it began to ship
    // the four empty (0132 T2): a .env copied from it may hold them still, so
    // the list the check tries keeps them (shipped-passwords.sh).
    const example = read('deploy/compose/managed.env.example');
    for (const value of ['change-me-openmigrate', 'change-me-clickhouse', 'change-me-minio']) {
      expect(example).not.toMatch(new RegExp(`^[A-Z_]+=${value}$`, 'm'));
      expect(list).toContain(value);
    }
    expect(script).toMatch(/\. "\$\{SCRIPT_DIR\}\/shipped-passwords\.sh"/);
    expect(read('packages/ledger/migrations/0001_baseline.sql')).toContain("PASSWORD 'app_password'");
  });

  it("trigger-db's role and database in the helper are managed.yml's, which .env cannot change", () => {
    const yml = read('deploy/compose/managed.yml');
    const service = /^ {2}trigger-db:\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\s*$)/m.exec(yml)?.[1] ?? '';
    expect(service, 'no trigger-db service in managed.yml').not.toBe('');
    expect(service).toMatch(/^ {6}POSTGRES_USER: trigger$/m);
    expect(service).toMatch(/^ {6}POSTGRES_DB: triggerdb$/m);
    expect(code(helper)).toMatch(/^DB_ROLES_TRIGGER_ROLE='trigger'$/m);
    expect(code(helper)).toMatch(/^DB_ROLES_TRIGGER_DB='triggerdb'$/m);
  });

  it('every service that logs in to trigger-db reads TRIGGER_DB_PASSWORD, and the gate\'s bring-up recreates it', () => {
    // The rotation changes trigger-db's role and .env; the containers take
    // the new value only when they are recreated from that .env, which the
    // E2E (managed) run it dispatches does: its bring-up runs from `data`,
    // and the trigger phase brings trigger-db up, sets its role to .env's
    // value, and then brings trigger-api up again.
    const yml = read('deploy/compose/managed.yml');
    const services = [...yml.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)];
    const clients: string[] = [];
    for (const [k, m] of services.entries()) {
      const end = services[k + 1]?.index ?? yml.indexOf('\nvolumes:', m.index);
      const block = yml.slice(m.index, end < 0 ? undefined : end);
      const lines = block.split('\n').filter((l) => /@trigger-db\b|-h trigger-db\b|PGHOST: trigger-db/.test(l) && !/^\s*#/.test(l));
      if (lines.length === 0) continue;
      clients.push(m[1]!);
      for (const line of lines) expect(line, `${m[1]} logs in to trigger-db without TRIGGER_DB_PASSWORD`).toContain('${TRIGGER_DB_PASSWORD:-');
    }
    expect(clients, 'the services that log in to trigger-db with a password').toEqual(['trigger-api']);
    const gate = read('.github/workflows/e2e-managed.yml');
    expect(gate).toMatch(/bootstrap-managed\.sh --from data\b/);
    const bringUp = read('deploy/compose/bootstrap-managed.sh');
    const phase = bringUp.slice(bringUp.indexOf('phase_trigger() {'), bringUp.indexOf('\n}\n', bringUp.indexOf('phase_trigger() {')));
    const dbUp = phase.search(/^\s*up_wait trigger-db\b/m);
    const set = phase.search(/^\s*trigger_db_role_matches_env$/m);
    const apiUp = phase.search(/^\s*up_wait (?:[^\n\\]|\\\n)*\btrigger-api\b/m);
    expect(dbUp, 'the trigger phase does not bring trigger-db up').toBeGreaterThan(-1);
    expect(set, "the trigger phase does not set trigger-db's role to .env's value after it is up").toBeGreaterThan(dbUp);
    expect(apiUp, 'the trigger phase does not bring trigger-api up after the role is set').toBeGreaterThan(set);
  });

  it("live stays as it is: stand-up-live.sh generates TRIGGER_DB_PASSWORD for live's new trigger_db_data", () => {
    // So live's trigger-db never holds the fallback, --check stays 0 there,
    // and --rotate and --sync refuse live (above).
    const standUp = code(read('deploy/compose/stand-up-live.sh'));
    expect(standUp).toContain("'TRIGGER_DB_PASSWORD trigger_db_data'");
  });
});

// ---------------------------------------------------------------------------
// The small fixes beside it
// ---------------------------------------------------------------------------

describe('the small fixes beside it', () => {
  it(
    'zitadel-db-password.sh passes both passwords by name, never on docker\'s argv',
    () => {
      const fx = fixture({ env: { ZITADEL_DB_PASSWORD: 'zitadel-new-secret-4e4e' } });
      const r = run(fx, ['--sync'], { script: 'zitadel-db-password.sh' });
      expect(r.status, r.output).toBe(0);
      expect(stateOf(fx).roles.zitadel?.pw).toBe('zitadel-new-secret-4e4e');
      const argv = calls(fx).flatMap((c) => c.argv);
      expect(argv.filter((a) => a.includes('zitadel-new-secret-4e4e') || a.includes(OWNER_PW))).toEqual([]);
      const asked = calls(fx).filter((c) => c.kind === 'zitadel');
      expect(asked.length).toBeGreaterThan(1);
      expect(asked.every((c) => c.argv.includes('PGPASSWORD'))).toBe(true);
    },
    CASE_MS,
  );

  it(
    "seed-managed.sh's remedy names the script that syncs the roles, and no role name of its own",
    () => {
      const fx = fixture();
      const r = run(fx, [], { script: 'seed-managed.sh' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('rotate-db-passwords.sh --sync');
      expect(r.stderr).not.toMatch(/openmigrate/);
      expect(leaks(fx, r.output)).toEqual([]);
    },
    CASE_MS,
  );

  it('env-upsert.sh takes a value from the environment by name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rotate-upsert-'));
    tempDirs.push(dir);
    const file = join(dir, '.env');
    writeFileSync(file, 'A=1\nB=2\n');
    const upsert = join(COMPOSE_DIR, 'env-upsert.sh');
    const ok = spawnSync('bash', [upsert, '--from-env', file, 'B', 'C'], {
      env: { PATH: '/usr/bin:/bin', B: 'from-the-environment', C: 'new-key' },
      encoding: 'utf8',
    });
    expect(ok.status, ok.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('A=1\nB=from-the-environment\nC=new-key\n');
    expect(`${ok.stdout}${ok.stderr}`).not.toContain('from-the-environment');

    const unset = spawnSync('bash', [upsert, '--from-env', file, 'D'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    expect(unset.status).toBe(1);
    expect(unset.stderr).toContain('D');
    const pair = spawnSync('bash', [upsert, '--from-env', file, 'E=x'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    expect(pair.status).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('A=1\nB=from-the-environment\nC=new-key\n');
  });

  it('the docs say how, and who holds the owner connection', () => {
    const bringUp = read('docs/managed-bring-up.md');
    const rotating = bringUp.slice(bringUp.indexOf('**Rotating a secret**'));
    expect(rotating.slice(0, 1500)).toContain('rotate-db-passwords.sh');
    const procedure = bringUp.slice(bringUp.indexOf('### Changing the database passwords'));
    expect(procedure.length, 'no section "Changing the database passwords"').toBeGreaterThan(200);
    // The section, to the next heading.
    const steps = procedure.slice(0, procedure.indexOf('\n### ', 1) > 0 ? procedure.indexOf('\n### ', 1) : 8000);
    for (const step of ['--check', '--rotate', 'E2E (managed)', '0132 T0']) expect(steps).toContain(step);
    expect(steps.indexOf('--rotate')).toBeGreaterThan(steps.indexOf('--check'));
    // trigger-db is one of the stores the flag changes, and nothing says it waits any more.
    const row = (mode: string) => steps.split('\n').find((l) => l.startsWith(`| \`${mode}`)) ?? '';
    expect(row('--rotate'), 'the --rotate row').toContain('`TRIGGER_DB_PASSWORD`');
    expect(row('--check'), 'the --check row').toMatch(/`trigger-db`[^|]*counted like the others/);
    expect(row('--sync'), 'the --sync row').toMatch(/--with-trigger-stores[^|]*`trigger-db`/);
    expect(steps).toContain('--sync --with-trigger-stores');
    expect(steps, 'the old wording').not.toMatch(/uncounted|waiting for the code that rotates it|T2's next step|Both controls/);
    // The owner's checkout is pulled by hand, and an older script changes the
    // stores again and leaves trigger-db alone: step 1 pulls first, and names
    // the line of --help only this script has.
    const first = steps.slice(steps.indexOf('\n1. '), steps.indexOf('\n2. '));
    expect(first).toContain('git pull');
    expect(first).toContain('`--sync [--with-trigger-stores]`');
    expect(first.indexOf('git pull')).toBeLessThan(first.indexOf('rotate-db-passwords.sh --check'));
    expect(read(`deploy/compose/${SCRIPT}`).split('\n').slice(0, 12).join('\n')).toContain('rotate-db-passwords.sh --sync [--with-trigger-stores]');
    // Step 2 says trigger-api loses its own database at the ALTER, not only the app.
    const second = steps.slice(steps.indexOf('\n2. '), steps.indexOf('\n3. '));
    expect(second).toMatch(/`trigger-api`[^]*fails at its migration/);
    expect(read('docs/rls-guide.md')).toContain('deploy/compose/rotate-db-passwords.sh');
  });
});
