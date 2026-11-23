// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A COPY THAT WAITS FOR THE PRESS SAYS SO (workplan 0168 D5; the screens'
 * review S4).
 *
 * Past its data type's switch, a pass counts a copy the address table would
 * change and leaves it until somebody presses *Apply the new addresses here
 * too*. The confirmed list said *Waiting for the next pass* of it all the same,
 * which no pass makes true. The row now says what it waits for (`waitsFor`,
 * set from the same reading of the phases a pass makes), and the words name
 * the button the reader presses, in both languages.
 */
import { describe, it, expect } from 'vitest';
import { addressMarkKey } from './address-words.ts';
import { LOCALES, STRINGS } from './strings.ts';

describe('what the confirmed list says of a row the address table marked', () => {
  it('says a copy past its switch waits for the press, by the button’s own words', () => {
    expect(addressMarkKey({ address: 'older', waitsFor: 'press' })).toBe('addresses.confirmedList.olderPress');
    for (const locale of LOCALES) {
      const said = STRINGS[locale]['addresses.confirmedList.olderPress'];
      expect(said, locale).toContain(STRINGS[locale]['addresses.mapping.apply']);
      expect(said, locale).not.toBe(STRINGS[locale]['addresses.confirmedList.older']);
    }
  });

  it('says a copy before its switch waits for the next pass, as a row that says nothing of it does', () => {
    expect(addressMarkKey({ address: 'older', waitsFor: 'pass' })).toBe('addresses.confirmedList.older');
    expect(addressMarkKey({ address: 'older' })).toBe('addresses.confirmedList.older');
  });

  it('says a match with the new address, and nothing of a row the table did not mark', () => {
    expect(addressMarkKey({ address: 'changed', waitsFor: 'press' })).toBe('addresses.confirmedList.changed');
    expect(addressMarkKey({})).toBeNull();
    expect(addressMarkKey({ address: 'something newer' })).toBeNull();
  });
});
