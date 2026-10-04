// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The data ceiling and the yes that moves it (workplan 0109 T6, ADR-0014's
 * amendment of 2026-10-03): the ceiling is the highest tier moved up to plus
 * every band bought, both ways out are offered from 80%, and a yes is taken
 * only for the offer the customer was shown.
 */

import { describe, it, expect } from 'vitest';
import {
  allowanceOf,
  breakEvenOf,
  ceilingHoldReason,
  ceilingOf,
  firstCopyGate,
  decideYes,
  holdsAtCeiling,
  monthlyEur,
  topUpPriceEur,
  type AllowanceGrant,
} from './data-ceiling.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;
const small = tier('small');
const medium = tier('medium');

describe('the allowance', () => {
  it('is Free until the customer moves up', () => {
    const a = allowanceOf([]);
    expect(a.tier.id).toBe('free');
    expect(a.ceilingGb).toBe(tier('free').dataGb);
    expect(a.topUps).toBe(0);
  });

  it('is the highest tier moved up to, whatever the order: the data axis never falls', () => {
    const grants: AllowanceGrant[] = [
      { kind: 'tier', tierId: 'medium', bandGb: medium.dataGb },
      { kind: 'tier', tierId: 'small', bandGb: small.dataGb },
    ];
    expect(allowanceOf(grants).tier.id).toBe('medium');
  });

  it('adds every band bought, and a purchase outlives a later move up', () => {
    const grants: AllowanceGrant[] = [
      { kind: 'tier', tierId: 'small', bandGb: small.dataGb },
      { kind: 'top_up', tierId: 'small', bandGb: small.dataGb },
      { kind: 'tier', tierId: 'medium', bandGb: medium.dataGb },
    ];
    const a = allowanceOf(grants);
    expect(a.tier.id).toBe('medium');
    expect(a.ceilingGb).toBe(medium.dataGb + small.dataGb);
    expect(a.topUps).toBe(1);
  });
});

describe('the ceiling', () => {
  it('is under below 80%, near from 80%, and reached at the ceiling', () => {
    const a = allowanceOf([]);
    expect(ceilingOf(a, a.ceilingGb * 0.79).state).toBe('under');
    expect(ceilingOf(a, a.ceilingGb * 0.8).state).toBe('near');
    expect(ceilingOf(a, a.ceilingGb).state).toBe('reached');
    expect(ceilingOf(a, a.ceilingGb * 2).state).toBe('reached');
  });

  it('offers no top-up on Free: from Free the only way out is moving up', () => {
    const c = ceilingOf(allowanceOf([]), 240);
    expect(c.topUp).toBeNull();
    expect(c.moveUp?.tier.id).toBe('small');
    expect(c.moveUp?.monthlyEur).toBe(5);
    expect(topUpPriceEur(tier('free'))).toBeNull();
  });

  it('prices a move up at the new monthly, and nothing once: the list of 2026-09-29 has no setup fee', () => {
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);
    expect(c.moveUp).toEqual({ tier: medium, monthlyEur: 12, ceilingGb: medium.dataGb });
  });

  it('prices a top-up at the tier\'s monthly, once, for another whole band (the owner\'s answer (b))', () => {
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);
    expect(c.topUp).toEqual({ tierId: 'small', bandGb: small.dataGb, priceEur: 5, ceilingGb: 2 * small.dataGb });
  });

  it('prices in whole euros, the unit a yes is recorded in (`data_allowance.price_eur`)', () => {
    for (const t of MANAGED_TIERS) expect(Number.isInteger(monthlyEur(t)), t.id).toBe(true);
  });

  it('moves up to a tier that lifts the hold, not to one the data is already past', () => {
    // 800 GB on Free: Small's 500 GB would land on its ceiling again.
    const c = ceilingOf(allowanceOf([]), 800);
    expect(c.state).toBe('reached');
    expect(c.moveUp?.tier.id).toBe('medium');
    expect(c.moveUp!.ceilingGb).toBeGreaterThan(800);
  });

  it('keeps the bands bought when it offers a move up', () => {
    const grants: AllowanceGrant[] = [
      { kind: 'tier', tierId: 'small', bandGb: small.dataGb },
      { kind: 'top_up', tierId: 'small', bandGb: small.dataGb },
    ];
    expect(ceilingOf(allowanceOf(grants), 1400).moveUp?.ceilingGb).toBe(medium.dataGb + small.dataGb);
  });

  it('has no tier to move up to past Extra large: the published answer is "talk to us"', () => {
    const xl = tier('xl');
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: xl.dataGb }]), xl.dataGb);
    expect(c.moveUp).toBeNull();
    expect(c.topUp?.priceEur).toBe(monthlyEur(xl));
  });
});

describe('the break-even', () => {
  it('on Small: the top-up is €5 once, it saves €7 a month against Medium, and pays back in about three weeks', () => {
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);
    expect(breakEvenOf(c)).toEqual({ extraOnceEur: 5, savedMonthlyEur: 7, paysBackInDays: 22 });
  });

  it('never pays back at once: a top-up costs a month\'s price once, and a move up nothing once', () => {
    for (const id of ['small', 'medium', 'large']) {
      const t = tier(id);
      const b = breakEvenOf(ceilingOf(allowanceOf([{ kind: 'tier', tierId: id as 'small', bandGb: t.dataGb }]), t.dataGb))!;
      expect(b.extraOnceEur, id).toBe(monthlyEur(t));
      expect(b.paysBackInDays, id).toBeGreaterThan(0);
    }
  });

  it('is not said when only one way on is offered', () => {
    expect(breakEvenOf(ceilingOf(allowanceOf([]), 240))).toBeNull();
    const xl = tier('xl');
    expect(breakEvenOf(ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: xl.dataGb }]), 1))).toBeNull();
  });
});

describe('a yes', () => {
  const onSmall = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);

  it('to the offer shown becomes its row', () => {
    expect(decideYes(onSmall, { choice: 'top_up', tierId: 'small', priceEur: 5 })).toEqual({
      ok: true,
      grant: { kind: 'top_up', tierId: 'small', bandGb: small.dataGb, priceEur: 5 },
    });
    // A move up's price is the monthly agreed to: there is nothing to pay once.
    expect(decideYes(onSmall, { choice: 'move_up', tierId: 'medium', priceEur: 12 })).toEqual({
      ok: true,
      grant: { kind: 'tier', tierId: 'medium', bandGb: medium.dataGb, priceEur: 12 },
    });
  });

  it('to a tier or a price that is not offered now is refused: nobody agrees to a price they were not shown', () => {
    expect(decideYes(onSmall, { choice: 'move_up', tierId: 'large', priceEur: 42 })).toEqual({ ok: false, reason: 'offer_changed' });
    expect(decideYes(onSmall, { choice: 'top_up', tierId: 'small', priceEur: 1 })).toEqual({ ok: false, reason: 'offer_changed' });
    // The move up's old price, the setup difference, is not what is offered now.
    expect(decideYes(onSmall, { choice: 'move_up', tierId: 'medium', priceEur: 7 })).toEqual({ ok: false, reason: 'offer_changed' });
  });

  it('to a top-up on Free is refused, and so is a move past Extra large', () => {
    expect(decideYes(ceilingOf(allowanceOf([]), 10), { choice: 'top_up', tierId: 'free', priceEur: 0 })).toEqual({
      ok: false,
      reason: 'no_top_up_on_free',
    });
    const xl = tier('xl');
    const top = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: xl.dataGb }]), 1);
    expect(decideYes(top, { choice: 'move_up', tierId: 'xl', priceEur: 0 })).toEqual({ ok: false, reason: 'talk_to_us' });
  });
});

describe('the hold', () => {
  it('lets a first copy through while the meter, with this pass, is below the ceiling', () => {
    const gate = firstCopyGate(ceilingOf(allowanceOf([]), 149));
    expect(gate(0)).toBe(true);
    expect(gate(999_999_999)).toBe(true);
    expect(gate(1_000_000_000)).toBe(false);
  });

  it('holds every first copy from the first when the ceiling was reached before the pass', () => {
    expect(firstCopyGate(ceilingOf(allowanceOf([]), 150))(0)).toBe(false);
  });

  it('says what waits and both ways on, with their prices', () => {
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 500);
    expect(ceilingHoldReason(c, 3)).toEqual({
      kind: 'data-ceiling',
      ceilingGb: small.dataGb,
      held: 3,
      moveUp: { name: medium.name, monthlyEur: 12 },
      topUp: { bandGb: small.dataGb, priceEur: 5 },
    });
    expect(ceilingHoldReason(ceilingOf(allowanceOf([]), 150), 1)).toMatchObject({ topUp: null });
  });
});

describe('the hold, by stage', () => {
  it('holds everywhere but the alpha, where nothing is charged (the owner, 2026-10-03: "A")', () => {
    expect(holdsAtCeiling(undefined)).toBe(true);
    expect(holdsAtCeiling('')).toBe(true);
    expect(holdsAtCeiling('alpha')).toBe(false);
    expect(holdsAtCeiling(' Alpha ')).toBe(false);
  });
});
