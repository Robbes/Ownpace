// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The buyer, as data — GET/PUT /api/billing/party (workplan 0111 T1).
 *
 * Against a REAL database, both migration chains, serving as `app_user`: what
 * matters here is not the route's happy path but the claims around it — that
 * the shape is consumer-first (the DEFAULT is a natural person; business is
 * the variant you have to say), that the vat-only-on-business rule lives in
 * the DATABASE and not only in a zod schema somebody can simplify away, that
 * the PUT is an upsert a retry converges on (hard rule 1), and that row
 * security scopes the row to its tenant even though the route also filters.
 *
 * The role gate mirrors the rest of billing: owner/admin in both directions
 * (owner decision 2026-08-10).
 *
 * UUID family 5f5e0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const TENANT_A = '5f5e0000-e29b-41d4-a716-446655441801';
const TENANT_B = '5f5e0000-e29b-41d4-a716-446655441802';
/** Reserved for direct-SQL constraint probes, so no route state leaks in. */
const TENANT_C = '5f5e0000-e29b-41d4-a716-446655441803';

let driver: LedgerDriver;
/** What the stubbed `authenticate` pretends the token said — set per test. */
let tenant: string;
let role: string;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: tenant, userId: 'somebody', userRole: role });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: billingRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

/** Direct database access, as the owner — PGlite's raw connection bypasses
 *  row security, which is exactly what seeding and probing constraints need. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

/** The minimal honest body: a person, an address, a country. No kind. */
const CONSUMER_BODY = {
  name: 'Piet Jansen',
  addressLine1: 'Dorpsstraat 1',
  postalCode: '1234 AB',
  city: 'Ons Dorp',
  countryCode: 'NL',
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [TENANT_A, 'Jansen thuis'],
    [TENANT_B, 'Beta BV'],
    [TENANT_C, 'constraint probes'],
  ]) {
    await owner('INSERT INTO tenant (id, name) VALUES ($1,$2)', [id, name]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  tenant = TENANT_A;
  role = 'owner';
  await owner('DELETE FROM billing_party');
});

describe('GET /api/billing/party', () => {
  it('says null, not an error, while nothing has been provided', async () => {
    // No row IS the "not yet provided" state (migration 0012) — the page
    // renders it as an ask, so it must arrive as data, never as a 404.
    const res = await request(app).get('/api/billing/party');
    expect(res.status).toBe(200);
    expect(res.body.party).toBeNull();
  });
});

describe('PUT /api/billing/party', () => {
  it('the minimal body is a CONSUMER — the default shape, not a demanded flag', async () => {
    // T1's sentence, executable: a natural person with a billing address and
    // country, with the business case as the variant rather than the default.
    const put = await request(app).put('/api/billing/party').send(CONSUMER_BODY);
    expect(put.status).toBe(200);
    expect(put.body.party.kind).toBe('consumer');
    expect(put.body.party.vatNumber).toBeNull();

    const get = await request(app).get('/api/billing/party');
    expect(get.body.party.name).toBe('Piet Jansen');
    expect(get.body.party.countryCode).toBe('NL');
  });

  it('uppercases the country rather than refusing a case nobody chose', async () => {
    const res = await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, countryCode: 'nl' });
    expect(res.status).toBe(200);
    expect(res.body.party.countryCode).toBe('NL');
  });

  it('is an upsert: sending it twice converges on ONE row (hard rule 1)', async () => {
    await request(app).put('/api/billing/party').send(CONSUMER_BODY);
    const second = await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, city: 'Verhuisd' });
    expect(second.status).toBe(200);
    expect(second.body.party.city).toBe('Verhuisd');

    const { rows } = await owner('SELECT count(*)::text AS n FROM billing_party WHERE tenant_id = $1', [
      TENANT_A,
    ]);
    expect((rows[0] as { n: string }).n).toBe('1');
  });

  it('business is the variant: it must be said, and only it may carry a VAT number', async () => {
    const business = await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, kind: 'business', name: 'Acme BV', vatNumber: 'NL123456789B01' });
    expect(business.status).toBe(200);
    expect(business.body.party.kind).toBe('business');
    expect(business.body.party.vatNumber).toBe('NL123456789B01');

    // Switching back to consumer clears the number: the whole statement is
    // replaced, so a kind switch cannot strand a stale VAT number behind it.
    const back = await request(app).put('/api/billing/party').send(CONSUMER_BODY);
    expect(back.status).toBe(200);
    expect(back.body.party.kind).toBe('consumer');
    expect(back.body.party.vatNumber).toBeNull();
  });

  it('a business WITHOUT a VAT number stays legal — not every business is registered', async () => {
    const res = await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, kind: 'business', name: 'Eenmanszaak Jansen' });
    expect(res.status).toBe(200);
    expect(res.body.party.vatNumber).toBeNull();
  });

  it('refuses a consumer carrying a VAT number, with the field named', async () => {
    const res = await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, vatNumber: 'NL123456789B01' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toContain('vatNumber');
  });

  it('refuses a country that is not a two-letter code, and a missing name', async () => {
    const country = await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, countryCode: 'Nederland' });
    expect(country.status).toBe(400);

    const { name: _dropped, ...nameless } = CONSUMER_BODY;
    const noName = await request(app).put('/api/billing/party').send(nameless);
    expect(noName.status).toBe(400);
  });
});

describe('who may touch it', () => {
  it('is owner/admin territory in both directions, like the rest of billing', async () => {
    role = 'member';
    expect((await request(app).get('/api/billing/party')).status).toBe(403);
    expect((await request(app).put('/api/billing/party').send(CONSUMER_BODY)).status).toBe(403);

    role = 'admin';
    expect((await request(app).get('/api/billing/party')).status).toBe(200);
  });

  it('scopes the row to its tenant — B never sees A, in either direction', async () => {
    await request(app).put('/api/billing/party').send(CONSUMER_BODY);

    tenant = TENANT_B;
    const before = await request(app).get('/api/billing/party');
    expect(before.body.party).toBeNull();
    await request(app)
      .put('/api/billing/party')
      .send({ ...CONSUMER_BODY, name: 'Bea de Vries', city: 'Elders' });

    tenant = TENANT_A;
    const after = await request(app).get('/api/billing/party');
    expect(after.body.party.name).toBe('Piet Jansen');
    expect(after.body.party.city).toBe('Ons Dorp');
  });
});

describe('the database holds the line, not only the route', () => {
  // Straight SQL, as the owner, so a bypassed or "simplified" zod schema still
  // cannot write the contradiction. CHECK constraints bind every role,
  // superusers included — which is what makes this the copy that counts.
  it('refuses a consumer with a VAT number at the constraint', async () => {
    await expect(
      owner(
        `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code, vat_number)
         VALUES ($1, 'consumer', 'x', 'x', 'x', 'x', 'NL', 'NL123456789B01')`,
        [TENANT_C],
      ),
    ).rejects.toThrow(/billing_party_vat_number_check/);
  });

  it('refuses a country that is not two uppercase letters at the constraint', async () => {
    await expect(
      owner(
        `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
         VALUES ($1, 'consumer', 'x', 'x', 'x', 'x', 'Netherlands')`,
        [TENANT_C],
      ),
    ).rejects.toThrow(/billing_party_country_code_check/);
  });

  it('defaults kind to consumer in the DATABASE, not only in zod', async () => {
    await owner(
      `INSERT INTO billing_party (tenant_id, name, address_line1, postal_code, city, country_code)
       VALUES ($1, 'x', 'x', 'x', 'x', 'NL')`,
      [TENANT_C],
    );
    const { rows } = await owner('SELECT kind FROM billing_party WHERE tenant_id = $1', [TENANT_C]);
    expect((rows[0] as { kind: string }).kind).toBe('consumer');
  });

  it('grants the request path no DELETE — correcting details is an UPDATE', async () => {
    // The baseline's ALTER DEFAULT PRIVILEGES hands every new table all four
    // verbs, so migration 0012's narrowing is a REVOKE, pinned here the way
    // erasure_record's is: the product offers no path that removes a buyer's
    // details, and the one legitimate delete — the erasure purge — runs on
    // the owner connection (offboarding.ts names billing_party in
    // PURGED_TABLES).
    const { rows } = await owner(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_user' AND table_schema = 'public' AND table_name = 'billing_party'`,
    );
    const privileges = [...new Set((rows as Array<{ privilege_type: string }>).map((r) => r.privilege_type))].sort();
    expect(privileges).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });
});
