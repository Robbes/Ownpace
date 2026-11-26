// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE THE SERVICE RUNS, FROM ONE SETTING (workplan 0176 D16 (a); the owner,
 * 2026-11-26: *"P16: a"*).
 *
 * A person's link page says *Ownpace runs in {country}.* under its first line,
 * with the country's name in the reader's language, from the browser's own
 * list. The country is the deployment's: one two-letter code in the stack's
 * `.env`, never a word of the dictionary, because somebody else can run the
 * same software. Unset, nothing is said.
 *
 * The codes here are examples a deployment could set. None of them is the one
 * any stack of ours sets: that is a value on the stack, never in a file.
 */
import { describe, it, expect } from 'vitest';
import {
  COUNTRY_SETTING,
  countryChecked,
  countryCodeFrom,
  countryName,
  refusedCountry,
  whereItRuns,
} from './where-it-runs.ts';

describe('the setting, as a code', () => {
  it('is nothing when unset or empty: nothing is said', () => {
    expect(countryCodeFrom({})).toBeNull();
    expect(countryCodeFrom({ VITE_OWNPACE_COUNTRY: '' })).toBeNull();
    expect(countryCodeFrom({ VITE_OWNPACE_COUNTRY: '   ' })).toBeNull();
  });

  it('is two letters, trimmed and in capitals, in any case it was written in', () => {
    expect(countryCodeFrom({ VITE_OWNPACE_COUNTRY: 'DE' })).toBe('DE');
    expect(countryCodeFrom({ VITE_OWNPACE_COUNTRY: ' be ' })).toBe('BE');
    expect(countryCodeFrom({ VITE_OWNPACE_COUNTRY: 'Fr' })).toBe('FR');
  });

  it('refuses what is not two letters, naming the setting', () => {
    for (const value of ['DEU', 'D', '1A', 'Germany', 'de-DE', 'D E']) {
      expect(() => countryCodeFrom({ VITE_OWNPACE_COUNTRY: value }), value).toThrow(COUNTRY_SETTING);
    }
  });
});

describe('a two-letter code that is no country is refused at build time', () => {
  it('passes a country the list names', () => {
    for (const code of ['DE', 'BE', 'FR', 'GB', 'US', 'CH', 'PH']) expect(refusedCountry(code), code).toBeNull();
  });

  it('refuses an old name for another code, a code the list does not name, and a region that is no country', () => {
    // UK is the United Kingdom's alias, whose code is GB; CS and YU are gone.
    expect(refusedCountry('UK')).toMatch(/GB/);
    expect(refusedCountry('CS')).not.toBeNull();
    expect(refusedCountry('XX')).not.toBeNull();
    for (const region of ['EU', 'EZ', 'UN', 'QO', 'ZZ']) expect(refusedCountry(region), region).not.toBeNull();
  });

  it('the build’s check: the code, or nothing, and a refusal that names the setting and says to rebuild', () => {
    expect(countryChecked({})).toBeNull();
    expect(countryChecked({ VITE_OWNPACE_COUNTRY: ' de ' })).toBe('DE');
    expect(() => countryChecked({ VITE_OWNPACE_COUNTRY: 'EU' })).toThrow(COUNTRY_SETTING);
    expect(() => countryChecked({ VITE_OWNPACE_COUNTRY: 'EU' })).toThrow(/rebuild/i);
    expect(() => countryChecked({ VITE_OWNPACE_COUNTRY: 'Deutschland' })).toThrow(COUNTRY_SETTING);
  });
});

describe('the name, in the reader’s language, from the browser’s own list', () => {
  it('in English and in Dutch', () => {
    expect(countryName('DE', 'en')).toBe('Germany');
    expect(countryName('DE', 'nl')).toBe('Duitsland');
    expect(countryName('BE', 'nl')).toBe('België');
  });

  it('with the article the language puts before it in a sentence', () => {
    expect(countryName('GB', 'en')).toBe('the United Kingdom');
    expect(countryName('GB', 'nl')).toBe('het Verenigd Koninkrijk');
    expect(countryName('US', 'en')).toBe('the United States');
    expect(countryName('US', 'nl')).toBe('de Verenigde Staten');
    expect(countryName('PH', 'en')).toBe('the Philippines');
    expect(countryName('PH', 'nl')).toBe('de Filipijnen');
    // And none where it takes none.
    expect(countryName('CH', 'en')).toBe('Switzerland');
    expect(countryName('CH', 'nl')).toBe('Zwitserland');
  });

  it('nothing where the browser has no name for it: a code in a sentence is worse than none', () => {
    expect(countryName('XX', 'en')).toBeNull();
    expect(countryName('XX', 'nl')).toBeNull();
  });
});

describe('what the page says', () => {
  it('the country’s name, as the sentence says it', () => {
    expect(whereItRuns('en', 'DE', false)).toBe('Germany');
    expect(whereItRuns('nl', ' gb ', false)).toBe('het Verenigd Koninkrijk');
  });

  it('nothing when the deployment sets nothing', () => {
    expect(whereItRuns('en', undefined, false)).toBeNull();
    expect(whereItRuns('nl', '', false)).toBeNull();
  });

  it('and nothing on the appliance, whatever its bundle was built with: it runs on its owner’s own machine', () => {
    expect(whereItRuns('en', 'DE', true)).toBeNull();
  });
});
