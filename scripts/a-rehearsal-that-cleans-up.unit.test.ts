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
 *   between them, and afterwards no table with a `tenant_id` holds a single
 *   row of the rehearsal. The demo organisations it copied from are untouched.
 *
 *   It reaches live. Live's `.env` carries a marker saying that the stack
 *   holds people's data (0132 T1g, `deploy/compose/stack-kind.sh`). The script
 *   refuses that `.env` in every mode, before anything is asked of Docker, so
 *   the stubbed `docker` must never have been called. It refuses the same
 *   marker exported into the shell, and a `COMPOSE_PROJECT_NAME` in the shell
 *   that points Compose at another stack than the checkout's `.env` chooses.
 *
 *   Its numbers lie. A sample that cannot read the pooler must say `?`, never
 *   `0`: a zero is the answer the rehearsal's pass line looks for (hard
 *   rule 9). And the line must carry every field T9 records.
 *
 * `docker` and `psql` are stubs on the PATH. The `docker` stub runs `compose
 * exec … sh -c` locally, so the script's own psql command line is what runs,
 * against the `psql` stub. That stub hands SQL to PGlite when a database is
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
  while [ "$#" -gt 0 ]; do
    case "$1" in -f) shift 2 ;; *) break ;; esac
  done
  case "$1" in
    config) printf 'name: %s\\nservices: {}\\n' "\${STUB_PROJECT:-rehearsal-stub}"; exit 0 ;;
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
  ];

  it.each(LIVE_FORMS.map((f) => [f.trim()]))('refuses a .env carrying `%s`, in every mode', (line) => {
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

  it('refuses the marker exported into the shell, as a sourced live .env leaves it', () => {
    const s = stage('POSTGRES_USER=openmigrate\n');
    const r = run(s, ['--seed', '1', '1'], { STACK_KIND: 'production' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('STACK_KIND');
    expect(readFileSync(s.log, 'utf8')).toBe('');
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
      code.filter((l) => /STACK_KIND=|=production\b/.test(l)),
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
    for (const t of ['connection', 'mailbox', 'mailbox_mapping', 'scope_selection', 'run', 'item', 'run_event', 'tenant_member']) {
      expect(tenantTables).toContain(t);
    }
  });

  it('seeds N organisations with M migrations each, on */15, every id under the prefix', async () => {
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
  });

  it('refuses a second seed while the first is still there, and writes nothing', async () => {
    const r = run(s, ['--seed', '1', '1']);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('--remove');
    await withDb(dataDir, async (db) => {
      expect((await countPrefixed(db)).tenant).toBe(3);
    });
  });

  it('with a pass still running, pauses the rehearsal and removes nothing yet', async () => {
    await withDb(dataDir, async (db) => {
      // What the rehearsal's passes write while it runs: runs, their events,
      // items, a rate budget. None of these tables is one the seed writes.
      await db.exec(`
        INSERT INTO run (id, tenant_id, mapping_id, kind, status, started_at, finished_at)
          SELECT gen_random_uuid(), tenant_id, id, 'incremental', 'succeeded', now() - interval '20 minutes', now() - interval '10 minutes'
            FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%';
        INSERT INTO run_event (tenant_id, run_id, message)
          SELECT tenant_id, id, 'a pass finished' FROM run WHERE tenant_id::text LIKE '${PREFIX}%';
        INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status)
          SELECT tenant_id, id, 'file', '/', 'openmig-demo-file-1.txt', md5(id::text), 'copied'
            FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%';
        INSERT INTO run (tenant_id, mapping_id, kind, status, started_at)
          SELECT tenant_id, id, 'incremental', 'running', now() - interval '5 minutes'
            FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%' ORDER BY id LIMIT 1;
        -- A pass that died hours ago: stale, and not in flight.
        INSERT INTO run (tenant_id, mapping_id, kind, status, started_at)
          SELECT tenant_id, id, 'incremental', 'running', now() - interval '5 hours'
            FROM mailbox_mapping WHERE tenant_id::text LIKE '${PREFIX}%' ORDER BY id DESC LIMIT 1;
      `);
    });
    const before = await withDb(dataDir, countPrefixed);

    const r = run(s, ['--remove']);
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toMatch(/1 pass/);
    expect(r.out).toMatch(/paused/);

    await withDb(dataDir, async (db) => {
      expect(await countPrefixed(db)).toEqual(before);
      const { rows } = await db.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM mailbox_mapping WHERE tenant_id::text LIKE $1 GROUP BY 1`,
        [`${PREFIX}%`],
      );
      expect(rows).toEqual([{ status: 'paused', n: 12 }]);
      // And the demo's own migrations were not paused with it.
      const demo = await db.query<{ status: string }>(
        `SELECT DISTINCT status FROM mailbox_mapping WHERE tenant_id IN ('${DEMO_A}', '${DEMO_B}')`,
      );
      expect(demo.rows).toEqual([{ status: 'active' }]);
    });
  });

  it('once the pass has finished, removes every row of the rehearsal and counts them', async () => {
    await withDb(dataDir, async (db) => {
      await db.exec(`
        UPDATE run SET status = 'succeeded', finished_at = now()
         WHERE tenant_id::text LIKE '${PREFIX}%' AND status = 'running'
           AND started_at > now() - interval '1 hour';
        INSERT INTO rate_budget (tenant_id, provider, tokens, refilled_at)
          SELECT id, 'imap:stalwart', 10, now() FROM tenant WHERE id::text LIKE '${PREFIX}%';
      `);
    });
    const before = await withDb(dataDir, countPrefixed);
    // Vacuity: the passes' tables really are in play, beyond what the seed wrote.
    for (const t of ['run', 'run_event', 'item', 'rate_budget']) expect(before[t], t).toBeGreaterThan(0);

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
  });

  it('a second removal finds nothing and says so', () => {
    const r = run(s, ['--remove']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/nothing to remove/i);
  });

  it('refuses to seed without the demo it copies, and writes nothing', async () => {
    await withDb(dataDir, (db) =>
      db.exec(`DELETE FROM connection WHERE id = 'b0000000-0000-4000-8000-0000000000c1'`),
    );
    const r = run(s, ['--seed', '2', '2']);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('--with-demo');
    await withDb(dataDir, async (db) => {
      expect(await countPrefixed(db)).toEqual({});
    });
  });

  it('counts a pass in flight with the same window the tick uses', () => {
    // A run row older than STALE_RUN_AFTER_MS is a pass that died, and the tick
    // enqueues its migration again. The removal must not wait on one for ever.
    const deadline = readFileSync(join(REPO_ROOT, 'packages/shared/src/pass-deadline.ts'), 'utf8');
    const tick = readFileSync(join(REPO_ROOT, 'apps/worker/src/jobs/managed-sync-tick.ts'), 'utf8');
    const hardMs = Number(/PASS_HARD_LIMIT_MS = ([\d_]+);/.exec(deadline)?.[1]?.replace(/_/g, ''));
    expect(tick).toContain('const STALE_RUN_AFTER_MS = 2 * PASS_HARD_LIMIT_MS;');
    const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
    const seconds = Number(/^STALE_RUN_AFTER_SECONDS=(\d+)$/m.exec(script)?.[1]);
    expect(seconds).toBe((2 * hardMs) / 1000);
  });
});

// ---------------------------------------------------------------------------
// The sample line
// ---------------------------------------------------------------------------

describe('a sample line carries every field T9 records', () => {
  const STATS = [
    'runner-cm1abc|210.5MiB / 125GiB',
    'runner-cm2def|1.5GiB / 125GiB',
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

  function sampleStage() {
    const s = stage('POSTGRES_USER=openmigrate\n');
    writeFileSync(join(s.root, 'stats'), STATS);
    writeFileSync(join(s.root, 'pools'), POOLS);
    s.env.STUB_STATS = join(s.root, 'stats');
    s.env.STUB_POOLS = join(s.root, 'pools');
    s.env.STUB_PSQL_ANSWER = '37\n';
    return s;
  }

  const sampleFiles = (s: Stage): string[] => {
    const dir = join(s.root, '.persistent', 'rehearsal-stub', 'rehearsal');
    return existsSync(dir) ? readdirSync(dir).map((f) => join(dir, f)) : [];
  };

  it('prints the containers, the host, the pooler and the database, and appends it to a file', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '1']);
    expect(r.status, r.out).toBe(0);
    const line = r.out.split('\n').find((l) => /^\d{4}-\d\d-\d\dT/.test(l));
    expect(line, r.out).toBeDefined();
    const fields = Object.fromEntries(
      line!.split(' ').slice(1).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
    );
    expect(fields).toEqual({
      tasks: '2',
      task_mem_mib: 'runner-cm1abc:211,runner-cm2def:1536',
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
    expect(text).toContain(line!);
    expect(text).toMatch(/^# /m);
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

  it('takes two samples ten seconds apart when asked for two', () => {
    const s = sampleStage();
    const r = run(s, ['--sample', '--count', '2'], { REHEARSAL_SAMPLE_SECONDS: '1' });
    expect(r.status, r.out).toBe(0);
    expect(r.out.split('\n').filter((l) => /^\d{4}-\d\d-\d\dT/.test(l))).toHaveLength(2);
    const script = readFileSync(join(COMPOSE_DIR, SCRIPT), 'utf8');
    expect(script).toMatch(/REHEARSAL_SAMPLE_SECONDS:-10\}/);
  });
});
