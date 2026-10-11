// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WITHDRAWAL, BACK TO FREE (workplan 0111, T7, slice 7b; decision 15; terms
 * §7): `withdraw` and its readers, on a real database, in the organisation's
 * own scope as `app_user`.
 *
 *  - a consumer who said yes to Small withdraws within the fourteen days: the
 *    withdrawal is recorded with what they gave, the month's invoice gets a
 *    credit note in their language, in full (no yes records a request to begin
 *    early yet), and from that moment every reader of the tier reads Free: the
 *    tier the month bills, the month's invoice (nothing more this month,
 *    nothing next month) and the window, closed;
 *  - a yes after it counts again, and opens a new contract and a new window;
 *  - a business, and a consumer after the fourteen days, are answered closed,
 *    and nothing is written;
 *  - the row cannot be changed or removed by the app, and the system role reads
 *    when, never who or what they gave.
 *
 * PGlite, both chains. The names and addresses are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { PgDataAllowanceStore } from './data-ceiling.ts';
import { openTheMonth } from './month-invoice.ts';
import { readBilledNow } from './pace.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';
import { readWithdrawalWindow, withdraw, type WithdrawalStatement } from './withdrawal.ts';

// UUID family 01117c00-…, unused elsewhere in the repo.
const CONSUMER = '01117c00-e29b-41d4-a716-446655440001' as TenantId;
const BUSINESS = '01117c00-e29b-41d4-a716-446655440002' as TenantId;
const TOO_LATE = '01117c00-e29b-41d4-a716-446655440003' as TenantId;
const GB = 1_000_000_000n;
const OCT_1 = new Date('2026-10-01T10:23:00Z');
const OCT_3 = new Date('2026-10-03T10:04:00Z');
const OCT_5 = new Date('2026-10-05T09:00:00Z');
const NOV_1 = new Date('2026-11-01T00:23:00Z');

const STATEMENT: WithdrawalStatement = {
  by: 'the-owner',
  name: 'Sam de Vries',
  confirmTo: 'sam@example.invalid',
  language: 'nl',
  via: 'screen',
};

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;

describe('a withdrawal, and every reader of the tier back to Free', () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const yes = async (tenantId: TenantId, tierId: 'small' | 'medium', at: string) => {
    await withTenant(driver, tenantId, (db) =>
      new PgDataAllowanceStore(db).record(
        tenantId,
        { kind: 'tier', tierId, bandGb: tier(tierId).dataGb, priceEur: tierId === 'small' ? 5 : 12 },
        'the-owner',
      ),
    );
    await owner(`UPDATE data_allowance SET consented_at = $2 WHERE tenant_id = $1 AND consented_at > now() - interval '1 minute'`, [
      tenantId,
      at,
    ]);
  };

  const ORDER: Record<string, string> = { invoice: 'created_at', contract_withdrawal: 'withdrawn_at' };
  const rows = async (table: 'invoice' | 'contract_withdrawal', tenantId: TenantId) =>
    (await owner(`SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY ${ORDER[table]}`, [tenantId])).rows as Array<
      Record<string, unknown>
    >;

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Withdraws'), ($2, 'A Business BV'), ($3, 'Too Late')`, [
      CONSUMER,
      BUSINESS,
      TOO_LATE,
    ]);
    for (const [tenantId, kind] of [
      [CONSUMER, 'consumer'],
      [BUSINESS, 'business'],
      [TOO_LATE, 'consumer'],
    ] as const) {
      await owner(
        `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
         VALUES ($1, $2, 'Sam de Vries', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
        [tenantId, kind],
      );
      await owner(`INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes) VALUES ($1, $2, 0)`, [tenantId, String(320n * GB)]);
    }
    await yes(CONSUMER, 'small', '2026-10-01T09:30:00Z');
    await yes(BUSINESS, 'small', '2026-10-01T09:30:00Z');
    await yes(TOO_LATE, 'small', '2026-09-01T09:30:00Z');
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('records the withdrawal, credits the month in full, in their language, and reads Free from then on', async () => {
    expect((await withTenant(driver, CONSUMER, (db) => openTheMonth(db, CONSUMER, OCT_1, 'nl'))).kind).toBe('made');
    expect((await withTenant(driver, CONSUMER, (db) => readBilledNow(db, CONSUMER, OCT_3))).billed.tier.id).toBe('small');

    const outcome = await withTenant(driver, CONSUMER, (db) => withdraw(db, CONSUMER, STATEMENT, OCT_3));

    expect(outcome).toMatchObject({
      kind: 'withdrawn',
      withdrawnAt: OCT_3,
      since: new Date('2026-10-01T09:30:00Z'),
      tier: 'small',
      beganOnRequest: false,
      credits: [
        {
          reference: `ownpace-${CONSUMER}-c-2026-10-small`,
          invoice: `ownpace-${CONSUMER}-m-2026-10-small`,
          share: { daysPaid: 31, daysUsed: 0, numerator: 31, denominator: 31 },
        },
      ],
    });
    const [withdrawal] = await rows('contract_withdrawal', CONSUMER);
    expect(withdrawal).toMatchObject({
      withdrawn_by: 'the-owner',
      name: 'Sam de Vries',
      confirm_to: 'sam@example.invalid',
      tier_id: 'small',
      began_on_request: false,
      language: 'nl',
      via: 'screen',
    });
    const credit = (await rows('invoice', CONSUMER)).find((r) => r.kind === 'credit_note');
    expect(credit).toMatchObject({
      status: 'draft',
      lines: [{ description: 'Herroeping op 3 oktober 2026: factuur {invoice} volledig gecrediteerd', numerator: 31, denominator: 31 }],
    });
    expect(credit!.evidence).toMatchObject({ reason: 'withdrawal', daysPaid: 31, daysUsed: 0, beganOnRequest: false });

    // Every reader of the tier: Free from the moment of the withdrawal.
    const after = await withTenant(driver, CONSUMER, (db) => readBilledNow(db, CONSUMER, OCT_3));
    expect(after.billed.tier.id).toBe('free');
    expect(after.allowance.tier.id).toBe('free');
    expect(await withTenant(driver, CONSUMER, (db) => openTheMonth(db, CONSUMER, new Date('2026-10-04T00:23:00Z'), 'nl'))).toEqual({
      kind: 'in_step',
    });
    expect(await withTenant(driver, CONSUMER, (db) => openTheMonth(db, CONSUMER, NOV_1, 'nl'))).toEqual({ kind: 'free' });
    expect(await withTenant(driver, CONSUMER, (db) => readWithdrawalWindow(db, CONSUMER, OCT_3))).toMatchObject({
      kind: 'closed',
      reason: 'nothing_paid',
    });
  });

  it('answers a second withdrawal closed, and writes nothing', async () => {
    const outcome = await withTenant(driver, CONSUMER, (db) => withdraw(db, CONSUMER, STATEMENT, OCT_3));
    expect(outcome).toMatchObject({ kind: 'closed', reason: 'nothing_paid' });
    expect(await rows('contract_withdrawal', CONSUMER)).toHaveLength(1);
  });

  it('counts a yes after it again, as a new contract with fourteen days of its own', async () => {
    await yes(CONSUMER, 'medium', OCT_5.toISOString());

    expect((await withTenant(driver, CONSUMER, (db) => readBilledNow(db, CONSUMER, OCT_5))).allowance.tier.id).toBe('medium');
    expect(await withTenant(driver, CONSUMER, (db) => readWithdrawalWindow(db, CONSUMER, OCT_5))).toMatchObject({
      kind: 'open',
      since: OCT_5,
      until: new Date('2026-10-20T00:00:00Z'),
      tier: 'medium',
    });
  });

  it('answers a business, and a consumer after the fourteen days, closed, and writes nothing', async () => {
    expect(await withTenant(driver, BUSINESS, (db) => withdraw(db, BUSINESS, STATEMENT, OCT_3))).toMatchObject({
      kind: 'closed',
      reason: 'business',
    });
    expect(await withTenant(driver, TOO_LATE, (db) => withdraw(db, TOO_LATE, STATEMENT, OCT_3))).toMatchObject({
      kind: 'closed',
      reason: 'past',
      until: new Date('2026-09-16T00:00:00Z'),
    });
    expect(await rows('contract_withdrawal', BUSINESS)).toEqual([]);
    expect(await rows('contract_withdrawal', TOO_LATE)).toEqual([]);
    expect((await withTenant(driver, BUSINESS, (db) => readBilledNow(db, BUSINESS, OCT_3))).allowance.tier.id).toBe('small');
  });

  it('cannot be changed or removed by the app; the system role reads when, never who', async () => {
    await expect(
      withTenant(driver, CONSUMER, (db) => db.execute(sql`UPDATE contract_withdrawal SET name = 'Someone Else'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(withTenant(driver, CONSUMER, (db) => db.execute(sql`DELETE FROM contract_withdrawal`))).rejects.toThrow(
      /permission denied/,
    );
    const grants = (
      await owner(
        `SELECT has_column_privilege('ownpace_system', 'contract_withdrawal', 'withdrawn_at', 'SELECT') AS reads_when,
                has_column_privilege('ownpace_system', 'contract_withdrawal', 'tenant_id', 'SELECT') AS reads_whose,
                has_column_privilege('ownpace_system', 'contract_withdrawal', 'name', 'SELECT') AS reads_name,
                has_column_privilege('ownpace_system', 'contract_withdrawal', 'confirm_to', 'SELECT') AS reads_address`,
      )
    ).rows[0];
    expect(grants).toEqual({ reads_when: true, reads_whose: true, reads_name: false, reads_address: false });
  });
});
