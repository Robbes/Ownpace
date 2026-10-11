// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORDS ON A MONTH'S INVOICE LINE (workplan 0111, decision 8), in both
 * languages, and an amount moved that never reads as fitting the tier below.
 */

import { describe, it, expect } from 'vitest';
import { dataAmount, monthLine, type MonthLineFacts } from './month-invoice-words.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';

const tier = (id: ManagedTier['id']): ManagedTier => MANAGED_TIERS.find((t) => t.id === id)!;

const facts = (over: Partial<MonthLineFacts>): MonthLineFacts => ({
  tier: tier('medium'),
  month: new Date('2026-10-01T00:23:00Z'),
  by: 'paths',
  peakPaths: 12,
  peakAt: '2026-10-03T14:05:00.000Z',
  gbCounted: 0,
  after: null,
  ...over,
});

describe("the line's words, as decision 8 took them", () => {
  it('says the peak and its day', () => {
    expect(monthLine(facts({}), 'nl')).toBe('Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober');
    expect(monthLine(facts({}), 'en')).toBe('Ownpace Medium, October 2026: 12 migrations at the same time on 3 October');
  });

  it('says the data moved in total', () => {
    const large = facts({ tier: tier('large'), by: 'data', gbCounted: 1_600 });
    expect(monthLine(large, 'nl')).toBe('Ownpace Large, oktober 2026: 1,6 TB gemigreerd in totaal');
    expect(monthLine(large, 'en')).toBe('Ownpace Large, October 2026: 1.6 TB migrated in total');
  });

  it('says the pick', () => {
    const small = facts({ tier: tier('small'), by: 'picked' });
    expect(monthLine(small, 'nl')).toBe('Ownpace Small, oktober 2026: het pakket dat u koos');
    expect(monthLine(small, 'en')).toBe('Ownpace Small, October 2026: the tier you picked');
  });

  it('says the tier agreed to, when what was used went past it', () => {
    const agreed = facts({ by: 'agreed' });
    expect(monthLine(agreed, 'nl')).toBe('Ownpace Medium, oktober 2026: het pakket waarmee u akkoord ging');
    expect(monthLine(agreed, 'en')).toBe('Ownpace Medium, October 2026: the tier you agreed to');
  });

  it('says what was invoiced before a move up', () => {
    const up = facts({ after: tier('small') });
    expect(monthLine(up, 'nl')).toBe(
      'Ownpace Medium, oktober 2026: 12 migraties tegelijk op 3 oktober, min het al gefactureerde pakket Small',
    );
    expect(monthLine(up, 'en')).toBe(
      'Ownpace Medium, October 2026: 12 migrations at the same time on 3 October, less Small already invoiced',
    );
  });

  it('names the month in UTC, and Extra large by its name', () => {
    const xl = facts({ tier: tier('xl'), by: 'picked', month: new Date('2026-12-31T23:30:00-02:00') });
    expect(monthLine(xl, 'nl')).toBe('Ownpace Extra large, januari 2027: het pakket dat u koos');
  });

  it('says the peak without a day rather than invent one', () => {
    expect(monthLine(facts({ peakAt: null }), 'en')).toBe('Ownpace Medium, October 2026: 12 migrations at the same time');
  });
});

describe('the amount moved, never on or under the line it crossed', () => {
  it('is tenths of a TB from 1 TB, without a trailing zero', () => {
    expect(dataAmount(1_640, 'nl', 1_500)).toBe('1,6 TB');
    expect(dataAmount(5_960, 'en', 1_500)).toBe('6 TB');
    expect(dataAmount(12_345, 'nl', 6_000)).toBe('12,3 TB');
  });

  it('is whole GB under 1 TB, with the language’s separators', () => {
    expect(dataAmount(640.4, 'nl', 500)).toBe('640 GB');
    expect(dataAmount(999.4, 'en', 500)).toBe('999 GB');
    expect(dataAmount(999.6, 'en', 500)).toBe('1 TB');
  });

  it('turns to GB where tenths of a TB would read as the ceiling below', () => {
    // 1.52 TB on Large: "1,5 TB" would say it fits Medium.
    expect(dataAmount(1_520, 'nl', 1_500)).toBe('1.520 GB');
    expect(dataAmount(1_520, 'en', 1_500)).toBe('1,520 GB');
  });

  it('rounds up at the line itself, and only there', () => {
    expect(dataAmount(150.4, 'nl', 150)).toBe('151 GB');
    expect(dataAmount(1_500.3, 'en', 1_500)).toBe('1,501 GB');
    expect(dataAmount(150.6, 'nl', 150)).toBe('151 GB');
    expect(dataAmount(320.2, 'nl', 150)).toBe('320 GB');
  });
});
