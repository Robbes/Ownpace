// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A YES THAT ASKS TO BEGIN (workplan 0111, T7, slice 7e; terms §7, 1.5; the
 * owner, 2026-10-11: *"i do not want the tickbox"*): `yesAsksToBegin`, the
 * request recorded with a yes (managed 0051), and the window and the
 * withdrawal that read it, on a real database as `app_user`.
 *
 *  - a yes asks to begin for a consumer (or an organisation without invoice
 *    details yet) on Free or within the fourteen days; never for a business,
 *    nor after the fourteen days;
 *  - the request is the concluding yes's: a later yes that asked does not
 *    make an earlier contract one that began on request;
 *  - a consumer who asked and withdraws pays for the days used, in proportion;
 *    one who did not is credited in full (slice 7b, unchanged);
 *  - a yes recorded without saying records no request.
 *
 * PGlite, both chains. The names and addresses are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { PgDataAllowanceStore } from './data-ceiling.ts';
import { openTheMonth } from './month-invoice.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';
import {
  readWithdrawalWindow,
  readYesAsksToBegin,
  withdraw,
  yesAsksToBegin,
  type WithdrawalWindow,
} from './withdrawal.ts';

// UUID family 01117e10-…, unused elsewhere in the repo.
const ASKED = '01117e10-e29b-41d4-a716-446655440001' as TenantId;
const ASKED_LATER = '01117e10-e29b-41d4-a716-446655440002' as TenantId;
const BUSINESS = '01117e10-e29b-41d4-a716-446655440003' as TenantId;
const NO_DETAILS = '01117e10-e29b-41d4-a716-446655440004' as TenantId;
const OCT_1 = new Date('2026-10-01T10:23:00Z');
const OCT_3 = new Date('2026-10-03T10:04:00Z');
const NOV_1 = new Date('2026-11-01T00:23:00Z');
const GB = 1_000_000_000n;

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;

describe('yesAsksToBegin', () => {
  const since = new Date('2026-10-01T09:30:00Z');
  const until = new Date('2026-10-16T00:00:00Z');
  const open: WithdrawalWindow = { kind: 'open', since, until, tier: 'small', beganOnRequest: false };
  const closed = (reason: 'nothing_paid' | 'business' | 'past'): WithdrawalWindow => ({
    kind: 'closed',
    reason,
    since: reason === 'nothing_paid' ? null : since,
    until: reason === 'nothing_paid' ? null : until,
  });

  it('asks a consumer on Free or within the fourteen days, never a business, nor after them', () => {
    expect(yesAsksToBegin('consumer', closed('nothing_paid'))).toBe(true);
    expect(yesAsksToBegin('consumer', open)).toBe(true);
    expect(yesAsksToBegin(null, closed('nothing_paid'))).toBe(true);
    expect(yesAsksToBegin('consumer', closed('past'))).toBe(false);
    expect(yesAsksToBegin('business', closed('business'))).toBe(false);
    expect(yesAsksToBegin('business', closed('nothing_paid'))).toBe(false);
  });
});

describe('the request, recorded with a yes and read by the window', () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const yes = async (tenantId: TenantId, tierId: 'small' | 'medium', at: string, beganOnRequest?: boolean) => {
    await withTenant(driver, tenantId, (db) =>
      new PgDataAllowanceStore(db).record(
        tenantId,
        { kind: 'tier', tierId, bandGb: tier(tierId).dataGb, priceEur: tierId === 'small' ? 5 : 12 },
        'the-owner',
        'data',
        ...(beganOnRequest === undefined ? [] : [beganOnRequest]),
      ),
    );
    await owner(`UPDATE data_allowance SET consented_at = $2 WHERE tenant_id = $1 AND consented_at > now() - interval '1 minute'`, [
      tenantId,
      at,
    ]);
  };

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Asked'), ($2, 'Asked Later'), ($3, 'A Business BV'), ($4, 'No Details')`, [
      ASKED,
      ASKED_LATER,
      BUSINESS,
      NO_DETAILS,
    ]);
    for (const [tenantId, kind] of [
      [ASKED, 'consumer'],
      [ASKED_LATER, 'consumer'],
      [BUSINESS, 'business'],
    ] as const) {
      await owner(
        `INSERT INTO billing_party (tenant_id, kind, name, address_line1, postal_code, city, country_code)
         VALUES ($1, $2, 'Sam de Vries', 'Dorpsstraat 1', '1234 AB', 'Ons Dorp', 'NL')`,
        [tenantId, kind],
      );
    }
    // Past Free's room, so the month bills the tier said yes to.
    await owner(`INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes) VALUES ($1, $2, 0)`, [ASKED, String(320n * GB)]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('asks on Free, records the request, and bills the days used when the consumer withdraws', async () => {
    expect(await withTenant(driver, ASKED, (db) => readYesAsksToBegin(db, ASKED, OCT_1))).toBe(true);
    await yes(ASKED, 'small', '2026-10-01T09:30:00Z', true);
    expect(await withTenant(driver, ASKED, (db) => readWithdrawalWindow(db, ASKED, OCT_3))).toMatchObject({
      kind: 'open',
      beganOnRequest: true,
    });
    // Within the window a yes still asks; after it, none does.
    expect(await withTenant(driver, ASKED, (db) => readYesAsksToBegin(db, ASKED, OCT_3))).toBe(true);
    expect(await withTenant(driver, ASKED, (db) => readYesAsksToBegin(db, ASKED, NOV_1))).toBe(false);

    expect((await withTenant(driver, ASKED, (db) => openTheMonth(db, ASKED, OCT_1, 'en'))).kind).toBe('made');
    const outcome = await withTenant(driver, ASKED, (db) =>
      withdraw(db, ASKED, { by: 'the-owner', name: 'Sam de Vries', confirmTo: 'sam@example.invalid', language: 'en', via: 'screen' }, OCT_3),
    );
    // The first, the second and the third of October were used; the rest is credited.
    expect(outcome).toMatchObject({
      kind: 'withdrawn',
      beganOnRequest: true,
      credits: [{ share: { daysPaid: 31, daysUsed: 3, numerator: 28, denominator: 31 } }],
    });
    expect((await owner(`SELECT began_on_request FROM contract_withdrawal WHERE tenant_id = $1`, [ASKED])).rows).toEqual([
      { began_on_request: true },
    ]);
  });

  it('reads the request from the yes that concluded the contract, not a later one', async () => {
    await yes(ASKED_LATER, 'small', '2026-10-01T09:30:00Z', false);
    await yes(ASKED_LATER, 'medium', '2026-10-02T09:30:00Z', true);
    expect(await withTenant(driver, ASKED_LATER, (db) => readWithdrawalWindow(db, ASKED_LATER, OCT_3))).toMatchObject({
      kind: 'open',
      tier: 'medium',
      beganOnRequest: false,
    });
  });

  it('never asks a business, asks an organisation without invoice details, and records none unless told', async () => {
    expect(await withTenant(driver, BUSINESS, (db) => readYesAsksToBegin(db, BUSINESS, OCT_1))).toBe(false);
    expect(await withTenant(driver, NO_DETAILS, (db) => readYesAsksToBegin(db, NO_DETAILS, OCT_1))).toBe(true);
    await yes(BUSINESS, 'small', '2026-10-01T09:30:00Z');
    expect((await owner(`SELECT began_on_request FROM data_allowance WHERE tenant_id = $1`, [BUSINESS])).rows).toEqual([
      { began_on_request: false },
    ]);
  });
});
