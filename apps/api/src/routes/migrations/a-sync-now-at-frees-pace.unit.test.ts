// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SYNC NOW AT FREE'S PACE (workplan 0157 T2).
 *
 * On Free a migration runs one pass a day, and the tick keeps it. *Sync now*
 * starts a pass without the tick, so on Free a press inside the day is refused
 * with the time of the next pass (`free-pace.ts`). Not the final pass before
 * the switch, not a paid tier, not during the alpha, and not once the day is
 * over.
 *
 * The real `POST /:mappingId/sync` over a real (in-process) ledger, with only
 * the Trigger.dev client replaced by a recorder, as `a-sync-now-that-waits-its-turn`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import { MANAGED_TIERS, PgDataAllowanceStore, runManagedMigrations } from '@openmig/managed';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';

// UUID family 0157b000-…, unused elsewhere in the repo.
const FREE = '0157b000-e29b-41d4-a716-446655440001';
const PAID = '0157b000-e29b-41d4-a716-446655440002';
const MAPPING = { [FREE]: '0157b000-e29b-41d4-a716-446655440031', [PAID]: '0157b000-e29b-41d4-a716-446655440032' };

let driver: LedgerDriver;
let signedIn = FREE;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: signedIn, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { enqueued } = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string) => {
          enqueued.push(taskId);
          return Promise.resolve({ id: `run-${enqueued.length}` });
        },
      },
    }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

/** One pass of the migration, started this many hours ago. */
async function passStarted(tenantId: string, hoursAgo: number): Promise<Date> {
  await sql('DELETE FROM run WHERE tenant_id = $1', [tenantId]);
  const startedAt = new Date(Date.now() - hoursAgo * 3_600_000);
  await sql(
    `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at, finished_at)
     VALUES ($1, $2, 'incremental', 'schedule', 'succeeded', $3, $3)`,
    [tenantId, MAPPING[tenantId as keyof typeof MAPPING], startedAt],
  );
  return startedAt;
}

const press = (tenantId: string, body: Record<string, unknown> = {}) => {
  signedIn = tenantId;
  return request(app).post(`/api/migrations/${MAPPING[tenantId as keyof typeof MAPPING]}/sync`).send(body);
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [tenantId, n] of [
    [FREE, '1'],
    [PAID, '2'],
  ] as const) {
    const conn = `0157b000-e29b-41d4-a716-44665544001${n}`;
    const box = `0157b000-e29b-41d4-a716-44665544002${n}`;
    await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenantId, `pace ${n}`]);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
      [conn, tenantId],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, tenantId, conn],
    );
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING[tenantId], tenantId, box],
    );
  }
  // A yes to Small and 200 GB moved: billed Small, a paid tier's pace.
  await withTenant(driver, PAID, (db) =>
    new PgDataAllowanceStore(db).record(
      PAID as TenantId,
      { kind: 'tier', tierId: 'small', bandGb: MANAGED_TIERS.find((t) => t.id === 'small')!.dataGb, priceEur: 5 },
      'someone@example.invalid',
    ),
  );
  await sql('INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, $2)', [PAID, 200_000_000_000]);
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

afterEach(() => {
  enqueued.length = 0;
  vi.unstubAllEnvs();
});

describe('Sync now on Free, outside the alpha', () => {
  it('is refused inside the day, with when the next pass starts, and starts nothing', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const started = await passStarted(FREE, 2);
    const res = await press(FREE);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'free_pace', nextPassAt: new Date(started.getTime() + 86_400_000).toISOString() });
    expect(res.body.message).toMatch(/one pass a day/);
    expect(enqueued).toEqual([]);
  });

  it('runs once the day is over', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    await passStarted(FREE, 25);
    expect((await press(FREE)).status).toBe(202);
    expect(enqueued).toEqual(['run-delta-sync']);
  });

  it('always runs the final pass before the switch, which Finish asks for', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    await passStarted(FREE, 2);
    expect((await press(FREE, { type: 'delta', final: true })).status).toBe(202);
    expect(enqueued).toEqual(['run-delta-sync']);
  });
});

describe('Sync now where the pace does not hold', () => {
  it('runs on Free during the alpha, when every tier runs at a paid tier’s pace', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    await passStarted(FREE, 2);
    expect((await press(FREE)).status).toBe(202);
  });

  it('runs on a paid tier inside the day', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    await passStarted(PAID, 2);
    expect((await press(PAID)).status).toBe(202);
  });
});
