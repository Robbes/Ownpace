#!/usr/bin/env node
// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// SPIKE: can the self-host edition run on PGlite (Postgres compiled to WASM)
// instead of a Postgres SERVER?
//
// WHY THIS EXISTS. The native-Windows installer (workplan 0015) has exactly one
// hard problem: since the shell-out engines were deleted the runtime is pure
// JavaScript, so Postgres (ADR-0023) is the only native dependency left. Shipping
// a Postgres server inside an MSI means ~300 MB, a Windows service, `initdb` on
// first run, a port to collide with, and a major-version upgrade problem on every
// user's laptop — for a single-user desktop app.
//
// PGlite is real Postgres compiled to WASM, running in-process. If the REAL
// schema applies and RLS really enforces, ADR-0023 survives untouched — same SQL,
// same migrations, same Drizzle — and the installer problem mostly disappears.
//
// This runs the ACTUAL packages/ledger/migrations/0001_baseline.sql, not a
// simplified copy. The point is to find what a real install would hit.
//
//   mkdir -p /tmp/pglite-spike-deps && (cd /tmp/pglite-spike-deps && npm i @electric-sql/pglite@0.5.4)
//   PGLITE_DIR=/tmp/pglite-spike-deps node scripts/spike-pglite-windows.mjs
//
// PGlite is deliberately NOT a workspace dependency. Adding it makes pnpm
// resolve a SECOND copy of drizzle-orm — drizzle declares pglite as an optional
// peer, so its store key changes — and the workspace then typechecks two
// incompatible `SQL<unknown>` types against each other and fails. That is worth
// knowing before adopting PGlite for real: the switch has to be made across the
// whole workspace at once, not added alongside `pg`.
//
// Not a test and not wired into CI: PGlite is not adopted, this is the evidence
// behind the decision. If it is adopted, this becomes an integration test so the
// property stays true rather than having been true once.

import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolved from an explicit directory rather than a bare specifier, because
// PGlite is deliberately not a workspace dependency (see above) and ESM ignores
// NODE_PATH, so neither `pnpm dlx` nor a hoisted install makes a bare import
// resolvable from here.
const PGLITE_DIR = process.env.PGLITE_DIR;
if (!PGLITE_DIR) {
  console.error(
    'Set PGLITE_DIR to a directory where @electric-sql/pglite is installed, e.g.\n' +
      '  mkdir -p /tmp/pglite-spike-deps && (cd /tmp/pglite-spike-deps && npm i @electric-sql/pglite@0.5.4)\n' +
      '  PGLITE_DIR=/tmp/pglite-spike-deps node scripts/spike-pglite-windows.mjs',
  );
  process.exit(2);
}
const pgliteRoot = join(PGLITE_DIR, 'node_modules/@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(join(pgliteRoot, 'dist/index.js')).href);
const { pgcrypto } = await import(
  pathToFileURL(join(pgliteRoot, 'dist/contrib/pgcrypto.js')).href
);

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = join(REPO, 'packages/ledger/migrations/0001_baseline.sql');
const DATA_DIR = process.env.SPIKE_DATA_DIR ?? '/tmp/pglite-spike';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const MAP = '44444444-4444-4444-4444-444444444444';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(s) {
  console.log(`      ${s}`);
}

rmSync(DATA_DIR, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 1. Start, and apply the real baseline.
// ---------------------------------------------------------------------------
const tCold = Date.now();
// pgcrypto must be supplied explicitly: PGlite ships it as a contrib extension
// rather than compiling it in, so the bare build answers `CREATE EXTENSION
// pgcrypto` with "extension is not available". Nothing in our schema actually
// CALLS a pgcrypto function — `gen_random_uuid()` has been core Postgres since
// 13 — so the CREATE EXTENSION line is a pg_dump artefact of the old migration
// chain. Loading the contrib keeps the baseline byte-identical to the one real
// Postgres gets, which is worth more than dropping two lines from it.
const db = new PGlite(DATA_DIR, { extensions: { pgcrypto } });
await db.waitReady;
check('starts with filesystem persistence', true, `${Date.now() - tCold}ms cold start`);
note((await db.query('SELECT version()')).rows[0].version);

try {
  await db.exec(readFileSync(BASELINE, 'utf8'));
  check('the REAL 0001_baseline.sql applies unmodified', true);
} catch (err) {
  check('the REAL 0001_baseline.sql applies unmodified', false, err.message);
  process.exit(1);
}

const tables = await db.query(
  `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`,
);
const policies = await db.query(`SELECT COUNT(*)::int AS n FROM pg_policies`);
const rlsTables = await db.query(
  `SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relrowsecurity`,
);
const role = await db.query(`SELECT 1 FROM pg_roles WHERE rolname='app_user'`);
check('schema landed', tables.rows[0].n > 20, `${tables.rows[0].n} tables`);
check('RLS policies created', policies.rows[0].n > 0, `${policies.rows[0].n} policies on ${rlsTables.rows[0].n} tables`);
check('cluster-global app_user role created', role.rows.length === 1);

// ---------------------------------------------------------------------------
// 2. The primitives the ledger depends on.
// ---------------------------------------------------------------------------
check('gen_random_uuid()', !!(await db.query('SELECT gen_random_uuid() AS id')).rows[0].id);
await db.query('SELECT pg_advisory_lock($1)', [4242]);
await db.query('SELECT pg_advisory_unlock($1)', [4242]);
check('pg_advisory_lock (the migration runner serialises on this)', true);

await db.exec('BEGIN');
await db.query(`SELECT set_config('app.current_tenant',$1,true)`, [B]);
const inTx = (await db.query(`SELECT current_setting('app.current_tenant',true) AS t`)).rows[0].t;
await db.exec('ROLLBACK');
const afterTx = (await db.query(`SELECT current_setting('app.current_tenant',true) AS t`)).rows[0].t;
check(
  'transaction-local set_config (what withTenant() relies on)',
  inTx === B && afterTx !== B,
  `in-tx=${inTx}, after rollback=${afterTx || 'unset'}`,
);

// ---------------------------------------------------------------------------
// 3. Fixtures.
// ---------------------------------------------------------------------------
await db.query(`INSERT INTO tenant (id,name) VALUES ($1,'A'),($2,'B')`, [A, B]);
await db.query(
  `INSERT INTO connection (id,tenant_id,role,kind,display_name)
   VALUES (gen_random_uuid(),$1,'source','jmap','A-src'),
          (gen_random_uuid(),$2,'source','jmap','B-src')`,
  [A, B],
);
const conn = await db.query(`SELECT id FROM connection WHERE tenant_id=$1 LIMIT 1`, [A]);
const box = await db.query(
  `INSERT INTO mailbox (id,tenant_id,connection_id,primary_address)
   VALUES (gen_random_uuid(),$1,$2,'a@example.com') RETURNING id`,
  [A, conn.rows[0].id],
);
await db.query(
  `INSERT INTO mailbox_mapping (id,tenant_id,source_mailbox_id) VALUES ($1,$2,$3)`,
  [MAP, A, box.rows[0].id],
);

// ---------------------------------------------------------------------------
// 4. DOES RLS ACTUALLY ENFORCE? The question that matters, because "96 policies
//    created" is not the same as "96 policies doing anything": Postgres bypasses
//    RLS for superusers and table owners, and an in-process WASM database runs
//    as exactly that.
// ---------------------------------------------------------------------------
note(`default session user: ${(await db.query('SELECT current_user AS u')).rows[0].u} (superuser)`);
note(`row_security default: ${(await db.query('SHOW row_security')).rows[0].row_security}`);

await db.exec('SET ROLE app_user');
check(
  'SET ROLE app_user (the only way an in-process DB becomes a non-owner)',
  (await db.query('SELECT current_user AS u')).rows[0].u === 'app_user',
);

// PGlite defaults `row_security` to OFF where a real server defaults to ON.
// With it off, a query that WOULD be filtered raises "query would be affected by
// row-level security policy" instead of silently returning everything — a loud
// failure rather than a quiet cross-tenant leak, which is the right direction to
// be wrong in, but it does mean an adopter MUST set this explicitly.
await db.exec('SET row_security = on');

const seen = {};
for (const [label, t] of [['A', A], ['B', B]]) {
  await db.query(`SELECT set_config('app.current_tenant',$1,false)`, [t]);
  seen[label] = (await db.query(`SELECT COUNT(*)::int AS n FROM connection`)).rows[0].n;
}
check(
  'RLS ENFORCES tenant isolation on SELECT',
  seen.A === 1 && seen.B === 1,
  `tenant A sees ${seen.A}, tenant B sees ${seen.B} of 2 rows (want 1 and 1)`,
);

let refused = false;
try {
  await db.query(
    `INSERT INTO connection (id,tenant_id,role,kind,display_name)
     VALUES (gen_random_uuid(),$1,'source','jmap','cross-tenant')`,
    [A], // session is still scoped to B
  );
} catch {
  refused = true;
}
check('RLS refuses a cross-tenant INSERT', refused);
await db.exec('RESET ROLE');

// ---------------------------------------------------------------------------
// 5. Throughput. A 48k-message mailbox writes ~48k ledger rows, and PGlite is
//    single-connection where the real ledger writes from a pool.
// ---------------------------------------------------------------------------
async function insertItems(n, prefix, batched) {
  const t = Date.now();
  if (batched) await db.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    await db.query(
      `INSERT INTO item (id,tenant_id,mapping_id,domain,collection,natural_key,
                         natural_key_hash,content_hash,status,target_ref,first_seen_at,updated_at)
       VALUES (gen_random_uuid(),$1,$2,'email','INBOX','',$3,'h','copied','{}',now(),now())`,
      [A, MAP, `${prefix}-${i}`],
    );
  }
  if (batched) await db.exec('COMMIT');
  return Date.now() - t;
}

const N = 5000;
const batchedMs = await insertItems(N, 'batch', true);
check('write throughput, batched', true, `${N} rows in ${batchedMs}ms → ${Math.round((N / batchedMs) * 1000)} rows/s`);

const M = 500;
const soloMs = await insertItems(M, 'solo', false);
const soloRate = Math.round((M / soloMs) * 1000);
check(
  'write throughput, one transaction per row (how the ledger writes)',
  true,
  `${M} rows in ${soloMs}ms → ${soloRate} rows/s ≈ ${Math.round(48000 / soloRate)}s for a 48k-message mailbox`,
);

const tLookup = Date.now();
const found = await db.query(
  `SELECT id FROM item WHERE tenant_id=$1 AND mapping_id=$2 AND domain='email' AND natural_key_hash=$3`,
  [A, MAP, 'batch-4999'],
);
check('indexed natural-key lookup (the ledger fast path)', found.rows.length === 1, `${Date.now() - tLookup}ms`);

const size = await db.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
note(`on-disk size after ${N + M} item rows: ${size.rows[0].s}`);

// ---------------------------------------------------------------------------
// 6. An installed app gets stopped and started.
// ---------------------------------------------------------------------------
await db.close();
const tWarm = Date.now();
const db2 = new PGlite(DATA_DIR, { extensions: { pgcrypto } });
await db2.waitReady;
const warmMs = Date.now() - tWarm;
const survived = await db2.query(`SELECT COUNT(*)::int AS n FROM item`);
check('data survives a restart', survived.rows[0].n === N + M, `${warmMs}ms warm start, ${survived.rows[0].n} rows`);
await db2.close();

console.log('\n---');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAILED: ${f.name} — ${f.detail}`);
process.exit(failed.length ? 1 : 0);
