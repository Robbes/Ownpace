// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The forms an address takes, and the domains nobody can take along
 * (workplan 0168 T1).
 *
 * The claims that matter are the folds: one too many is two people matched as
 * one, and every card and event of the second would be given the first's new
 * address. So only Gmail is folded, and every other domain keeps its dots and
 * its `+`. The list is pinned entry by entry, with the date its sources were
 * read, so an entry added without a source shows up here.
 */

import { describe, it, expect } from 'vitest';
import { NOT_TAKEN_ALONG, addressKey, cannotTakeAlong, isAddress } from './address-forms.ts';

describe('the key of an address', () => {
  it.each([
    // Every Gmail form is one account (Google's own normalisation, read 2026-11-22).
    ['someone@gmail.com', 'someone@gmail.com'],
    ['Some.One@Gmail.com', 'someone@gmail.com'],
    ['s.o.m.e.o.n.e@gmail.com', 'someone@gmail.com'],
    ['someone+lists@gmail.com', 'someone@gmail.com'],
    ['some.one+a+b@gmail.com', 'someone@gmail.com'],
    ['someone@googlemail.com', 'someone@gmail.com'],
    ['Some.One+x@GoogleMail.com', 'someone@gmail.com'],
    ['  someone@gmail.com  ', 'someone@gmail.com'],
  ])('folds the Gmail form %s to %s', (form, key) => {
    expect(addressKey(form)).toBe(key);
  });

  it.each([
    // No other domain is folded: these are different people there.
    ['a.b@example.org', 'a.b@example.org'],
    ['a+b@example.org', 'a+b@example.org'],
    ['Name.Other+tag@Example.ORG', 'name.other+tag@example.org'],
    ['a.b+c@outlook.com', 'a.b+c@outlook.com'],
    ['a.b@gmail.com.example.org', 'a.b@gmail.com.example.org'],
  ])('keeps %s as %s, in lower case only', (form, key) => {
    expect(addressKey(form)).toBe(key);
  });

  it('never gives two addresses on another domain one key for a dot or a plus', () => {
    expect(addressKey('ab@example.org')).not.toBe(addressKey('a.b@example.org'));
    expect(addressKey('a@example.org')).not.toBe(addressKey('a+b@example.org'));
  });

  it('is the same for every spelling the person may type, and stable when taken again', () => {
    for (const form of ['Some.One+x@googlemail.com', 'name@example.org', 'not an address']) {
      expect(addressKey(addressKey(form))).toBe(addressKey(form));
    }
  });

  it.each(['', 'nobody', 'a@b@c', '@example.org', 'name@', 'na me@example.org', '+x@gmail.com', '...@gmail.com'])(
    'does not take %j for an address',
    (value) => {
      expect(isAddress(value)).toBe(false);
    },
  );

  it('gives a value that is not an address its lower case only, never a Gmail fold', () => {
    expect(addressKey('+x@gmail.com')).toBe('+x@gmail.com');
    expect(addressKey(' Nobody ')).toBe('nobody');
  });
});

describe('the domains nobody can take along', () => {
  it('holds exactly the entries whose sources were read on 2026-11-22', () => {
    expect(NOT_TAKEN_ALONG).toEqual([
      { domain: 'gmail.com', provider: 'Google' },
      { domain: 'googlemail.com', provider: 'Google' },
    ]);
  });

  it('holds each domain once, in lower case', () => {
    const domains = NOT_TAKEN_ALONG.map((e) => e.domain);
    expect(new Set(domains).size).toBe(domains.length);
    for (const d of domains) expect(d).toBe(d.toLowerCase());
  });

  it.each(NOT_TAKEN_ALONG.map((e) => [e.domain, e.provider] as const))(
    'says an address at %s stays with %s',
    (domain, provider) => {
      expect(cannotTakeAlong(`someone@${domain}`)).toEqual({ provider });
      expect(cannotTakeAlong(`Some.One+x@${domain.toUpperCase()}`)).toEqual({ provider });
    },
  );

  it.each(['someone@example.org', 'someone@mail.gmail.com.example.org', 'someone@gmail.com.example.org'])(
    'says nothing of %s, whose domain is not on the list',
    (address) => {
      expect(cannotTakeAlong(address)).toBeNull();
    },
  );

  it('says nothing of a value that is not an address', () => {
    for (const v of ['', 'gmail.com', 'a@b@gmail.com']) expect(cannotTakeAlong(v)).toBeNull();
  });

  it('is frozen, so no caller adds a domain without a source', () => {
    expect(Object.isFrozen(NOT_TAKEN_ALONG)).toBe(true);
  });
});
