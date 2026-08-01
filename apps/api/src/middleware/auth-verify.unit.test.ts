// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Tests for the auth middleware's verification wiring (review findings):
 *  - selectAuthMode: managed JWKS wins over a symmetric JWT_SECRET.
 *  - authenticate: self-host HS256 accept / reject / expired-message path.
 *  - the tenant-membership gate (0020 T1): a verified signature is not an
 *    authorization; membership is confirmed and the role comes from the row.
 *  - assertProductionAuthConfig (0020 T2): placeholder secrets refuse to boot.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import {
  authenticate,
  optionalAuth,
  selectAuthMode,
  assertProductionAuthConfig,
  __setMembershipLookupForTests,
} from './auth';

const SECRET = 'unit-test-secret';

function claims(overrides: Record<string, unknown> = {}) {
  return { sub: 'user-1', tenantId: 'tenant-1', role: 'admin', email: 'u@example.com', ...overrides };
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

describe('selectAuthMode (precedence)', () => {
  it('prefers the managed JWKS path when JWT_ISSUER is set, even if JWT_SECRET is also set', () => {
    expect(selectAuthMode('https://issuer.example/', SECRET)).toBe('managed');
    expect(selectAuthMode('https://issuer.example/', undefined)).toBe('managed');
  });
  it('uses the local secret only when no issuer is configured', () => {
    expect(selectAuthMode(undefined, SECRET)).toBe('local');
  });
  it('falls back to dev when neither is configured', () => {
    expect(selectAuthMode(undefined, undefined)).toBe('dev');
  });
});

describe('authenticate (self-host HS256)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    delete process.env.JWT_ISSUER;
    // These tests exercise VERIFICATION; the membership gate gets a fake that
    // admits the token's subject with its claimed role (gate tests below use
    // fakes that disagree with the claims).
    __setMembershipLookupForTests(async () => ({ role: 'admin' }));
  });
  afterEach(() => {
    delete process.env.JWT_SECRET;
    __setMembershipLookupForTests(null);
    vi.restoreAllMocks();
  });

  it('accepts a valid token and attaches the tenant context', async () => {
    const token = jwt.sign(claims(), SECRET, { algorithm: 'HS256' });
    const req = reqWith(token);
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect((req as unknown as { tenantId?: string }).tenantId).toBe('tenant-1');
    expect((req as unknown as { userRole?: string }).userRole).toBe('admin');
  });

  it('rejects an expired token with a distinct "Token expired" message', async () => {
    const token = jwt.sign(claims(), SECRET, { algorithm: 'HS256', expiresIn: '-1s' });
    const res = mockRes();
    const next = vi.fn();

    await authenticate(reqWith(token), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect((res as { body?: { message?: string } }).body?.message).toBe('Token expired');
  });

  it('rejects a tampered token as Invalid token', async () => {
    const token = jwt.sign(claims(), SECRET, { algorithm: 'HS256' });
    const tampered = `${token.split('.').slice(0, 2).join('.')}.deadbeef`;
    const res = mockRes();
    const next = vi.fn();

    await authenticate(reqWith(tampered), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect((res as { body?: { message?: string } }).body?.message).toBe('Invalid token');
  });

  it('rejects a missing Authorization header', async () => {
    const res = mockRes();
    const next = vi.fn();

    await authenticate(reqWith(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('tenant-membership gate (0020 T1)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    delete process.env.JWT_ISSUER;
  });
  afterEach(() => {
    delete process.env.JWT_SECRET;
    __setMembershipLookupForTests(null);
    vi.restoreAllMocks();
  });

  it('403s a validly-SIGNED token whose subject is no member of the claimed tenant', async () => {
    // The attack the gate closes: the signature is genuine (attacker holds the
    // secret, or the IdP assigned the claim unchecked) but the membership does
    // not exist. Verification passes; authorization must not.
    __setMembershipLookupForTests(async () => null);
    const token = jwt.sign(claims({ tenantId: 'victim-tenant', role: 'owner' }), SECRET, {
      algorithm: 'HS256',
    });
    const req = reqWith(token);
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect((res as { body?: { message?: string } }).body?.message).toMatch(/membership/i);
    expect((req as unknown as { tenantId?: string }).tenantId).toBeUndefined();
  });

  it('takes the role from the tenant_member ROW, never from the token', async () => {
    // Token claims owner; the row says viewer. The row wins — a client cannot
    // self-assign a role by writing it into its own claims.
    __setMembershipLookupForTests(async () => ({ role: 'viewer' }));
    const token = jwt.sign(claims({ role: 'owner' }), SECRET, { algorithm: 'HS256' });
    const req = reqWith(token);
    const res = mockRes();
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as { userRole?: string }).userRole).toBe('viewer');
  });

  it('passes the CLAIMED tenant and subject to the lookup (RLS scopes the query)', async () => {
    const seen: Array<[string, string]> = [];
    __setMembershipLookupForTests(async (tenantId, userId) => {
      seen.push([tenantId, userId]);
      return { role: 'member' };
    });
    const token = jwt.sign(claims(), SECRET, { algorithm: 'HS256' });

    await authenticate(reqWith(token), mockRes(), vi.fn());

    expect(seen).toEqual([['tenant-1', 'user-1']]);
  });

  it('a lookup failure is a 500, never a pass — the gate fails closed', async () => {
    __setMembershipLookupForTests(async () => {
      throw new Error('database unreachable');
    });
    const token = jwt.sign(claims(), SECRET, { algorithm: 'HS256' });
    const res = mockRes();
    const next = vi.fn();

    await authenticate(reqWith(token), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('optionalAuth attaches NO context without membership — optional means absent, not weaker', async () => {
    __setMembershipLookupForTests(async () => null);
    const token = jwt.sign(claims(), SECRET, { algorithm: 'HS256' });
    const req = reqWith(token);
    const next = vi.fn();

    await optionalAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as unknown as { userId?: string }).userId).toBeUndefined();
    expect((req as unknown as { tenantId?: string }).tenantId).toBeUndefined();
  });
});

describe('assertProductionAuthConfig (0020 T2)', () => {
  it('refuses to boot in production with a known-placeholder JWT_SECRET', () => {
    expect(() =>
      assertProductionAuthConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'change-this-in-production',
      } as NodeJS.ProcessEnv)
    ).toThrow(/placeholder/i);
    expect(() =>
      assertProductionAuthConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'your-super-secret-jwt-key-change-in-production',
      } as NodeJS.ProcessEnv)
    ).toThrow(/placeholder/i);
  });

  it('accepts a real secret in production', () => {
    expect(() =>
      assertProductionAuthConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'a-genuinely-random-value-nobody-committed',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('does not police non-production (dev stacks may run the example env)', () => {
    expect(() =>
      assertProductionAuthConfig({
        NODE_ENV: 'development',
        JWT_SECRET: 'change-this-in-production',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('ignores JWT_SECRET when JWKS mode is configured (the secret is not in use)', () => {
    expect(() =>
      assertProductionAuthConfig({
        NODE_ENV: 'production',
        JWT_ISSUER: 'https://issuer.example/',
        JWT_SECRET: 'change-this-in-production',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});
