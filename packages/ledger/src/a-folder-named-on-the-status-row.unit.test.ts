// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FOLDER THE PASS COULD NOT LIST, NAMED ON THE STATUS ROW (2026-09-29;
 * workplan 0055 T3 (e), the owner's "2a").
 *
 * The pass skips such a folder and carries on; the row says which one, where
 * a failure's line stands, with a category, the source as its side and a
 * reference, because that is where the owner's screen shows what went wrong.
 * The state is left as the pass began it: the data type has not finished.
 *
 * And the note goes the same way it came: a later pass that lists the folder
 * clears it, and only it. A failure's line is the provider's prose, and it is
 * `markCompleted`'s to clear, on a pass that finished.
 *
 * Real Postgres via PGlite, because the clearing is a `LIKE` in a statement,
 * and the columns have CHECKs that a wrong category or reference would trip.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import {
  UNREAD_NOTE_PREFIX,
  type DiscoveryDomain,
  type MappingId,
  type PauseReason,
  type TenantId,
  type UnreadCollection,
} from '@openmig/shared';

// UUID family 02a0…, unused elsewhere in the repo.
const TENANT = '02a00000-e29b-41d4-a716-446655440011' as TenantId;
const MAPPING = '02a00000-e29b-41d4-a716-446655440012' as MappingId;
const CONN = '02a00000-e29b-41d4-a716-446655440013';
const SRC = '02a00000-e29b-41d4-a716-446655440014';
const DST = '02a00000-e29b-41d4-a716-446655440015';

const DROPBOX_500 = 'Dropbox answered 500 on files/list_folder: unexpected error occurred';

/** A folder the source refused, filed as such where the pass classified it. */
const REFUSED = 'Dropbox answered 409 on files/list_folder: path/restricted_content';
const PHOTOS: UnreadCollection = {
  collection: '/Photos',
  name: '/Photos',
  error: REFUSED,
  category: 'source_refused',
  reference: '0a0b0c0d',
};

const CEILING: PauseReason = {
  kind: 'daily-download-ceiling',
  provider: 'content.dropboxapi.com',
  windowResetsAt: '2026-09-30T06:00:00.000Z',
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
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Unread folder tests', 'active')`, [
    TENANT,
  ]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@unread.local'],
    [DST, 'dst@unread.local'],
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
  for (const domain of ['file', 'email'] as const) {
    await store.initDomainStatus(TENANT, MAPPING, domain);
    await store.markInProgress(TENANT, MAPPING, domain);
  }
});

interface Row {
  state: string;
  last_error: string | null;
  last_error_category: string | null;
  failed_side: string | null;
  last_error_reference: string | null;
  paused_reason: unknown;
  completed_at: unknown;
}

const row = async (domain: DiscoveryDomain = 'file'): Promise<Row> => {
  const r = await conn.query<Row>(
    `SELECT state, last_error, last_error_category, failed_side, last_error_reference,
            paused_reason, completed_at
       FROM migration_status WHERE tenant_id = $1 AND mapping_id = $2 AND domain = $3`,
    [TENANT, MAPPING, domain],
  );
  return r.rows[0]!;
};

describe('a pass that could not list a folder', () => {
  it('names it where a failure stands, with its category, the source as the side and its reference', async () => {
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', [PHOTOS]);

    const after = await row();
    expect(after.last_error).toBe(
      `${UNREAD_NOTE_PREFIX}the folder "/Photos". The source answered: ${REFUSED}. The next ` +
        'pass asks for it again, and nothing in it is counted as deleted until it is read.',
    );
    // The category the pass gave it, where the error was freshest, not one
    // derived again from the prose here.
    expect(after.last_error_category).toBe('source_refused');
    expect(after.failed_side).toBe('source');
    expect(after.last_error_reference).toBe('0a0b0c0d');
  });

  it('leaves the state as the pass began it, with no completion time: the data type has not finished', async () => {
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', [PHOTOS]);

    const after = await row();
    expect(after.state).toBe('in_progress');
    expect(after.completed_at).toBeNull();
  });

  it('keeps the note beside a pause when it is written after the pause, as both runners do', async () => {
    await store.markPaused(TENANT, MAPPING, 'file', CEILING);
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', [PHOTOS]);

    const after = await row();
    expect(after.paused_reason).toEqual(CEILING);
    expect(after.last_error).toMatch(/^Not read on the last pass: /);
  });

  it('drops a reference of the wrong shape, and keeps the note', async () => {
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', [{ ...PHOTOS, reference: 'not-a-ref' }]);

    const after = await row();
    expect(after.last_error_reference).toBeNull();
    expect(after.last_error).toMatch(/^Not read on the last pass: /);
  });
});

describe('a later pass that listed every folder it opened', () => {
  it('clears the note, its category, side and reference', async () => {
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', [PHOTOS]);
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', []);

    const after = await row();
    expect(after.last_error).toBeNull();
    expect(after.last_error_category).toBeNull();
    expect(after.failed_side).toBeNull();
    expect(after.last_error_reference).toBeNull();
  });

  it("leaves a failure's line alone: that is markCompleted's to clear", async () => {
    await store.markFailed(TENANT, MAPPING, 'file', DROPBOX_500, 'source', '1a2b3c4d');
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', []);

    const after = await row();
    expect(after.state).toBe('failed');
    expect(after.last_error).toBe(DROPBOX_500);
    expect(after.last_error_category).toBe('unknown');
    expect(after.failed_side).toBe('source');
    expect(after.last_error_reference).toBe('1a2b3c4d');
  });

  it("clears only its own data type's note", async () => {
    await store.noteUnreadCollections(TENANT, MAPPING, 'email', [{ ...PHOTOS, collection: 'INBOX/Old', name: 'INBOX/Old' }]);
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', []);

    expect((await row('email')).last_error).toMatch(/^Not read on the last pass: the folder "INBOX\/Old"/);
  });
});

describe('a pass that finished the data type', () => {
  it('clears the note with everything else, as markCompleted always has', async () => {
    await store.noteUnreadCollections(TENANT, MAPPING, 'file', [PHOTOS]);
    await store.markCompleted(TENANT, MAPPING, 'file');

    const after = await row();
    expect(after.state).toBe('completed');
    expect(after.last_error).toBeNull();
    expect(after.last_error_reference).toBeNull();
  });
});
