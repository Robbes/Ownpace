// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DOORS KNOW THE PACE (workplan 0157 T4).
 *
 * On Free, outside the alpha, a migration runs one pass a day whatever its
 * schedule (T2, the tick). The doors that set how often it runs, or start a
 * pass without the tick, keep that too (`free-pace.ts`):
 *
 *  1. a schedule faster than a day is refused at create and on the migration
 *     page, with the code the page words it by; Daily and Automatic (no
 *     schedule) are not;
 *  2. *Start* on a paused migration that ran inside the day activates it, and
 *     its pass waits for the pace, with when it starts; one that never ran
 *     starts at once;
 *  3. the migration's detail says the pace, which the page's chooser follows;
 *  4. none of it on a paid tier, nor during the alpha.
 *
 * The real routes over a real (in-process) ledger, both chains applied, with
 * only the Trigger.dev client replaced by a recorder.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import { MANAGED_TIERS, PgDataAllowanceStore, runManagedMigrations } from '@openmig/managed';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';

// UUID family 0157f000-…, unused elsewhere in the repo.
const P = '0157f000-e29b-41d4-a716-4466554400';
const FREE = `${P}01`;
const PAID = `${P}02`;
const BOX = { [FREE]: `${P}21`, [PAID]: `${P}22` } as const;
const RAN = { [FREE]: `${P}31`, [PAID]: `${P}32` } as const;
const PAUSED_RAN = `${P}41`;
const PAUSED_NEVER = `${P}42`;

let driver: LedgerDriver;
let signedIn: string = FREE;

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

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 3_600_000);

async function mapping(tenantId: string, id: string, status: string, schedule: string | null): Promise<void> {
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, schedule) VALUES ($1, $2, $3, $4, $5)`,
    [id, tenantId, BOX[tenantId as keyof typeof BOX], status, schedule],
  );
  await sql(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, 'email', true)`, [
    tenantId,
    id,
  ]);
}

async function ran(tenantId: string, mappingId: string, at: Date): Promise<void> {
  await sql(
    `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at, finished_at)
     VALUES ($1, $2, 'incremental', 'schedule', 'succeeded', $3, $3)`,
    [tenantId, mappingId, at],
  );
}

let created = 0;
/** A create as the API takes one, a new pair of accounts each time. */
function create(schedule?: string) {
  created += 1;
  const account = `pace-${created}@example.invalid`;
  return request(app)
    .post('/api/migrations')
    .send({
      name: `migration ${created}`,
      sourceType: 'imap',
      targetType: 'jmap',
      sourceConfig: { host: 'src.example.invalid', port: 993, username: account, password: 'p' },
      targetConfig: { host: 'dst.example.invalid', port: 443, username: account, password: 'p' },
      syncConfig: { domains: ['email'], ...(schedule === undefined ? {} : { schedule }) },
    });
}

const scheduleOf = async (id: string) =>
  (await sql<{ schedule: string | null }>('SELECT schedule FROM mailbox_mapping WHERE id = $1', [id]))[0]!.schedule;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [tenantId, n] of [
    [FREE, '1'],
    [PAID, '2'],
  ] as const) {
    await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [tenantId, `pace doors ${n}`]);
    await sql(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
      [`${P}1${n}`, tenantId],
    );
    await sql(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [BOX[tenantId], tenantId, `${P}1${n}`],
    );
    await mapping(tenantId, RAN[tenantId], 'active', '0 2 * * *');
    await ran(tenantId, RAN[tenantId], TWO_HOURS_AGO);
  }
  await mapping(FREE, PAUSED_RAN, 'paused', null);
  await ran(FREE, PAUSED_RAN, TWO_HOURS_AGO);
  await mapping(FREE, PAUSED_NEVER, 'paused', null);
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
  signedIn = FREE;
  vi.unstubAllEnvs();
});

describe('a schedule faster than the pace, on Free outside the alpha', () => {
  it('is refused at create, with the code the page words it by, and nothing is made', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const before = (await sql('SELECT id FROM mailbox_mapping WHERE tenant_id = $1', [FREE])).length;
    const res = await create('0 * * * *');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'free_pace_schedule', leastMinutesBetweenPasses: 1440 });
    expect(res.body.message).toMatch(/once a day/);
    expect((await sql('SELECT id FROM mailbox_mapping WHERE tenant_id = $1', [FREE])).length).toBe(before);
  });

  it('is refused on the migration page, and the stored schedule stays', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const res = await request(app).put(`/api/migrations/${RAN[FREE]}`).send({ syncConfig: { schedule: '0 */6 * * *' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('free_pace_schedule');
    expect(await scheduleOf(RAN[FREE])).toBe('0 2 * * *');
  });

  it('Daily and Automatic are not refused, at either door', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    expect((await create('0 2 * * *')).status).toBe(201);
    expect((await create()).status).toBe(201);
    await request(app).put(`/api/migrations/${RAN[FREE]}`).send({ syncConfig: { schedule: null } }).expect(200);
    expect(await scheduleOf(RAN[FREE])).toBeNull();
    await request(app).put(`/api/migrations/${RAN[FREE]}`).send({ syncConfig: { schedule: '0 2 * * *' } }).expect(200);
    expect(await scheduleOf(RAN[FREE])).toBe('0 2 * * *');
  });
});

describe('where the pace does not hold a schedule', () => {
  it('a paid tier keeps every cadence', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    signedIn = PAID;
    await request(app).put(`/api/migrations/${RAN[PAID]}`).send({ syncConfig: { schedule: '0 * * * *' } }).expect(200);
    expect(await scheduleOf(RAN[PAID])).toBe('0 * * * *');
  });

  it('during the alpha, Free keeps every cadence too', async () => {
    // Through the migration page's door: a create in the alpha first asks for
    // the Alpha conditions to be accepted (0139 T3), which is not this test's.
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    await request(app).put(`/api/migrations/${RAN[FREE]}`).send({ syncConfig: { schedule: '*/15 * * * *' } }).expect(200);
    expect(await scheduleOf(RAN[FREE])).toBe('*/15 * * * *');
    await request(app).put(`/api/migrations/${RAN[FREE]}`).send({ syncConfig: { schedule: '0 2 * * *' } }).expect(200);
  });
});

describe('Start on a paused migration, on Free outside the alpha', () => {
  it('activates one that ran inside the day, and its pass waits for the pace, saying when', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const res = await request(app).post(`/api/migrations/${PAUSED_RAN}/start`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'active', activated: true });
    expect(res.body.firstRun).toMatchObject({
      queued: false,
      nextPassAt: new Date(TWO_HOURS_AGO.getTime() + 86_400_000).toISOString(),
    });
    expect(enqueued).toEqual([]);
  });

  it('starts one that never ran at once: the first pass follows the preflight', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const res = await request(app).post(`/api/migrations/${PAUSED_NEVER}/start`);
    expect(res.status).toBe(200);
    expect(res.body.firstRun).toMatchObject({ queued: true });
    expect(enqueued).toEqual(['run-delta-sync']);
  });
});

describe("the migration's detail says the pace", () => {
  it('on Free: a day between passes, and when the next one starts', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const res = await request(app).get(`/api/migrations/${RAN[FREE]}`);
    expect(res.status).toBe(200);
    expect(res.body.pace).toEqual({
      leastMinutesBetweenPasses: 1440,
      nextPassAt: new Date(TWO_HOURS_AGO.getTime() + 86_400_000).toISOString(),
    });
  });

  it('on a paid tier, and on Free during the alpha: no floor of its own', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    signedIn = PAID;
    expect((await request(app).get(`/api/migrations/${RAN[PAID]}`)).body.pace).toEqual({
      leastMinutesBetweenPasses: 0,
      nextPassAt: null,
    });
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    signedIn = FREE;
    expect((await request(app).get(`/api/migrations/${RAN[FREE]}`)).body.pace).toEqual({
      leastMinutesBetweenPasses: 0,
      nextPassAt: null,
    });
  });
});

describe("the organisation's pace, for the pages that list its migrations (0157 T5)", () => {
  it('on Free: a day between passes, and the next pass of each migration that ran inside the day', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    const res = await request(app).get('/api/migrations/pace');
    expect(res.status).toBe(200);
    expect(res.body.leastMinutesBetweenPasses).toBe(1440);
    expect(res.body.nextPassAt[RAN[FREE]]).toBe(new Date(TWO_HOURS_AGO.getTime() + 86_400_000).toISOString());
    // Never another organisation's migrations, and none that never ran.
    expect(res.body.nextPassAt[RAN[PAID]]).toBeUndefined();
    expect(res.body.nextPassAt[PAUSED_NEVER]).toBeUndefined();
  });

  it('on a paid tier, and during the alpha: no pace, and no next pass to say', async () => {
    vi.stubEnv('OWNPACE_STAGE', '');
    signedIn = PAID;
    expect((await request(app).get('/api/migrations/pace')).body).toEqual({
      leastMinutesBetweenPasses: 0,
      nextPassAt: {},
    });
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    signedIn = FREE;
    expect((await request(app).get('/api/migrations/pace')).body).toEqual({
      leastMinutesBetweenPasses: 0,
      nextPassAt: {},
    });
  });
});
