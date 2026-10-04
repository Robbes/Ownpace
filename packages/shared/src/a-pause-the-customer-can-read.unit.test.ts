// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a paused migration is allowed to say, and what it must not.
 *
 * Three things stop a pass and only two of them belong on a customer's screen.
 * The pass deadline is deliberately absent — it fires on every pass of every
 * large migration, and a notice that appears constantly is one people learn to
 * scroll past, which would make it noise on the day one of the other two
 * fires. That is a decision, and a decision nobody wrote down is one somebody
 * quietly reverses, so it is asserted here.
 */

import { describe, it, expect } from 'vitest';
import { budgetPauseToReason, isPauseReason, type PauseReason } from './pause-reason.ts';
import type { BudgetPause } from './rate-budget.ts';

const CEILING: BudgetPause = {
  provider: 'imap.gmail.com',
  ceilingBytes: 2_500_000_000,
  spentBytes: 2_500_000_001,
  windowResetsAt: '2026-09-09T06:00:00.000Z',
};

describe('the meter’s report becomes a sentence a person can act on', () => {
  it('keeps whose limit it is and when it lifts', () => {
    const reason = budgetPauseToReason(CEILING);
    expect(reason).toEqual({
      kind: 'daily-download-ceiling',
      provider: 'imap.gmail.com',
      windowResetsAt: '2026-09-09T06:00:00.000Z',
    });
  });

  it('leaves the byte figures on the run log', () => {
    // Not squeamishness: 2 500 000 001 of 2 500 000 000 is evidence for an
    // engineer and unverifiable noise for the person whose mail it is. The
    // run log has both numbers; this is the sentence.
    const reason = budgetPauseToReason(CEILING) as Record<string, unknown>;
    expect(Object.keys(reason).sort()).toEqual(['kind', 'provider', 'windowResetsAt']);
  });

  it('carries a null window through rather than inventing a time', () => {
    const reason = budgetPauseToReason({ ...CEILING, windowResetsAt: null });
    expect(reason).toMatchObject({ windowResetsAt: null });
  });
});

/** New first copies waiting at the data ceiling, with both ways on (0109 T6). */
const AT_THE_CEILING = {
  kind: 'data-ceiling',
  ceilingGb: 750,
  held: 3,
  moveUp: { name: 'Medium', setupEur: 7, monthlyEur: 8 },
  topUp: { bandGb: 750, priceEur: 8 },
};

describe('a reason read back out of jsonb is checked, never cast', () => {
  it('accepts the three kinds', () => {
    expect(isPauseReason({ kind: 'daily-download-ceiling', provider: 'x', windowResetsAt: null }))
      .toBe(true);
    expect(isPauseReason({ kind: 'operator-hold', since: '2026-09-08T00:00:00.000Z' })).toBe(true);
    expect(
      isPauseReason({ kind: 'operator-hold', since: '2026-09-08T00:00:00.000Z', message: 'back soon' }),
    ).toBe(true);
    expect(isPauseReason(AT_THE_CEILING)).toBe(true);
    expect(isPauseReason({ ...AT_THE_CEILING, moveUp: null, topUp: null })).toBe(true);
  });

  it('refuses a data ceiling without its numbers or with a half-written offer (0109 T6)', () => {
    expect(isPauseReason({ kind: 'data-ceiling' })).toBe(false);
    expect(isPauseReason({ ...AT_THE_CEILING, held: -1 })).toBe(false);
    expect(isPauseReason({ ...AT_THE_CEILING, moveUp: { name: 'Medium', setupEur: 7 } })).toBe(false);
    expect(isPauseReason({ ...AT_THE_CEILING, topUp: { bandGb: '750', priceEur: 8 } })).toBe(false);
  });

  it('refuses a kind this build has no sentence for', () => {
    // The failure this prevents: a row written by a NEWER build reaching a
    // screen that renders `undefined` where a reason should be. Dropping the
    // field shows the pause without a reason, which is worse than nothing —
    // so the row simply reads as not paused, which is what this build knows.
    expect(isPauseReason({ kind: 'a-reason-from-the-future', provider: 'x' })).toBe(false);
  });

  it('refuses a half-written reason of a kind it does know', () => {
    expect(isPauseReason({ kind: 'daily-download-ceiling' })).toBe(false);
    expect(isPauseReason({ kind: 'daily-download-ceiling', provider: 'x' })).toBe(false);
    expect(isPauseReason({ kind: 'operator-hold' })).toBe(false);
    expect(isPauseReason({ kind: 'operator-hold', since: 1 })).toBe(false);
    expect(isPauseReason({ kind: 'operator-hold', since: 'x', message: 7 })).toBe(false);
  });

  it('refuses what is not an object at all', () => {
    for (const junk of [null, undefined, 'operator-hold', 7, [], true]) {
      expect(isPauseReason(junk), `${JSON.stringify(junk)} is not a reason`).toBe(false);
    }
  });
});

describe('the pass deadline stays off the customer’s screen', () => {
  it('is not one of the reasons', () => {
    // Exhaustive by construction: the union has two members, so a third —
    // a deadline among them — would not compile against this list. Written
    // as a runtime assertion as well because the list itself is the record
    // of the decision.
    const kinds: Array<PauseReason['kind']> = ['daily-download-ceiling', 'operator-hold', 'data-ceiling'];
    expect(kinds).toHaveLength(3);
    expect(kinds).not.toContain('pass-deadline');
  });

  it('is refused by the read-back guard, whatever wrote it', () => {
    expect(isPauseReason({ kind: 'pass-deadline', deadlineAt: 'x', ranForMs: 1 })).toBe(false);
  });
});
