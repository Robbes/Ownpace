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
 *   delete. Only once the update is proven: deploys.log says a deploy took
 *   since the copy was taken, the hold that covered it is lifted, and a pass
 *   that started after it succeeded. Each read from a database with both
 *   migration chains applied (PGlite behind the `psql` stub), and each missing
 *   one refuses; a database it cannot read, or a role row security binds, is
 *   no proof. It sends no statement that writes.
 *
 *   expire, the daily backstop. Nothing older than 6 days survives it, proven
 *   or not, so a copy never reaches day 7 between two daily runs. Day 6 keeps
 *   the copy and fails, saying to roll back from it or delete it.
 *
 *   dump-idp.sh on live writes into that directory and nowhere else, and
 *   trigger-version.sh on live dumps only there and never drills; on the OTA
 *   stack both are what they were.
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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** A line of deploys.log, as deploy-live.sh appends it. */
function logDeploy(s: Stage, ago: number, outcome: 'took' | 'did-not-take', tag = TAG): void {
  mkdirSync(dirname(s.deployLog), { recursive: true });
  const line = [iso(ago), tag, 'c0ffee0000000000000000000000000000000000', outcome, 'one-way'].join('\t');
  writeFileSync(s.deployLog, `${existsSync(s.deployLog) ? readFileSync(s.deployLog, 'utf8') : ''}${line}\n`);
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

describe('expire, the daily backstop: nothing older than 6 days survives it', () => {
  const AGES: Array<[string, number, 'kept' | 'day 6' | 'deleted']> = [
    ['an hour', HOUR, 'kept'],
    ['a day', DAY, 'kept'],
    ['just under 5 days', 5 * DAY - 10 * 60_000, 'kept'],
    ['just over 5 days, day 6', 5 * DAY + 10 * 60_000, 'day 6'],
    ['just under 6 days', 6 * DAY - 10 * 60_000, 'day 6'],
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
      expect(Date.now() - statSync(join(s.dir, f)).mtimeMs, `${f} is older than 6 days and survived`).toBeLessThanOrEqual(6 * DAY);
    }
    if (outcome === 'deleted') {
      expect(r.status, r.out).toBe(0);
      expect(left).toEqual([]);
      expect(r.out).toMatch(/deleted/i);
    } else if (outcome === 'day 6') {
      expect(r.status, r.out).toBe(1);
      expect(left).toEqual(planted);
      expect(r.out).toMatch(/day 6/);
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

  it('and as old as its oldest file: a dump older than 6 days takes the copy it sits in with it', () => {
    const s = stage();
    plantCopy(s, HOUR);
    const stray = join(s.dir, 'zitadel-ownpace-live-20260901T080000Z.dump');
    writeFileSync(stray, 'PGDMP by hand\n', { mode: 0o600 });
    const old = (Date.now() - 8 * DAY) / 1000;
    utimesSync(stray, old, old);
    const r = run(s, ['expire']);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir)).toEqual([]);
  });

  it('files without a note go by their own age too', () => {
    const s = stage();
    plantCopy(s, 6 * DAY + HOUR, { withNote: false });
    const r = run(s, ['expire']);
    expect(r.status, r.out).toBe(0);
    expect(filesIn(s.dir)).toEqual([]);
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
      '--clean --if-exists --create',
      'trigger-version.sh restore',
      './deploy/compose/deploy-live.sh',
    ]) {
      expect(section, `the section does not say ${words}`).toContain(words);
    }
  });

  it("the bring-up's deploy section and its daily duties name the script", () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs', 'managed-bring-up.md'), 'utf8');
    expect(doc).toContain('copy-before-update.sh expire');
    expect(doc).toContain('./deploy/compose/copy-before-update.sh delete');
  });
});
