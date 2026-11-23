// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The forms an address takes, and the domains nobody can take along
 * (workplan 0168 T1).
 *
 * The claims that matter are the folds: one too many is two people matched as
 * one, and every card and event of the second would be given the first's new
 * address. So only Gmail is folded, and every other domain keeps its dots and
 * its `+`. The list is pinned entry by entry, with the date its sources were
 * read, so an entry added without a source shows up here. The one rule beside
 * it, a Microsoft 365 tenant's own domain under `onmicrosoft.com`, is read on
 * whole labels, so a lookalike never matches.
 */

import { describe, it, expect } from 'vitest';
import {
  NOT_TAKEN_ALONG,
  UNDER_ONMICROSOFT,
  addressKey,
  cannotTakeAlong,
  domainOf,
  isAddress,
  isMicrosoftTenantDomain,
} from './address-forms.ts';

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

  // 0168's review, finding 3: a NUL passed the check and reached Postgres,
  // which refuses it (22021), so the write failed with a 500 whose log line
  // carried both addresses. A control character or half a surrogate pair is
  // in no address, so the check refuses it before anything stores it.
  it.each([
    ['a NUL', 'mum\u0000@example.com'],
    ['a NUL in the domain', 'mum@exa\u0000mple.com'],
    ['a bell', 'mu\u0007m@example.org'],
    ['a delete', 'mum\u007f@example.org'],
    ['a C1 control', 'mum\u0085@example.org'],
    ['half a surrogate pair', 'mum\ud800@example.org'],
    ['the other half', '\udc00mum@example.org'],
  ])('does not take an address with %s for one', (_what, value) => {
    expect(isAddress(value)).toBe(false);
  });

  it('proposes nothing for such a value either', () => {
    expect(cannotTakeAlong('someone\u0000@gmail.com')).toBeNull();
    expect(cannotTakeAlong('someone@gmail.com')).toEqual({ provider: 'Google' });
  });

  it('still takes an address written in other scripts, or with an emoji, for one', () => {
    for (const v of ['jörg@example.org', 'имя@example.org', '😀@example.org', 'İnci@example.org']) {
      expect(isAddress(v), v).toBe(true);
    }
  });
});

describe('the domains nobody can take along', () => {
  /**
   * Every domain, by provider and in the list's order, as its sources were
   * read: Google's on 2026-11-22, the rest on 2026-11-23 (`address-forms.ts`
   * names each group's page; workplan 0168's Status block lists them).
   */
  const READ: ReadonlyArray<readonly [provider: string, domains: ReadonlyArray<string>]> = [
    ['Google', ['gmail.com', 'googlemail.com']],
    [
      'Microsoft',
      [
        'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'hotmail.co.uk', 'live.co.uk', 'outlook.co.uk',
        'windowslive.com', 'outlook.at', 'outlook.be', 'outlook.cl', 'outlook.cz', 'outlook.de', 'outlook.dk',
        'outlook.es', 'outlook.fr', 'outlook.hu', 'outlook.ie', 'outlook.in', 'outlook.it', 'outlook.jp',
        'outlook.kr', 'outlook.lv', 'outlook.my', 'outlook.ph', 'outlook.pt', 'outlook.sa', 'outlook.sg',
        'outlook.sk', 'outlook.co.id', 'outlook.co.il', 'outlook.co.th', 'outlook.com.ar', 'outlook.com.au',
        'outlook.com.br', 'outlook.com.gr', 'outlook.com.tr', 'outlook.com.vn', 'hotmail.be', 'hotmail.ca',
        'hotmail.cl', 'hotmail.cz', 'hotmail.de', 'hotmail.dk', 'hotmail.es', 'hotmail.fi', 'hotmail.fr',
        'hotmail.gr', 'hotmail.hu', 'hotmail.it', 'hotmail.lt', 'hotmail.lv', 'hotmail.my', 'hotmail.nl',
        'hotmail.no', 'hotmail.ph', 'hotmail.rs', 'hotmail.se', 'hotmail.sg', 'hotmail.sk', 'hotmail.co.id',
        'hotmail.co.il', 'hotmail.co.in', 'hotmail.co.jp', 'hotmail.co.kr', 'hotmail.co.th', 'hotmail.co.za',
        'hotmail.com.ar', 'hotmail.com.au', 'hotmail.com.br', 'hotmail.com.hk', 'hotmail.com.tr',
        'hotmail.com.tw', 'hotmail.com.vn', 'live.at', 'live.be', 'live.ca', 'live.cl', 'live.cn', 'live.de',
        'live.dk', 'live.fi', 'live.fr', 'live.hk', 'live.ie', 'live.in', 'live.it', 'live.jp', 'live.nl',
        'live.no', 'live.ru', 'live.se', 'live.co.jp', 'live.co.kr', 'live.co.za', 'live.com.ar', 'live.com.au',
        'live.com.mx', 'live.com.my', 'live.com.ph', 'live.com.pt', 'live.com.sg', 'livemail.tw',
      ],
    ],
    ['Apple', ['icloud.com', 'me.com', 'mac.com']],
    [
      'Yahoo',
      [
        'yahoo.com', 'myyahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'ymail.com', 'rocketmail.com', 'yahoo.ca',
        'yahoo.de', 'yahoo.it', 'yahoo.es', 'yahoo.se', 'yahoo.co.in', 'yahoo.co.nz', 'yahoo.com.au',
        'yahoo.com.ar', 'yahoo.com.br', 'yahoo.com.mx',
      ],
    ],
    ['Ziggo', ['ziggo.nl', 'quicknet.nl', 'home.nl', 'casema.nl', 'upcmail.nl', 'chello.nl', 'a2000.nl']],
    [
      'KPN',
      [
        'kpnmail.nl', 'kpnplanet.nl', 'planet.nl', 'wxs.nl', 'hetnet.nl', 'freeler.nl', 'snelnet.net', 'on.nl',
        'onsbrabantnet.nl', 'onsmail.nl', 'onsnet.nu', 'onsneteindhoven.nl', 'onsnetnuenen.nl', 'xs4all.nl',
        'telfort.nl', 'tip.nl', 'tiscali.nl', 'tiscalimail.nl',
      ],
    ],
    ['Telenet', ['telenet.be']],
    ['Proximus', ['proximus.be', 'skynet.be', 'belgacom.net']],
  ];

  it('holds exactly the entries whose sources were read on 2026-11-22 and 2026-11-23', () => {
    const entries = READ.flatMap(([provider, domains]) => domains.map((domain) => ({ domain, provider })));
    expect(NOT_TAKEN_ALONG).toEqual(entries);
  });

  // The owner's request named Gmail, Live and Hotmail, and families moving
  // together; a Dutch household's internet provider is the other case.
  it.each([
    ['someone@hotmail.com', 'Microsoft'],
    ['Someone@Live.nl', 'Microsoft'],
    ['someone@ziggo.nl', 'Ziggo'],
  ])('proposes %s, an address %s keeps', (address, provider) => {
    expect(cannotTakeAlong(address)).toEqual({ provider });
  });

  // Each domain is matched whole: a domain that only looks like one on the
  // list, or a host under one, is somebody else's.
  it.each([
    'someone@hotmail.example.com',
    'someone@notgmail.com',
    'someone@hotmail.com.example.org',
    'someone@live.nl.example.org',
    'someone@ziggo.nl.example.org',
    'someone@mail.hotmail.com',
    'someone@my.icloud.com',
    'someone@hotmail',
  ])('proposes nothing for %s, which only looks like a domain on the list', (address) => {
    expect(cannotTakeAlong(address)).toBeNull();
  });

  it('names each domain in full, never a pattern', () => {
    for (const { domain } of NOT_TAKEN_ALONG) expect(domain, domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
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

describe('the one rule beside the list: a Microsoft 365 tenant’s own domain', () => {
  // The owner, 2026-11-23: "Yes, any .onmicrosoft.com", one suffix rule beside
  // the list, matched on a whole label, so a lookalike never matches.
  it.each([
    'someone@contoso.onmicrosoft.com',
    'someone@contoso.mail.onmicrosoft.com',
    'Some.One+x@Contoso.OnMicrosoft.COM',
  ])('says %s stays with Microsoft, as the list says of outlook.com', (address) => {
    expect(cannotTakeAlong(address)).toEqual({ provider: 'Microsoft' });
    expect(cannotTakeAlong(address)).toEqual(cannotTakeAlong('someone@outlook.com'));
  });

  it.each([
    'someone@onmicrosoft.com',
    'someone@notonmicrosoft.com',
    'someone@onmicrosoft.com.example.com',
    'someone@onmicrosoft.co',
    'someone@contosoonmicrosoft.com',
    'someone@.onmicrosoft.com',
    'someone@contoso..onmicrosoft.com',
  ])('says nothing of %s, which only looks like a tenant’s domain', (address) => {
    expect(cannotTakeAlong(address)).toBeNull();
  });

  it('reads a domain on whole labels, one label or more before onmicrosoft.com', () => {
    expect(isMicrosoftTenantDomain('contoso.onmicrosoft.com')).toBe(true);
    expect(isMicrosoftTenantDomain('contoso.mail.onmicrosoft.com')).toBe(true);
    for (const d of ['onmicrosoft.com', 'notonmicrosoft.com', 'onmicrosoft.com.example.com', 'onmicrosoft.co', '']) {
      expect(isMicrosoftTenantDomain(d), d).toBe(false);
    }
  });

  it('names the provider the list’s Microsoft entries name', () => {
    const named = new Set(NOT_TAKEN_ALONG.filter((e) => e.domain.startsWith('hotmail.')).map((e) => e.provider));
    expect([...named]).toEqual([UNDER_ONMICROSOFT.provider]);
  });

  it('leaves the list whole domains: none of its entries is the parent or a host under it', () => {
    expect(NOT_TAKEN_ALONG.some((e) => e.domain === UNDER_ONMICROSOFT.parent)).toBe(false);
    for (const { domain } of NOT_TAKEN_ALONG) expect(isMicrosoftTenantDomain(domain), domain).toBe(false);
  });

  it('is frozen, so no caller widens it', () => {
    expect(Object.isFrozen(UNDER_ONMICROSOFT)).toBe(true);
  });
});

describe('the domain of an address', () => {
  it.each([
    ['Name@Example.ORG', 'example.org'],
    ['  someone@contoso.onmicrosoft.com  ', 'contoso.onmicrosoft.com'],
    // No Gmail fold: the domain as it follows the `@`.
    ['Some.One+x@GoogleMail.com', 'googlemail.com'],
  ])('reads %j as %s', (address, domain) => {
    expect(domainOf(address)).toBe(domain);
  });

  it.each(['', 'nobody', 'a@b@c', 'name@', '+x@gmail.com', 'na me@example.org'])(
    'reads no domain in %j, which is not an address',
    (value) => {
      expect(domainOf(value)).toBeNull();
    },
  );
});
