// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A status change is RECORDED, proved at the route against a real database
 * (workplan 0109 T1's second finding).
 *
 * WHY THE ROUTE AND NOT THE HELPER. `recordMappingStatusChange` is four lines
 * and would be green whether or not a single route called it — which is the
 * exact bug this repository has now been bitten by three times: a decision
 * computed correctly and dropped on the floor between the function and the
 * request. So this presses the routes and then reads `audit_log` directly,
 * outside any route, to see what really landed.
 *
 * The other half it proves is atomicity. The audit row is written inside the
 * SAME `withTenantDb` transaction as the status change, so a committed status
 * with no record of it is not a state this can reach. PGlite as `app_user`
 * runs the real transaction and the real RLS, so that is not taken on trust.
 *
 * UUID family 5f550000-…, unused elsewhere in the repo.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { MAPPING_STATUS_ACTION } from './mapping-status-audit.ts';

const TENANT = '5f550000-e29b-41d4-a716-446655441901';
const CONN = '5f550000-e29b-41d4-a716-446655441911';
const BOX = '5f550000-e29b-41d4-a716-446655441921';
const MAPPING = '5f550000-e29b-41d4-a716-446655441931';

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
// The start route enqueues a first pass; a real client would reach for a
// network. Answering keeps this file about the audit row and leaves the
// route's own enqueue-failure path alone rather than exercising it by accident.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({ trigger: () => Promise.resolve({ id: 'run-1' }) }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

interface AuditRow {
  actor: string;
  action: string;
  entity: string | null;
  detail: {
    mappingId?: string;
    from?: string;
    to?: string;
    via?: string;
    forced?: boolean;
  } | null;
}

/** Read audit_log directly — the only witness that cannot be faked by a route. */
async function auditRows(): Promise<AuditRow[]> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT actor, action, entity, detail FROM audit_log WHERE action = $1 ORDER BY at',
      [MAPPING_STATUS_ACTION],
    );
    return r.rows as unknown as AuditRow[];
  } finally {
    await conn.release();
  }
}

async function statusOf(): Promise<string> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT status FROM mailbox_mapping WHERE id = $1', [MAPPING]);
    return (r.rows[0] as { status: string }).status;
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'audited']);
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
  } finally {
    await conn.release();
  }
});

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query("UPDATE mailbox_mapping SET status = 'paused'");
    await conn.query('DELETE FROM audit_log WHERE action = $1', [MAPPING_STATUS_ACTION]);
  } finally {
    await conn.release();
  }
});

describe('starting a mapping records what it moved FROM', () => {
  it('writes one row naming from, to, who and how', async () => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(res.status).toBe(200);
    expect(await statusOf()).toBe('active');

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 'rob',
      action: MAPPING_STATUS_ACTION,
      // The KIND, with the id in the detail — the shape the other writers use.
      entity: 'mapping',
    });
    // `from` is the whole point: the timestamp fixed alongside this says WHEN
    // something changed and can never say what it changed from.
    expect(rows[0]?.detail).toMatchObject({
      mappingId: MAPPING,
      from: 'paused',
      to: 'active',
      via: 'start',
    });
  });

  it('a second start records NOTHING — idempotent is not an event', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    // An audit log that records non-events is one nobody reads, which makes
    // the events that matter harder to find rather than easier.
    expect(await auditRows()).toHaveLength(1);
  });
});

describe('updating a mapping records the transition, and only a transition', () => {
  it('records paused → cutover through the update route', async () => {
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'cutover' });
    expect(res.status).toBe(200);
    expect(await statusOf()).toBe('cutover');

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ from: 'paused', to: 'cutover', via: 'update' });
    expect(rows[0]?.actor).toBe('rob');
  });

  it('restating the status a mapping already has records nothing', async () => {
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect(await auditRows()).toEqual([]);
  });

  it('an update that carries no status at all records nothing', async () => {
    // The route also accepts mode and pattern. Neither is a lifecycle event,
    // and neither should cost a read of the previous status.
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ mode: 'mirror' });
    expect(res.status).toBe(200);
    expect(await auditRows()).toEqual([]);
  });
});

describe('finishing a mapping records it too — the transition T1 named', () => {
  // `operating-routes.ts` is mounted at the same prefix (`index.ts:447`), so
  // the finish route is reachable through the same app as the two above.
  it('records the move to done, with who finished it', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    expect(res.status).toBe(200);
    expect(await statusOf()).toBe('done');

    const rows = await auditRows();
    // Two events, in order: the start and the finish. The lifecycle reads back
    // out of the log, which is the whole point — "when did it end" was
    // unanswerable from any table before this, and "from what" still would be
    // with only a timestamp.
    expect(rows.map((r) => r.detail?.to)).toEqual(['active', 'done']);
    expect(rows[1]?.detail).toMatchObject({
      mappingId: MAPPING,
      from: 'active',
      to: 'done',
      via: 'finish',
    });
    expect(rows[1]?.actor).toBe('rob');
  });

  it('finishing an already-finished mapping records nothing more', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    const again = await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    expect(again.status).toBe(200);
    expect(await auditRows()).toHaveLength(2);
  });
});

describe('the record cannot outlive a failed change', () => {
  it('a status change to a mapping that does not exist records nothing', async () => {
    // Same transaction: the update matches no row, so there is nothing to
    // record, and the 404 leaves the log as it found it.
    const res = await request(app)
      .put('/api/migrations/5f550000-e29b-41d4-a716-4466554419ff')
      .send({ status: 'done' });
    expect(res.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });
});
