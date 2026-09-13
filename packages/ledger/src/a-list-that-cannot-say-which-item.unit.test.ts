// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The confirmed list can say WHICH item each row is.
 *
 * ## What was wrong
 *
 * `item.natural_key` was written in exactly two places in this repository —
 * `PgLedger.recordIfAbsent` and `PgLedger.recordFailure` — and both hardcoded
 * `''`, under the comment *"Will be set by caller if needed"*. No caller ever
 * could: `LedgerRecord` had no such field. So every row in every domain, since
 * migration 0001, carried a blank there.
 *
 * The column has one consumer: `PgConfirmationStore.rowsFor`, which feeds the
 * confirmed list and its CSV export — the document whose own contract argues at
 * length that this field is §17's documented exception, *"because a list that
 * cannot say WHICH item is missing is not a list anybody can act on, and this
 * is the one somebody deletes their originals on the strength of"*.
 *
 * It was found from the other end: two contact failures on a live migration
 * could not be identified on screen.
 *
 * ## Why these run against a real database
 *
 * The defect is a value computed correctly and dropped between the function and
 * the row — this repository's most repeated shape, and the one a fake cannot
 * see, because a fake stores the object it was handed. So every assertion below
 * reads `natural_key` out of the table, and the list assertions go through the
 * real store. PGlite as `app_user`, through the real migration chain, so the
 * column and its NOT NULL are the product's.
 *
 * UUID family 6b120000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import type { LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const TENANT = '6b120000-e29b-41d4-a716-446655442001' as TenantId;
const CONN = '6b120000-e29b-41d4-a716-446655442011';
const BOX = '6b120000-e29b-41d4-a716-446655442021';
const MAPPING = '6b120000-e29b-41d4-a716-446655442031' as MappingId;

/** A vCard UID of the shape the live failure carried. */
const CARD_UID = 'b3f1c0de-1111-4222-8333-444455556666';
const CARD_HASH = 'hash-of-the-card';

let driver: LedgerDriver;

/**
 * The column itself, read outside the store as plain `app_user`.
 *
 * `null` when there is no row at all, which is a different answer from `''` —
 * and telling those apart is the whole subject here.
 */
async function storedNaturalKey(hash = CARD_HASH): Promise<string | null> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT natural_key FROM item WHERE mapping_id = $1 AND natural_key_hash = $2',
      [MAPPING, hash],
    );
    const row = r.rows[0] as { natural_key: string } | undefined;
    return row ? row.natural_key : null;
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
  // 120s for the same reason every PGlite fixture in this package carries it:
  // a cluster plus the full migration chain has exceeded vitest's 10s on a
  // loaded runner while passing in isolation (#652).
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

describe('the row records the item its own account calls it', () => {
  it('recordIfAbsent writes the identifier, not a blank', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ naturalKey: CARD_UID })),
    );
    expect(await storedNaturalKey()).toBe(CARD_UID);
  });

  it('recordFailure writes it too — a failure nobody can name is one nobody can act on', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordFailure(
        record({ naturalKey: CARD_UID, status: 'failed', targetId: '' }),
        'the target answered 500',
      ),
    );
    expect(await storedNaturalKey()).toBe(CARD_UID);

    // And the row is still identifiable after a SECOND failure, which takes the
    // update branch rather than the insert.
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordFailure(
        record({ naturalKey: CARD_UID, status: 'failed', targetId: '' }),
        'the target answered 500 again',
      ),
    );
    expect(await storedNaturalKey()).toBe(CARD_UID);
  });

  it('a caller with nothing to say still gets a row — the column is NOT NULL', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record()),
    );
    // `''`, not null and not a refusal: a domain that cannot name its items is
    // no worse off than before, and nothing about the insert depends on this.
    expect(await storedNaturalKey()).toBe('');
  });

  it('reads back on the record, so a caller can see what was stored', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ naturalKey: CARD_UID })),
    );
    const found = await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).find(TENANT, MAPPING, 'contact', CARD_HASH),
    );
    expect(found?.naturalKey).toBe(CARD_UID);
  });
});

/**
 * THE REPAIR PATH, and the reason it has to exist.
 *
 * Every row written before this fix holds `''`, and no database migration can
 * fill them: the plain text is not recoverable from its own sha256. What can
 * recover it is a pass that reads the item again — so `recordUpdate` treats a
 * blank as "nothing recorded" and takes what it is given.
 */
describe('an existing migration heals as its source is re-walked', () => {
  it('recordUpdate fills a blank left by an older pass', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record()),
    );
    expect(await storedNaturalKey()).toBe('');

    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ naturalKey: CARD_UID, contentHash: 'content-2' })),
    );
    expect(await storedNaturalKey()).toBe(CARD_UID);
  });

  it('and never blanks one it already holds', async () => {
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordIfAbsent(record({ naturalKey: CARD_UID })),
    );

    // A caller with nothing to say — the same rule `collection` and `sourceRef`
    // follow. Blanking here would undo the repair on the next ordinary pass.
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ contentHash: 'content-2' })),
    );
    expect(await storedNaturalKey()).toBe(CARD_UID);

    // An explicit empty string is "nothing to say" too, not a value: it is
    // exactly what an unrepaired row hands back if one is round-tripped.
    await withTenant(driver, TENANT, async (db) =>
      new PgLedger(db).recordUpdate(record({ naturalKey: '', contentHash: 'content-3' })),
    );
    expect(await storedNaturalKey()).toBe(CARD_UID);
  });
});

/**
 * The payoff: the document somebody empties their old account on the strength
 * of, read through the store that serves it.
 */
describe('the confirmed list names the item', () => {
  it('carries the identifier onto the row a person reads', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const ledger = new PgLedger(db);
      await ledger.recordIfAbsent(record({ naturalKey: CARD_UID, status: 'copied' }));
      await ledger.recordIfAbsent(
        record({
          naturalKeyHash: 'hash-of-the-file',
          itemType: 'file',
          naturalKey: 'Wieke/Foto shoot Emma/DSC_0042.jpg',
          collection: 'Wieke/Foto shoot Emma',
          targetId: 'remote.php/dav/files/admin/DSC_0042.jpg',
          status: 'copied',
        }),
      );
    });

    const rows = await withTenant(driver, TENANT, async (db) =>
      new ConfirmationStore(db).rowsFor({ tenantId: TENANT, mappingId: MAPPING }),
    );

    expect(rows).toHaveLength(2);
    // Sorted by `id`, which is a random uuid — so assert on the set, not the
    // order. The ordering `rowsFor` guarantees is between its two CONSUMERS,
    // not something a fixture can predict.
    expect(new Set(rows.map((r) => r.naturalKey))).toEqual(
      new Set([CARD_UID, 'Wieke/Foto shoot Emma/DSC_0042.jpg']),
    );
  });
});
