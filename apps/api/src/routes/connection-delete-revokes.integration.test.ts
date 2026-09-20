// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The delete button revokes the grant (2026-09-20).
 *
 * `DELETE /api/connections/:id` deleted our copy of a credential and stopped,
 * while the privacy text promised, for exactly that press, that the credential
 * is "destroyed, and the grant revoked where the provider supports it". The
 * erasure path (0085 T4a) and the appliance's forget-me revoked; the everyday
 * delete never called the helper. So a customer who deleted a Google
 * connection left a live refresh token at Google that nobody held.
 *
 * Runs against a real Postgres (Testcontainers in CI, the local cluster by
 * hand) because the route's whole shape is a tenant-scoped read-and-delete
 * followed by a network call OUTSIDE that transaction — and Google's endpoint
 * is the one thing stubbed, at the global `fetch` the revoker reads at call
 * time. Nothing here reaches a network.
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
// 32-byte key (64 hex chars) so SecretStore can encrypt/decrypt.
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { SecretStore } from '@openmig/core/secret-store';

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

import app from '../index.ts';
import { seedMembership } from '../__tests__/seed-membership.ts';

// UUID family 5a9c0000-…, unused elsewhere in the repo.
const TENANT = '5a9c0000-e29b-41d4-a716-446655445001';
const OTHER = '5a9c0000-e29b-41d4-a716-446655445002';
const GOOGLE_CONN = '5a9c0000-e29b-41d4-a716-446655445011';
const GOOGLE_DOWN = '5a9c0000-e29b-41d4-a716-446655445012';
const IMAP_CONN = '5a9c0000-e29b-41d4-a716-446655445013';
const USED_CONN = '5a9c0000-e29b-41d4-a716-446655445014';
const USED_TARGET = '5a9c0000-e29b-41d4-a716-446655445015';
const SRC_MB = '5a9c0000-e29b-41d4-a716-446655445021';
const TGT_MB = '5a9c0000-e29b-41d4-a716-446655445022';
const MAPPING = '5a9c0000-e29b-41d4-a716-446655445031';

function token(tenantId: string): string {
  return jwt.sign(
    { sub: `user-${tenantId}`, tenantId, role: 'owner', email: `user@${tenantId}.test` },
    process.env.JWT_SECRET!,
  );
}

/** Stored the way the create route stores it: the encrypted object, JSON-encoded, in `secret_ref`. */
const stored = (credentials: Record<string, string>): string =>
  JSON.stringify(SecretStore.encryptCredentials(credentials).encrypted);

const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';

/** Every call the route made to Google, and the answer Google gives. */
const revokeCalls: Array<{ url: string; body: string }> = [];
let googleAnswers: () => Response = () => new Response('', { status: 200 });

// The revoker reads the global `fetch` at call time (its default transport is
// a closure over it), so this is the seam. Anything that is not the revocation
// endpoint is a bug in this test's premise and says so.
vi.stubGlobal('fetch', async (url: string | URL, init?: { body?: unknown }) => {
  const at = String(url);
  if (!at.startsWith(GOOGLE_REVOKE)) throw new Error(`unexpected fetch to ${at}`);
  revokeCalls.push({ url: at, body: String(init?.body ?? '') });
  return googleAnswers();
});

describe('DELETE /api/connections/:id revokes the grant it lets go of', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings)
       VALUES ($1, 'Revoke A', 'active', '{}'), ($2, 'Revoke B', 'active', '{}')
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
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    revokeCalls.length = 0;
    googleAnswers = () => new Response('', { status: 200 });
  });

  const insertConnection = (id: string, kind: string, credentials: Record<string, string>) =>
    pool.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, secret_ref)
       VALUES ($1, $2, 'source', $3, $4, $5)`,
      [id, TENANT, kind, `${kind} ${id.slice(-2)}`, stored(credentials)],
    );

  const rowsLeft = async (id: string): Promise<number> =>
    (await pool.query(`SELECT id FROM connection WHERE id = $1`, [id])).rows.length;

  it('revokes a Google refresh token at Google, then answers 200 with the outcome', async () => {
    await insertConnection(GOOGLE_CONN, 'gmail', { refreshToken: 'rt-gmail-one' });

    const res = await request
      .delete(`/api/connections/${GOOGLE_CONN}`)
      .set('Authorization', `Bearer ${token(TENANT)}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      deleted: true,
      id: GOOGLE_CONN,
      revocation: { kind: 'gmail', status: 'revoked' },
    });
    // The REFRESH token went to the revocation endpoint — revoking an access
    // token alone would leave the thing that mints more of them untouched.
    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0]!.body).toBe('token=rt-gmail-one');
    expect(await rowsLeft(GOOGLE_CONN)).toBe(0);
  });

  it('still deletes when Google will not answer, and says failed with the reason', async () => {
    // Best effort, never a refusal: a provider being down must not keep a
    // credential on our side — and the outcome must not read as revoked, or
    // the one thing that works (withdrawing it themselves) never happens.
    await insertConnection(GOOGLE_DOWN, 'google', { refreshToken: 'rt-google-down' });
    googleAnswers = () => new Response('upstream unhappy', { status: 503 });

    const res = await request
      .delete(`/api/connections/${GOOGLE_DOWN}`)
      .set('Authorization', `Bearer ${token(TENANT)}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.revocation.kind).toBe('google');
    expect(res.body.revocation.status).toBe('failed');
    expect(res.body.revocation.reason).toBeTruthy();
    expect(revokeCalls).toHaveLength(1);
    expect(await rowsLeft(GOOGLE_DOWN)).toBe(0);
  });

  it('calls nobody for a password kind, and says why it is unsupported', async () => {
    await insertConnection(IMAP_CONN, 'imap', { password: 'app-password-42' });

    const res = await request
      .delete(`/api/connections/${IMAP_CONN}`)
      .set('Authorization', `Bearer ${token(TENANT)}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.revocation).toMatchObject({ kind: 'imap', status: 'unsupported' });
    expect(res.body.revocation.reason).toMatch(/password/i);
    expect(revokeCalls).toHaveLength(0);
    expect(await rowsLeft(IMAP_CONN)).toBe(0);
  });

  it('revokes NOTHING on a refused delete — the connection stays and must keep working', async () => {
    // In use by a mapping: the 409 protects the ledger, and a revoked grant
    // behind a connection that stays would break the next pass for a delete
    // that never happened.
    await insertConnection(USED_CONN, 'google', { refreshToken: 'rt-still-in-use' });
    await insertConnection(USED_TARGET, 'nextcloud', { password: 'target-pw' });
    await pool.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind)
       VALUES ($1, $2, $3, 'primary', 'user'), ($4, $2, $5, 'primary', 'user')`,
      [SRC_MB, TENANT, USED_CONN, TGT_MB, USED_TARGET],
    );
    await pool.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, name)
       VALUES ($1, $2, $3, $4, 'mirror', 'paused', 'Acme mail')`,
      [MAPPING, TENANT, SRC_MB, TGT_MB],
    );

    const res = await request
      .delete(`/api/connections/${USED_CONN}`)
      .set('Authorization', `Bearer ${token(TENANT)}`);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('in_use');
    expect(revokeCalls).toHaveLength(0);
    // And the credential is exactly as it was: decryptable, and the same token.
    const kept = await pool.query<{ secret_ref: string }>(`SELECT secret_ref FROM connection WHERE id = $1`, [USED_CONN]);
    expect(SecretStore.decryptCredentials(kept.rows[0]!.secret_ref)).toEqual({ refreshToken: 'rt-still-in-use' });
  });

  it("does not reach another tenant's connection, let alone revoke it", async () => {
    // USED_CONN belongs to TENANT; OTHER asks for it by id.
    const res = await request
      .delete(`/api/connections/${USED_CONN}`)
      .set('Authorization', `Bearer ${token(OTHER)}`);

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(revokeCalls).toHaveLength(0);
    expect(await rowsLeft(USED_CONN)).toBe(1);
  });
});
