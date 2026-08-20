// Copyright 2026 The Ownpace authors (Apache-2.0)
import { describe, it, expect } from 'vitest';
import { encodeImapCursor, decodeImapCursor } from './cursor.ts';

describe('IMAP cursor codec', () => {
  it('round-trips', () => {
    const c = { uidValidity: 12345, uidNext: 678 };
    const enc = encodeImapCursor(c);
    expect(enc.value).toBe('12345:678');
    expect(decodeImapCursor(enc)).toEqual(c);
  });

  it('returns undefined on malformed input', () => {
    expect(decodeImapCursor({ value: '' })).toBeUndefined();
    expect(decodeImapCursor({ value: 'abc' })).toBeUndefined();
    expect(decodeImapCursor({ value: '1:2:3' })).toBeUndefined();
    expect(decodeImapCursor({ value: 'x:2' })).toBeUndefined();
  });
});
