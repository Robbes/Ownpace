// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE QUESTION THAT NEEDED NO ORGANISATION (the owner, 2026-10-07).
 *
 * The owner, signed in as an operator, watched a 403 in the browser console on
 * every page: `GET /api/problem-reports/available` answering *"No active
 * membership for this tenant"*. The layout asks this on every signed-in page
 * (Layout.tsx, workplan 0130), and the answer it wants — does this service
 * take reports at all? — is a fact about the SERVICE, not about any
 * organisation. `authenticate` disagreed: it resolves a tenant before serving
 * anything, and an operator belongs to no organisation on purpose, so the
 * resolution refused 403 before the answer was read.
 *
 * The fix is the middleware the support routes already use for the same
 * situation (`support.ts`: *"an operator acts across tenants"*):
 * `authenticateSubject`, which verifies the token and stops. This file pins
 * that:
 *
 *  - a signed-in subject with ZERO memberships gets the answer, not a refusal;
 *  - a subject with one organisation gets the same answer, so the fix does not
 *    loosen anything for a customer;
 *  - the sibling routes, whose answers DO carry tenant facts, keep the tenant
 *    gate: `/preview` still refuses the zero-membership subject.
 *
 * The real middleware runs — no stubbing of `authenticate*`. Dev mode (no
 * issuer, no secret) decodes the token without verifying it, which is exactly
 * the seam `auth.unit.test.ts` uses; the membership lookup is swapped through
 * its test seam, the only piece of the database this question does not need.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { __setMembershipsLookupForTests } from '../middleware/auth.ts';
import { problemReportRoutes } from './problem-reports.ts';

const MAIL = {
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_PORT: '587',
  SMTP_USER: 'relay-user@example.invalid',
  SMTP_PASSWORD: 'test-password-not-real',
  NOTIFY_FROM: 'ownpace@example.invalid',
  NOTIFY_TO: 'operator@example.invalid',
  REPORT_MAIL_TO: 'support@example.invalid',
};

const OPERATOR = 'operator-subject-no-tenant';
const CUSTOMER = 'customer-subject-one-tenant';
const TENANT = '5f5c0000-e29b-41d4-a716-446655442255';

/** An unsigned token: dev mode decodes without verifying (see file header). */
function token(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub,
    email: `${sub}@example.invalid`,
    exp: Math.floor(Date.now() / 1000) + 300,
  })}.`;
}

function app() {
  const a = express();
  a.use('/api/problem-reports', problemReportRoutes({ env: MAIL }));
  return a;
}

beforeEach(() => {
  vi.stubEnv('JWT_ISSUER', '');
  vi.stubEnv('JWT_SECRET', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  __setMembershipsLookupForTests(null);
});

describe('the report form offered to a subject with no organisation', () => {
  it('answers an operator with zero memberships, where authenticate refused 403', async () => {
    __setMembershipsLookupForTests(async () => []);
    const res = await request(app())
      .get('/api/problem-reports/available')
      .set('Authorization', `Bearer ${token(OPERATOR)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it('answers a customer with one organisation the same, so nothing loosened', async () => {
    __setMembershipsLookupForTests(async () => [{ tenantId: TENANT, role: 'owner' }]);
    const res = await request(app())
      .get('/api/problem-reports/available')
      .set('Authorization', `Bearer ${token(CUSTOMER)}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it('still refuses nobody: no token is 401, not a free answer', async () => {
    const res = await request(app()).get('/api/problem-reports/available');
    expect(res.status).toBe(401);
  });

  it('leaves the tenant gate on the sibling route: /preview carries tenant facts', async () => {
    __setMembershipsLookupForTests(async () => []);
    const res = await request(app())
      .get('/api/problem-reports/preview')
      .set('Authorization', `Bearer ${token(OPERATOR)}`);
    expect(res.status).toBe(403);
  });
});
