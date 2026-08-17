// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The DWD token provider (ADR-0033, workplan 0053 T1). What these hold, in
 * order of what it would cost an operator if wrong:
 *
 *  1. The assertion impersonates exactly the subject it was built for — the
 *     credential is domain-wide, the instance never is (§1).
 *  2. A key that cannot work refuses AT CONSTRUCTION, naming what is wrong
 *     with the paste — not three steps later as a mint failure.
 *  3. Google's stock refusals are translated to the Admin-console place an
 *     operator can act, with Google's words kept verbatim (§3, rule 9).
 */

import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  GoogleJwtBearerProvider,
  parseServiceAccountKey,
} from './google-jwt-bearer-provider';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'migrator@project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
});

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function fakeFetch(status: number, body: string) {
  const calls: Array<{ url: string; body: string }> = [];
  return {
    calls,
    fetchImpl: async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    },
  };
}

describe('the assertion', () => {
  it('impersonates exactly the built-for subject, RS256-signed with the key', () => {
    const provider = new GoogleJwtBearerProvider(KEY_JSON, 'anna@example.nl', SCOPE);
    const assertion = provider.buildAssertion();

    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const decoded = JSON.parse(Buffer.from(claims!, 'base64url').toString());
    expect(decoded).toMatchObject({
      iss: 'migrator@project.iam.gserviceaccount.com',
      sub: 'anna@example.nl',
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(decoded.exp - decoded.iat).toBe(3600);
    // The signature verifies against the key pair — a mangled private key
    // could not have produced it.
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(verified).toBe(true);
  });

  it('exchanges it with the jwt-bearer grant and caches the minted token', async () => {
    const { calls, fetchImpl } = fakeFetch(
      200,
      JSON.stringify({ access_token: 'ya29.dwd', expires_in: 3600, token_type: 'Bearer' }),
    );
    const provider = new GoogleJwtBearerProvider(KEY_JSON, 'anna@example.nl', SCOPE, {
      fetchImpl,
    });

    const token = await provider.getToken();
    await provider.getToken();

    expect(token.accessToken).toBe('ya29.dwd');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(calls[0]!.body).toContain('assertion=');
  });
});

describe('refusals at construction — before any request', () => {
  it('names a paste that is not JSON, not a key file, or incomplete', () => {
    expect(() => parseServiceAccountKey('not json')).toThrow(/WHOLE key file/);
    expect(() =>
      parseServiceAccountKey(JSON.stringify({ type: 'authorized_user' })),
    ).toThrow(/not a service account key/);
    expect(() =>
      parseServiceAccountKey(JSON.stringify({ type: 'service_account', client_email: 'x@y' })),
    ).toThrow(/missing private_key/);
  });

  it('refuses a missing subject with the one-subject-per-mapping sentence (§1)', () => {
    expect(() => new GoogleJwtBearerProvider(KEY_JSON, '', SCOPE)).toThrow(
      /blast radius is one subject/,
    );
  });
});

describe("Google's stock refusals are translated to the place an operator can act (§3)", () => {
  it('unauthorized_client points at the Admin-console delegation entry, and says to revoke at cutover', async () => {
    const { fetchImpl } = fakeFetch(400, '{"error":"unauthorized_client"}');
    const provider = new GoogleJwtBearerProvider(KEY_JSON, 'anna@example.nl', SCOPE, {
      fetchImpl,
    });

    await expect(provider.getToken()).rejects.toThrow(
      /Domain-wide delegation.*migrator@project\.iam\.gserviceaccount\.com.*revoke/s,
    );
    // Google's own words stay verbatim beside the translation (rule 9).
    await expect(provider.getToken()).rejects.toThrow(/unauthorized_client/);
  });

  it('invalid_grant names the subject as the likely out-of-domain account', async () => {
    const { fetchImpl } = fakeFetch(400, '{"error":"invalid_grant"}');
    const provider = new GoogleJwtBearerProvider(KEY_JSON, 'anna@wrong-domain.nl', SCOPE, {
      fetchImpl,
    });

    await expect(provider.getToken()).rejects.toThrow(/anna@wrong-domain\.nl/);
  });
});
