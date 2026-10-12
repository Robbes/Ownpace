// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDIT RUNNING OUT, SAID ONCE (workplan 0111 T11, slice Y3; the owner,
 * 2026-10-12: *"Send an email a month before the credit runs out? Yes, one
 * email"*): `claimCreditNotice` and its words, on a real database, month by
 * month as the month task runs it.
 *
 *  - a year whose credit pays next month says nothing; the month that leaves
 *    too little for the next claims the notice, with what is left and what
 *    the next month costs at its rate, and a second hour claims nothing;
 *  - another year bought is news again when its credit runs low, here after a
 *    move up in its first month, at half price;
 *  - no year, a month on Free, and a year before a withdrawal say nothing;
 *  - a notice said is not changed or deleted, and another organisation's is
 *    not read.
 *
 * PGlite, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';
import { PgDataAllowanceStore } from './data-ceiling.ts';
import { PgTierPickStore } from './tier-pick.ts';
import { openTheMonth } from './month-invoice.ts';
import { withdraw } from './withdrawal.ts';
import { addMonths, recordYear } from './year-credit.ts';
import { claimCreditNotice, creditNoticeEvent } from './credit-notice.ts';

const tier = (id: ManagedTier['id']): ManagedTier => MANAGED_TIERS.find((t) => t.id === id)!;

// UUID family 0111a100-…, unused elsewhere in the repo.
const RUNS_OUT = '0111a100-e29b-41d4-a716-446655440001' as TenantId;
const NO_YEAR = '0111a100-e29b-41d4-a716-446655440002' as TenantId;
const ON_FREE = '0111a100-e29b-41d4-a716-446655440003' as TenantId;
const WITHDRAWS = '0111a100-e29b-41d4-a716-446655440004' as TenantId;

let driver: LedgerDriver;

async function owner(statement: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const conn = await driver.acquire();
  try {
    return ((await conn.query(statement, params)) as { rows: Record<string, unknown>[] }).rows;
  } finally {
    await conn.release();
  }
}

/** A pick of `tierId` at `at`, with its yes, as the Billing page records one. */
async function pick(tenantId: TenantId, tierId: Exclude<ManagedTier['id'], 'free'>, at: string) {
  await withTenant(driver, tenantId, async (db) => {
    await new PgTierPickStore(db).record(tenantId, { tierId, priceEur: tier(tierId).monthlyCents / 100 }, 'someone@example.invalid', new Date(at));
    await new PgDataAllowanceStore(db).record(
      tenantId,
      { kind: 'tier', tierId, bandGb: tier(tierId).dataGb, priceEur: tier(tierId).monthlyCents / 100 },
      'someone@example.invalid',
      'pick',
    );
  });
  await owner(`UPDATE data_allowance SET consented_at = $2 WHERE tenant_id = $1 AND tier_id = $3 AND consented_at > $2`, [
    tenantId,
    at,
    tierId,
  ]);
}

const month = (tenantId: TenantId, at: string) => withTenant(driver, tenantId, (db) => openTheMonth(db, tenantId, new Date(at), 'en'));

const buy = (tenantId: TenantId, tierId: Exclude<ManagedTier['id'], 'free'>, at: string) =>
  withTenant(driver, tenantId, (db) =>
    recordYear(db, tenantId, { tier: tier(tierId), cents: tier(tierId).annualCents, priceFrom: 'list' }, new Date(at), 'en'),
  );

const claim = (tenantId: TenantId, at: string) => withTenant(driver, tenantId, (db) => claimCreditNotice(db, tenantId, new Date(at)));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Runs Out BV'), ($2, 'No Year BV'), ($3, 'On Free BV'), ($4, 'Withdraws BV')`, [
    RUNS_OUT,
    NO_YEAR,
    ON_FREE,
    WITHDRAWS,
  ]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the month before the credit runs out', () => {
  it('says nothing while the credit pays next month, through the eleventh month of a year', async () => {
    await pick(RUNS_OUT, 'medium', '2026-10-01T00:05:00Z');
    await buy(RUNS_OUT, 'medium', '2026-10-01T00:10:00Z');
    for (let m = 0; m < 11; m++) {
      const first = `${addMonths('2026-10', m)}-01`;
      expect(await month(RUNS_OUT, `${first}T00:23:00Z`)).toEqual({ kind: 'drawn', tier: 'medium', drawnCents: 600 });
      expect(await claim(RUNS_OUT, `${first}T00:24:00Z`)).toEqual({ kind: 'covered' });
    }
  });

  it('claims the notice once the twelfth month leaves nothing for the next, which costs the full price', async () => {
    expect(await month(RUNS_OUT, '2027-09-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'medium', drawnCents: 600 });
    const notice = await claim(RUNS_OUT, '2027-09-01T00:24:00Z');
    expect(notice).toEqual({
      kind: 'claimed',
      organisation: 'Runs Out BV',
      month: '2027-10',
      leftCents: 0,
      tier: { id: 'medium', name: 'Medium' },
      costCents: 1200,
      rate: 'full',
    });
    expect(notice.kind === 'claimed' && creditNoticeEvent(notice, 'nl')).toEqual({
      kind: 'credit_running_out',
      organisation: 'Runs Out BV',
      month: 'oktober 2027',
      left: '€ 0,00',
      tier: 'Medium',
      cost: '€ 12,00',
      halfPrice: false,
    });
    const [row] = await owner(`SELECT year_reference, month::text AS month, evidence FROM credit_notice WHERE tenant_id = $1`, [RUNS_OUT]);
    expect(row).toMatchObject({
      year_reference: `ownpace-${RUNS_OUT}-y-1`,
      month: '2027-10-01',
      evidence: { leftCents: 0, tier: 'medium', costCents: 1200, rate: 'full' },
    });
  });

  it('claims nothing the next hour, nor the hours after', async () => {
    expect(await claim(RUNS_OUT, '2027-09-01T01:24:00Z')).toEqual({ kind: 'said_before' });
    expect(await claim(RUNS_OUT, '2027-09-20T13:24:00Z')).toEqual({ kind: 'said_before' });
  });

  it('is news again for another year, here the hour after a move up, at half price', async () => {
    // Bought in September, which is billed: its credit pays from October.
    await buy(RUNS_OUT, 'medium', '2027-09-15T10:00:00Z');
    expect(await claim(RUNS_OUT, '2027-09-15T10:24:00Z')).toEqual({ kind: 'covered' });
    expect(await month(RUNS_OUT, '2027-10-01T00:23:00Z')).toEqual({ kind: 'drawn', tier: 'medium', drawnCents: 600 });
    expect(await claim(RUNS_OUT, '2027-10-01T00:24:00Z')).toEqual({ kind: 'covered' });
    // Extra large, at half its €80.00: 4000 − 600 more this month leaves 3200 of 7200.
    await pick(RUNS_OUT, 'xl', '2027-10-05T09:00:00Z');
    expect(await month(RUNS_OUT, '2027-10-05T09:23:00Z')).toEqual({ kind: 'drawn', tier: 'xl', drawnCents: 3400 });
    expect(await claim(RUNS_OUT, '2027-10-05T09:24:00Z')).toEqual({
      kind: 'claimed',
      organisation: 'Runs Out BV',
      month: '2027-11',
      leftCents: 3200,
      tier: { id: 'xl', name: 'Extra large' },
      costCents: 4000,
      rate: 'half',
    });
    expect(await claim(RUNS_OUT, '2027-10-05T10:24:00Z')).toEqual({ kind: 'said_before' });
    expect(
      (await owner(`SELECT year_reference FROM credit_notice WHERE tenant_id = $1 ORDER BY noticed_at`, [RUNS_OUT])).map(
        (r) => r.year_reference,
      ),
    ).toEqual([`ownpace-${RUNS_OUT}-y-1`, `ownpace-${RUNS_OUT}-y-2`]);
  });
});

describe('nothing to say', () => {
  it('without a year, on a month that bills Free, and for a year before a withdrawal', async () => {
    await pick(NO_YEAR, 'medium', '2026-10-01T00:05:00Z');
    expect(await claim(NO_YEAR, '2026-10-01T00:24:00Z')).toEqual({ kind: 'no_year' });

    await buy(ON_FREE, 'small', '2026-10-01T00:10:00Z');
    expect(await claim(ON_FREE, '2026-10-01T00:24:00Z')).toEqual({ kind: 'free' });

    await pick(WITHDRAWS, 'medium', '2026-10-01T00:05:00Z');
    await buy(WITHDRAWS, 'medium', '2026-10-01T00:10:00Z');
    expect(await month(WITHDRAWS, '2026-10-01T00:23:00Z')).toMatchObject({ kind: 'drawn' });
    await withTenant(driver, WITHDRAWS, (db) =>
      withdraw(
        db,
        WITHDRAWS,
        { by: 'someone', name: 'A. Tester', confirmTo: 'someone@example.invalid', language: 'en', via: 'screen' },
        new Date('2026-10-03T10:00:00Z'),
      ),
    );
    expect(await claim(WITHDRAWS, '2026-10-03T10:24:00Z')).toEqual({ kind: 'no_year' });
    expect(await owner(`SELECT 1 FROM credit_notice WHERE tenant_id = ANY($1)`, [[NO_YEAR, ON_FREE, WITHDRAWS]])).toEqual([]);
  });
});

describe('a notice said', () => {
  const failureOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return 'it ran';
    } catch (error) {
      // Drizzle wraps the database's refusal as "Failed query"; its cause says why.
      const cause = (error as { cause?: { message?: string } }).cause;
      return cause?.message ?? (error as Error).message;
    }
  };

  it('is not changed or deleted, and is not read by another organisation', async () => {
    expect(
      await failureOf(() =>
        withTenant(driver, RUNS_OUT, (db) => db.execute(sql`UPDATE credit_notice SET month = '2030-01-01' WHERE tenant_id = ${RUNS_OUT}`)),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failureOf(() => withTenant(driver, RUNS_OUT, (db) => db.execute(sql`DELETE FROM credit_notice WHERE tenant_id = ${RUNS_OUT}`))),
    ).toMatch(/permission denied/);
    const seen = await withTenant(driver, NO_YEAR, async (db) =>
      ((await db.execute(sql`SELECT tenant_id FROM credit_notice`)) as unknown as { rows: unknown[] }).rows,
    );
    expect(seen).toEqual([]);
  });
});
