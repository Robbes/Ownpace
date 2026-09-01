// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The way out of a sign-in that worked and landed nowhere.
 *
 * One function, and it is here rather than inline because the `+` case is a
 * real defect waiting to happen: `a+b@x.test` is an ordinary address (the tag
 * convention Gmail, Fastmail and others support), and a query string reads a
 * bare `+` as a space — so an unescaped prefill puts `a b@x.test` in the form
 * and the person is refused for a reason they cannot see.
 */

import { describe, it, expect } from 'vitest';
import { requestAccessHref } from './no-organisation.ts';

describe('requestAccessHref', () => {
  it('carries the address to the form', () => {
    expect(requestAccessHref('someone@example.test')).toBe(
      '/request-access?email=someone%40example.test',
    );
  });

  it('escapes a plus, which a query string would otherwise read as a space', () => {
    expect(requestAccessHref('rh+tagged@example.test')).toBe(
      '/request-access?email=rh%2Btagged%40example.test',
    );
    // And the round trip really does come back unchanged — the property, not
    // the encoding, is what matters.
    const url = new URL(requestAccessHref('rh+tagged@example.test'), 'https://app.example.test');
    expect(url.searchParams.get('email')).toBe('rh+tagged@example.test');
  });

  it('still points somewhere when the issuer asserted no address', () => {
    // Email is not identity: an issuer need not assert one, and /api/me says
    // so. The form is still where this person needs to go.
    for (const nothing of [null, undefined, '', '   ']) {
      expect(requestAccessHref(nothing)).toBe('/request-access');
    }
  });

  it('trims, so a stray space does not become %20 in the field', () => {
    expect(requestAccessHref('  someone@example.test  ')).toBe(
      '/request-access?email=someone%40example.test',
    );
  });
});
