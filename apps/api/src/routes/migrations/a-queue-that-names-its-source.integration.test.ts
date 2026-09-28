// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE QUEUE THAT NAMES ITS SOURCE (workplan 0150 D9).
 *
 * A Dropbox Paper doc is refused as `policy_refused` (0150 T5), and the
 * Failures page chose a remedy by category alone. The `policy_refused`
 * sentence is Drive's, naming Drive's own setting, so the page now chooses
 * by the migration's source as well, and managed's `GET /failures` has to say
 * which source that is. It reads the source mailbox's connection, as the
 * completion report does: `dropbox` for Dropbox, the value the appliance's
 * `source.type` holds too.
 *
 * Against the database rather than a fake, because what can go wrong is the
 * join: a mapping read through the wrong mailbox, or another tenant's row
 * answering under row security.
 */

process.env.JWT_SECRET = 'test-secret-for-a-queue-that-names-its-source';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Importing the app pulls in the sync/cutover routes, which construct a
// Trigger client at import.
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: vi.fn(async () => ({ id: 'run_mock' })) } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

/** app_user, so the route reads under row security as it does in production. */
const asAppUser = (url: string): string => {
  const parsed = new URL(url);
  parsed.username = 'app_user';
  parsed.password = 'app_password';
  return parsed.toString();
};
process.env.APP_DATABASE_URL = asAppUser(PG_CONNECTION_STRING);

const app = (await import('../../index.ts')).default;
const { seedMembership } = await import('../../__tests__/seed-membership.ts');

// UUID family 0150d900-…00xx, unused elsewhere in the repo.
const P = '0150d900-e29b-41d4-a716-4466554400';
const DROPBOX_TENANT = `${P}01`;
const GOOGLE_TENANT = `${P}02`;
const DROPBOX_MAPPING = `${P}d1`;
const GOOGLE_MAPPING = `${P}d2`;

const token = (tenant: string): string =>
  jwt.sign(
    { sub: `user-${tenant}`, tenantId: tenant, role: 'owner', email: 'owner@source.test' },
    process.env.JWT_SECRET as string,
  );

describe('the failure queue names the migration’s source', () => {
  let owner: Pool;
  let request: ReturnType<typeof supertest>;

  /** A tenant with one migration from a `kind` source to Nextcloud. */
  async function seed(tenant: string, mapping: string, kind: string, suffix: string): Promise<void> {
    await owner.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenant, `Source ${suffix}`],
    );
    await seedMembership(owner, tenant, `user-${tenant}`, 'owner');
    const src = `${P}${suffix}1`;
    const dst = `${P}${suffix}2`;
    const boxSrc = `${P}${suffix}3`;
    const boxDst = `${P}${suffix}4`;
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $3, 'source', $4,          'Source',    '{}', 'connected'),
         ($2, $3, 'target', 'nextcloud', 'Nextcloud', '{}', 'connected')
       ON CONFLICT (id) DO NOTHING`,
      [src, dst, tenant, kind],
    );
    await owner.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind) VALUES
         ($1, $3, $4, 'source box', 'user'),
         ($2, $3, $5, 'target box', 'user')
       ON CONFLICT (id) DO NOTHING`,
      [boxSrc, boxDst, tenant, src, dst],
    );
    await owner.query(
      `INSERT INTO mailbox_mapping
         (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern, name)
       VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s', 'Source')
       ON CONFLICT (id) DO NOTHING`,
      [mapping, tenant, boxSrc, boxDst],
    );
    // A parked Paper doc's row, so the queue has something in it.
    await owner.query(
      `INSERT INTO item
         (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash,
          status, attempt_count, last_error, last_error_category, parked_at)
       VALUES ($1, $2, 'file', '/', 'Notes.paper', 'notes-paper', 'failed', 1,
               '"Notes.paper" is a Dropbox Paper doc.', 'policy_refused', now())`,
      [tenant, mapping],
    );
  }

  const failures = (tenant: string, mapping: string) =>
    request.get(`/api/migrations/${mapping}/failures`).set('Authorization', `Bearer ${token(tenant)}`);

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    request = supertest(app);
    await seed(DROPBOX_TENANT, DROPBOX_MAPPING, 'dropbox', 'a');
    await seed(GOOGLE_TENANT, GOOGLE_MAPPING, 'google', 'b');
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM tenant WHERE id = ANY($1)`, [[DROPBOX_TENANT, GOOGLE_TENANT]]);
    await owner.end();
  });

  it('says dropbox for a Dropbox migration, beside its parked Paper doc', async () => {
    const res = await failures(DROPBOX_TENANT, DROPBOX_MAPPING);
    expect(res.status).toBe(200);
    const queue = res.body[DROPBOX_MAPPING];
    expect(queue.sourceKind).toBe('dropbox');
    expect(queue.needsDecision).toHaveLength(1);
    expect(queue.needsDecision[0]).toMatchObject({ category: 'policy_refused' });
  });

  it('says its own source for any other migration, read from that migration alone', async () => {
    const res = await failures(GOOGLE_TENANT, GOOGLE_MAPPING);
    expect(res.status).toBe(200);
    expect(res.body[GOOGLE_MAPPING].sourceKind).toBe('google');
  });
});
