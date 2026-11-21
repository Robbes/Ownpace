// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A MARK AND A CREATE, ONE AFTER THE OTHER (workplan 0162 T1, §2 (b)), on a
// real Postgres with two connections: PGlite has one, and cannot show a race.
//
// An organisation becomes a test, or stops being one, only while it holds no
// migration, and a migration made in a test organisation copies its marker.
// Both questions are asked under the organisation's migrations lock, the
// advisory lock the create door takes before it counts (`holdTheCap`), so:
//
//  - a create held open, its migration written and not yet committed, makes a
//    mark that arrives wait for it, and then see that migration and refuse;
//    without the lock the mark would count only what was committed, find
//    nothing, and leave a test organisation holding a migration that copies
//    everything;
//  - a mark held open makes a create that arrives wait for it, and then read
//    the marker it committed and copy it; without the lock the create would
//    read no marker, and the mark would then commit under a migration that
//    has none.
//
// The routes are proved in `routes/a-test-organisation-and-its-marker.unit.test.ts`.
//
// UUID Family: 0162e100-e29b-41d4-a716-4466554400xx

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { withTenant, mailboxMapping } from '@openmig/ledger';
import { markTestOrganisation, migrationsHeldBy, testMarkerOfOrganisation } from '@openmig/managed';
import { holdTheCap, holdTheOrganisationsMigrations } from './routes/migrations/migration-cap.ts';
import { markAsTestAsOperator } from './test-organisation.ts';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const TENANT = '0162e100-e29b-41d4-a716-446655440001';
const CONN = '0162e100-e29b-41d4-a716-446655440011';
const BOX = '0162e100-e29b-41d4-a716-446655440021';
const OPERATOR = 'operator-subject-0162-t1-race';

let pool: Pool;

async function clean(): Promise<void> {
  await pool.query('DELETE FROM test_organisation WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
}

/** A promise, and the function that settles it. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Whether `p` is still waiting after half a second: long enough to have finished, had nothing held it. */
async function stillWaiting(p: Promise<unknown>): Promise<boolean> {
  let answered = false;
  void p.finally(() => {
    answered = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  return !answered;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: PG, max: 4 });
  await clean();
  await pool.query('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, 'One after the other BV')`, [TENANT]);
  await pool.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
    [CONN, TENANT],
  );
  await pool.query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'someone@example.com')`,
    [BOX, TENANT, CONN],
  );
  await pool.query(
    `INSERT INTO platform_operator (user_id, email) VALUES ($1, 'operator@example.com') ON CONFLICT DO NOTHING`,
    [OPERATOR],
  );
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  await pool.query('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  await pool.query('DELETE FROM platform_operator WHERE user_id = $1', [OPERATOR]);
  await pool.end();
});

/** What the create door does in its transaction: the cap's lock, the marker, the migration. */
const createOne = (hold?: { written: () => void; until: Promise<void> }) =>
  withTenant(pool, TENANT, async (db) => {
    await holdTheCap(db, TENANT, 6);
    const testMarker = await testMarkerOfOrganisation(db, TENANT);
    await db
      .insert(mailboxMapping)
      .values({ tenantId: TENANT, sourceMailboxId: BOX, status: 'paused', testMarker: testMarker ?? null });
    if (hold) {
      hold.written();
      await hold.until;
    }
  });

describe('a create held open, and a mark that arrives', () => {
  it('waits for the create, sees its migration, and marks nothing', async () => {
    const written = gate();
    const release = gate();
    const create = createOne({ written: written.open, until: release.opened });
    await written.opened;

    const mark = markAsTestAsOperator(pool, { tenantId: TENANT, by: OPERATOR, marker: '[Ownpace-test]' });
    try {
      expect(await stillWaiting(mark), 'the mark was decided while the create was still open').toBe(true);
    } finally {
      release.open();
    }
    await create;
    expect(await mark).toEqual({ held: 1 });

    expect((await pool.query('SELECT 1 FROM test_organisation WHERE tenant_id = $1', [TENANT])).rows).toEqual([]);
    expect(
      (await pool.query(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action LIKE 'tenant.test_marker_%'`, [TENANT])).rows,
    ).toEqual([]);
  });
});

describe('a mark held open, and a create that arrives', () => {
  it('waits for the mark, and copies the marker it committed', async () => {
    const written = gate();
    const release = gate();
    // What the mark does in its transaction: the lock, the count, the row.
    const mark = withTenant(pool, TENANT, async (db) => {
      await holdTheOrganisationsMigrations(db, TENANT);
      expect(await migrationsHeldBy(db, TENANT)).toBe(0);
      await markTestOrganisation(db, TENANT, '[Ownpace-test]', OPERATOR);
      written.open();
      await release.opened;
    });
    await written.opened;

    const create = createOne();
    try {
      expect(await stillWaiting(create), 'the create read the marker while the mark was still open').toBe(true);
    } finally {
      release.open();
    }
    await Promise.all([mark, create]);

    expect((await pool.query('SELECT test_marker FROM mailbox_mapping WHERE tenant_id = $1', [TENANT])).rows).toEqual([
      { test_marker: '[Ownpace-test]' },
    ]);
  });
});
