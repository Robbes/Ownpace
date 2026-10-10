// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FIRST MONTH THAT IS INVOICED (workplan 0111, decision 7): empty is off,
 * a month is on from that month, anything else is refused by what it read;
 * and the switch with the stage, as the month task and the push read them
 * before anything about anybody.
 */

import { describe, it, expect } from 'vitest';
import { monthIsInvoiced, monthOf, readBillingFrom, whyNobodyIsInvoiced } from './billing-from.ts';

describe('OWNPACE_BILLING_FROM', () => {
  it('is off when unset, empty or blank: nobody is invoiced', () => {
    for (const raw of [undefined, '', '   ']) {
      expect(readBillingFrom(raw)).toEqual({ kind: 'off' });
      expect(monthIsInvoiced(readBillingFrom(raw), new Date('2030-01-15T00:00:00Z'))).toBe(false);
    }
  });

  it('is on from the month it names, and not before it', () => {
    const billing = readBillingFrom(' 2026-11 ');
    expect(billing).toEqual({ kind: 'on', from: '2026-11' });
    expect(monthIsInvoiced(billing, new Date('2026-10-31T23:59:59Z'))).toBe(false);
    expect(monthIsInvoiced(billing, new Date('2026-11-01T00:00:00Z'))).toBe(true);
    expect(monthIsInvoiced(billing, new Date('2027-02-01T00:00:00Z'))).toBe(true);
  });

  it('refuses what is not a month, saying what it read, and invoices nobody while it stands', () => {
    for (const raw of ['2026-13', '2026-1', '11-2026', '2026-11-01', 'november', '202611']) {
      const billing = readBillingFrom(raw);
      expect(billing.kind, raw).toBe('refused');
      expect(billing.kind === 'refused' && billing.reason).toContain(`"${raw}"`);
      expect(monthIsInvoiced(billing, new Date('2030-01-15T00:00:00Z'))).toBe(false);
    }
  });

  it('reads months in UTC', () => {
    expect(monthOf(new Date('2026-10-31T23:30:00-02:00'))).toBe('2026-11');
    expect(monthOf(new Date('2026-11-01T00:30:00+02:00'))).toBe('2026-10');
  });
});

const OCT_1 = new Date('2026-10-01T00:23:00Z');

describe('the switch, read before anything about anybody', () => {
  it('invoices nobody while OWNPACE_BILLING_FROM is empty, whatever the stage', () => {
    for (const from of [undefined, '', '  ']) {
      expect(whyNobodyIsInvoiced(from, undefined, OCT_1)?.reason).toBe('billing_from_empty');
      expect(whyNobodyIsInvoiced(from, 'alpha', OCT_1)?.reason).toBe('billing_from_empty');
    }
  });

  it('invoices nobody during the Alpha, even when it is switched on', () => {
    expect(whyNobodyIsInvoiced('2026-10', 'alpha', OCT_1)).toEqual({
      reason: 'alpha',
      said: 'nobody is invoiced: OWNPACE_STAGE=alpha, and nothing is charged during the Alpha.',
    });
  });

  it('invoices nobody before the month it names, and from that month on', () => {
    expect(whyNobodyIsInvoiced('2026-11', undefined, OCT_1)?.said).toBe(
      'nobody is invoiced yet: 2026-10 is before OWNPACE_BILLING_FROM, 2026-11.',
    );
    expect(whyNobodyIsInvoiced('2026-10', undefined, OCT_1)).toBeNull();
    expect(whyNobodyIsInvoiced('2026-10', '', new Date('2027-03-01T00:23:00Z'))).toBeNull();
  });

  it('refuses a value that is not a month, saying what it read', () => {
    expect(() => whyNobodyIsInvoiced('2026-1', undefined, OCT_1)).toThrow(/OWNPACE_BILLING_FROM is "2026-1"/);
    expect(() => whyNobodyIsInvoiced('2026-1', 'alpha', OCT_1)).toThrow(/not a month written YYYY-MM/);
  });
});
