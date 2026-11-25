// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE API'S DOORS ON A REAL PG-BOSS (workplan 0167 T6; ADR-0054).
 *
 * With `OWNPACE_JOB_RUNNER=pg-boss`, the doors are pressed through Express, as
 * a person presses them, and enqueue on pg-boss 12 in a Postgres of its own:
 * the schema `pgboss` in a fresh database, owned by a plain role, as the
 * managed bring-up makes it, and its queues made by a worker from the catalog.
 * The ledger the doors read is PGlite with both chains, as in
 * `a-hold-that-holds-every-door`.
 *
 * - **Discovery joins as on Trigger.dev.** Two presses inside the window are
 *   one job, and the second is `joined`. A press after the migration changed
 *   is a new job, on the same singleton key, and waits behind the first: the
 *   worker does not start it while the first runs.
 * - **Sync now** answers a UUID `runId`, and its job carries the migration as
 *   its singleton key, and the tags.
 * - **A queue the worker never made** fails *Start*'s first pass, which lands
 *   on the answer as `queued: false` with the producer's sentence, as a failed
 *   enqueue does today. **A jobs database it cannot reach** lands the same
 *   way, in one sentence that names no host or port.
 * - **The close** cancels the queued pass by its `orchestrator_ref`, through
 *   the same `cancelRun` the close routes hand it.
 * - **Readiness** on pg-boss reads the shared beat, `managed-sync-tick`, and
 *   not the pg-boss runner's own.
 *
 * Trigger.dev is gone since alpha.18 (workplan 0167 T9): nothing here stands
 * in for it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { pgliteDriver, plainDb, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { recordTickBeat, runManagedMigrations, SYNC_TICK_BEAT_ON } from '@openmig/managed';
import { JOB_CATALOG, PgBossJobRunner } from '@openmig/scheduler/pg-boss';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run under the Testcontainers harness or scripts/local-pg.sh.');
}

// UUID family 0167a6d0-…, unused elsewhere in the repo.
const TENANT = '0167a6d0-e29b-41d4-a716-446655440001';
const CONN = '0167a6d0-e29b-41d4-a716-446655440011';
const BOX = '0167a6d0-e29b-41d4-a716-446655440021';
const ACTIVE = '0167a6d0-e29b-41d4-a716-446655440031';
const DRAFT = '0167a6d0-e29b-41d4-a716-446655440032';
const DRAFT_TOO = '0167a6d0-e29b-41d4-a716-446655440033';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SUFFIX = randomBytes(4).toString('hex');
const ROLE = 'ownpace_jobs_api_test';
const PASSWORD = randomBytes(18).toString('base64url');
/** A database of its own, so the schema can be `pgboss`, as the API names it. */
const DB = `api_jobs_${SUFFIX}`;
/** One with the schema installed and no queue: a worker that never got to declare them. */
const EMPTY_DB = `api_jobs_empty_${SUFFIX}`;

function urlOf(database: string, user?: string, password?: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${database}`;
  if (user !== undefined) u.username = user;
  if (password !== undefined) u.password = password;
  return u.toString();
}
const JOBS_URL = urlOf(DB, ROLE, PASSWORD);
const EMPTY_JOBS_URL = urlOf(EMPTY_DB, ROLE, PASSWORD);

// The source is an IMAP account, and since workplan 0174 T1 a password account
// with no stored password does not start (`awaitingGrant`, 409 `awaiting_grant`).
// The fixture stores one, encrypted as the create route stores it, under a key
// of this test's own when the harness gives none.
process.env.SECRET_ENCRYPTION_KEY ??= '0167a6d0'.repeat(8);

let driver: LedgerDriver;

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'tester', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});


const { default: migrationRoutes } = await import('./routes/migrations/index.ts');
const { cancelRun, closeJobRunner } = await import('./job-runner.ts');
const { enqueueIfFree, QUEUE_UNREACHABLE } = await import('./enqueue-unless-held.ts');
const { discoveryTriggerOptions } = await import('./routes/migrations/job-resolution.ts');
const { closeAccount } = await import('./close-account.ts');
const { schedulerReadiness, __setPoolForTests } = await import('./routes/ready.ts');
const { SecretStore } = await import('@openmig/core/secret-store');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

let admin: pg.Pool;
let jobsDb: pg.Pool;
let worker: PgBossJobRunner;
const saved: Record<string, string | undefined> = {};

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

async function jobRow(id: string) {
  const { rows } = await jobsDb.query<{ name: string; singleton_key: string | null; state: string; data: { tags?: string[] } }>(
    'SELECT name, singleton_key, state, data FROM pgboss.job WHERE id = $1',
    [id],
  );
  return rows[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await sleep(200);
  }
}

beforeAll(async () => {
  for (const k of ['OWNPACE_JOB_RUNNER', 'JOBS_DATABASE_URL', 'TRIGGER_SECRET_KEY']) saved[k] = process.env[k];

  admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  await admin.query(
    `${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT ` +
      `NOREPLICATION NOBYPASSRLS PASSWORD '${PASSWORD}'`,
  );
  for (const db of [DB, EMPTY_DB]) {
    await admin.query(`CREATE DATABASE ${db}`);
    const owner = new pg.Client({ connectionString: urlOf(db) });
    await owner.connect();
    await owner.query(`CREATE SCHEMA pgboss AUTHORIZATION ${ROLE}`);
    await owner.end();
  }
  // The beat's table, for the readiness: both chains, as on the stack.
  await runMigrations({ connectionString: urlOf(DB), logger: () => {} });
  await runManagedMigrations({ connectionString: urlOf(DB), logger: () => {} });
  jobsDb = new pg.Pool({ connectionString: JOBS_URL, max: 2 });

  // The worker installs the schema and declares the catalog's queues; it works
  // none of them until a test asks.
  worker = new PgBossJobRunner({ connectionString: JOBS_URL, schema: 'pgboss', pollingIntervalSeconds: 0.5 });
  await worker.start(JOB_CATALOG);
  // A worker that installed the schema on the other database and declared nothing.
  const bare = new PgBossJobRunner({ connectionString: EMPTY_JOBS_URL, schema: 'pgboss' });
  await bare.start([]);
  await bare.stop({ graceful: false });

  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'on pg-boss']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected',$3)`,
    [
      CONN,
      TENANT,
      JSON.stringify(
        SecretStore.encryptCredentials({ username: 'pgboss@example.invalid', password: 'fixture-not-a-password' }).encrypted,
      ),
    ],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','pgboss@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
     VALUES ($1,$3,$4,'active'), ($2,$3,$4,'paused'), ($5,$3,$4,'paused')`,
    [ACTIVE, DRAFT, TENANT, BOX, DRAFT_TOO],
  );

  process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
  process.env.JOBS_DATABASE_URL = JOBS_URL;
  delete process.env.TRIGGER_SECRET_KEY;
}, 180_000);

afterAll(async () => {
  await closeJobRunner();
  // Stopped here only, so a stop that fails fails the hook.
  await worker?.stop({ graceful: false });
  await jobsDb?.end();
  __setPoolForTests(null);
  await driver?.end();
  if (admin) {
    for (const db of [DB, EMPTY_DB]) await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.end();
  }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('discovery, joined as on Trigger.dev', () => {
  const discoveries: string[] = [];

  it('two presses inside the window are one job, and the second is joined', async () => {
    const first = await request(app).post(`/api/migrations/${ACTIVE}/discover`).send({});
    const second = await request(app).post(`/api/migrations/${ACTIVE}/discover`).send({});
    expect(first.status, JSON.stringify(first.body)).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.runId).toMatch(UUID);
    expect(second.body.runId).toBe(first.body.runId);

    // The door reads only the id; the join itself, asked of the enqueue a door
    // is handed, with the door's own options.
    const { rows } = await jobsDb.query<{ n: string }>(`SELECT count(*) AS n FROM pgboss.job WHERE name = 'run-discovery'`);
    expect(Number(rows[0]!.n)).toBe(1);
    const updatedAt = await mappingUpdatedAt();
    const free = await enqueueIfFree(TENANT, driver);
    if (!('enqueue' in free)) throw new Error(`stopped: ${free.stopped}`);
    const again = await free.enqueue(
      'run-discovery',
      { tenantId: TENANT, mappingId: ACTIVE },
      discoveryTriggerOptions(TENANT, ACTIVE, { updatedAt }),
    );
    expect(again).toEqual({ id: first.body.runId, joined: true });

    const row = await jobRow(first.body.runId);
    expect(row).toMatchObject({ name: 'run-discovery', singleton_key: ACTIVE, state: 'created' });
    expect(row!.data.tags).toEqual([`tenant:${TENANT}`, `mapping:${ACTIVE}`]);
    discoveries.push(first.body.runId);
  });

  it('a press after the migration changed is a new job, which waits behind the first', async () => {
    await sql(`UPDATE mailbox_mapping SET updated_at = updated_at + interval '1 second' WHERE id = $1`, [ACTIVE]);
    const third = await request(app).post(`/api/migrations/${ACTIVE}/discover`).send({});
    expect(third.status).toBe(202);
    expect(third.body.runId).toMatch(UUID);
    expect(third.body.runId).not.toBe(discoveries[0]);
    expect((await jobRow(third.body.runId))?.singleton_key).toBe(ACTIVE);
    discoveries.push(third.body.runId);

    // Two slots on the worker, so only the singleton key can keep the second out.
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await worker.work<unknown, null>(
      'run-discovery',
      async (_payload, ctx) => {
        started.push(ctx.runId);
        if (started.length === 1) await gate;
        return null;
      },
      { concurrency: 2 },
    );
    await until('the first count to start', async () => started.length >= 1);
    expect(started).toEqual([discoveries[0]]);
    // Several polls of the worker, with a slot free: the second waits.
    await sleep(3_000);
    expect(started).toEqual([discoveries[0]]);
    expect((await jobRow(discoveries[1]!))?.state).toBe('created');

    release();
    await until('the second count to start', async () => started.length === 2);
    expect(started).toEqual(discoveries);
    await until('both counts to complete', async () => {
      const states = await Promise.all(discoveries.map(async (id) => (await jobRow(id))?.state));
      return states.every((s) => s === 'completed');
    });
  }, 60_000);
});

async function mappingUpdatedAt(): Promise<Date> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(`SELECT updated_at FROM mailbox_mapping WHERE id = $1`, [ACTIVE]);
    return new Date((r.rows[0] as { updated_at: string | Date }).updated_at);
  } finally {
    await conn.release();
  }
}

describe('Sync now, a queue never made, and the close', () => {
  let pass: string;

  it('Sync now answers a UUID runId, and its job is singleton by the migration', async () => {
    const res = await request(app).post(`/api/migrations/${ACTIVE}/sync`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.runId).toMatch(UUID);
    pass = res.body.runId;
    const row = await jobRow(pass);
    expect(row).toMatchObject({ name: 'run-delta-sync', singleton_key: ACTIVE, state: 'created' });
    expect(row!.data.tags).toEqual([`tenant:${TENANT}`, `mapping:${ACTIVE}`]);
  });

  it('a queue the worker never made: Start’s first pass is not queued, and says why', async () => {
    await closeJobRunner();
    process.env.JOBS_DATABASE_URL = EMPTY_JOBS_URL;
    try {
      const res = await request(app).post(`/api/migrations/${DRAFT}/start`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.firstRun).toEqual({
        queued: false,
        reason:
          'The queue "run-delta-sync" does not exist in the jobs schema "pgboss". The worker creates every queue ' +
          'when it starts, so it has not started on this schema yet; nothing was enqueued.',
      });
    } finally {
      await closeJobRunner();
      process.env.JOBS_DATABASE_URL = JOBS_URL;
    }
  });

  it('a jobs database it cannot reach: Start says so in one sentence, and names no address', async () => {
    await closeJobRunner();
    // The same server's host, on a port nothing listens on.
    const nowhere = new URL(JOBS_URL);
    nowhere.port = '1';
    process.env.JOBS_DATABASE_URL = nowhere.toString();
    try {
      const res = await request(app).post(`/api/migrations/${DRAFT_TOO}/start`).send({});
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.firstRun).toEqual({ queued: false, reason: QUEUE_UNREACHABLE });
      const said = JSON.stringify(res.body);
      expect(said).not.toContain(nowhere.hostname);
      expect(said).not.toMatch(/ECONNREFUSED|:1\b/);
    } finally {
      await closeJobRunner();
      process.env.JOBS_DATABASE_URL = JOBS_URL;
    }
  });

  it('the close cancels the queued pass by its orchestrator_ref', async () => {
    await sql(`INSERT INTO run (tenant_id, mapping_id, kind, status, orchestrator_ref) VALUES ($1, $2, 'incremental', 'queued', $3)`, [
      TENANT,
      ACTIVE,
      pass,
    ]);
    const closed = await closeAccount(
      driver,
      {
        tenantId: TENANT,
        windowDays: 30,
        closedBy: 'tester',
        via: 'screen',
        closedAt: new Date(),
        backupRetentionDays: 7,
      },
      { cancelRun },
    );
    expect(closed.passesStopped).toBe(1);
    expect((await jobRow(pass))?.state).toBe('cancelled');
  });
});

describe('readiness on pg-boss', () => {
  it('reads the shared beat, not the pg-boss runner’s own', async () => {
    const beats = new pg.Pool({ connectionString: urlOf(DB), max: 1 });
    __setPoolForTests(beats);
    const now = new Date();
    const db = plainDb(beats);
    // Only the runner's own beat is fresh: the shared one, which the status page reads, is missing.
    expect(await recordTickBeat(db, now, SYNC_TICK_BEAT_ON['pg-boss'])).toBe(true);
    expect(await schedulerReadiness(now)).toEqual({ scheduler: 'down' });
    expect(await recordTickBeat(db, now)).toBe(true);
    expect(await schedulerReadiness(now)).toEqual({ scheduler: 'up' });
    // Without the jobs URL, there is no runner here: off, whatever the beat says.
    delete process.env.JOBS_DATABASE_URL;
    try {
      expect(await schedulerReadiness(now)).toEqual({ scheduler: 'off' });
    } finally {
      process.env.JOBS_DATABASE_URL = JOBS_URL;
      __setPoolForTests(null);
      await beats.end();
    }
  });
});
