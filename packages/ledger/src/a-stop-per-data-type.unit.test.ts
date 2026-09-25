// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * STOP AND RESUME ONE DATA TYPE (workplan 0128 T4, T5 slice 3b), on PGlite as
 * `app_user`, through the one door both editions press.
 *
 * What it must never do: stop the last data type still copying (D5), stop one
 * the migration does not carry, or write anything when it refuses. What it
 * must always do: keep the stop beside the phase, hold or release the slot by
 * D2 (c), say `stopped` on the progress strip, and leave an audit record.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import type { DiscoveryDomain, TenantId } from '@openmig/shared';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { PgPathLifecycleStore } from './path-lifecycle-store.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import { PATH_STATUS_ACTION, stopOrResumePath, type PathStopOutcome } from './a-stop-per-data-type.ts';

// UUID family 0128f000-…, unused elsewhere in the repo.
const TENANT = '0128f000-e29b-41d4-a716-446655440001';
const OTHER_TENANT = '0128f000-e29b-41d4-a716-446655440011';
const CONNECTION = '0128f000-e29b-41d4-a716-446655440002';
const SOURCE_MAILBOX = '0128f000-e29b-41d4-a716-446655440003';
const TARGET_MAILBOX = '0128f000-e29b-41d4-a716-446655440004';
const MAPPING = '0128f000-e29b-41d4-a716-446655440005';
const GONE = '0128f000-e29b-41d4-a716-446655440006';

let driver: LedgerDriver;

async function query(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    conn.release();
  }
}

const press = (domain: DiscoveryDomain, stop: boolean, tenant = TENANT, mapping = MAPPING) =>
  withTenant(driver, tenant, (db) =>
    stopOrResumePath(db, tenant, { mappingId: mapping, domain, stop, actor: 'someone' }),
  );

const slots = () => withTenant(driver, TENANT, (db) => new PgPathLifecycleStore(db).slotsHeld(TENANT as TenantId));

const paths = async () =>
  Object.fromEntries(
    (
      await query(
        `SELECT domain, state, stopped_at IS NOT NULL AS stopped, ended_at IS NOT NULL AS ended
           FROM path_lifecycle WHERE mapping_id = $1`,
        [MAPPING],
      )
    ).map((r) => [r.domain, { state: r.state, stopped: r.stopped, ended: r.ended }]),
  );

const statusOf = async (domain: string) =>
  (await query(`SELECT state FROM migration_status WHERE mapping_id = $1 AND domain = $2`, [MAPPING, domain]))[0]
    ?.state;

const records = () =>
  query(`SELECT actor, detail FROM audit_log WHERE action = $1 ORDER BY at, id`, [PATH_STATUS_ACTION]);

/** The migration in `status`, with mail, calendars and files carried, contacts not, and rows as given. */
async function place(status: string, rows: Record<string, string> = { email: status, calendar: status, file: status }) {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM migration_status WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM audit_log WHERE action = $1`, [PATH_STATUS_ACTION]);
  for (const [domain, state] of Object.entries(rows)) {
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, ended_at)
       VALUES ($1, $2, $3, $4, now(), CASE WHEN $4 IN ('cutover', 'done') THEN now() END)`,
      [TENANT, MAPPING, domain, state],
    );
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'stops', 'active'), ($2, 'other', 'active')`, [
    TENANT,
    OTHER_TENANT,
  ]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [
    [SOURCE_MAILBOX, 'src'],
    [TARGET_MAILBOX, 'dst'],
  ] as const) {
    await query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, $4, 'a@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  for (const [domain, included] of [
    ['email', true],
    ['calendar', true],
    ['file', true],
    ['contact', false],
  ] as const) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, $4)`, [
      TENANT,
      MAPPING,
      domain,
      included,
    ]);
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await place('active');
});

describe('a stop, on a migration before its cutover', () => {
  it('is kept beside the phase, keeps its slot, says so on the strip, and is recorded', async () => {
    expect(await slots()).toBe(3);
    expect(await press('email', true)).toEqual({ changed: true, slotsTaken: false });

    expect((await paths()).email).toEqual({ state: 'active', stopped: true, ended: false });
    // D2 (c): before the cutover a stop keeps its slot, as a pause does.
    expect(await slots()).toBe(3);
    // Said even with nothing copied yet, where a switch-off would say `skipped`.
    expect(await statusOf('email')).toBe('stopped');
    expect(await records()).toEqual([
      {
        actor: 'someone',
        detail: { mappingId: MAPPING, domain: 'email', phase: 'active', from: 'running', to: 'stopped' },
      },
    ]);
  });

  it('is resumed where it stopped, and the strip no longer says stopped', async () => {
    await press('email', true);
    expect(await press('email', false)).toEqual({ changed: true, slotsTaken: false });
    expect((await paths()).email).toEqual({ state: 'active', stopped: false, ended: false });
    expect(await statusOf('email')).toBe('pending');
    expect((await records()).map((r) => (r.detail as { to: string }).to)).toEqual(['stopped', 'running']);
  });

  it('changes nothing, and records nothing, when it already is as asked', async () => {
    expect(await press('email', false)).toEqual({ changed: false, slotsTaken: false });
    await press('email', true);
    expect(await press('email', true)).toEqual({ changed: false, slotsTaken: false });
    expect(await records()).toHaveLength(1);
  });
});

describe('a stop, in the continuous lane (D2 (c))', () => {
  it('releases its slot, and a resume takes it back and says so', async () => {
    await place('continuous');
    expect(await slots()).toBe(3);

    expect(await press('email', true)).toEqual({ changed: true, slotsTaken: false });
    expect((await paths()).email).toEqual({ state: 'continuous', stopped: true, ended: true });
    expect(await slots()).toBe(2);

    // The managed edition raises the month's peak on this answer.
    expect(await press('email', false)).toEqual({ changed: true, slotsTaken: true });
    expect((await paths()).email).toEqual({ state: 'continuous', stopped: false, ended: false });
    expect(await slots()).toBe(3);
  });

  it('gives a data type with no row its row, in the migration phase, and stops it', async () => {
    await place('continuous', { email: 'continuous', calendar: 'continuous' });
    expect(await press('file', true)).toEqual({ changed: true, slotsTaken: false });
    expect((await paths()).file).toEqual({ state: 'continuous', stopped: true, ended: true });
  });

  it('gives it no row when it refuses, or when there is nothing to change', async () => {
    // Files have no row: they run in the migration's phase, unstopped.
    await place('active', { email: 'active', calendar: 'cutover' });
    expect(await press('file', false)).toEqual({ changed: false, slotsTaken: false });
    expect((await paths()).file).toBeUndefined();
    // Mail stopped, calendars past their cutover: files are the last still copying.
    expect(await press('email', true)).toEqual({ changed: true, slotsTaken: false });
    expect(await press('file', true)).toEqual({ refused: 'last_one_copying' });
    expect((await paths()).file).toBeUndefined();
  });
});

describe('never the last data type still copying (D5)', () => {
  it('stops all but one, and refuses the last, writing nothing', async () => {
    await press('email', true);
    await press('calendar', true);
    const before = await paths();
    expect(await press('file', true)).toEqual({ refused: 'last_one_copying' });
    expect(await paths()).toEqual(before);
    expect(await statusOf('file')).toBeUndefined();
    expect(await records()).toHaveLength(2);
  });

  it('counts a data type with no row as copying: it runs in the migration phase', async () => {
    await place('active', { email: 'active' });
    expect(await press('email', true)).toEqual({ changed: true, slotsTaken: false });
  });

  it('counts a data type past its cutover as not copying', async () => {
    await place('active', { email: 'active', calendar: 'cutover', file: 'done' });
    expect(await press('email', true)).toEqual({ refused: 'last_one_copying' });
  });
});

describe('what it refuses, writing nothing', () => {
  const refusedAndUntouched = async (outcome: PathStopOutcome, expected: PathStopOutcome) => {
    expect(outcome).toEqual(expected);
    expect(await records()).toEqual([]);
  };

  it('a migration that is not running', async () => {
    for (const status of ['paused', 'cutover', 'done']) {
      await place(status);
      await refusedAndUntouched(await press('email', true), { refused: 'not_running', status });
      expect((await paths()).email).toMatchObject({ stopped: false });
    }
  });

  it('a data type the migration does not carry', async () => {
    await refusedAndUntouched(await press('contact', true), { refused: 'not_a_path' });
    await refusedAndUntouched(await press('task', true), { refused: 'not_a_path' });
    expect((await paths()).contact).toBeUndefined();
  });

  it('a data type in its cutover or ended', async () => {
    await place('active', { email: 'cutover', calendar: 'active', file: 'active' });
    await refusedAndUntouched(await press('email', true), { refused: 'not_stoppable', phase: 'cutover' });
  });

  it('a migration that is gone, or that another organisation owns', async () => {
    await refusedAndUntouched(await press('email', true, TENANT, GONE), { refused: 'not_found' });
    // Row security, not a filter: the other organisation's transaction sees no row.
    await refusedAndUntouched(await press('email', true, OTHER_TENANT), { refused: 'not_found' });
    expect((await paths()).email).toMatchObject({ stopped: false });
  });
});

describe('what the progress strip reads (getStatus)', () => {
  const shown = async (domain: string) =>
    (
      await withTenant(driver, TENANT, (db) =>
        new PgMigrationStatusStore(db).getStatus(TENANT as TenantId, MAPPING as never),
      )
    ).find((s) => s.domain === domain)?.state;

  it('says stopped for as long as the stop is on the path, whatever a pass under way writes', async () => {
    await press('email', true);
    // A pass that was copying mail when it was stopped finishes it.
    await withTenant(driver, TENANT, (db) =>
      new PgMigrationStatusStore(db).markCompleted(TENANT as TenantId, MAPPING as never, 'email'),
    );
    expect(await statusOf('email')).toBe('completed');
    expect(await shown('email')).toBe('stopped');

    await press('email', false);
    expect(await shown('email')).toBe('completed');
  });
});

describe('the appliance switching every data type on at start-up', () => {
  it('does not undo a stop: only the resume door does', async () => {
    await press('email', true);
    await withTenant(driver, TENANT, (db) =>
      new PgMigrationStatusStore(db).markSwitchedOn(TENANT as TenantId, MAPPING as never, 'email'),
    );
    expect(await statusOf('email')).toBe('stopped');
    // A data type the file switched off and back on still loses its `stopped`.
    await withTenant(driver, TENANT, (db) =>
      db.execute(
        sql`INSERT INTO migration_status (id, tenant_id, mapping_id, domain, state, started_at, updated_at)
            VALUES (gen_random_uuid(), ${TENANT}::uuid, ${MAPPING}::uuid, 'calendar', 'stopped', now(), now())
            ON CONFLICT (tenant_id, mapping_id, domain) DO UPDATE SET state = 'stopped'`,
      ),
    );
    await withTenant(driver, TENANT, (db) =>
      new PgMigrationStatusStore(db).markSwitchedOn(TENANT as TenantId, MAPPING as never, 'calendar'),
    );
    expect(await statusOf('calendar')).toBe('pending');
  });
});
