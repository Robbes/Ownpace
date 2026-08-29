// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The check that stores its answer — POST /api/billing/party/check-vat and
 * the consultation the GET join serves (workplan 0111 T2).
 *
 * VIES itself is mocked at the module seam (`checkVat`); everything else is
 * real — the router, PGlite as `app_user` under both migration chains, the
 * append-only grants, the RLS policies. What this file pins:
 *
 *  - a 200 is an ANSWER and always appends; an unavailable VIES stores
 *    NOTHING (the log holds answers, never attempts);
 *  - the GET join speaks only for the number as currently stored — change
 *    the number and the consultation honestly disappears;
 *  - the requester pair rides in from the environment, both-or-neither,
 *    with half a pair refusing loudly instead of silently downgrading;
 *  - the DATABASE forbids editing evidence: UPDATE and DELETE as the
 *    request path fail on the grant, not on good intentions.
 *
 * UUID family 5f5f0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, checkVat, type ViesOutcome } from '@openmig/managed';

const TENANT_A = '5f5f0000-e29b-41d4-a716-446655441801';
const TENANT_B = '5f5f0000-e29b-41d4-a716-446655441802';

let driver: LedgerDriver;
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

// Only the conversation with Brussels is faked; parseVatForVies and the rest
// of @openmig/managed stay real, migrations included.
vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return { ...actual, checkVat: vi.fn() };
});
const checkVatMock = vi.mocked(checkVat);

const { default: billingRoutes } = await import('./index.ts');
const { withTenantDb } = await import('../../middleware/auth.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

async function owner(sqlText: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sqlText, params);
  } finally {
    await conn.release();
  }
}

async function consultationCount(tenantId: string): Promise<number> {
  const { rows } = await owner(
    'SELECT count(*)::text AS n FROM vat_consultation WHERE tenant_id = $1',
    [tenantId],
  );
  return Number((rows[0] as { n: string }).n);
}

/** A stored business buyer whose number is checkable — the ordinary case. */
async function seedBusinessParty(vatNumber = 'NL123456789B01', countryCode = 'NL') {
  await owner(
    `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code, vat_number)
     VALUES ($1, 'business', 'Acme BV', 'Fabrieksweg 2', '5678 CD', 'Elders', $2, $3)`,
    [TENANT_A, countryCode, vatNumber],
  );
}

const CHECKED_VALID: ViesOutcome = {
  kind: 'checked',
  valid: true,
  requestDate: '2026-08-29+02:00',
  consultationNumber: 'WAPIAAAAXYZ1234',
  traderName: 'ACME BV',
  traderAddress: 'Fabrieksweg 2, 5678 CD Elders',
};

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [TENANT_A, 'Acme'],
    [TENANT_B, 'Beta'],
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
  checkVatMock.mockReset();
  delete process.env.VIES_REQUESTER_MEMBER_STATE;
  delete process.env.VIES_REQUESTER_VAT_NUMBER;
  await owner('DELETE FROM vat_consultation');
  await owner('DELETE FROM billing_party');
});

describe('POST /api/billing/party/check-vat', () => {
  it('refuses with nothing_to_check while no business VAT number is stored — VIES is never asked', async () => {
    // Nothing at all, then a consumer: neither has anything to check.
    expect((await request(app).post('/api/billing/party/check-vat')).status).toBe(409);
    await owner(
      `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
       VALUES ($1, 'consumer', 'Piet', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
      [TENANT_A],
    );
    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nothing_to_check');
    expect(checkVatMock).not.toHaveBeenCalled();
    expect(await consultationCount(TENANT_A)).toBe(0);
  });

  it('stores the answer: an unqualified check by default, the normalised number as asked', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue(CHECKED_VALID);

    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(200);
    expect(res.body.consultation).toMatchObject({
      countryCode: 'NL',
      vatNumber: '123456789B01',
      valid: true,
      consultationNumber: 'WAPIAAAAXYZ1234',
      traderName: 'ACME BV',
      requestDate: '2026-08-29+02:00',
    });
    // No env pair set → the requester argument was null (unqualified).
    expect(checkVatMock).toHaveBeenCalledWith(
      { memberState: 'NL', number: '123456789B01' },
      null,
    );
    expect(await consultationCount(TENANT_A)).toBe(1);
  });

  it('a no is stored exactly like a yes — both are evidence', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue({
      kind: 'checked',
      valid: false,
      requestDate: '2026-08-29+02:00',
      consultationNumber: 'WAPIAAAANO99999',
      traderName: null,
      traderAddress: null,
    });

    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(200);
    expect(res.body.consultation.valid).toBe(false);
    expect(await consultationCount(TENANT_A)).toBe(1);
  });

  it('re-checking APPENDS — the log keeps history, it does not overwrite it', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue(CHECKED_VALID);
    await request(app).post('/api/billing/party/check-vat');
    await request(app).post('/api/billing/party/check-vat');
    expect(await consultationCount(TENANT_A)).toBe(2);
  });

  it('an unavailable VIES answers 503 and stores NOTHING — an attempt is not an answer', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue({
      kind: 'unavailable',
      reason: 'VIES reported MS_UNAVAILABLE — ask again later.',
    });

    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('vies_unavailable');
    expect(res.body.reason).toContain('MS_UNAVAILABLE');
    expect(await consultationCount(TENANT_A)).toBe(0);
  });

  it('a number VIES can never answer for is 409, decided before Brussels is bothered', async () => {
    // A GB number: real, and simply not VIES's to answer.
    await seedBusinessParty('GB123456789', 'GB');
    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('vat_not_checkable');
    expect(res.body.reason).toContain('GB');
    expect(checkVatMock).not.toHaveBeenCalled();
  });

  it("VIES's own INVALID_INPUT is the same refusal, and nothing is stored", async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue({
      kind: 'not_checkable',
      reason: 'VIES refused the number as malformed (INVALID_INPUT) — retrying cannot change that.',
    });
    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('vat_not_checkable');
    expect(await consultationCount(TENANT_A)).toBe(0);
  });

  it('the environment pair makes the check QUALIFIED, prefix and case normalised', async () => {
    process.env.VIES_REQUESTER_MEMBER_STATE = 'nl';
    process.env.VIES_REQUESTER_VAT_NUMBER = 'NL 8687.54.289.B01';
    await seedBusinessParty();
    checkVatMock.mockResolvedValue(CHECKED_VALID);

    await request(app).post('/api/billing/party/check-vat');
    expect(checkVatMock).toHaveBeenCalledWith(
      { memberState: 'NL', number: '123456789B01' },
      { memberStateCode: 'NL', vatNumber: '868754289B01' },
    );
  });

  it('HALF a requester pair refuses loudly instead of silently going unqualified', async () => {
    process.env.VIES_REQUESTER_MEMBER_STATE = 'NL';
    await seedBusinessParty();

    const res = await request(app).post('/api/billing/party/check-vat');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('vies_requester_misconfigured');
    expect(res.body.message).toContain('VIES_REQUESTER_VAT_NUMBER');
    expect(checkVatMock).not.toHaveBeenCalled();
    expect(await consultationCount(TENANT_A)).toBe(0);
  });

  it('is owner/admin territory like the rest of billing', async () => {
    role = 'member';
    expect((await request(app).post('/api/billing/party/check-vat')).status).toBe(403);
  });
});

describe('GET /api/billing/party speaks for the number as currently stored', () => {
  it('serves the latest consultation for the current number, and none for a changed one', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue(CHECKED_VALID);
    await request(app).post('/api/billing/party/check-vat');

    const before = await request(app).get('/api/billing/party');
    expect(before.body.vatConsultation).toMatchObject({
      valid: true,
      consultationNumber: 'WAPIAAAAXYZ1234',
    });

    // The customer corrects their number. The old consultation is still in
    // the log — and correctly speaks for NOBODY on this surface, because
    // nothing has checked the number the next invoice would rely on.
    await owner(`UPDATE billing_party SET vat_number = 'NL999999999B99' WHERE tenant_id = $1`, [
      TENANT_A,
    ]);
    const after = await request(app).get('/api/billing/party');
    expect(after.body.party.vatNumber).toBe('NL999999999B99');
    expect(after.body.vatConsultation).toBeNull();
    expect(await consultationCount(TENANT_A)).toBe(1);
  });

  it('a consumer serves vatConsultation null, whatever the log holds', async () => {
    await owner(
      `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
       VALUES ($1, 'consumer', 'Piet', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
      [TENANT_A],
    );
    const res = await request(app).get('/api/billing/party');
    expect(res.status).toBe(200);
    expect(res.body.vatConsultation).toBeNull();
  });

  it('consultations are tenant-scoped: A checking writes nothing B can see or hold', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue(CHECKED_VALID);
    await request(app).post('/api/billing/party/check-vat');

    expect(await consultationCount(TENANT_B)).toBe(0);
    tenant = TENANT_B;
    const res = await request(app).get('/api/billing/party');
    expect(res.body.party).toBeNull();
    expect(res.body.vatConsultation).toBeNull();
  });
});

describe('the database holds the evidence, not only the code', () => {
  /**
   * The messages down a rejection's cause chain, joined. Drizzle wraps the
   * database's refusal in a "Failed query: …" error and keeps the real one
   * as `cause` — asserting on the top-level message alone would let ANY
   * failure (row security, a typo) pass as proof of the grant.
   */
  async function refusalOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      const messages: string[] = [];
      let current: unknown = error;
      while (current) {
        messages.push(current instanceof Error ? current.message : String(current));
        current = current instanceof Error ? current.cause : undefined;
      }
      return messages.join(' :: ');
    }
    throw new Error('expected the statement to be refused, and it was not');
  }

  it('the request path cannot UPDATE or DELETE a consultation — the grant refuses', async () => {
    await seedBusinessParty();
    checkVatMock.mockResolvedValue(CHECKED_VALID);
    await request(app).post('/api/billing/party/check-vat');

    // Through the SAME path the routes use — withTenantDb as app_user, the
    // tenant's own context set — so what fails here is the REVOKE, not row
    // security hiding the rows.
    expect(
      await refusalOf(
        withTenantDb(TENANT_A, driver as never, async (db) =>
          db.execute(sql`UPDATE vat_consultation SET valid = false WHERE tenant_id = ${TENANT_A}::uuid`),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await refusalOf(
        withTenantDb(TENANT_A, driver as never, async (db) =>
          db.execute(sql`DELETE FROM vat_consultation WHERE tenant_id = ${TENANT_A}::uuid`),
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(await consultationCount(TENANT_A)).toBe(1);
  });

  it('pins the grants: INSERT and SELECT, nothing else', async () => {
    const { rows } = await owner(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_user' AND table_schema = 'public' AND table_name = 'vat_consultation'`,
    );
    const privileges = [
      ...new Set((rows as Array<{ privilege_type: string }>).map((r) => r.privilege_type)),
    ].sort();
    expect(privileges).toEqual(['INSERT', 'SELECT']);
  });
});
