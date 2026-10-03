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
  ceilingOf,
  decideYes,
  holdsAtCeiling,
  topUpPriceEur,
  type AllowanceGrant,
} from './data-ceiling.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;
const small = tier('small');
const medium = tier('medium');

describe('the allowance', () => {
  it('is Tiny until the customer moves up', () => {
    const a = allowanceOf([]);
    expect(a.tier.id).toBe('tiny');
    expect(a.ceilingGb).toBe(tier('tiny').dataGb);
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

  it('offers no top-up on Tiny: from Tiny the only way out is moving up', () => {
    const c = ceilingOf(allowanceOf([]), 240);
    expect(c.topUp).toBeNull();
    expect(c.moveUp?.tier.id).toBe('small');
    expect(c.moveUp?.setupEur).toBe(small.setup);
    expect(topUpPriceEur(tier('tiny'))).toBeNull();
  });

  it('prices a move up at the difference in setup, then the new monthly', () => {
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);
    expect(c.moveUp?.tier.id).toBe('medium');
    expect(c.moveUp?.setupEur).toBe(medium.setup - small.setup);
    expect(c.moveUp?.monthlyEur).toBe(medium.monthly);
  });

  it('prices a top-up at the tier\'s own setup fee, for another whole band, in force until 0152 T6 (d)', () => {
    const c = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);
    expect(c.topUp).toEqual({ tierId: 'small', bandGb: small.dataGb, priceEur: small.setup, ceilingGb: 2 * small.dataGb });
  });

  it('moves up to a tier that lifts the hold, not to one the data is already past', () => {
    // 800 GB on Tiny: Small's 750 GB would land on its ceiling again.
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
    expect(c.topUp?.priceEur).toBe(xl.setup);
  });
});

describe('a yes', () => {
  const onSmall = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: small.dataGb }]), 700);

  it('to the offer shown becomes its row', () => {
    expect(decideYes(onSmall, { choice: 'top_up', tierId: 'small', priceEur: small.setup })).toEqual({
      ok: true,
      grant: { kind: 'top_up', tierId: 'small', bandGb: small.dataGb, priceEur: small.setup },
    });
    expect(decideYes(onSmall, { choice: 'move_up', tierId: 'medium', priceEur: medium.setup - small.setup })).toEqual({
      ok: true,
      grant: { kind: 'tier', tierId: 'medium', bandGb: medium.dataGb, priceEur: medium.setup - small.setup },
    });
  });

  it('to a tier or a price that is not offered now is refused: nobody agrees to a price they were not shown', () => {
    expect(decideYes(onSmall, { choice: 'move_up', tierId: 'large', priceEur: 42 })).toEqual({ ok: false, reason: 'offer_changed' });
    expect(decideYes(onSmall, { choice: 'top_up', tierId: 'small', priceEur: 1 })).toEqual({ ok: false, reason: 'offer_changed' });
  });

  it('to a top-up on Tiny is refused, and so is a move past Extra large', () => {
    expect(decideYes(ceilingOf(allowanceOf([]), 10), { choice: 'top_up', tierId: 'tiny', priceEur: 0 })).toEqual({
      ok: false,
      reason: 'no_top_up_on_tiny',
    });
    const xl = tier('xl');
    const top = ceilingOf(allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: xl.dataGb }]), 1);
    expect(decideYes(top, { choice: 'move_up', tierId: 'xl', priceEur: 0 })).toEqual({ ok: false, reason: 'talk_to_us' });
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
