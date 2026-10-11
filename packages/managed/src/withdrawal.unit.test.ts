// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WITHDRAWAL'S RULES (workplan 0111, T7, slice 7b; decision 15; terms §7),
 * without a database: when the fourteen days end, who may withdraw, what share
 * of an invoice is credited, and the words it is credited in.
 */

import { describe, it, expect } from 'vitest';
import {
  creditShare,
  dayInWords,
  momentInWords,
  withdrawalCreditWords,
  withdrawalUntil,
  withdrawalWindow,
  type PaidCommitment,
} from './withdrawal.ts';

const at = (iso: string) => new Date(iso);

describe('the fourteen days', () => {
  it('end with the fourteenth day after the day the contract was concluded', () => {
    // Thursday 1 October 2026; the fourteenth day after is Thursday 15 October.
    expect(withdrawalUntil(at('2026-10-01T09:30:00Z')).toISOString()).toBe('2026-10-16T00:00:00.000Z');
    // Late in the day changes nothing: the day it was concluded is not counted.
    expect(withdrawalUntil(at('2026-10-01T23:59:00Z')).toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('move past a Saturday or a Sunday to the end of the Monday', () => {
    // Saturday 3 October: the fourteenth day after is Saturday 17 October.
    expect(withdrawalUntil(at('2026-10-03T12:00:00Z')).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    // Sunday 4 October: the fourteenth day after is Sunday 18 October.
    expect(withdrawalUntil(at('2026-10-04T12:00:00Z')).toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('who may withdraw, and from what', () => {
  const yeses: PaidCommitment[] = [
    { at: at('2026-10-01T09:30:00Z'), tierId: 'small' },
    { at: at('2026-10-02T10:00:00Z'), tierId: 'medium' },
  ];

  it('a consumer, from the first yes after Free, at the highest tier said yes to', () => {
    expect(withdrawalWindow({ partyKind: 'consumer', commitments: yeses, beganOnRequest: false }, at('2026-10-03T10:00:00Z'))).toEqual({
      kind: 'open',
      since: at('2026-10-01T09:30:00Z'),
      until: at('2026-10-16T00:00:00Z'),
      tier: 'medium',
      beganOnRequest: false,
    });
  });

  it('an organisation without invoice details, as a consumer', () => {
    expect(withdrawalWindow({ partyKind: null, commitments: yeses, beganOnRequest: false }, at('2026-10-03T10:00:00Z')).kind).toBe('open');
  });

  it('nobody on Free, no business, and nobody after the fourteen days', () => {
    expect(withdrawalWindow({ partyKind: 'consumer', commitments: [], beganOnRequest: false }, at('2026-10-03T10:00:00Z'))).toMatchObject({
      kind: 'closed',
      reason: 'nothing_paid',
    });
    expect(withdrawalWindow({ partyKind: 'business', commitments: yeses, beganOnRequest: false }, at('2026-10-03T10:00:00Z'))).toMatchObject({
      kind: 'closed',
      reason: 'business',
    });
    expect(withdrawalWindow({ partyKind: 'consumer', commitments: yeses, beganOnRequest: false }, at('2026-10-16T00:00:00Z'))).toMatchObject({
      kind: 'closed',
      reason: 'past',
      until: at('2026-10-16T00:00:00Z'),
    });
  });
});

describe('the share of an invoice credited', () => {
  it('is all of it when the consumer did not ask us to begin before the fourteen days were over', () => {
    expect(creditShare('2026-10-01', '2026-10-31', at('2026-10-03T10:00:00Z'), false)).toEqual({
      daysPaid: 31,
      daysUsed: 0,
      numerator: 31,
      denominator: 31,
    });
  });

  it('is the days not used when they did, the day of the withdrawal counted as used', () => {
    expect(creditShare('2026-10-01', '2026-10-31', at('2026-10-03T10:00:00Z'), true)).toEqual({
      daysPaid: 31,
      daysUsed: 3,
      numerator: 28,
      denominator: 31,
    });
  });

  it("counts a move up's invoice from the day it was invoiced", () => {
    expect(creditShare('2026-10-20', '2026-10-31', at('2026-10-25T08:00:00Z'), true)).toEqual({
      daysPaid: 12,
      daysUsed: 6,
      numerator: 6,
      denominator: 12,
    });
  });

  it('credits nothing of a month used to its end, and all of one not yet begun', () => {
    expect(creditShare('2026-09-25', '2026-09-30', at('2026-10-02T08:00:00Z'), true)).toMatchObject({ numerator: 0, denominator: 6 });
    expect(creditShare('2026-11-01', '2026-11-30', at('2026-10-31T22:00:00Z'), true)).toMatchObject({ numerator: 30, denominator: 30 });
  });
});

describe('the words', () => {
  const withdrawnAt = at('2026-10-03T10:04:00Z');

  it("say the day, and the share, with the invoice's number to come", () => {
    const whole = creditShare('2026-10-01', '2026-10-31', withdrawnAt, false);
    const part = creditShare('2026-10-01', '2026-10-31', withdrawnAt, true);
    expect(withdrawalCreditWords(whole, withdrawnAt, 'en')).toBe('Withdrawal on 3 October 2026: invoice {invoice} credited in full');
    expect(withdrawalCreditWords(whole, withdrawnAt, 'nl')).toBe('Herroeping op 3 oktober 2026: factuur {invoice} volledig gecrediteerd');
    expect(withdrawalCreditWords(part, withdrawnAt, 'en')).toBe(
      'Withdrawal on 3 October 2026: 28 of the 31 days of invoice {invoice} credited',
    );
    expect(withdrawalCreditWords(part, withdrawnAt, 'nl')).toBe(
      'Herroeping op 3 oktober 2026: 28 van de 31 dagen van factuur {invoice} gecrediteerd',
    );
  });

  it('say a day and a moment in UTC, without Intl', () => {
    expect(dayInWords(withdrawnAt, 'nl')).toBe('3 oktober 2026');
    expect(momentInWords(withdrawnAt, 'en')).toBe('3 October 2026 at 10:04 UTC');
    expect(momentInWords(withdrawnAt, 'nl')).toBe('3 oktober 2026 om 10:04 UTC');
  });
});
