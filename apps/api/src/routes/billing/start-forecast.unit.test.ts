// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `POST /api/billing/start-forecast` over a real database (PGlite): what Start
 * says before it starts (ADR-0014, *Amendment 2026-10-03*; workplan 0109 T6).
 *
 * The data already moved, plus what the preflight measured for the paths this
 * start adds, against the ceiling of the tier the start lands on. Pinned here:
 * only paths that have never run count as starting, their bytes are the
 * preflight's own for the data types the migration carries, a past-the-ceiling
 * answer names the next tier and the top-up, and the route writes nothing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant, PgDiscoveryStore } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import type { MappingId, TenantId } from '@openmig/shared';

const TENANT = '01960000-0000-4000-8000-000000000001';
const CONN = '01960000-0000-4000-8000-000000000011';
const BOX = '01960000-0000-4000-8000-000000000021';
const BOX_2 = '01960000-0000-4000-8000-000000000022';
const NEW_MAPPING = '01960000-0000-4000-8000-000000000031';
const RUNNING_MAPPING = '01960000-0000-4000-8000-000000000032';

let driver: LedgerDriver;
let role = 'owner';

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { userId: 'sub-owner', tenantId: TENANT, userRole: role });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: billingRoutes } = await import('./index.ts');
const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    conn.release();
  }
}

const GB = 1_000_000_000;

async function counted(mappingId: string, domain: 'email' | 'file', bytes: number | undefined): Promise<void> {
  await withTenant(driver, TENANT, (db) =>
    new PgDiscoveryStore(db).upsertDiscovery(TENANT as TenantId, mappingId as MappingId, domain, {
      collections: 1,
      items: 10,
      ...(bytes === undefined ? {} : { bytes }),
    }),
  );
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await q(`INSERT INTO tenant (id, name, status) VALUES ($1,'T','active')`, [TENANT]);
  await q(`INSERT INTO connection (id, tenant_id, role, kind, display_name) VALUES ($1,$2,'source','imap','i')`, [CONN, TENANT]);
  await q(`INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1,$2,$3,'a'), ($4,$2,$3,'b')`, [BOX, TENANT, CONN, BOX_2]);
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1,$2,$3,'paused'), ($4,$2,$5,'active')`,
    [NEW_MAPPING, TENANT, BOX, RUNNING_MAPPING, BOX_2],
  );
  for (const [mapping, domain] of [
    [NEW_MAPPING, 'email'],
    [NEW_MAPPING, 'file'],
    [RUNNING_MAPPING, 'email'],
  ] as const) {
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [TENANT, mapping, domain]);
  }
  // The running migration holds its slot; its data is already in the meter.
  await q(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at) VALUES ($1,$2,'email','active',now())`,
    [TENANT, RUNNING_MAPPING],
  );
  await counted(RUNNING_MAPPING, 'email', 5_000 * GB);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  role = 'owner';
  await q('DELETE FROM bytes_moved');
  await q('DELETE FROM migration_discovery WHERE mapping_id = $1', [NEW_MAPPING]);
});

const ask = (ids: string[] = [NEW_MAPPING, RUNNING_MAPPING]) =>
  request(app).post('/api/billing/start-forecast').send({ mappingIds: ids });

describe('POST /api/billing/start-forecast', () => {
  it('says nothing when the start fits the ceiling of the tier it lands on', async () => {
    // 1 running + 2 starting = 3 paths: Small, 750 GB. 100 + 200 GB fits.
    await q(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1,$2)`, [TENANT, 100 * GB]);
    await counted(NEW_MAPPING, 'email', 150 * GB);
    await counted(NEW_MAPPING, 'file', 50 * GB);
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ forecast: null });
  });

  it('names the next tier and the top-up when the start passes it, counting only the paths that start', async () => {
    await q(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1,$2)`, [TENANT, 600 * GB]);
    await counted(NEW_MAPPING, 'email', 150 * GB);
    await counted(NEW_MAPPING, 'file', 50 * GB);
    const res = await ask();
    expect(res.status).toBe(200);
    // The running migration's 5 TB preflight is NOT added: its data is in the meter.
    expect(res.body.forecast).toEqual({
      tier: { id: 'small', name: 'Small', dataGb: 750 },
      forecastGb: 800,
      ceilingGb: 750,
      next: { id: 'medium', name: 'Medium', monthlyCents: 1200 },
      topUpCents: 500,
    });
  });

  it('counts a data type without a size as nothing, as the amendment says the estimate must', async () => {
    await q(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1,$2)`, [TENANT, 700 * GB]);
    await counted(NEW_MAPPING, 'email', 40 * GB);
    await counted(NEW_MAPPING, 'file', undefined);
    expect((await ask()).body).toEqual({ forecast: null });
  });

  it('writes no billing mark: looking prices nothing', async () => {
    await counted(NEW_MAPPING, 'email', 900 * GB);
    const before = await q('SELECT * FROM occupancy_peak');
    expect((await ask()).body.forecast?.tier.id).toBe('small');
    expect(await q('SELECT * FROM occupancy_peak')).toEqual(before);
  });

  it('is for whoever may read billing, and refuses a body that names no migration', async () => {
    role = 'member';
    expect((await ask()).status).toBe(403);
    role = 'owner';
    expect((await ask([])).status).toBe(400);
    expect((await ask(['not-a-uuid'])).status).toBe(400);
  });
});
