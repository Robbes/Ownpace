// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE WITH ITS REFERENCE (ledger migration 0061; workplan 0129 T1's
 * promise, 0130 T3's need).
 *
 * The status row of a data type whose pass failed keeps the reference the
 * failure was recorded under, beside its category, so the failure line can
 * show what a person quotes. It is written with the failure and cleared when
 * the failure is over: a reference to a failure that has passed would send
 * somebody looking for the wrong one.
 *
 * Real Postgres via PGlite, the appliance's own factory: the CHECK is part of
 * what is under test.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import { runMigrations } from './migrate.ts';
import { createPgliteDb } from './pglite-driver.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';

// UUID family 0e2d0000-…, unused elsewhere in the repo.
const TENANT = asTenantId('0e2d0000-e29b-41d4-a716-446655440001');
const CONNECTION = '0e2d0000-e29b-41d4-a716-446655440011';
const SRC = '0e2d0000-e29b-41d4-a716-446655440021';
const MAPPING = asMappingId('0e2d0000-e29b-41d4-a716-446655440031');

let driver: LedgerDriver;
let conn: LedgerConnection;
let store: PgMigrationStatusStore;

const reference = async () =>
  (await store.getStatus(TENANT, MAPPING)).find((s) => s.domain === 'calendar')
    ?.lastErrorReference;

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  store = new PgMigrationStatusStore(made.db);
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 't', 'active')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name)
     VALUES ($1, $2, 'source', 'caldav', 'fixture')`,
    [CONNECTION, TENANT],
  );
  await conn.query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1, $2, $3, 's')`,
    [SRC, TENANT, CONNECTION],
  );
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, mode)
     VALUES ($1, $2, $3, 'active', 'mirror')`,
    [MAPPING, TENANT, SRC],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM migration_status');
  await store.initDomainStatus(TENANT, MAPPING, 'calendar');
  await store.markInProgress(TENANT, MAPPING, 'calendar');
});

describe("a failed data type's status", () => {
  it('keeps the reference its failure was recorded under, beside the category', async () => {
    await store.markFailed(TENANT, MAPPING, 'calendar', '401 Unauthorized', 'source', '0a1b2c3d');

    const [status] = await store.getStatus(TENANT, MAPPING);
    expect(status).toMatchObject({
      state: 'failed',
      lastErrorCategory: 'auth_expired',
      lastErrorReference: '0a1b2c3d',
    });
  });

  it("replaces a previous failure's reference, and keeps none when the new one has none", async () => {
    await store.markFailed(TENANT, MAPPING, 'calendar', 'boom', undefined, '0a1b2c3d');
    await store.markFailed(TENANT, MAPPING, 'calendar', 'boom again', undefined, '1b2c3d4e');
    expect(await reference()).toBe('1b2c3d4e');

    await store.markFailed(TENANT, MAPPING, 'calendar', 'boom once more');
    expect(await reference()).toBeUndefined();
  });

  it('keeps the failure and drops a reference of the wrong shape, rather than losing both', async () => {
    await store.markFailed(TENANT, MAPPING, 'calendar', 'boom', undefined, 'see the log');

    const [status] = await store.getStatus(TENANT, MAPPING);
    expect(status?.state).toBe('failed');
    expect(status?.lastErrorReference).toBeUndefined();
  });
});

describe('when the failure is over', () => {
  it('a pass that completes clears the reference', async () => {
    await store.markFailed(TENANT, MAPPING, 'calendar', 'boom', undefined, '0a1b2c3d');
    await store.markCompleted(TENANT, MAPPING, 'calendar');

    expect(await reference()).toBeUndefined();
  });

  it('a pass that stops on purpose clears it too', async () => {
    await store.markFailed(TENANT, MAPPING, 'calendar', 'boom', undefined, '0a1b2c3d');
    await store.markPaused(TENANT, MAPPING, 'calendar', {
      kind: 'daily-download-ceiling',
      provider: 'imap.gmail.com',
      windowResetsAt: null,
    });

    expect(await reference()).toBeUndefined();
  });
});

describe('the column', () => {
  it('holds eight hex characters or nothing, so it cannot carry a message', async () => {
    await expect(
      conn.query(
        `UPDATE migration_status SET last_error_reference = 'calendar failed for jan' WHERE mapping_id = $1`,
        [MAPPING],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
