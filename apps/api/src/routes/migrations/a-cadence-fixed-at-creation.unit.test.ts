// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CADENCE FIXED AT CREATION (the owner, 2026-09-28: the schedule can be
 * changed on the migration page).
 *
 * The revision table has always said a schedule may change
 * (`config-revision.ts`: *"The next pass simply happens sooner or later"*),
 * and the update route did not write one. Its body parsed a `syncConfig`,
 * defaulted the data types in it to email, and dropped it. So the owner,
 * asking whether his hourly Dropbox migration could run every 15 minutes, had
 * one way to get there: a new migration.
 *
 * What these hold:
 *
 *  1. the update body reads a schedule, and only a schedule: a body that sent
 *     none no longer parses to a `syncConfig` claiming email;
 *  2. a schedule the tick cannot read is refused, in the words create uses;
 *  3. the schedule is put to the revision table, which permits it;
 *  4. against real rows, the route stores it, the detail route answers it, and
 *     nothing else on the migration moves. A refused one writes nothing.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { refusalsFor } from '@openmig/shared';

const TENANT = 'ca0e5c00-0928-41d4-a716-446655440201';
const DROPBOX_CONN = 'ca0e5c00-0928-41d4-a716-446655440211';
const DROPBOX_BOX = 'ca0e5c00-0928-41d4-a716-446655440221';
const MAPPING = 'ca0e5c00-0928-41d4-a716-446655440231';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: migrationRoutes, CreateMappingSchema, UpdateMappingSchema, proposedRevisions } = await import(
  './index.ts'
);

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

/** A Dropbox migration as the wizard posts it, on the schedule given. */
function createBody(schedule: string) {
  return {
    name: 'a Dropbox migration',
    sourceType: 'dropbox',
    targetType: 'nextcloud',
    sourceConfig: {
      username: 'dropbox',
      clientId: 'app-key',
      clientSecret: 'app-secret',
      refreshToken: 'a-refresh-token',
    },
    targetConfig: {
      url: 'https://cloud.example.invalid',
      username: 'a@example.invalid',
      password: 'x',
    },
    syncConfig: { domains: ['file'], schedule },
  };
}

type Parsed = {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
};

const scheduleIssues = (result: Parsed) =>
  (result.error?.issues ?? []).filter((i) => i.path.join('.') === 'syncConfig.schedule').map((i) => i.message);

describe('the update body', () => {
  it('reads a schedule, and only the schedule', () => {
    const parsed = UpdateMappingSchema.parse({ syncConfig: { schedule: '0 */6 * * *' } });
    expect(parsed.syncConfig).toEqual({ schedule: '0 */6 * * *' });
  });

  it('invents no syncConfig for a body that sent none', () => {
    // Create's shape defaults the data types to email, and zod applies that
    // default inside `.partial()` too: every pause and every export-format
    // save used to parse to a `syncConfig` claiming email, and the route
    // echoed it back.
    expect(UpdateMappingSchema.parse({ status: 'paused' })).not.toHaveProperty('syncConfig');
  });

  it('refuses a schedule the tick cannot read, in the words create uses', () => {
    const update = scheduleIssues(UpdateMappingSchema.safeParse({ syncConfig: { schedule: '61 * * * *' } }));
    const create = scheduleIssues(CreateMappingSchema.safeParse(createBody('61 * * * *')));
    expect(update).toHaveLength(1);
    expect(update[0]).toContain('The sync schedule is not a valid cron expression');
    expect(update).toEqual(create);
  });

  it('accepts each of the four cadences the screens offer', () => {
    for (const schedule of ['0 * * * *', '0 2 * * *', '0 */6 * * *', '*/15 * * * *']) {
      expect(scheduleIssues(UpdateMappingSchema.safeParse({ syncConfig: { schedule } })), schedule).toEqual([]);
    }
  });
});

describe('the revision table', () => {
  it('is asked about a schedule, and permits it', () => {
    const proposed = proposedRevisions(
      UpdateMappingSchema.parse({ syncConfig: { schedule: '*/15 * * * *' } }),
    );
    expect([...proposed]).toEqual(['schedule']);
    expect(refusalsFor(proposed)).toEqual([]);
  });

  it('is not asked about a schedule a body did not send', () => {
    expect(proposedRevisions(UpdateMappingSchema.parse({ status: 'paused' }))).toEqual([]);
  });
});

/** What the row holds, read past the route. */
async function rowOf(): Promise<{ schedule: string | null; status: string; o: unknown }> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT schedule, status, source_config_override AS o FROM mailbox_mapping WHERE id = $1',
      [MAPPING],
    );
    return r.rows[0] as { schedule: string | null; status: string; o: unknown };
  } finally {
    await conn.release();
  }
}

describe('the update route, against real rows', () => {
  beforeAll(async () => {
    // In the alpha, where every tier keeps every cadence: outside it, Free
    // refuses one faster than a day (workplan 0157 T4,
    // doors-that-know-the-pace), which is not this file's subject.
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    const conn = await driver.acquire();
    try {
      const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
      const secret = JSON.stringify(
        SecretStore.encryptCredentials({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }).encrypted,
      );
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'cadence']);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
         VALUES ($1,$2,'source','dropbox','d',$3::jsonb,'connected',$4)`,
        [DROPBOX_CONN, TENANT, JSON.stringify({ type: 'dropbox', rootPath: '/Werk' }), secret],
      );
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user','dropbox')`,
        [DROPBOX_BOX, TENANT, DROPBOX_CONN],
      );
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'paused')`,
        [MAPPING, TENANT, DROPBOX_BOX],
      );
    } finally {
      await conn.release();
    }
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await driver.end?.();
  });

  beforeEach(async () => {
    const conn = await driver.acquire();
    try {
      // Hourly, as the owner's was made, with the column beside it that says
      // where the migration is rooted: neither may move with a schedule.
      await conn.query(
        `UPDATE mailbox_mapping SET schedule = '0 * * * *', status = 'paused', source_config_override = $1::jsonb
          WHERE id = $2`,
        [JSON.stringify({ rootPath: '/Werk' }), MAPPING],
      );
    } finally {
      await conn.release();
    }
  });

  it('stores the new schedule, the detail route answers it, and nothing else moves', async () => {
    const res = await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ syncConfig: { schedule: '*/15 * * * *' } });
    expect(res.status).toBe(200);
    expect(res.body.syncConfig).toEqual({ schedule: '*/15 * * * *' });

    expect(await rowOf()).toEqual({ schedule: '*/15 * * * *', status: 'paused', o: { rootPath: '/Werk' } });

    const detail = await request(app).get(`/api/migrations/${MAPPING}`);
    expect(detail.status).toBe(200);
    expect(detail.body.syncConfig.schedule).toBe('*/15 * * * *');
  });

  it('refuses a schedule the tick cannot read, and writes nothing', async () => {
    const res = await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ syncConfig: { schedule: '61 * * * *' } });
    expect(res.status).toBe(400);
    const details = res.body.details as Array<{ path: string[]; message: string }>;
    expect(details.map((d) => d.path.join('.'))).toEqual(['syncConfig.schedule']);
    expect((await rowOf()).schedule).toBe('0 * * * *');
  });

  it('leaves the schedule alone when a save is about something else', async () => {
    const res = await request(app)
      .put(`/api/migrations/${MAPPING}`)
      .send({ sourceConfig: { nativeFilePolicies: { paper: 'markdown' } } });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('syncConfig');
    expect((await rowOf()).schedule).toBe('0 * * * *');
  });
});
