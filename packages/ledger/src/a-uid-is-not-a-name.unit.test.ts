// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A row can say what its owner CALLS the item, not only what the source keys it by.
 *
 * ## What was wrong
 *
 * `item.natural_key` — added on 2026-09-12 so the confirmed list could say
 * WHICH item a row is — carries what the SOURCE calls the item. For a file that
 * is a path and for mail a Message-ID, and a person can search their old
 * account for either.
 *
 * For a calendar event and a contact it is a UID, and a UID is not something
 * anybody has ever seen. The owner said so on sight: *"Why not show calander
 * item names and contact names?"*
 *
 * It cost him an evening the same day. Two of his contacts were refused by a
 * live Nextcloud, and every surface that could have told him which two printed
 * `926caf98adce563`: *"I can not find these contacts, or atleast i do no know
 * how."*
 *
 * ## Why these run against a real database
 *
 * Same reason as `a-list-that-cannot-say-which-item.unit.test.ts`, whose defect
 * this one is the sequel to: a value computed correctly and dropped between the
 * function and the row is this repository's most repeated shape, and a fake
 * cannot see it because a fake stores the object it was handed. So every
 * assertion reads `display_name` out of the table, through the real migration
 * chain, as `app_user`.
 *
 * UUID family 6b130000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import type { LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const TENANT = '6b130000-e29b-41d4-a716-446655442001' as TenantId;
const CONN = '6b130000-e29b-41d4-a716-446655442011';
const BOX = '6b130000-e29b-41d4-a716-446655442021';
const MAPPING = '6b130000-e29b-41d4-a716-446655442031' as MappingId;

const CARD_UID = 'b3f1c0de-2222-4333-8444-555566667777';
const CARD_HASH = 'hash-of-the-named-card';
const CARD_NAME = 'Jan Jansen';

let driver: LedgerDriver;

/** The column itself, read outside the store. `null` for no row AND for no name. */
async function storedName(hash = CARD_HASH): Promise<string | null> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT display_name FROM item WHERE mapping_id = $1 AND natural_key_hash = $2',
      [MAPPING, hash],
    );
    const row = r.rows[0] as { display_name: string | null } | undefined;
    return row ? row.display_name : null;
  } finally {
    await conn.release();
  }
}

function record(over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'contact',
    naturalKeyHash: CARD_HASH,
    naturalKey: CARD_UID,
    contentHash: 'content-1',
    targetId: 'addressbooks/users/admin/contacts/x.vcf',
    createdAt: new Date().toISOString(),
    collection: 'Contacts',
    ...over,
  };
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'named']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','g','{}'::jsonb,'connected')`,
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
  // 120s for the same reason every PGlite fixture in this package carries it.
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

describe('the row records the name a person calls it', () => {
  it('recordIfAbsent stores it', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    expect(await storedName()).toBe(CARD_NAME);
  });

  it('recordFailure stores it — this is the path the owner met the problem on', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordFailure(
        record({ displayName: CARD_NAME, status: 'failed', targetId: '' }),
        'the target answered 500',
      ),
    );
    expect(await storedName()).toBe(CARD_NAME);

    // And after a SECOND failure, which takes the update branch rather than the
    // insert. Five attempts is what his two cards actually got.
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordFailure(
        record({ displayName: CARD_NAME, status: 'failed', targetId: '' }),
        'the target answered 500 again',
      ),
    );
    expect(await storedName()).toBe(CARD_NAME);
  });

  it('reads back on the record, so a caller can see what was stored', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    const found = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).find(TENANT, MAPPING, 'contact', CARD_HASH),
    );
    expect(found?.displayName).toBe(CARD_NAME);
  });
});

describe('a domain with no name to give', () => {
  it('stores NULL rather than a blank, and the row is fine', async () => {
    // A file's key IS its name, and mail's Subject is not decoded anywhere yet.
    // NULL is the honest value, and it is what a screen falls back from.
    await withTenant(driver, TENANT, async (db) => new PgLedger(db).recordIfAbsent(record()));
    expect(await storedName()).toBeNull();
  });

  it('does not come back on the record as an empty string', async () => {
    // "Not recorded" must stay distinguishable from "recorded as empty", or a
    // caller's own heal check reads a blank as a value it was given.
    await withTenant(driver, TENANT, async (db) => new PgLedger(db).recordIfAbsent(record()));
    const found = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).find(TENANT, MAPPING, 'contact', CARD_HASH),
    );
    expect(found).toBeDefined();
    expect(found?.displayName).toBeUndefined();
  });
});

describe('a name is never erased by a pass that has none', () => {
  it('recordUpdate leaves a stored name alone', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    // A later pass that cannot name the item — a domain with no name, or a
    // caller round-tripping a record it read back before the name existed.
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ contentHash: 'content-2' })),
    );
    expect(await storedName()).toBe(CARD_NAME);
  });

  it('an empty string counts as nothing to say, not as a value', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ displayName: '', contentHash: 'content-3' })),
    );
    expect(await storedName()).toBe(CARD_NAME);
  });

  it('recordFailure leaves it alone too', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordFailure(record({ targetId: '' }), 'the target answered 500'),
    );
    expect(await storedName()).toBe(CARD_NAME);
  });

  it('but a REAL name replaces an older one, because a card can be renamed', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ displayName: 'Jan de Vries', contentHash: 'c4' })),
    );
    expect(await storedName()).toBe('Jan de Vries');
  });

  it('a row that predates the column heals on the next pass', async () => {
    // There is no backfill and there cannot be one: the name is in the payload
    // at the source and the ledger never kept a copy. What CAN recover it is a
    // pass that reads the item again, and this is where it hands it back.
    await withTenant(driver, TENANT, async (db) => new PgLedger(db).recordIfAbsent(record()));
    expect(await storedName()).toBeNull();
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ displayName: CARD_NAME, contentHash: 'c5' })),
    );
    expect(await storedName()).toBe(CARD_NAME);
  });
});

describe('the confirmed list carries it to the screen', () => {
  it('a named row arrives named, and an unnamed one arrives without inventing anything', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ displayName: CARD_NAME })),
    );
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(
        record({ naturalKeyHash: 'hash-of-a-file', naturalKey: '/Documents/tax.pdf' }),
      ),
    );

    const rows = await withTenant(driver, TENANT, async (db) =>
      new ConfirmationStore(db).rowsFor({ tenantId: TENANT, mappingId: MAPPING }),
    );

    const named = rows.find((r) => r.naturalKey === CARD_UID);
    expect(named?.displayName).toBe(CARD_NAME);

    const unnamed = rows.find((r) => r.naturalKey === '/Documents/tax.pdf');
    expect(unnamed).toBeDefined();
    // Null, not the key echoed back: the fall-back is the reader's decision and
    // a store that made it here would hide which rows actually have a name.
    expect(unnamed?.displayName).toBeNull();
  });
});
