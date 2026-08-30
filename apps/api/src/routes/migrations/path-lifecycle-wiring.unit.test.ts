// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The path rows move WITH the mapping, proved at the routes against a real
 * database (workplan 0109 T1b, the wiring half).
 *
 * WHY THE ROUTES AND NOT THE HELPER — the same reason as
 * `mapping-status-audit.unit.test.ts`, whose harness this mirrors:
 * `movePathsWithMapping` would be green whether or not a single route called
 * it, and a decision computed correctly then dropped between the function and
 * the request is the bug this repository keeps being bitten by. So this
 * presses start, update, finish and create, then reads `path_lifecycle`
 * directly, outside any route, to see what really landed.
 *
 * The rules under test are ADR-0014's, pinned here at the grain an invoice is
 * reconstructed from:
 *  - absent means `ready` — a draft has no rows, and no press except into
 *    `active` may conjure one;
 *  - `paused` STILL HOLDS A SLOT — `ended_at` stays NULL;
 *  - `first_activated_at` is stamped once — a resume keeps the original date;
 *  - only `included` domains are paths at all.
 *
 * UUID family 5f660000-…, unused elsewhere in the repo.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

const TENANT = '5f660000-e29b-41d4-a716-446655441901';
const CONN = '5f660000-e29b-41d4-a716-446655441911';
const BOX = '5f660000-e29b-41d4-a716-446655441921';
const MAPPING = '5f660000-e29b-41d4-a716-446655441931';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'rob', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});
// The start route enqueues a first pass; answering keeps this file about the
// lifecycle rows rather than exercising the enqueue-failure path by accident.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: { trigger: () => Promise.resolve({ id: 'run-1' }) },
    }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

interface PathRow {
  domain: string;
  state: string;
  first_activated_at: string | null;
  ended_at: string | null;
}

/** Read `path_lifecycle` directly — the witness no route can fake. */
async function pathRows(mappingId: string = MAPPING): Promise<PathRow[]> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      `SELECT domain, state, first_activated_at, ended_at
       FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
      [mappingId],
    );
    return r.rows as unknown as PathRow[];
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: the activation path writes `occupancy_peak`
  // (0109 T2), a managed-only table — these routes are the managed API's.
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'pathed']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected',$3)`,
      [
        CONN,
        TENANT,
        JSON.stringify(
          SecretStore.encryptCredentials({ username: 'a@example.invalid', password: 'p' })
            .encrypted,
        ),
      ],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'paused')`,
      [MAPPING, TENANT, BOX],
    );
    // Two paths, and one domain that is NOT one: `contact` sits in the scope
    // table with included=false, so any press that moves it proves the helper
    // lost its filter.
    await q(
      `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
       VALUES ($1,$2,'email',true), ($1,$2,'calendar',true), ($1,$2,'contact',false)`,
      [TENANT, MAPPING],
    );
  } finally {
    await conn.release();
  }
  // PGlite's WASM warm-up on a cold runner exceeds vitest's 10s default —
  // the same allowance the billing PGlite suites carry.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    // Mappings the creation tests made — removing them cascades their scope
    // and lifecycle rows, so every test starts from the one fixture mapping.
    await conn.query('DELETE FROM mailbox_mapping WHERE id <> $1', [MAPPING]);
    await conn.query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    await conn.query('DELETE FROM path_lifecycle');
    await conn.query('DELETE FROM occupancy_peak');
  } finally {
    await conn.release();
  }
});

describe('absent means ready', () => {
  it('a draft mapping has no rows at all', async () => {
    expect(await pathRows()).toEqual([]);
  });

  it('a PATCH restating the status it already has conjures nothing', async () => {
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect(await pathRows()).toEqual([]);
  });

  it('a real transition on a never-started mapping conjures nothing either', async () => {
    // paused → cutover is a genuine transition, but no path ever activated:
    // creating rows here would fabricate a history for paths that never ran.
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'cutover' });
    expect(res.status).toBe(200);
    expect(await pathRows()).toEqual([]);
  });
});

describe('start takes the slots', () => {
  it('activates every included path, and only those', async () => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(res.status).toBe(200);

    const rows = await pathRows();
    // calendar + email, ordered by domain; `contact` (included=false) is not
    // a path and must not appear.
    expect(rows.map((r) => [r.domain, r.state])).toEqual([
      ['calendar', 'active'],
      ['email', 'active'],
    ]);
    for (const r of rows) {
      expect(r.first_activated_at).not.toBeNull();
      expect(r.ended_at).toBeNull();
    }
  });

  it('a second start is not a second activation', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const before = await pathRows();
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(await pathRows()).toEqual(before);
  });
});

describe('paused holds a slot — the counter-intuitive rule, pinned at the route', () => {
  it('pausing moves the state and leaves ended_at NULL', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const started = await pathRows();

    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    expect(res.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['paused', 'paused']);
    for (const [i, r] of rows.entries()) {
      // Still holding a slot: a paused path has not ended.
      expect(r.ended_at).toBeNull();
      expect(r.first_activated_at).toEqual(started[i]?.first_activated_at);
    }
  });

  it('a resume keeps the original first_activated_at', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const original = (await pathRows()).map((r) => r.first_activated_at);

    await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    const resumed = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(resumed.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['active', 'active']);
    // A path that resumed has not started again — the invoice needs the
    // original date, months later.
    expect(rows.map((r) => r.first_activated_at)).toEqual(original);
  });
});

describe('ending releases the slot, with the date on the row', () => {
  it('cutover stamps ended_at', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'cutover' });
    expect(res.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['cutover', 'cutover']);
    for (const r of rows) expect(r.ended_at).not.toBeNull();
  });

  it('finish moves every path to done', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    expect(res.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['done', 'done']);
    for (const r of rows) expect(r.ended_at).not.toBeNull();
  });
});

describe('the month remembers its peak (0109 T2)', () => {
  interface PeakRow {
    month: string;
    peak_paths: number;
    peak_at: string | null;
  }
  async function peakRows(): Promise<PeakRow[]> {
    const conn = await driver.acquire();
    try {
      const r = await conn.query(
        `SELECT month, peak_paths, peak_at FROM occupancy_peak WHERE tenant_id = $1 ORDER BY month`,
        [TENANT],
      );
      return r.rows as unknown as PeakRow[];
    } finally {
      await conn.release();
    }
  }

  it('starting writes the current month high-water in the same press', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const rows = await peakRows();
    expect(rows).toHaveLength(1);
    // Two included paths took slots; the mark is 2, dated now, this month.
    expect(rows[0]?.peak_paths).toBe(2);
    expect(rows[0]?.peak_at).not.toBeNull();
    // The driver hands `date` back as a JS Date; first-of-month in UTC.
    expect(new Date(rows[0]?.month ?? 0).getUTCDate()).toBe(1);
  });

  it('a tie does not move the mark — pause, resume, same peak, same date', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const [set] = await peakRows();
    // Guard the guard: an absent row would make the comparison below pass
    // vacuously (undefined equals undefined), hiding a recorder that never ran.
    expect(set?.peak_paths).toBe(2);
    await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const [after] = await peakRows();
    // paused held the slots, so the resume re-reached 2 — re-reaching a level
    // is not setting it: the evidence date stays the moment it was SET.
    expect(after).toEqual(set);
  });

  it('finishing releases slots but the month keeps its mark', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const [set] = await peakRows();
    await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    expect(await peakRows()).toEqual([set]);
  });

  it('a second active mapping raises the mark', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app)
      .post('/api/migrations')
      .send({
        name: 'the fourth and fifth path',
        sourceType: 'imap',
        targetType: 'jmap',
        sourceConfig: { host: 'src2.example.invalid', port: 993, username: 'c@example.invalid', password: 'p' },
        targetConfig: { host: 'dst2.example.invalid', port: 443, username: 'c@example.invalid', password: 'p' },
        syncConfig: { domains: ['email', 'contact'] },
        status: 'active',
      });
    expect(res.status).toBe(201);
    const rows = await peakRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.peak_paths).toBe(4);
  });
});

describe('a mapping created directly as active', () => {
  it('has its paths from birth — creation never passes the start route', async () => {
    const res = await request(app)
      .post('/api/migrations')
      .send({
        name: 'born running',
        sourceType: 'imap',
        targetType: 'jmap',
        sourceConfig: { host: 'src.example.invalid', port: 993, username: 'b@example.invalid', password: 'p' },
        targetConfig: { host: 'dst.example.invalid', port: 443, username: 'b@example.invalid', password: 'p' },
        syncConfig: { domains: ['email', 'contact'] },
        status: 'active',
      });
    expect(res.status).toBe(201);

    const rows = await pathRows(res.body.id);
    expect(rows.map((r) => [r.domain, r.state])).toEqual([
      ['contact', 'active'],
      ['email', 'active'],
    ]);
    for (const r of rows) expect(r.first_activated_at).not.toBeNull();
  });
});
