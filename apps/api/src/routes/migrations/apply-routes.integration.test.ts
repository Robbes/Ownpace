// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The managed `apply` pair (workplan 0017 T4), against real Postgres.
//
// What is covered: the synchronous ledger-side refusals over HTTP — including
// the one that matters most, the flag DEFAULTING to off — the joined-receipt
// short-circuit (which answers before evaluate or enqueue, so it needs no
// Trigger.dev backend), the receipt mapper over every row shape, and the
// scope/auth guards. The live enqueue follows the discovery and verify suites'
// precedent: it needs a Trigger.dev backend this environment does not run.
//
// UUID Family: 5b4b0000-e29b-41d4-a716-44665544xxxx

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG);

import app from '../../index.js';

const TENANT = '5b4b0000-e29b-41d4-a716-446655440001';
const CONN = '5b4b0000-e29b-41d4-a716-446655440010';
const SRC_MB = '5b4b0000-e29b-41d4-a716-446655440020';
const TGT_MB = '5b4b0000-e29b-41d4-a716-446655440021';
const MAPPING = '5b4b0000-e29b-41d4-a716-446655440030';
const NO_SUCH = '5b4b0000-e29b-41d4-a716-4466554400ff';

// Ledger items, one per case the evaluator must answer over HTTP.
const HASH_CONFIRMED = 'a'.repeat(64); // reported deletion, copied → permitted
const HASH_UNCONFIRMED = 'b'.repeat(64); // no evidence → not_confirmed
const HASH_ADOPTED = 'c'.repeat(64); // adopted bytes → not_ours
const HASH_NONE = 'd'.repeat(64); // no such item

function token(tenantId: string): string {
  return jwt.sign(
    { sub: `user-${tenantId}`, tenantId, role: 'owner', email: `user@${tenantId}.test` },
    process.env.JWT_SECRET!,
  );
}

describe('apply evaluate-then-queue routes (0017 T4)', () => {
  let pool: Pool;
  const request = supertest(app);
  const auth = { Authorization: `Bearer ${token(TENANT)}` };

  async function seedItem(hash: string, extra: string): Promise<void> {
    await pool.query(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, item_type, status, target_id ${extra ? ',' + extra.split('=')[0] : ''})
       VALUES ($1, $2, 'email', 'INBOX', $3, $3, 'mail', 'copied', 't-' || left($3, 8) ${extra ? ',' + extra.split('=')[1] : ''})
       ON CONFLICT DO NOTHING`,
      [TENANT, MAPPING, hash],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,'Apply T','active','{}') ON CONFLICT DO NOTHING`,
      [TENANT],
    );
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES ($1,$2,'source','imap','src','{}','connected') ON CONFLICT DO NOTHING`,
      [CONN, TENANT],
    );
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, status) VALUES ($1,$3,$2,'user','active'),($4,$3,$2,'user','active') ON CONFLICT DO NOTHING`,
      [SRC_MB, CONN, TENANT, TGT_MB],
    );
    // No allow_apply_deletions named: the DEFAULT is under test first.
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status) VALUES ($1,$2,$3,$4,'mirror','active') ON CONFLICT DO NOTHING`,
      [MAPPING, TENANT, SRC_MB, TGT_MB],
    );
    await seedItem(HASH_CONFIRMED, 'deletion_reported_at=now()');
    await seedItem(HASH_UNCONFIRMED, '');
    await pool.query(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, item_type, status, target_id, deletion_reported_at)
       VALUES ($1, $2, 'email', 'INBOX', $3, $3, 'mail', 'adopted', 't-adopted', now())
       ON CONFLICT DO NOTHING`,
      [TENANT, MAPPING, HASH_ADOPTED],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM apply_receipt WHERE tenant_id = $1`, [TENANT]);
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await pool.end();
  });

  it('gate 1 wins first: the flag DEFAULTS off, so even a confirmed item is 403 not_enabled', async () => {
    // The safety property of migration 0004, observed end to end: nobody set
    // the column, so nothing may be removed, evidence or not.
    const res = await request
      .post(`/api/migrations/${MAPPING}/deletions/${HASH_CONFIRMED}/apply`)
      .set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_enabled');
    expect(res.body.reason).toMatch(/switched off/i);
  });

  it('a refused apply left no receipt behind — refusals are answers, not jobs', async () => {
    const res = await request
      .get(`/api/migrations/${MAPPING}/deletions/${HASH_CONFIRMED}/receipt`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'none' });
  });

  describe('with the mapping opted in', () => {
    beforeAll(async () => {
      await pool.query(`UPDATE mailbox_mapping SET allow_apply_deletions = true WHERE id = $1`, [
        MAPPING,
      ]);
    });

    it('404s an unknown item as not_found', async () => {
      const res = await request
        .post(`/api/migrations/${MAPPING}/deletions/${HASH_NONE}/apply`)
        .set(auth);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
    });

    it('404s an unconfirmed deletion as not_confirmed — absence is never evidence', async () => {
      const res = await request
        .post(`/api/migrations/${MAPPING}/deletions/${HASH_UNCONFIRMED}/apply`)
        .set(auth);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_confirmed');
    });

    it('403s adopted bytes as not_ours — they were there before we arrived', async () => {
      const res = await request
        .post(`/api/migrations/${MAPPING}/deletions/${HASH_ADOPTED}/apply`)
        .set(auth);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_ours');
      expect(res.body.reason).toMatch(/before this migration ran/i);
    });

    it('an open receipt is JOINED — 200, queued: false, before any evaluation', async () => {
      // Seeded directly, as the route would have left it after an enqueue.
      await pool.query(
        `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state)
         VALUES ($1, $2, $3, 'queued')`,
        [TENANT, MAPPING, HASH_CONFIRMED],
      );
      const res = await request
        .post(`/api/migrations/${MAPPING}/deletions/${HASH_CONFIRMED}/apply`)
        .set(auth);
      expect(res.status).toBe(200);
      expect(res.body.queued).toBe(false);
      expect(res.body.receipt.state).toBe('queued');
    });

    it('the receipt maps each terminal shape, and the LATEST row wins', async () => {
      // The worker landing the job, simulated the way the worker does it.
      await pool.query(
        `UPDATE apply_receipt SET state='refused', finished_at=now(), code='edited_on_target', reason='their changes now'
         WHERE tenant_id=$1 AND mapping_id=$2 AND natural_key_hash=$3`,
        [TENANT, MAPPING, HASH_CONFIRMED],
      );
      let res = await request
        .get(`/api/migrations/${MAPPING}/deletions/${HASH_CONFIRMED}/receipt`)
        .set(auth);
      expect(res.body).toMatchObject({
        state: 'refused',
        code: 'edited_on_target',
        reason: 'their changes now',
      });

      // A newer applied receipt for the same item outranks it.
      await pool.query(
        `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, state, requested_at, finished_at, kind)
         VALUES ($1, $2, $3, 'applied', now() + interval '1 second', now() + interval '2 seconds', 'binned')`,
        [TENANT, MAPPING, HASH_CONFIRMED],
      );
      res = await request
        .get(`/api/migrations/${MAPPING}/deletions/${HASH_CONFIRMED}/receipt`)
        .set(auth);
      expect(res.body).toMatchObject({ state: 'applied', kind: 'binned' });
      expect(res.body.finishedAt >= res.body.requestedAt).toBe(true);
    });
  });

  it('404s an unknown mapping and 401s a missing token', async () => {
    expect(
      (await request.post(`/api/migrations/${NO_SUCH}/deletions/${HASH_NONE}/apply`).set(auth))
        .status,
    ).toBe(404);
    expect(
      (await request.get(`/api/migrations/${MAPPING}/deletions/${HASH_NONE}/receipt`)).status,
    ).toBe(401);
  });
});
