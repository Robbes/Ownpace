// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// `POST /api/access-requests` — the one route anybody on the internet can reach
// (workplan 0093 T2). Runs against Testcontainers Postgres (pnpm test:integration).
//
// The unit tests either side of this cover the pieces: `knock-limit.unit.test.ts`
// the limiter's arithmetic, `access-request-under-rls.unit.test.ts` the database's
// refusal to let a tenant read what is written here. What only a served request
// can show is that the route WRITES without a tenant at all — the property the
// whole feature rests on, and the one `POST /api/tenants` answers 501 for.
//
// UUID Family: acce0000-e29b-41d4-a716-4466554401xx

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// This file makes a dozen requests from one address, and the limiter's key is
// `req.ip` — one bucket for the whole suite. Raised here rather than worked
// around, because the DEFAULT is the thing the other cases are about and a test
// that quietly shared a production-sized bucket is what found the real bug: at
// the original 5/hour, the suite's sixth request 429'd and two cases failed on
// a limit that would have refused the sixth real customer of the hour too.
process.env.ACCESS_REQUEST_MAX_PER_HOUR = '1000';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

import app from '../index.ts';

interface Row {
  email: string;
  name: string | null;
  organisation: string | null;
  note: string | null;
  tier: string | null;
  locale: string;
  state: string;
  tenant_id: string | null;
}

describe('POST /api/access-requests', () => {
  let pool: Pool;
  const request = supertest(app);

  beforeAll(() => {
    // The OWNER connection, which is the only one that can read this table —
    // and reading it here is how the assertions see what the route wrote.
    pool = new Pool({ connectionString: PG });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM access_request`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM access_request`);
  });

  const rows = async (): Promise<Row[]> =>
    (await pool.query<Row>(`SELECT * FROM access_request ORDER BY created_at`)).rows;

  it('records a request with NO authentication and no tenant', async () => {
    // No Authorization header, deliberately. There is no account yet — that is
    // what the request is for.
    const res = await request
      .post('/api/access-requests')
      .send({ email: 'stranger@example.test', note: 'two mailboxes off Google', locale: 'nl' });

    expect(res.status).toBe(201);
    expect(res.body.received).toBe(true);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      email: 'stranger@example.test',
      note: 'two mailboxes off Google',
      locale: 'nl',
      // Asking grants nothing. Nobody is a customer until the owner says so.
      state: 'open',
      tenant_id: null,
    });
  });

  it('leaves an unfilled field NULL rather than empty', async () => {
    // The columns are nullable so that "left blank" and "typed nothing" stay
    // different things for whoever reads the queue.
    await request.post('/api/access-requests').send({ email: 'terse@example.test' });
    const stored = await rows();
    expect(stored[0]?.name).toBeNull();
    expect(stored[0]?.organisation).toBeNull();
    expect(stored[0]?.note).toBeNull();
    expect(stored[0]?.tier).toBeNull();
    // Defaulted, not null: a reply has to be written in some language.
    expect(stored[0]?.locale).toBe('en');
  });

  it('refuses a request that is not one, without writing anything', async () => {
    for (const body of [
      {},
      { email: 'not-an-address' },
      { email: 'x@y.test', locale: 'de' },
      { email: 'x@y.test', note: 'x'.repeat(2001) },
      { email: `${'x'.repeat(320)}@y.test` },
    ]) {
      const res = await request.post('/api/access-requests').send(body);
      expect(res.status, `should have refused ${JSON.stringify(body).slice(0, 60)}`).toBe(400);
    }
    expect(await rows()).toEqual([]);
  });

  it('answers the same way whether or not the address has asked before', async () => {
    // A public endpoint that distinguishes a known address from a new one is an
    // account-enumeration oracle. It is also honest: from the asker's side both
    // really are "we have it, a human will read it".
    const first = await request.post('/api/access-requests').send({ email: 'twice@example.test' });
    const second = await request.post('/api/access-requests').send({ email: 'twice@example.test' });

    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    // ONE ROW, NOT TWO — and this line changed on 2026-08-31 without the
    // property above changing at all, which is the point of them being separate
    // assertions.
    //
    // It used to expect two, explaining that "a second request from the same
    // address A YEAR LATER is information, not an error". That is 0002's
    // reasoning and it is right — but a year later is not what this test does.
    // It knocks twice in a row with nothing decided in between, which is the
    // case the reasoning never covered: noise in the operator's queue, and two
    // organisations for one person if both are granted. Migration 0020 forbids
    // it, and the test below is the one that exercises what this comment used
    // to claim.
    expect(await rows()).toHaveLength(1);
  });

  it('lets somebody ask again once the first was answered', async () => {
    // 0002's actual intent, exercised for the first time: asking again after a
    // decision IS information and must survive. Only several OPEN at once is
    // noise.
    await request.post('/api/access-requests').send({ email: 'later@example.test' });
    const answered = await pool.query(
      `UPDATE access_request SET state = 'declined', decided_by = 'op', decided_at = now()
        WHERE email = 'later@example.test'`,
    );
    // The fixture asserts its OWN effect, which is the lesson this whole change
    // came from. `access_request` has FORCE ROW LEVEL SECURITY and no UPDATE
    // policy; this works only because the test pool connects as a superuser,
    // which bypasses it. If that ever stops being true the update silently
    // touches nothing, the row stays open, and the knock below is refused by
    // migration 0020 — failing on `toHaveLength` with "expected 2 got 1", which
    // points at the index rather than at the fixture that did nothing.
    expect(answered.rowCount).toBe(1);

    const again = await request.post('/api/access-requests').send({ email: 'later@example.test' });
    expect(again.status).toBe(201);
    expect(await rows()).toHaveLength(2);
  });

  it('never answers with anything about an account', async () => {
    const res = await request.post('/api/access-requests').send({ email: 'quiet@example.test' });
    const body = JSON.stringify(res.body);
    for (const leak of ['token', 'tenantId', 'tenant_id', 'id', 'quiet@example.test']) {
      expect(body, `the answer carries ${leak}`).not.toContain(leak);
    }
  });
});
