// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A domain that stopped on purpose must not be recorded as one that finished.
 *
 * ## What this is about
 *
 * `markCompleted` says, in its own comment, that `completed` is "the one state
 * that positively asserts the domain finished" — which is the whole basis for
 * it clearing the last error. A domain that stopped at its source's daily
 * download ceiling has finished nothing: its cursors are where they were and
 * the next pass carries on from them. Calling it completed put a "last synced"
 * time on a customer's screen beside a half-copied mailbox, which is the
 * failure migration 0041 exists to end.
 *
 * Real Postgres via PGlite, because the properties are the column's: a `jsonb`
 * that accepts anything, and four writers that must each leave it null.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import type { MappingId, PauseReason, TenantId } from '@openmig/shared';

// UUID family 0041…, unused elsewhere in the repo.
const TENANT = '00410000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '00410000-e29b-41d4-a716-446655440002' as MappingId;
const CONN = '00410000-e29b-41d4-a716-446655440003';
const SRC = '00410000-e29b-41d4-a716-446655440004';
const DST = '00410000-e29b-41d4-a716-446655440005';

const CEILING: PauseReason = {
  kind: 'daily-download-ceiling',
  provider: 'imap.gmail.com',
  windowResetsAt: '2026-09-09T06:00:00.000Z',
};

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;
let store: PgMigrationStatusStore;

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Pause tests', 'active')`, [
    TENANT,
  ]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@pause.local'],
    [DST, 'dst@pause.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );
  store = new PgMigrationStatusStore(db);
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM migration_status');
  await store.initDomainStatus(TENANT, MAPPING, 'email');
});

const row = async (): Promise<{
  state: string;
  paused_reason: unknown;
  completed_at: unknown;
  last_error: unknown;
}> => {
  const r = await conn.query<{
    state: string;
    paused_reason: unknown;
    completed_at: unknown;
    last_error: unknown;
  }>(
    `SELECT state, paused_reason, completed_at, last_error FROM migration_status
      WHERE tenant_id = $1 AND mapping_id = $2 AND domain = 'email'`,
    [TENANT, MAPPING],
  );
  return r.rows[0]!;
};

describe('a paused domain keeps its state and gains a reason', () => {
  it('stays in_progress, which is true across passes', async () => {
    await store.markInProgress(TENANT, MAPPING, 'email');
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    const after = await row();
    expect(after.state).toBe('in_progress');
    expect(after.paused_reason).toEqual(CEILING);
  });

  it('gets no completion time, so no screen can claim it is up to date', async () => {
    await store.markInProgress(TENANT, MAPPING, 'email');
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    expect((await row()).completed_at).toBeNull();
  });

  it('clears a previous pass’s error, for markCompleted’s own reason', async () => {
    // Reaching markPaused means the pass RETURNED. `markFailed` is the only
    // writer of `last_error` and only runs when a pass threw, so an error
    // still standing here belongs to a pass a clean one has superseded — and
    // an error beside a scheduled pause reads as the cause of it.
    await store.markFailed(TENANT, MAPPING, 'email', 'a credential expired', 'source');
    await store.markInProgress(TENANT, MAPPING, 'email');
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    expect((await row()).last_error).toBeNull();
  });

  it('reads back through the guard as the reason it was written as', async () => {
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    const [status] = await store.getStatus(TENANT, MAPPING);
    expect(status?.pausedReason).toEqual(CEILING);
  });

  it('drops a reason this build has no sentence for, rather than rendering it', async () => {
    await conn.query(
      `UPDATE migration_status SET paused_reason = $1::jsonb
        WHERE tenant_id = $2 AND mapping_id = $3 AND domain = 'email'`,
      [JSON.stringify({ kind: 'written-by-a-newer-build' }), TENANT, MAPPING],
    );
    const [status] = await store.getStatus(TENANT, MAPPING);
    expect(status?.pausedReason).toBeUndefined();
  });
});

describe('no row carries both a terminal state and a live pause', () => {
  it('a started pass clears last pass’s reason', async () => {
    // The load-bearing clear: every pass calls this first, so a ceiling that
    // reset overnight stops showing "waiting for the daily limit" the moment
    // copying resumes.
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    await store.markInProgress(TENANT, MAPPING, 'email');
    expect((await row()).paused_reason).toBeNull();
  });

  it('a completed pass clears it', async () => {
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    await store.markCompleted(TENANT, MAPPING, 'email');
    const after = await row();
    expect(after.state).toBe('completed');
    expect(after.paused_reason).toBeNull();
  });

  it('a failed pass clears it', async () => {
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    await store.markFailed(TENANT, MAPPING, 'email', 'the target refused');
    const after = await row();
    expect(after.state).toBe('failed');
    expect(after.paused_reason).toBeNull();
  });

  it('a skipped domain clears it', async () => {
    await store.markPaused(TENANT, MAPPING, 'email', CEILING);
    await store.markSkipped(TENANT, MAPPING, 'email');
    const after = await row();
    expect(after.state).toBe('skipped');
    expect(after.paused_reason).toBeNull();
  });
});

describe('a row nothing has paused says nothing about a pause', () => {
  it('carries no reason at all', async () => {
    const [status] = await store.getStatus(TENANT, MAPPING);
    expect(status?.pausedReason).toBeUndefined();
  });
});
