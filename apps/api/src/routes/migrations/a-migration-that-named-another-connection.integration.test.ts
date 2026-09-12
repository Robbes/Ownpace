// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MIGRATION THAT REPORTED SOMEBODY ELSE'S CONNECTION (live 2026-09-11).
 *
 * `GET /migrations/:id` selected the tenant's connections by ROLE and took the
 * first row of each — `sourceRows[0]`, `targetRows[0]`. For a tenant with one
 * source and one target that is the right answer by accident. For a tenant
 * with two targets it is a coin toss, and it came up wrong: the migration page
 * described the account the passes were NOT writing to, while the Connections
 * page attributed the standing failure to the one they were. Two screens
 * disagreed about where a customer's files had gone, and the only way to
 * settle it was a SQL prompt.
 *
 * What the page must report is the connection the MAPPING holds, reached
 * through its own `source_mailbox_id` / `target_mailbox_id`.
 *
 * **Why a database and not a fake.** The defect was in a query, and the fix is
 * a join; a fake would answer whatever it was handed. So the tenant here has
 * two connections per side, and the mapping deliberately points at the one
 * that is NOT first — which is the only arrangement in which the old code and
 * the new code differ at all.
 */

process.env.JWT_SECRET = 'test-secret-for-own-connection-tests';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// The detail route is a read, but importing the app pulls in the sync/cutover
// routes with it, and those construct a Trigger client at import.
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: vi.fn(async () => ({ id: 'run_mock' })) } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** app_user, so the route reads under RLS as it does in production. */
const asAppUser = (url: string): string => {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
};
process.env.APP_DATABASE_URL = asAppUser(PG_CONNECTION_STRING);

const app = (await import('../../index.ts')).default;
const { seedMembership } = await import('../../__tests__/seed-membership.ts');

const P = '7c440000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const SOURCE_FIRST = `${P}a1`;
const SOURCE_OWN = `${P}a2`;
const TARGET_FIRST = `${P}e1`;
const TARGET_OWN = `${P}e2`;
const BOX_SOURCE = `${P}b1`;
const BOX_TARGET = `${P}b2`;
const MAPPING = `${P}d1`;

const token = jwt.sign(
  { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: 'owner@own-connection.test' },
  process.env.JWT_SECRET,
);

describe('a migration reports its own connections', () => {
  let owner: Pool;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    request = supertest(app);

    await owner.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, 'Two Targets', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(owner, TENANT, `user-${TENANT}`, 'owner');

    // INSERTED FIRST ON EACH SIDE, and deliberately not the mapping's. These
    // are the rows the old code returned.
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $5, 'source', 'imap',      'Not this source', '{}', 'connected'),
         ($2, $5, 'source', 'google',    'Google Workspace', '{}', 'connected'),
         ($3, $5, 'target', 'nextcloud', 'Not this target', '{}', 'connected'),
         ($4, $5, 'target', 'soverin',   'Soverin',          '{}', 'connected')
       ON CONFLICT (id) DO NOTHING`,
      [SOURCE_FIRST, SOURCE_OWN, TARGET_FIRST, TARGET_OWN, TENANT],
    );
    await owner.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind) VALUES
         ($1, $3, $4, 'source box', 'user'),
         ($2, $3, $5, 'target box', 'user')
       ON CONFLICT (id) DO NOTHING`,
      [BOX_SOURCE, BOX_TARGET, TENANT, SOURCE_OWN, TARGET_OWN],
    );
    await owner.query(
      `INSERT INTO mailbox_mapping
         (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern, name)
       VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s', 'G to Sov')
       ON CONFLICT (id) DO NOTHING`,
      [MAPPING, TENANT, BOX_SOURCE, BOX_TARGET],
    );
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await owner.end();
  });

  const detail = async () => {
    const res = await request
      .get(`/api/migrations/${MAPPING}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as {
      sourceConnection: { id: string; name: string; kind: string } | null;
      targetConnection: { id: string; name: string; kind: string } | null;
      sourceType: string;
      targetType: string;
    };
  };

  it('names the target the mapping actually holds, not the tenant’s first', async () => {
    const body = await detail();
    expect(body.targetConnection?.id).toBe(TARGET_OWN);
    expect(body.targetConnection?.name).toBe('Soverin');
    expect(body.targetConnection?.kind).toBe('soverin');
  });

  it('names the source the mapping actually holds', async () => {
    const body = await detail();
    expect(body.sourceConnection?.id).toBe(SOURCE_OWN);
    expect(body.sourceConnection?.name).toBe('Google Workspace');
    expect(body.sourceConnection?.kind).toBe('google');
  });

  it('reports the KINDS off the mapping’s own connections too', async () => {
    // Not cosmetic: `sourceType`/`targetType` are what the page reads to
    // decide which credential fields and which domains a migration can carry.
    // Taken from the wrong connection they describe a different product.
    const body = await detail();
    expect(body.sourceType).toBe('google');
    expect(body.targetType).toBe('soverin');
    expect(body.targetType).not.toBe('nextcloud');
  });

  it('says nothing rather than guessing when a side has no mailbox', async () => {
    // `target_mailbox_id` is nullable — a mapping mid-creation has no target
    // yet. The honest answer is `null`, never the tenant's first target
    // connection, which is exactly how the old behaviour looked plausible.
    await owner.query(`UPDATE mailbox_mapping SET target_mailbox_id = NULL WHERE id = $1`, [
      MAPPING,
    ]);
    try {
      const body = await detail();
      expect(body.targetConnection).toBeNull();
      expect(body.targetType).toBe('unknown');
      // The source side is untouched and still named.
      expect(body.sourceConnection?.id).toBe(SOURCE_OWN);
    } finally {
      await owner.query(`UPDATE mailbox_mapping SET target_mailbox_id = $2 WHERE id = $1`, [
        MAPPING,
        BOX_TARGET,
      ]);
    }
  });
});
