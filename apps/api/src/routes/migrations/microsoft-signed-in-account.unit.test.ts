// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH MICROSOFT ACCOUNT SIGNED IN (workplan 0171 §3.3): the ID token's
 * issuer and audience, then the directory's own addresses. The claims that
 * matter are the refusals, so most cases here are one: a token another tenant
 * or another application was given vouches for nobody, a refused `/me` vouches
 * for nobody, and a fault at Microsoft is thrown, never an empty answer.
 */

import { describe, it, expect } from 'vitest';
import {
  MICROSOFT_ME_URL,
  MICROSOFT_PERSONAL_TENANT,
  microsoftIdClaims,
  microsoftSignedInAccount,
  smtpProxyAddresses,
} from './microsoft-signed-in-account.ts';
import { microsoftDomainHint } from './microsoft-consent.ts';

const CLIENT = '00000000-0000-0000-0000-0000000000aa';
const TID = '11111111-2222-3333-4444-555555555555';

function idToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}
const WORK = { iss: `https://login.microsoftonline.com/${TID}/v2.0`, aud: CLIENT, tid: TID, preferred_username: 'u@example.org' };

/** A fetch that answers `/me` with this, and records what it was asked. */
function graph(status: number, body: unknown) {
  const asked: Array<{ url: string; auth: string | undefined }> = [];
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    asked.push({ url, auth: init?.headers?.Authorization });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

describe('the ID token (0171 §3.3)', () => {
  it('is read when its issuer is its own tenant and its audience this application', () => {
    expect(microsoftIdClaims(idToken(WORK), CLIENT)).toEqual({ tid: TID, preferredUsername: 'u@example.org' });
  });

  it('vouches for nobody when anything about who issued it, or for whom, is wrong', () => {
    for (const claims of [
      { ...WORK, iss: 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0' },
      { ...WORK, iss: `https://sts.windows.net/${TID}/` },
      { ...WORK, iss: `https://login.microsoftonline.com/${TID}/v2.0/` },
      { ...WORK, aud: 'another' },
      { ...WORK, tid: 'common', iss: 'https://login.microsoftonline.com/common/v2.0' },
      { ...WORK, tid: undefined },
    ]) {
      expect(microsoftIdClaims(idToken(claims), CLIENT)).toBeNull();
    }
    for (const bad of [undefined, null, 42, '', 'a.b', 'a.!!!.c', `x.${Buffer.from('7').toString('base64url')}.y`]) {
      expect(microsoftIdClaims(bad, CLIENT)).toBeNull();
    }
  });
});

describe('who signed in (0171 §3.3)', () => {
  it('a work account: the UPN, with the mail and every smtp: proxy address beside it', async () => {
    const { fetchImpl, asked } = graph(200, {
      userPrincipalName: 'u@example.org',
      mail: 'First.Last@example.org',
      proxyAddresses: ['SMTP:First.Last@example.org', 'smtp:alias@example.org', 'X500:/o=x', 'SIP:u@example.org'],
    });
    const who = await microsoftSignedInAccount({ idToken: idToken(WORK), accessToken: 'at', clientId: CLIENT }, fetchImpl);
    expect(who).toEqual({ address: 'u@example.org', confirmed: true, alsoKnownAs: ['First.Last@example.org', 'alias@example.org'] });
    expect(asked).toEqual([{ url: MICROSOFT_ME_URL, auth: 'Bearer at' }]);
  });

  it('a personal account: the ID token’s sign-in name, and no directory read', async () => {
    const { fetchImpl, asked } = graph(500, {});
    const personal = { ...WORK, tid: MICROSOFT_PERSONAL_TENANT, iss: `https://login.microsoftonline.com/${MICROSOFT_PERSONAL_TENANT}/v2.0`, preferred_username: 'me@outlook.com' };
    expect(await microsoftSignedInAccount({ idToken: idToken(personal), accessToken: 'at', clientId: CLIENT }, fetchImpl)).toEqual({
      address: 'me@outlook.com',
      confirmed: true,
      alsoKnownAs: [],
    });
    expect(asked).toEqual([]);
  });

  it('nobody, when the ID token is wrong, no access token came, or /me is refused', async () => {
    expect(await microsoftSignedInAccount({ idToken: idToken({ ...WORK, aud: 'x' }), accessToken: 'at', clientId: CLIENT }, graph(200, {}).fetchImpl)).toBeNull();
    expect(await microsoftSignedInAccount({ idToken: idToken(WORK), accessToken: undefined, clientId: CLIENT }, graph(200, {}).fetchImpl)).toBeNull();
    for (const status of [401, 403]) {
      expect(await microsoftSignedInAccount({ idToken: idToken(WORK), accessToken: 'at', clientId: CLIENT }, graph(status, {}).fetchImpl)).toBeNull();
    }
    expect(
      await microsoftSignedInAccount({ idToken: idToken(WORK), accessToken: 'at', clientId: CLIENT }, graph(200, { mail: 'x@example.org' }).fetchImpl),
    ).toBeNull();
  });

  it('throws on a fault at Microsoft, so nothing reads it as nobody (hard rule 9)', async () => {
    await expect(
      microsoftSignedInAccount({ idToken: idToken(WORK), accessToken: 'at', clientId: CLIENT }, graph(503, {}).fetchImpl),
    ).rejects.toThrow(/answered \/me with 503/);
  });

  it('reads only smtp: proxies, either case of the prefix', () => {
    expect(smtpProxyAddresses(['SMTP:a@x.org', 'smtp:b@x.org', 'x500:c', 7, 'smtp:'])).toEqual(['a@x.org', 'b@x.org']);
    expect(smtpProxyAddresses(undefined)).toEqual([]);
  });
});

describe('which sign-in Microsoft is asked to offer (0171 §3.3)', () => {
  it('consumers for Microsoft’s own consumer domains, organisations for every other', () => {
    expect(microsoftDomainHint('me@outlook.com')).toBe('consumers');
    expect(microsoftDomainHint('me@Hotmail.NL')).toBe('consumers');
    expect(microsoftDomainHint('me@contoso.onmicrosoft.com')).toBe('organizations');
    expect(microsoftDomainHint('me@example.org')).toBe('organizations');
    expect(microsoftDomainHint('not an address')).toBe('organizations');
  });
});
