// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SERVER AGAINST THE ADDRESS'S OWN MAIL (workplan 0174 §5.8, the owner's
 * D3 of 2026-11-25, T3): a warning, never a refusal, and a lookup that fails
 * says nothing either way.
 */

import { describe, it, expect, vi } from 'vitest';
import { addressDomain, isAddressLiteral, registrableDomain, serverAgainstAddress } from './grant-server-domain.ts';

describe('registrableDomain', () => {
  it('is the last two labels, or three under a second-level suffix', () => {
    expect(registrableDomain('imap.mail.example.com')).toBe('example.com');
    expect(registrableDomain('IMAP.Example.NL.')).toBe('example.nl');
    expect(registrableDomain('mail.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(registrableDomain('192.0.2.10')).toBe('192.0.2.10');
  });
});

describe('addressDomain and isAddressLiteral', () => {
  it('reads an address’s domain, and an IP literal as one', () => {
    expect(addressDomain('anna@Example.org')).toBe('example.org');
    expect(addressDomain('anna')).toBeNull();
    expect(addressDomain('anna@localhost')).toBeNull();
    expect(isAddressLiteral('192.0.2.10')).toBe(true);
    expect(isAddressLiteral('[2001:db8::1]')).toBe(true);
    expect(isAddressLiteral('imap.example.org')).toBe(false);
  });
});

describe('serverAgainstAddress', () => {
  it('compares nothing for a published server, and asks no resolver for a host on the address’s own domain', async () => {
    const readMx = vi.fn();
    expect(await serverAgainstAddress('anna@icloud.com', { hosts: ['caldav.icloud.com'], published: true }, readMx)).toEqual({
      hosts: ['caldav.icloud.com'],
      published: true,
      domains: ['icloud.com'],
    });
    expect(await serverAgainstAddress('anna@example.org', { hosts: ['imap.example.org'], published: false }, readMx)).toEqual({
      hosts: ['imap.example.org'],
      published: false,
      domains: ['example.org'],
      notTheAddressMail: [],
    });
    expect(readMx).not.toHaveBeenCalled();
  });

  it('matches a host on one of the domain’s MX hosts’ domains, and names the one on neither', async () => {
    const readMx = vi.fn(async () => ['mx1.mailhost.example', 'mx2.mailhost.example']);
    const server = await serverAgainstAddress(
      'anna@family.example',
      { hosts: ['dav.mailhost.example', 'imap.elsewhere.example'], published: false },
      readMx,
    );
    expect(readMx).toHaveBeenCalledWith('family.example');
    expect(server.domains).toEqual(['mailhost.example', 'elsewhere.example']);
    expect(server.notTheAddressMail).toEqual(['imap.elsewhere.example']);
  });

  it('says nothing either way when the lookup fails, or the account is no address', async () => {
    const failed = await serverAgainstAddress('anna@family.example', { hosts: ['imap.elsewhere.example'], published: false }, async () => null);
    expect(failed).toEqual({ hosts: ['imap.elsewhere.example'], published: false, domains: ['elsewhere.example'] });
    const notAnAddress = await serverAgainstAddress('anna', { hosts: ['imap.elsewhere.example'], published: false }, async () => []);
    expect(notAnAddress.notTheAddressMail).toBeUndefined();
  });
});
