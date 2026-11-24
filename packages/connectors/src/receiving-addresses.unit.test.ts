// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two reads behind Finish's addresses (workplan 0171 T10), over recorded
 * answers: each answer sorted into the state the screen acts on, and none of
 * them an empty list where the provider refused (hard rule 9).
 */

import { describe, expect, it } from 'vitest';
import type { HttpClient } from './dav-http.types.ts';
import { readGmailReceivingAddresses, readGraphReceivingAddresses } from './receiving-addresses.ts';

function answering(status: number, body: unknown): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async request({ url }) {
      urls.push(url);
      return { status, body: typeof body === 'string' ? body : JSON.stringify(body), headers: {} };
    },
  };
}

const token = async () => 'token';

describe('Graph', () => {
  it('reads /me for a delegated connection, onmicrosoft.com left out', async () => {
    const http = answering(200, {
      mail: 'anna@example.com',
      proxyAddresses: ['SMTP:anna@example.com', 'smtp:info@example.com', 'smtp:anna@contoso.onmicrosoft.com'],
    });
    expect(await readGraphReceivingAddresses(token, http)).toEqual({
      state: 'read',
      provider: 'Microsoft',
      addresses: ['anna@example.com', 'info@example.com'],
    });
    expect(http.urls[0]).toBe('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,proxyAddresses');
  });

  it('reads /users/{mailbox} under application permissions', async () => {
    const http = answering(200, { mail: 'anna@example.com' });
    await readGraphReceivingAddresses(token, http, { mailbox: 'anna@example.com' });
    expect(http.urls[0]).toContain('/users/anna%40example.com?');
  });

  it('asks to reconnect when the consent lacks User.Read, at the token or at Graph', async () => {
    const noConsent = async () => {
      throw new Error('invalid_grant: AADSTS65001: The user or administrator has not consented to use the application');
    };
    expect(await readGraphReceivingAddresses(noConsent, answering(200, {}))).toEqual({
      state: 'not_read',
      provider: 'Microsoft',
      why: 'reconnect',
    });
    const forbidden = answering(403, { error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges' } });
    expect((await readGraphReceivingAddresses(token, forbidden)).state).toBe('not_read');
  });

  it('says any other failure in Graph\'s words', async () => {
    const got = await readGraphReceivingAddresses(token, answering(503, { error: { code: 'ServiceUnavailable', message: 'Try later' } }));
    expect(got).toEqual({ state: 'failed', provider: 'Microsoft', reason: 'Graph answered 503: ServiceUnavailable — Try later' });
  });
});

describe('Gmail', () => {
  it('reads sendAs, gmail.com left out', async () => {
    const http = answering(200, { sendAs: [{ sendAsEmail: 'anna@example.com' }, { sendAsEmail: 'anna@gmail.com' }] });
    expect(await readGmailReceivingAddresses(token, http)).toEqual({
      state: 'read',
      provider: 'Google',
      addresses: ['anna@example.com'],
    });
    expect(http.urls[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs');
  });

  it('says the Gmail API is off on the project (§12 question 3)', async () => {
    const off = answering(403, {
      error: {
        code: 403,
        message: 'Gmail API has not been used in project 123 before or it is disabled.',
        status: 'PERMISSION_DENIED',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    });
    expect(await readGmailReceivingAddresses(token, off)).toEqual({ state: 'not_read', provider: 'Google', why: 'api_off' });
  });

  it('asks to reconnect on a scope refusal, and says anything else as it is', async () => {
    const scope = answering(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.' } });
    expect((await readGmailReceivingAddresses(token, scope)).state).toBe('not_read');
    expect((await readGmailReceivingAddresses(token, answering(500, 'backend error'))).state).toBe('failed');
  });
});
