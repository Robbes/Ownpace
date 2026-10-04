// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A start past the agreed tier's paths (workplan 0109 T6, the path axis): when
 * it waits, which tier runs it, and the sentence that says so; the question at
 * *Start* before the press, with what fits now, and the yes that answers it.
 * The doors that ask it are held in
 * `apps/api/src/routes/migrations/a-start-past-the-tier.unit.test.ts`, the
 * question's routes in `apps/api/src/routes/billing/a-yes-before-more-run-at-once.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { allowanceOf, monthlyEur } from './data-ceiling.ts';
import { decidePathsYes, pathsForecast, pathsPastTheTier, pathsPastTheTierReason } from './path-ceiling.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';

const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;
/** The free first tier, by place rather than by name: Tiny, Free once the 2026-09-29 list is in force. */
const first = MANAGED_TIERS[0]!;
const onTiny = allowanceOf([]);
const onSmall = allowanceOf([{ kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb }]);

describe('a start', () => {
  it('within the agreed tier goes ahead', () => {
    expect(pathsPastTheTier(onTiny, 0, 1)).toBeNull();
    expect(pathsPastTheTier(onSmall, 1, tier('small').paths)).toBeNull();
  });

  it('past it waits, and names the smallest tier that runs it all', () => {
    // Free and Small both run six (ADR-0014, 2026-10-04): past Free's paths is Medium.
    expect(pathsPastTheTier(onTiny, 0, 7)).toEqual({ tier: first, after: 7, needs: tier('medium') });
    expect(pathsPastTheTier(onSmall, 6, 7)?.needs).toEqual(tier('medium'));
  });

  it('that takes no new slot is never refused, though the organisation is past its tier already', () => {
    // An organisation that ran eight during the alpha may pause and resume them.
    expect(pathsPastTheTier(onTiny, 8, 8)).toBeNull();
    expect(pathsPastTheTier(onTiny, 8, 7)).toBeNull();
  });

  it('past Extra large names no tier: the published answer is "talk to us"', () => {
    const xl = allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: tier('xl').dataGb }]);
    expect(pathsPastTheTier(xl, tier('xl').paths, tier('xl').paths + 1)?.needs).toBeNull();
  });

  it('a top-up buys room, never lanes: it does not raise the paths', () => {
    const toppedUp = allowanceOf([
      { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb },
      { kind: 'top_up', tierId: 'small', bandGb: tier('small').dataGb },
    ]);
    expect(pathsPastTheTier(toppedUp, 6, 7)).not.toBeNull();
  });
});

describe('the sentence', () => {
  it('says the numbers, the tier that runs them, and the other way: starting fewer', () => {
    const past = pathsPastTheTier(onTiny, 0, 7)!;
    expect(pathsPastTheTierReason(past)).toBe(
      `Starting this would make 7 migrations at the same time (each kind of data counts as one), and ${first.name} runs ${first.paths}. ` +
        `${tier('medium').name} runs ${tier('medium').paths}: move up to it, or start fewer at the same time.`,
    );
  });

  it('past Extra large, says talk to us', () => {
    const xl = allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: tier('xl').dataGb }]);
    const most = tier('xl').paths;
    expect(pathsPastTheTierReason(pathsPastTheTier(xl, most, most + 1)!)).toMatch(/Past Extra large, talk to us/);
  });
});

describe('the question at Start', () => {
  const starting = (...slots: number[]) => slots.map((newSlots, i) => ({ mappingId: `m${i + 1}`, newSlots }));

  it('is not asked when everything fits, and everything is what fits', () => {
    const f = pathsForecast(onSmall, 1, starting(1, 2));
    expect(f).toMatchObject({ held: 1, after: 4, past: null, fits: ['m1', 'm2'] });
  });

  it('is asked with the refusal the start would get, and says what fits now beside it', () => {
    const f = pathsForecast(onSmall, 1, starting(2, 4, 1));
    expect(f.past).toEqual(pathsPastTheTier(onSmall, 1, 8));
    expect(f.past?.needs).toEqual(tier('medium'));
    // m1 takes two of the five free; m2's four do not fit beside it, m3's one does.
    expect(f.fits).toEqual(['m1', 'm3']);
  });

  it('lets a migration that takes no slot start, though nothing else fits', () => {
    const f = pathsForecast(onTiny, first.paths, starting(1, 0));
    expect(f.past).not.toBeNull();
    expect(f.fits).toEqual(['m2']);
  });

  it('fits nothing that takes a slot while the organisation is past its tier already', () => {
    expect(pathsForecast(onTiny, first.paths + 2, starting(1)).fits).toEqual([]);
  });
});

describe('a yes to run more at the same time', () => {
  it('to a tier above the agreed one, at its monthly, becomes the same row as a move up', () => {
    expect(decidePathsYes(onTiny, { tierId: 'medium', priceEur: monthlyEur(tier('medium')) })).toEqual({
      ok: true,
      grant: { kind: 'tier', tierId: 'medium', bandGb: tier('medium').dataGb, priceEur: monthlyEur(tier('medium')) },
    });
  });

  it('to a price that is not the one offered now is refused', () => {
    expect(decidePathsYes(onTiny, { tierId: 'medium', priceEur: monthlyEur(tier('medium')) + 1 })).toEqual({
      ok: false,
      reason: 'offer_changed',
    });
  });

  it('to the agreed tier, to Free below it, or to a tier that does not exist is not a step up', () => {
    for (const tierId of ['small', 'free', 'nonesuch']) {
      expect(decidePathsYes(onSmall, { tierId, priceEur: 0 }), tierId).toEqual({ ok: false, reason: 'not_a_step_up' });
    }
    expect(decidePathsYes(onSmall, { tierId: 'small', priceEur: monthlyEur(tier('small')) })).toEqual({
      ok: false,
      reason: 'not_a_step_up',
    });
  });
});
