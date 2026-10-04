// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A start past the agreed tier's paths (workplan 0109 T6, the path axis): when
 * it waits, which tier runs it, and the sentence that says so. The doors that
 * ask it are held in `apps/api/src/routes/migrations/a-start-past-the-tier.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { allowanceOf } from './data-ceiling.ts';
import { pathsPastTheTier, pathsPastTheTierReason } from './path-ceiling.ts';
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
    expect(pathsPastTheTier(onTiny, 0, 3)).toEqual({ tier: first, after: 3, needs: tier('small') });
    expect(pathsPastTheTier(onSmall, 4, 5)?.needs).toEqual(tier('medium'));
  });

  it('that takes no new slot is never refused, though the organisation is past its tier already', () => {
    // An organisation that ran five during the alpha may pause and resume them.
    expect(pathsPastTheTier(onTiny, 5, 5)).toBeNull();
    expect(pathsPastTheTier(onTiny, 5, 4)).toBeNull();
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
    expect(pathsPastTheTier(toppedUp, 4, 5)).not.toBeNull();
  });
});

describe('the sentence', () => {
  it('says the numbers, the tier that runs them, and the other way: starting fewer', () => {
    const past = pathsPastTheTier(onTiny, 0, 3)!;
    expect(pathsPastTheTierReason(past)).toBe(
      `Starting this would make 3 migrations at the same time (each kind of data counts as one), and ${first.name} runs ${first.paths}. ` +
        `${tier('small').name} runs ${tier('small').paths}: move up to it, or start fewer at the same time.`,
    );
  });

  it('past Extra large, says talk to us', () => {
    const xl = allowanceOf([{ kind: 'tier', tierId: 'xl', bandGb: tier('xl').dataGb }]);
    expect(pathsPastTheTierReason(pathsPastTheTier(xl, 200, 201)!)).toMatch(/Past Extra large, talk to us/);
  });
});
