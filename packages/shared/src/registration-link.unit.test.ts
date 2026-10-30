// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The grant mail's link, written and read back (workplan 0095 T6).
 *
 * The API writes it and the sign-in page reads it, so the two halves are held
 * to each other here: whatever `registrationLink` writes,
 * `addressFromRegistrationLink` reads back as exactly the address. And what
 * the page reads is only ever an address: anything else is null, which is
 * today's sign-in page.
 */
import { describe, it, expect } from 'vitest';
import { addressFromRegistrationLink, registrationLink } from './registration-link.ts';

describe('the link the grant mail carries', () => {
  it('is the sign-in page in the mail’s language, with the address percent-encoded after #', () => {
    expect(registrationLink('https://app.ownpace.eu', 'nl', "O'Brien+x@Example.test")).toBe(
      "https://app.ownpace.eu/login?locale=nl#register=O'Brien%2Bx%40Example.test",
    );
  });

  it('does not double one trailing slash on the setting, and trims the address', () => {
    expect(registrationLink('https://app.ownpace.eu/', 'en', ' anna@example.test ')).toBe(
      'https://app.ownpace.eu/login?locale=en#register=anna%40example.test',
    );
  });

  it('puts the address where no request carries it: after #, and nowhere else', () => {
    // The property the whole design rests on. A fragment is not sent to the
    // server or in a Referer, so no log of ours or of the proxy in front of us
    // receives it. In the path or the query, every one of them would.
    const url = new URL(registrationLink('https://app.ownpace.eu', 'en', 'anna@example.test'));
    expect(url.pathname).toBe('/login');
    expect(url.search).toBe('?locale=en');
    expect(`${url.origin}${url.pathname}${url.search}`).not.toContain('example.test');
    expect(url.hash).toBe('#register=anna%40example.test');
  });

  it.each([
    "O'Brien+x@Example.test",
    'anna+alpha4@example.test',
    'jan.de.vries@sub.example.nl',
    'a&b=c@example.test',
    'x%41@example.test',
  ])('reads back exactly what it wrote: %s', (address) => {
    const url = new URL(registrationLink('https://app.example.test', 'en', address));
    expect(addressFromRegistrationLink(url.hash)).toBe(address);
  });
});

describe('what the sign-in page accepts from the fragment', () => {
  it('takes the fragment with or without its #', () => {
    expect(addressFromRegistrationLink('#register=anna%40example.test')).toBe('anna@example.test');
    expect(addressFromRegistrationLink('register=anna%40example.test')).toBe('anna@example.test');
  });

  it('finds the key among others', () => {
    expect(addressFromRegistrationLink('#x=1&register=anna%40example.test')).toBe('anna@example.test');
  });

  it('takes up to 320 characters, the request form’s own limit', () => {
    const longest = `${'a'.repeat(320 - '@example.test'.length)}@example.test`;
    expect(longest).toHaveLength(320);
    expect(addressFromRegistrationLink(`#register=${encodeURIComponent(longest)}`)).toBe(longest);
    expect(addressFromRegistrationLink(`#register=${encodeURIComponent(`a${longest}`)}`)).toBeNull();
  });

  it.each([
    ['no fragment', ''],
    ['an empty fragment', '#'],
    ['another key', '#login=anna%40example.test'],
    ['a key that only starts the same', '#registered=anna%40example.test'],
    ['an empty value', '#register='],
    ['a broken escape', '#register=%E0%A'],
    ['no @', '#register=anna.example.test'],
    ['two @', '#register=anna%40b%40example.test'],
    ['a script', '#register=javascript%3Aalert(1)'],
    ['a space inside', '#register=anna%20b%40example.test'],
    ['nothing before the @', '#register=%40example.test'],
    ['nothing after the @', '#register=anna%40'],
  ])('reads %s as null, which is today’s page', (_what, hash) => {
    expect(addressFromRegistrationLink(hash)).toBeNull();
  });
});
