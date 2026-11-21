// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MARKER THE OPERATOR TYPES (workplan 0162 T1, §3): trimmed, then 3 to 64
 * printable characters, or refused with a sentence the Support screen shows.
 * Nothing is filled in for an absent one: `[Ownpace-test]` is offered by the
 * screen, never assumed by the API.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_TEST_MARKER, TEST_MARKER_MAX, TEST_MARKER_MIN, readTestMarker } from './test-marker.ts';

const refused = (typed: unknown): boolean => 'refused' in readTestMarker(typed);

describe('a marker as the operator typed it', () => {
  it('takes the default the screen offers, and any other marker of printable characters', () => {
    expect(readTestMarker(DEFAULT_TEST_MARKER)).toEqual({ marker: '[Ownpace-test]' });
    expect(readTestMarker('TEST-ONLY')).toEqual({ marker: 'TEST-ONLY' });
    // A space inside is a character of the marker, and so is any script.
    expect(readTestMarker('Ownpace test')).toEqual({ marker: 'Ownpace test' });
    expect(readTestMarker('[проба]')).toEqual({ marker: '[проба]' });
  });

  it('trims it first, as everything an operator types is', () => {
    expect(readTestMarker('  [Ownpace-test]\n')).toEqual({ marker: '[Ownpace-test]' });
    expect(readTestMarker('\t[x-y] ')).toEqual({ marker: '[x-y]' });
  });

  it('assumes none: an absent or empty marker is refused, and the refusal names the default as an example', () => {
    for (const typed of [undefined, null, 42, {}, '', '   ']) expect(refused(typed), JSON.stringify(typed)).toBe(true);
    expect(readTestMarker(undefined)).toEqual({ refused: expect.stringContaining('such as [Ownpace-test]') });
  });

  it('counts characters as the database does, by code point, from 3 to 64', () => {
    expect(TEST_MARKER_MIN).toBe(3);
    expect(TEST_MARKER_MAX).toBe(64);
    expect(refused('ab')).toBe(true);
    expect(refused('abc')).toBe(false);
    expect(refused('a'.repeat(64))).toBe(false);
    expect(refused('a'.repeat(65))).toBe(true);
    // Three code points, six UTF-16 units: three, as `char_length` counts it.
    expect(readTestMarker('🧪🧪🧪')).toEqual({ marker: '🧪🧪🧪' });
    // Sixty-four of them is 128 units, and still 64 characters.
    expect(refused('🧪'.repeat(64))).toBe(false);
    expect(refused('🧪'.repeat(65))).toBe(true);
    expect(readTestMarker('ab')).toEqual({ refused: expect.stringContaining('at least 3 characters') });
    expect(readTestMarker('a'.repeat(65))).toEqual({ refused: 'marker is at most 64 characters' });
  });

  it('refuses a control character anywhere inside it: C0, DEL and C1, the column CHECK’s floor', () => {
    for (const c of ['\u0001', '\u0009', '\u000a', '\u001f', '\u007f', '\u0080', '\u009f']) {
      expect(refused(`[Own${c}pace]`), `U+${c.codePointAt(0)!.toString(16)}`).toBe(true);
    }
  });

  it('refuses a character that prints nothing: format, separators, surrogates and private use', () => {
    // Zero-width space, byte order mark, a right-to-left override, a soft hyphen,
    // the line and paragraph separators, a lone surrogate, a private-use character.
    for (const c of ['\u200b', '\ufeff', '\u202e', '\u00ad', '\u2028', '\u2029', '\ud800', '\ue000']) {
      expect(refused(`[Own${c}pace]`), `U+${c.codePointAt(0)!.toString(16)}`).toBe(true);
    }
    expect(readTestMarker('[Own\u200bpace]')).toEqual({ refused: expect.stringContaining('prints nothing') });
  });

  it('refuses a character that looks blank and is not the space: other space separators, and the fillers', () => {
    // A no-break space, an en and an em space, a thin and a narrow no-break
    // space, a medium mathematical and an ideographic space, the Ogham space
    // mark; the Hangul fillers and the blank braille pattern.
    for (const c of [
      '\u00a0',
      '\u2002',
      '\u2003',
      '\u2009',
      '\u202f',
      '\u205f',
      '\u3000',
      '\u1680',
      '\u115f',
      '\u1160',
      '\u3164',
      '\uffa0',
      '\u2800',
    ]) {
      expect(refused(`[Own${c}pace]`), `U+${c.codePointAt(0)!.toString(16)}`).toBe(true);
    }
    expect(readTestMarker('[Own\u00a0pace]')).toEqual({ refused: expect.stringContaining('looks blank') });
    // A filler on its own, three times, is three characters of nothing.
    expect(refused('\u3164\u3164\u3164')).toBe(true);
    // The space itself stays a character of the marker, and a blank one at
    // either end is trimmed away first, as a space is.
    expect(readTestMarker('Ownpace test')).toEqual({ marker: 'Ownpace test' });
    expect(readTestMarker('\u00a0[Ownpace-test]\u3000')).toEqual({ marker: '[Ownpace-test]' });
  });
});
