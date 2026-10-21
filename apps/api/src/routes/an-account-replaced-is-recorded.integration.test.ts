// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCOUNT REPLACED IS RECORDED (workplan 0137 T4).
 *
 * `PUT /api/connections/:id/credentials` keeps the connection's server and
 * replaces the account on it. For a target that is the user name and password
 * every migration on the connection writes into, so a second person with an
 * account on the same server can repoint the migration at their own account,
 * and the probe passes, because the account is real (0137 §4). Until T4 the
 * only record was `connection.qualified`, which a plain Test press writes too,
 * and nothing in it said the account had changed.
 *
 * What this holds, against a real Postgres as `app_user` under row security,
 * through the real route, with the probe and the account qualifier stubbed
 * (nothing here reaches a network):
 *
 * - a replacement that is stored writes one `connection.credentials_replaced`
 *   row with the caller as actor, in the update's own transaction, naming the
 *   connection by id, side and kind, with `accountStored: true`;
 * - one the probe refuses stores nothing and still writes one row, with
 *   `accountStored: false`: somebody tried;
 * - a request refused before any probe, or for another organisation's
 *   connection, writes none;
 * - nor does one whose connection was deleted while the new account was
 *   probed: the update changed nothing, so the answer is 404, not `rotated`;
 * - no address, user name or password goes in the record;
 * - the update and its record are one transaction: a record that cannot be
 *   written leaves the old account in place.
 */

process.env.JWT_SECRET = 'test-secret-for-account-replaced-tests';
// 32-byte key (64 hex chars) so SecretStore can encrypt/decrypt.
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { SecretStore } from '@openmig/core/secret-store';

/** The stubbed probe's answer, and what happens while it is being asked (a delete, say). */
const probe = vi.hoisted(() => ({ ok: true, meanwhile: undefined as undefined | (() => Promise<unknown>) }));

vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const answer = async () => {
    await probe.meanwhile?.();
    return probe.ok
      ? { ok: true, detail: 'stubbed', outcome: { code: 'connectedSession' } }
      : { ok: false, reason: 'stubbed', outcome: { code: 'providerRefused' } };
  };
  return { ...actual, probeTargetConnection: vi.fn(answer), probeSourceConnection: vi.fn(answer) };
});

// The re-qualification after a stored rotation would ask the server what the
// account carries; this file is about the record, not the measurement.
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

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

const app = (await import('../index.ts')).default;
const { seedMembership } = await import('../__tests__/seed-membership.ts');
const { resetProbeTestLimit } = await import('../probe-limit.ts');

// UUID family 7c4a0000-…, unused elsewhere in the repo.
const TENANT = '7c4a0000-e29b-41d4-a716-446655440001';
const OTHER = '7c4a0000-e29b-41d4-a716-446655440002';
const TARGET = '7c4a0000-e29b-41d4-a716-446655440011';
const SOURCE = '7c4a0000-e29b-41d4-a716-446655440012';

const OLD = { username: 'anna@example.invalid', password: 'the-old-password' };
const NEW = { url: 'https://cloud.example.invalid/remote.php/dav', username: 'someone-else@example.invalid', password: 'a-new-password' };

function token(tenantId: string): string {
  return jwt.sign(
    { sub: `user-${tenantId}`, tenantId, role: 'owner', email: `user@${tenantId}.test` },
    process.env.JWT_SECRET!,
  );
}

/** Stored the way the create route stores it: the encrypted object, JSON-encoded, in `secret_ref`. */
const stored = (credentials: Record<string, string>): string =>
  JSON.stringify(SecretStore.encryptCredentials(credentials).encrypted);

describe('PUT /api/connections/:id/credentials records who replaced the account', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;

  const replacementsOf = (id: string) =>
    pool.query<{ tenant_id: string; actor: string; entity: string; detail: Record<string, unknown> }>(
      `SELECT tenant_id, actor, entity, detail FROM audit_log
        WHERE action = 'connection.credentials_replaced' AND detail ->> 'connectionId' = $1
        ORDER BY at`,
      [id],
    );

  const storedAccount = async (): Promise<Record<string, string>> => {
    const row = await pool.query<{ secret_ref: string }>(`SELECT secret_ref FROM connection WHERE id = $1`, [TARGET]);
    return SecretStore.decryptCredentials(row.rows[0]!.secret_ref);
  };

  const replace = (values: Record<string, string>, tenantId = TENANT) =>
    request
      .put(`/api/connections/${TARGET}/credentials`)
      .set('Authorization', `Bearer ${token(tenantId)}`)
      .send({ values });

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Replaced A', 'active', '{}'), ($2, 'Replaced B', 'active', '{}')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT, OTHER],
    );
    await seedMembership(pool, TENANT, `user-${TENANT}`);
    await seedMembership(pool, OTHER, `user-${OTHER}`);
    request = supertest(app);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenant WHERE id IN ($1, $2)`, [TENANT, OTHER]);
    await pool.end();
  });

  beforeEach(async () => {
    probe.ok = true;
    probe.meanwhile = undefined;
    resetProbeTestLimit();
    await pool.query(`DELETE FROM audit_log WHERE tenant_id IN ($1, $2)`, [TENANT, OTHER]);
    await pool.query(`DELETE FROM connection WHERE id IN ($1, $2)`, [TARGET, SOURCE]);
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, secret_ref, status)
       VALUES ($1, $2, 'target', 'nextcloud', 'Anna at the family cloud', $3, $4, 'connected')`,
      [TARGET, TENANT, JSON.stringify({ url: NEW.url, username: OLD.username }), stored(OLD)],
    );
  });

  it('a replacement that is stored writes one row: the caller, the id, side and kind, accountStored true', async () => {
    const res = await replace(NEW);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rotated).toBe(true);
    expect(await storedAccount()).toMatchObject({ username: NEW.username, password: NEW.password });

    const recorded = (await replacementsOf(TARGET)).rows;
    expect(recorded, 'the replacement left no record of who made it').toHaveLength(1);
    expect(recorded[0]).toEqual({
      tenant_id: TENANT,
      actor: `user-${TENANT}`,
      entity: 'connection',
      detail: { connectionId: TARGET, side: 'target', kind: 'nextcloud', accountStored: true },
    });
    // Not the old account, not the new one, not the password, not the server.
    expect(JSON.stringify(recorded[0]!.detail)).not.toMatch(/@|password|example|Anna/);
  });

  it("a source's replacement is recorded as a source: the side is the connection's own", async () => {
    await pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, secret_ref, status)
       VALUES ($1, $2, 'source', 'imap', 'Anna at the old provider', $3, $4, 'connected')`,
      [
        SOURCE,
        TENANT,
        JSON.stringify({ host: 'imap.example.invalid', port: 993, username: OLD.username }),
        stored({ host: 'imap.example.invalid', port: '993', ...OLD }),
      ],
    );
    const res = await request
      .put(`/api/connections/${SOURCE}/credentials`)
      .set('Authorization', `Bearer ${token(TENANT)}`)
      .send({ values: { host: 'imap.example.invalid', port: '993', username: NEW.username, password: NEW.password } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rotated).toBe(true);

    expect((await replacementsOf(SOURCE)).rows.map((r) => r.detail)).toEqual([
      { connectionId: SOURCE, side: 'source', kind: 'imap', accountStored: true },
    ]);
  });

  it('records nothing, and stores nothing, when the connection was deleted while the new account was probed', async () => {
    // The route reads the connection, probes the new account (seconds, over
    // the network), and only then stores it. A delete in between leaves the
    // update nothing to change: answering `rotated: true` and recording
    // `accountStored: true` would say an account was stored that was not.
    probe.meanwhile = () => pool.query(`DELETE FROM connection WHERE id = $1`, [TARGET]);
    const res = await replace(NEW);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect((await replacementsOf(TARGET)).rows, 'a stored account was recorded that was never stored').toEqual([]);
  });

  it('one the probe refuses stores nothing, and still writes one row with accountStored false', async () => {
    probe.ok = false;
    const res = await replace(NEW);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rotated).toBe(false);
    expect(await storedAccount()).toEqual(OLD);

    expect((await replacementsOf(TARGET)).rows.map((r) => [r.actor, r.detail])).toEqual([
      [`user-${TENANT}`, { connectionId: TARGET, side: 'target', kind: 'nextcloud', accountStored: false }],
    ]);
  });

  it('records nothing for a request refused before the probe, or for another organisation', async () => {
    // A required field missing: refused with 400 before anything is probed.
    const missing = await replace({ url: NEW.url, username: NEW.username });
    expect(missing.status, JSON.stringify(missing.body)).toBe(400);
    // Another organisation's connection is not found.
    const elsewhere = await replace(NEW, OTHER);
    expect(elsewhere.status, JSON.stringify(elsewhere.body)).toBe(404);

    expect((await replacementsOf(TARGET)).rows).toEqual([]);
    expect(await storedAccount()).toEqual(OLD);
  });

  it('keeps the old account when the record cannot be written: the update and its record are one transaction', async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION refuse_t4_credentials_replaced() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'the record is refused'; END $$`);
    await pool.query(`CREATE TRIGGER refuse_t4_credentials_replaced BEFORE INSERT ON audit_log
      FOR EACH ROW WHEN (NEW.action = 'connection.credentials_replaced' AND NEW.detail ->> 'connectionId' = '${TARGET}')
      EXECUTE FUNCTION refuse_t4_credentials_replaced()`);
    try {
      const res = await replace(NEW);
      expect(res.status, JSON.stringify(res.body)).toBe(500);
      expect(await storedAccount(), 'the account was replaced with no record of who did it').toEqual(OLD);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS refuse_t4_credentials_replaced ON audit_log');
      await pool.query('DROP FUNCTION IF EXISTS refuse_t4_credentials_replaced()');
    }
  });
});
