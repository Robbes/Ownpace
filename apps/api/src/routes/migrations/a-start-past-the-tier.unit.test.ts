// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A START PAST THE AGREED TIER'S PATHS WAITS FOR THE YES (workplan 0109 T6,
 * the path axis; the owner's answers of 2026-10-04: one agreed tier for both
 * axes, the question at Start, enforced by the server).
 *
 * Pressed at the routes against a real database with every migration applied,
 * then read straight from `path_lifecycle` and `mailbox_mapping`, because a
 * refusal the route answered while the transaction kept the slots would be
 * the worst of both: a customer told no, and billed as yes.
 *
 * What is held:
 *  - on Free, with five kinds held already, a start of two more is refused,
 *    names Medium, and keeps nothing: no slot, no status, no record of a
 *    change;
 *  - with a yes to Medium on record, the same start goes ahead;
 *  - during the alpha, nothing is asked;
 *  - a start that takes no new slot is never refused, though the organisation
 *    is past its tier already;
 *  - a kind added to a running migration is refused the same way, and the kind
 *    is not kept;
 *  - another organisation's slots are not this one's.
 *
 * UUID family 0109f600-…, unused elsewhere in the repo.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { MANAGED_TIERS, runManagedMigrations } from '@openmig/managed';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';
import { PathsNeedAYes, activateAddedPath } from './path-lifecycle-wiring.ts';

const TENANT = '0109f600-e29b-41d4-a716-446655440001';
const OTHER = '0109f600-e29b-41d4-a716-446655440002';
const CONN = '0109f600-e29b-41d4-a716-446655440011';
const BOX = '0109f600-e29b-41d4-a716-446655440021';
const MAPPING = '0109f600-e29b-41d4-a716-446655440031';
/** Another of the organisation's migrations, that ran and was paused with all five kinds: five slots held. */
const HOLDING = '0109f600-e29b-41d4-a716-446655440033';
const OTHER_CONN = '0109f600-e29b-41d4-a716-446655440012';
const OTHER_BOX = '0109f600-e29b-41d4-a716-446655440022';
const OTHER_MAPPING = '0109f600-e29b-41d4-a716-446655440032';

const first = MANAGED_TIERS[0]!;
const medium = MANAGED_TIERS.find((t) => t.id === 'medium')!;

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
// Start enqueues a first pass; answering keeps this file about the slots.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getTriggerClient: () => ({ tasks: { trigger: () => Promise.resolve({ id: 'run-1' }) } }) };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

/** As the owner: PGlite's raw connection bypasses row security, for seeding and reading back. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

const paths = async (mappingId = MAPPING) =>
  (await owner('SELECT domain, state FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain', [mappingId]))
    .rows as Array<{ domain: string; state: string }>;
const status = async (mappingId = MAPPING) =>
  ((await owner('SELECT status FROM mailbox_mapping WHERE id = $1', [mappingId])).rows[0] as { status: string })
    .status;
const yesTo = (tierId: string, tenantId = TENANT) =>
  owner(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', $2, 1, 0, 'earlier')`,
    [tenantId, tierId],
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  const secret = JSON.stringify(
    SecretStore.encryptCredentials({ username: 'a@example.invalid', password: 'p' }).encrypted,
  );
  for (const [tenant, conn, box, mapping] of [
    [TENANT, CONN, BOX, MAPPING],
    [OTHER, OTHER_CONN, OTHER_BOX, OTHER_MAPPING],
  ] as const) {
    await owner('INSERT INTO tenant (id, name) VALUES ($1, $2)', [tenant, `org ${tenant.slice(-2)}`]);
    await owner(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected', $3)`,
      [conn, tenant, secret],
    );
    await owner(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1, $2, $3, 'user', 'm@example.invalid')`,
      [box, tenant, conn],
    );
    await owner(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'paused')`,
      [mapping, tenant, box],
    );
  }
  await owner(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'paused')`,
    [HOLDING, TENANT, BOX],
  );
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  delete process.env.OWNPACE_STAGE;
  await owner('DELETE FROM data_allowance');
  await owner('DELETE FROM path_lifecycle');
  await owner('DELETE FROM occupancy_peak');
  await owner('DELETE FROM scope_selection');
  await owner(`DELETE FROM audit_log WHERE action = 'mapping.status'`);
  await owner(`UPDATE mailbox_mapping SET status = 'paused'`);
  // Every data type held already, paused, which holds a slot: five, one short of Free's six.
  for (const domain of DISCOVERY_DOMAINS) {
    await owner(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      HOLDING,
      domain,
    ]);
    await owner(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, 'paused', now())`,
      [TENANT, HOLDING, domain],
    );
  }
  // Two kinds at once, beside the five held: past Free's six.
  await owner(
    `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
     VALUES ($1, $2, 'email', true), ($1, $2, 'calendar', true)`,
    [TENANT, MAPPING],
  );
});

afterEach(() => {
  delete process.env.OWNPACE_STAGE;
});

describe('Start, past the agreed tier', () => {
  it('is refused with the numbers and the tier that runs them, and keeps nothing', async () => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'paths_need_a_yes',
      tier: { id: first.id, paths: first.paths },
      after: 7,
      needs: { id: 'medium', name: medium.name, paths: medium.paths },
    });
    expect(res.body.reason).toContain('7 migrations at the same time');
    // Rolled back whole: no slot, no status, no record of a change.
    expect(await paths()).toEqual([]);
    expect(await status()).toBe('paused');
    const changes = await owner(`SELECT 1 FROM audit_log WHERE action = 'mapping.status'`);
    expect(changes.rows).toEqual([]);
  });

  it('goes ahead once the organisation has said yes to a tier that runs it', async () => {
    await yesTo('medium');
    const res = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(res.status).toBe(200);
    expect(await paths()).toEqual([
      { domain: 'calendar', state: 'active' },
      { domain: 'email', state: 'active' },
    ]);
  });

  it('asks nothing during the alpha (the owner, 2026-10-03: "A")', async () => {
    process.env.OWNPACE_STAGE = 'alpha';
    expect((await request(app).post(`/api/migrations/${MAPPING}/start`).send({})).status).toBe(200);
    expect(await paths()).toHaveLength(2);
  });

  it('never refuses a start that takes no new slot, though the organisation is past its tier', async () => {
    // Paused holds its slot: an organisation that started both during the
    // alpha, on Free, holds seven with the five beside them; it resumes them,
    // and no slot is added.
    await owner(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, 'email', 'paused', now()), ($1, $2, 'calendar', 'paused', now())`,
      [TENANT, MAPPING],
    );
    expect((await request(app).post(`/api/migrations/${MAPPING}/start`).send({})).status).toBe(200);
    expect((await paths()).map((p) => p.state)).toEqual(['active', 'active']);
  });

  it("counts this organisation's slots, never another's", async () => {
    await owner(
      `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, 'email', true)`,
      [OTHER, OTHER_MAPPING],
    );
    await owner(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, 'email', 'active', now())`,
      [OTHER, OTHER_MAPPING],
    );
    await owner(`DELETE FROM scope_selection WHERE mapping_id = $1 AND domain = 'calendar'`, [MAPPING]);
    // One kind here beside the five held, on Free: six fit, whatever the other organisation runs.
    expect((await request(app).post(`/api/migrations/${MAPPING}/start`).send({})).status).toBe(200);
  });
});

describe('a kind added to a running migration, past the agreed tier', () => {
  it('is refused the same way, and the kind is not kept', async () => {
    await owner(`DELETE FROM scope_selection WHERE mapping_id = $1 AND domain = 'calendar'`, [MAPPING]);
    process.env.OWNPACE_STAGE = 'alpha';
    expect((await request(app).post(`/api/migrations/${MAPPING}/start`).send({})).status).toBe(200);
    delete process.env.OWNPACE_STAGE;

    // The route's own transaction, as the add-a-kind door runs it: the scope
    // row, then the slot. The refusal takes both back.
    await expect(
      withTenant(driver, TENANT, async (db) => {
        await db.execute(
          sql`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES (${TENANT}, ${MAPPING}, 'calendar', true)`,
        );
        await activateAddedPath(db, TENANT, MAPPING, 'calendar');
      }),
    ).rejects.toBeInstanceOf(PathsNeedAYes);
    const kinds = await owner(`SELECT domain FROM scope_selection WHERE mapping_id = $1`, [MAPPING]);
    expect(kinds.rows).toEqual([{ domain: 'email' }]);
    expect(await paths()).toEqual([{ domain: 'email', state: 'active' }]);
  });
});

describe('the record of a yes says which limit asked (managed 0039)', () => {
  it('is a data yes unless it says otherwise, and is one of the two', async () => {
    await yesTo('small');
    expect((await owner('SELECT axis FROM data_allowance')).rows).toEqual([{ axis: 'data' }]);
    await expect(
      owner(
        `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by, axis)
         VALUES ($1, 'tier', 'small', 1, 0, 'x', 'mood')`,
        [TENANT],
      ),
    ).rejects.toThrow(/data_allowance_axis_check/);
  });
});
