// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Finish's two checks as both editions call them (workplan 0171 T10): the
 * addresses are read only for a mailbox on the person's own domain, and the
 * MX check asks for that domain and reads the answer into its line.
 */

import { describe, expect, it, vi } from 'vitest';
import type { DnsVerificationResult } from '@openmig/core';
import { checkMx, finishAddresses, mailHostOfTarget, readReceivingAddresses } from './finish-checks.ts';

const http = { request: vi.fn() };

describe('the addresses', () => {
  it('are not read for an address the old provider keeps', async () => {
    const read = vi.fn();
    expect(await finishAddresses('anna@gmail.com', read)).toEqual({
      address: 'anna@gmail.com',
      ownDomain: null,
      receiving: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('are read for an own domain', async () => {
    const got = await finishAddresses('anna@example.com', async () => ({ state: 'not_readable' }));
    expect(got).toEqual({ address: 'anna@example.com', ownDomain: 'example.com', receiving: { state: 'not_readable' } });
  });

  it('cannot be asked of IMAP, nor of Gmail through an app password', async () => {
    expect(await readReceivingAddresses({ family: 'other' }, 'anna@example.com', http)).toEqual({ state: 'not_readable' });
    expect(
      await readReceivingAddresses({ family: 'google', creds: { appPassword: 'x' } }, 'anna@example.com', http),
    ).toEqual({ state: 'not_readable' });
  });

  it('say a Microsoft connection with no registration in its builder\'s words', async () => {
    const got = await readReceivingAddresses({ family: 'microsoft', tenantId: 'common', creds: {} }, 'anna@example.com', http);
    expect(got.state).toBe('failed');
  });
});

describe('the MX check', () => {
  const answer = (records: string[]): DnsVerificationResult => ({
    success: true,
    recordType: 'MX',
    expected: [],
    found: records,
    missing: [],
    warnings: [],
    consensus: true,
    resolverResults: {
      Cloudflare: { resolver: 'Cloudflare', success: true, records },
      Google: { resolver: 'Google', success: true, records },
      Quad9: { resolver: 'Quad9', success: true, records },
    },
  });

  it('asks for the mailbox\'s domain and reads ok for the destination', async () => {
    const ask = vi.fn(async () => answer(['10 mx.example.net.']));
    const got = await checkMx(
      { address: 'anna@example.com', family: 'microsoft', destinationKind: 'jmap', destinationMailHost: 'mail.example.net' },
      ask,
    );
    expect(ask).toHaveBeenCalledWith('example.com');
    expect(got).toEqual({ domain: 'example.com', reading: { line: 'ok', hosts: ['mx.example.net'], destination: 'mail.example.net' } });
  });

  it('reads old while MX is still at Microsoft', async () => {
    const got = await checkMx(
      { address: 'anna@example.com', family: 'microsoft', destinationKind: 'cirrux', destinationMailHost: undefined },
      async () => answer(['0 example-com.mail.protection.outlook.com.']),
    );
    expect(got).toMatchObject({ reading: { line: 'old', provider: 'Microsoft' } });
  });

  it('asks nothing for an address that has no MX of the person\'s', async () => {
    const ask = vi.fn();
    expect(
      await checkMx({ address: 'anna@gmail.com', family: 'google', destinationKind: 'jmap', destinationMailHost: undefined }, ask),
    ).toEqual({ domain: null, reason: 'not_own_domain' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('the destination\'s mail host', () => {
  it('is read from an IMAP host or a JMAP URL', () => {
    expect(mailHostOfTarget({ host: 'imap.example.net' })).toBe('imap.example.net');
    expect(mailHostOfTarget({ baseUrl: 'https://mail.example.net' })).toBe('mail.example.net');
    expect(mailHostOfTarget({})).toBeUndefined();
    expect(mailHostOfTarget(null)).toBeUndefined();
  });
});
