// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The organisation's phone number, as the grant page may show it (workplan
 * 0108 T8a, the owner's decision of 2026-09-23).
 *
 * The one line on the consent page the organisation writes itself, so the
 * test that matters is what it REFUSES: anything that is not a phone number is
 * never stored, and never shown even when it is stored by some other path.
 */

import { describe, it, expect } from 'vitest';
import {
  CONTACT_PHONE_MAX_LENGTH,
  contactPhoneFrom,
  readTenantContactPhone,
  withTenantContactPhone,
} from './tenant-contact.ts';

describe('what the owner may type', () => {
  it.each([
    ['+31 20 123 4567', '+31 20 123 4567'],
    ['(020) 123-4567', '(020) 123-4567'],
    ['06 12 34 56 78', '06 12 34 56 78'],
    ['+44 20.7946.0958', '+44 20.7946.0958'],
    ['  +31   6  1234 5678 ', '+31 6 1234 5678'],
  ])('keeps %s as a person would read it back', (typed, stored) => {
    expect(contactPhoneFrom(typed)).toEqual({ ok: true, phone: stored });
  });

  it('reads an empty field as "show no number", because it is optional', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(contactPhoneFrom(empty)).toEqual({ ok: true, phone: null });
    }
  });

  it.each([
    ['words beside a number', 'Call IT on 020 123 4567'],
    ['a web address', 'https://example.org/call-us'],
    ['letters inside it', '+31 20 CALL NOW'],
    ['too few digits to be a number', '123 45'],
    ['more digits than any number has', '+31 20 123 4567 8901 23'],
    ['a plus anywhere but the front', '31+20 123 4567'],
  ])('refuses %s, saying what a number may hold', (_what, typed) => {
    const verdict = contactPhoneFrom(typed);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/digits, spaces and \+ \( \) - \. \//);
  });

  it(`refuses anything longer than ${CONTACT_PHONE_MAX_LENGTH} characters, however few its digits`, () => {
    // Allowed characters and eleven digits: refused on its length alone.
    const long = '(0) - (0) - (0) - (0) - (0) - 12 34 56';
    expect(long.length).toBeGreaterThan(CONTACT_PHONE_MAX_LENGTH);
    expect(long.replace(/[^0-9]/g, '').length).toBeLessThanOrEqual(15);
    expect(contactPhoneFrom(long).ok).toBe(false);
  });
});

describe('what the grant page and the settings screen read', () => {
  it('shows a stored number', () => {
    expect(readTenantContactPhone({ contactPhone: '+31 20 123 4567' })).toBe('+31 20 123 4567');
  });

  it('shows nothing that is not a phone number, even when something stored it', () => {
    // `tenant.settings` has other writers. The consent page must not become a
    // place where any of them can put a sentence.
    expect(readTenantContactPhone({ contactPhone: 'Call IT, they know' })).toBeNull();
    expect(readTenantContactPhone({ contactPhone: 31201234567 })).toBeNull();
    expect(readTenantContactPhone({})).toBeNull();
    expect(readTenantContactPhone(null)).toBeNull();
    expect(readTenantContactPhone('not settings')).toBeNull();
  });
});

describe('saving it', () => {
  it('keeps every other setting', () => {
    const settings = { slug: 'acme', notifications: { digest: 'daily', locale: 'nl' } };
    expect(withTenantContactPhone(settings, '+31 20 123 4567')).toEqual({
      ...settings,
      contactPhone: '+31 20 123 4567',
    });
    // Untouched: the caller's object is not the stored one.
    expect(settings).not.toHaveProperty('contactPhone');
  });

  it('removes the number when it is cleared, rather than storing an empty one', () => {
    const next = withTenantContactPhone({ slug: 'acme', contactPhone: '+31 20 123 4567' }, null);
    expect(next).toEqual({ slug: 'acme' });
  });

  it('starts from nothing when there were no settings', () => {
    expect(withTenantContactPhone(null, '0612345678')).toEqual({ contactPhone: '0612345678' });
  });
});
