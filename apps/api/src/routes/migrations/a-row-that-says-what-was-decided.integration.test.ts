// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROW THAT SAYS WHAT WAS DECIDED (workplan 0159 §6 item 6), over managed's
 * `GET /deletions` and `GET /moves`.
 *
 * The ledger closes a queue entry the same way for a keep and for an apply,
 * so a tester who pressed *Delete it here too* found the row under *Already
 * decided* with no word on which it was. Each decided row now carries
 * `decided`, from what the ledger recorded: `kept`, `applied`, or, on
 * Deletions, `relocated` for the old copy of a renamed item, which is not
 * deleted from the new system at all. The queue rows are the ledger's own
 * (ADR-0026), so this holds the route to carrying them as they are, read
 * under row security as production reads them.
 *
 * The rows are written by the ledger's real decisions, not by hand, so the
 * times `relocated` is read from are the ones `applyRelocation` writes.
 */

process.env.JWT_SECRET = 'test-secret-for-a-row-that-says-what-was-decided';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { createPgDb, PgLedger } from '@openmig/ledger';
import { asMappingId, asTenantId, type LedgerRecord } from '@openmig/shared';

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

// UUID family 0159d6e1-…, unused elsewhere in the repo.
const P = '0159d6e1-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const MAPPING = `${P}02`;

const token = (tenant: string): string =>
  jwt.sign(
    { sub: `user-${tenant}`, tenantId: tenant, role: 'owner', email: 'owner@decided.test' },
    process.env.JWT_SECRET as string,
  );

function copied(naturalKeyHash: string, contentHash: string): LedgerRecord {
  return {
    tenantId: asTenantId(TENANT),
    mappingId: asMappingId(MAPPING),
    itemType: 'file',
    naturalKeyHash,
    contentHash,
    targetId: `t-${naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
  };
}

describe('managed queues say what a decided row decided', () => {
  let owner: Pool;
  let db: ReturnType<typeof createPgDb>;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    owner = new Pool({ connectionString: PG_CONNECTION_STRING });
    db = createPgDb(PG_CONNECTION_STRING);
    request = supertest(app);

    await owner.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, 'Decided rows', 'active') ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(owner, TENANT, `user-${TENANT}`, 'owner');
    await owner.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status) VALUES
         ($1, $3, 'source', 'google',    'Source',    '{}', 'connected'),
         ($2, $3, 'target', 'nextcloud', 'Nextcloud', '{}', 'connected')
       ON CONFLICT (id) DO NOTHING`,
      [`${P}11`, `${P}12`, TENANT],
    );
    await owner.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, display_name, kind) VALUES
         ($1, $3, $4, 'source box', 'user'),
         ($2, $3, $5, 'target box', 'user')
       ON CONFLICT (id) DO NOTHING`,
      [`${P}21`, `${P}22`, TENANT, `${P}11`, `${P}12`],
    );
    await owner.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode)
       VALUES ($1, $2, $3, $4, 'active', 'mirror')
       ON CONFLICT (id) DO NOTHING`,
      [MAPPING, TENANT, `${P}21`, `${P}22`],
    );

    // Each decision made the way the product makes it.
    const ledger = new PgLedger(db);
    const tenant = asTenantId(TENANT);
    const mapping = asMappingId(MAPPING);
    for (const key of ['kept', 'deleted', 'moved']) {
      await ledger.recordIfAbsent(copied(key, `bytes-${key}`));
      await ledger.recordReportedDeletion(tenant, mapping, 'file', key);
    }
    // `moved` was renamed as well: the same bytes are on the new system under
    // `moved-new`, so it is in both queues.
    await ledger.recordIfAbsent(copied('moved-new', 'bytes-moved'));
    await ledger.recordMove(tenant, mapping, 'file', 'moved', 'Docs', 'moved-new');
    await ledger.recordIfAbsent(copied('left', 'bytes-left'));
    await ledger.recordMove(tenant, mapping, 'file', 'left', 'Archive');

    expect(await ledger.resolveDeletion(tenant, mapping, 'kept', 'keep')).toBe(true);
    expect(await ledger.applyDeletion(tenant, mapping, 'file', 'deleted')).toBe(true);
    expect(await ledger.applyRelocation(tenant, mapping, 'file', 'moved')).toBe(true);
    expect(await ledger.resolveMove(tenant, mapping, 'left', 'keep')).toBe(true);
  });

  afterAll(async () => {
    await owner.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await db.close();
    await owner.end();
  });

  const decidedOn = async (queue: 'deletions' | 'moves') => {
    const res = await request
      .get(`/api/migrations/${MAPPING}/${queue}`)
      .set('Authorization', `Bearer ${token(TENANT)}`);
    expect(res.status).toBe(200);
    const rows = res.body[MAPPING].acknowledged as { naturalKeyHash: string; decided?: string }[];
    return Object.fromEntries(rows.map((r) => [r.naturalKeyHash, r.decided]));
  };

  it('Deletions says kept, applied, or relocated for a renamed item', async () => {
    expect(await decidedOn('deletions')).toEqual({
      kept: 'kept',
      deleted: 'applied',
      moved: 'relocated',
    });
  });

  it('Moves says kept, or applied when the old copy was removed', async () => {
    expect(await decidedOn('moves')).toEqual({ left: 'kept', moved: 'applied' });
  });
});
