// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The invoice button refuses, and the guard cannot outlive its reason
 * (workplan 0109 T0, the owner's decision of 2026-08-27).
 *
 * Two different jobs here, and the second is the one that matters in six
 * months:
 *
 *  1. the route refuses, in words an owner can act on, without touching a
 *     usage table or leaving a draft behind;
 *  2. **the guard is tied to the condition that justifies it.** A refusal that
 *     is right today and forgotten later is how a product ends up unable to
 *     invoice for a reason nobody remembers. The last test fails the moment
 *     tier code exists, which turns "delete this guard" from something 0109 T5
 *     must remember into something CI insists on.
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NO_TIER_BILLING_CODE,
  NO_TIER_BILLING_REASON,
} from './no-bill-we-do-not-sell.ts';

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

/** A caller who is authenticated, in a tenant, and allowed to write billing. */
vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 't-1', userId: 'rob', userRole: 'owner' });
      next();
    },
    // The refusal must land before anything reaches a database. If the route
    // ever touches one, this throws and the test says so.
    getDbPool: () => {
      throw new Error('a refused invoice must not open a database connection');
    },
  };
});

const { default: billingRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/billing', billingRoutes);

describe('POST /api/billing/invoices/generate', () => {
  it('refuses with 409 and a code a client can branch on', async () => {
    const res = await request(app).post('/api/billing/invoices/generate').send({});
    // 409, not 501: well-formed, permitted, and the deployment cannot honour it.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(NO_TIER_BILLING_CODE);
    expect(res.body.reason).toBe(NO_TIER_BILLING_REASON);
  });

  it('refuses a named period too — no input makes it billable', async () => {
    const res = await request(app)
      .post('/api/billing/invoices/generate')
      .send({ period: '2026-07' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(NO_TIER_BILLING_CODE);
  });

  it('touches no database, so a refused call leaves nothing behind', async () => {
    // `getDbPool` throws in this file. Reaching it would surface as a 500
    // through `serverFault`, not a 409 — which is what this asserts.
    const res = await request(app).post('/api/billing/invoices/generate').send({});
    expect(res.status).toBe(409);
  });

  it('says what would have been billed, not merely that it will not', async () => {
    // "Disabled" tells an owner nothing. The sentence has to carry the reason
    // and the way forward, because the person reading it did nothing wrong.
    expect(NO_TIER_BILLING_REASON).toMatch(/no longer sells/);
    expect(NO_TIER_BILLING_REASON).toMatch(/five tiers/);
    expect(NO_TIER_BILLING_REASON).toMatch(/every byte twice/);
    expect(NO_TIER_BILLING_REASON).toMatch(/Nothing is wrong with your account/);
    expect(NO_TIER_BILLING_REASON).toMatch(/from a person/);
  });
});

describe('the guard cannot outlive its reason', () => {
  it('still describes the code as it actually is — four scalars, no tiers', () => {
    // The refusal's whole claim is that `pricing.ts` prices a retired model.
    // If somebody adds tier pricing without deleting this guard, the product
    // would refuse to invoice for a model it CAN now bill — so the claim is
    // checked against the file rather than trusted.
    const pricing = readFileSync(
      join(REPO_ROOT, 'packages/managed/src/pricing.ts'),
      'utf-8',
    );
    for (const scalar of [
      'baseFee',
      'storagePricePerGB',
      'egressPricePerGB',
      'computePricePerHour',
    ]) {
      expect(pricing, `${scalar} is what makes this the METERED model`).toContain(scalar);
    }
  });

  it('FAILS once a tier calculator exists — delete the guard, do not silence this', () => {
    // The trip-wire. When 0109 T4 lands a managed-side tier calculator, this
    // goes red and the fix is to delete `no-bill-we-do-not-sell.ts`, restore
    // the route against tiers (0109 T5), and remove this file — not to widen
    // the pattern.
    //
    // Matched on the SOURCE rather than on an import, so it trips whether the
    // calculator arrives as its own module or inside `pricing.ts`.
    const pricing = readFileSync(
      join(REPO_ROOT, 'packages/managed/src/pricing.ts'),
      'utf-8',
    );
    expect(
      /\btiers?\b/i.test(pricing),
      'packages/managed/src/pricing.ts now mentions tiers — 0109 T5 is landing, so the ' +
        '0109 T0 refusal has done its job and should be deleted rather than kept green',
    ).toBe(false);
  });
});
