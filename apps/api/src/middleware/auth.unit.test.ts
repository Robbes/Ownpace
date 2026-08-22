// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed (JWKS) authentication path, tested through the middleware.
 *
 * WHAT THIS FILE USED TO BE, because it matters for trusting what it is now.
 * Until 2026-08-15 this file never imported `./auth`. It imported `jose` and
 * `jsonwebtoken`, generated a keypair, and asserted that `jwtVerify` rejects
 * tokens signed with the wrong key — which is a test of jose, a library that has
 * its own test suite. Its docblock claimed it "proves that forged tokens,
 * unsigned tokens, expired tokens, etc. are rejected". It proved nothing of the
 * sort about this repository.
 *
 * The consequence was measured, not guessed: replacing the `jwtVerify` call in
 * `verifyManagedToken` (auth.ts:119) with a bare `decodeJwt` — so the production
 * managed path accepts ANY token, forged or unsigned, with no signature, issuer
 * or audience check — left the whole gate green. 32/32 in this directory, 2256
 * across `pnpm test`. The case named "should reject a FORGED token claiming
 * tenant A - proving the bypass is closed" passed with the bypass wide open.
 *
 * HOW THIS ONE IS DIFFERENT. Every case drives `authenticate` and asserts on the
 * HTTP outcome, so it fails when the middleware stops verifying. Signature
 * checking is REAL: only `createRemoteJWKSet` is stubbed, replacing the network
 * fetch of the issuer's public keys with a local resolver. `jwtVerify` itself is
 * the genuine jose implementation, checking a genuine RS256 signature, issuer,
 * audience and claims.
 *
 * The stub also sidesteps a trap. The key-set cache is module-level, so a
 * per-test stub swapped by re-mocking would bleed between cases. Here the cached
 * value is a stable wrapper that delegates to whichever resolver the current
 * test installed, so the cache is harmless — and `__resetJwksCacheForTests`
 * clears it between cases besides.
 *
 * UPDATED 2026-08-22 (ADR-0042): the middleware no longer GUESSES the key-set
 * URL as `${issuer}/.well-known/jwks.json` — an Auth0/Clerk convention that
 * matched neither provider this project considered. It reads `jwks_uri` out of
 * the issuer's discovery document, so `beforeEach` now serves one. That the
 * cases below went red when it changed is the point of them: they drive the
 * real path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Hoisted so the `vi.mock` factory below can close over it: the mock is lifted
// above the imports, so it cannot reference an ordinary module-level binding.
const stub = vi.hoisted(() => ({
  resolveKey: null as null | ((header: unknown, token: unknown) => Promise<unknown>),
}));

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    // The ONLY thing replaced. Returns a stable delegating resolver, so the
    // module-level jwksCache can hold it forever and still see each test's key.
    createRemoteJWKSet: () => (header: unknown, token: unknown) => {
      if (!stub.resolveKey) throw new Error('test did not install a key resolver');
      return stub.resolveKey(header, token);
    },
  };
});

const { SignJWT, exportJWK, generateKeyPair, importJWK } = await import('jose');
const {
  authenticate,
  __setMembershipLookupForTests,
  __setMembershipsLookupForTests,
  __resetJwksCacheForTests,
} = await import('./auth.ts');

const ISSUER = 'https://issuer.example';
const AUDIENCE = 'openmig-api';

/** The issuer's real keypair, and an attacker's — different keys, same algorithm. */
let issuerKeys: { publicKey: CryptoKey; privateKey: CryptoKey };
let attackerKeys: { publicKey: CryptoKey; privateKey: CryptoKey };

function claims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    tenantId: 'tenant-1',
    role: 'admin',
    email: 'u@example.com',
    ...overrides,
  };
}

async function sign(
  privateKey: CryptoKey,
  payload: Record<string, unknown> = claims(),
  opts: { issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(privateKey);
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

function reqWith(token?: string): Request {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} } as unknown as Request;
}

/** Run the middleware and report what it decided. */
async function run(token?: string) {
  const req = reqWith(token);
  const res = mockRes();
  const next = vi.fn() as unknown as NextFunction;
  await authenticate(req, res, next);
  return {
    req: req as Request & { userId?: string; tenantId?: string; userRole?: string },
    status: (res as { statusCode?: number }).statusCode,
    body: (res as { body?: unknown }).body,
    passed: (next as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1,
  };
}

beforeEach(async () => {
  issuerKeys = (await generateKeyPair('RS256')) as typeof issuerKeys;
  attackerKeys = (await generateKeyPair('RS256')) as typeof attackerKeys;

  // The issuer publishes ONLY its own public key — exactly what a real JWKS
  // endpoint serves. Anything signed by another key must fail to verify.
  const jwk = await exportJWK(issuerKeys.publicKey);
  stub.resolveKey = async () => importJWK(jwk, 'RS256');

  process.env.JWT_ISSUER = ISSUER;
  process.env.JWT_AUDIENCE = AUDIENCE;
  delete process.env.JWT_SECRET;
  delete process.env.JWT_JWKS_URI;

  // The issuer's discovery document. `getJWKS` asks for this before it can look
  // up any key — it no longer guesses a URL (ADR-0042 / `issuer-is-replaceable`),
  // so without it every case here fails on configuration rather than on the
  // thing it is testing. `jwks_uri` is only carried to `createRemoteJWKSet`,
  // which is stubbed above, so its value is never fetched.
  __resetJwksCacheForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ issuer: ISSUER, jwks_uri: `${ISSUER}/oauth/v2/keys` }),
    })),
  );

  // These cases exercise VERIFICATION; the membership gate gets a fake that
  // admits the subject. The gate has its own cases at the bottom.
  __setMembershipLookupForTests(async () => ({ role: 'admin' }));
});

afterEach(() => {
  delete process.env.JWT_ISSUER;
  delete process.env.JWT_AUDIENCE;
  __setMembershipLookupForTests(null);
  stub.resolveKey = null;
  __resetJwksCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authenticate — managed JWKS path, accepting a good token', () => {
  it('accepts a token signed by the issuer and attaches the tenant context', async () => {
    const { status, passed, req } = await run(await sign(issuerKeys.privateKey));

    expect(status, `rejected a legitimate token: ${status}`).toBeUndefined();
    expect(passed).toBe(true);
    expect(req.userId).toBe('user-1');
    expect(req.tenantId).toBe('tenant-1');
  });
});

describe('authenticate — managed JWKS path, refusing a bad token', () => {
  // Each case below fails if the middleware stops verifying. That is the whole
  // point: the previous version of this file passed with verification removed.

  it('REJECTS a token signed with a key the issuer does not publish', async () => {
    // The forgery case. An attacker with their own RSA key mints a token whose
    // claims are perfectly well-formed; only the signature betrays it.
    const forged = await sign(attackerKeys.privateKey);
    const { status, passed } = await run(forged);

    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('REJECTS an unsigned token (alg: none)', async () => {
    // jose will not mint one, so it is assembled by hand — which is precisely
    // what an attacker does. The empty signature must not be treated as valid.
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      ...claims(),
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.`;

    const { status, passed } = await run(unsigned);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('REJECTS a token whose payload was tampered with after signing', async () => {
    // Privilege escalation by editing the claims of an otherwise valid token:
    // the signature no longer matches the body.
    const good = await sign(issuerKeys.privateKey);
    const [header, , signature] = good.split('.');
    const tampered = `${header}.${Buffer.from(
      JSON.stringify({ ...claims({ role: 'owner', tenantId: 'tenant-victim' }), iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 300 }),
    ).toString('base64url')}.${signature}`;

    const { status, passed } = await run(tampered);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('REJECTS a token from a different issuer, even correctly signed', async () => {
    // The signature is genuine — the resolver hands back the issuer's key — but
    // `iss` names somebody else. Without the issuer check a token minted for a
    // different tenant of the same IdP would be accepted here.
    const wrongIssuer = await sign(issuerKeys.privateKey, claims(), {
      issuer: 'https://evil.example',
    });

    const { status, passed } = await run(wrongIssuer);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('REJECTS a token minted for a different audience', async () => {
    // A correctly signed token for ANOTHER service of the same issuer. Without
    // the audience check, any sibling service's token opens this API.
    const wrongAudience = await sign(issuerKeys.privateKey, claims(), {
      audience: 'some-other-service',
    });

    const { status, passed } = await run(wrongAudience);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('REJECTS an expired token', async () => {
    const expired = await sign(issuerKeys.privateKey, claims(), { expiresIn: '-1m' });

    const { status, passed } = await run(expired);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('REJECTS a token missing a required claim', async () => {
    // NOT "accepts it and notes the claim is absent", which is what the version
    // before 2026-08-15 asserted — it awaited a SUCCESSFUL verification and then
    // checked the claim was undefined.
    //
    // The claim dropped here used to be `tenantId`. ADR-0042 removed it from the
    // required set on purpose — a token carries `sub` and `email` and nothing
    // Ownpace-specific, which is what lets any plain OIDC issuer be enough — so
    // this now drops one that IS still required. The case below covers the other
    // half: a token without a tenant is accepted, and gets one from the
    // database.
    const { email: _dropped, ...withoutEmail } = claims();
    const incomplete = await sign(issuerKeys.privateKey, withoutEmail);

    const { status, passed } = await run(incomplete);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });

  it('ACCEPTS a token with no tenantId, and resolves the tenant from membership', async () => {
    // The shape ADR-0042 is for: a standard OIDC token, carrying nothing this
    // product invented. The subject belongs to exactly one tenant, so there is
    // nothing to ask them.
    __setMembershipsLookupForTests(async () => [{ tenantId: 'tenant-from-db', role: 'viewer' }]);
    try {
      const { tenantId: _dropped, role: _alsoDropped, ...standard } = claims();
      const token = await sign(issuerKeys.privateKey, standard);

      const { status, passed, req } = await run(token);
      expect(status).toBeUndefined();
      expect(passed).toBe(true);
      expect(req.tenantId).toBe('tenant-from-db');
      // And the role still comes from the membership row, as it always has.
      expect(req.userRole).toBe('admin');
    } finally {
      __setMembershipsLookupForTests(null);
    }
  });

  it('REJECTS a request with no Authorization header at all', async () => {
    const { status, passed } = await run(undefined);
    expect(status).toBe(401);
    expect(passed).toBe(false);
  });
});

describe('authenticate — managed path, tenant isolation', () => {
  it('refuses a forged token claiming another tenant, closing the bypass for real', async () => {
    // The case the old file named "proving the bypass is closed" while proving
    // nothing. An attacker forges a token naming a tenant they do not belong to;
    // the signature is the only thing standing in the way, so this fails the
    // moment signature verification is weakened.
    const forged = await sign(attackerKeys.privateKey, claims({ tenantId: 'tenant-victim', role: 'owner' }));

    const { status, passed, req } = await run(forged);

    expect(status).toBe(401);
    expect(passed).toBe(false);
    expect(req.tenantId).toBeUndefined();
  });

  it('applies the membership gate on the managed path too (0020 T1)', async () => {
    // A genuinely signed token is still not an authorization: the subject must
    // belong to the tenant it names.
    __setMembershipLookupForTests(async () => null);

    const { status, passed } = await run(await sign(issuerKeys.privateKey));

    expect(status).toBe(403);
    expect(passed).toBe(false);
  });

  it('takes the role from the membership row, never from the token', async () => {
    // The token says owner; the row says viewer. The row wins, or a self-issued
    // role claim would be an escalation.
    __setMembershipLookupForTests(async () => ({ role: 'viewer' }));

    const { req, passed } = await run(
      await sign(issuerKeys.privateKey, claims({ role: 'owner' })),
    );

    expect(passed).toBe(true);
    expect(req.userRole).toBe('viewer');
  });
});

describe('authenticate — a lingering JWT_SECRET cannot downgrade verification', () => {
  it('still verifies against JWKS when JWT_SECRET is also set', async () => {
    // selectAuthMode prefers managed, and the managed compose ships a known
    // default secret — so a token signed with that secret must NOT be accepted
    // while an issuer is configured. Proven through the middleware rather than
    // through selectAuthMode alone, because it is the wiring that can regress.
    process.env.JWT_SECRET = 'change-this-in-production';

    const jwt = (await import('jsonwebtoken')).default;
    const secretSigned = jwt.sign(
      { ...claims(), iss: ISSUER, aud: AUDIENCE },
      'change-this-in-production',
      { algorithm: 'HS256' },
    );

    const { status, passed } = await run(secretSigned);
    expect(status).toBe(401);
    expect(passed).toBe(false);

    delete process.env.JWT_SECRET;
  });
});
