// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Finish's addresses (workplan 0171 T10, §7.2): which mailbox is on a domain
 * the person controls, and which addresses Graph's and Gmail's recorded
 * answers name, with the old provider's own domains left out.
 */

import { describe, expect, it } from 'vitest';
import {
  addressesFromGmailSendAs,
  addressesFromGraphUser,
  ownDomainOf,
  UnreadableAddressAnswer,
} from './finish-addresses.ts';

describe('own domain or not', () => {
  it('is the domain of an address the person controls', () => {
    expect(ownDomainOf('Anna@Example.com')).toBe('example.com');
    expect(ownDomainOf(' office@example.test ')).toBe('example.test');
  });

  it('is null for an address the old provider keeps', () => {
    expect(ownDomainOf('someone@gmail.com')).toBeNull();
    expect(ownDomainOf('someone@googlemail.com')).toBeNull();
    expect(ownDomainOf('someone@outlook.com')).toBeNull();
    expect(ownDomainOf('admin@contoso.onmicrosoft.com')).toBeNull();
  });

  it('is null for no address at all', () => {
    expect(ownDomainOf(undefined)).toBeNull();
    expect(ownDomainOf(null)).toBeNull();
    expect(ownDomainOf('')).toBeNull();
    expect(ownDomainOf('not an address')).toBeNull();
  });
});

describe('aliases from a recorded Graph answer', () => {
  // `GET /me?$select=mail,userPrincipalName,proxyAddresses`, as Graph answers
  // it for a work account with two aliases and the tenant's own domain.
  const recorded = {
    '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#users(mail,userPrincipalName,proxyAddresses)/$entity',
    mail: 'Anna@example.com',
    userPrincipalName: 'anna@contoso.onmicrosoft.com',
    proxyAddresses: [
      'SMTP:Anna@example.com',
      'smtp:info@example.com',
      'smtp:anna@contoso.onmicrosoft.com',
      'smtp:anna@contoso.mail.onmicrosoft.com',
      'smtp:sales@example.test',
      'SIP:anna@example.com',
      'x500:/o=ExchangeLabs/ou=Exchange Administrative Group/cn=Recipients/cn=anna',
    ],
  };

  it('lists mail and every smtp entry, once each, lower-cased', () => {
    expect(addressesFromGraphUser(recorded)).toEqual(['anna@example.com', 'info@example.com', 'sales@example.test']);
  });

  it('leaves out onmicrosoft.com, the user principal name and the other proxy types', () => {
    const got = addressesFromGraphUser(recorded);
    expect(got.some((a) => a.endsWith('onmicrosoft.com'))).toBe(false);
    expect(got.some((a) => a.startsWith('/o='))).toBe(false);
  });

  it('reads a user with no proxy addresses (a personal account) as its mail alone', () => {
    expect(addressesFromGraphUser({ mail: 'anna@example.com', userPrincipalName: 'anna@example.com' })).toEqual([
      'anna@example.com',
    ]);
  });

  it('refuses an answer it cannot read rather than listing nothing', () => {
    expect(() => addressesFromGraphUser(null)).toThrow(UnreadableAddressAnswer);
    expect(() => addressesFromGraphUser({ proxyAddresses: 'smtp:a@example.com' })).toThrow(UnreadableAddressAnswer);
  });
});

describe('aliases from a recorded Gmail answer', () => {
  // `GET gmail/v1/users/me/settings/sendAs`, as Gmail answers it for a
  // Workspace account with an alias on a second domain.
  const recorded = {
    sendAs: [
      { sendAsEmail: 'anna@example.com', displayName: '', replyToAddress: '', signature: '', isPrimary: true, isDefault: true },
      { sendAsEmail: 'Info@Example.com', displayName: 'Info', treatAsAlias: true, verificationStatus: 'accepted' },
      { sendAsEmail: 'anna@example.test', treatAsAlias: true, verificationStatus: 'accepted' },
      { sendAsEmail: 'anna.private@gmail.com', treatAsAlias: false, verificationStatus: 'accepted' },
    ],
  };

  it('lists each sendAsEmail, once, without gmail.com', () => {
    expect(addressesFromGmailSendAs(recorded)).toEqual(['anna@example.com', 'anna@example.test', 'info@example.com']);
  });

  it('reads an answer with no list as no addresses, and a malformed one as unreadable', () => {
    expect(addressesFromGmailSendAs({})).toEqual([]);
    expect(() => addressesFromGmailSendAs({ sendAs: 'anna@example.com' })).toThrow(UnreadableAddressAnswer);
    expect(() => addressesFromGmailSendAs(undefined)).toThrow(UnreadableAddressAnswer);
  });
});
