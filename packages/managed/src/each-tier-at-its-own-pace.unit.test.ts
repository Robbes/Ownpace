// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH TIER AT ITS OWN PACE (workplan 0157 T2): `pace.ts`.
 *
 *  - Free runs one pass a day, outside the alpha; a paid tier has no floor
 *    beyond its schedule's; in the alpha every tier runs at a paid tier's pace
 *    (the owner, 2026-10-04), with the stage read as `holdsAtCeiling` reads it;
 *  - the tier is the one the month bills, read as the Billing page reads it:
 *    what was used, never above the agreed tier, with the alpha's data left
 *    out. So a yes to Small with little used is Free's pace, and data past
 *    Free's ceiling with no yes is Free's too: the pace follows what is paid.
 *
 * PGlite as `app_user`, both chains, each read in the organisation's own
 * transaction as the API reads it. The tick reads the same tables over the
 * system role, which managed 0041 grants (the system-role integration test
 * holds the grants). The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';
import { PgDataAllowanceStore } from './data-ceiling.ts';
import { billedTierNow, FREE_PASS_EVERY_MINUTES, leastMinutesBetweenPasses, nextPassByPace } from './pace.ts';

// UUID family 0157a000-…, unused elsewhere in the repo.
const NOTHING_YET = '0157a000-e29b-41d4-a716-446655440001' as TenantId;
const YES_USES_LITTLE = '0157a000-e29b-41d4-a716-446655440002' as TenantId;
const YES_USES_IT = '0157a000-e29b-41d4-a716-446655440003' as TenantId;
const NO_YES_PAST_FREE = '0157a000-e29b-41d4-a716-446655440004' as TenantId;
const ALPHAS_DATA = '0157a000-e29b-41d4-a716-446655440005' as TenantId;

const NOW = new Date();
const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;
const GB = 1_000_000_000;

let driver: LedgerDriver;

async function owner(sql: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

const billed = (tenantId: TenantId) => withTenant(driver, tenantId, (db) => billedTierNow(db, tenantId, NOW));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [NOTHING_YET, 'Nothing Yet BV'],
    [YES_USES_LITTLE, 'Yes Uses Little BV'],
    [YES_USES_IT, 'Yes Uses It BV'],
    [NO_YES_PAST_FREE, 'No Yes BV'],
    [ALPHAS_DATA, 'Alpha Data BV'],
  ] as const) {
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [id, name]);
  }
  // A yes to Small, as the Billing page records one.
  for (const tenantId of [YES_USES_LITTLE, YES_USES_IT]) {
    await withTenant(driver, tenantId, (db) =>
      new PgDataAllowanceStore(db).record(
        tenantId,
        { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb, priceEur: 5 },
        'someone@example.invalid',
      ),
    );
  }
  // 200 GB: past Free's 150 GB, within Small's 500.
  await owner(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, $2)`, [YES_USES_IT, 200 * GB]);
  await owner(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, $2)`, [NO_YES_PAST_FREE, 200 * GB]);
  // The same 200 GB, all moved during the alpha, which never counts (managed 0040).
  await owner(`INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes) VALUES ($1, $2, $2)`, [ALPHAS_DATA, 200 * GB]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the pace, from the tier the month bills and the stage', () => {
  it('is one pass a day on Free, outside the alpha', () => {
    expect(FREE_PASS_EVERY_MINUTES).toBe(1440);
    expect(leastMinutesBetweenPasses(tier('free'), undefined)).toBe(1440);
    expect(leastMinutesBetweenPasses(tier('free'), 'live')).toBe(1440);
  });

  it('has no floor of its own on a paid tier', () => {
    for (const id of ['small', 'medium', 'large', 'xl']) {
      expect(leastMinutesBetweenPasses(tier(id), undefined), id).toBe(0);
    }
  });

  it("is a paid tier's for every tier in the alpha, read as the ceiling reads the stage", () => {
    for (const stage of ['alpha', ' Alpha ', 'ALPHA']) {
      expect(leastMinutesBetweenPasses(tier('free'), stage), JSON.stringify(stage)).toBe(0);
    }
  });

  it('names when the pace lets the next pass run: a day after the last one started', () => {
    expect(nextPassByPace(new Date('2026-10-05T07:12:00Z'), 1440).toISOString()).toBe('2026-10-06T07:12:00.000Z');
  });
});

describe('the tier the month bills, read as the Billing page reads it', () => {
  it('is Free for an organisation that has moved nothing and said no yes', async () => {
    expect((await billed(NOTHING_YET)).id).toBe('free');
  });

  it('is Free after a yes to Small while what is used fits Free: the pace follows what is paid', async () => {
    expect((await billed(YES_USES_LITTLE)).id).toBe('free');
  });

  it('is Small after that yes once the data is past what Free holds', async () => {
    expect((await billed(YES_USES_IT)).id).toBe('small');
  });

  it('stays Free past its ceiling without a yes: nothing climbs past a yes', async () => {
    expect((await billed(NO_YES_PAST_FREE)).id).toBe('free');
  });

  it("leaves the alpha's data out, as every count of the meter does", async () => {
    expect((await billed(ALPHAS_DATA)).id).toBe('free');
  });
});
