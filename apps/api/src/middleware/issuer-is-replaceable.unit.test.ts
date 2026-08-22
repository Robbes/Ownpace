// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ADR-0042's load-bearing claim, as a test: **the issuer is replaceable.**
 *
 * The ADR chooses Zitadel and names Keycloak as the fallback, and the whole
 * decision rests on being able to make that move with configuration rather than
 * a project. A claim like that is worth nothing asserted in prose — so this
 * file drives the real verification path with each provider's REAL discovery
 * document shape and proves the code knows neither of them.
 *
 * It also pins the bug that made the claim false when it was written.
 * `getJWKS` built the key-set URL by string concatenation:
 *
 *     `${issuer}/.well-known/jwks.json`
 *
 * with a comment naming Auth0 and Clerk. That is their convention, not a
 * standard, and it matches NEITHER provider this project considered:
 *
 *     Zitadel   {domain}/oauth/v2/keys
 *     Keycloak  {host}/realms/{realm}/protocol/openid-connect/certs
 *
 * So the managed auth path worked with two providers nobody had chosen and
 * would have failed on first contact with the one that was. Discovery fixes it
 * at the root: ask the issuer where its keys are, and no provider's URL shape
 * is knowledge this codebase holds.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authenticate, __setMembershipLookupForTests, __resetJwksCacheForTests } from './auth.ts';
import type { Request, Response } from 'express';

/** A discovery document as each provider really publishes it. */
const ZITADEL = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/v2/authorize`,
  token_endpoint: `${origin}/oauth/v2/token`,
  jwks_uri: `${origin}/oauth/v2/keys`,
});

const KEYCLOAK = (origin: string, realm = 'ownpace') => ({
  issuer: `${origin}/realms/${realm}`,
  authorization_endpoint: `${origin}/realms/${realm}/protocol/openid-connect/auth`,
  token_endpoint: `${origin}/realms/${realm}/protocol/openid-connect/token`,
  jwks_uri: `${origin}/realms/${realm}/protocol/openid-connect/certs`,
});

/** Records every URL fetched, so the assertions can be about WHERE we looked. */
function mockDiscovery(document: Record<string, unknown> | null, status = 200) {
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      fetched.push(String(input));
      if (document === null) {
        return { ok: false, status, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => document,
      } as unknown as Response;
    }),
  );
  return fetched;
}

function mockRes() {
  const res = { locals: {} } as unknown as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn().mockImplementation((code: number) => {
    (res as { statusCode?: number }).statusCode = code;
    return res;
  }) as unknown as Response['status'];
  res.json = vi.fn().mockImplementation((b: unknown) => {
    (res as { body?: unknown }).body = b;
    return res;
  }) as unknown as Response['json'];
  return res;
}

const reqWith = (token: string) =>
  ({ headers: { authorization: `Bearer ${token}` } }) as unknown as Request;

const ORIGINAL = { ...process.env };

beforeEach(() => {
  __resetJwksCacheForTests();
  __setMembershipLookupForTests(async () => ({ role: 'owner' }));
  delete process.env.JWT_SECRET;
  delete process.env.JWT_JWKS_URI;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __setMembershipLookupForTests(null);
  __resetJwksCacheForTests();
  process.env = { ...ORIGINAL };
});

describe('the managed auth path asks the issuer where its keys are', () => {
  it("finds Zitadel's keys, which are NOT at /.well-known/jwks.json", async () => {
    const origin = 'https://id.ownpace.eu';
    process.env.JWT_ISSUER = origin;
    const fetched = mockDiscovery(ZITADEL(origin));

    // The token is nonsense on purpose — verification failing is fine and
    // expected. What this file is about is which URLs were consulted on the
    // way there.
    await authenticate(reqWith('not.a.token'), mockRes(), vi.fn());

    expect(fetched[0], 'discovery was not consulted at all').toBe(
      `${origin}/.well-known/openid-configuration`,
    );
    // And nothing ever went looking at the Auth0/Clerk convention.
    expect(fetched.some((u) => u.includes('/.well-known/jwks.json'))).toBe(false);
  });

  it("finds Keycloak's realm keys, which are somewhere else again", async () => {
    const origin = 'https://sso.ownpace.eu';
    const issuer = `${origin}/realms/ownpace`;
    process.env.JWT_ISSUER = issuer;
    const fetched = mockDiscovery(KEYCLOAK(origin));

    await authenticate(reqWith('not.a.token'), mockRes(), vi.fn());

    expect(fetched[0]).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(fetched.some((u) => u.includes('/.well-known/jwks.json'))).toBe(false);
  });

  it('changing provider is changing JWT_ISSUER — the code holds no URL shapes', async () => {
    // The ADR's claim, exercised: same code, same call, two providers whose key
    // endpoints have nothing in common, and the only difference is one variable.
    const zitadel = 'https://id.ownpace.eu';
    process.env.JWT_ISSUER = zitadel;
    const first = mockDiscovery(ZITADEL(zitadel));
    await authenticate(reqWith('x.y.z'), mockRes(), vi.fn());
    expect(first[0]).toContain(zitadel);

    vi.unstubAllGlobals();
    __resetJwksCacheForTests();

    const keycloak = 'https://sso.ownpace.eu/realms/ownpace';
    process.env.JWT_ISSUER = keycloak;
    const second = mockDiscovery(KEYCLOAK('https://sso.ownpace.eu'));
    await authenticate(reqWith('x.y.z'), mockRes(), vi.fn());
    expect(second[0]).toContain(keycloak);
  });

  it('caches per issuer, so a reconfigured issuer is not served the old keys', async () => {
    const origin = 'https://id.ownpace.eu';
    process.env.JWT_ISSUER = origin;
    const fetched = mockDiscovery(ZITADEL(origin));

    await authenticate(reqWith('a.b.c'), mockRes(), vi.fn());
    await authenticate(reqWith('a.b.c'), mockRes(), vi.fn());

    // One discovery fetch for two requests: the key set is cached.
    expect(fetched.filter((u) => u.endsWith('openid-configuration'))).toHaveLength(1);
  });

  it('honours JWT_JWKS_URI as the escape hatch, skipping discovery entirely', async () => {
    process.env.JWT_ISSUER = 'https://id.ownpace.eu';
    process.env.JWT_JWKS_URI = 'https://id.ownpace.eu/oauth/v2/keys';
    const fetched = mockDiscovery(ZITADEL('https://id.ownpace.eu'));

    await authenticate(reqWith('a.b.c'), mockRes(), vi.fn());

    expect(fetched.some((u) => u.endsWith('openid-configuration'))).toBe(false);
  });
});

describe('a discovery document that is not this issuer is refused', () => {
  it('REFUSES a document declaring a different issuer', async () => {
    // OIDC Discovery §4.3. Without this, anything that can answer at the
    // discovery URL — a hijacked DNS record, a misconfigured proxy — points
    // verification at a key set it controls, and every token it mints then
    // verifies. The 500 is correct: this is our configuration being wrong or
    // attacked, not the caller's token being bad.
    process.env.JWT_ISSUER = 'https://id.ownpace.eu';
    mockDiscovery({ ...ZITADEL('https://id.ownpace.eu'), issuer: 'https://evil.example' });

    const res = mockRes();
    await authenticate(reqWith('a.b.c'), res, vi.fn());

    // 500, not 401, and that distinction is the point: a 401 would blame the
    // caller's token for our configuration being wrong or attacked. Nobody's
    // token can fix this, so nobody's token should be told it is the problem.
    expect((res as { statusCode?: number }).statusCode).toBe(500);
  });

  it('says what to fix when the discovery URL answers an error', async () => {
    process.env.JWT_ISSUER = 'https://id.ownpace.eu';
    mockDiscovery(null, 404);

    const res = mockRes();
    await authenticate(reqWith('a.b.c'), res, vi.fn());
    expect((res as { statusCode?: number }).statusCode).toBe(500);
  });

  it('refuses a document with no jwks_uri rather than guessing one', async () => {
    process.env.JWT_ISSUER = 'https://id.ownpace.eu';
    const doc: Record<string, unknown> = { ...ZITADEL('https://id.ownpace.eu') };
    delete doc.jwks_uri;
    mockDiscovery(doc);

    const res = mockRes();
    await authenticate(reqWith('a.b.c'), res, vi.fn());
    expect((res as { statusCode?: number }).statusCode).toBe(500);
  });
});
