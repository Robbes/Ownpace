// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MIGRATION PAST THE CAP (workplan 0143 T2a, the alpha minimum).
 *
 * Every tester's migrations run on one machine, and nothing limited how many
 * one organisation could create. The organisation's own `settings.maxMappings`
 * looked like a limit and limited nothing. Through the real routes, against
 * PGlite as `app_user`:
 *
 * - the migration one past the cap is refused, 409, with the sentence, and
 *   nothing is written for it: no migration and no connection;
 * - a draft counts, and so does every other status but `done`; a finished
 *   migration does not, and another organisation's do not;
 * - the number is the deployment's: `MAX_MIGRATIONS_PER_ORGANISATION` moves it,
 *   and a value it cannot read is refused, never replaced by the default;
 * - an owner's `PUT /api/tenants/:id` with `settings.maxMappings` leaves
 *   `settings` without it.
 *
 * The plan names this guard as an integration test. The routes are proved
 * here, on PGlite like the other route guards. The lock, which needs two
 * connections to show a race, is `a-migration-past-the-cap.integration.test.ts`.
 *
 * It fails today on both halves: the sixth migration is created, and the
 * generic update stores `maxMappings`.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import {
  DEFAULT_MAX_MIGRATIONS_PER_ORGANISATION,
  maxMigrationsPerOrganisationFromEnv,
  pastTheCap,
} from './migration-cap.ts';

const TENANT = '0143ca90-5d2e-4c1a-8b7f-3e9d6a2c1001';
const OTHER = '0143ca90-5d2e-4c1a-8b7f-3e9d6a2c1002';
const CONN = '0143ca90-5d2e-4c1a-8b7f-3e9d6a2c1011';
const OTHER_CONN = '0143ca90-5d2e-4c1a-8b7f-3e9d6a2c1012';
const BOX = '0143ca90-5d2e-4c1a-8b7f-3e9d6a2c1021';
const OTHER_BOX = '0143ca90-5d2e-4c1a-8b7f-3e9d6a2c1022';

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

const { default: migrationRoutes } = await import('./index.ts');
const { default: tenantRoutes } = await import('../tenants/index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);
app.use('/api/tenants', tenantRoutes);

/** One statement outside any route, as the owner: the witness no route can fake. */
async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as T[];
  } finally {
    await conn.release();
  }
}

/** Migrations already there, one per status given, on the organisation's own mailbox. */
async function existing(tenantId: string, box: string, statuses: string[]): Promise<void> {
  for (const status of statuses) {
    await q(`INSERT INTO mailbox_mapping (tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3)`, [
      tenantId,
      box,
      status,
    ]);
  }
}

const count = async (table: 'mailbox_mapping' | 'connection'): Promise<number> =>
  Number((await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [TENANT]))[0]!.n);

let created = 0;
/** The wizard's create, for a new pair of accounts each time so no two are the same migration. */
function create() {
  created += 1;
  const account = `tester-${created}@example.invalid`;
  return request(app)
    .post('/api/migrations')
    .send({
      name: `migration ${created}`,
      sourceType: 'imap',
      targetType: 'jmap',
      sourceConfig: { host: 'src.example.invalid', port: 993, username: account, password: 'p' },
      targetConfig: { host: 'dst.example.invalid', port: 443, username: account, password: 'p' },
      syncConfig: { domains: ['email'] },
    });
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  for (const [tenant, conn, box] of [
    [TENANT, CONN, BOX],
    [OTHER, OTHER_CONN, OTHER_BOX],
  ] as const) {
    await q('INSERT INTO tenant (id, name) VALUES ($1, $2)', [tenant, 'Capped']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
      [conn, tenant],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'seeded@example.invalid')`,
      [box, tenant, conn],
    );
  }
  // The full migration chain on a fresh cluster; see `mapping-status-audit`.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  delete process.env.MAX_MIGRATIONS_PER_ORGANISATION;
  await q('DELETE FROM mailbox_mapping');
});

afterEach(() => {
  delete process.env.MAX_MIGRATIONS_PER_ORGANISATION;
});

describe('creating a migration', () => {
  it('is refused one past the cap, with the sentence, and nothing is written for it', async () => {
    // A draft, a running one, one in its cutover and one in the lane after it:
    // four that are not finished, so the fifth is the last one allowed.
    await existing(TENANT, BOX, ['paused', 'active', 'cutover', 'continuous']);
    expect((await create()).status).toBe(201);

    const connections = await count('connection');
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'migration_cap', unfinished: 5, cap: 5 });
    expect(res.body.message).toBe(pastTheCap(5, 5));
    expect(res.body.message).toBe(
      'This organisation has 5 migrations that are not finished, and may have 5 at once. ' +
        'Finish or delete one before you add another, or ask whoever runs this service for more.',
    );
    // Refused before anything was written, not after.
    expect(await count('mailbox_mapping')).toBe(5);
    expect(await count('connection')).toBe(connections);
  });

  it('does not count a finished migration', async () => {
    // Four that are not finished and three that are: the fifth is allowed,
    // and the three finished ones do not make it the eighth.
    await existing(TENANT, BOX, ['paused', 'active', 'active', 'active', 'done', 'done', 'done']);
    expect((await create()).status).toBe(201);
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ unfinished: 5, cap: 5 });
  });

  it('does not count another organisation’s', async () => {
    await existing(OTHER, OTHER_BOX, ['active', 'active', 'active', 'active', 'active']);
    expect((await create()).status).toBe(201);
  });
});

describe('the cap is the deployment’s', () => {
  it('is five unless MAX_MIGRATIONS_PER_ORGANISATION says otherwise', () => {
    expect(DEFAULT_MAX_MIGRATIONS_PER_ORGANISATION).toBe(5);
    expect(maxMigrationsPerOrganisationFromEnv(undefined)).toBe(5);
    expect(maxMigrationsPerOrganisationFromEnv('')).toBe(5);
    expect(maxMigrationsPerOrganisationFromEnv(' ')).toBe(5);
    expect(maxMigrationsPerOrganisationFromEnv('12')).toBe(12);
  });

  it('refuses a value it cannot read, naming it, rather than holding the default', () => {
    for (const raw of ['0', '-1', '2.5', 'ten']) {
      expect(() => maxMigrationsPerOrganisationFromEnv(raw), raw).toThrow(
        `MAX_MIGRATIONS_PER_ORGANISATION must be a whole number, at least 1 — got "${raw}"`,
      );
    }
  });

  it('is what the create route holds', async () => {
    process.env.MAX_MIGRATIONS_PER_ORGANISATION = '2';
    await existing(TENANT, BOX, ['paused']);
    expect((await create()).status).toBe(201);
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(pastTheCap(2, 2));

    // And one it cannot read creates nothing, rather than five.
    process.env.MAX_MIGRATIONS_PER_ORGANISATION = 'ten';
    await q('DELETE FROM mailbox_mapping');
    expect((await create()).status).toBe(500);
    expect(await count('mailbox_mapping')).toBe(0);
  });
});

describe('the organisation’s own limits, which limited nothing', () => {
  it('are no longer stored by the generic update', async () => {
    await q(`UPDATE tenant SET settings = '{"slug":"capped"}'::jsonb WHERE id = $1`, [TENANT]);
    const res = await request(app)
      .put(`/api/tenants/${TENANT}`)
      .send({ settings: { maxMappings: 50, maxUsers: 50 } });
    expect(res.status).toBe(200);
    const [row] = await q<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM tenant WHERE id = $1',
      [TENANT],
    );
    expect(row!.settings).toEqual({ slug: 'capped' });
  });

  it('leave the rename working', async () => {
    const res = await request(app).put(`/api/tenants/${TENANT}`).send({ name: 'Capped Again' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Capped Again');
  });
});
