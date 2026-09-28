// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REHEARSAL THAT CLEANS UP, AND NEVER REACHES THE STACK TESTERS USE
 * (workplan 0143 T9, the script half).
 *
 * Nobody knows how much the reference machine carries: twenty organisations
 * making their first copies on the OTA stack, with `ownpace-live` standing
 * beside it and CI on the same box. `deploy/compose/rehearse-capacity.sh` is
 * how the owner finds out, in one sitting. It seeds organisations that look
 * like testers, samples the machine every ten seconds while their passes run,
 * and takes the organisations back afterwards. Three things can go wrong with
 * a script like that, and each is a case here.
 *
 *   It leaves rows behind. The seed writes a handful of rows per organisation,
 *   and every pass then writes more under the same organisation: runs, events,
 *   items, a rate budget. A removal that knew only the seed's tables would
 *   leave the passes' rows on a stack that keeps running for months. So the
 *   seed and the removal both run against a real database: PGlite, with both
 *   migration chains applied. The rows a pass would write are added by hand
 *   between them, with a row in a table that has no foreign key to `tenant`
 *   and one in a table whose key refuses the delete. Afterwards no table with
 *   a `tenant_id` holds a single row of the rehearsal. The demo organisations
 *   it copied from are untouched.
 *
 *   It removes too early. The tick enqueues a pass without writing a row; the
 *   pass opens its run row only when it starts. So "no run is running" does
 *   not mean "nothing is coming". The first removal pauses the rehearsal's
 *   migrations and removes nothing. A later one removes only once nothing is
 *   running and nothing has started, or been paused, for a few minutes.
 *
 *   It reaches live. Live's `.env` carries a marker saying that the stack
 *   holds people's data (0132 T1g, `deploy/compose/stack-kind.sh`). The script
 *   refuses that `.env` in every mode, and any value of the marker it does not
 *   know, before anything is asked of Docker, so the stubbed `docker` must
 *   never have been called. It refuses the marker exported into the shell, and
 *   a `COMPOSE_PROJECT_NAME` in the shell that points Compose at another stack
 *   than the checkout's `.env` chooses. It names the `.env` to Compose itself,
 *   so `COMPOSE_ENV_FILES` cannot swap in another, and it refuses a project
 *   Compose reports that the checkout does not choose.
 *
 *   Its numbers lie. A sample that cannot read the pooler must say `?`, never
 *   `0`: a zero is the answer the rehearsal's pass line looks for (hard
 *   rule 9). One runner that `docker stats` cannot read says `?` for itself
 *   and costs no other number. And the line must carry every field T9 records.
 *
 * `docker` and `psql` are stubs on the PATH. The `docker` stub runs `compose
 * exec … sh -c` locally, so the script's own psql command line is what runs,
 * against the `psql` stub. It picks the project the way Compose does, and logs
 * it with every call. The `psql` stub hands SQL to PGlite when a database is
 * named, and prints a fixture otherwise.
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
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const SCRIPT = 'rehearse-capacity.sh';

/** The id prefix every rehearsal row carries. Unused elsewhere in the repository. */
const PREFIX = 'ca9a0000-0000-4000-8000-';

// The two demo organisations `seed-managed.ts` creates, which the rehearsal copies.
const DEMO_A = 'a0000000-0000-4000-8000-000000000001';
const DEMO_B = 'b0000000-0000-4000-8000-000000000002';

/** Each case that boots PGlite in a child process, and again here, gets this long. */
const PGLITE_CASE_MS = 120_000;

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// PGlite for the `psql` stub, which is a separate node process. Resolved from
// the ledger package, which is where the dependency is declared.
const requireFromLedger = createRequire(join(REPO_ROOT, 'packages', 'ledger', 'package.json'));
const PGLITE_CJS = requireFromLedger.resolve('@electric-sql/pglite');
const PGCRYPTO_CJS = requireFromLedger.resolve('@electric-sql/pglite/contrib/pgcrypto');

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}
type PgliteCtor = new (dir: string, opts: unknown) => PgliteLike;
const { PGlite } = requireFromLedger('@electric-sql/pglite') as { PGlite: PgliteCtor };
const { pgcrypto } = requireFromLedger('@electric-sql/pglite/contrib/pgcrypto') as { pgcrypto: unknown };

async function withDb<T>(dataDir: string, fn: (db: PgliteLike) => Promise<T>): Promise<T> {
  const db = new PGlite(dataDir, { extensions: { pgcrypto } });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

const DOCKER_STUB = `#!/usr/bin/env bash
# The docker stub. Every call is logged; nothing reaches a daemon.
printf '%s\\n' "$*" >>"$STUB_LOG"
if [ "$1" = compose ]; then
  shift
  file='' env_file=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -f) file="$2"; shift 2 ;;
      --env-file) env_file="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  # The project, picked the way Compose picks it: the shell's
  # COMPOSE_PROJECT_NAME, else the one in the env file Compose reads
  # (--env-file, else COMPOSE_ENV_FILES, else the .env beside the file), else
  # the file's own name:. STUB_PROJECT stands for a Compose that answers
  # something else again.
  [ -n "$env_file" ] || env_file="\${COMPOSE_ENV_FILES:-$(dirname "$file")/.env}"
  project="\${COMPOSE_PROJECT_NAME:-}"
  [ -n "$project" ] || project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file" 2>/dev/null | tail -n 1)"
  [ -n "$project" ] || project="$(sed -n 's/^name: *//p' "$file")"
  project="\${STUB_PROJECT:-$project}"
  printf 'compose[%s] %s\\n' "$project" "$1" >>"$STUB_LOG"
  case "$1" in
    config) printf 'name: %s\\nservices: {}\\n' "$project"; exit 0 ;;
    exec)
      shift
      [ "$1" = -T ] && shift
      svc="$1"; shift
      if [ "$1" != sh ] || [ "$2" != -c ]; then echo "docker stub: unexpected exec: $*" >&2; exit 97; fi
      case "$svc" in
        postgres) export POSTGRES_USER=openmigrate POSTGRES_DB=openmigrate ;;
        pgbouncer) export PGBOUNCER_AUTH_PASSWORD=stub-password ;;
      esac
      export STUB_SERVICE="$svc"
      exec sh -c "$3"
      ;;
  esac
fi
if [ "$1" = stats ]; then
  [ -n "\${STUB_STATS_FAIL:-}" ] && { echo 'Cannot connect to the Docker daemon' >&2; exit 1; }
  cat "$STUB_STATS"
  exit 0
fi
echo "docker stub: unexpected call: $*" >&2
exit 98
`;

const PSQL_STUB = (node: string) => `#!${node}
// The psql stub. SQL goes to PGlite when STUB_PGLITE names a data directory;
// the pooler's console answers from a fixture.
const fs = require('fs');
const svc = process.env.STUB_SERVICE || '?';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, 'psql[' + svc + '] ' + args.join(' ') + '\\n');
if (svc === 'pgbouncer') {
  if (process.env.STUB_POOLS_FAIL) {
    process.stderr.write('psql: error: connection to server failed\\n');
    process.exit(2);
  }
  process.stdout.write(fs.readFileSync(process.env.STUB_POOLS, 'utf8'));
  process.exit(0);
}
const ci = args.indexOf('-c');
const sql = ci >= 0 ? args[ci + 1] : fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.STUB_SQL_LOG, sql + '\\n-- (end of one psql call)\\n');
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
    const results = await db.exec(sql);
    for (const r of results) {
      for (const row of r.rows) {
        process.stdout.write(r.fields.map((f) => (row[f.name] == null ? '' : String(row[f.name]))).join('|') + '\\n');
      }
    }
  } catch (e) {
    process.stderr.write('ERROR:  ' + (e && e.message ? e.message : String(e)) + '\\n');
    try { await db.exec('ROLLBACK'); } catch {}
    code = 3;
  } finally {
    await db.close();
  }
  process.exit(code);
})();
`;

interface Stage {
  root: string;
  compose: string;
  log: string;
  sqlLog: string;
  env: NodeJS.ProcessEnv;
}

/** A checkout of its own: the script, what it sources, a `.env`, and the stubs. */
function stage(dotEnv: string): Stage {
  const root = tempDir('rehearsal-');
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  for (const f of [SCRIPT, 'env-read.sh', 'stack-kind.sh']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  writeFileSync(join(compose, 'managed.yml'), 'name: rehearsal-stub\nservices: {}\n');
  writeFileSync(join(compose, '.env'), dotEnv);

  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  writeFileSync(join(bin, 'psql'), PSQL_STUB(process.execPath));
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'psql'), 0o755);

  const proc = join(root, 'proc');
  mkdirSync(proc);
  writeFileSync(
    join(proc, 'meminfo'),
    [
      'MemTotal:       131072000 kB',
      'MemFree:         2048000 kB',
      'MemAvailable:   98304000 kB',
      'SwapTotal:       8388608 kB',
      'SwapFree:        7340032 kB',
      '',
    ].join('\n'),
  );
  writeFileSync(join(proc, 'loadavg'), '3.25 2.50 1.75 4/1234 5678\n');

  const log = join(root, 'docker.log');
  const sqlLog = join(root, 'sql.log');
  writeFileSync(log, '');
  writeFileSync(sqlLog, '');
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: root,
    STUB_LOG: log,
    STUB_SQL_LOG: sqlLog,
    REHEARSAL_PROC: proc,
    REHEARSAL_TAG: '20260927T1200',
  };
  return { root, compose, log, sqlLog, env };
}

function run(s: Stage, args: string[], extra: NodeJS.ProcessEnv = {}) {
  // A clean environment, so the shell this test runs in cannot choose a stack.
  const r = spawnSync(join(s.compose, SCRIPT), args, {
    encoding: 'utf8',
    env: { ...s.env, ...extra },
    cwd: s.root,
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** The projects the stubbed Compose was driven against, one per call. */
const composeProjects = (s: Stage): string[] =>
  readFileSync(s.log, 'utf8')
    .split('\n')
    .flatMap((l) => {
      const m = /^compose\[([^\]]*)\] (\S+)$/.exec(l);
      return m ? [`${m[1]} ${m[2]}`] : [];
    });

// ---------------------------------------------------------------------------
// The live marker
// ---------------------------------------------------------------------------

describe("live's marker is refused before anything reaches a stack", () => {
  const LIVE_FORMS = [
    'STACK_KIND=production\n',
    "STACK_KIND='production'\n",
    'STACK_KIND="production"\n',
    'export STACK_KIND=production\n',
    'STACK_KIND=production   # set by the owner at bring-up\n',
    'STACK_KIND=Production\n',
    // Slips of it. A refusal errs towards live: a value nobody listed as
    // "not live" is taken for live's, and so is a line the reader cannot read.
    'STACK_KIND=prod\n',
    'STACK_KIND=live\n',
    "STACK_KIND='production '\n",
    '  STACK_KIND=production\n',
    'STACK_KIND = production\n',
  ];

  it.each(LIVE_FORMS.map((f) => [f.trimEnd()]))('refuses a .env carrying `%s`, in every mode', (line) => {
    for (const args of [['--seed', '2', '2'], ['--remove'], ['--sample', '--count', '1']]) {
      const s = stage(`POSTGRES_USER=openmigrate\n${line}\n`);
      const r = run(s, args);
      expect(r.status, `${args.join(' ')} ran on live's .env:\n${r.out}`).not.toBe(0);
      expect(r.out).toMatch(/live/i);
      expect(r.out).toContain('STACK_KIND');
      expect(
        readFileSync(s.log, 'utf8'),
        'docker was called before the refusal: something may have reached the stack',
      ).toBe('');
    }
  });

  it('refuses the marker exported into the shell, as a sourced live .env leaves it, and its slips', () => {
    for (const value of ['production', 'Production', '"production"', ' production', 'prod']) {
      const s = stage('POSTGRES_USER=openmigrate\n');
      const r = run(s, ['--seed', '1', '1'], { STACK_KIND: value });
      expect(r.status, `STACK_KIND='${value}' in the shell was not refused:\n${r.out}`).not.toBe(0);
      expect(r.out).toContain('STACK_KIND');
      expect(readFileSync(s.log, 'utf8')).toBe('');
    }
  });

  it("keeps stack_is_live exact for 0132 T6's positive check, and refuses on stack_may_be_live", () => {
    // deploy-live.sh (0132 T6) will refuse a .env WITHOUT the marker, so it
    // needs the exact answer. The refusals need the cautious one.
    const dir = tempDir('stack-kind-');
    const probe = (text: string) => {
      const file = join(dir, 'env');
      writeFileSync(file, text);
      const r = spawnSync(
        'bash',
        ['-c', '. "$1"; stack_is_live "$2" && echo live; stack_may_be_live "$2" && echo may; true', '_', join(COMPOSE_DIR, 'stack-kind.sh'), file],
        { encoding: 'utf8' },
      );
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim().split('\n').filter(Boolean).join(' ');
    };
    expect(probe('STACK_KIND=production\n')).toBe('live may');
    expect(probe('STACK_KIND=" Production "\n')).toBe('live may');
    expect(probe("STACK_KIND='production '\n")).toBe('live may');
    expect(probe('STACK_KIND= "production"\n')).toBe('live may');
    expect(probe('STACK_KIND=prod\n')).toBe('may');
    expect(probe('  STACK_KIND=production\n')).toBe('may');
    expect(probe('STACK_KIND = production\n')).toBe('may');
    // The OTA stack's .env does not carry the key; an empty value names no kind.
    expect(probe('POSTGRES_USER=openmigrate\n')).toBe('');
    expect(probe('STACK_KIND=\n')).toBe('');
  });

  it('refuses a COMPOSE_PROJECT_NAME in the shell that the checkout does not choose', () => {
    // Compose follows the shell over the .env beside managed.yml, so a checkout
    // without the marker could still drive live's containers.
    const s = stage('POSTGRES_USER=openmigrate\n');
    const r = run(s, ['--remove'], { COMPOSE_PROJECT_NAME: 'ownpace-live' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('COMPOSE_PROJECT_NAME');
    expect(readFileSync(s.log, 'utf8')).toBe('');
  });

  it('lets a COMPOSE_PROJECT_NAME in the shell through when the checkout chooses the same', () => {
    const s = stage('POSTGRES_USER=openmigrate\nCOMPOSE_PROJECT_NAME=rehearsal-own\n');
    const r = run(s, ['--remove'], { COMPOSE_PROJECT_NAME: 'rehearsal-own', STUB_PSQL_ANSWER: 'nothing\n' });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/nothing to remove/);
    expect(composeProjects(s)).toEqual(['rehearsal-own config', 'rehearsal-own exec']);
  });

  it('names its .env to Compose, so COMPOSE_ENV_FILES cannot point Compose at live', () => {
    // Compose reads the files COMPOSE_ENV_FILES names INSTEAD of the .env
    // beside managed.yml, and takes their COMPOSE_PROJECT_NAME. Every check
    // above reads the checkout's .env; Compose has to read the same one.
    const s = stage('POSTGRES_USER=openmigrate\n');
    const live = join(tempDir('live-'), '.env');
    writeFileSync(live, 'COMPOSE_PROJECT_NAME=ownpace-live\nSTACK_KIND=production\n');
    run(s, ['--remove'], { COMPOSE_ENV_FILES: live });
    const projects = composeProjects(s);
    expect(projects.length, readFileSync(s.log, 'utf8')).toBeGreaterThan(0);
    expect(projects.filter((p) => p.startsWith('ownpace-live ')), 'Compose was driven against live').toEqual([]);
    const composeCalls = readFileSync(s.log, 'utf8').split('\n').filter((l) => l.startsWith('compose '));
    for (const call of composeCalls) expect(call).toContain(`--env-file ${join(s.compose, '.env')}`);
  });

  it('refuses a project Compose reports that the checkout does not choose, before any exec', () => {
    const s = stage('POSTGRES_USER=openmigrate\n');
    const r = run(s, ['--remove'], { STUB_PROJECT: 'ownpace-live' });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain("'ownpace-live'");
    expect(r.out).toContain("'rehearsal-stub'");
    expect(composeProjects(s)).toEqual(['ownpace-live config']);
  });

  it('the marker is named in one place, and the script reads it from there', () => {
    // 0132 T1g's refusals (the gate, --with-demo, deploy-live.sh) are to take
    // the name from the same file, so it cannot be spelled two ways.
    const kind = readFileSync(join(COMPOSE_DIR, 'stack-kind.sh'), 'utf8');
    expect(kind).toMatch(/^STACK_KIND_KEY=STACK_KIND$/m);
    expect(kind).toMatch(/^STACK_KIND_LIVE=production$/m);
    const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
    expect(script).toContain('stack-kind.sh');
    const code = script.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(
      code.filter((l) => /\bproduction\b/i.test(l) || /\bSTACK_KIND\b/.test(l)),
      'the script spells the marker out instead of reading it from stack-kind.sh',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seed, then remove, against a real schema
// ---------------------------------------------------------------------------

describe('seed, then remove, leaves nothing of the rehearsal', () => {
  let dataDir: string;
  let s: Stage;
  let tenantTables: string[];

  const countPrefixed = async (db: PgliteLike): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const t of tenantTables) {
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.${t} WHERE tenant_id::text LIKE $1`,
        [`${PREFIX}%`],
      );
      if (rows[0]!.n > 0) out[t] = rows[0]!.n;
    }
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM tenant WHERE id::text LIKE $1',
      [`${PREFIX}%`],
    );
    if (rows[0]!.n > 0) out.tenant = rows[0]!.n;
    return out;
  };

  const mappingStatuses = async (db: PgliteLike) =>
    (
      await db.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM mailbox_mapping WHERE tenant_id::text LIKE $1 GROUP BY 1 ORDER BY 1`,
        [`${PREFIX}%`],
      )
    ).rows;

  /** What the tick's last pause and the last pass started look like after `minutes`. */
  const ageEverything = (db: PgliteLike, minutes: number) =>
    db.exec(`
      UPDATE mailbox_mapping SET updated_at = now() - interval '${minutes} minutes'
       WHERE tenant_id::text LIKE '${PREFIX}%';
      UPDATE run SET started_at = now() - interval '${minutes} minutes'
       WHERE tenant_id::text LIKE '${PREFIX}%' AND started_at > now() - interval '${minutes} minutes';
    `);

  beforeAll(async () => {
    dataDir = join(tempDir('rehearsal-db-'), 'pg');
    const driver = pgliteDriver({ dataDir });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await driver.end();

    // The demo, as seed-managed.ts leaves it: two organisations, one mail pair
    // and one Nextcloud pair, their mailboxes and their migrations.
    await withDb(dataDir, async (db) => {
      await db.exec(`
        INSERT INTO tenant (id, name) VALUES
          ('${DEMO_A}', 'Demo Tenant A'), ('${DEMO_B}', 'Demo Tenant B');
        INSERT INTO connection (id, tenant_id, role, kind, display_name, config, secret_ref) VALUES
          ('a0000000-0000-4000-8000-0000000000c1', '${DEMO_A}', 'source', 'imap', 'imap (demo source)',
             '{"type":"imap-oauth2","host":"stalwart","port":993,"user":"source@dev.local","tlsVerify":false}', 'sealed-a-source'),
          ('a0000000-0000-4000-8000-0000000000c2', '${DEMO_A}', 'target', 'jmap', 'jmap (demo target)',
             '{"type":"jmap","baseUrl":"http://stalwart:8080","user":"target@dev.local"}', 'sealed-a-target'),
          ('b0000000-0000-4000-8000-0000000000c1', '${DEMO_B}', 'source', 'nextcloud', 'nextcloud (demo source)',
             '{"baseUrl":"http://nextcloud/remote.php/dav/"}', 'sealed-b-source'),
          ('b0000000-0000-4000-8000-0000000000c2', '${DEMO_B}', 'target', 'nextcloud', 'nextcloud (demo target)',
             '{"baseUrl":"http://nextcloud/remote.php/dav/"}', 'sealed-b-target');
        INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name) VALUES
          ('a0000000-0000-4000-8000-0000000000b1', '${DEMO_A}', 'a0000000-0000-4000-8000-0000000000c1', 'source-primary', 'user', 'owner-a@demo.openmigrate.test', 'Demo source mailbox'),
          ('a0000000-0000-4000-8000-0000000000b2', '${DEMO_A}', 'a0000000-0000-4000-8000-0000000000c2', 'target-primary', 'user', 'owner-a@demo.openmigrate.test', 'Demo target mailbox'),
          ('b0000000-0000-4000-8000-0000000000b1', '${DEMO_B}', 'b0000000-0000-4000-8000-0000000000c1', 'source-primary', 'user', 'owner-b@demo.openmigrate.test', 'Demo source mailbox'),
          ('b0000000-0000-4000-8000-0000000000b2', '${DEMO_B}', 'b0000000-0000-4000-8000-0000000000c2', 'target-primary', 'user', 'owner-b@demo.openmigrate.test', 'Demo target mailbox');
        INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status) VALUES
          ('a0000000-0000-4000-8000-0000000000d1', '${DEMO_A}', 'a0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b2', 'mirror', 'active'),
          ('b0000000-0000-4000-8000-0000000000d1', '${DEMO_B}', 'b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000b2', 'mirror', 'active');
        INSERT INTO run (tenant_id, mapping_id, kind, status, started_at, finished_at)
          VALUES ('${DEMO_A}', 'a0000000-0000-4000-8000-0000000000d1', 'incremental', 'succeeded', now() - interval '1 hour', now());
      `);
      const { rows } = await db.query<{ table_name: string }>(
        `SELECT c.table_name::text AS table_name
           FROM information_schema.columns c
           JOIN information_schema.tables tb
             ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
          WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
          ORDER BY 1`,
      );
      tenantTables = rows.map((r) => r.table_name);
    });
    s = stage('POSTGRES_USER=openmigrate\nPOSTGRES_DB=openmigrate\n');
    s.env.STUB_PGLITE = dataDir;
  }, 180_000);

  it('found the tables it checks', () => {
    // Vacuity: a check over no tables passes on everything.
    expect(tenantTables.length).toBeGreaterThan(20);
    for (const t of [
      'connection',
      'mailbox',
      'mailbox_mapping',
      'scope_selection',
      'run',
      'item',
      'run_event',
      'tenant_member',
      'support_read',
      'access_request',
    ]) {
      expect(tenantTables).toContain(t);
    }
  });

  it(
    'seeds N organisations with M migrations each, on */15, every id under the prefix',
    async () => {
      const r = run(s, ['--seed', '3', '4']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/3 organisations/);
      expect(r.out).toMatch(/12 migrations/);

      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual({
          tenant: 3,
          // A mail pair and a Nextcloud pair per organisation, since M >= 2.
          connection: 12,
          mailbox: 12,
          mailbox_mapping: 12,
          scope_selection: 12,
        });
        const maps = await db.query<{ id: string; schedule: string; target_folder_prefix: string; status: string }>(
          `SELECT id::text, schedule, target_folder_prefix, status FROM mailbox_mapping WHERE tenant_id::text LIKE $1`,
          [`${PREFIX}%`],
        );
        for (const m of maps.rows) {
          expect(m.id.startsWith(PREFIX)).toBe(true);
          expect(m.schedule).toBe('*/15 * * * *');
          expect(m.status).toBe('active');
          expect(m.target_folder_prefix).toMatch(/^capacity-rehearsal-20260927T1200-o\d\d-m\d\d$/);
        }
        // Its own folder each, so none adopts another's copies.
        expect(new Set(maps.rows.map((m) => m.target_folder_prefix)).size).toBe(12);

        const domains = await db.query<{ domain: string; n: number }>(
          `SELECT domain, count(*)::int AS n FROM scope_selection WHERE tenant_id::text LIKE $1 GROUP BY 1 ORDER BY 1`,
          [`${PREFIX}%`],
        );
        expect(domains.rows).toEqual([
          { domain: 'email', n: 6 },
          { domain: 'file', n: 6 },
        ]);

        // Every row with an id of its own carries the prefix.
        for (const t of ['connection', 'mailbox', 'mailbox_mapping', 'scope_selection']) {
          const { rows } = await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.${t} WHERE tenant_id::text LIKE $1 AND id::text NOT LIKE $1`,
            [`${PREFIX}%`],
          );
          expect(rows[0]!.n, `${t} has a rehearsal row whose own id is not under the prefix`).toBe(0);
        }

        // The demo's credentials, copied as they are sealed: nothing re-encrypted.
        const creds = await db.query<{ kind: string; role: string; secret_ref: string }>(
          `SELECT kind, role, secret_ref FROM connection WHERE tenant_id::text LIKE $1 ORDER BY kind, role`,
          [`${PREFIX}%`],
        );
        expect(new Set(creds.rows.map((c) => `${c.kind}/${c.role}/${c.secret_ref}`))).toEqual(
          new Set(['imap/source/sealed-a-source', 'jmap/target/sealed-a-target', 'nextcloud/source/sealed-b-source', 'nextcloud/target/sealed-b-target']),
        );
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'refuses a second seed while the first is still there, and writes nothing',
    async () => {
      const r = run(s, ['--seed', '1', '1']);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('--remove');
      await withDb(dataDir, async (db) => {
        expect((await countPrefixed(db)).tenant).toBe(3);
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'with its migrations still active, pauses them first and removes nothing, though no pass is running',
    async () => {
      // The tick enqueues a pass without a row; the pass opens its run row
      // when it starts. So passes can be queued while no row says `running`,
      // and a removal now would pull their organisations from under them.
      await withDb(dataDir, async (db) => {
        // What the rehearsal's passes write while it runs: runs, their events,
        // items. None of these tables is one the seed writes.
        await db.exec(`
          INSERT INTO run (id, tenant_id, mapping_id, kind, status, started_at, finished_at)
            SELECT gen_random_uuid(), tenant_id, id, 'incremental', 'succeeded', now() - interval '20 minutes', now() - interval '10 minutes'
              FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%';
          INSERT INTO run_event (tenant_id, run_id, message)
            SELECT tenant_id, id, 'a pass finished' FROM run WHERE tenant_id::text LIKE '${PREFIX}%';
          INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status)
            SELECT tenant_id, id, 'file', '/', 'openmig-demo-file-1.txt', md5(id::text), 'copied'
              FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%';
          -- A pass that died hours ago: stale, and not in flight.
          INSERT INTO run (tenant_id, mapping_id, kind, status, started_at)
            SELECT tenant_id, id, 'incremental', 'running', now() - interval '5 hours'
              FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%' ORDER BY id DESC LIMIT 1;
        `);
      });
      const before = await withDb(dataDir, countPrefixed);

      const r = run(s, ['--remove']);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/12 migration/);
      expect(r.out).toMatch(/paused/);
      expect(r.out).toMatch(/again in a few minutes/);

      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual(before);
        expect(await mappingStatuses(db)).toEqual([{ status: 'paused', n: 12 }]);
        // And the demo's own migrations were not paused with it.
        const demo = await db.query<{ status: string }>(
          `SELECT DISTINCT status FROM mailbox_mapping WHERE tenant_id IN ('${DEMO_A}', '${DEMO_B}')`,
        );
        expect(demo.rows).toEqual([{ status: 'active' }]);
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'with a pass still running, removes nothing yet',
    async () => {
      await withDb(dataDir, async (db) => {
        await ageEverything(db, 10);
        await db.exec(`
          INSERT INTO run (tenant_id, mapping_id, kind, status, started_at)
            SELECT tenant_id, id, 'incremental', 'running', now() - interval '10 minutes'
              FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%' ORDER BY id LIMIT 1;
        `);
      });
      const before = await withDb(dataDir, countPrefixed);

      const r = run(s, ['--remove']);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/1 pass/);
      expect(r.out).toMatch(/still running/);

      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual(before);
        expect(await mappingStatuses(db)).toEqual([{ status: 'paused', n: 12 }]);
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'with a pass started, or the migrations paused, minutes ago, removes nothing yet',
    async () => {
      // A pass the plane released after the pause opens its row, finds its
      // migration paused and stops at once. While those still arrive, the
      // queue has not drained.
      await withDb(dataDir, async (db) => {
        await db.exec(`
          UPDATE run SET status = 'succeeded', finished_at = now()
           WHERE tenant_id::text LIKE '${PREFIX}%' AND status = 'running'
             AND started_at > now() - interval '1 hour';
          INSERT INTO run (tenant_id, mapping_id, kind, status, started_at, finished_at)
            SELECT tenant_id, id, 'incremental', 'cancelled', now() - interval '1 minute', now()
              FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%' ORDER BY id LIMIT 1;
        `);
      });
      const before = await withDb(dataDir, countPrefixed);

      const started = run(s, ['--remove']);
      expect(started.status, started.out).not.toBe(0);
      expect(started.out).toMatch(/again in a few minutes/);

      // The same with every pass long started, and the pause itself recent.
      await withDb(dataDir, async (db) => {
        await ageEverything(db, 10);
        await db.exec(`UPDATE mailbox_mapping SET updated_at = now() - interval '1 minute' WHERE tenant_id::text LIKE '${PREFIX}%'`);
      });
      const paused = run(s, ['--remove']);
      expect(paused.status, paused.out).not.toBe(0);
      expect(paused.out).toMatch(/again in a few minutes/);

      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual(before);
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'once the passes have finished and the queue is quiet, removes every row of the rehearsal and counts them',
    async () => {
      await withDb(dataDir, async (db) => {
        await ageEverything(db, 10);
        await db.exec(`
          INSERT INTO rate_budget (tenant_id, provider, tokens, refilled_at)
            SELECT id, 'imap:stalwart', 10, now() FROM tenant WHERE id::text LIKE '${PREFIX}%';
          -- A table with a tenant_id and no foreign key to tenant: nothing
          -- cascades into it, so only the schema-driven sweep reaches it.
          INSERT INTO support_read (operator_user_id, tenant_id, view_name)
            SELECT 'operator-subject', id, 'tenant' FROM tenant WHERE id::text LIKE '${PREFIX}%' ORDER BY id LIMIT 1;
          -- A foreign key that refuses the delete (managed migration 0007):
          -- the organisation goes only after the rows pointing at it.
          INSERT INTO access_request (email, state, tenant_id, decided_by, decided_at)
            SELECT 'rehearsal@demo.openmigrate.test', 'granted', id, 'operator-subject', now()
              FROM tenant WHERE id::text LIKE '${PREFIX}%' ORDER BY id LIMIT 1;
        `);
      });
      const before = await withDb(dataDir, countPrefixed);
      // Vacuity: the passes' tables really are in play, beyond what the seed
      // wrote, and so are the two a cascade would not take care of.
      for (const t of ['run', 'run_event', 'item', 'rate_budget', 'support_read', 'access_request']) {
        expect(before[t], t).toBeGreaterThan(0);
      }

      const r = run(s, ['--remove']);
      expect(r.status, r.out).toBe(0);
      for (const [t, n] of Object.entries(before)) {
        expect(r.out, `the removal does not report the ${n} rows of ${t}`).toContain(`${t} ${n}`);
      }
      // What stays is said: the copies in the demo targets, under their folders.
      expect(r.out).toContain('capacity-rehearsal-20260927T1200-o01-m01');

      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db), 'rows of the rehearsal are still there').toEqual({});
        // The demo it copied from is untouched.
        const demo = await db.query<{ t: number; c: number; b: number; m: number; r: number }>(
          `SELECT (SELECT count(*)::int FROM tenant WHERE id IN ('${DEMO_A}', '${DEMO_B}')) AS t,
                  (SELECT count(*)::int FROM connection WHERE tenant_id IN ('${DEMO_A}', '${DEMO_B}')) AS c,
                  (SELECT count(*)::int FROM mailbox WHERE tenant_id IN ('${DEMO_A}', '${DEMO_B}')) AS b,
                  (SELECT count(*)::int FROM mailbox_mapping WHERE tenant_id IN ('${DEMO_A}', '${DEMO_B}')) AS m,
                  (SELECT count(*)::int FROM run WHERE tenant_id = '${DEMO_A}') AS r`,
        );
        expect(demo.rows[0]).toEqual({ t: 2, c: 4, b: 4, m: 2, r: 1 });
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'a second removal finds nothing and says so',
    () => {
      const r = run(s, ['--remove']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/nothing to remove/i);
    },
    PGLITE_CASE_MS,
  );

  it(
    'with an odd M, seeds one more mail migration than file migrations, and takes them back',
    async () => {
      const r = run(s, ['--seed', '2', '3']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/6 migrations \(4 mail, 2 files\)/);
      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual({
          tenant: 2,
          connection: 8,
          mailbox: 8,
          mailbox_mapping: 6,
          scope_selection: 6,
        });
        const perOrg = await db.query<{ tenant_id: string; email: number; file: number }>(
          `SELECT tenant_id::text,
                  count(*) FILTER (WHERE domain = 'email')::int AS email,
                  count(*) FILTER (WHERE domain = 'file')::int AS file
             FROM scope_selection WHERE tenant_id::text LIKE $1 GROUP BY 1 ORDER BY 1`,
          [`${PREFIX}%`],
        );
        expect(perOrg.rows.map((o) => [o.email, o.file])).toEqual([
          [2, 1],
          [2, 1],
        ]);
      });

      const first = run(s, ['--remove']);
      expect(first.status, first.out).not.toBe(0);
      expect(first.out).toMatch(/6 migration/);
      await withDb(dataDir, (db) => ageEverything(db, 10));
      const second = run(s, ['--remove']);
      expect(second.status, second.out).toBe(0);
      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual({});
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'refuses to seed without the demo it copies, and writes nothing',
    async () => {
      await withDb(dataDir, (db) =>
        db.exec(`DELETE FROM connection WHERE id = 'b0000000-0000-4000-8000-0000000000c1'`),
      );
      const r = run(s, ['--seed', '2', '2']);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('--with-demo');
      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual({});
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'with M = 1, needs only the mail pair, and seeds mail alone',
    async () => {
      // Demo B's Nextcloud source is gone (the case above); M = 1 copies none of it.
      const r = run(s, ['--seed', '1', '1']);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(/1 migrations \(1 mail, 0 files\)/);
      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual({
          tenant: 1,
          connection: 2,
          mailbox: 2,
          mailbox_mapping: 1,
          scope_selection: 1,
        });
        const kinds = await db.query<{ kind: string }>(
          `SELECT kind FROM connection WHERE tenant_id::text LIKE $1 ORDER BY kind`,
          [`${PREFIX}%`],
        );
        expect(kinds.rows.map((k) => k.kind)).toEqual(['imap', 'jmap']);
      });
      expect(run(s, ['--remove']).status).not.toBe(0);
      await withDb(dataDir, (db) => ageEverything(db, 10));
      expect(run(s, ['--remove']).status).toBe(0);
      await withDb(dataDir, async (db) => {
        expect(await countPrefixed(db)).toEqual({});
      });
    },
    PGLITE_CASE_MS,
  );

  it(
    'counts a pass in flight with the same window the tick uses',
    async () => {
      // A run row older than STALE_RUN_AFTER_MS is a pass that died, and the
      // tick enqueues its migration again. The removal must not wait on one for
      // ever. Importing the tick opens a Pool; it is never used here.
      process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
      // And the pass it triggers, run-delta-sync, opens its pools at import
      // through openTaskPools, which refuses without APP_DATABASE_URL (0138 T1).
      process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
      // Where the window comes from: PASS_HARD_LIMIT_MS, and the tick's twice
      // that. Named here so that docs/LESSONS.md lists this guard under both.
      for (const source of ['packages/shared/src/pass-deadline.ts', 'apps/worker/src/jobs/managed-sync-tick.ts']) {
        expect(existsSync(join(REPO_ROOT, source)), source).toBe(true);
      }
      const { STALE_RUN_AFTER_MS } = await import('../apps/worker/src/jobs/managed-sync-tick.ts');
      const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
      const seconds = Number(/^STALE_RUN_AFTER_SECONDS=(\d+)$/m.exec(script)?.[1]);
      expect(seconds * 1000).toBe(STALE_RUN_AFTER_MS);
    },
    PGLITE_CASE_MS,
  );
});

// ---------------------------------------------------------------------------
// The sample line
// ---------------------------------------------------------------------------

describe('a sample line carries every field T9 records', () => {
  const STATS = [
    'runner-cm1abc|210.5MiB / 125GiB',
    'runner-cm2def|1.5GiB / 125GiB',
    // A runner that exited while `docker stats` collected: the CLI has no
    // numbers for it, and says so this way.
    'runner-cm3ghi|-- / --',
    'rehearsal-stub-postgres-1|800MiB / 125GiB',
    '',
  ].join('\n');
  const POOLS = [
    'database|user|cl_active|cl_waiting|cl_active_cancel_req|cl_waiting_cancel_req|sv_active|sv_active_cancel|sv_being_canceled|sv_idle|sv_used|sv_tested|sv_login|maxwait|maxwait_us|pool_mode|load_balance_hosts',
    'openmigrate|app_user|4|1|0|0|4|0|0|1|0|0|0|0|250000|transaction|',
    'openmigrate|openmigrate|9|2|0|0|9|0|0|0|0|0|0|3|500000|transaction|',
    'pgbouncer|pgbouncer|1|0|0|0|0|0|0|0|0|0|0|0|0|statement|',
    '',
  ].join('\n');

  function sampleStage(stats = STATS) {
    const s = stage('POSTGRES_USER=openmigrate\n');
    writeFileSync(join(s.root, 'stats'), stats);
    writeFileSync(join(s.root, 'pools'), POOLS);
    s.env.STUB_STATS = join(s.root, 'stats');
    s.env.STUB_POOLS = join(s.root, 'pools');
    s.env.STUB_PSQL_ANSWER = '37\n';
    return s;
  }

  const sampleLines = (out: string) => out.split('\n').filter((l) => /^\d{4}-\d\d-\d\dT/.test(l));

  const fieldsOf = (out: string): Record<string, string> => {
    const line = sampleLines(out)[0];
    expect(line, out).toBeDefined();
    return Object.fromEntries(
      line!.split(' ').slice(1).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
    );
  };

  const sampleFiles = (s: Stage): string[] => {
    const dir = join(s.root, '.persistent', 'rehearsal-stub', 'rehearsal');
    return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
  };

  it('prints the containers, the host, the pooler and the database, and appends it to a file', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1']);
    expect(r.status, r.out).toBe(0);
    expect(fieldsOf(r.out)).toEqual({
      // The runner it could not read is counted, and says `?` for itself alone.
      tasks: '3',
      task_mem_mib: 'runner-cm1abc:211,runner-cm2def:1536,runner-cm3ghi:?',
      task_mem_max_mib: '1536',
      mem_available_mib: '96000',
      mem_total_mib: '128000',
      swap_used_mib: '1024',
      load1: '3.25',
      load5: '2.50',
      load15: '1.75',
      pool_cl_waiting: '3',
      pool_maxwait_s: '3.5',
      numbackends: '37',
    });

    // Appended to a file under the stack's persisted directory, the project
    // taken from Compose, with a header saying what the fields are.
    const files = sampleFiles(s);
    expect(files).toHaveLength(1);
    const text = readFileSync(files[0]!, 'utf8');
    expect(text).toContain(sampleLines(r.out)[0]!);
    expect(text).toMatch(/^# /m);
  });

  it('says `?` for the largest memory when no runner could be read, and still counts them', () => {
    const s = sampleStage(['runner-cm9xyz|-- / --', 'rehearsal-stub-postgres-1|800MiB / 125GiB', ''].join('\n'));
    const r = run(s, ['--sample', '--count', '1']);
    expect(r.status, r.out).toBe(0);
    const f = fieldsOf(r.out);
    expect([f.tasks, f.task_mem_mib, f.task_mem_max_mib]).toEqual(['1', 'runner-cm9xyz:?', '?']);
  });

  it('asks the pooler at the address its own healthcheck proves', () => {
    // managed.yml's healthcheck runs SHOW POOLS every 15 s, so that address
    // is known to work on this image and pgbouncer.ini. A name would depend
    // on resolution inside the container.
    const managed = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
    const hc = /psql -h (\S+) -p 6432 -U pgbouncer_auth -d pgbouncer -c 'SHOW POOLS'/.exec(managed);
    expect(hc, "managed.yml's PgBouncer healthcheck moved").not.toBeNull();
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1']);
    expect(r.status, r.out).toBe(0);
    const calls = readFileSync(s.log, 'utf8').split('\n').filter((l) => l.startsWith('psql[pgbouncer] '));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`-h ${hc![1]} -p 6432 -U pgbouncer_auth -d pgbouncer`);
  });

  it('says `?` for a pooler it could not read, never 0', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1'], { STUB_POOLS_FAIL: '1' });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('pool_cl_waiting=? pool_maxwait_s=?');
    expect(r.out).not.toMatch(/pool_cl_waiting=0/);
  });

  it('says `?` for containers it could not read, never 0', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1'], { STUB_STATS_FAIL: '1' });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('tasks=? task_mem_mib=? task_mem_max_mib=?');
  });

  it('says `?` for the connections it could not count, never 0', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1'], { STUB_PSQL_ANSWER: '' });
    expect(r.status, r.out).toBe(0);
    expect(fieldsOf(r.out).numbackends).toBe('?');
  });

  it('says `?` for a host it could not read, never 0', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1'], { REHEARSAL_PROC: tempDir('no-proc-') });
    expect(r.status, r.out).toBe(0);
    const f = fieldsOf(r.out);
    expect([f.mem_available_mib, f.mem_total_mib, f.swap_used_mib, f.load1, f.load5, f.load15]).toEqual([
      '?',
      '?',
      '?',
      '?',
      '?',
      '?',
    ]);
  });

  it('samples every 10 s unless told otherwise, and says so on screen and in the file', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('a line every 10 s');
    expect(readFileSync(sampleFiles(s)[0]!, 'utf8')).toContain('every 10 s');
  });

  it('writes as many lines as --count asks for', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '2'], { REHEARSAL_SAMPLE_SECONDS: '1' });
    expect(r.status, r.out).toBe(0);
    expect(sampleLines(r.out)).toHaveLength(2);
    expect(r.out).toContain('a line every 1 s');
  });
});
