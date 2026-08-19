// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The agreement, against a real database.
 *
 * One promise is being tested and it is a commercial one: **changing the
 * operator's template must never change what an existing tenant is billed.**
 * Everything else here supports that — the pin happening once, the pinned row
 * surviving a template change, and a fresh tenant taking the template current
 * at ITS first billing touch rather than whatever shipped in the code.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgDb } from '@openmig/ledger/db';
import * as schemaPg from '@openmig/ledger/schema-pg';
import { DEFAULT_PRICING } from './pricing';
import { resolveTenantPricing } from './tenant-pricing';
import { tenantPricing } from './schema-managed';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const EXISTING = '00000000-0000-0000-0000-0000000009a1';
const FRESH = '00000000-0000-0000-0000-0000000009a2';

const PRICING_ENV = [
  'PRICING_BASE_FEE_CENTS',
  'PRICING_STORAGE_PER_GB_CENTS',
  'PRICING_EGRESS_PER_GB_CENTS',
  'PRICING_COMPUTE_PER_HOUR_CENTS',
] as const;

/** Point the operator template somewhere unmistakable for the duration of a case. */
function setTemplate(values: Partial<Record<(typeof PRICING_ENV)[number], string>>): void {
  for (const key of PRICING_ENV) {
    const v = values[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
}

describe('resolveTenantPricing', () => {
  let db: ReturnType<typeof createPgDb>;

  beforeAll(async () => {
    db = createPgDb(TEST_DB_URL);
    for (const id of [EXISTING, FRESH]) {
      await db
        .insert(schemaPg.tenant)
        .values({ id, name: `pricing test ${id.slice(-4)}`, status: 'active', settings: {} })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    setTemplate({});
    await db.delete(schemaPg.tenant).where(eq(schemaPg.tenant.id, EXISTING));
    await db.delete(schemaPg.tenant).where(eq(schemaPg.tenant.id, FRESH));
  });

  beforeEach(async () => {
    setTemplate({});
    // Both tenants start with no agreement; each case pins what it needs.
    // "No agreement" is now the ABSENCE of a row rather than a NULL column
    // (ADR-0036), which is why this deletes instead of nulling.
    for (const id of [EXISTING, FRESH]) {
      await db.delete(tenantPricing).where(eq(tenantPricing.tenantId, id));
    }
  });

  it('pins the current template for a tenant that has agreed to nothing', async () => {
    setTemplate({ PRICING_BASE_FEE_CENTS: '1500', PRICING_COMPUTE_PER_HOUR_CENTS: '7' });

    const resolved = await resolveTenantPricing(db, FRESH);
    expect(resolved.baseFee).toBe(1500);
    expect(resolved.computePricePerHour).toBe(7);
    // Untouched components still come from the built-in list.
    expect(resolved.egressPricePerGB).toBe(DEFAULT_PRICING.egressPricePerGB);

    const [row] = await db
      .select({ pricing: tenantPricing.pricing })
      .from(tenantPricing)
      .where(eq(tenantPricing.tenantId, FRESH));
    expect(row?.pricing).toMatchObject({ baseFee: 1500, computePricePerHour: 7 });
  });

  it('KEEPS an existing tenant on its agreed prices when the template changes', async () => {
    // The whole point of the table. Tenant signs up at 1500…
    setTemplate({ PRICING_BASE_FEE_CENTS: '1500' });
    const atSignup = await resolveTenantPricing(db, EXISTING);
    expect(atSignup.baseFee).toBe(1500);

    // …the operator later raises the list price for new customers…
    setTemplate({ PRICING_BASE_FEE_CENTS: '2500' });

    // …and this customer keeps paying what they agreed to.
    const later = await resolveTenantPricing(db, EXISTING);
    expect(later.baseFee).toBe(1500);

    // A tenant that agreed to nothing yet does get the new list price.
    expect((await resolveTenantPricing(db, FRESH)).baseFee).toBe(2500);
  });

  it('pins once — a second call does not re-pin, even mid-template-change', async () => {
    setTemplate({ PRICING_COMPUTE_PER_HOUR_CENTS: '3' });
    await resolveTenantPricing(db, EXISTING);
    setTemplate({ PRICING_COMPUTE_PER_HOUR_CENTS: '99' });

    expect((await resolveTenantPricing(db, EXISTING)).computePricePerHour).toBe(3);
    expect((await resolveTenantPricing(db, EXISTING)).computePricePerHour).toBe(3);
  });

  it('re-pins a corrupt agreement rather than serving half of one', async () => {
    // A row somebody edited by hand and got wrong: half a price list is not a
    // price list, and merging it with the template would invent an agreement
    // nobody made.
    await db
      .insert(tenantPricing)
      .values({ tenantId: EXISTING, pricing: { baseFee: 1234 } })
      .onConflictDoUpdate({ target: tenantPricing.tenantId, set: { pricing: { baseFee: 1234 } } });
    setTemplate({ PRICING_BASE_FEE_CENTS: '2000' });

    const resolved = await resolveTenantPricing(db, EXISTING);
    expect(resolved.baseFee).toBe(2000);
    expect(resolved.storagePricePerGB).toBe(DEFAULT_PRICING.storagePricePerGB);
  });

  it('serves the template without pinning when the tenant row is not readable', async () => {
    setTemplate({ PRICING_BASE_FEE_CENTS: '4242' });
    const resolved = await resolveTenantPricing(db, '00000000-0000-0000-0000-0000000009ff');
    expect(resolved.baseFee).toBe(4242);
  });
});
