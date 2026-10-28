// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEPLOY THE OWNER WAITED HOURS TO PROVE (workplan 0132 T9; the owner,
 * 2026-10-28).
 *
 * `deploy/compose/deploy-live.sh` skips the smoke on live: the smoke makes
 * organisations and users, and ends every open hold, so a deploy to live is
 * checked by its version and its pages, never by a pass. The update is proven
 * only once a pass that started after the deploy has succeeded, and until then
 * `copy-before-update.sh delete` refuses. Passes come every hour for 14 days,
 * then every 6 hours, then once a day (`packages/orchestration/src/sync-due.ts`),
 * so after lifting the hold the owner waited for one, hours on a migration that
 * is in step, before the update was proven and the copy could go.
 *
 * `deploy/compose/live-pass-check.sh` starts one pass, on a small migration of
 * the owner's own (`LIVE_PASS_CHECK_MIGRATION` in live's `.env`), the moment
 * the hold is lifted, as *Sync now* starts it: `apps/api/src/scripts/live-pass.ts`,
 * run by Node at its absolute path inside the api container, goes through the
 * button's own gates and its one enqueue. It then follows that pass by its
 * Trigger.dev run id and says within 15 minutes how it ended. Live's box checks
 * count a pass it reports succeeded when they prove the update
 * (`copy-before-update.sh delete-if-proven`, guarded in
 * `one-copy-before-each-update`). What must never go wrong, a block each:
 *
 *   Live only, refused before Docker is asked: the OTA stack's `.env`, a
 *   missing, blank or malformed `LIVE_PASS_CHECK_MIGRATION`, caps or polls
 *   that are not whole numbers. A refusal names the key, never its value.
 *
 *   No pass while the answer is no: a database it cannot read, a role row
 *   security binds, a migration that is not there, not the owner's, not
 *   running or selecting nothing, a hold on, the tick's caps full (counted by
 *   the tick's own rule, a blank cap read as the tick reads it), or a pass of
 *   that migration already running. None of these reaches the api container.
 *   The window, the default caps, the kinds and run-delta-sync's attempts are
 *   copies in the script, each compared with its source.
 *
 *   The press is Node by its absolute path (the distroless image's, then the
 *   Node image's), never a shell, `printenv` or a bare `node`, with exactly the
 *   two ids; and what Sync now answered is read: its hold refusal is exit 3,
 *   its other refusals exit 2, and anything it cannot read exit 7.
 *
 *   The follow is by the run's `orchestrator_ref`, never a time window: a
 *   retry after a failed attempt is followed to its end, a failed attempt is
 *   final after its third or 180 s, and `succeeded` is said only when every
 *   data type the migration selects completed in that pass.
 *
 *   Every case: every statement it sends is a SELECT, and nothing it prints
 *   holds an id, an address or a value from the `.env` but the caps and the
 *   project's name.
 *
 *   Against the real schema: the first read and the follow, on PGlite with
 *   both migration chains applied, behind the `psql` stub.
 *
 * `docker` and `psql` are stubs on the PATH. The docker stub runs `exec -T
 * postgres sh -c <cmd>` itself with the container's two variables, so the
 * script's own psql command line reaches the psql stub, which answers its Nth
 * call from a file (the last one repeats) or from PGlite.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import { BILLABLE_RUN_KINDS, runManagedMigrations } from '@openmig/managed';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = 'deploy/compose/live-pass-check.sh';
const PRESS = 'apps/api/src/scripts/live-pass.ts';
const ENV_EXAMPLE = 'deploy/compose/managed.env.example';
const BRING_UP = 'docs/managed-bring-up.md';
const RELEASE = 'docs/release.md';
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'live-pass-check.sh';

const LIVE = 'ownpace-live';
const TENANT = 'e0000000-0000-4000-8000-000000000001';
const MAPPING = 'e0000000-0000-4000-8000-000000000031';
const RUN_ID = 'run_cm9livepass0001';
const STARTED = '2026-10-28T09:12:03Z';
const SENTINEL = 'sentinel-3f80d2';
const DISTROLESS_NODE = '/nodejs/bin/node';
const IMAGE_NODE = '/usr/local/bin/node';

const CASE_MS = 60_000;
const PGLITE_CASE_MS = 180_000;

const LIVE_ENV = [
  `COMPOSE_PROJECT_NAME=${LIVE}`,
  'STACK_KIND=production',
  'POSTGRES_USER=openmigrate',
  'POSTGRES_DB=openmigrate',
  `POSTGRES_PASSWORD=${SENTINEL}`,
  `LIVE_PASS_CHECK_MIGRATION=${MAPPING}`,
  '',
].join('\n');
/** The OTA stack's `.env`: no marker, no project (managed.yml's own name). */
const OTA_ENV = ['POSTGRES_USER=openmigrate', `POSTGRES_PASSWORD=${SENTINEL}`, `LIVE_PASS_CHECK_MIGRATION=${MAPPING}`, ''].join(
  '\n',
);

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
}, 120_000);

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
 * docker: `compose … exec -T postgres sh -c <cmd>`, which it runs itself with
 * the container's two variables; `compose … exec -T api <path> --version`,
 * answered only for the path STUB_NODE names; and `compose … exec -T api
 * <path> apps/api/src/scripts/live-pass.ts <organisation> <migration>`, which
 * prints STUB_PRESS and exits STUB_PRESS_RC. Anything else fails.
 */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
[ "$1" = compose ] || { echo "docker stub: unexpected call: $*" >&2; exit 98; }
while [ "$#" -gt 0 ] && [ "$1" != exec ]; do shift; done
if [ "\${1:-}" != exec ] || [ "\${2:-}" != -T ] || [ "$#" -lt 3 ]; then
  echo "docker stub: unexpected call" >&2
  exit 98
fi
service="$3"
shift 3
case "$service" in
  postgres)
    if [ "$#" -eq 3 ] && [ "$1" = sh ] && [ "$2" = -c ]; then
      export POSTGRES_USER=openmigrate POSTGRES_DB=openmigrate
      exec sh -c "$3"
    fi
    ;;
  api)
    printf 'api %s\\n' "$*" >>"$STUB_LOG"
    if [ "$#" -eq 2 ] && [ "$2" = --version ]; then
      [ "$1" = "\${STUB_NODE:-}" ] || exit 127
      echo v24.22.1
      exit 0
    fi
    if [ "$#" -eq 4 ] && [ "$2" = ${PRESS} ]; then
      [ -z "\${STUB_PRESS:-}" ] || printf '%s\\n' "$STUB_PRESS"
      exit "\${STUB_PRESS_RC:-0}"
    fi
    ;;
esac
echo "docker stub: unexpected call to $service: $*" >&2
exit 98
`;

/**
 * psql: the Nth call answered from the file STUB_PSQL_DIR/N (the last one
 * repeats), a failure from the call STUB_PSQL_FAIL names on, or PGlite when
 * STUB_PGLITE names a data directory.
 */
const PSQL_STUB = (node: string) => `#!${node}
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const sql = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.STUB_LOG, 'psql ' + args.join(' ') + '\\n');
fs.appendFileSync(process.env.STUB_SQL_LOG, sql + '\\n-- (end of one psql call)\\n');
const nth = fs.readFileSync(process.env.STUB_LOG, 'utf8').split('\\n').filter((l) => l.startsWith('psql ')).length;
if (process.env.STUB_PSQL_FAIL && nth >= Number(process.env.STUB_PSQL_FAIL)) {
  process.stderr.write('psql: error: connection to server on socket failed\\n');
  process.exit(2);
}
if (!process.env.STUB_PGLITE) {
  const dir = process.env.STUB_PSQL_DIR;
  const last = Math.max(0, ...fs.readdirSync(dir).filter((f) => /^[0-9]+$/.test(f)).map(Number));
  if (last === 0) process.exit(0);
  process.stdout.write(fs.readFileSync(path.join(dir, String(Math.min(nth, last))), 'utf8'));
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
// A checkout of live
// ---------------------------------------------------------------------------

interface Stage {
  root: string;
  work: string;
  compose: string;
  answers: string;
  log: string;
  sqlLog: string;
  env: NodeJS.ProcessEnv;
}

function writeExec(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/** Live's checkout with `dotEnv` beside the script, or no `.env` at all. */
function stage(dotEnv: string | null = LIVE_ENV): Stage {
  const root = tempDir('live-pass-check-');
  const work = join(root, LIVE);
  const compose = join(work, 'deploy', 'compose');
  const home = join(root, 'home');
  mkdirSync(compose, { recursive: true });
  mkdirSync(home);
  for (const f of [SCRIPT, 'env-read.sh', 'stack-kind.sh', 'managed.yml']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  if (dotEnv !== null) writeFileSync(join(compose, '.env'), dotEnv);

  const bin = join(root, 'bin');
  writeExec(join(bin, 'docker'), DOCKER_STUB);
  writeExec(join(bin, 'psql'), PSQL_STUB(process.execPath));
  const answers = join(root, 'psql-answers');
  mkdirSync(answers);
  const log = join(root, 'calls.log');
  const sqlLog = join(root, 'sql.log');
  writeFileSync(log, '');
  writeFileSync(sqlLog, '');
  return {
    root,
    work,
    compose,
    answers,
    log,
    sqlLog,
    env: {
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      HOME: home,
      LANG: 'C',
      STUB_LOG: log,
      STUB_SQL_LOG: sqlLog,
      STUB_PSQL_DIR: answers,
      STUB_NODE: IMAGE_NODE,
      STUB_PRESS: `started\t${RUN_ID}`,
      LIVE_PASS_CHECK_INTERVAL: '0',
    },
  };
}

/** psql's answers, the first call's first: one line each. */
function answer(s: Stage, ...lines: string[]): void {
  lines.forEach((line, i) => writeFileSync(join(s.answers, String(i + 1)), `${line}\n`));
}

/** What the first read answers, as pre_read gives it, column by column. */
interface FirstRead {
  superuser: string;
  holds: number;
  tenant: string;
  status: string;
  owners: number;
  selected: number;
  inFlight: number;
  inFlightOrg: number;
  runningHere: number;
}

/** The first read's line, every value in order. */
function pre(p: Partial<FirstRead> = {}): string {
  return [
    p.superuser ?? 'yes',
    p.holds ?? 0,
    p.tenant ?? TENANT,
    p.status ?? 'active',
    p.owners ?? 1,
    p.selected ?? 2,
    p.inFlight ?? 0,
    p.inFlightOrg ?? 0,
    p.runningHere ?? 0,
  ].join('|');
}

/** What a follow read answers, as follow_read gives it, column by column. */
interface FollowRead {
  attempts: number;
  state: string;
  started: string;
  sinceFinished: string;
  selected: number;
  done: number;
  items: string;
}

/** A follow read's line. */
function row(r: Partial<FollowRead> = {}): string {
  return [
    r.attempts ?? 1,
    r.state ?? 'running',
    r.started ?? STARTED,
    r.sinceFinished ?? '-',
    r.selected ?? 2,
    r.done ?? 0,
    r.items ?? '-',
  ].join('|');
}
/** No row for that run id yet: the pass is queued at the orchestrator. */
const NO_ROW = row({ attempts: 0, state: '-', started: '-' });
const SUCCEEDED = row({ state: 'succeeded', sinceFinished: '4', done: 2, items: '14' });

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const WRITES = /\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/i;
const VERDICT = '[live-pass-check] verdict: ';

const calls = (s: Stage, what: string): string[] =>
  readFileSync(s.log, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(`${what} `))
    .map((l) => l.slice(what.length + 1));
const dockerCalls = (s: Stage) => calls(s, 'docker');
const apiCalls = (s: Stage) => calls(s, 'api');
const presses = (s: Stage) => apiCalls(s).filter((c) => c.includes(PRESS));
const statements = (s: Stage): string[] =>
  readFileSync(s.sqlLog, 'utf8')
    .split('\n-- (end of one psql call)\n')
    .map((sql) => sql.trim())
    .filter(Boolean);

/**
 * One run, and what every run must hold whatever it answers: every statement
 * a SELECT; the api container asked only for Node's version at an absolute
 * path, or for the press with exactly the two ids; every line on stdout its
 * own; no id, address or secret printed; and the verdict its last line.
 */
function run(s: Stage, extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
  const r = spawnSync(join(s.compose, SCRIPT), args, {
    encoding: 'utf8',
    env: { ...s.env, ...extra },
    cwd: s.work,
    timeout: 60_000,
  });
  const out = { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };

  for (const sql of statements(s)) {
    expect(sql, 'a statement that is not a SELECT').toMatch(/^(SELECT|WITH)\b/);
    expect(sql, 'a statement that writes').not.toMatch(WRITES);
  }
  for (const call of apiCalls(s)) {
    const argv = call.split(' ');
    expect(argv[0], `the api container was asked without Node at an absolute path: ${call}`).toMatch(/^\/[a-z/]+\/node$/);
    if (argv[1] === '--version') expect(argv).toHaveLength(2);
    else expect(argv.slice(1), `the api container was asked something else: ${call}`).toEqual([PRESS, TENANT, MAPPING]);
  }
  for (const line of out.stdout.split('\n').filter(Boolean)) {
    expect(line, 'a line on stdout without its prefix').toMatch(/^\[live-pass-check\] /);
  }
  expect(out.out, 'it printed an e-mail address').not.toMatch(/[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}/i);
  expect(out.out, 'it printed an id').not.toMatch(UUID);
  expect(out.out, 'it printed an IPv4 address').not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  expect(out.out, 'it printed a value from the .env').not.toContain(SENTINEL);
  // A pass's end on stdout, a refusal or a could-not-tell on stderr: the last line either way.
  const stream = [0, 1, 5, 6].includes(out.status) ? out.stdout : out.stderr;
  expect(stream.trimEnd().split('\n').at(-1), `the last line is not the verdict:\n${out.out}`).toMatch(/^\[live-pass-check\] verdict: /);
  return { ...out, verdict: stream.trimEnd().split('\n').at(-1)!.slice(VERDICT.length) };
}

// ===========================================================================
// Live only, refused before Docker is asked
// ===========================================================================

describe('refused before anything asks Docker, naming the key and never its value', () => {
  const withEnv = (key: string, value: string | null) =>
    LIVE_ENV.split('\n')
      .filter((l) => !l.startsWith(`${key}=`))
      .concat(value === null ? [] : [`${key}=${value}`, ''])
      .join('\n');

  it.each<[string, string | null, NodeJS.ProcessEnv, string[], RegExp]>([
    ['an argument', LIVE_ENV, {}, ['--now'], /takes no arguments/],
    ['no .env beside it', null, {}, [], /no \.env beside this script/],
    ["the OTA stack's .env", OTA_ENV, {}, [], /STACK_KIND/],
    ['LIVE_PASS_CHECK_MIGRATION missing', withEnv('LIVE_PASS_CHECK_MIGRATION', null), {}, [], /LIVE_PASS_CHECK_MIGRATION .*is empty/],
    ['LIVE_PASS_CHECK_MIGRATION blank', withEnv('LIVE_PASS_CHECK_MIGRATION', ''), {}, [], /LIVE_PASS_CHECK_MIGRATION .*is empty/],
    ['LIVE_PASS_CHECK_MIGRATION malformed', withEnv('LIVE_PASS_CHECK_MIGRATION', SENTINEL), {}, [], /LIVE_PASS_CHECK_MIGRATION .*is not a migration's id/],
    ['LIVE_PASS_CHECK_MIGRATION quoted', withEnv('LIVE_PASS_CHECK_MIGRATION', `"${MAPPING}"`), {}, [], /LIVE_PASS_CHECK_MIGRATION .*is not a migration's id/],
    ['MAX_PASSES_IN_FLIGHT=six', `${LIVE_ENV}MAX_PASSES_IN_FLIGHT=six\n`, {}, [], /MAX_PASSES_IN_FLIGHT .*not a whole number/],
    ['MAX_PASSES_PER_ORGANISATION=0', `${LIVE_ENV}MAX_PASSES_PER_ORGANISATION=0\n`, {}, [], /MAX_PASSES_PER_ORGANISATION .*not a whole number/],
    ['LIVE_PASS_CHECK_POLLS=0', LIVE_ENV, { LIVE_PASS_CHECK_POLLS: '0' }, [], /LIVE_PASS_CHECK_POLLS/],
    ['LIVE_PASS_CHECK_INTERVAL=x', LIVE_ENV, { LIVE_PASS_CHECK_INTERVAL: 'x' }, [], /LIVE_PASS_CHECK_INTERVAL/],
  ])('%s: exit 2, and Docker never asked', (_, dotEnv, extra, args, says) => {
    const s = stage(dotEnv);
    answer(s, pre(), SUCCEEDED);
    const r = run(s, extra, args);
    expect(r.status, r.out).toBe(2);
    expect(r.verdict).toMatch(/^refused, nothing was started: /);
    expect(r.verdict).toMatch(says);
    expect(r.stdout).toBe('');
    expect(dockerCalls(s)).toEqual([]);
  }, CASE_MS);

  it("live's .env with the OTA stack's project: refused by compose_project, before Docker", () => {
    const s = stage(LIVE_ENV.replace(`COMPOSE_PROJECT_NAME=${LIVE}`, 'COMPOSE_PROJECT_NAME=ownpace-managed'));
    const r = run(s);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('compose_project: ');
    expect(dockerCalls(s)).toEqual([]);
  }, CASE_MS);
});

// ===========================================================================
// The first read: the migration, the hold and the room
// ===========================================================================

describe('the first read: no pass while the answer is no, and none of these reaches the api container', () => {
  it.each<[string, number, string, RegExp]>([
    ['a role row security binds', 7, pre({ superuser: 'no' }), /^could not tell: the role psql connects as is bound by row security/],
    ['an answer that is not the counts', 7, 'yes|0|1', /^could not tell: the database answered something that is not the counts/],
    ['two lines', 7, `${pre()}\n${pre()}`, /^could not tell: the database answered something that is not the counts/],
    ['a migration not on this stack', 2, pre({ tenant: '-', status: '-', owners: 0, selected: 0 }), /names no migration on this stack/],
    ['no platform operator an active owner of its organisation', 2, pre({ owners: 0 }), /not in an organisation where a platform operator is an active owner.*operator\.sh list/],
    ['a migration that is done', 2, pre({ status: 'done' }), /the migration is done, not running/],
    ['a migration that is paused', 2, pre({ status: 'paused' }), /the migration is paused, not running/],
    ['a migration that selects nothing', 2, pre({ selected: 0 }), /selects no data type/],
    ['a hold on', 3, pre({ holds: 1 }), /^refused, the hold is on: nothing was started/],
    ['a hold on and the room full', 3, pre({ holds: 2, inFlight: 9 }), /^refused, the hold is on/],
  ])('%s: exit %i', (_, code, first, says) => {
    const s = stage();
    answer(s, first, SUCCEEDED);
    const r = run(s);
    expect(r.status, r.out).toBe(code);
    expect(r.verdict).toMatch(says);
    expect(apiCalls(s)).toEqual([]);
    expect(statements(s)).toHaveLength(1);
  }, CASE_MS);

  it('a database it cannot read is "could not tell", exit 7, and never a full room', () => {
    const s = stage();
    answer(s, pre());
    const r = run(s, { STUB_PSQL_FAIL: '1' });
    expect(r.status, r.out).toBe(7);
    expect(r.verdict).toMatch(/^could not tell: the database could not be read/);
    expect(r.out).not.toMatch(/capacity/);
    expect(apiCalls(s)).toEqual([]);
  }, CASE_MS);

  it('asks as the owner over the postgres container\'s socket, and only for this migration', () => {
    const s = stage();
    answer(s, pre(), SUCCEEDED);
    run(s);
    expect(dockerCalls(s)[0]).toMatch(/ exec -T postgres sh -c psql -X -q -At -F "\|" -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" -d "\$POSTGRES_DB"$/);
    expect(dockerCalls(s)[0]).toContain(`--env-file ${join(s.compose, '.env')}`);
    const first = statements(s)[0]!;
    expect(first).toContain(`WHERE id = '${MAPPING}'`);
    expect(first).toContain('FROM platform_pause WHERE ended_at IS NULL');
    expect(first).toContain("kind IN ('initial_copy', 'incremental')");
  }, CASE_MS);
});

describe("the room: counted by the tick's own rule, and stricter than Sync now", () => {
  it.each<[string, string, string, RegExp | null]>([
    ['a pass of this migration running', pre({ runningHere: 1 }), '', /a pass of this migration is running already/],
    ['3 in flight with a blank cap', pre({ inFlight: 3 }), 'MAX_PASSES_IN_FLIGHT=\n', /3 pass\(es\) in flight on live, and MAX_PASSES_IN_FLIGHT allows 3/],
    ['2 of this organisation with a blank cap', pre({ inFlight: 2, inFlightOrg: 2 }), 'MAX_PASSES_PER_ORGANISATION=\n', /2 of this organisation's, and MAX_PASSES_PER_ORGANISATION allows 2/],
    ['5 in flight under a cap of 6', pre({ inFlight: 5 }), 'MAX_PASSES_IN_FLIGHT=6\n', null],
    ['2 of this organisation under a cap of 3', pre({ inFlight: 2, inFlightOrg: 2 }), 'MAX_PASSES_PER_ORGANISATION=3\n', null],
  ])('%s', (_, first, caps, full) => {
    const s = stage(`${LIVE_ENV}${caps}`);
    answer(s, first, SUCCEEDED);
    const r = run(s);
    if (full) {
      expect(r.status, r.out).toBe(4);
      expect(r.verdict).toMatch(/^refused, capacity is full: /);
      expect(r.verdict).toMatch(full);
      expect(r.verdict).toMatch(/nothing was started\. Run this again once a pass ends\.$/);
      expect(presses(s)).toEqual([]);
    } else {
      expect(r.status, r.out).toBe(0);
      expect(presses(s)).toHaveLength(1);
      expect(r.stdout).toMatch(/no hold is on, \d+ of \d+ pass\(es\) in flight, \d+ of \d+ of this organisation's/);
    }
  }, CASE_MS);

  it(
    "counts with the tick's own window, caps and kinds, and follows run-delta-sync's own attempts",
    async () => {
      // Importing the tick opens a Pool; it is never used here.
      process.env.SYSTEM_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
      // And the pass it triggers, run-delta-sync, opens its pools at import
      // through openTaskPools, which refuses without APP_DATABASE_URL (0138 T1).
      process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
      // Where each comes from. Named here so that docs/LESSONS.md lists this
      // guard under each.
      for (const source of [
        'apps/worker/src/jobs/managed-sync-tick.ts',
        'packages/managed/src/usage-metering.ts',
        'apps/worker/trigger.config.ts',
      ]) {
        expect(existsSync(join(REPO_ROOT, source)), source).toBe(true);
      }
      const tick = await import('../apps/worker/src/jobs/managed-sync-tick.ts');
      const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
      const value = (key: string): number => Number(new RegExp(`^${key}=(\\d+)$`, 'm').exec(script)?.[1]);
      expect(value('STALE_RUN_AFTER_SECONDS') * 1000).toBe(tick.STALE_RUN_AFTER_MS);
      expect(value('DEFAULT_MAX_PASSES_IN_FLIGHT')).toBe(tick.DEFAULT_MAX_PASSES_IN_FLIGHT);
      expect(value('DEFAULT_MAX_PASSES_PER_ORGANISATION')).toBe(tick.DEFAULT_MAX_PASSES_PER_ORGANISATION);
      // Every count of passes in flight, by the kinds the tick counts.
      const kinds = [...script.matchAll(/kind IN \(([^)]*)\)/g)].map((m) => m[1]);
      expect(kinds.length, 'no count of passes by kind in the script').toBeGreaterThanOrEqual(3);
      for (const list of kinds) expect(list).toBe(BILLABLE_RUN_KINDS.map((k) => `'${k}'`).join(', '));
      // run-delta-sync sets no retry of its own, so the config's default is
      // its: the attempts, and a wait for the last retry longer than its backoff.
      const config = readFileSync(join(REPO_ROOT, 'apps/worker/trigger.config.ts'), 'utf8');
      expect(value('ATTEMPTS')).toBe(Number(/maxAttempts: (\d+)/.exec(config)?.[1]));
      expect(value('RETRY_GRACE_SECONDS') * 1000).toBeGreaterThan(
        Number(/maxTimeoutInMs: ([\d_]+)/.exec(config)?.[1]?.replaceAll('_', '')),
      );
    },
    PGLITE_CASE_MS,
  );
});

// ===========================================================================
// The press
// ===========================================================================

describe("the press: Node at its absolute path, with the two ids, and Sync now's answer read", () => {
  it.each([[DISTROLESS_NODE], [IMAGE_NODE]])('Node at %s is the one that presses', (node) => {
    const s = stage();
    answer(s, pre(), SUCCEEDED);
    const r = run(s, { STUB_NODE: node });
    expect(r.status, r.out).toBe(0);
    expect(presses(s)).toEqual([`${node} ${PRESS} ${TENANT} ${MAPPING}`]);
    expect(r.stdout).toContain(`started one pass on your migration, as Sync now starts it (Trigger.dev run ${RUN_ID})`);
  }, CASE_MS);

  it('an id in capitals is the same migration, pressed as the database keeps it', () => {
    const s = stage(LIVE_ENV.replace(MAPPING, MAPPING.toUpperCase()));
    answer(s, pre(), SUCCEEDED);
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(presses(s)).toEqual([`${IMAGE_NODE} ${PRESS} ${TENANT} ${MAPPING}`]);
  }, CASE_MS);

  it('neither Node answers: could not tell, exit 7, and nothing pressed', () => {
    const s = stage();
    answer(s, pre(), SUCCEEDED);
    const r = run(s, { STUB_NODE: '/bin/sh' });
    expect(r.status, r.out).toBe(7);
    expect(r.verdict).toMatch(/the api container could not be asked \(is it up\?\): nothing was started/);
    expect(presses(s)).toEqual([]);
    expect(apiCalls(s)).toEqual([`${DISTROLESS_NODE} --version`, `${IMAGE_NODE} --version`]);
  }, CASE_MS);

  it.each<[string, number, string, string, RegExp]>([
    ['the hold, started since the first read', 3, 'refused\t409\tplatform_held', '4', /^refused, the hold is on: a hold was started after the first read/],
    ['not found', 2, 'refused\t404\tnot_found', '4', /Sync now found no such migration in its organisation/],
    ['its organisation closed', 2, 'refused\t409\taccount_closed', '4', /its organisation is closed/],
    ['paused', 2, 'refused\t409\tpaused', '4', /the migration is paused/],
    ['the grant withdrawn', 2, 'refused\t409\tgrant_withdrawn', '4', /its person withdrew the grant/],
    ["Free's pace", 2, 'refused\t429\tfree_pace', '4', /Free's pace holds it until its next pass/],
    ['a refusal it has no words for', 2, 'refused\t409\trefused', '4', /Sync now refused it \(refused\)/],
    ['its arguments refused', 2, '', '2', /the press refused its arguments, or the api container has no APP_DATABASE_URL/],
    ['a press that failed', 7, '', '1', /not known whether a pass started/],
    ['a press killed', 7, '', '137', /not known whether a pass started/],
    ['two lines', 7, `started\t${RUN_ID}\nstarted\t${RUN_ID}`, '0', /not known whether a pass started/],
    ['a run id that is not one', 7, 'started\tsomething', '0', /not known whether a pass started/],
    ['a refusal with exit 0', 7, 'refused\t409\tpaused', '0', /not known whether a pass started/],
  ])('%s: exit %i', (_, code, press, rc, says) => {
    const s = stage();
    answer(s, pre(), SUCCEEDED);
    const r = run(s, { STUB_PRESS: press, STUB_PRESS_RC: rc });
    expect(r.status, r.out).toBe(code);
    expect(r.verdict).toMatch(says);
    expect(presses(s)).toHaveLength(1);
    // Nothing is followed after a press that started nothing it can name.
    expect(statements(s)).toHaveLength(1);
  }, CASE_MS);
});

// ===========================================================================
// The follow
// ===========================================================================

describe("the follow: by the run's own id, never a time window, to the pass's end", () => {
  it('queued, then running, then succeeded with every data type finished: exit 0, each state said once', () => {
    const s = stage();
    answer(s, pre(), NO_ROW, NO_ROW, row(), row(), SUCCEEDED);
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    const said = r.stdout.split('\n');
    expect(said.filter((l) => l === '[live-pass-check] queued: no runner has started it yet')).toHaveLength(1);
    expect(said.filter((l) => l === `[live-pass-check] running since ${STARTED}`)).toHaveLength(1);
    expect(r.verdict).toMatch(/^succeeded after \d+ s: every data type it selects finished in this pass \(2 of 2\), 14 item\(s\) handled\./);
    expect(r.verdict).toContain('the box checks delete the copy before the update and mail Update proven');
    expect(r.verdict).toContain('unless COPY_DELETE_WHEN_PROVEN is false');
    // Each follow read is keyed by the run's id, and none by a time window.
    const follows = statements(s).slice(1);
    expect(follows).toHaveLength(5);
    for (const sql of follows) {
      expect(sql).toContain(`orchestrator_ref = '${RUN_ID}'`);
      expect(sql).toContain(`mapping_id = '${MAPPING}'`);
      expect(sql).not.toMatch(/interval/i);
    }
  }, CASE_MS);

  it('succeeded with 1 of 2 data types finished: ended unfinished, exit 6', () => {
    const s = stage();
    answer(s, pre(), row({ state: 'succeeded', sinceFinished: '2', done: 1 }));
    const r = run(s);
    expect(r.status, r.out).toBe(6);
    expect(r.verdict).toMatch(/^ended unfinished: the pass succeeded, and 1 of 2 data types did not finish in it/);
  }, CASE_MS);

  it('a failed attempt, then its retry succeeded under the same run id: exit 0', () => {
    const s = stage();
    answer(s, pre(), row({ state: 'failed', sinceFinished: '5' }), row({ attempts: 2, state: 'succeeded', sinceFinished: '1', done: 2, items: '3' }));
    const r = run(s);
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toContain('attempt 1 failed; waiting up to 180 s for its retry');
  }, CASE_MS);

  it.each<[string, string, RegExp]>([
    ['failed, and no retry for 200 s', row({ state: 'failed', sinceFinished: '200' }), /^failed after 1 attempt\(s\): the migration's page and its run log say why\.$/],
    ['its third attempt failed', row({ attempts: 3, state: 'failed', sinceFinished: '5' }), /^failed after 3 attempt\(s\)/],
    ['cancelled', row({ state: 'cancelled', sinceFinished: '5' }), /^cancelled: the pass was stopped before it ended/],
  ])('%s: exit 1', (_, last, says) => {
    const s = stage();
    answer(s, pre(), last);
    const r = run(s);
    expect(r.status, r.out).toBe(1);
    expect(r.verdict).toMatch(says);
  }, CASE_MS);

  it.each<[string, number, string, RegExp]>([
    ['no row in 3 reads', 5, NO_ROW, /^timed out after \d+ s: the pass is queued; nothing was cancelled, and the box checks count it when it succeeds\.$/],
    ['running for 3 reads', 5, row(), /^timed out after \d+ s: the pass is running; nothing was cancelled/],
    ['a failed attempt for 3 reads, within its 180 s', 1, row({ state: 'failed', sinceFinished: '20' }), /^failed after 1 attempt\(s\): .*; a retry may still come\.$/],
  ])('%s: exit %i, and the pass goes on', (_, code, every, says) => {
    const s = stage();
    answer(s, pre(), every);
    const r = run(s, { LIVE_PASS_CHECK_POLLS: '3' });
    expect(r.status, r.out).toBe(code);
    expect(r.verdict).toMatch(says);
    expect(statements(s)).toHaveLength(4);
  }, CASE_MS);

  it.each<[string, NodeJS.ProcessEnv, string]>([
    ['a follow read that fails', { STUB_PSQL_FAIL: '3' }, row()],
    ['a follow read it cannot parse', {}, 'running'],
  ])("%s: could not tell, exit 7, naming the run that was started", (_, extra, second) => {
    const s = stage();
    answer(s, pre(), row(), second);
    const r = run(s, extra);
    expect(r.status, r.out).toBe(7);
    expect(r.verdict).toBe(`could not tell: could not read the pass's row; it was started (run ${RUN_ID}): the migration's page says how it ends.`);
  }, CASE_MS);
});

// ===========================================================================
// The first read and the follow against the real schema
// ===========================================================================

describe('against a database with both migration chains applied (PGlite behind the psql stub)', () => {
  let dataDir = '';
  const OWNER = 'owner-subject-1';
  const OTHER = 'e0000000-0000-4000-8000-000000000002';
  const CONNECTION = 'e0000000-0000-4000-8000-000000000011';
  const MAILBOX = 'e0000000-0000-4000-8000-000000000021';
  const withDb = async (fn: (db: PgliteLike) => Promise<void>) => {
    const db = new PGlite(dataDir, { extensions: { pgcrypto } });
    try {
      await fn(db);
    } finally {
      await db.close();
    }
  };
  /** The run the press started, two minutes ago, and another of the same migration since. */
  const passRun = (status = 'succeeded') =>
    `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, orchestrator_ref, stats, started_at, finished_at)
       VALUES ('${TENANT}', '${MAPPING}', 'incremental', 'manual', '${status}', '${RUN_ID}', '{"itemsProcessed": 7}'::jsonb,
               now() - interval '2 minutes', ${status === 'running' ? 'NULL' : "now() - interval '1 minute'"}),
              ('${TENANT}', '${MAPPING}', 'incremental', 'schedule', 'failed', 'run_cm9someoneelse01', '{}'::jsonb,
               now() - interval '30 seconds', now() - interval '20 seconds');`;
  /** A data type of the migration, completed `ago`. */
  const completed = (domain: string, ago: string) =>
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, started_at, completed_at)
       VALUES ('${TENANT}', '${MAPPING}', '${domain}', 'completed', now() - interval '${ago}', now() - interval '${ago}');`;
  const OPERATOR = `INSERT INTO platform_operator (user_id, email) VALUES ('${OWNER}', 'owner@example.test');`;
  // The pass the press started succeeded, and both data types it selects
  // completed after it began.
  const PROVEN = `${OPERATOR}${passRun()}${completed('email', '90 seconds')}${completed('calendar', '80 seconds')}`;
  const setState = (sql: string) =>
    withDb(async (db) => {
      await db.exec(`DELETE FROM run; DELETE FROM platform_pause; DELETE FROM migration_status;
                     DELETE FROM platform_operator; UPDATE mailbox_mapping SET status = 'active'; ${sql}`);
    });

  beforeAll(async () => {
    dataDir = join(tempDir('live-pass-check-db-'), 'pg');
    const driver = pgliteDriver({ dataDir });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await driver.end();
    await withDb(async (db) => {
      await db.exec(`
        INSERT INTO tenant (id, name) VALUES ('${TENANT}', 'The owner'), ('${OTHER}', 'A tester');
        INSERT INTO tenant_member (tenant_id, user_id, email, role, status)
          VALUES ('${TENANT}', '${OWNER}', 'owner@example.test', 'owner', 'active');
        INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
          VALUES ('${CONNECTION}', '${TENANT}', 'source', 'imap', 'a source', '{}'::jsonb, 'connected', 'v1:a-credential');
        INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
          VALUES ('${MAILBOX}', '${TENANT}', '${CONNECTION}', 'user', 'someone@example.org');
        INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, source_secret_ref)
          VALUES ('${MAPPING}', '${TENANT}', '${MAILBOX}', 'active', NULL);
        INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES
          ('${TENANT}', '${MAPPING}', 'email', true),
          ('${TENANT}', '${MAPPING}', 'calendar', true),
          ('${TENANT}', '${MAPPING}', 'contact', false);`);
    });
  }, PGLITE_CASE_MS);

  const attempt = async (state: string, extra: NodeJS.ProcessEnv = {}) => {
    await setState(state);
    const s = stage();
    return { s, r: run(s, { STUB_PGLITE: dataDir, ...extra }) };
  };

  it(
    'the pass it started succeeded and every data type it selects completed in it: exit 0, followed by its own id',
    async () => {
      const { s, r } = await attempt(PROVEN);
      expect(r.status, r.out).toBe(0);
      expect(r.stdout).toContain('no hold is on, 0 of 3 pass(es) in flight, 0 of 2 of this organisation\'s');
      expect(r.verdict).toMatch(/^succeeded after \d+ s: every data type it selects finished in this pass \(2 of 2\), 7 item\(s\) handled\./);
      expect(presses(s)).toEqual([`${IMAGE_NODE} ${PRESS} ${TENANT} ${MAPPING}`]);
    },
    PGLITE_CASE_MS,
  );

  it(
    'a hold on: exit 3, nothing pressed',
    async () => {
      const { s, r } = await attempt(
        `${PROVEN}INSERT INTO platform_pause (started_at, message, started_by)
           VALUES (now() - interval '5 minutes', 'We werken het platform bij.', '${OWNER}');`,
      );
      expect(r.status, r.out).toBe(3);
      expect(presses(s)).toEqual([]);
    },
    PGLITE_CASE_MS,
  );

  it(
    "the passes in flight at the tick's cap, a stale one not counted: exit 4, nothing pressed",
    async () => {
      const running = (ago: string) =>
        `INSERT INTO run (tenant_id, kind, status, started_at) VALUES ('${OTHER}', 'incremental', 'running', now() - interval '${ago}');`;
      const { s, r } = await attempt(`${PROVEN}${running('5 minutes')}${running('10 minutes')}${running('3 hours')}`, {});
      expect(r.status, r.out).toBe(0);
      expect(r.stdout).toContain('2 of 3 pass(es) in flight');
      const full = await attempt(`${PROVEN}${running('5 minutes')}${running('10 minutes')}${running('15 minutes')}`);
      expect(full.r.status, full.r.out).toBe(4);
      expect(full.r.verdict).toMatch(/3 pass\(es\) in flight on live, and MAX_PASSES_IN_FLIGHT allows 3/);
      expect(presses(full.s)).toEqual([]);
      expect(presses(s)).toHaveLength(1);
    },
    PGLITE_CASE_MS,
  );

  it(
    'a pass of this migration running already: exit 4',
    async () => {
      const { r } = await attempt(`${OPERATOR}${passRun('running')}`);
      expect(r.status, r.out).toBe(4);
      expect(r.verdict).toMatch(/a pass of this migration is running already/);
    },
    PGLITE_CASE_MS,
  );

  it(
    'no platform operator owns its organisation, or it is paused: exit 2',
    async () => {
      const notOwn = await attempt(`${passRun()}${completed('email', '90 seconds')}`);
      expect(notOwn.r.status, notOwn.r.out).toBe(2);
      expect(notOwn.r.verdict).toMatch(/not in an organisation where a platform operator is an active owner/);
      const paused = await attempt(`${PROVEN}UPDATE mailbox_mapping SET status = 'paused';`);
      expect(paused.r.status, paused.r.out).toBe(2);
      expect(paused.r.verdict).toMatch(/the migration is paused, not running/);
    },
    PGLITE_CASE_MS,
  );

  it(
    'one data type completed before the pass began: ended unfinished, exit 6',
    async () => {
      const { r } = await attempt(`${OPERATOR}${passRun()}${completed('email', '90 seconds')}${completed('calendar', '3 hours')}`);
      expect(r.status, r.out).toBe(6);
      expect(r.verdict).toMatch(/1 of 2 data types did not finish in it/);
    },
    PGLITE_CASE_MS,
  );
});

// ===========================================================================
// The script's source, and the records
// ===========================================================================

describe('what the script never does, read from its source', () => {
  const source = () => readFileSync(join(REPO_ROOT, SCRIPT_PATH), 'utf8');
  /** The script without its comments: what runs. */
  const codeOf = () =>
    source()
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('holds no task key, no curl, no call to the API over HTTP, no traced shell and no pipe its consumer can kill', () => {
    const code = codeOf();
    expect(source()).not.toContain('TRIGGER_SECRET_KEY');
    expect(code).not.toMatch(/\bcurl\b/);
    expect(code, 'the API is pressed inside its container, never over HTTP').not.toMatch(/(?<!apps)\/api\//);
    expect(code).not.toMatch(/\|\s*grep -q/);
    expect(code).not.toMatch(/\|\s*head\b/);
    expect(code).not.toMatch(/set -x|set -o xtrace/);
    expect(code).not.toMatch(/\bruns\.cancel\b|docker stop|UPDATE platform_pause/i);
  });

  it("asks whether the .env is live's, and which project it drives, before its first Compose command", () => {
    const code = codeOf();
    const firstDocker = code.indexOf('docker compose');
    expect(firstDocker).toBeGreaterThan(-1);
    expect(code.indexOf('stack_is_live "$ENV_FILE"')).toBeGreaterThan(-1);
    expect(code.indexOf('stack_is_live "$ENV_FILE"')).toBeLessThan(firstDocker);
    expect(code.indexOf('compose_project "')).toBeGreaterThan(-1);
    expect(code.indexOf('compose_project "')).toBeLessThan(firstDocker);
  });

  it('asks the api container only through Node held in a variable, never a shell, printenv or a bare node', () => {
    const asks = codeOf().split('\n').filter((line) => line.includes('exec -T api'));
    expect(asks.length).toBeGreaterThan(0);
    for (const line of asks) {
      expect(line).toMatch(/exec -T api "\$[a-z_]+"/);
      expect(line).not.toMatch(/exec -T api (sh|bash|printenv|node)\b/);
    }
  });
});

describe('the records: the key, the step and the checkbox, where the owner reads them', () => {
  /** The comment lines right above `key=`, as one text. */
  const commentAbove = (text: string, key: string): string => {
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.startsWith(`${key}=`));
    expect(at, `${key} is not in ${ENV_EXAMPLE}`).toBeGreaterThan(-1);
    const above: string[] = [];
    for (let i = at - 1; i >= 0 && lines[i]!.startsWith('#'); i--) above.unshift(lines[i]!);
    return above.join(' ');
  };

  it(`${ENV_EXAMPLE} has both keys, each under a comment naming its script`, () => {
    const example = readFileSync(join(REPO_ROOT, ENV_EXAMPLE), 'utf8');
    expect(example).toMatch(/^LIVE_PASS_CHECK_MIGRATION=$/m);
    expect(example).toMatch(/^COPY_DELETE_WHEN_PROVEN=true$/m);
    expect(commentAbove(example, 'LIVE_PASS_CHECK_MIGRATION')).toContain('live-pass-check.sh');
    expect(commentAbove(example, 'COPY_DELETE_WHEN_PROVEN')).toContain('copy-before-update.sh delete-if-proven');
  });

  it(`${BRING_UP} names the script, its key and the box checks' delete`, () => {
    const doc = readFileSync(join(REPO_ROOT, BRING_UP), 'utf8');
    for (const words of ['./deploy/compose/live-pass-check.sh', 'LIVE_PASS_CHECK_MIGRATION', 'delete-if-proven', 'Update proven']) {
      expect(doc, `${BRING_UP} does not say ${words}`).toContain(words);
    }
  });

  it(`${RELEASE} §5 names the script among the steps of a deploy to live`, () => {
    const doc = readFileSync(join(REPO_ROOT, RELEASE), 'utf8');
    const start = doc.indexOf('## 5. Deploying a release to ownpace-live');
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
    expect(section).toContain('./deploy/compose/live-pass-check.sh');
    expect(section).toContain('Update proven');
  });
});
