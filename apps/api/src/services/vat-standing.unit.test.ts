// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which company name the grant page may show (workplan 0108 T8a).
 *
 * Only a name the EU VAT register gave, for the number stored now, in an
 * answer that said valid. Every other case is none, and each is named here,
 * because the page shows this name as the one thing on it nobody typed.
 */

import { describe, it, expect } from 'vitest';
import { checkedCompanyName } from './vat-standing.ts';

const answer = (valid: boolean, traderName: string | null) => ({
  vatConsultation: { valid, traderName },
});

describe('the company name the grant page may show', () => {
  it('is the name VIES gave, when it said valid', () => {
    expect(checkedCompanyName(answer(true, 'ACME LEGAL B.V.'))).toBe('ACME LEGAL B.V.');
  });

  it('is none when the latest answer said the number is not valid', () => {
    expect(checkedCompanyName(answer(false, 'ACME LEGAL B.V.'))).toBeNull();
  });

  it('is none when VIES disclosed no name, as some member states never do', () => {
    expect(checkedCompanyName(answer(true, null))).toBeNull();
    expect(checkedCompanyName(answer(true, '   '))).toBeNull();
  });

  it('is none when the number as stored was never checked', () => {
    expect(checkedCompanyName({ vatConsultation: null })).toBeNull();
  });
});
