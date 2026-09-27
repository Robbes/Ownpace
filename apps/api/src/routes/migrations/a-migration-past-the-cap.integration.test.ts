// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// ONE CREATE AT A TIME PER ORGANISATION (workplan 0143 T2a), on a real
// Postgres with two connections: PGlite has one, and cannot show a race.
//
// With a cap of one, the first create is held open, its migration written and
// not yet committed, while a second arrives. The second must wait for the
// organisation's lock, then count the first's migration and be refused.
// Without the lock it would count only what was committed, find room, and both
// would be the last one allowed. The routes themselves are proved in
// `a-migration-past-the-cap.unit.test.ts`.
//
// UUID Family: 0143cb91-7e2f-4d3a-9c4b-5f6a7b8c9dxx

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withTenant, mailboxMapping } from '@openmig/ledger';
import { holdTheCap, PastTheCap } from './migration-cap.ts';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const TENANT = '0143cb91-7e2f-4d3a-9c4b-5f6a7b8c9d01';
const CONN = '0143cb91-7e2f-4d3a-9c4b-5f6a7b8c9d11';
const BOX = '0143cb91-7e2f-4d3a-9c4b-5f6a7b8c9d21';

let pool: Pool;

async function clean(): Promise<void> {
  await pool.query('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: PG, max: 4 });
  await clean();
  await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, 'One create at a time BV')`, [TENANT]);
  await pool.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'imap', 'i', '{}'::jsonb, 'connected')`,
    [CONN, TENANT],
  );
  await pool.query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'someone@example.invalid')`,
    [BOX, TENANT, CONN],
  );
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe('two creates at once, for an organisation that may have one unfinished migration', () => {
  it('makes the second wait for the first, count its migration, and be refused', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let written!: () => void;
    const firstHasWritten = new Promise<void>((resolve) => (written = resolve));

    // What the create route does in its transaction: the cap first, then the
    // migration.
    const createOne = (hold?: Promise<void>) =>
      withTenant(pool, TENANT, async (db) => {
        await holdTheCap(db, TENANT, 1);
        await db.insert(mailboxMapping).values({ tenantId: TENANT, sourceMailboxId: BOX, status: 'paused' });
        if (hold) {
          written();
          // Its migration is written, and not yet committed.
          await hold;
        }
      });

    const first = createOne(held);
    await firstHasWritten;
    let secondAnswered = false;
    const second = createOne().then(
      () => 'created' as const,
      (error: unknown) => error,
    );
    void second.finally(() => {
      secondAnswered = true;
    });

    try {
      // Long enough for a second connection to count, insert and commit, had
      // it not been waiting on the first.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(secondAnswered, 'the second create ran while the first was still open').toBe(false);
    } finally {
      release();
    }
    const [, refused] = await Promise.all([first, second]);

    expect(refused).toBeInstanceOf(PastTheCap);
    expect(refused).toMatchObject({ unfinished: 1, cap: 1 });
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM mailbox_mapping WHERE tenant_id = $1',
      [TENANT],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});
