// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE COPY BEFORE EACH UPDATE, AND IT GOES ONCE THE UPDATE IS PROVEN (workplan
 * 0139, *the copy before an update*; the owner's answers rec-copies (a) and
 * rec-drill (a), 2026-09-28; 0132 T6 step 4 and T7).
 *
 * During the alpha live keeps no backups (0134 D1), with one exception. The
 * owner, on 2026-09-28: *"deletes only after proven successful upgrade, so we
 * already have one backup copy of what actually works. What about the
 * drill?"*, and then chose one copy per update, deleted once the update is
 * proven, never kept past day 7, and the drill on the test stack only. The
 * privacy policy's §9 and the Alpha conditions' §6 (*"until that update is
 * shown to work, and never longer than 7 days"*) promise exactly that. Until
 * this, the dump was the owner's step and nothing deleted one (0134 T0 step 4),
 * and live's daily duties dumped the task runner's database every day.
 *
 * `deploy/compose/copy-before-update.sh` is the one script, and
 * `~/.persistent/<project>/copy-before-update/` the one directory. What must
 * never go wrong, a block each:
 *
 *   take. The app's database, the sign-in service's database and the roles,
 *   and with `--trigger` the task runner's, each read back, into that
 *   directory and nowhere else, readable by the owner alone, the note last. A
 *   part that fails leaves nothing of the run behind. A copy whose update is
 *   not proven is kept and no second one is taken: it is the copy of what ran
 *   before. A copy whose update is proven is refused: one copy per update. The
 *   directory is not taken from the shell, because the backstop looks there
 *   and nowhere else.
 *
 *   delete. Only once the update is proven: the last line deploys.log has
 *   since the copy was taken says a deploy took (a did-not-take after a took
 *   is no proof), the hold that covered that deploy is lifted, and a pass that
 *   started after it succeeded. Each read from a database with both migration
 *   chains applied (PGlite behind the `psql` stub), and each missing one
 *   refuses; a database it cannot read, or a role row security binds, is no
 *   proof. It sends no statement that writes.
 *
 *   expire, the daily backstop. Nothing older than 6 days less an hour
 *   survives it, proven or not, so a copy is never kept past day 7 even when a
 *   daily run starts late. Each file goes by its own age, a dump by hand
 *   included, and the copy by its note's. The run before the one that deletes
 *   the copy keeps it and fails, saying to roll back from it or delete it.
 *   `take` applies the same rule first, refuses a kept copy the next run
 *   deletes, and refuses while the daily duties' timer is not active: nothing
 *   would delete what it takes.
 *
 *   since, the rollback's first step. What was erased, closed, reopened or
 *   deleted after the copy, read from the database before it is replaced and
 *   written into the copy's directory as SQL that does it all again in the
 *   restored one: rehearsed here on two PGlite databases, the copy's and the
 *   one after it.
 *
 *   The directory is a directory: a symbolic link there is refused by every
 *   script that writes or deletes in it, because `find` does not follow one.
 *
 *   dump-idp.sh on live writes into that directory and nowhere else, and
 *   trigger-version.sh on live dumps only there and never drills, on a slip of
 *   live's marker too; on the OTA stack both are what they were.
 *
 * `docker`, `pg_dump`, `pg_dumpall`, `pg_restore` and `psql` are stubs on the
 * PATH. The docker stub runs `docker exec <container> <command…>` itself, so
 * each script's own command line is what reaches the stubs. The way back was
 * rehearsed against a real Postgres, as the operator runbook says.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'copy-before-update.sh';
const LIVE = 'ownpace-live';
const OTA = 'ownpace-managed';
const RUNNING = 'v0.2.0-alpha.1';
const TAG = 'v0.2.0-alpha.2';
const MASTERKEY = 'MasterkeyNeedsToHave32Characters';
const DAY = 86_400_000;
const HOUR = 3_600_000;

const CASE_MS = 60_000;
const PGLITE_CASE_MS = 180_000;

const LIVE_ENV = [
  `COMPOSE_PROJECT_NAME=${LIVE}`,
  'STACK_KIND=production',
  'POSTGRES_USER=openmigrate',
  'POSTGRES_DB=openmigrate',
  `ZITADEL_MASTERKEY=${MASTERKEY}`,
  '',
].join('\n');
/** The OTA stack's `.env`: no marker, no project (managed.yml's own name). */
const OTA_ENV = ['POSTGRES_USER=openmigrate', `ZITADEL_MASTERKEY=${MASTERKEY}`, ''].join('\n');
/** Live's `.env` with its marker slipped: spaces around `=`, which the reader cannot read (stack_may_be_live). */
const SLIP_ENV = LIVE_ENV.replace('STACK_KIND=production', 'STACK_KIND = production');

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

// PGlite for the `psql` stub, a separate node process. Resolved from the
// ledger package, where the dependency is declared.
const requireFromLedger = createRequire(join(REPO_ROOT, 'packages', 'ledger', 'package.json'));
const PGLITE_CJS = requireFromLedger.resolve('@electric-sql/pglite');
const PGCRYPTO_CJS = requireFromLedger.resolve('@electric-sql/pglite/contrib/pgcrypto');
interface PgliteLike {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}
type PgliteCtor = new (dir: string, opts: unknown) => PgliteLike;
const { PGlite } = requireFromLedger('@electric-sql/pglite') as { PGlite: PgliteCtor };
const { pgcrypto } = requireFromLedger('@electric-sql/pglite/contrib/pgcrypto') as { pgcrypto: unknown };

// ---------------------------------------------------------------------------
// The stubs
// ---------------------------------------------------------------------------

/**
 * docker: `inspect` of the provider's image and of the task runner's database
 * container, and `exec [-i] <container> <command…>`, which it runs itself with
 * the Postgres container's two variables, so the scripts' own command lines
 * reach the stubs below. Any other container, or any other call, fails.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
if [ -n "\${STUB_DOCKER_FAIL:-}" ]; then echo 'Cannot connect to the Docker daemon' >&2; exit 1; fi
case "$1" in
  inspect)
    last="\${*: -1}"
    case "$last" in
      *-idp) printf '%s\\n' 'ghcr.io/zitadel/zitadel:v4.19.1' ;;
      *-trigger-db) printf '[]\\n' ;;
      *) exit 1 ;;
    esac
    ;;
  exec)
    shift
    [ "$1" = -i ] && shift
    container="$1"
    shift
    case "$container" in
      ${LIVE}-db | ${LIVE}-trigger-db | ${OTA}-db | ${OTA}-trigger-db) ;;
      *) echo "docker stub: no such container: $container" >&2; exit 1 ;;
    esac
    export POSTGRES_USER=openmigrate POSTGRES_DB=openmigrate
    exec "$@"
    ;;
  *) echo "docker stub: unexpected call: $*" >&2; exit 98 ;;
esac
`;

/** pg_dump: a custom-format dump of the database it names, or plain SQL; STUB_FAIL lists databases whose dump fails. */
const PG_DUMP_STUB = `#!/usr/bin/env bash
printf 'pg_dump %s\\n' "$*" >>"$STUB_LOG"
db='' fmt=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) db="$2"; shift 2 ;;
    --format=*) fmt="\${1#--format=}"; shift ;;
    *) shift ;;
  esac
done
case ",\${STUB_FAIL:-}," in *",$db,"*) echo "pg_dump: error: connection to database \\"$db\\" failed" >&2; exit 1 ;; esac
if [ "$fmt" = plain ]; then
  printf -- '--\\n-- PostgreSQL database dump\\n--\\n'
  for _ in $(seq 1 600); do echo '-- a line of the task runner database'; done
else
  printf 'PGDMP a dump of %s\\n' "$db"
fi
`;

const PG_DUMPALL_STUB = `#!/usr/bin/env bash
printf 'pg_dumpall %s\\n' "$*" >>"$STUB_LOG"
case ",\${STUB_FAIL:-}," in *",roles,"*) exit 1 ;; esac
printf 'CREATE ROLE zitadel;\\nALTER ROLE zitadel WITH LOGIN;\\n'
`;

/** pg_restore --list: reads the dump on stdin; STUB_FAIL=list-<db> refuses that one. */
const PG_RESTORE_STUB = `#!/usr/bin/env bash
printf 'pg_restore %s\\n' "$*" >>"$STUB_LOG"
[ "$1" = --list ] || { echo "pg_restore stub: only --list" >&2; exit 97; }
input="$(cat)"
case "$input" in PGDMP*) ;; *) echo 'pg_restore: error: input file does not appear to be a valid archive' >&2; exit 1 ;; esac
db="\${input#PGDMP a dump of }"
case ",\${STUB_FAIL:-}," in *",list-$db,"*) echo 'pg_restore: error: input file is too short' >&2; exit 1 ;; esac
printf ';\\n; Archive created at 2026-09-28 10:15:00 UTC\\n;     TOC Entries: 42\\n;\\n'
`;

/** psql: a fixture answer, a failure, or PGlite when STUB_PGLITE names a data directory. */
const PSQL_STUB = (node: string) => `#!${node}
const fs = require('fs');
const args = process.argv.slice(2);
const ci = args.indexOf('-c');
const sql = ci >= 0 ? args[ci + 1] : fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.STUB_LOG, 'psql ' + args.join(' ') + '\\n');
fs.appendFileSync(process.env.STUB_SQL_LOG, sql + '\\n-- (end of one psql call)\\n');
if (process.env.STUB_PSQL_FAIL) {
  process.stderr.write('psql: error: connection to server on socket failed\\n');
  process.exit(2);
}
if (!process.env.STUB_PGLITE) {
  process.stdout.write(process.env.STUB_PSQL_ANSWER || '');
  process.exit(0);
}
(async () => {
  const { PGlite } = require(${JSON.stringify(PGLITE_CJS)});
  const { pgcrypto } = require(${JSON.stringify(PGCRYPTO_CJS)});
  const db = new PGlite(process.env.STUB_PGLITE, { extensions: { pgcrypto } });
  let code = 0;
  try {
    const r = await db.query(sql, [], { rowMode: 'array' });
    for (const row of r.rows) {
      process.stdout.write(row.map((v) => (v == null ? '' : String(v))).join('|') + '\\n');
    }
  } catch (e) {
    process.stderr.write('ERROR:  ' + (e && e.message ? e.message : String(e)) + '\\n');
    code = 3;
  } finally {
    await db.close();
  }
  process.exit(code);
})();
`;

/**
 * systemctl: `--user is-active --quiet <unit>` answers from STUB_TIMER (active
 * unless it says otherwise); any other call fails.
 */
const SYSTEMCTL_STUB = `#!/usr/bin/env bash
printf 'systemctl %s\\n' "$*" >>"$STUB_LOG"
case " $* " in
  *" is-active "*)
    [ "\${STUB_TIMER:-active}" = active ] && exit 0
    exit 3
    ;;
esac
echo "systemctl stub: unexpected call: $*" >&2
exit 98
`;

// ---------------------------------------------------------------------------
// A checkout of live, and its home
// ---------------------------------------------------------------------------

interface Stage {
  root: string;
  work: string;
  compose: string;
  home: string;
  /** The one directory: ~/.persistent/<project>/copy-before-update. */
  dir: string;
  deployLog: string;
  log: string;
  sqlLog: string;
  env: NodeJS.ProcessEnv;
}

const gitEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  LANG: 'C',
});

function git(home: string, cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(home) });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function writeExec(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

function stage(dotEnv: string = LIVE_ENV): Stage {
  const root = tempDir('copy-before-update-');
  const work = join(root, 'ownpace-live');
  const compose = join(work, 'deploy', 'compose');
  const home = join(root, 'home');
  mkdirSync(compose, { recursive: true });
  mkdirSync(home);
  for (const f of [SCRIPT, 'env-read.sh', 'stack-kind.sh', 'dump-idp.sh', 'trigger-version.sh', 'managed.yml']) {
    // A script that is not there yet is simply not there: the cases fail on it.
    if (!existsSync(join(COMPOSE_DIR, f))) continue;
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  writeFileSync(join(work, '.gitignore'), '.env\n');
  git(home, root, 'init', '-q', '-b', 'main', work);
  git(home, work, 'add', '-A');
  git(home, work, 'commit', '-q', '-m', 'the running release');
  git(home, work, 'tag', '-a', RUNNING, '-m', `Ownpace ${RUNNING}`);
  writeFileSync(join(compose, '.env'), dotEnv);

  const bin = join(root, 'bin');
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  writeExec(join(bin, 'pg_dump'), PG_DUMP_STUB);
  writeExec(join(bin, 'pg_dumpall'), PG_DUMPALL_STUB);
  writeExec(join(bin, 'pg_restore'), PG_RESTORE_STUB);
  writeExec(join(bin, 'psql'), PSQL_STUB(process.execPath));
  writeExec(join(bin, 'systemctl'), SYSTEMCTL_STUB);
  const log = join(root, 'calls.log');
  const sqlLog = join(root, 'sql.log');
  writeFileSync(log, '');
  writeFileSync(sqlLog, '');
  const project = /COMPOSE_PROJECT_NAME=(\S+)/.exec(dotEnv)?.[1] ?? OTA;
  const persist = join(home, '.persistent', project);
  return {
    root,
    work,
    compose,
    home,
    dir: join(persist, 'copy-before-update'),
    deployLog: join(persist, 'deploys.log'),
    log,
    sqlLog,
    env: {
      ...gitEnv(home),
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      STUB_LOG: log,
      STUB_SQL_LOG: sqlLog,
    },
  };
}

function runIn(s: Stage, script: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(join(s.compose, script), args, {
    encoding: 'utf8',
    env: { ...s.env, ...extra },
    cwd: s.work,
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const run = (s: Stage, args: string[], extra: NodeJS.ProcessEnv = {}) => runIn(s, SCRIPT, args, extra);

const calls = (s: Stage): string[] => readFileSync(s.log, 'utf8').split('\n').filter(Boolean);
const dumps = (s: Stage): string[] => calls(s).filter((c) => /^(pg_dump|pg_dumpall) /.test(c));
const sqlSent = (s: Stage): string => readFileSync(s.sqlLog, 'utf8');
const filesIn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
const mode = (path: string): string => (statSync(path).mode & 0o777).toString(8);
const NOTE = 'copy-before-update.txt';
const note = (s: Stage): string => readFileSync(join(s.dir, NOTE), 'utf8');

/** An ISO time `ago` milliseconds before now, to the second, as deploys.log writes it. */
const iso = (ago: number): string => new Date(Date.now() - ago).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** A line of deploys.log, as deploy-live.sh appends it. Returns the line's time. */
function logDeploy(s: Stage, ago: number, outcome: 'took' | 'did-not-take', tag = TAG): string {
  mkdirSync(dirname(s.deployLog), { recursive: true });
  const at = iso(ago);
  const line = [at, tag, 'c0ffee0000000000000000000000000000000000', outcome, 'one-way'].join('\t');
  writeFileSync(s.deployLog, `${existsSync(s.deployLog) ? readFileSync(s.deployLog, 'utf8') : ''}${line}\n`);
  return at;
}

/**
 * A copy as `take` leaves it, planted: the note's header in the script's
 * format (`taken=`, `taken_epoch=`, `before=` above the first blank line), and
 * the dumps, every file's time the copy's.
 */
function plantCopy(s: Stage, ago: number, opts: { withNote?: boolean } = {}): string[] {
  mkdirSync(s.dir, { recursive: true, mode: 0o700 });
  const stamp = iso(ago).replace(/[-:]/g, '');
  const names = [`openmigrate-${LIVE}-${stamp}.dump`, `zitadel-${LIVE}-${stamp}.dump`, `roles-${LIVE}-${stamp}.sql`];
  for (const n of names) writeFileSync(join(s.dir, n), 'PGDMP a planted part\n', { mode: 0o600 });
  if (opts.withNote !== false) {
    const epoch = Math.floor((Date.now() - ago) / 1000);
    writeFileSync(
      join(s.dir, NOTE),
      `taken=${iso(ago)}\ntaken_epoch=${epoch}\nbefore=${TAG}\nfrom=${RUNNING}\n\nA planted copy.\n`,
      { mode: 0o600 },
    );
    names.push(NOTE);
  }
  const when = (Date.now() - ago) / 1000;
  for (const n of names) utimesSync(join(s.dir, n), when, when);
  return names.sort();
}

// ===========================================================================
// take
// ===========================================================================

describe('take: one copy, right before an update, in one directory', () => {
  it(
    "the app's database, the sign-in service's database and the roles, each read back, into ~/.persistent/<project>/copy-before-update, the note last",
    () => {
      const s = stage();
      const r = run(s, ['take', TAG]);
      expect(r.status, r.out).toBe(0);
      const files = filesIn(s.dir);
      expect(files.filter((f) => /^openmigrate-ownpace-live-\d{8}T\d{6}Z\.dump$/.test(f)), files.join('\n')).toHaveLength(1);
      expect(files.filter((f) => /^zitadel-ownpace-live-\d{8}T\d{6}Z\.dump$/.test(f))).toHaveLength(1);
      expect(files.filter((f) => /^roles-ownpace-live-\d{8}T\d{6}Z\.sql$/.test(f))).toHaveLength(1);
      expect(files).toContain(NOTE);
      expect(files.filter((f) => f.startsWith('triggerdb-')), 'the task runner was dumped without --trigger').toEqual([]);
      expect(files.filter((f) => f.endsWith('.partial'))).toEqual([]);
      // Each read back by the server's own pg_restore.
      expect(calls(s).filter((c) => c === 'pg_restore --list')).toHaveLength(2);
      expect(dumps(s)).toEqual([
        'pg_dump -U openmigrate -d openmigrate --format=custom',
        'pg_dump -U openmigrate -d zitadel --format=custom',
        'pg_dumpall -U openmigrate --roles-only',
      ]);
      // The note: when, before which tag, from which release, and each file.
      const n = note(s);
      expect(n).toMatch(/^taken=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/m);
      expect(n).toMatch(/^taken_epoch=\d+$/m);
      expect(n).toMatch(new RegExp(`^before=${TAG.replace(/\./g, '\\.')}$`, 'm'));
      expect(n).toMatch(new RegExp(`^from=${RUNNING.replace(/\./g, '\\.')}\\b`, 'm'));
      for (const f of files.filter((x) => x !== NOTE)) expect(n, `the note does not name ${f}`).toContain(f);
      expect(n).toMatch(/copy-before-update\.sh delete/);
      expect(n).toMatch(/day 6/);
      expect(n).not.toContain(MASTERKEY);
    },
    CASE_MS,
  );

  it('the directory and every file in it are the owner\'s alone, and nothing is written anywhere else', () => {
    const s = stage();
    const r = run(s, ['take', '--trigger', TAG]);
    expect(r.status, r.out).toBe(0);
    expect(mode(s.dir)).toBe('700');
    for (const f of filesIn(s.dir)) expect(mode(join(s.dir, f)), f).toBe('600');
    // Nothing beside the one directory: no ~/ownpace-dumps, no trigger-backups.
    expect(filesIn(s.home).filter((f) => f !== '.persistent')).toEqual([]);
    expect(filesIn(join(s.home, '.persistent', LIVE))).toEqual(['copy-before-update']);
    expect(r.out).not.toContain(MASTERKEY);
  });

  it('with --trigger, the task runner\'s database too, verified, in the same directory', () => {
    const s = stage();
    const r = run(s, ['take', '--trigger', TAG]);
    expect(r.status, r.out).toBe(0);
    const trig = filesIn(s.dir).filter((f) => f.startsWith('triggerdb-'));
    expect(trig).toHaveLength(1);
    expect(trig[0]).toMatch(new RegExp(`^triggerdb-\\d{8}T\\d{6}Z-before-${TAG.replace(/\./g, '\\.')}\\.sql\\.gz$`));
    expect(dumps(s)).toContain('pg_dump -U trigger -d triggerdb --format=plain --no-owner');
    expect(note(s)).toContain(trig[0]!);
  });

  it.each([
    ["the app's database does not dump", { STUB_FAIL: 'openmigrate' }, [], 'pg_dump -U openmigrate -d openmigrate --format=custom'],
    ["the app's dump does not read back", { STUB_FAIL: 'list-openmigrate' }, [], 'pg_restore --list'],
    ["the sign-in service's database does not dump", { STUB_FAIL: 'zitadel' }, [], 'pg_dump -U openmigrate -d zitadel --format=custom'],
    ['the roles do not dump', { STUB_FAIL: 'roles' }, [], 'pg_dumpall -U openmigrate --roles-only'],
    [
      "the task runner's database does not dump",
      { STUB_FAIL: 'triggerdb' },
      ['--trigger'],
      'pg_dump -U trigger -d triggerdb --format=plain --no-owner',
    ],
  ] as const)('%s: it fails, and leaves nothing of its run behind, no note above all', (_label, stub, flags, tried) => {
    const s = stage();
    const r = run(s, ['take', ...flags, TAG], stub);
    expect(r.status, r.out).toBe(1);
    expect(calls(s), 'the part that fails was never tried').toContain(tried);
    expect(r.out).toMatch(/\[copy-before-update\].*(nothing|no copy)/);
    expect(filesIn(s.dir), 'a part of a copy that did not complete was left').toEqual([]);
  });

  it('a copy whose update is not proven is kept, and no second copy is taken: it is the copy of what ran before', () => {
    const s = stage();
    const planted = plantCopy(s, 2 * HOUR);
    // A deploy that did not take since: its bring-up may have migrated the database.
    logDeploy(s, 1 * HOUR, 'did-not-take');
    const r = run(s, ['take', TAG]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/kept/i);
    expect(dumps(s), 'a second copy was taken over the first').toEqual([]);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it.each([
    ['the hold that covered the deploy is still on', 'yes|1|0\n', {}],
    ['no pass has completed since', 'yes|0|0\n', {}],
    ['the database cannot be read', '', { STUB_PSQL_FAIL: '1' }],
  ] as const)('a deploy took since, and %s: not proven, so kept', (_label, answer, extra) => {
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR);
    logDeploy(s, 2 * HOUR, 'took');
    const r = run(s, ['take', TAG], { STUB_PSQL_ANSWER: answer, ...extra });
    expect(r.status, r.out).toBe(0);
    expect(dumps(s)).toEqual([]);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it("a kept copy without the task runner's database gains it with --trigger, and the rest stays as it was", () => {
    const s = stage();
    const planted = plantCopy(s, 2 * HOUR);
    const before = note(s);
    const r = run(s, ['take', '--trigger', TAG]);
    expect(r.status, r.out).toBe(0);
    const added = filesIn(s.dir).filter((f) => !planted.includes(f));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^triggerdb-.*\.sql\.gz$/);
    expect(dumps(s)).toEqual(['pg_dump -U trigger -d triggerdb --format=plain --no-owner']);
    expect(note(s).startsWith(before), 'the note was rewritten, not added to').toBe(true);
    expect(note(s)).toContain(added[0]!);
  });

  it('a copy whose update is proven is refused: one copy per update, delete it first', () => {
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR);
    logDeploy(s, 2 * HOUR, 'took');
    const r = run(s, ['take', TAG], { STUB_PSQL_ANSWER: 'yes|0|1\n' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('copy-before-update.sh delete');
    expect(dumps(s)).toEqual([]);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it("a kept copy, and a take --trigger whose task runner's part fails: exit 1, and the kept copy exactly as it was", () => {
    const s = stage();
    const planted = plantCopy(s, 2 * HOUR);
    const before = Object.fromEntries(planted.map((f) => [f, readFileSync(join(s.dir, f), 'utf8')]));
    const r = run(s, ['take', '--trigger', TAG], { STUB_FAIL: 'triggerdb' });
    expect(r.status, r.out).toBe(1);
    expect(filesIn(s.dir), 'a failed take removed or left something in the kept copy').toEqual(planted);
    for (const f of planted) expect(readFileSync(join(s.dir, f), 'utf8'), f).toBe(before[f]);
  });

  it('a dump by hand, and a fresh take that fails: the dump by hand is still there', () => {
    const s = stage();
    mkdirSync(s.dir, { recursive: true, mode: 0o700 });
    const hand = 'zitadel-ownpace-live-20260928T080000Z.dump';
    writeFileSync(join(s.dir, hand), 'PGDMP by hand\n', { mode: 0o600 });
    const r = run(s, ['take', TAG], { STUB_FAIL: 'zitadel' });
    expect(r.status, r.out).toBe(1);
    expect(filesIn(s.dir)).toEqual([hand]);
  });

  it("a kept copy the next daily run deletes is refused: the update after it would have no copy from then on", () => {
    for (const age of [5 * DAY + HOUR, 6 * DAY - 2 * HOUR]) {
      const s = stage();
      const planted = plantCopy(s, age);
      for (const args of [['take', TAG], ['take', '--dry-run', TAG]]) {
        const r = run(s, args);
        expect(r.status, `${args.join(' ')} with a copy ${age / DAY} days old:\n${r.out}`).toBe(1);
        expect(r.out).toMatch(/next daily run deletes it/);
        expect(r.out).toMatch(/roll back/);
        expect(r.out).toContain('copy-before-update.sh delete');
      }
      expect(dumps(s)).toEqual([]);
      expect(filesIn(s.dir)).toEqual(planted);
    }
  });

  it("on the copy's last day, the rollback's deploy of the release it holds (its note's from=) keeps it and goes ahead", () => {
    // The runbook's rollback deploys that release by day 6; refusing it there
    // would leave the restored databases under the new release's code.
    const s = stage();
    const planted = plantCopy(s, 5 * DAY + HOUR);
    const r = run(s, ['take', RUNNING]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/kept/);
    expect(dumps(s)).toEqual([]);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it('a kept copy past the backstop\'s limit goes first, as the backstop would delete it, and a new one is taken', () => {
    const s = stage();
    const planted = plantCopy(s, 6 * DAY);
    const dry = run(s, ['take', '--dry-run', TAG]);
    expect(dry.status, dry.out).toBe(0);
    expect(dry.out).toMatch(/would delete/);
    expect(filesIn(s.dir), 'the dry run deleted something').toEqual(planted);
    const r = run(s, ['take', TAG]);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir).filter((f) => planted.includes(f)), 'the old copy survived').toEqual([NOTE]);
    expect(note(s)).not.toContain('A planted copy.');
    expect(dumps(s).length).toBeGreaterThan(0);
  });

  it("refuses, taking nothing, while the daily duties' timer is not active: nothing would delete the copy", () => {
    const s = stage();
    for (const args of [['take', TAG], ['take', '--dry-run', TAG]]) {
      const r = run(s, args, { STUB_TIMER: 'inactive' });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('ownpace-box-duties.timer');
    }
    expect(dumps(s)).toEqual([]);
    expect(existsSync(s.dir)).toBe(false);
    // The user manager's own answer, for the unit the bring-up installs.
    const ok = stage();
    expect(run(ok, ['take', TAG]).status).toBe(0);
    expect(calls(ok)).toContain('systemctl --user is-active --quiet ownpace-box-duties.timer');
  });

  it('files there without a note, a dump by hand, become part of the copy the note names', () => {
    const s = stage();
    mkdirSync(s.dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(s.dir, 'zitadel-ownpace-live-20260927T080000Z.dump'), 'PGDMP by hand\n', { mode: 0o600 });
    const r = run(s, ['take', TAG]);
    expect(r.status, r.out).toBe(0);
    expect(note(s)).toContain('zitadel-ownpace-live-20260927T080000Z.dump');
    expect(dumps(s).length).toBeGreaterThan(0);
  });

  it('--dry-run says what it would do, and writes nothing, not even the directory', () => {
    const s = stage();
    const r = run(s, ['take', '--dry-run', '--trigger', TAG]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/would take/i);
    expect(existsSync(s.dir)).toBe(false);
    expect(dumps(s)).toEqual([]);

    const proven = stage();
    plantCopy(proven, 3 * HOUR);
    logDeploy(proven, 2 * HOUR, 'took');
    const refused = run(proven, ['take', '--dry-run', TAG], { STUB_PSQL_ANSWER: 'yes|0|1\n' });
    expect(refused.status, refused.out).toBe(1);
    expect(refused.out).toContain('copy-before-update.sh delete');
  });

  it("refuses the OTA stack's .env, and a shell that names the other stack, before any docker call", () => {
    const ota = stage(OTA_ENV);
    const r = run(ota, ['take', TAG]);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('STACK_KIND');
    expect(calls(ota)).toEqual([]);
    expect(existsSync(join(ota.home, '.persistent'))).toBe(false);

    const s = stage();
    const other = run(s, ['take', TAG], { COMPOSE_PROJECT_NAME: OTA });
    expect(other.status, other.out).not.toBe(0);
    expect(calls(s)).toEqual([]);
  });

  it('refuses a call it does not know, and a take without a tag', () => {
    const s = stage();
    for (const args of [[], ['take'], ['prune'], ['take', '--force', TAG]]) {
      const r = run(s, args);
      expect(r.status, `${args.join(' ')}:\n${r.out}`).toBe(2);
    }
    expect(calls(s)).toEqual([]);
  });

  it('the directory is not taken from the shell: the backstop looks there and nowhere else', () => {
    const s = stage();
    const elsewhere = join(s.root, 'elsewhere');
    const r = run(s, ['take', '--trigger', TAG], {
      MANAGED_ENV_PERSIST_DIR: elsewhere,
      MANAGED_BACKUP_DIR: join(elsewhere, 'trigger-backups'),
      TRIGGER_DB_CONTAINER: 'another-stacks-database',
    });
    expect(r.status, r.out).toBe(0);
    expect(existsSync(elsewhere)).toBe(false);
    expect(filesIn(s.dir).filter((f) => f.startsWith('triggerdb-'))).toHaveLength(1);
    expect(calls(s).join('\n')).not.toContain('another-stacks-database');
  });
});

// ===========================================================================
// delete
// ===========================================================================

describe('delete: only once the update is proven', () => {
  it('no deploy took since the copy was taken: refused, and the database is not even asked', () => {
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR);
    logDeploy(s, 5 * HOUR, 'took', RUNNING); // before the copy: another update's
    logDeploy(s, 2 * HOUR, 'did-not-take');
    const r = run(s, ['delete'], { STUB_PSQL_ANSWER: 'yes|0|1\n' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/deploys\.log/);
    expect(filesIn(s.dir)).toEqual(planted);
    expect(calls(s).filter((c) => c.startsWith('psql '))).toEqual([]);
  });

  it('a deploy took, and a later one did not: not proven, refused, and the copy intact, whatever the hold and the passes say', () => {
    // The hold lifted after a did-not-take (the exposure check, say), and
    // passes then succeed on the checkout that did not take: the took line
    // before it proves nothing about what runs now.
    for (const args of [['delete'], ['take', TAG]]) {
      const s = stage();
      const planted = plantCopy(s, 3 * HOUR);
      logDeploy(s, 2 * HOUR, 'took');
      logDeploy(s, 1 * HOUR, 'did-not-take', 'v0.2.0-alpha.3');
      const r = run(s, args, { STUB_PSQL_ANSWER: 'yes|0|1\n' });
      expect(r.status, `${args[0]}:\n${r.out}`).toBe(args[0] === 'delete' ? 1 : 0);
      expect(r.out).toMatch(/did not take/);
      expect(filesIn(s.dir)).toEqual(planted);
      expect(dumps(s)).toEqual([]);
    }
  });

  it("two deploys took since the copy: the proof is the later one's, its hold and the passes after it", () => {
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR);
    const first = logDeploy(s, 2 * HOUR, 'took');
    const later = logDeploy(s, 1 * HOUR, 'took', 'v0.2.0-alpha.3');
    // The later update's hold is still on.
    const r = run(s, ['delete'], { STUB_PSQL_ANSWER: 'yes|1|0\n' });
    expect(r.status, r.out).toBe(1);
    expect(filesIn(s.dir)).toEqual(planted);
    expect(sqlSent(s)).toContain(later);
    expect(sqlSent(s)).not.toContain(first);
    expect(r.out).toContain('v0.2.0-alpha.3');
  });

  it.each([
    ['a database that cannot be read', { STUB_PSQL_FAIL: '1' }, /could not be read/],
    ['a role row security binds', { STUB_PSQL_ANSWER: 'no|0|1\n' }, /superuser/],
    ['an answer that is not counts', { STUB_PSQL_ANSWER: 'ERROR: relation "run" does not exist\n' }, /not.*count/],
  ] as const)('%s is no proof: refused', (_label, extra, why) => {
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR);
    logDeploy(s, 2 * HOUR, 'took');
    const r = run(s, ['delete'], extra);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(why);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it('no copy: nothing to delete, and it says so', () => {
    const s = stage();
    const r = run(s, ['delete']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/no copy/i);
  });

  it('files without a note are no copy of an update, and are not deleted as one: refused, naming them', () => {
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR, { withNote: false });
    logDeploy(s, 2 * HOUR, 'took');
    const r = run(s, ['delete'], { STUB_PSQL_ANSWER: 'yes|0|1\n' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(planted[0]!);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it("refuses the OTA stack's .env before any docker call", () => {
    const s = stage(OTA_ENV);
    const r = run(s, ['delete']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('STACK_KIND');
    expect(calls(s)).toEqual([]);
  });
});

describe('delete, the proof read from a database with both chains applied', () => {
  let dataDir = '';
  const TENANT = 'd0000000-0000-4000-8000-000000000002';
  const withDb = async (fn: (db: PgliteLike) => Promise<void>) => {
    const db = new PGlite(dataDir, { extensions: { pgcrypto } });
    try {
      await fn(db);
    } finally {
      await db.close();
    }
  };
  const setState = (sql: string) =>
    withDb(async (db) => {
      await db.exec(`DELETE FROM run; DELETE FROM platform_pause; ${sql}`);
    });
  // The copy three hours ago, the deploy that took two hours ago, under a
  // hold that began before the copy.
  const HOLD_ON = `INSERT INTO platform_pause (started_at, message, started_by)
    VALUES (now() - interval '3 hours 10 minutes', 'We werken het platform bij.', 'owner-subject');`;
  const HOLD_LIFTED = `INSERT INTO platform_pause (started_at, ended_at, message, started_by, ended_by)
    VALUES (now() - interval '3 hours 10 minutes', now() - interval '90 minutes', 'We werkten het platform bij.',
            'owner-subject', 'owner-subject');`;
  const pass = (kind: string, status: string, startedAgo: string) =>
    `INSERT INTO run (tenant_id, kind, status, started_at, finished_at)
       VALUES ('${TENANT}', '${kind}', '${status}', now() - interval '${startedAgo}', now() - interval '1 minute');`;

  beforeAll(async () => {
    dataDir = join(tempDir('copy-before-update-db-'), 'pg');
    const driver = pgliteDriver({ dataDir });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await driver.end();
    await withDb(async (db) => {
      await db.exec(`INSERT INTO tenant (id, name) VALUES ('${TENANT}', 'A tester');`);
    });
  }, PGLITE_CASE_MS);

  const attempt = async (state: string) => {
    await setState(state);
    const s = stage();
    const planted = plantCopy(s, 3 * HOUR);
    logDeploy(s, 2 * HOUR, 'took');
    const r = run(s, ['delete'], { STUB_PGLITE: dataDir });
    return { s, r, planted };
  };

  it.each([
    ['the hold that covered the deploy is still on', `${HOLD_ON}${pass('incremental', 'succeeded', '30 minutes')}`, /hold/],
    ['the hold is lifted, and no pass since', HOLD_LIFTED, /pass/],
    ['the hold is lifted, and the pass that succeeded began before the deploy took', `${HOLD_LIFTED}${pass('incremental', 'succeeded', '150 minutes')}`, /pass/],
    ['the hold is lifted, and the pass since failed', `${HOLD_LIFTED}${pass('incremental', 'failed', '30 minutes')}`, /pass/],
    ['the hold is lifted, and only a discovery succeeded since', `${HOLD_LIFTED}${pass('discovery', 'succeeded', '30 minutes')}`, /pass/],
  ])(
    'not proven, refused: %s',
    async (_label, state, why) => {
      const { s, r, planted } = await attempt(state);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(why);
      expect(filesIn(s.dir)).toEqual(planted);
      expect(sqlSent(s)).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/i);
    },
    PGLITE_CASE_MS,
  );

  it.each([
    ['the hold lifted, and a pass that began after the deploy succeeded', `${HOLD_LIFTED}${pass('incremental', 'succeeded', '30 minutes')}`],
    [
      'the same, with the next update\'s hold already on',
      `${HOLD_LIFTED}${pass('initial_copy', 'succeeded', '60 minutes')}
       INSERT INTO platform_pause (started_at, message, started_by)
         VALUES (now() - interval '10 minutes', 'We werken het platform weer bij.', 'owner-subject');`,
    ],
  ])(
    'proven, deleted: %s',
    async (_label, state) => {
      const { s, r } = await attempt(state);
      expect(r.status, r.out).toBe(0);
      expect(filesIn(s.dir), 'a file of the copy survived its delete').toEqual([]);
      expect(sqlSent(s)).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/i);
    },
    PGLITE_CASE_MS,
  );

  it(
    'end to end: what take wrote, delete removes, all of it, once proven',
    async () => {
      await setState(`${HOLD_LIFTED}${pass('incremental', 'succeeded', '30 minutes')}`);
      const s = stage();
      const took = run(s, ['take', '--trigger', TAG]);
      expect(took.status, took.out).toBe(0);
      expect(filesIn(s.dir).length).toBeGreaterThan(4);
      // The deploy took after the copy: a second later, as deploys.log would say.
      mkdirSync(dirname(s.deployLog), { recursive: true });
      const later = new Date(Date.now() + 2000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      writeFileSync(s.deployLog, `${later}\t${TAG}\tc0ffee\ttook\tone-way\n`);
      // …and the pass after it: move it past that line.
      await withDb(async (db) => {
        await db.exec(`UPDATE run SET started_at = '${later}'::timestamptz + interval '1 minute';
                       UPDATE platform_pause SET started_at = '${later}'::timestamptz - interval '1 hour',
                                                 ended_at = '${later}'::timestamptz + interval '30 seconds';`);
      });
      const r = run(s, ['delete'], { STUB_PGLITE: dataDir });
      expect(r.status, r.out).toBe(0);
      expect(filesIn(s.dir)).toEqual([]);
    },
    PGLITE_CASE_MS,
  );
});

// ===========================================================================
// expire: the daily backstop
// ===========================================================================

describe('expire, the daily backstop: nothing older than 6 days survives it, nor an hour short of it', () => {
  // The limit is 6 days less an hour: a run that starts late (the token duty
  // before it takes up to 20 minutes, the timer a minute) still deletes a copy
  // before its seventh day ends. The run before the one that deletes it fails.
  const AGES: Array<[string, number, 'kept' | 'last day' | 'deleted']> = [
    ['an hour', HOUR, 'kept'],
    ['a day', DAY, 'kept'],
    ['two hours short of 5 days', 5 * DAY - 2 * HOUR, 'kept'],
    ['half an hour short of 5 days', 5 * DAY - 30 * 60_000, 'last day'],
    ['just over 5 days, day 6', 5 * DAY + 10 * 60_000, 'last day'],
    ['two hours short of 6 days', 6 * DAY - 2 * HOUR, 'last day'],
    ['half an hour short of 6 days', 6 * DAY - 30 * 60_000, 'deleted'],
    ['just over 6 days', 6 * DAY + 10 * 60_000, 'deleted'],
    ['six and a half days', 6.5 * DAY, 'deleted'],
    ['a month', 30 * DAY, 'deleted'],
  ];

  it.each(AGES)('a copy %s old: %s', (_label, age, outcome) => {
    const s = stage();
    const planted = plantCopy(s, age);
    const r = run(s, ['expire']);
    const left = filesIn(s.dir);
    for (const f of left) {
      expect(Date.now() - statSync(join(s.dir, f)).mtimeMs, `${f} is older than 6 days less an hour and survived`).toBeLessThanOrEqual(6 * DAY - HOUR);
    }
    if (outcome === 'deleted') {
      expect(r.status, r.out).toBe(0);
      expect(left).toEqual([]);
      expect(r.out).toMatch(/deleted/i);
    } else if (outcome === 'last day') {
      expect(r.status, r.out).toBe(1);
      expect(left).toEqual(planted);
      expect(r.out).toMatch(/next daily run deletes it/);
      expect(r.out).toMatch(/roll back/);
      expect(r.out).toContain('copy-before-update.sh delete');
    } else {
      expect(r.status, r.out).toBe(0);
      expect(left).toEqual(planted);
    }
    expect(calls(s), 'the backstop needs no database and makes no dump').toEqual([]);
  });

  it("the copy is as old as its note says, whatever its files' times", () => {
    const s = stage();
    plantCopy(s, 7 * DAY);
    const now = Date.now() / 1000;
    for (const f of filesIn(s.dir)) utimesSync(join(s.dir, f), now, now);
    const r = run(s, ['expire']);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir)).toEqual([]);
  });

  it('a dump by hand older than the limit goes by its own age, alone: the copy it sits in stays', () => {
    const s = stage();
    const planted = plantCopy(s, HOUR);
    const stray = join(s.dir, 'zitadel-ownpace-live-20260901T080000Z.dump');
    writeFileSync(stray, 'PGDMP by hand\n', { mode: 0o600 });
    const old = (Date.now() - 8 * DAY) / 1000;
    utimesSync(stray, old, old);
    const r = run(s, ['expire']);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir)).toEqual(planted);
  });

  it('a fresh copy taken beside a dump by hand five and a half days old is as old as its note: kept, and the dump goes alone', () => {
    const s = stage();
    mkdirSync(s.dir, { recursive: true, mode: 0o700 });
    const hand = join(s.dir, 'zitadel-ownpace-live-20260923T080000Z.dump');
    writeFileSync(hand, 'PGDMP by hand\n', { mode: 0o600 });
    const oldish = (Date.now() - 5.5 * DAY) / 1000;
    utimesSync(hand, oldish, oldish);
    const took = run(s, ['take', TAG]);
    expect(took.status, took.out).toBe(0);
    const taken = filesIn(s.dir);
    const first = run(s, ['expire']);
    expect(first.status, `the new copy is on its first day:\n${first.out}`).toBe(0);
    expect(filesIn(s.dir)).toEqual(taken);
    // A day on, the dump by hand is past the limit, and the copy is not.
    const older = (Date.now() - 6.5 * DAY) / 1000;
    utimesSync(hand, older, older);
    const second = run(s, ['expire']);
    expect(second.status, second.out).toBe(0);
    expect(filesIn(s.dir)).toEqual(taken.filter((f) => f !== basename(hand)));
  });

  it('files without a note go by their own age too, each alone', () => {
    const s = stage();
    plantCopy(s, 6 * DAY + HOUR, { withNote: false });
    const young = join(s.dir, 'roles-ownpace-live-20260928T080000Z.sql');
    writeFileSync(young, 'CREATE ROLE zitadel;\n', { mode: 0o600 });
    const day = (Date.now() - DAY) / 1000;
    utimesSync(young, day, day);
    const r = run(s, ['expire']);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir)).toEqual([basename(young)]);
  });

  it('no copy, or no directory at all: nothing to do, exit 0', () => {
    const s = stage();
    expect(run(s, ['expire']).status).toBe(0);
    mkdirSync(s.dir, { recursive: true });
    expect(run(s, ['expire']).status).toBe(0);
  });

  it("refuses the OTA stack's .env", () => {
    const s = stage(OTA_ENV);
    const r = run(s, ['expire']);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('STACK_KIND');
  });
});

// ===========================================================================
// The one directory is a directory
// ===========================================================================

describe('the directory is a directory: a symbolic link there is refused by every script that writes or deletes in it', () => {
  // find does not follow a link it is started on: the backstop would find
  // nothing there, and what went through the link would never be deleted.
  function linked(): { s: Stage; elsewhere: string } {
    const s = stage();
    const elsewhere = join(s.root, 'a-bigger-disk');
    mkdirSync(elsewhere, { recursive: true, mode: 0o700 });
    mkdirSync(dirname(s.dir), { recursive: true });
    symlinkSync(elsewhere, s.dir);
    return { s, elsewhere };
  }

  it.each([[['take', TAG]], [['take', '--dry-run', TAG]], [['delete']], [['expire']], [['since']]])(
    'copy-before-update.sh %j: refused, naming the link, and nothing written through it',
    (args) => {
      const { s, elsewhere } = linked();
      const r = run(s, args, { STUB_PSQL_ANSWER: 'yes|0|1\n' });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(/symbolic link/);
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(dumps(s)).toEqual([]);
    },
  );

  it('expire does not pass over a copy behind a link as no copy: it fails, and the journal says why', () => {
    const { s, elsewhere } = linked();
    writeFileSync(join(elsewhere, 'openmigrate-ownpace-live-20260901T080000Z.dump'), 'PGDMP\n', { mode: 0o600 });
    const old = (Date.now() - 8 * DAY) / 1000;
    utimesSync(join(elsewhere, 'openmigrate-ownpace-live-20260901T080000Z.dump'), old, old);
    const r = run(s, ['expire']);
    expect(r.status, r.out).toBe(1);
    expect(r.out).not.toMatch(/nothing to do/);
  });

  it.each([
    ['dump-idp.sh', []],
    ['trigger-version.sh', ['backup', 'by-hand']],
  ] as const)('%s on live: refused before any docker call', (script, args) => {
    const { s, elsewhere } = linked();
    const r = runIn(s, script, [...args]);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/symbolic link/);
    expect(calls(s)).toEqual([]);
    expect(readdirSync(elsewhere)).toEqual([]);
  });
});

// ===========================================================================
// dump-idp.sh and trigger-version.sh on live
// ===========================================================================

describe('dump-idp.sh on live writes into the copy\'s directory, and nowhere else', () => {
  it('without --dir: into ~/.persistent/<project>/copy-before-update, and no ~/ownpace-dumps', () => {
    const s = stage();
    const r = runIn(s, 'dump-idp.sh', []);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir).filter((f) => f.startsWith('zitadel-ownpace-live-'))).toHaveLength(2);
    expect(filesIn(s.dir).filter((f) => f.startsWith('roles-ownpace-live-'))).toHaveLength(1);
    expect(existsSync(join(s.home, 'ownpace-dumps'))).toBe(false);
    expect(mode(s.dir)).toBe('700');
  });

  it.each([
    ['another directory', (s: Stage) => join(s.root, 'elsewhere')],
    ['a relative one', () => 'elsewhere'],
    ['one that walks out of it', (s: Stage) => `${s.dir}/../elsewhere`],
    ['the directory dump-idp.sh uses on the OTA stack', (s: Stage) => join(s.home, 'ownpace-dumps', LIVE)],
  ])('--dir naming %s: refused before any docker call, and nothing written anywhere', (_label, where) => {
    const s = stage();
    const target = where(s);
    const r = runIn(s, 'dump-idp.sh', ['--dir', target]);
    expect(r.status, r.out).not.toBe(0);
    expect(calls(s)).toEqual([]);
    expect(existsSync(join(s.root, 'elsewhere'))).toBe(false);
    expect(existsSync(join(dirname(s.dir), 'elsewhere'))).toBe(false);
    expect(existsSync(join(s.work, 'elsewhere'))).toBe(false);
    expect(existsSync(join(s.home, 'ownpace-dumps'))).toBe(false);
    expect(filesIn(s.dir)).toEqual([]);
    expect(r.out).toContain('copy-before-update');
  });

  it('--dir naming the directory itself, spelled another way, is that directory', () => {
    const s = stage();
    const r = runIn(s, 'dump-idp.sh', ['--dir', `${s.dir}/./`]);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir).length).toBe(3);
  });

  it("on a .env whose marker is a slip of live's (STACK_KIND = production): the copy's directory too, and no ~/ownpace-dumps", () => {
    const s = stage(SLIP_ENV);
    const r = runIn(s, 'dump-idp.sh', []);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir).filter((f) => f.startsWith('zitadel-ownpace-live-'))).toHaveLength(2);
    expect(existsSync(join(s.home, 'ownpace-dumps'))).toBe(false);
    const elsewhere = runIn(s, 'dump-idp.sh', ['--dir', join(s.root, 'elsewhere')]);
    expect(elsewhere.status, elsewhere.out).not.toBe(0);
    expect(existsSync(join(s.root, 'elsewhere'))).toBe(false);
  });

  it('on the OTA stack it is what it was: ~/ownpace-dumps/<project>', () => {
    const s = stage(OTA_ENV);
    const r = runIn(s, 'dump-idp.sh', []);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(join(s.home, 'ownpace-dumps', OTA))).toHaveLength(3);
    expect(existsSync(join(s.home, '.persistent'))).toBe(false);
  });
});

describe('trigger-version.sh on live: a backup only into the copy\'s directory, and no drill', () => {
  it('the drill is refused on live before any docker call: the test stack drills, live keeps no daily copy', () => {
    const s = stage();
    const r = runIn(s, 'trigger-version.sh', ['drill']);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/test stack/);
    expect(calls(s)).toEqual([]);
    expect(existsSync(join(s.home, '.persistent'))).toBe(false);
  });

  it('a backup on live goes into ~/.persistent/<project>/copy-before-update, and no trigger-backups', () => {
    const s = stage();
    const r = runIn(s, 'trigger-version.sh', ['backup', `before-${TAG}`]);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir).filter((f) => f.startsWith('triggerdb-'))).toHaveLength(1);
    expect(existsSync(join(s.home, '.persistent', LIVE, 'trigger-backups'))).toBe(false);
  });

  it('MANAGED_BACKUP_DIR naming another directory on live is refused before any docker call', () => {
    const s = stage();
    const elsewhere = join(s.root, 'elsewhere');
    const r = runIn(s, 'trigger-version.sh', ['backup', 'x'], { MANAGED_BACKUP_DIR: elsewhere });
    expect(r.status, r.out).not.toBe(0);
    expect(calls(s)).toEqual([]);
    expect(existsSync(elsewhere)).toBe(false);
  });

  it("on a .env whose marker is a slip of live's (STACK_KIND = production): no drill, and a backup only into the copy's directory", () => {
    const s = stage(SLIP_ENV);
    const drill = runIn(s, 'trigger-version.sh', ['drill'], { STUB_PSQL_ANSWER: '12\n' });
    expect(drill.status, drill.out).not.toBe(0);
    expect(drill.out).toMatch(/test stack/);
    expect(calls(s)).toEqual([]);
    const backup = runIn(s, 'trigger-version.sh', ['backup', 'by-hand']);
    expect(backup.status, backup.out).toBe(0);
    expect(filesIn(s.dir).filter((f) => f.startsWith('triggerdb-'))).toHaveLength(1);
    expect(existsSync(join(s.home, '.persistent', LIVE, 'trigger-backups'))).toBe(false);
  });

  it('on the OTA stack the drill runs as the gate runs it, into trigger-backups', () => {
    const s = stage(OTA_ENV);
    // Every count the drill asks answers 12: a schema big enough, the same on both sides.
    const r = runIn(s, 'trigger-version.sh', ['drill'], { STUB_PSQL_ANSWER: '12\n' });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/round trip proved/);
    expect(filesIn(join(s.home, '.persistent', OTA, 'trigger-backups'))).toHaveLength(1);
  });
});

// ===========================================================================
// since: what changed after the copy, done again after the rollback
// ===========================================================================

describe('since: what was erased, closed, reopened or deleted after the copy, written down before the rollback and done again after it', () => {
  // Two databases with both chains applied: the one the copy holds, which a
  // rollback restores, and the one after it, which `since` reads. The file it
  // writes is applied to a fresh copy of the first, the way the runbook applies
  // it with psql: one run of the whole file.
  const ID = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const T = { kept: ID(1), closed: ID(2), reopened: ID(3), erased: ID(4), trimmed: ID(5), newer: ID(6) };
  const C = { gone: ID(11), kept: ID(12), erased: ID(13) };
  const BOX = { kept: ID(21), erased: ID(22) };
  const M = { gone: ID(31), withdrawn: ID(32), kept: ID(33), erased: ID(34) };
  const P = { gone: ID(41), kept: ID(42) };
  const E = { reopened: ID(51), closed: ID(52), erased: ID(53) };
  const ref = (tenant: string) => `encode(sha256(convert_to('${tenant}', 'UTF8')), 'hex')`;
  let copyDb = '';
  let afterDb = '';

  const withDbAt = async <R,>(dir: string, fn: (db: PgliteLike & { query: (q: string) => Promise<{ rows: unknown[] }> }) => Promise<R>): Promise<R> => {
    const db = new PGlite(dir, { extensions: { pgcrypto } }) as PgliteLike & { query: (q: string) => Promise<{ rows: unknown[] }> };
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  };
  const rows = async (dir: string, q: string): Promise<Array<Record<string, unknown>>> =>
    withDbAt(dir, async (db) => (await db.query(q)).rows as Array<Record<string, unknown>>);

  // What the copy holds.
  const AT_THE_COPY = `
    INSERT INTO tenant (id, name) VALUES
      ('${T.kept}', 'Kept'), ('${T.closed}', 'Closed since'), ('${T.reopened}', 'Reopened since'),
      ('${T.erased}', 'Erased since'), ('${T.trimmed}', 'Trimmed since');
    UPDATE tenant SET status = 'closed' WHERE id = '${T.reopened}';
    INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by)
      VALUES ('${T.reopened}', now() - interval '1 day', now() + interval '29 days', 'owner-subject');
    INSERT INTO erasure_record (id, tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at)
      VALUES ('${E.reopened}', ${ref(T.reopened)}, now() - interval '1 day', 30, 7, now() + interval '36 days');
    INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
      ('${T.trimmed}', '100001', 'anna@example.test', 'owner', 'active'),
      ('${T.trimmed}', '100002', 'bob@example.test', 'viewer', 'active'),
      ('${T.erased}', '100003', 'carol@example.test', 'owner', 'active'),
      ('${T.kept}', '100004', 'dave@example.test', 'owner', 'active');
    INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref) VALUES
      ('${C.gone}', '${T.trimmed}', 'source', 'imap', 'deleted since', '{}'::jsonb, 'connected', 'v1:a-credential-deleted-since'),
      ('${C.kept}', '${T.trimmed}', 'source', 'imap', 'kept', '{}'::jsonb, 'connected', 'v1:a-credential-kept'),
      ('${C.erased}', '${T.erased}', 'source', 'imap', 'erased with its organisation', '{}'::jsonb, 'connected', 'v1:erased');
    INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES
      ('${BOX.kept}', '${T.trimmed}', '${C.kept}', 'user', 'someone@example.org'),
      ('${BOX.erased}', '${T.erased}', '${C.erased}', 'user', 'someone-else@example.org');
    INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, source_secret_ref) VALUES
      ('${M.gone}', '${T.trimmed}', '${BOX.kept}', 'active', NULL),
      ('${M.withdrawn}', '${T.trimmed}', '${BOX.kept}', 'active', 'v1:a-token-granted-through-a-link'),
      ('${M.kept}', '${T.trimmed}', '${BOX.kept}', 'active', NULL),
      ('${M.erased}', '${T.erased}', '${BOX.erased}', 'active', NULL);
    INSERT INTO person (id, tenant_id, display_name) VALUES
      ('${P.gone}', '${T.trimmed}', 'Anna'), ('${P.kept}', '${T.trimmed}', 'Bob');
    INSERT INTO share_grant (tenant_id, mapping_id, grant_hash, subject, on_label, grantee, role, raw, verdict, verdict_target) VALUES
      ('${T.trimmed}', '${M.gone}', 'gone-1', 'someone@example.org', 'Photos', 'erin@example.test', 'writer', '{}', 'clean', 'jmap'),
      ('${T.trimmed}', '${M.gone}', 'gone-2', 'someone@example.org', 'Recipes', 'frank@example.test', 'reader', '{}', 'manual', 'jmap'),
      ('${T.trimmed}', '${M.withdrawn}', 'withdrawn-1', 'someone@example.org', 'Taxes', 'erin@example.test', 'reader', '{}', 'clean', 'jmap'),
      ('${T.trimmed}', '${M.kept}', 'kept-1', 'someone@example.org', 'Holidays', 'frank@example.test', 'writer', '{}', 'clean', 'jmap');`;

  // What happened after it.
  const AFTER_THE_COPY = `
    UPDATE tenant SET status = 'closed' WHERE id = '${T.closed}';
    INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by)
      VALUES ('${T.closed}', now() - interval '2 hours', now() + interval '7 days' - interval '2 hours', 'owner-subject');
    INSERT INTO erasure_record (id, tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at)
      VALUES ('${E.closed}', ${ref(T.closed)}, now() - interval '2 hours', 7, 7, now() + interval '14 days');
    DELETE FROM tenant_closure WHERE tenant_id = '${T.reopened}';
    UPDATE tenant SET status = 'active' WHERE id = '${T.reopened}';
    INSERT INTO erasure_record (id, tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at,
                                purged_at, purged_counts, revocations)
      VALUES ('${E.erased}', ${ref(T.erased)}, now() - interval '90 minutes', 0, 7, now() + interval '7 days',
              now() - interval '80 minutes', '{"tenant": 1}'::jsonb, '[{"kind": "imap", "outcome": "not_applicable"}]'::jsonb);
    DELETE FROM mailbox_mapping WHERE tenant_id = '${T.erased}';
    DELETE FROM mailbox WHERE tenant_id = '${T.erased}';
    DELETE FROM connection WHERE tenant_id = '${T.erased}';
    DELETE FROM tenant_member WHERE tenant_id = '${T.erased}';
    DELETE FROM tenant WHERE id = '${T.erased}';
    DELETE FROM mailbox_mapping WHERE id = '${M.gone}';
    DELETE FROM share_grant WHERE mapping_id = '${M.gone}';
    DELETE FROM connection WHERE id = '${C.gone}';
    UPDATE mailbox_mapping SET source_secret_ref = NULL, grant_withdrawn_at = now() - interval '30 minutes'
     WHERE id = '${M.withdrawn}';
    DELETE FROM person WHERE id = '${P.gone}';
    DELETE FROM tenant_member WHERE tenant_id = '${T.trimmed}' AND user_id = '100002';
    INSERT INTO tenant (id, name) VALUES ('${T.newer}', 'New since');`;

  beforeAll(async () => {
    copyDb = join(tempDir('since-the-copy-'), 'pg');
    const driver = pgliteDriver({ dataDir: copyDb });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await driver.end();
    await withDbAt(copyDb, (db) => db.exec(AT_THE_COPY));
    afterDb = join(tempDir('since-after-'), 'pg');
    cpSync(copyDb, afterDb, { recursive: true });
    await withDbAt(afterDb, (db) => db.exec(AFTER_THE_COPY));
  }, PGLITE_CASE_MS);

  /** A copy planted, `since` run against the database after it, and the file it wrote. */
  const since = () => {
    const s = stage();
    plantCopy(s, 3 * HOUR);
    const r = run(s, ['since'], { STUB_PGLITE: afterDb });
    const written = filesIn(s.dir).filter((f) => /^since-the-copy-\d{8}T\d{6}Z\.sql$/.test(f));
    return { s, r, written, sql: written.length === 1 ? readFileSync(join(s.dir, written[0]!), 'utf8') : '' };
  };
  /** A fresh copy of the database the copy holds: what a rollback restores. */
  const restored = () => {
    const dir = join(tempDir('since-restored-'), 'pg');
    cpSync(copyDb, dir, { recursive: true });
    return dir;
  };

  it(
    'writes one file into the copy, readable by the owner alone, sending only SELECTs and changing nothing',
    async () => {
      const before = await rows(afterDb, 'SELECT (SELECT count(*) FROM tenant) AS t, (SELECT count(*) FROM connection) AS c');
      const { s, r, written, sql } = since();
      expect(r.status, r.out).toBe(0);
      expect(written, filesIn(s.dir).join('\n')).toHaveLength(1);
      expect(mode(join(s.dir, written[0]!))).toBe('600');
      expect(r.out).toContain(written[0]!);
      for (const statement of sqlSent(s).split('-- (end of one psql call)').map((x) => x.trim()).filter(Boolean)) {
        expect(statement, 'since sent something that is not a SELECT').toMatch(/^SELECT\b/i);
        expect(statement).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i);
      }
      expect(await rows(afterDb, 'SELECT (SELECT count(*) FROM tenant) AS t, (SELECT count(*) FROM connection) AS c')).toEqual(before);
      // Ids and dates, never a credential, a name or an address.
      for (const secret of ['v1:a-credential-kept', 'v1:a-token-granted-through-a-link', 'anna@example.test', 'Trimmed since', 'Anna', 'erin@example.test', 'Holidays']) {
        expect(sql).not.toContain(secret);
      }
    },
    PGLITE_CASE_MS,
  );

  it(
    'applied to the restored database, it erases, closes, reopens and deletes again what was erased, closed, reopened and deleted after the copy',
    async () => {
      const { r, sql } = since();
      expect(r.status, r.out).toBe(0);
      const dir = restored();
      const printed = await withDbAt(dir, async (db) => {
        const results = (await db.exec(sql)) as Array<{ rows: Array<Record<string, unknown>> }>;
        return results.flatMap((x) => x.rows.map((row) => Object.values(row).join('|')));
      });
      const after = async (q: string) => rows(afterDb, q);
      const now = async (q: string) => rows(dir, q);

      // Closed after the copy: closed, with the dates it was given.
      expect(await now(`SELECT status FROM tenant WHERE id = '${T.closed}'`)).toEqual([{ status: 'closed' }]);
      const closure = `SELECT closed_at, purge_after, closed_by FROM tenant_closure WHERE tenant_id = '${T.closed}'`;
      expect(await now(closure)).toEqual(await after(closure));
      // Reopened after it: open, and nothing scheduled.
      expect(await now(`SELECT status FROM tenant WHERE id = '${T.reopened}'`)).toEqual([{ status: 'active' }]);
      expect(await now(`SELECT tenant_id FROM tenant_closure WHERE tenant_id = '${T.reopened}'`)).toEqual([]);
      // Erased after it: back in the restored database, so closed and due now,
      // which the hourly purge's own query picks up.
      expect(await now(`SELECT status FROM tenant WHERE id = '${T.erased}'`)).toEqual([{ status: 'closed' }]);
      expect(
        await now(`SELECT t.id FROM tenant t JOIN tenant_closure c ON c.tenant_id = t.id
                    WHERE t.status = 'closed' AND c.purge_after <= now() ORDER BY t.id`),
      ).toEqual([{ id: T.erased }]);
      // The erasure records exactly as they are now: nothing deletes one.
      const records = 'SELECT * FROM erasure_record ORDER BY id';
      expect(await now(records)).toEqual(await after(records));
      // Deleted after it, deleted again: the connection and its credential, the
      // migration, the person, the membership; a withdrawn grant's token gone.
      expect(await now(`SELECT id FROM connection WHERE tenant_id = '${T.trimmed}' ORDER BY id`)).toEqual([{ id: C.kept }]);
      expect(await now(`SELECT id FROM mailbox_mapping WHERE tenant_id = '${T.trimmed}' ORDER BY id`)).toEqual([
        { id: M.withdrawn },
        { id: M.kept },
      ]);
      const grant = `SELECT source_secret_ref, grant_withdrawn_at FROM mailbox_mapping WHERE id = '${M.withdrawn}'`;
      expect(await now(grant)).toEqual(await after(grant));
      // The migration deleted again takes its sharing list with it, as its
      // delete did (privacy §9, privacy-sharing-list (b)); the migrations kept
      // keep theirs.
      const lists = `SELECT mapping_id, grant_hash FROM share_grant WHERE tenant_id = '${T.trimmed}' ORDER BY grant_hash`;
      expect(await now(lists), 'the sharing lists after the rollback are not those of the migrations still here').toEqual([
        { mapping_id: M.kept, grant_hash: 'kept-1' },
        { mapping_id: M.withdrawn, grant_hash: 'withdrawn-1' },
      ]);
      expect(await now(lists)).toEqual(await after(lists));
      expect(await now(`SELECT id FROM person WHERE tenant_id = '${T.trimmed}'`)).toEqual([{ id: P.kept }]);
      expect(await now(`SELECT user_id FROM tenant_member WHERE tenant_id = '${T.trimmed}'`)).toEqual([{ user_id: '100001' }]);
      // Untouched: what did not change, and what the restore took back (new since).
      expect(await now(`SELECT status FROM tenant WHERE id = '${T.kept}'`)).toEqual([{ status: 'active' }]);
      expect(await now(`SELECT id FROM tenant WHERE id = '${T.newer}'`)).toEqual([]);
      // The sign-in accounts to remove again once the purge has run: the
      // erased organisation's member, and the member removed after the copy.
      const commands = printed.filter((l) => l.includes('idp-strays.sh'));
      expect(commands.sort()).toEqual([
        './deploy/compose/idp-strays.sh --subject 100002 --remove',
        './deploy/compose/idp-strays.sh --subject 100003 --remove',
      ]);
    },
    PGLITE_CASE_MS,
  );

  it(
    'applied to a database none of whose organisations it lists, it stops, and changes nothing',
    async () => {
      const { r, sql } = since();
      expect(r.status, r.out).toBe(0);
      const other = join(tempDir('since-other-'), 'pg');
      const driver = pgliteDriver({ dataDir: other });
      await runMigrations({ driver, logger: () => {} });
      await runManagedMigrations({ driver, logger: () => {} });
      await driver.end();
      await withDbAt(other, (db) => db.exec(`INSERT INTO tenant (id, name) VALUES ('${ID(99)}', 'Another stack''s')`));
      await expect(withDbAt(other, (db) => db.exec(sql))).rejects.toThrow(/not the database the copy was taken from/);
      expect(await rows(other, `SELECT status FROM tenant`)).toEqual([{ status: 'active' }]);
      expect(await rows(other, `SELECT count(*)::int AS n FROM tenant_closure`)).toEqual([{ n: 0 }]);
    },
    PGLITE_CASE_MS,
  );

  it('refuses without a copy, on a database it cannot read, and as a role row security binds; writes nothing', () => {
    const none = stage();
    const r0 = run(none, ['since'], { STUB_PSQL_ANSWER: 'yes\n' });
    expect(r0.status, r0.out).toBe(1);
    expect(r0.out).toMatch(/no copy/i);
    // The row-security case answers every question with a row of the shape a
    // part expects, so that only the superuser check can refuse it.
    const aRow = `  ('${ID(1)}'::uuid, 'active', NULL::timestamptz, NULL::timestamptz, NULL)\n`;
    for (const [extra, why] of [
      [{ STUB_PSQL_FAIL: '1' }, /could not be read/],
      [{ STUB_PSQL_ANSWER: aRow }, /superuser/],
    ] as const) {
      const s = stage();
      const planted = plantCopy(s, HOUR);
      const r = run(s, ['since'], extra);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(why);
      expect(filesIn(s.dir)).toEqual(planted);
    }
    const ota = stage(OTA_ENV);
    const r1 = run(ota, ['since']);
    expect(r1.status, r1.out).toBe(1);
    expect(calls(ota)).toEqual([]);
  });
});

// ===========================================================================
// The way back, written down
// ===========================================================================

describe('the way back is written down where the operator looks', () => {
  // The workplan says it too, but a workplan is not on a path CI runs the
  // tests for (a-doc-a-test-reads-that-ci-skipped), so it is not read here.
  it("the runbook's Backup & restore says what the copy is, how it goes, and how to roll back from it by day 6", () => {
    const runbook = readFileSync(join(REPO_ROOT, 'docs', 'operator-runbook.md'), 'utf8');
    const start = runbook.indexOf('### The copy before an update');
    expect(start, 'docs/operator-runbook.md has no section "The copy before an update"').toBeGreaterThan(-1);
    const section = runbook.slice(start, runbook.indexOf('\n## ', start));
    for (const words of [
      '~/.persistent/ownpace-live/copy-before-update',
      './deploy/compose/copy-before-update.sh delete',
      'day 6',
      './deploy/compose/copy-before-update.sh since',
      '--clean --if-exists --create',
      'since-the-copy-<stamp>.sql',
      'trigger-version.sh restore',
      './deploy/compose/deploy-live.sh',
      'idp-strays.sh',
    ]) {
      expect(section, `the section does not say ${words}`).toContain(words);
    }
    // The erasures after the copy are done again BEFORE the stack comes back:
    // since is written before the restore, and applied before the deploy.
    const at = (w: string) => section.indexOf(w);
    expect(at('copy-before-update.sh since')).toBeLessThan(at('--clean --if-exists --create'));
    expect(at('since-the-copy-<stamp>.sql')).toBeLessThan(at('./deploy/compose/deploy-live.sh'));
  });

  it('what it says of the seventh day: never past it, never "never reaches" it', () => {
    // A copy over 6 days old waiting for the next run is ON its seventh day.
    for (const rel of [
      'deploy/compose/copy-before-update.sh',
      'deploy/compose/box-duties.sh',
      'docs/operator-runbook.md',
      'docs/managed-bring-up.md',
    ]) {
      const text = readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\s+/g, ' ');
      expect(text, rel).not.toMatch(/never reach(es)? (day 7|its seventh day|N = 7 days)/);
    }
  });

  it("the bring-up's deploy section and its daily duties name the script", () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', 'managed-bring-up.md'), 'utf8');
    expect(doc).toContain('copy-before-update.sh expire');
    expect(doc).toContain('./deploy/compose/copy-before-update.sh delete');
  });
});
