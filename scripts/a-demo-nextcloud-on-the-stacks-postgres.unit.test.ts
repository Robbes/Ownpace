// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEMO NEXTCLOUD ON THE STACK'S POSTGRES (workplan 0150; the owner,
 * 2026-09-29: "ok, we'll move to postgres", and of the follow-up: "You take
 * that aswell").
 *
 * The demo Nextcloud kept its database in SQLite, one writer at a time, while
 * the owner's migrations and the nightly gate wrote into it: the gate's writes
 * were refused with "database is locked" (E2E (managed) #222, #223). The OTA
 * stack was moved by hand that morning. Since then:
 *
 *   A FRESH INSTALL STARTS ON POSTGRES. managed.yml gives Nextcloud's first
 *   install POSTGRES_*, with .env's NEXTCLOUD_DB_PASSWORD (ensure-env-secrets.sh
 *   makes it), and the bring-up's `data` phase makes the role and the database
 *   before the first start (bootstrap-managed.sh, nextcloud-db.sh).
 *   A ROLE AN INSTALLED NEXTCLOUD USES KEEPS ITS PASSWORD. That Nextcloud
 *   connects with its own config.php's value; setting another on the role is
 *   the 500s of 2026-09-29. The bring-up says when the two differ, and only
 *   when no Nextcloud is installed does the role take .env's value. A database
 *   that still holds a gone install's tables is refused: an install cannot go
 *   into them.
 *   AN INSTALL ON SQLITE IS MOVED BY A SCRIPT, not by hand
 *   (nextcloud-to-postgres.sh --convert), with Nextcloud stopped throughout,
 *   both workarounds (no --all-apps; the counters set by
 *   nextcloud-counters.sql, see a-counter-no-default-names), the copy checked
 *   by counting rows on both sides, config.php switched in one write, and
 *   config.php put back whenever any of that fails.
 *   ONE PASSWORD IN THREE PLACES (--sync-password): config.php first, while the
 *   old value still opens the role, then the role; and the 2026-09-29 state,
 *   where the role took a value config.php does not hold, put right first.
 *
 * HOW IT RUNS. No docker and no database: `docker` is a stand-in on the PATH
 * that keeps a small state in files (the role and its password, the database,
 * the volume, config.php and its copy, what the converter does) and answers
 * each call as the real thing would for that state, the way
 * rotate-db-passwords.unit.test.ts's does. The script runs as it is in the
 * repository, from a checkout of its own; the bring-up's two functions are
 * taken out of bootstrap-managed.sh as they are written and run under its own
 * `set -euo pipefail`. Every call's arguments are logged, and every value
 * passed by name is logged apart, so a case can say where a password went and
 * where it never did. That the real converter, counters and Nextcloud behave as
 * the stand-in says was shown on Nextcloud 34.0.4 and Postgres 18 (the PR).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** A value made here, so it can be looked for everywhere it must not be. */
const aPassword = (): string => `pw${randomBytes(12).toString('hex')}`;

// ---------------------------------------------------------------------------
// The stand-in
// ---------------------------------------------------------------------------

const DOCKER = `#!/usr/bin/env bash
# The docker stand-in. State in $STATE; every call's arguments in $STAND_IN_LOG,
# every value passed by name in $STAND_IN_VALUES.
set -u
S="$STATE"
has() { [ -e "$S/$1" ]; }
get() { cat "$S/$1" 2>/dev/null || true; }
put() { printf '%s' "$2" >"$S/$1"; }
printf '%s\\n' "$*" >>"$STAND_IN_LOG"
for name in NEXTCLOUD_DB_NEW_PASSWORD NEXTCLOUD_DB_ENV_PASSWORD PGPASSWORD; do
  if [ -n "\${!name+set}" ]; then printf '%s=%s\\n' "$name" "\${!name}" >>"$STAND_IN_VALUES"; fi
done
args=" $* "

cfg_line() { # the line nextcloud-db.sh's php prints
  if ! has cfg_installed; then echo 'cfg|no'; return; fi
  local same=differs
  [ -n "\${NEXTCLOUD_DB_ENV_PASSWORD:-}" ] && [ "$(get cfg_pw)" = "$NEXTCLOUD_DB_ENV_PASSWORD" ] && same=same
  echo "cfg|$(get cfg_installed)|$(get cfg_type)|nextcloud|postgres|nextcloud|oc_|/var/www/html/data|$same"
}
occ_boots() { # occ needs its database: on pgsql, config.php's value must open the role
  [ "$(get cfg_type)" != pgsql ] || [ "$(get cfg_pw)" = "$(get role_pw)" ]
}

if [ "$1" = volume ] && [ "$2" = inspect ]; then has volume; exit; fi

if [ "$1" = run ]; then # docker run …: a network question, as the role nextcloud
  if has role && [ "\${PGPASSWORD:-}" = "$(get role_pw)" ]; then echo 1; exit 0; fi
  echo 'psql: error: connection to server at "postgres" (192.0.2.10), port 5432 failed: FATAL:  password authentication failed for user "nextcloud"' >&2
  exit 2
fi

[ "$1" = compose ] || { echo "stand-in: no answer for: $*" >&2; exit 99; }
shift
# Compose's own options, then its command, then the command's options up to the service.
while [ $# -gt 0 ]; do case "$1" in -f | --env-file | -p) shift 2 ;; *) break ;; esac; done
sub="$1"
shift
entrypoint=''
case "$sub" in
  exec | run)
    while [ $# -gt 0 ]; do
      case "$1" in
        -T | --rm | --no-deps | -d) shift ;;
        -u | --user | -e) shift 2 ;;
        --entrypoint) entrypoint="$2"; shift 2 ;;
        *) break ;;
      esac
    done
    ;;
esac
service="\${1:-}"
[ $# -eq 0 ] || shift
rest=" $* "

case "$sub" in
  ps)
    case "$args" in
      *'{{.Health}} postgres '*) get pg_health ;;
      *'{{.Health}} nextcloud '*) if has running; then echo healthy; fi ;;
      *' -q nextcloud '*) if has running; then echo 0123456789ab; fi ;;
    esac
    exit 0
    ;;
  stop) rm -f "$S/running"; echo 'event=stop' >>"$STAND_IN_LOG"; exit 0 ;;
  up) touch "$S/running"; echo 'event=start' >>"$STAND_IN_LOG"; exit 0 ;;
esac

if [ "$sub" = exec ] && [ "$service" = postgres ]; then
  case "$rest" in
    *pg_tables*) get tables; exit 0 ;;
  esac
  stdin="$(cat)"
  case "$stdin" in
    *"SELECT 'role', rolsuper"*)
      if has role; then echo "role|$(get role_attrs)"; fi
      if has db; then echo "owner|$(get db_owner)"; fi
      exit 0
      ;;
    *'CREATE ROLE :"nc_role"'*)
      [[ "$stdin" == *'log_min_error_statement = panic'* ]] || echo 'event=logged' >>"$STAND_IN_LOG"
      if ! has role; then touch "$S/role"; put role_attrs 'f|f|f|f|f|t'; put role_pw "$NEXTCLOUD_DB_NEW_PASSWORD"; echo 'made|role'; fi
      if ! has db; then touch "$S/db"; put db_owner nextcloud; echo 'made|database'; fi
      echo 'event=ensure' >>"$STAND_IN_LOG"
      exit 0
      ;;
    *'ALTER ROLE :"nc_role" PASSWORD'*)
      [[ "$stdin" == *'log_min_error_statement = panic'* ]] || echo 'event=logged' >>"$STAND_IN_LOG"
      if has alter_fails; then echo 'ERROR:  could not set it' >&2; exit 3; fi
      put role_pw "$NEXTCLOUD_DB_NEW_PASSWORD"
      echo 'event=alter-role' >>"$STAND_IN_LOG"
      exit 0
      ;;
    *query_to_xml*) get pg_rows; exit 0 ;;
    *ownpace.nextcloud_counters*) echo 'event=counters' >>"$STAND_IN_LOG"; get counters; exit 0 ;;
  esac
  echo "stand-in: no psql answer for: $*" >&2
  exit 98
fi

if [ "$sub" = exec ] && [ "$service" = nextcloud ]; then
  case "$rest" in
    *' occ status '*)
      if occ_boots && [ "$(get cfg_type)" = pgsql ]; then
        echo '{"installed":true,"version":"34.0.4.1","maintenance":false,"needsDbUpgrade":false}'
        exit 0
      fi
      exit 1
      ;;
    *' occ user:list '*) occ_boots || exit 1; echo '{"admin":"admin","someone":"someone"}'; exit 0 ;;
    *' php -r '*) has running || exit 1; cfg_line; exit 0 ;;
  esac
  exit 95
fi

if [ "$sub" = run ] && [ "$service" = nextcloud ]; then
  last="\${*: -1}"
  case "$entrypoint" in
    php)
      case "$last" in
        *NC_SQLITE_FILE*) get sqlite_rows; exit 0 ;;
        *'"cfg"'*)
          if has cfg_unreadable; then echo 'OCI runtime exec failed' >&2; exit 1; fi
          cfg_line
          exit 0
          ;;
        *'$CONFIG["dbpassword"]'*) get cfg_pw; exit 0 ;;
      esac
      exit 97
      ;;
    cp)
      case "$rest" in
        *' config/config.php config/config.php.before-pgsql '*)
          for f in cfg_type cfg_pw; do cp "$S/$f" "$S/bak_$f"; done
          echo 'event=backup' >>"$STAND_IN_LOG"
          exit 0
          ;;
        *' config/config.php.before-pgsql config/config.php '*)
          for f in cfg_type cfg_pw; do cp "$S/bak_$f" "$S/$f"; done
          echo 'event=put-back' >>"$STAND_IN_LOG"
          exit 0
          ;;
      esac
      exit 96
      ;;
    sh)
      case "$last" in
        *db:convert-type*)
          echo 'event=convert' >>"$STAND_IN_LOG"
          case "$(get converter)" in
            ok) get sqlite_rows >"$S/pg_rows"; put cfg_type pgsql; put cfg_pw "$NEXTCLOUD_DB_NEW_PASSWORD"; exit 0 ;;
            stops-mid-copy)
              # As a real converter leaves it: every table made, the first copied, the rest empty.
              { get sqlite_rows | head -1; get sqlite_rows | tail -n +2 | sed 's/|[0-9]*$/|0/'; } >"$S/pg_rows"
              echo '  An exception occurred while executing a query: SQLSTATE[22021]: Character not in repertoire: 7 ERROR:  invalid byte sequence for encoding "UTF8"'
              exit 7
              ;;
            *)
              # Every table but a disabled app's, which it lists; or one it does not list.
              get sqlite_rows | grep -v '|oc_files_reminders|' >"$S/pg_rows"
              if has unlisted_table; then grep -v '|oc_users|' "$S/pg_rows" >"$S/pg_rows.new"; mv "$S/pg_rows.new" "$S/pg_rows"; fi
              printf '%s\\n' 'The following tables will not be converted:' 'oc_files_reminders' 'Please note that tables belonging to disabled (but not removed) apps'
              printf '%s\\n' '  An exception occurred while executing a query: SQLSTATE[42601]: Syntax erro' '  r: 7 ERROR:  syntax error at or near ")"' ''
              exit 7
              ;;
          esac
          ;;
        *config:import*)
          occ_boots || { echo 'An unhandled exception has been thrown: could not connect to the database' >&2; exit 1; }
          if has import_fails; then exit 1; fi
          if [[ "$last" == *'"dbtype"'* ]]; then put cfg_type pgsql; echo 'event=import-all' >>"$STAND_IN_LOG"; else echo 'event=import-password' >>"$STAND_IN_LOG"; fi
          put cfg_pw "$NEXTCLOUD_DB_NEW_PASSWORD"
          exit 0
          ;;
      esac
      exit 94
      ;;
  esac
fi

echo "stand-in: no answer for: $*" >&2
exit 99
`;

/** What a case starts from. Anything left out is absent. */
interface Start {
  volume?: boolean;
  running?: boolean;
  pgHealth?: string;
  role?: { pw: string; attrs?: string };
  db?: { owner?: string };
  tables?: number;
  /** config.php: installed, on what, with what password. */
  cfg?: { installed?: 'yes' | 'no'; type: string; pw: string };
  cfgUnreadable?: boolean;
  converter?: 'ok' | 'stops-at-counters' | 'stops-mid-copy';
  counters?: string;
  alterFails?: boolean;
  importFails?: boolean;
  /** The converter leaves a table out of Postgres that it does not list as left. */
  unlistedTable?: boolean;
}

const SQLITE_ROWS = [
  'rows|oc_appconfig|158',
  'rows|oc_filecache|88',
  'rows|oc_files_reminders|2',
  'rows|oc_jobs|121',
  'rows|oc_migrations|300',
  'rows|oc_users|3',
].join('\n');

interface Ran {
  status: number | null;
  out: string;
  log: string;
  values: string;
  state: (file: string) => string;
  /** What changed, in order: the stand-in's `event=` lines. */
  events: string[];
  envPassword: string | null;
}

interface Stack {
  compose: string;
  stateDir: string;
  bin: string;
  logs: string;
}

function aStack(start: Start, envPassword: string | null): Stack {
  const dir = mkdtempSync(join(tmpdir(), 'nc-postgres-'));
  tempDirs.push(dir);
  const compose = join(dir, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of [
    'nextcloud-to-postgres.sh',
    'nextcloud-db.sh',
    'nextcloud-counters.sql',
    'db-roles.sh',
    'env-read.sh',
    'own-addresses.sh',
    'stack-kind.sh',
    'managed.yml',
  ]) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  chmodSync(join(compose, 'nextcloud-to-postgres.sh'), 0o755);
  writeFileSync(
    join(compose, '.env'),
    `COMPOSE_PROJECT_NAME=ncstandin\n${envPassword === null ? '' : `NEXTCLOUD_DB_PASSWORD=${envPassword}\n`}`,
  );
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir);
  const put = (f: string, v: string) => writeFileSync(join(stateDir, f), v);
  if (start.volume) put('volume', '');
  if (start.running) put('running', '');
  put('pg_health', start.pgHealth ?? 'healthy');
  if (start.role) {
    put('role', '');
    put('role_pw', start.role.pw);
    put('role_attrs', start.role.attrs ?? 'f|f|f|f|f|t');
  }
  if (start.db) {
    put('db', '');
    put('db_owner', start.db.owner ?? 'nextcloud');
  }
  put('tables', String(start.tables ?? 0));
  if (start.cfg) {
    put('cfg_installed', start.cfg.installed ?? 'yes');
    put('cfg_type', start.cfg.type);
    put('cfg_pw', start.cfg.pw);
  }
  if (start.cfgUnreadable) put('cfg_unreadable', '');
  put('converter', start.converter ?? 'stops-at-counters');
  put('counters', start.counters ?? '106|0');
  put('sqlite_rows', SQLITE_ROWS);
  put('pg_rows', '');
  if (start.alterFails) put('alter_fails', '');
  if (start.importFails) put('import_fails', '');
  if (start.unlistedTable) put('unlisted_table', '');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), DOCKER, { mode: 0o755 });
  const logs = join(dir, 'logs');
  mkdirSync(logs);
  return { compose, stateDir, bin, logs };
}

function envFor(stack: Stack, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Not process.env: CI's own CI=true would make every case a CI refusal.
  return {
    PATH: `${stack.bin}:/usr/bin:/bin`,
    HOME: dirname(stack.bin),
    STATE: stack.stateDir,
    STAND_IN_LOG: join(stack.logs, 'calls'),
    STAND_IN_VALUES: join(stack.logs, 'values'),
    NC_HEALTH_WAIT_S: '5',
    ...extra,
  };
}

function collect(r: { status: number | null; stdout: string; stderr: string }, stack: Stack, envPassword: string | null): Ran {
  const readIf = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const log = readIf(join(stack.logs, 'calls'));
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    log,
    values: readIf(join(stack.logs, 'values')),
    state: (f) => readIf(join(stack.stateDir, f)),
    events: log
      .split('\n')
      .filter((l) => l.startsWith('event='))
      .map((l) => l.slice('event='.length)),
    envPassword,
  };
}

/** nextcloud-to-postgres.sh, as it is, against a stand-in stack. */
function script(
  args: string[],
  start: Start,
  opts: { envPassword?: string | null; typed?: string; env?: Record<string, string>; traced?: boolean } = {},
): Ran {
  const envPassword = opts.envPassword === undefined ? aPassword() : opts.envPassword;
  const stack = aStack(start, envPassword);
  const r = spawnSync('bash', [...(opts.traced ? ['-x'] : []), join(stack.compose, 'nextcloud-to-postgres.sh'), ...args], {
    env: envFor(stack, opts.env),
    input: opts.typed ?? '',
    encoding: 'utf8',
    timeout: 60_000,
  });
  return collect(r, stack, envPassword);
}

/** Every argument any call was given, and everything printed, never hold the value. */
function expectNowhere(ran: Ran, value: string): void {
  expect(ran.log, 'a password reached an argument').not.toContain(value);
  expect(ran.out, 'a password was printed').not.toContain(value);
}

// ---------------------------------------------------------------------------
// The bring-up's two functions, as bootstrap-managed.sh writes them
// ---------------------------------------------------------------------------

const BOOTSTRAP = read('deploy/compose/bootstrap-managed.sh');

/** A function of bootstrap-managed.sh, as it is written there: `name() {` to the `}` that ends it. */
function definition(name: string): string {
  const start = BOOTSTRAP.indexOf(`\n${name}() {`);
  expect(start, `${name} is not defined in bootstrap-managed.sh`).toBeGreaterThan(0);
  const end = BOOTSTRAP.indexOf('\n}\n', start);
  return BOOTSTRAP.slice(start + 1, end + 2);
}

/** The data phase's demo half: the database made ready, the first start, and the note. */
function bringUp(start: Start, envPassword: string | null = aPassword()): Ran {
  const stack = aStack(start, envPassword);
  // ensure-env-secrets.sh's stand-in: it fills NEXTCLOUD_DB_PASSWORD when it is missing.
  writeFileSync(
    join(stack.compose, 'ensure-env-secrets.sh'),
    [
      '#!/usr/bin/env bash',
      'echo "event=ensure-env-secrets" >>"$STAND_IN_LOG"',
      `grep -q '^NEXTCLOUD_DB_PASSWORD=.' "$(dirname "$0")/.env" || echo "NEXTCLOUD_DB_PASSWORD=${aPassword()}" >>"$(dirname "$0")/.env"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const st = stack.stateDir;
  const harness = [
    'set -euo pipefail',
    `SCRIPT_DIR='${stack.compose}'`,
    'ENV_FILE="${SCRIPT_DIR}/.env"',
    'COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")',
    '. "${SCRIPT_DIR}/env-read.sh"',
    'note() { echo "    $*"; }',
    'die() { echo "!!! $*" >&2; exit 1; }',
    definition('nextcloud_database_ready'),
    definition('note_nextcloud_database'),
    'nextcloud_database_ready',
    // up_wait nextcloud: a first start installs, connecting with what .env holds.
    `if [ "$(cat '${st}/cfg_installed' 2>/dev/null)" != yes ]; then`,
    `  touch '${st}/volume'; printf yes >'${st}/cfg_installed'; printf pgsql >'${st}/cfg_type'`,
    `  env_value "$ENV_FILE" NEXTCLOUD_DB_PASSWORD | tr -d '\\n' >'${st}/cfg_pw'; echo 'event=install' >>"$STAND_IN_LOG"`,
    'fi',
    `touch '${st}/running'`,
    'note_nextcloud_database',
    '',
  ].join('\n');
  const r = spawnSync('bash', ['-c', harness], { env: envFor(stack), encoding: 'utf8', timeout: 60_000 });
  return collect(r, stack, envPassword);
}

// ---------------------------------------------------------------------------
// The files agree on one database
// ---------------------------------------------------------------------------

describe('a fresh demo install starts on the stack’s Postgres', () => {
  const compose = read('deploy/compose/managed.yml');
  const from = compose.indexOf('\n  nextcloud:\n');
  const block = compose.slice(from, compose.indexOf('\n    healthcheck:', from));

  it('gives its first install Postgres, with .env’s password, and no SQLite', () => {
    expect(block).toContain('POSTGRES_HOST: postgres');
    expect(block).toContain('POSTGRES_DB: nextcloud');
    expect(block).toContain('POSTGRES_USER: nextcloud');
    expect(block).toContain('POSTGRES_PASSWORD: ${NEXTCLOUD_DB_PASSWORD:-}');
    expect(block).not.toContain('SQLITE_DATABASE');
  });

  it('starts after postgres answers, so its first install finds the database', () => {
    expect(block).toMatch(/depends_on:\n\s+postgres:\n\s+condition: service_healthy/);
  });

  it('names the role and the database nextcloud-db.sh makes, and the converter and config.php the same', () => {
    const helper = read('deploy/compose/nextcloud-db.sh');
    expect(helper).toContain("NC_DB_ROLE='nextcloud'");
    expect(helper).toContain("NC_DB_NAME='nextcloud'");
    const converts = read('deploy/compose/nextcloud-to-postgres.sh');
    expect(converts).toContain('occ db:convert-type -n --clear-schema pgsql nextcloud postgres nextcloud');
    const line = converts.split('\n').find((l) => l.includes('exec php occ db:convert-type'));
    expect(line, 'the converter is run on one line').toBeDefined();
    expect(line).not.toContain('--all-apps');
    // Its password from standard input, never an option: php's arguments are in ps on the host.
    expect(line).not.toContain('--password');
    expect(converts).toContain('"dbhost" => "postgres", "dbname" => "nextcloud", "dbuser" => "nextcloud"');
  });

  it('makes the role with nothing but a login, and closes the database to everyone else', () => {
    // What the stand-in cannot see: the attributes the role is made with, and the REVOKE.
    const helper = read('deploy/compose/nextcloud-db.sh');
    expect(helper).toContain(
      'CREATE ROLE :"nc_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :\'nc_pw\';',
    );
    expect(helper).toContain('CREATE DATABASE :"nc_db" OWNER :"nc_role";');
    expect(helper).toContain('REVOKE ALL ON DATABASE :"nc_db" FROM PUBLIC;');
  });

  it('has its password generated on every stack, and documented empty in the example', () => {
    expect(read('deploy/compose/ensure-env-secrets.sh')).toMatch(/^ensure NEXTCLOUD_DB_PASSWORD 24$/m);
    expect(read('deploy/compose/managed.env.example')).toMatch(/^NEXTCLOUD_DB_PASSWORD=$/m);
  });

  it('makes the role and the database before Nextcloud’s first start, and says which database it uses after', () => {
    const data = definition('phase_data');
    const ready = data.indexOf('nextcloud_database_ready');
    const up = data.indexOf('up_wait nextcloud');
    const said = data.indexOf('note_nextcloud_database');
    expect(ready).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(ready);
    expect(said).toBeGreaterThan(up);
  });
});

// ---------------------------------------------------------------------------
// The bring-up
// ---------------------------------------------------------------------------

describe('the bring-up’s data phase, for the demo Nextcloud', () => {
  it('makes the role with .env’s value and the database on an empty stack, and Nextcloud installs on Postgres', () => {
    const ran = bringUp({});
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('made the role and the database nextcloud');
    expect(ran.state('role_pw')).toBe(ran.envPassword);
    expect(ran.events).toEqual(['ensure', 'install']);
    expect(ran.out).toContain("the demo Nextcloud is on Postgres (nextcloud), with .env's NEXTCLOUD_DB_PASSWORD");
    expectNowhere(ran, ran.envPassword!);
    expect(ran.values).toContain(`NEXTCLOUD_DB_NEW_PASSWORD=${ran.envPassword}`);
  });

  it('never sets a password on the role of an installed Nextcloud, and says when config.php holds another', () => {
    const theirs = aPassword();
    const ran = bringUp({ volume: true, running: true, role: { pw: theirs }, db: {}, tables: 131, cfg: { type: 'pgsql', pw: theirs } });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.events).toEqual(['ensure']);
    expect(ran.state('role_pw')).toBe(theirs);
    expect(ran.out).toContain("its config.php holds another password than .env's NEXTCLOUD_DB_PASSWORD");
    expect(ran.out).toContain('./deploy/compose/nextcloud-to-postgres.sh --sync-password');
    expect(ran.log, 'it asked the role a password').not.toMatch(/^run --rm/m);
  });

  it('says an install still on SQLite is to be moved, and moves nothing', () => {
    const ran = bringUp({ volume: true, running: true, cfg: { type: 'sqlite3', pw: '' } });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('still on SQLite');
    expect(ran.out).toContain('./deploy/compose/nextcloud-to-postgres.sh --convert');
    expect(ran.events).toEqual(['ensure']);
    expect(ran.state('cfg_type')).toBe('sqlite3');
  });

  it('gives an existing role .env’s value when no Nextcloud is installed to hold another', () => {
    const before = aPassword();
    const ran = bringUp({ role: { pw: before } });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('made the database nextcloud');
    expect(ran.out).toContain("takes .env's NEXTCLOUD_DB_PASSWORD");
    expect(ran.state('role_pw')).toBe(ran.envPassword);
    expect(ran.events).toEqual(['ensure', 'alter-role', 'install']);
    expectNowhere(ran, ran.envPassword!);
    expectNowhere(ran, before);
  });

  it('refuses a database that still holds the tables of a Nextcloud no longer in its volume', () => {
    const ran = bringUp({ volume: true, cfg: { installed: 'no', type: '', pw: '' }, role: { pw: aPassword() }, db: {}, tables: 131 });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('holds 131 tables of a Nextcloud that is not in its volume');
    expect(ran.out).toContain('DROP DATABASE IF EXISTS nextcloud');
    expect(ran.events).toEqual(['ensure']);
  });

  it('leaves the role alone when config.php cannot be read', () => {
    const theirs = aPassword();
    const ran = bringUp({ volume: true, role: { pw: theirs }, db: {}, cfgUnreadable: true });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('config.php could not be read');
    expect(ran.state('role_pw')).toBe(theirs);
    expect(ran.events).not.toContain('alter-role');
  });

  // The attributes in the order nextcloud-db.sh asks them: superuser, create role, create
  // database, replication, bypass row security, login.
  it.each([
    ['t|f|f|f|f|t', 'it is a superuser'],
    ['f|t|f|f|f|t', 'it may create roles'],
    ['f|f|t|f|f|t', 'it may create databases'],
    ['f|f|f|t|f|t', 'it may replicate the whole cluster'],
    ['f|f|f|f|t|t', 'it bypasses row security'],
    ['f|f|f|f|f|f', 'it cannot log in'],
  ])('refuses a role whose attributes read %s (%s), and makes nothing', (attrs, said) => {
    const ran = bringUp({ role: { pw: aPassword(), attrs } });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain(said);
    expect(ran.events).toEqual([]);
  });

  it('refuses a database that belongs to another role, and makes nothing', () => {
    const ran = bringUp({ role: { pw: aPassword() }, db: { owner: 'openmigrate' } });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('the database nextcloud belongs to openmigrate');
    expect(ran.events).toEqual([]);
  });

  it('has ensure-env-secrets.sh make the password when .env lacks it, and uses that one', () => {
    const ran = bringUp({}, null);
    expect(ran.status, ran.out).toBe(0);
    expect(ran.events[0]).toBe('ensure-env-secrets');
    expect(ran.state('role_pw')).toMatch(/^pw[0-9a-f]{24}$/);
    expect(ran.state('cfg_pw')).toBe(ran.state('role_pw'));
  });
});

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------

describe('nextcloud-to-postgres.sh --check, which changes nothing', () => {
  it('names an install on SQLite and the step for it, with exit 1', () => {
    const ran = script([], { volume: true, running: true, cfg: { type: 'sqlite3', pw: '' } });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('on SQLite');
    expect(ran.out).toContain('next: ./deploy/compose/nextcloud-to-postgres.sh --convert');
    expect(ran.events).toEqual([]);
  });

  it('says nothing is to be done when .env, the role and config.php hold one value', () => {
    const pw = aPassword();
    const ran = script(['--check'], { volume: true, running: true, role: { pw }, db: {}, cfg: { type: 'pgsql', pw } }, { envPassword: pw });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('nothing to do');
    expectNowhere(ran, pw);
  });

  it('names --sync-password when .env holds another value than config.php and the role', () => {
    const theirs = aPassword();
    const ran = script([], { volume: true, running: true, role: { pw: theirs }, db: {}, cfg: { type: 'pgsql', pw: theirs } });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain("does NOT open the role nextcloud");
    expect(ran.out).toContain('next: ./deploy/compose/nextcloud-to-postgres.sh --sync-password');
    expect(ran.events).toEqual([]);
    expectNowhere(ran, theirs);
    expectNowhere(ran, ran.envPassword!);
  });

  it('says a stack with no Nextcloud volume has nothing to move', () => {
    const ran = script([], {});
    expect(ran.status).toBe(0);
    expect(ran.out).toContain('no Nextcloud volume');
  });

  it('runs where CI is set, and on a stack marked live it refuses, like the others', () => {
    const ci = script([], { volume: true, running: true, cfg: { type: 'sqlite3', pw: '' } }, { env: { CI: 'true' } });
    expect(ci.status).toBe(1);
    expect(ci.out).toContain('--convert');
  });
});

// ---------------------------------------------------------------------------
// --convert
// ---------------------------------------------------------------------------

const ON_SQLITE: Start = { volume: true, running: true, cfg: { type: 'sqlite3', pw: '' } };

describe('nextcloud-to-postgres.sh --convert', () => {
  it('moves an install on SQLite, with Nextcloud stopped from before the copy until it is on Postgres', () => {
    const ran = script(['--convert', '--yes'], ON_SQLITE);
    expect(ran.status, ran.out).toBe(0);
    expect(ran.events).toEqual(['ensure', 'alter-role', 'stop', 'backup', 'convert', 'counters', 'import-all', 'start']);
    expect(ran.state('cfg_type')).toBe('pgsql');
    expect(ran.state('cfg_pw')).toBe(ran.envPassword);
    expect(ran.state('role_pw')).toBe(ran.envPassword);
    expect(ran.out).toContain('the copy is whole: 4 tables, 370 rows');
    expect(ran.out).toContain('left in SQLite, the tables of disabled apps: oc_files_reminders');
    expect(ran.out).toContain('the converter stopped (exit 7)');
    expect(ran.out).toContain('106 id counters set');
    expect(ran.out).toContain('done: the demo Nextcloud of ncstandin is on Postgres');
  });

  it('gives the password to the converter and to config.php by name, and never as an argument', () => {
    const ran = script(['--convert', '--yes'], ON_SQLITE);
    expect(ran.status, ran.out).toBe(0);
    expectNowhere(ran, ran.envPassword!);
    expect(ran.values).toContain(`NEXTCLOUD_DB_NEW_PASSWORD=${ran.envPassword}`);
    // Inside the one-off container the converter reads it from a file, as standard input.
    expect(ran.log).toMatch(/printf "%s" "\$NEXTCLOUD_DB_NEW_PASSWORD" >\/tmp\/\.nextcloud-db && exec php occ db:convert-type .* <\/tmp\/\.nextcloud-db/);
    expect(ran.log).toContain('getenv("NEXTCLOUD_DB_NEW_PASSWORD")');
  });

  it('sets the counters with the prefix config.php names', () => {
    const ran = script(['--convert', '--yes'], ON_SQLITE);
    expect(ran.log).toMatch(/exec -T -e PGOPTIONS=-c ownpace\.nextcloud_prefix=oc_ postgres psql .* -d nextcloud .*-f -/);
  });

  it('leaves config.php alone when the converter switched it itself', () => {
    const ran = script(['--convert', '--yes'], { ...ON_SQLITE, converter: 'ok' });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.events).toEqual(['ensure', 'alter-role', 'stop', 'backup', 'convert', 'counters', 'start']);
    expect(ran.out).toContain('the converter finished, and switched config.php itself');
  });

  it('puts config.php back and starts Nextcloud on SQLite when the copy is not whole', () => {
    const ran = script(['--convert', '--yes'], { ...ON_SQLITE, converter: 'stops-mid-copy' });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('FAILED at the copy check: the copy is not whole');
    expect(ran.out).toContain('SQLSTATE[22021]');
    expect(ran.events).toEqual(['ensure', 'alter-role', 'stop', 'backup', 'convert', 'put-back', 'start']);
    expect(ran.state('cfg_type')).toBe('sqlite3');
  });

  it('counts a table Postgres lacks as a copy not whole, unless the converter listed it as left', () => {
    const ran = script(['--convert', '--yes'], { ...ON_SQLITE, unlistedTable: true });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('oc_users (3 in SQLite, none, the table is not there in Postgres)');
    expect(ran.out).not.toContain('oc_files_reminders (');
    expect(ran.state('cfg_type')).toBe('sqlite3');
  });

  it('puts config.php back when a counter could not be set', () => {
    const ran = script(['--convert', '--yes'], { ...ON_SQLITE, counters: '105|1' });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('FAILED at the counters: 1 counter(s) could not be set');
    expect(ran.events).toEqual(['ensure', 'alter-role', 'stop', 'backup', 'convert', 'counters', 'put-back', 'start']);
    expect(ran.state('cfg_type')).toBe('sqlite3');
  });

  it('puts config.php back when the converter switched it and a counter could not be set after', () => {
    const ran = script(['--convert', '--yes'], { ...ON_SQLITE, converter: 'ok', counters: '105|1' });
    expect(ran.status).toBe(1);
    expect(ran.events.slice(-2)).toEqual(['put-back', 'start']);
    expect(ran.state('cfg_type')).toBe('sqlite3');
  });

  it('says an install on Postgres needs no move, and changes nothing', () => {
    const pw = aPassword();
    const ran = script(['--convert', '--yes'], { volume: true, running: true, role: { pw }, db: {}, cfg: { type: 'pgsql', pw } }, { envPassword: pw });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain('on Postgres already');
    expect(ran.events).toEqual([]);
  });

  it('waits for the project’s name, and changes nothing for anything else', () => {
    const wrong = script(['--convert'], ON_SQLITE, { typed: 'ncstandi\n' });
    expect(wrong.status).toBe(1);
    expect(wrong.out).toContain('Pause the migrations that write into this Nextcloud first');
    expect(wrong.out).toContain('what was typed is not the project name');
    expect(wrong.events).toEqual([]);
    const right = script(['--convert'], ON_SQLITE, { typed: 'ncstandin\n' });
    expect(right.status, right.out).toBe(0);
  });

  it.each([
    ['in CI', { env: { CI: 'true' } }, 'this is CI'],
    ['traced', { traced: true }, 'xtrace'],
    ['on a stack marked live', { env: {} }, 'live'],
  ] as const)('is refused %s, before anything changes', (_what, opts, said) => {
    const start = ON_SQLITE;
    const ran =
      said === 'live'
        ? scriptOnLive(['--convert', '--yes'], start)
        : script(['--convert', '--yes'], start, opts as { env?: Record<string, string>; traced?: boolean });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain(said);
    expect(ran.out).toContain('Nothing was changed.');
    expect(ran.events).toEqual([]);
  });

  it('is refused with no NEXTCLOUD_DB_PASSWORD, or with postgres not healthy', () => {
    const none = script(['--convert', '--yes'], ON_SQLITE, { envPassword: null });
    expect(none.status).toBe(1);
    expect(none.out).toContain('NEXTCLOUD_DB_PASSWORD is empty');
    expect(none.events).toEqual([]);
    const sick = script(['--convert', '--yes'], { ...ON_SQLITE, pgHealth: 'starting' });
    expect(sick.status).toBe(1);
    expect(sick.out).toContain('postgres is not healthy (starting)');
    expect(sick.events).toEqual([]);
  });

  it('is refused for an unfit role, before the prompt and before anything is made', () => {
    const ran = script(['--convert', '--yes'], { ...ON_SQLITE, role: { pw: aPassword(), attrs: 'f|t|f|f|f|t' } });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('it may create roles');
    expect(ran.out).not.toContain('Pause the migrations');
    expect(ran.events).toEqual([]);
  });
});

/** The script on a stack whose .env carries live's marker. */
function scriptOnLive(args: string[], start: Start): Ran {
  const envPassword = aPassword();
  const stack = aStack(start, envPassword);
  const kind = read('deploy/compose/stack-kind.sh');
  const key = /^STACK_KIND_KEY='?([A-Z_]+)'?$/m.exec(kind)?.[1];
  const live = /^STACK_KIND_LIVE='?([a-z-]+)'?$/m.exec(kind)?.[1];
  expect(key && live, 'stack-kind.sh names its key and live’s value').toBeTruthy();
  writeFileSync(join(stack.compose, '.env'), `COMPOSE_PROJECT_NAME=ncstandin\nNEXTCLOUD_DB_PASSWORD=${envPassword}\n${key}=${live}\n`);
  const r = spawnSync('bash', [join(stack.compose, 'nextcloud-to-postgres.sh'), ...args], {
    env: envFor(stack),
    input: '',
    encoding: 'utf8',
    timeout: 60_000,
  });
  return collect(r, stack, envPassword);
}

// ---------------------------------------------------------------------------
// --sync-password
// ---------------------------------------------------------------------------

describe('nextcloud-to-postgres.sh --sync-password: config.php first, then the role', () => {
  it('writes .env’s value into config.php while the old one still opens the role, then sets the role', () => {
    const theirs = aPassword();
    const ran = script(['--sync-password', '--yes'], { volume: true, running: true, role: { pw: theirs }, db: {}, cfg: { type: 'pgsql', pw: theirs } });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.events).toEqual(['stop', 'import-password', 'alter-role', 'start']);
    expect(ran.state('cfg_pw')).toBe(ran.envPassword);
    expect(ran.state('role_pw')).toBe(ran.envPassword);
    expectNowhere(ran, theirs);
    expectNowhere(ran, ran.envPassword!);
  });

  it('sets only the role when config.php holds .env’s value already (a sync cut off after its first step)', () => {
    const env = aPassword();
    const ran = script(
      ['--sync-password', '--yes'],
      { volume: true, running: true, role: { pw: aPassword() }, db: {}, cfg: { type: 'pgsql', pw: env } },
      { envPassword: env },
    );
    expect(ran.status, ran.out).toBe(0);
    expect(ran.events).toEqual(['stop', 'alter-role', 'start']);
    expect(ran.state('role_pw')).toBe(env);
  });

  it('puts right the 2026-09-29 state first: a role that took a value config.php does not hold', () => {
    const configs = aPassword();
    const ran = script(['--sync-password', '--yes'], { volume: true, running: true, role: { pw: aPassword() }, db: {}, cfg: { type: 'pgsql', pw: configs } });
    expect(ran.status, ran.out).toBe(0);
    expect(ran.out).toContain("the role was set back to config.php's value first");
    expect(ran.events).toEqual(['stop', 'alter-role', 'import-password', 'alter-role', 'start']);
    expect(ran.state('role_pw')).toBe(ran.envPassword);
    expect(ran.state('cfg_pw')).toBe(ran.envPassword);
    expectNowhere(ran, configs);
  });

  it('starts Nextcloud again and says what is left when the role cannot be set after config.php', () => {
    const theirs = aPassword();
    const ran = script(['--sync-password', '--yes'], {
      volume: true,
      running: true,
      role: { pw: theirs },
      db: {},
      cfg: { type: 'pgsql', pw: theirs },
      alterFails: true,
    });
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('FAILED at the role');
    expect(ran.out).toContain('run --sync-password again, which sets only the role');
    expect(ran.events).toEqual(['stop', 'import-password', 'start']);
  });

  it('is refused on an install still on SQLite, which --convert gives .env’s value', () => {
    const ran = script(['--sync-password', '--yes'], ON_SQLITE);
    expect(ran.status).toBe(1);
    expect(ran.out).toContain('--convert first');
    expect(ran.events).toEqual([]);
  });
});
