// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR THAT ASKED NOBODY, driven for real (ADR-0049, workplan 0101 T7).
 *
 * `PUT /api/migrations/:mappingId` through the real router, against Postgres:
 * the lifecycle moves it may make, the ones it refuses with the door it names,
 * and the record each move leaves. Also the verb finding that came with it:
 * the Finish page sent PATCH to this path for ten days, and nothing here
 * answers PATCH.
 *
 * UUID family: 5f4b0000-e29b-41d4-a716-4466554435xx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG_CONNECTION_STRING);

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT = '5f4b0000-e29b-41d4-a716-446655443501';

function token(): string {
  return jwt.sign(
    { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: `user@${TENANT}.test` },
    process.env.JWT_SECRET!,
  );
}

const createBody = {
  name: 'Lifecycle doors',
  sourceType: 'imap' as const,
  targetType: 'jmap' as const,
  sourceConfig: { host: 'imap.src.test', port: 993, username: 'src@doors.test', password: 'pw-1', useSsl: true },
  targetConfig: { host: 'jmap.tgt.test', port: 443, username: 'tgt@doors.test', password: 'pw-2', useSsl: true },
  syncConfig: { domains: ['email'] as const, schedule: '*/15 * * * *' },
};

describe('PUT /api/migrations/:id asks the lifecycle', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;
  let mappingId: string;
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,'Doors','active','{}') ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(pool, TENANT, `user-${TENANT}`);
    request = supertest(app);

    const created = await request.post('/api/migrations').set(auth()).send(createBody);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('paused');
    mappingId = created.body.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await pool.end();
  });

  const put = (status: string) => request.put(`/api/migrations/${mappingId}`).set(auth()).send({ status });
  const status = async () =>
    (await pool.query(`SELECT status FROM mailbox_mapping WHERE id = $1`, [mappingId])).rows[0].status as string;
  const audit = async () =>
    (
      await pool.query(
        `SELECT detail FROM audit_log WHERE tenant_id = $1 AND action = 'mapping.status' ORDER BY at`,
        [TENANT],
      )
    ).rows.map((r) => r.detail as { from: string; to: string; via: string });

  it("the verb the screen sent for ten days answers nothing here — this path is served by PUT", async () => {
    // The Finish page's lane switch was `client.patch(...)` from 2026-09-10 to
    // 2026-09-20. Pinned where it was found; if a PATCH handler is ever added
    // to this path on purpose, this is the test to edit.
    const res = await request.patch(`/api/migrations/${mappingId}`).set(auth()).send({ status: 'continuous' });
    expect(res.status).toBe(404);
    expect(await status()).toBe('paused');
  });

  it("refuses 'active' — Start is its own door — and writes nothing", async () => {
    const res = await put('active');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'lifecycle_refused', code: 'own_door', from: 'paused', to: 'active' });
    expect(res.body.hint).toContain('/start');
    expect(await status()).toBe('paused');
    expect(await audit()).toEqual([]);
  });

  it("refuses 'done' — Finish is its own door, with the unresolved-failures rule", async () => {
    const res = await put('done');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'own_door', to: 'done' });
    expect(res.body.hint).toContain('/finish');
    expect(await status()).toBe('paused');
  });

  it("refuses 'continuous' before any cutover — the lane is after cutover by definition", async () => {
    const res = await put('continuous');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'before_cutover', from: 'paused' });
    expect(await status()).toBe('paused');
  });

  it("declares the cutover: 'paused' -> 'cutover', recorded through the update door", async () => {
    const res = await put('cutover');
    expect(res.status).toBe(200);
    expect(await status()).toBe('cutover');
    expect(await audit()).toEqual([{ mappingId, from: 'paused', to: 'cutover', via: 'update' }]);
  });

  it('restating the status is a request, not a transition: 200 and no second record', async () => {
    const res = await put('cutover');
    expect(res.status).toBe(200);
    expect(await audit()).toHaveLength(1);
  });

  it("refuses the way back before the cutover — 'active' and 'paused' — only a rollback does that", async () => {
    for (const to of ['active', 'paused']) {
      const res = await put(to);
      expect(res.status, to).toBe(409);
      expect(res.body).toMatchObject({ code: 'after_cutover', from: 'cutover', to });
      expect(res.body.hint).toContain('rollback');
    }
    expect(await status()).toBe('cutover');
    expect(await audit()).toHaveLength(1);
  });

  it("enters the lane from 'cutover', and stops it again: both recorded", async () => {
    expect((await put('continuous')).status).toBe(200);
    expect(await status()).toBe('continuous');
    // The lane cannot go back before the cutover either.
    expect((await put('active')).body).toMatchObject({ code: 'after_cutover', from: 'continuous' });
    expect((await put('cutover')).status).toBe(200);
    expect(await status()).toBe('cutover');
    expect((await audit()).slice(1)).toEqual([
      { mappingId, from: 'cutover', to: 'continuous', via: 'update' },
      { mappingId, from: 'continuous', to: 'cutover', via: 'update' },
    ]);
  });

  it("after a finish through its own door, 'done' is terminal here except for the lane", async () => {
    const finished = await request.post(`/api/migrations/${mappingId}/finish`).set(auth()).send();
    expect(finished.status).toBe(200);
    expect(await status()).toBe('done');
    for (const to of ['active', 'paused', 'cutover']) {
      const res = await put(to);
      expect(res.status, to).toBe(409);
      expect(res.body).toMatchObject({ code: 'finished', from: 'done', to });
    }
    expect(await status()).toBe('done');
    expect((await put('continuous')).status).toBe(200);
    expect(await status()).toBe('continuous');
    expect((await audit()).slice(3)).toEqual([
      { mappingId, from: 'cutover', to: 'done', via: 'finish' },
      { mappingId, from: 'done', to: 'continuous', via: 'update' },
    ]);
  });
});
