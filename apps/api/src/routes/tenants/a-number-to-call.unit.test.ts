// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NUMBER TO CALL (workplan 0108 T8a, the owner's decision of 2026-09-23).
 *
 * *"If there is no phone number, then add it, but leave optional: we show it
 * at grant-migration-page, but it's not required to have in the tenant
 * profile."* The organisation sets it here; the grant page shows it to the
 * people it asks.
 *
 * Against a real database (PGlite as `app_user`), and the stored settings are
 * read directly after every call, because the claims are about what is stored:
 * a number is merged in beside the other settings, a cleared one is removed,
 * and anything that is not a phone number is refused with nothing written.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';

// UUID family 5f600000-…, unused elsewhere in the repo.
const TENANT = '5f600000-e29b-41d4-a716-446655441901';

let driver: LedgerDriver;
/** Set per test — the session `authenticate` pretends to have verified. */
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    // The only stubs: a caller with a tenant and a role, and the database.
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!caller.tenantId) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: tenantRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/tenants', tenantRoutes);

/** The tenant's settings as stored, read outside any route. */
async function storedSettings(): Promise<Record<string, unknown>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query('SELECT settings FROM tenant WHERE id = $1', [TENANT]);
    return (r.rows[0] as { settings: Record<string, unknown> }).settings;
  } finally {
    await conn.release();
  }
}

const OTHER_SETTINGS = { slug: 'acme', notifications: { digest: 'weekly', locale: 'nl' } };

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query('INSERT INTO tenant (id, name, settings) VALUES ($1,$2,$3::jsonb)', [
      TENANT,
      'Acme Legal',
      JSON.stringify(OTHER_SETTINGS),
    ]);
  } finally {
    await conn.release();
  }
  // 120s for the reason every PGlite fixture here carries it: the whole
  // migration chain runs before the first test, and a loaded runner is slow.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  caller = { tenantId: TENANT, userId: 'owner-1', userRole: 'owner' };
  const conn = await driver.acquire();
  try {
    await conn.query('UPDATE tenant SET settings = $2::jsonb WHERE id = $1', [
      TENANT,
      JSON.stringify(OTHER_SETTINGS),
    ]);
  } finally {
    await conn.release();
  }
});

describe('PUT /api/tenants/:id/contact', () => {
  it('stores the number beside every other setting, and answers what it stored', async () => {
    const res = await request(app)
      .put(`/api/tenants/${TENANT}/contact`)
      .send({ phone: '  +31 20   123 4567 ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contact: { phone: '+31 20 123 4567' } });
    expect(await storedSettings()).toEqual({ ...OTHER_SETTINGS, contactPhone: '+31 20 123 4567' });
  });

  it('removes it when it is cleared — the field is optional', async () => {
    await request(app).put(`/api/tenants/${TENANT}/contact`).send({ phone: '0612345678' });
    for (const cleared of [null, '', '   ']) {
      const res = await request(app).put(`/api/tenants/${TENANT}/contact`).send({ phone: cleared });
      expect(res.status).toBe(200);
      expect(res.body.contact.phone).toBeNull();
      expect(await storedSettings()).toEqual(OTHER_SETTINGS);
    }
  });

  it('refuses a sentence dressed as a number, says why, and writes nothing', async () => {
    const res = await request(app)
      .put(`/api/tenants/${TENANT}/contact`)
      .send({ phone: 'Call IT on 020 123 4567' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_a_phone_number');
    // Both shapes this API answers in, so every screen can show the sentence.
    expect(res.body.message).toMatch(/digits, spaces and \+/);
    expect(res.body.reason).toBe(res.body.message);
    expect(await storedSettings()).toEqual(OTHER_SETTINGS);
  });

  it('refuses a body that does not say { phone }', async () => {
    const res = await request(app).put(`/api/tenants/${TENANT}/contact`).send({ number: '0612345678' });
    expect(res.status).toBe(400);
    expect(await storedSettings()).toEqual(OTHER_SETTINGS);
  });

  it('lets only an owner or an admin set it', async () => {
    for (const userRole of ['member', 'viewer']) {
      caller = { tenantId: TENANT, userId: 'someone', userRole };
      const res = await request(app).put(`/api/tenants/${TENANT}/contact`).send({ phone: '0612345678' });
      expect(res.status, userRole).toBe(403);
    }
    caller = { tenantId: TENANT, userId: 'admin-1', userRole: 'admin' };
    const res = await request(app).put(`/api/tenants/${TENANT}/contact`).send({ phone: '0612345678' });
    expect(res.status).toBe(200);
  });

  it('cannot be set through the generic settings update, which keeps its two keys', async () => {
    // The dedicated route is the only door, so the only check is its check.
    await request(app)
      .put(`/api/tenants/${TENANT}`)
      .send({ settings: { maxUsers: 5, contactPhone: 'Call IT, they know' } });
    expect(await storedSettings()).not.toHaveProperty('contactPhone');
  });
});
