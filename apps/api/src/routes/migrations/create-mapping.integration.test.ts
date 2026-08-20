// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Integration test for real create-mapping persistence (POST /api/migrations).
 *
 * Proves the mock is gone: the endpoint persists the full connection → mailbox →
 * mapping → scope_selection chain in one RLS-scoped transaction, ENCRYPTS
 * credentials (plaintext never hits the DB, and secret_ref round-trips through
 * SecretStore), stores the mapping name/schedule/domains, and stays tenant-isolated.
 *
 * UUID Family: 5f4b0000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
// 32-byte key (64 hex chars) so SecretStore can encrypt/decrypt.
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT_A = '5f4b0000-e29b-41d4-a716-446655443101';
const TENANT_B = '5f4b0000-e29b-41d4-a716-446655443102';

function token(tenantId: string): string {
  return jwt.sign(
    { sub: `user-${tenantId}`, tenantId, role: 'owner', email: `user@${tenantId}.test` },
    process.env.JWT_SECRET!,
  );
}

const SECRET_PASSWORD = 'super-secret-pw-42';

const body = {
  name: 'Acme mail migration',
  sourceType: 'imap' as const,
  targetType: 'jmap' as const,
  sourceConfig: { host: 'imap.src.test', port: 993, username: 'src@acme.test', password: SECRET_PASSWORD, useSsl: true },
  targetConfig: { host: 'jmap.tgt.test', port: 443, username: 'tgt@acme.test', password: SECRET_PASSWORD, useSsl: true },
  // email + contact: a coherent JMAP pairing. This payload USED to say
  // ['email', 'calendar'] — the exact incoherence 0037 T4 now refuses (there
  // is deliberately no JMAP calendar target, 0031 T1), and it sailed into
  // scope_selection unchallenged. The refusal has its own test below.
  syncConfig: { domains: ['email', 'contact'] as const, schedule: '*/15 * * * *' },
};

describe('POST /api/migrations — real persistence', () => {
  let pool: Pool;
  let request: ReturnType<typeof supertest>;
  let createdMappingId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,'Create A','active','{}'),($2,'Create B','active','{}')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A, TENANT_B],
    );
    // Membership gate (0020 T1): the minted tokens must belong to their tenants.
    await seedMembership(pool, TENANT_A, `user-${TENANT_A}`);
    await seedMembership(pool, TENANT_B, `user-${TENANT_B}`);
    request = supertest(app);
  });

  afterAll(async () => {
    // Cascades clean connections/mailboxes/mappings/scope_selection.
    await pool.query(`DELETE FROM tenant WHERE id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    await pool.end();
  });

  it('creates a mapping and returns its persisted shape', async () => {
    const res = await request
      .post('/api/migrations')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Acme mail migration',
      sourceType: 'imap',
      targetType: 'jmap',
      // 0013 T5: new mappings are created paused (draft) until the owner starts them.
      status: 'paused',
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.syncConfig.domains).toEqual(['email', 'contact']);
    expect(res.body.syncConfig.schedule).toBe('*/15 * * * *');
    createdMappingId = res.body.id;
  });

  it('persists the full chain: 2 connections, 2 mailboxes, mapping, scope rows', async () => {
    const conns = await pool.query(`SELECT role, kind FROM connection WHERE tenant_id = $1`, [TENANT_A]);
    expect(conns.rows).toHaveLength(2);
    // sourceType 'imap' → kind 'imap'; targetType 'jmap' → kind 'jmap'.
    expect(conns.rows.find((r) => r.role === 'source')?.kind).toBe('imap');
    expect(conns.rows.find((r) => r.role === 'target')?.kind).toBe('jmap');

    const mboxes = await pool.query(`SELECT COUNT(*)::int AS n FROM mailbox WHERE tenant_id = $1`, [TENANT_A]);
    expect(mboxes.rows[0].n).toBe(2);

    const mapping = await pool.query(`SELECT name, schedule, status FROM mailbox_mapping WHERE id = $1`, [createdMappingId]);
    expect(mapping.rows[0]).toMatchObject({ name: 'Acme mail migration', schedule: '*/15 * * * *', status: 'paused' });

    const scopes = await pool.query(`SELECT domain FROM scope_selection WHERE mapping_id = $1 ORDER BY domain`, [createdMappingId]);
    expect(scopes.rows.map((r) => r.domain)).toEqual(['contact', 'email']);
  });

  it('encrypts credentials: plaintext never hits secret_ref, and it round-trips', async () => {
    const conns = await pool.query(`SELECT role, secret_ref FROM connection WHERE tenant_id = $1`, [TENANT_A]);
    for (const row of conns.rows) {
      expect(row.secret_ref).toBeTruthy();
      // The plaintext password must not appear anywhere in the stored blob.
      expect(row.secret_ref).not.toContain(SECRET_PASSWORD);
      // And it must decrypt back to the original credentials.
      const creds = SecretStore.decryptCredentials(row.secret_ref);
      expect(creds.password).toBe(SECRET_PASSWORD);
    }
  });

  it('GET returns real, ledger-derived data — not the old hardcoded placeholders', async () => {
    const res = await request
      .get(`/api/migrations/${createdMappingId}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(TENANT_A);
    // Previously always 'imap.example.com'/'jmap.example.com' regardless of the
    // mapping's real config — now the actual stored connection config.
    expect(res.body.sourceConfig).toMatchObject({ host: 'imap.src.test', port: 993, username: 'src@acme.test' });
    expect(res.body.targetConfig).toMatchObject({ host: 'jmap.tgt.test', port: 443, username: 'tgt@acme.test' });
    // Never the real secret, even though the rest of the config is real now.
    expect(res.body.sourceConfig.password).toBe('***');
    expect(res.body.targetConfig.password).toBe('***');
    // Previously always ['email'] regardless of what was actually selected.
    expect(res.body.syncConfig.domains).toEqual(['contact', 'email']);
    expect(res.body.syncConfig.schedule).toBe('*/15 * * * *');
    // Ledger-derived per-domain status — empty because no sync has run yet for this
    // mapping (previously this field didn't exist at all).
    expect(res.body.domainStatus).toEqual([]);
    // Previously always `new Date().toISOString()` regardless of whether anything
    // had ever actually synced.
    expect(res.body.lastSyncAt).toBeUndefined();
  });

  it('is tenant-isolated: tenant B cannot see tenant A mapping', async () => {
    const res = await request
      .get(`/api/migrations/${createdMappingId}`)
      .set('Authorization', `Bearer ${token(TENANT_B)}`);
    expect(res.status).toBe(404);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request
      .post('/api/migrations')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('refuses an incoherent target/domain pairing over the wire, naming both sides (0037 T4)', async () => {
    const res = await request
      .post('/api/migrations')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ ...body, syncConfig: { domains: ['email', 'calendar'], schedule: '*/15 * * * *' } });
    expect(res.status).toBe(400);
    // The refusal sentence sits in `message`, where the wizard's
    // serverMessage() renders it — not only in the zod issue list.
    expect(res.body.message).toContain('no JMAP calendar target');
    expect(res.body.message).toContain('CalDAV');
    // Nothing was stored: refused means refused, not stored-with-a-warning.
    const scopes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM scope_selection WHERE tenant_id = $1 AND domain = 'calendar'`,
      [TENANT_A],
    );
    expect(scopes.rows[0].n).toBe(0);
  });

  it('refuses a garbage cron schedule over the wire, naming the silent fallback it prevents', async () => {
    const res = await request
      .post('/api/migrations')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ ...body, syncConfig: { domains: ['email'], schedule: 'whenever you like' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('five fields');
    expect(res.body.message).toContain('every 15 minutes');
  });

  it('refuses a graph source without its app registration over the wire, naming the fields (0037 T6)', async () => {
    const res = await request
      .post('/api/migrations')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ ...body, sourceType: 'graph', sourceConfig: { username: 'mailbox@acme.test' } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Entra app registration');
    expect(res.body.message).toContain('tenantId, clientId, clientSecret');
  });

  it('a graph create stores the ENGINE-shaped config and the encrypted registration (0037 T6)', async () => {
    const res = await request
      .post('/api/migrations')
      .set('Authorization', `Bearer ${token(TENANT_B)}`)
      .send({
        ...body,
        name: 'Acme O365 migration',
        sourceType: 'graph',
        sourceConfig: {
          username: 'mailbox@acme.test',
          tenantId: 'acme.onmicrosoft.test',
          clientId: 'app-client-id',
          clientSecret: SECRET_PASSWORD,
        },
        syncConfig: { domains: ['email'] },
      });
    expect(res.status).toBe(201);
    expect(res.body.sourceType).toBe('graph');

    const conn = await pool.query(
      `SELECT kind, config, secret_ref FROM connection WHERE tenant_id = $1 AND role = 'source'`,
      [TENANT_B],
    );
    expect(conn.rows).toHaveLength(1);
    expect(conn.rows[0].kind).toBe('o365');
    // The config the WORKER builds from: build-deps-from-mapping.ts branches
    // on `type` and reads tenantId + mailbox — until 2026-08-10 create stored
    // {host, port, useSsl}, which the mail path refused as "got: undefined".
    expect(conn.rows[0].config).toMatchObject({
      type: 'graph-mail',
      tenantId: 'acme.onmicrosoft.test',
      mailbox: 'mailbox@acme.test',
    });
    // The registration is encrypted, never plaintext, and round-trips to the
    // exact keys the worker's factories read.
    expect(conn.rows[0].secret_ref).not.toContain(SECRET_PASSWORD);
    const creds = SecretStore.decryptCredentials(conn.rows[0].secret_ref);
    expect(creds).toMatchObject({
      username: 'mailbox@acme.test',
      tenantId: 'acme.onmicrosoft.test',
      clientId: 'app-client-id',
      clientSecret: SECRET_PASSWORD,
    });
  });

  /**
   * REUSING a stored connection (workplan 0064) through the route that
   * consumes it — the path that was never tested here, and shipped broken
   * because of it (workplan 0071 T6).
   *
   * The route inserted a fresh `mailbox` row per connection with a hardcoded
   * `external_id: 'primary'`, against a table declaring
   * `UNIQUE (connection_id, external_id)`. So the FIRST migration on a stored
   * connection worked and every later one died on a 23505 that the route
   * turned into a 500 — the reuse feature failing at the one thing it exists
   * for. Workplan 0069 made it near-certain to be met, because testing a side
   * now saves a connection and the wizard holds its id from then on. The owner
   * hit it on a phone; it reached them as reference `e133a809`.
   *
   * The feature had a round-trip test over connection KINDS. Nothing walked it
   * through create — which is the same shape as every defect workplan 0068
   * found: the thing worked, and the thing a person would do was untested.
   */
  describe('reusing stored connections', () => {
    const REUSE_TENANT = TENANT_A;
    let sourceConnectionId: string;
    let targetConnectionId: string;

    beforeAll(async () => {
      const conns = await pool.query(
        `SELECT id, role FROM connection WHERE tenant_id = $1 AND display_name LIKE 'Acme mail migration%'`,
        [REUSE_TENANT],
      );
      sourceConnectionId = conns.rows.find((r) => r.role === 'source')!.id;
      targetConnectionId = conns.rows.find((r) => r.role === 'target')!.id;
    });

    /** The wizard's shape when a side reuses a connection: no credentials. */
    const reuseBody = (name: string, targetFolderPrefix?: string) => ({
      ...body,
      name,
      sourceConnectionId,
      targetConnectionId,
      // A reused side collapses its credential inputs, so the username the
      // wizard posts is ''. That must not rename the stored mailbox.
      sourceConfig: { ...body.sourceConfig, username: '', password: '' },
      targetConfig: { ...body.targetConfig, username: '', password: '' },
      ...(targetFolderPrefix ? { targetFolderPrefix } : {}),
    });

    it('creates a SECOND migration on the same connections, under a different target folder', async () => {
      const res = await request
        .post('/api/migrations')
        .set('Authorization', `Bearer ${token(REUSE_TENANT)}`)
        .send(reuseBody('Acme mail migration (archive)', 'Archive'));

      expect(res.status, JSON.stringify(res.body)).toBe(201);

      // ONE mailbox per connection, not one per mapping: the connection is the
      // account, so the second mapping hangs off the same row.
      const mailboxes = await pool.query(
        `SELECT id, primary_address FROM mailbox WHERE connection_id = $1`,
        [sourceConnectionId],
      );
      expect(mailboxes.rows, 'a reused connection must not grow a second mailbox').toHaveLength(1);
      // ...and the empty username the wizard posts did not blank it.
      expect(mailboxes.rows[0].primary_address).toBe('src@acme.test');
    });

    it('REFUSES a second migration that would write to the same place', async () => {
      // Same pair, same (absent) prefix as the original: every item would be
      // copied twice into the same destination. Owner decision 2026-08-18 —
      // something must distinguish them, or it is not allowed.
      const res = await request
        .post('/api/migrations')
        .set('Authorization', `Bearer ${token(REUSE_TENANT)}`)
        .send(reuseBody('Acme mail migration (duplicate)'));

      // A refusal, NOT a 500 — that distinction is the whole fix.
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toBe('duplicate_mapping');
      // Named and linkable, so "no" points at the thing already doing it.
      expect(res.body.existingMappingName).toBe('Acme mail migration');
      expect(res.body.existingMappingId).toBeTruthy();
    });

    /**
     * DELETING a connection asks about MIGRATIONS, not mailbox rows
     * (workplan 0072).
     *
     * The refusal counted rows from `mailbox LEFT JOIN mailbox_mapping`, which
     * is a different question from the one it claims to answer. A mailbox row
     * outlives the migration that created it — the ledger hangs off
     * `item.mapping_id`, never off the mailbox — so a connection whose
     * migrations had all been removed still answered 409, counting a row
     * nothing referenced, and named no migration to go and remove because
     * there was none. An unactionable no in front of a delete that was safe.
     * The owner met it on the older connections, in English, because the
     * name list was empty.
     */
    describe('deleting the connection afterwards', () => {
      const ORPHAN_CONN = '5f4b0000-e29b-41d4-a716-446655443901';

      it('REFUSES while a migration still points at it, and names it', async () => {
        const res = await request
          .delete(`/api/connections/${sourceConnectionId}`)
          .set('Authorization', `Bearer ${token(REUSE_TENANT)}`);

        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error).toBe('in_use');
        expect(res.body.migrations).toContain('Acme mail migration');
        expect(res.body.used).toBeGreaterThan(0);
      });

      it('ALLOWS it when a mailbox row is all that is left', async () => {
        // A connection with a mailbox and no mapping: nothing recorded hangs
        // off it, so there is nothing for the refusal to protect.
        await pool.query(
          `INSERT INTO connection (id, tenant_id, role, kind, display_name)
           VALUES ($1, $2, 'source', 'imap', 'Orphaned source')`,
          [ORPHAN_CONN, REUSE_TENANT],
        );
        await pool.query(
          `INSERT INTO mailbox (tenant_id, connection_id, external_id, kind)
           VALUES ($1, $2, 'primary', 'user')`,
          [REUSE_TENANT, ORPHAN_CONN],
        );

        const res = await request
          .delete(`/api/connections/${ORPHAN_CONN}`)
          .set('Authorization', `Bearer ${token(REUSE_TENANT)}`);

        expect(res.status, JSON.stringify(res.body)).toBe(204);
        const left = await pool.query(`SELECT id FROM connection WHERE id = $1`, [ORPHAN_CONN]);
        expect(left.rows).toHaveLength(0);
      });
    });

    it('leaves nothing behind when it refuses', async () => {
      const mappings = await pool.query(
        `SELECT name FROM mailbox_mapping WHERE tenant_id = $1 ORDER BY name`,
        [REUSE_TENANT],
      );
      // The refused attempt rolled back with the transaction: no half-made
      // mapping, and no orphan connection or mailbox from its own body.
      expect(mappings.rows.map((r) => r.name)).toEqual([
        'Acme mail migration',
        'Acme mail migration (archive)',
      ]);
    });
  });
});
