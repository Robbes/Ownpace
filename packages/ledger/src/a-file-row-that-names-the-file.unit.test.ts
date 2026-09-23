// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE ROW THAT NAMES THE FILE (owner's screenshot, 2026-09-23).
 *
 * A file that failed five times appeared on the failures queue as a folder
 * path, and the file itself, a `.htaccess`, was named only inside the error
 * line. A file's row stores no name (`runFileSync`: its key is its path), and
 * the queue serves the path only as its folder beside an opaque hash, so every
 * failed file named its folder and never itself. A refusal that did not quote
 * the path would not have said which file at all.
 *
 * The queue now reads a file's name from the key the row already stores: its
 * last segment. It is not an invented name, and it reaches rows written before
 * the change. This file holds that, and holds where it stops:
 *
 *  - a file's failure is named by its file, beside its folder;
 *  - a name the row stores is still the one served;
 *  - a file whose key was never recorded has no name, as before;
 *  - a contact's key is its UID, which is not a name (`a-uid-is-not-a-name`),
 *    and a contact without a stored name still has none.
 *
 * PGlite as the appliance runs it. The folder names are invented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import { DISPLAY_NAME_LIMIT, type LedgerRecord, type MappingId, type TenantId } from '@openmig/shared';

const TENANT = '0e310000-e29b-41d4-a716-446655440001' as TenantId;
const CONN = '0e310000-e29b-41d4-a716-446655440011';
const BOX = '0e310000-e29b-41d4-a716-446655440021';
const MAPPING = '0e310000-e29b-41d4-a716-446655440031' as MappingId;

const FOLDER = 'Documents/website';

let driver: LedgerDriver;

function failedFile(over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: 'hash-of-the-file',
    naturalKey: `${FOLDER}/.htaccess`,
    contentHash: '',
    targetId: '',
    createdAt: new Date().toISOString(),
    collection: FOLDER,
    status: 'failed',
    ...over,
  };
}

const REFUSAL = 'PUT failed with status 500: OCP\\Files\\ForbiddenException — Invalid path';

async function failAndList(record: LedgerRecord) {
  await withTenant(driver, TENANT, async (db) => new PgLedger(db).recordFailure(record, REFUSAL));
  return withTenant(driver, TENANT, async (db) => new PgLedger(db).listFailures(TENANT, MAPPING));
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'files']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','microsoft','m','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING, TENANT, BOX],
    );
  } finally {
    await conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM item WHERE mapping_id = $1', [MAPPING]);
  } finally {
    await conn.release();
  }
});

describe("a file's failure names the file", () => {
  it('by the last segment of its path, beside its folder', async () => {
    const [failure] = await failAndList(failedFile());

    expect(failure?.displayName).toBe('.htaccess');
    expect(failure?.collection).toBe(FOLDER);
    // The hash is still the handle for both actions.
    expect(failure?.naturalKeyHash).toBe('hash-of-the-file');
  });

  it('bounded like every name, so a pathological one cannot fill the row', async () => {
    const long = 'x'.repeat(DISPLAY_NAME_LIMIT + 50);
    const [failure] = await failAndList(failedFile({ naturalKey: `${FOLDER}/${long}.pdf` }));

    expect(Array.from(failure?.displayName ?? '')).toHaveLength(DISPLAY_NAME_LIMIT + 1);
    expect(failure?.displayName?.endsWith('…')).toBe(true);
  });

  it('by the name the row stores, when it stores one', async () => {
    const [failure] = await failAndList(failedFile({ displayName: 'Stored name' }));

    expect(failure?.displayName).toBe('Stored name');
  });
});

describe('where it stops', () => {
  it('a file whose key was never recorded has no name, and the screen shows its folder', async () => {
    const [failure] = await failAndList(failedFile({ naturalKey: '' }));

    expect(failure?.displayName).toBeUndefined();
    expect(failure?.collection).toBe(FOLDER);
  });

  it("a contact's key is its UID, which is not a name: without a stored one it has none", async () => {
    const [failure] = await failAndList(
      failedFile({ itemType: 'contact', naturalKey: 'b3f1c0de-2222-4333-8444-555566667777', collection: 'Contacts' }),
    );

    expect(failure?.displayName).toBeUndefined();
  });
});
