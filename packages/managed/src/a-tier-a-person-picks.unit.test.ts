// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TIER A PERSON PICKS (workplan 0157 T6): `tier-pick.ts`, and what it does
 * to the tier the month bills.
 *
 *  - a month bills at least the pick standing when it began and every pick
 *    made during it: a raise counts at once, a lower pick from the next month,
 *    and Free is no floor;
 *  - offered: every tier above the one this month bills, and the tier picked
 *    now while a lower pick waits; lower: every tier below the pick standing
 *    for the next month;
 *  - a pick is refused when its tier or price is not what is offered, and a
 *    pick above the agreed tier carries a yes;
 *  - the tier billed never falls below the pick, nor climbs past a yes;
 *  - on a real database, as the API and the tick read it: a pick of Small on
 *    Free bills Small at once, so the pace follows it.
 *
 * PGlite as `app_user`, both chains, each read in the organisation's own
 * transaction. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';
import { allowanceOf, PgDataAllowanceStore } from './data-ceiling.ts';
import { billedTierOf } from './billed-tier.ts';
import { leastMinutesBetweenPasses, readBilledNow } from './pace.ts';
import {
  decidePick,
  monthStartOf,
  nextMonthStartOf,
  pickedFloorOf,
  pickOffers,
  PgTierPickStore,
  type TierPickRow,
} from './tier-pick.ts';

const tier = (id: string): ManagedTier => MANAGED_TIERS.find((t) => t.id === id)!;
const ids = (tiers: readonly ManagedTier[] | readonly { id: string }[]) => tiers.map((t) => t.id);
const at = (iso: string) => new Date(iso);
const pick = (tierId: ManagedTier['id'], when: string): TierPickRow => ({ tierId, pickedAt: at(when) });

describe('the months a pick counts in', () => {
  const OCT_20 = at('2026-10-20T12:00:00Z');

  it('has no floor without a pick', () => {
    expect(pickedFloorOf([], OCT_20)).toEqual({ now: null, next: null, nextFrom: at('2026-11-01T00:00:00Z') });
  });

  it('counts a raise at once, and in the months after', () => {
    const picks = [pick('small', '2026-10-05T09:00:00Z')];
    expect(pickedFloorOf(picks, OCT_20).now?.id).toBe('small');
    expect(pickedFloorOf(picks, OCT_20).next?.id).toBe('small');
    expect(pickedFloorOf(picks, at('2027-02-01T00:00:00Z')).now?.id).toBe('small');
  });

  it('counts a lower pick from the next month: the month it was made in keeps the higher one', () => {
    const picks = [pick('large', '2026-09-10T09:00:00Z'), pick('small', '2026-10-05T09:00:00Z')];
    const october = pickedFloorOf(picks, OCT_20);
    expect(october.now?.id).toBe('large');
    expect(october.next?.id).toBe('small');
    expect(pickedFloorOf(picks, at('2026-11-01T00:00:00Z')).now?.id).toBe('small');
  });

  it('bills a month at least every pick made during it, even one lowered again since', () => {
    const picks = [pick('large', '2026-10-03T09:00:00Z'), pick('free', '2026-10-04T09:00:00Z')];
    expect(pickedFloorOf(picks, OCT_20)).toMatchObject({ now: tier('large'), next: null });
    expect(pickedFloorOf(picks, at('2026-11-02T00:00:00Z')).now).toBeNull();
  });

  it('takes Free as no floor, from the month after', () => {
    const picks = [pick('medium', '2026-08-01T09:00:00Z'), pick('free', '2026-09-30T23:59:59Z')];
    expect(pickedFloorOf(picks, at('2026-09-30T23:59:59Z')).now?.id).toBe('medium');
    expect(pickedFloorOf(picks, at('2026-10-01T00:00:00Z')).now).toBeNull();
  });

  it('reads months in UTC, and reads no pick made after the moment asked', () => {
    expect(monthStartOf(at('2026-10-31T23:30:00-02:00')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(nextMonthStartOf(at('2026-12-15T00:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(pickedFloorOf([pick('xl', '2026-10-21T00:00:00Z')], OCT_20).now).toBeNull();
  });

  it('reads the picks in the order they were made, whatever order they came in', () => {
    const picks = [pick('small', '2026-10-05T09:00:00Z'), pick('large', '2026-09-10T09:00:00Z')];
    expect(pickedFloorOf(picks, at('2026-11-05T00:00:00Z')).now?.id).toBe('small');
  });
});

describe('what may be picked', () => {
  const none = pickedFloorOf([], at('2026-10-20T12:00:00Z'));

  it('offers every tier above the one this month bills, and nothing to lower without a pick', () => {
    expect(ids(pickOffers(tier('free'), none).raise)).toEqual(['small', 'medium', 'large', 'xl']);
    expect(ids(pickOffers(tier('medium'), none).raise)).toEqual(['large', 'xl']);
    expect(pickOffers(tier('free'), none).lower).toEqual([]);
  });

  it('offers nothing above Extra large', () => {
    expect(pickOffers(tier('xl'), none).raise).toEqual([]);
  });

  it('offers every tier below the pick standing for the next month, down to Free', () => {
    const floor = pickedFloorOf([pick('large', '2026-10-05T09:00:00Z')], at('2026-10-20T12:00:00Z'));
    expect(ids(pickOffers(tier('large'), floor).lower)).toEqual(['free', 'small', 'medium']);
  });

  it('offers the tier picked now again while a lower pick waits, to keep it', () => {
    const floor = pickedFloorOf(
      [pick('large', '2026-09-10T09:00:00Z'), pick('small', '2026-10-05T09:00:00Z')],
      at('2026-10-20T12:00:00Z'),
    );
    const offers = pickOffers(tier('large'), floor);
    expect(ids(offers.raise)).toEqual(['large', 'xl']);
    expect(ids(offers.lower)).toEqual(['free']);
  });
});

describe('a pick, checked against what is offered', () => {
  const none = pickedFloorOf([], at('2026-10-20T12:00:00Z'));
  const onFree = allowanceOf([]);
  const onMedium = allowanceOf([{ kind: 'tier', tierId: 'medium', bandGb: tier('medium').dataGb }]);

  it('takes a raise at its monthly price, at once, with the yes it carries above the agreed tier', () => {
    expect(decidePick(pickOffers(tier('free'), none), onFree, { tierId: 'small', priceEur: 5 })).toEqual({
      ok: true,
      pick: { tierId: 'small', priceEur: 5 },
      from: 'now',
      yes: { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb, priceEur: 5 },
    });
  });

  it('carries no yes for a tier already agreed', () => {
    const decision = decidePick(pickOffers(tier('free'), none), onMedium, { tierId: 'small', priceEur: 5 });
    expect(decision).toMatchObject({ ok: true, from: 'now', yes: null });
  });

  it('takes a lower pick from the next month, with no yes', () => {
    const floor = pickedFloorOf([pick('large', '2026-10-05T09:00:00Z')], at('2026-10-20T12:00:00Z'));
    const offers = pickOffers(tier('large'), floor);
    expect(decidePick(offers, onMedium, { tierId: 'free', priceEur: 0 })).toEqual({
      ok: true,
      pick: { tierId: 'free', priceEur: 0 },
      from: 'next_month',
      yes: null,
    });
  });

  it('refuses a price that is not the monthly shown, and a tier not offered', () => {
    const offers = pickOffers(tier('medium'), none);
    expect(decidePick(offers, onMedium, { tierId: 'large', priceEur: 39 })).toEqual({
      ok: false,
      reason: 'offer_changed',
    });
    for (const tierId of ['small', 'medium', 'free', 'gold']) {
      expect(decidePick(offers, onMedium, { tierId, priceEur: 0 }), tierId).toEqual({
        ok: false,
        reason: 'offer_changed',
      });
    }
  });
});

describe('the tier billed, with a pick', () => {
  const smallYes = { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb } as const;

  it('is the pick when what was used is below it, and says so', () => {
    expect(billedTierOf(tier('free'), allowanceOf([smallYes]), 1, 10, tier('small'))).toEqual({
      tier: tier('small'),
      beyond: [],
      picked: true,
    });
  });

  it('is what was used when that is at or above the pick', () => {
    const agreedMedium = allowanceOf([{ kind: 'tier', tierId: 'medium', bandGb: tier('medium').dataGb }]);
    expect(billedTierOf(tier('medium'), agreedMedium, 8, 10, tier('small'))).toEqual({
      tier: tier('medium'),
      beyond: [],
      picked: false,
    });
  });

  it('never climbs past a yes, a pick above the agreed tier included', () => {
    expect(billedTierOf(tier('free'), allowanceOf([smallYes]), 1, 10, tier('large')).tier.id).toBe('small');
  });

  it('keeps saying why when what was used is past the agreed tier', () => {
    expect(billedTierOf(tier('medium'), allowanceOf([smallYes]), 8, 10, tier('small'))).toEqual({
      tier: tier('small'),
      beyond: ['paths'],
      picked: false,
    });
  });
});

// UUID family 01576000-…, unused elsewhere in the repo.
const PICKS_SMALL = '01576000-e29b-41d4-a716-446655440001' as TenantId;
const PICKED_ELSEWHERE = '01576000-e29b-41d4-a716-446655440002' as TenantId;

describe('a pick on a real database, as the API and the tick read it', () => {
  let driver: LedgerDriver;
  const NOW = new Date();

  async function owner(sql: string, params: unknown[] = []): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(sql, params);
    } finally {
      await conn.release();
    }
  }

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Picks Small BV'), ($2, 'Picked Elsewhere BV')`, [
      PICKS_SMALL,
      PICKED_ELSEWHERE,
    ]);
    await withTenant(driver, PICKED_ELSEWHERE, (db) =>
      new PgTierPickStore(db).record(PICKED_ELSEWHERE, { tierId: 'xl', priceEur: 80 }, 'someone@example.invalid', NOW),
    );
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('bills Free, at one pass a day, before the pick', async () => {
    const before = await withTenant(driver, PICKS_SMALL, (db) => readBilledNow(db, PICKS_SMALL, NOW));
    expect(before.billed).toMatchObject({ tier: { id: 'free' }, picked: false });
    expect(leastMinutesBetweenPasses(before.billed.tier, undefined)).toBe(1440);
  });

  it('bills Small at once after a pick of Small with its yes, so the pace is a paid tier’s', async () => {
    await withTenant(driver, PICKS_SMALL, async (db) => {
      await new PgTierPickStore(db).record(PICKS_SMALL, { tierId: 'small', priceEur: 5 }, 'someone@example.invalid', NOW);
      await new PgDataAllowanceStore(db).record(
        PICKS_SMALL,
        { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb, priceEur: 5 },
        'someone@example.invalid',
        'pick',
      );
    });
    const after = await withTenant(driver, PICKS_SMALL, (db) => readBilledNow(db, PICKS_SMALL, NOW));
    expect(after.billed).toMatchObject({ tier: { id: 'small' }, picked: true });
    expect(after.allowance.tier.id).toBe('small');
    expect(after.floor.now?.id).toBe('small');
    expect(leastMinutesBetweenPasses(after.billed.tier, undefined)).toBe(0);
  });

  it("reads only the organisation's own picks", async () => {
    const picks = await withTenant(driver, PICKS_SMALL, (db) => new PgTierPickStore(db).picks(PICKS_SMALL));
    expect(picks.map((p) => p.tierId)).toEqual(['small']);
    const theirs = await withTenant(driver, PICKS_SMALL, (db) => new PgTierPickStore(db).picks(PICKED_ELSEWHERE));
    expect(theirs).toEqual([]);
  });

  /** What the database said to a statement run as the organisation, or null when it ran. */
  const refusal = (statement: string): Promise<string | null> =>
    withTenant(driver, PICKS_SMALL, (db) => db.execute(sql.raw(statement))).then(
      () => null,
      (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ''}`,
    );

  it('takes no pick back: the request path may not update or delete one', async () => {
    expect(await refusal(`UPDATE tier_pick SET tier_id = 'xl'`)).toMatch(/permission denied/);
    expect(await refusal(`DELETE FROM tier_pick`)).toMatch(/permission denied/);
  });

  it('refuses a tier the table does not have', async () => {
    await expect(
      owner(`INSERT INTO tier_pick (tenant_id, tier_id, price_eur, picked_by) VALUES ($1, 'gold', 1, 'x')`, [
        PICKS_SMALL,
      ]),
    ).rejects.toThrow(/tier_pick_tier_check/);
  });
});
