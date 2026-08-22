// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// The refusal half of `POST /api/access-requests` (workplan 0093 T2).
//
// Its own file because it needs its own limit: the sibling
// `access-requests.integration.test.ts` raises the cap out of the way so its
// cases are about the WRITE, and a suite cannot be about both at once.
//
// This exists because nothing tested the 429 at all, and that absence is what
// let a production bug through: the limit was 5 an hour keyed on `req.ip`,
// which behind an ingress is the ingress — five access requests per hour for
// the whole service, with the sixth real customer refused and nothing saying
// so. It surfaced only as two confusing failures in the sibling file, which is
// the worst way to learn it.
//
// UUID Family: none — this route needs no tenant, which is its whole point.

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG);

// Set BEFORE the first request, which is when the route reads it. Two, so the
// third knock is the interesting one.
process.env.ACCESS_REQUEST_MAX_PER_HOUR = '2';

import app from '../index.ts';

describe('POST /api/access-requests — when somebody knocks too often', () => {
  let pool: Pool;
  const request = supertest(app);
  const knock = (n: number) =>
    request.post('/api/access-requests').send({ email: `flood-${n}@example.test` });

  beforeAll(() => {
    pool = new Pool({ connectionString: PG });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM access_request WHERE email LIKE 'flood-%'`);
    await pool.end();
  });

  it('refuses past the limit, says how long to wait, and writes nothing', async () => {
    expect((await knock(1)).status).toBe(201);
    expect((await knock(2)).status).toBe(201);

    const refused = await knock(3);
    expect(refused.status).toBe(429);
    // A 429 with no Retry-After tells a caller to guess, and they guess "now".
    const retryAfter = Number(refused.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);

    // The refusal is a refusal: the row is not written anyway.
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM access_request WHERE email LIKE 'flood-%' ORDER BY email`,
    );
    expect(rows.map((r) => r.email)).toEqual(['flood-1@example.test', 'flood-2@example.test']);
  });

  it('says something a person can act on, not just a status code', async () => {
    const refused = await knock(4);
    expect(refused.status).toBe(429);
    expect(typeof refused.body.message).toBe('string');
    expect(refused.body.message.length).toBeGreaterThan(20);
  });
});
