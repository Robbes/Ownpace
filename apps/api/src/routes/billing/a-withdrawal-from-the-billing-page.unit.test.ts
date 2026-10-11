// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WITHDRAWAL FROM THE BILLING PAGE (workplan 0111, T7, slice 7b; decision
 * 15; terms §7): `GET` and `POST /api/billing/withdrawal` over a real database
 * with every migration applied.
 *
 *  - before: open, from the first yes, with its tier, and what the form fills
 *    in for the person to confirm (the name on the invoice details, the
 *    signed-in address);
 *  - a withdrawal without a name or a usable address is refused, and nothing
 *    is written;
 *  - the withdrawal: recorded, the month credited, Free from then on, and the
 *    acknowledgement told to the address given, in the organisation's
 *    language, saying what was sent and when;
 *  - after: closed, and a second press answers 409 with a sentence and writes
 *    nothing; a mail that did not go leaves the withdrawal standing, and says
 *    so in the answer.
 *
 * UUID family 01117d00-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import type { NotificationEvent, NotificationLocale } from '@openmig/shared';

const TENANT = '01117d00-e29b-41d4-a716-446655440001';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'the-owner', userRole: 'owner', userEmail: 'sam@example.invalid' });
      next();
    },
    getDbPool: () => driver,
  };
});

const told: Array<{ to: string; locale: NotificationLocale; event: NotificationEvent }> = [];
let mailAnswer: 'sent' | 'off' | 'failed' = 'sent';
vi.mock('../../access-notify.ts', () => ({
  tell: async (to: string, locale: NotificationLocale, event: NotificationEvent) => {
    told.push({ to, locale, event });
    return mailAnswer;
  },
}));

const { default: billingRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

/** As the owner: PGlite's raw connection bypasses row security, for seeding and probing. */
async function owner(sql: string, params: unknown[] = []) {
  const conn = await driver.acquire();
  try {
    return await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name, settings) VALUES ($1, 'De Vries thuis', '{"notifications": {"locale": "nl"}}')`, [
    TENANT,
  ]);
  await owner(
    `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
     VALUES ($1, 'consumer', 'Sam de Vries', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
    [TENANT],
  );
  // A yes to Small an hour ago, and the month's invoice it made.
  await owner(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by, consented_at, axis)
     VALUES ($1, 'tier', 'small', 1000, 5, 'the-owner', now() - interval '1 hour', 'data')`,
    [TENANT],
  );
  await owner(
    `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference, evidence, lines)
     VALUES ($1, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date, 'draft',
             500, 0, 0, 500, $2, jsonb_build_object('at', now()::text),
             '[{"description": "Ownpace Small: het pakket dat u koos", "publishedCents": 500}]'::jsonb)`,
    [TENANT, `ownpace-${TENANT}-m-2026-10-small`],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the withdrawal function on the Billing page', () => {
  it('is open from the first yes, with its tier, and fills in the name and the signed-in address', async () => {
    const res = await request(app).get('/api/billing/withdrawal');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      open: true,
      tier: { id: 'small', name: 'Small' },
      name: 'Sam de Vries',
      confirmTo: 'sam@example.invalid',
    });
    expect(Date.parse(res.body.until) - Date.parse(res.body.since)).toBeGreaterThan(14 * 86_400_000);
  });

  it('refuses a withdrawal without a name or a usable address, and writes nothing', async () => {
    for (const body of [{ name: '', confirmTo: 'sam@example.invalid' }, { name: 'Sam de Vries', confirmTo: 'not an address' }, {}]) {
      const res = await request(app).post('/api/billing/withdrawal').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_withdrawal');
    }
    expect((await owner('SELECT count(*)::int AS n FROM contract_withdrawal')).rows[0]).toEqual({ n: 0 });
    expect(told).toEqual([]);
  });

  it('records it, credits the month, and tells the address given, in the organisation’s language', async () => {
    const res = await request(app).post('/api/billing/withdrawal').send({ name: 'Sam de Vries', confirmTo: 'sam@example.invalid' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tier: { id: 'small', name: 'Small' }, credits: 1, beganOnRequest: false, confirmation: 'sent' });
    expect((await owner(`SELECT name, confirm_to, language FROM contract_withdrawal`)).rows).toEqual([
      { name: 'Sam de Vries', confirm_to: 'sam@example.invalid', language: 'nl' },
    ]);
    expect((await owner(`SELECT kind, status FROM invoice WHERE kind = 'credit_note'`)).rows).toEqual([
      { kind: 'credit_note', status: 'draft' },
    ]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      to: 'sam@example.invalid',
      locale: 'nl',
      event: {
        kind: 'contract_withdrawn',
        organisation: 'De Vries thuis',
        name: 'Sam de Vries',
        tier: 'Small',
        confirmTo: 'sam@example.invalid',
        credits: 1,
        beganOnRequest: false,
      },
    });
    expect((told[0]!.event as { withdrawnAt: string }).withdrawnAt).toMatch(/^\d{1,2} [a-z]+ \d{4} om \d{2}:\d{2} UTC$/);
  });

  it('is closed after, and a second press answers 409 with a sentence and writes nothing', async () => {
    const read = await request(app).get('/api/billing/withdrawal');
    expect(read.body).toMatchObject({ open: false, reason: 'nothing_paid', tier: null });

    const again = await request(app).post('/api/billing/withdrawal').send({ name: 'Sam de Vries', confirmTo: 'sam@example.invalid' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'withdrawal_closed', why: 'nothing_paid' });
    expect(again.body.reason).toContain('on Free');
    expect((await owner('SELECT count(*)::int AS n FROM contract_withdrawal')).rows[0]).toEqual({ n: 1 });
    expect(told).toHaveLength(1);
  });

  it('stands when the acknowledgement does not go, and says so', async () => {
    await owner(
      `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by, consented_at, axis)
       VALUES ($1, 'tier', 'small', 1000, 5, 'the-owner', now(), 'data')`,
      [TENANT],
    );
    mailAnswer = 'failed';
    const res = await request(app).post('/api/billing/withdrawal').send({ name: 'Sam de Vries', confirmTo: 'other@example.invalid' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ confirmation: 'failed', credits: 0 });
    expect((await owner('SELECT count(*)::int AS n FROM contract_withdrawal')).rows[0]).toEqual({ n: 2 });
  });
});
