// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A MARK AND A CREATE, ONE AFTER THE OTHER (workplan 0162 T1, §2 (b)), on a
// real Postgres with two connections: PGlite has one, and cannot show a race.
// Through the real routes: `POST /api/support/tenants/{tenantId}/test` and
// `POST /api/migrations`, with only the sign-in stood in for.
//
// An organisation becomes a test, or stops being one, only while it holds no
// migration, and a migration made in a test organisation copies its marker.
// Both questions are asked under the organisation's migrations lock, the
// advisory lock the create takes before it counts (`holdTheCap`), so:
//
//  - a create held open, its migration written and not yet committed, makes a
//    mark that arrives wait for it, and then see that migration and refuse;
//    without the lock the mark would count only what was committed, find
//    nothing, and leave a test organisation holding a migration that copies
//    everything;
//  - a mark held open makes a create that arrives wait for it, and then read
//    the marker it committed and copy it; without the lock, or with the marker
//    read before the lock is taken, the create would read no marker, and the
//    mark would then commit under a migration that has none.
//
// Each side names the organisation in the other case from the other: the lock
// is keyed on the id as the database spells it, so `ABC…` and `abc…` take one
// lock (0162 T1's review). The side held open is a transaction of its own, the
// lock and the row as the door takes and writes them; the side that arrives is
// the real route.
//
// A CLOSE AND A MARK, ONE AFTER THE OTHER TOO (0162 T1's re-review). Both doors
// refuse an organisation that is not open, and they used to read its status
// before their own transaction: a close that committed in between let a mark
// land on a closed organisation. They now read it in that transaction, held
// until it commits (`statusHeldUntilCommit`, `FOR SHARE`), so:
//
//  - a close held open, its UPDATE written and not yet committed, makes a mark
//    or a clear that arrives wait for it, and then read `closed` and refuse;
//    read without the lock, the status is the one committed before the close,
//    `active`, and the mark commits under it;
//  - a mark held open, its status read and its row written, makes a close that
//    arrives wait for it; without the lock the close commits first, and the
//    mark then commits on a closed organisation.
//
// The routes are proved in `routes/a-test-organisation-and-its-marker.unit.test.ts`.
//
// UUID Family: 0162e100-e29b-41d4-a716-4466554400xx

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { withTenant, mailboxMapping } from '@openmig/ledger';
import { closeTenant, markTestOrganisation, migrationsHeldBy, tenantRef } from '@openmig/managed';
import { holdTheOrganisationsMigrations } from './routes/migrations/migration-cap.ts';
import { statusHeldUntilCommit } from './test-organisation.ts';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const TENANT = '0162e100-e29b-41d4-a716-446655440001';
const CONN = '0162e100-e29b-41d4-a716-446655440011';
const BOX = '0162e100-e29b-41d4-a716-446655440021';
const OPERATOR = 'operator-subject-0162-t1-race';

let pool: Pool;
/** The organisation the create's sign-in resolves, as a request could spell it. */
let organisation = TENANT;

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { userId: OPERATOR });
      next();
    },
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: organisation, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => pool,
  };
});

const { default: supportRoutes } = await import('./routes/support.ts');
const { default: migrationRoutes } = await import('./routes/migrations/index.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);
app.use('/api/migrations', migrationRoutes);

let made = 0;
/** The wizard's create, for a new pair of accounts each time. Sent when awaited. */
function create() {
  made += 1;
  const account = `racer-${made}@example.com`;
  return request(app)
    .post('/api/migrations')
    .send({
      name: `race ${made}`,
      sourceType: 'imap',
      targetType: 'jmap',
      sourceConfig: { host: 'src.example.com', port: 993, username: account, password: 'p' },
      targetConfig: { host: 'dst.example.com', port: 443, username: account, password: 'p' },
      syncConfig: { domains: ['email'] },
    });
}

async function clean(): Promise<void> {
  // A close a case made: undone as a reopen undoes it, and its record taken out.
  await pool.query(`UPDATE tenant SET status = 'active' WHERE id = $1`, [TENANT]);
  await pool.query('DELETE FROM tenant_closure WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM erasure_record WHERE tenant_ref = $1', [tenantRef(TENANT)]);
  await pool.query('DELETE FROM test_organisation WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM scope_selection WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM path_lifecycle WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM mailbox WHERE tenant_id = $1 AND id <> $2', [TENANT, BOX]);
  await pool.query('DELETE FROM connection WHERE tenant_id = $1 AND id <> $2', [TENANT, CONN]);
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
  pool = new Pool({ connectionString: PG, max: 6 });
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

beforeEach(async () => {
  organisation = TENANT;
  await clean();
});

afterAll(async () => {
  await clean();
  await pool.query('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
  await pool.query('DELETE FROM platform_operator WHERE user_id = $1', [OPERATOR]);
  await pool.end();
});

describe('a create held open, and a mark that arrives', () => {
  it('waits for the create, sees its migration, and marks nothing, whichever way the id is spelled', async () => {
    const written = gate();
    const release = gate();
    // The create's transaction, as the create door holds it: the
    // organisation's lock, then its migration, not yet committed.
    const held = withTenant(pool, TENANT, async (db) => {
      await holdTheOrganisationsMigrations(db, TENANT);
      await db.insert(mailboxMapping).values({ tenantId: TENANT, sourceMailboxId: BOX, status: 'paused' });
      written.open();
      await release.opened;
    });
    await written.opened;

    // The real route, with the id in capitals.
    const mark = request(app)
      .post(`/api/support/tenants/${TENANT.toUpperCase()}/test`)
      .send({ marker: '[Ownpace-test]' })
      .then((res) => res);
    try {
      expect(await stillWaiting(mark), 'the mark was decided while the create was still open').toBe(true);
    } finally {
      release.open();
    }
    await held;
    const res = await mark;
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'holds_a_migration', held: 1 });

    expect((await pool.query('SELECT 1 FROM test_organisation WHERE tenant_id = $1', [TENANT])).rows).toEqual([]);
    expect(
      (await pool.query(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action LIKE 'tenant.test_marker_%'`, [TENANT])).rows,
    ).toEqual([]);
  });
});

describe('a mark held open, and a create that arrives', () => {
  it('waits for the mark, and copies the marker it committed, whichever way the id is spelled', async () => {
    const written = gate();
    const release = gate();
    // The mark's transaction, as the door holds it: acting as the operator,
    // the organisation's lock (the id in capitals), the count, the row.
    const held = withTenant(pool, TENANT, async (db) => {
      await db.execute(sql`SELECT set_config('app.current_user', ${OPERATOR}, true)`);
      await holdTheOrganisationsMigrations(db, TENANT.toUpperCase());
      expect(await migrationsHeldBy(db, TENANT)).toBe(0);
      await markTestOrganisation(db, TENANT, '[Ownpace-test]', OPERATOR);
      written.open();
      await release.opened;
    });
    await written.opened;

    // The real create, its organisation in lower case.
    const creating = create().then((res) => res);
    try {
      expect(await stillWaiting(creating), 'the create read the marker while the mark was still open').toBe(true);
    } finally {
      release.open();
    }
    await held;
    const res = await creating;
    expect(res.status).toBe(201);
    expect(res.body.testMarker).toBe('[Ownpace-test]');

    expect((await pool.query('SELECT test_marker FROM mailbox_mapping WHERE tenant_id = $1', [TENANT])).rows).toEqual([
      { test_marker: '[Ownpace-test]' },
    ]);
  });
});

/** The organisation's status, its marker and its marker's audit rows, read outside any door. */
async function standing(): Promise<{ status: string; marker: string | null; recorded: string[] }> {
  const [{ status }] = (await pool.query('SELECT status FROM tenant WHERE id = $1', [TENANT])).rows as [{ status: string }];
  const marked = (await pool.query('SELECT marker FROM test_organisation WHERE tenant_id = $1', [TENANT])).rows as Array<{
    marker: string;
  }>;
  const recorded = (
    await pool.query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND action LIKE 'tenant.test_marker_%' ORDER BY at, id`,
      [TENANT],
    )
  ).rows as Array<{ action: string }>;
  return { status, marker: marked[0]?.marker ?? null, recorded: recorded.map((r) => r.action) };
}

/**
 * The close's transaction, as the close door holds it (`closeAccount`): the
 * organisation closed, not yet committed, until `release` opens.
 */
function aCloseHeldOpen(release: Promise<void>, written: () => void): Promise<void> {
  return withTenant(pool, TENANT, async (db) => {
    await closeTenant(db, TENANT, 30, OPERATOR, new Date(), 7);
    written();
    await release;
  });
}

describe('a close held open, and a mark or a clear that arrives', () => {
  it('the mark waits for the close, reads it, and marks nothing', async () => {
    const written = gate();
    const release = gate();
    const held = aCloseHeldOpen(release.opened, written.open);
    await written.opened;

    // The real route. The operator's view, read before the door's
    // transaction, still says the organisation is open.
    const mark = request(app)
      .post(`/api/support/tenants/${TENANT}/test`)
      .send({ marker: '[Ownpace-test]' })
      .then((res) => res);
    try {
      expect(await stillWaiting(mark), 'the mark was decided while the close was still open').toBe(true);
    } finally {
      release.open();
    }
    await held;
    const res = await mark;
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'not_open',
      message: 'It is closed: an organisation is marked as a test, or no longer, only while it is open',
    });
    expect(await standing()).toEqual({ status: 'closed', marker: null, recorded: [] });
  });

  it('the clear waits for the close too, reads it, and clears nothing', async () => {
    await withTenant(pool, TENANT, async (db) => {
      await db.execute(sql`SELECT set_config('app.current_user', ${OPERATOR}, true)`);
      await markTestOrganisation(db, TENANT, '[Ownpace-test]', OPERATOR);
    });
    const written = gate();
    const release = gate();
    const held = aCloseHeldOpen(release.opened, written.open);
    await written.opened;

    const unmark = request(app)
      .delete(`/api/support/tenants/${TENANT}/test`)
      .then((res) => res);
    try {
      expect(await stillWaiting(unmark), 'the clear was decided while the close was still open').toBe(true);
    } finally {
      release.open();
    }
    await held;
    const res = await unmark;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_open');
    expect(await standing()).toEqual({ status: 'closed', marker: '[Ownpace-test]', recorded: [] });
  });
});

describe('a mark held open, and a close that arrives', () => {
  it('waits for the mark, which was made while the organisation was open, and then closes it', async () => {
    const written = gate();
    const release = gate();
    // The mark's transaction, as the door holds it: acting as the operator,
    // its status read and held, its row written.
    const held = withTenant(pool, TENANT, async (db) => {
      await db.execute(sql`SELECT set_config('app.current_user', ${OPERATOR}, true)`);
      expect(await statusHeldUntilCommit(db, TENANT)).toBe('active');
      await markTestOrganisation(db, TENANT, '[Ownpace-test]', OPERATOR);
      written.open();
      await release.opened;
    });
    await written.opened;

    // The real close, the support page's.
    const closing = request(app)
      .post(`/api/support/tenants/${TENANT}/close`)
      .send({ windowDays: 30, reference: 'the race, 0162 T1' })
      .then((res) => res);
    try {
      expect(await stillWaiting(closing), 'the close committed while the mark was still open').toBe(true);
    } finally {
      release.open();
    }
    await held;
    const res = await closing;
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect((await standing()).status).toBe('closed');
  });
});
