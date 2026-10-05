// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VISIT BRINGS BACK THE HOUR (workplan 0157 T7): the API's half.
 *
 * A migration with no schedule of its own looks every hour for 14 days from
 * the later of its first copy and its last visit (`automaticScheduleFor`; the
 * tick's half has its own tests). A visit is the page opened or *Sync now*
 * pressed (`visits.ts`):
 *
 *  1. opening the page records one, at most once an hour, and only for a
 *     migration of the organisation that opens it;
 *  2. a press of *Sync now* that starts a pass records one too;
 *  3. *Automatic* is saved as no schedule at all, which is what the tick reads
 *     as the automatic cadence; a cron is still read and refused as before.
 *
 * The real routes over a real (in-process) ledger, both chains applied, with
 * only the Trigger.dev client replaced by a recorder.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 0157e000-…, unused elsewhere in the repo.
const P = '0157e000-e29b-41d4-a716-4466554400';
const ORG = `${P}01`;
const OTHER = `${P}02`;
const MAPPING = `${P}11`;
const OTHERS_MAPPING = `${P}12`;

let driver: LedgerDriver;
let signedIn = ORG;

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

async function sql<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

const visitOf = async (mappingId: string): Promise<Date | null> => {
  const [row] = await sql<{ visited_at: string | Date }>(
    'SELECT visited_at FROM migration_visit WHERE mapping_id = $1',
    [mappingId],
  );
  return row ? new Date(row.visited_at) : null;
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [tenantId, mappingId, n] of [
    [ORG, MAPPING, '1'],
    [OTHER, OTHERS_MAPPING, '2'],
  ] as const) {
    await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [tenantId, `visits ${n}`]);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
      [`${P}2${n}`, tenantId],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [`${P}3${n}`, tenantId, `${P}2${n}`],
    );
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, schedule)
       VALUES ($1, $2, $3, 'active', '0 * * * *')`,
      [mappingId, tenantId, `${P}3${n}`],
    );
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  enqueued.length = 0;
  signedIn = ORG;
  await sql('DELETE FROM migration_visit');
});

describe("opening the migration's page", () => {
  it('records a visit', async () => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/visit`);
    expect(res.status).toBe(204);
    expect(await visitOf(MAPPING)).not.toBeNull();
  });

  it('moves it at most once an hour', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    await sql('INSERT INTO migration_visit (mapping_id, tenant_id, visited_at) VALUES ($1, $2, $3)', [
      MAPPING,
      ORG,
      tenMinutesAgo,
    ]);
    await request(app).post(`/api/migrations/${MAPPING}/visit`).expect(204);
    expect((await visitOf(MAPPING))!.toISOString()).toBe(tenMinutesAgo.toISOString());

    await sql('UPDATE migration_visit SET visited_at = $2 WHERE mapping_id = $1', [MAPPING, twoHoursAgo]);
    await request(app).post(`/api/migrations/${MAPPING}/visit`).expect(204);
    expect((await visitOf(MAPPING))!.getTime()).toBeGreaterThan(twoHoursAgo.getTime() + 3_600_000);
  });

  it("is 404 for another organisation's migration, and records nothing", async () => {
    const res = await request(app).post(`/api/migrations/${OTHERS_MAPPING}/visit`);
    expect(res.status).toBe(404);
    expect(await visitOf(OTHERS_MAPPING)).toBeNull();
  });
});

describe('Sync now', () => {
  it('records a visit when it starts a pass', async () => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/sync`).send({});
    expect(res.status).toBe(202);
    expect(enqueued).toEqual(['run-delta-sync']);
    expect(await visitOf(MAPPING)).not.toBeNull();
  });
});

describe('Automatic, saved on the migration page', () => {
  it('is no schedule at all, which the tick reads as the automatic cadence', async () => {
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ syncConfig: { schedule: null } });
    expect(res.status).toBe(200);
    expect(res.body.syncConfig).toEqual({ schedule: null });
    const [row] = await sql<{ schedule: string | null }>('SELECT schedule FROM mailbox_mapping WHERE id = $1', [
      MAPPING,
    ]);
    expect(row!.schedule).toBeNull();
  });

  it('a cron is still stored as written, and one faster than the floor still refused', async () => {
    // In the alpha, where Free keeps every cadence: outside it, a cron faster
    // than a day is refused on Free (0157 T4, doors-that-know-the-pace).
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ syncConfig: { schedule: '0 */6 * * *' } })
      .expect(200);
    const [row] = await sql<{ schedule: string | null }>('SELECT schedule FROM mailbox_mapping WHERE id = $1', [
      MAPPING,
    ]);
    expect(row!.schedule).toBe('0 */6 * * *');
    const refused = await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ syncConfig: { schedule: '* * * * *' } });
    expect(refused.status).toBe(400);
  });
});
