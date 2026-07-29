// Copyright 2026 OpenHands Agent (Apache-2.0)
// Integration tests for the SQL-backed ledger against PostgreSQL.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from './db';
import { PgLedger } from './ledger';
import { PgCursorStore } from './cursor-store';
import type { LedgerRecord } from '@openmig/shared';
import { asTenantId, asMappingId, MAX_ITEM_ATTEMPTS } from '@openmig/shared';
import type { PgDatabase } from './db';

// Connection string from Testcontainers (set by vitest.global-setup.ts)
// Fails loudly if TEST_DATABASE_URL is not set, rather than silently using wrong defaults.
const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

// Fixed UUIDs for testing (valid UUID format) - namespace 5a0b for ledger.integration.test.ts
const TEST_TENANT_ID = asTenantId('5a0b0000-e29b-41d4-a716-446655440001' as never);
const TEST_MAPPING_ID = asMappingId('5a0b0000-e29b-41d4-a716-446655440002' as never);
const TEST_TENANT_2_ID = asTenantId('5a0b0000-e29b-41d4-a716-446655440003' as never);
const TEST_MAPPING_2_ID = asMappingId('5a0b0000-e29b-41d4-a716-446655440004' as never);

describe('PgLedger (integration)', () => {
  let ledger: PgLedger;
  let db: PgDatabase;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    // Create test data (tenant, connection, mailbox, mapping)
    // Insert tenant
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TEST_TENANT_ID}, 'Test Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert second tenant for isolation tests
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TEST_TENANT_2_ID}, 'Test Tenant 2', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert source connection
    const sourceConnId = '5a0b0000-e29b-41d4-a716-446655440001';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${TEST_TENANT_ID}, 'source', 'o365', 'O365 Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert target connection
    const targetConnId = '5a0b0000-e29b-41d4-a716-446655440002';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${TEST_TENANT_ID}, 'target', 'imap', 'IMAP Target', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert source mailbox
    const sourceMailboxId = '5a0b0000-e29b-41d4-a716-446655440001';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TEST_TENANT_ID}, ${sourceConnId}, 'source@dev.local', 'user', 'Source Mailbox', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert target mailbox
    const targetMailboxId = '5a0b0000-e29b-41d4-a716-446655440002';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TEST_TENANT_ID}, ${targetConnId}, 'target@dev.local', 'user', 'Target Mailbox', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert mailbox mapping
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${TEST_MAPPING_ID}, ${TEST_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert second mapping for isolation tests
    const sourceMailboxId2 = '5a0b0000-e29b-41d4-a716-446655440003';
    const targetMailboxId2 = '5a0b0000-e29b-41d4-a716-446655440004';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId2}, ${TEST_TENANT_2_ID}, ${sourceConnId}, 'source2@dev.local', 'user', 'Source Mailbox 2', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId2}, ${TEST_TENANT_2_ID}, ${targetConnId}, 'target2@dev.local', 'user', 'Target Mailbox 2', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${TEST_MAPPING_2_ID}, ${TEST_TENANT_2_ID}, ${sourceMailboxId2}, ${targetMailboxId2}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TEST_TENANT_ID}`);
  });

  it('should return undefined for non-existent record', async () => {
    const result = await ledger.find(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'email',
      'hash-abc123',
    );
    expect(result).toBeUndefined();
  });

  it('should record a new ledger entry', async () => {
    const record: LedgerRecord = {
      tenantId: TEST_TENANT_ID,
      itemType: 'email',
      mappingId: TEST_MAPPING_ID,
      naturalKeyHash: 'hash-abc123',
      contentHash: 'content-xyz',
      targetId: 'target-456',
      createdAt: new Date().toISOString(),
    };

    const result = await ledger.recordIfAbsent(record);
    expect(result).toBeDefined();
    expect(result.tenantId).toBe(TEST_TENANT_ID);
    expect(result.mappingId).toBe(TEST_MAPPING_ID);
    expect(result.naturalKeyHash).toBe('hash-abc123');
    expect(result.targetId).toBe('target-456');
  });

  it('should be idempotent - recordIfAbsent should not overwrite existing entries', async () => {
    const record: LedgerRecord = {
      tenantId: TEST_TENANT_ID,
      itemType: 'email',
      mappingId: TEST_MAPPING_ID,
      naturalKeyHash: 'hash-def456',
      contentHash: 'content-abc',
      targetId: 'target-789',
      createdAt: new Date().toISOString(),
    };

    const first = await ledger.recordIfAbsent(record);
    const second = await ledger.recordIfAbsent(record);

    // Should return the same record
    expect(first.naturalKeyHash).toBe(second.naturalKeyHash);
    expect(first.targetId).toBe(second.targetId);
  });

  it('should find a previously recorded entry', async () => {
    const record: LedgerRecord = {
      tenantId: TEST_TENANT_ID,
      itemType: 'email',
      mappingId: TEST_MAPPING_ID,
      naturalKeyHash: 'hash-ghi789',
      contentHash: 'content-def',
      targetId: 'target-012',
      createdAt: new Date().toISOString(),
    };

    await ledger.recordIfAbsent(record);
    const found = await ledger.find(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'email',
      'hash-ghi789',
    );

    expect(found).toBeDefined();
    expect(found?.naturalKeyHash).toBe('hash-ghi789');
    expect(found?.targetId).toBe('target-012');
  });

  it('should not find entries with different tenant or mapping', async () => {
    const record: LedgerRecord = {
      tenantId: TEST_TENANT_2_ID,
      itemType: 'email',
      mappingId: TEST_MAPPING_2_ID,
      naturalKeyHash: 'hash-jkl012',
      contentHash: 'content-ghi',
      targetId: 'target-345',
      createdAt: new Date().toISOString(),
    };

    await ledger.recordIfAbsent(record);

    // Try to find with different tenant
    const found1 = await ledger.find(
      TEST_TENANT_ID,
      TEST_MAPPING_2_ID,
      'email',
      'hash-jkl012',
    );
    expect(found1).toBeUndefined();

    // Try to find with different mapping
    const found2 = await ledger.find(
      TEST_TENANT_2_ID,
      TEST_MAPPING_ID,
      'email',
      'hash-jkl012',
    );
    expect(found2).toBeUndefined();
  });

  /**
   * `recordUpdate` — the shadow-sync update path (migration 0020).
   *
   * `recordIfAbsent` is a no-op on conflict, which is exactly right for
   * idempotency and exactly wrong for an item the source legitimately changed.
   * This is the only ledger method that overwrites, so its contract is worth
   * pinning against real Postgres rather than a fake.
   */
  describe('recordUpdate', () => {
    const base = (overrides: Partial<LedgerRecord> = {}): LedgerRecord => ({
      tenantId: TEST_TENANT_ID,
      itemType: 'calendar',
      mappingId: TEST_MAPPING_ID,
      naturalKeyHash: 'hash-update-1',
      contentHash: 'content-v1',
      targetId: 'target-v1',
      createdAt: new Date().toISOString(),
      sizeBytes: 10,
      status: 'copied',
      sourceVersion: 'etag-1',
      ...overrides,
    });

    it('overwrites content, target, size, status and source version in place', async () => {
      await ledger.recordIfAbsent(base());

      await ledger.recordUpdate(
        base({
          contentHash: 'content-v2',
          targetId: 'target-v2',
          sizeBytes: 99,
          status: 'updated',
          sourceVersion: 'etag-2',
        }),
      );

      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 'hash-update-1');
      expect(found?.contentHash).toBe('content-v2');
      expect(found?.targetId).toBe('target-v2');
      expect(found?.sizeBytes).toBe(99);
      expect(found?.status).toBe('updated');
      expect(found?.sourceVersion).toBe('etag-2');
    });

    it('keeps createdAt, which is a fact about the original copy', async () => {
      const inserted = await ledger.recordIfAbsent(base({ naturalKeyHash: 'hash-update-2' }));
      await ledger.recordUpdate(
        base({ naturalKeyHash: 'hash-update-2', contentHash: 'content-v2', sourceVersion: 'e2' }),
      );

      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 'hash-update-2');
      expect(found?.createdAt).toBe(inserted.createdAt);
    });

    it('creates nothing when there is no row — it throws instead', async () => {
      // A caller that decided an item CHANGED must already have recorded
      // copying it. Silently inserting here would hide that bug and, worse,
      // would make `recordUpdate` a second write path that bypasses the
      // idempotency contract.
      await expect(ledger.recordUpdate(base({ naturalKeyHash: 'hash-never-recorded' }))).rejects.toThrow(
        /no calendar row/,
      );
      expect(
        await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 'hash-never-recorded'),
      ).toBeUndefined();
    });

    it('will not reach across tenants', async () => {
      await ledger.recordIfAbsent(base({ naturalKeyHash: 'hash-tenant-scoped' }));
      await expect(
        ledger.recordUpdate(
          base({
            naturalKeyHash: 'hash-tenant-scoped',
            tenantId: TEST_TENANT_2_ID,
            mappingId: TEST_MAPPING_2_ID,
          }),
        ),
      ).rejects.toThrow(/no calendar row/);

      // Tenant 1's row is untouched.
      const found = await ledger.find(
        TEST_TENANT_ID,
        TEST_MAPPING_ID,
        'calendar',
        'hash-tenant-scoped',
      );
      expect(found?.contentHash).toBe('content-v1');
    });

    it('preserves what is actually on the target when an attempt fails', async () => {
      // A failed attempt wrote nothing. Overwriting `content_hash` with the
      // hash of bytes that never landed would make §20's checksum sampling
      // compare the target against content it does not hold, and overwriting
      // `source_version` would tell the next pass the update had succeeded.
      await ledger.recordIfAbsent(
        base({ naturalKeyHash: 'hash-failed-rewrite', contentHash: 'on-target-v1' }),
      );
      await ledger.recordFailure(
        base({
          naturalKeyHash: 'hash-failed-rewrite',
          contentHash: 'never-landed-v2',
          sourceVersion: 'etag-2',
        }),
        'target refused the write',
      );

      const found = await ledger.find(
        TEST_TENANT_ID,
        TEST_MAPPING_ID,
        'calendar',
        'hash-failed-rewrite',
      );
      expect(found?.contentHash).toBe('on-target-v1');
      expect(found?.sourceVersion).toBe('etag-1');
      expect(found?.status).toBe('failed');
      expect(found?.lastError).toBe('target refused the write');
    });

    it('round-trips an absent source version as absent, not as an empty string', async () => {
      // "Never recorded" and "the server sent an empty ETag" mean different
      // things to `classifyKnownItem`: the first is a backfill, the second is
      // a real value. NULL must not come back as ''.
      await ledger.recordIfAbsent(
        base({ naturalKeyHash: 'hash-no-version', sourceVersion: undefined }),
      );
      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 'hash-no-version');
      expect(found).toBeDefined();
      expect(found?.sourceVersion).toBeUndefined();
    });
  });

  /**
   * The failure queue: per-item isolation only helps if the failures are
   * durable, countable, and answerable.
   */
  describe('failure queue', () => {
    const failing = (hash: string): LedgerRecord => ({
      tenantId: TEST_TENANT_ID,
      itemType: 'file',
      mappingId: TEST_MAPPING_ID,
      naturalKeyHash: hash,
      contentHash: '',
      targetId: '',
      createdAt: new Date().toISOString(),
    });

    it('counts attempts across passes instead of no-opping', async () => {
      // `recordIfAbsent` would leave this at one attempt forever, making a
      // permanently broken item indistinguishable from one that failed once.
      await ledger.recordFailure(failing('f-attempts'), 'boom 1');
      await ledger.recordFailure(failing('f-attempts'), 'boom 2');
      const third = await ledger.recordFailure(failing('f-attempts'), 'boom 3');

      expect(third.attemptCount).toBe(3);
      expect(third.lastError).toBe('boom 3');
    });

    it('parks an item once attempts run out', async () => {
      for (let i = 0; i < MAX_ITEM_ATTEMPTS; i++) {
        await ledger.recordFailure(failing('f-parked'), 'permanently unreadable');
      }
      const [parked] = await ledger.listFailures(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(parked?.needsDecision).toBe(true);
      expect(parked?.attempts).toBe(MAX_ITEM_ATTEMPTS);
      expect(parked?.lastError).toBe('permanently unreadable');
    });

    it('retry makes it eligible again without pretending it succeeded', async () => {
      for (let i = 0; i < MAX_ITEM_ATTEMPTS; i++) {
        await ledger.recordFailure(failing('f-retry'), 'disk full');
      }
      expect(await ledger.resolveFailure(TEST_TENANT_ID, TEST_MAPPING_ID, 'f-retry', 'retry')).toBe(
        true,
      );

      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'f-retry');
      expect(found?.attemptCount).toBe(0);
      // Still failed — it has become eligible, not successful.
      expect(found?.status).toBe('failed');
      // And the reason survives, because an audit trail without the reason is
      // not an audit trail.
      expect(found?.lastError).toBe('disk full');
    });

    it('accept takes it out of the queue for good', async () => {
      await ledger.recordFailure(failing('f-accept'), 'source 404s forever');
      expect(
        await ledger.resolveFailure(TEST_TENANT_ID, TEST_MAPPING_ID, 'f-accept', 'accept'),
      ).toBe(true);

      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'f-accept');
      expect(found?.status).toBe('left_behind');
      const queue = await ledger.listFailures(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(queue.map((f) => f.naturalKeyHash)).not.toContain('f-accept');

      // Terminal: a second decision has nothing to act on.
      expect(
        await ledger.resolveFailure(TEST_TENANT_ID, TEST_MAPPING_ID, 'f-accept', 'retry'),
      ).toBe(false);
    });

    it('will not resolve across tenants', async () => {
      await ledger.recordFailure(failing('f-scoped'), 'boom');
      expect(
        await ledger.resolveFailure(TEST_TENANT_2_ID, TEST_MAPPING_2_ID, 'f-scoped', 'accept'),
      ).toBe(false);
      expect(
        (await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'f-scoped'))?.status,
      ).toBe('failed');
    });

    it('filters the queue by domain', async () => {
      await ledger.recordFailure(failing('f-file'), 'boom');
      await ledger.recordFailure({ ...failing('f-cal'), itemType: 'calendar' }, 'boom');

      const files = await ledger.listFailures(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(files.map((f) => f.naturalKeyHash)).toContain('f-file');
      expect(files.map((f) => f.naturalKeyHash)).not.toContain('f-cal');
      expect(await ledger.listFailures(TEST_TENANT_ID, TEST_MAPPING_ID)).toHaveLength(2);
    });
  });

  /**
   * The source collection on a row, and the query that reads it back.
   *
   * Against real Postgres because the last two ledger changes both passed
   * typecheck and the in-memory fake and then failed here: `ON CONFLICT DO
   * UPDATE` named a constraint Drizzle does not model, and a status default
   * silently overrode what the caller meant. `collection` has exactly that
   * shape — a NOT NULL column with a default that has swallowed every write
   * since migration 0001 — so the only convincing test is one that reads the
   * row back out of the database.
   */
  describe('source collection', () => {
    const at = (naturalKeyHash: string, collection: string, contentHash: string): LedgerRecord => ({
      tenantId: TEST_TENANT_ID,
      itemType: 'file',
      mappingId: TEST_MAPPING_ID,
      naturalKeyHash,
      contentHash,
      targetId: `t-${naturalKeyHash}`,
      createdAt: new Date().toISOString(),
      sizeBytes: 10,
      status: 'copied',
      collection,
    });

    it('persists what the caller passed instead of the column default', async () => {
      await ledger.recordIfAbsent(at('c-1', 'Documents/2026', 'h1'));
      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'c-1');
      expect(found?.collection).toBe('Documents/2026');
    });

    it('reports a row with no collection as unrecorded, not as the empty folder', async () => {
      // Every row written before this change is in that state. The distinction
      // is what keeps the first pass after an upgrade from declaring an entire
      // migrated corpus moved.
      await ledger.recordIfAbsent({ ...at('c-2', '', 'h2') });
      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'c-2');
      expect(found?.collection).toBeUndefined();
    });

    it('carries the collection through an update', async () => {
      await ledger.recordIfAbsent(at('c-3', 'Old', 'h3'));
      await ledger.recordUpdate(at('c-3', 'New', 'h3b'));
      const found = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'c-3');
      expect(found?.collection).toBe('New');
    });

    it('lists every placed item with the collection and hash move detection needs', async () => {
      await ledger.recordIfAbsent(at('c-4', 'Photos', 'h4'));
      await ledger.recordIfAbsent(at('c-5', 'Photos', 'h5'));
      await ledger.recordIfAbsent(at('c-6', 'Invoices', 'h6'));

      const placed = await ledger.placedItems(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(placed.map((r) => r.naturalKeyHash).sort()).toEqual(['c-4', 'c-5', 'c-6']);
      const four = placed.find((r) => r.naturalKeyHash === 'c-4');
      expect(four?.contentHash).toBe('h4');
      // Whole-domain, not per-collection, precisely so a folder the source no
      // longer lists at all — a rename — still has its rows examined.
      expect(four?.collection).toBe('Photos');
      expect(placed.find((r) => r.naturalKeyHash === 'c-6')?.collection).toBe('Invoices');
    });

    it('omits rows for items that are not actually on the target', async () => {
      // A `failed` or `left_behind` row means nothing was placed. Returning
      // them would make their absence from a later listing look like a move,
      // which would report a file that never migrated as having been relocated.
      await ledger.recordIfAbsent(at('c-7', 'Photos', 'h7'));
      await ledger.recordFailure(at('c-8', 'Photos', 'h8'), 'source 500');
      await ledger.recordFailure(at('c-9', 'Photos', 'h9'), 'source 500');
      await ledger.resolveFailure(TEST_TENANT_ID, TEST_MAPPING_ID, 'c-9', 'accept');

      const placed = await ledger.placedItems(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(placed.map((r) => r.naturalKeyHash)).toEqual(['c-7']);
    });

    it('omits rows that never recorded a collection', async () => {
      // Every row written before the column was populated. They cannot say
      // where the item came from, and including them would report an entire
      // legacy corpus as vanished on the first full scan after upgrading.
      await ledger.recordIfAbsent(at('c-legacy', '', 'h-legacy'));
      await ledger.recordIfAbsent(at('c-current', 'Photos', 'h-current'));

      const placed = await ledger.placedItems(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(placed.map((r) => r.naturalKeyHash)).toEqual(['c-current']);
    });

    it('records where the source moved an item to, without touching where we put it', async () => {
      await ledger.recordIfAbsent(at('m-1', 'Q1', 'h1'));
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-1', 'Quarter-1');

      const row = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-1');
      // `collection` still says where the TARGET's copy is, because that is the
      // only place it is. Overwriting it would make the ledger describe a
      // target that does not exist.
      expect(row?.collection).toBe('Q1');
      expect(row?.movedToCollection).toBe('Quarter-1');
      expect(row?.moveAcknowledgedAt).toBeUndefined();
    });

    it('keeps a decision standing when a later pass sees the same move again', async () => {
      // The queue has to be emptyable. Reopening on every pass would make it
      // permanent noise, and a queue that never empties is one people stop
      // reading — which is how a real divergence goes unnoticed.
      await ledger.recordIfAbsent(at('m-2', 'Q1', 'h2'));
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-2', 'Quarter-1');
      expect(await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-2', 'keep')).toBe(true);

      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-2', 'Quarter-1');
      const row = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-2');
      expect(row?.moveAcknowledgedAt).toBeDefined();
    });

    it('asks again when the destination changes', async () => {
      // Agreeing to one arrangement is not agreeing to every later one. This is
      // the CASE ... IS DISTINCT FROM in recordMove, which no in-memory fake
      // can vouch for.
      await ledger.recordIfAbsent(at('m-3', 'Q1', 'h3'));
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-3', 'Quarter-1');
      await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-3', 'keep');

      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-3', 'Archive');
      const row = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-3');
      expect(row?.movedToCollection).toBe('Archive');
      expect(row?.moveAcknowledgedAt).toBeUndefined();
    });

    it('forgets the move, decision and all, when the item is put back', async () => {
      await ledger.recordIfAbsent(at('m-4', 'Q1', 'h4'));
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-4', 'Quarter-1');
      await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-4', 'keep');

      await ledger.clearMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-4');
      const row = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-4');
      expect(row?.movedToCollection).toBeUndefined();
      // The acknowledgement goes with it: a stale one would quietly suppress
      // the NEXT move to the same place.
      expect(row?.moveAcknowledgedAt).toBeUndefined();
      expect(await ledger.listMoves(TEST_TENANT_ID, TEST_MAPPING_ID, 'file')).toEqual([]);
    });

    it('lists open moves ahead of decided ones, and only moved rows at all', async () => {
      await ledger.recordIfAbsent(at('m-5', 'Q1', 'h5'));
      await ledger.recordIfAbsent(at('m-6', 'Q1', 'h6'));
      await ledger.recordIfAbsent(at('m-7', 'Q1', 'h7'));
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-5', 'Quarter-1');
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-6', 'Quarter-1');
      await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-5', 'keep');

      const moves = await ledger.listMoves(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      // m-7 never moved and must not appear at all.
      expect(moves.map((mv) => mv.naturalKeyHash)).toEqual(['m-6', 'm-5']);
      expect(moves[0]).toMatchObject({ from: 'Q1', to: 'Quarter-1' });
      expect(moves[0]!.acknowledgedAt).toBeUndefined();
      expect(moves[1]!.acknowledgedAt).toBeDefined();
    });

    it('will not acknowledge a move that is not open', async () => {
      await ledger.recordIfAbsent(at('m-8', 'Q1', 'h8'));
      // Never moved.
      expect(await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-8', 'keep')).toBe(false);

      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-8', 'Quarter-1');
      expect(await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-8', 'keep')).toBe(true);
      // Twice is not a second decision, and must not move the audit date on.
      expect(await ledger.resolveMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'm-8', 'keep')).toBe(false);
    });

    it('will not let one tenant decide about another\'s move', async () => {
      await ledger.recordIfAbsent(at('m-9', 'Q1', 'h9'));
      await ledger.recordMove(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-9', 'Quarter-1');
      expect(await ledger.resolveMove(TEST_TENANT_2_ID, TEST_MAPPING_2_ID, 'm-9', 'keep')).toBe(
        false,
      );
      expect(
        (await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'm-9'))?.moveAcknowledgedAt,
      ).toBeUndefined();
    });

    it('counts consecutive absences and confirms only past the threshold', async () => {
      await ledger.recordIfAbsent(at('d-1', 'Q1', 'hd1'));
      expect(await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-1')).toBe(1);

      let queue = await ledger.listDeletions(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(queue[0]).toMatchObject({ absentPasses: 1, confirmed: false, collection: 'Q1' });

      expect(await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-1')).toBe(2);
      queue = await ledger.listDeletions(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(queue[0]).toMatchObject({ absentPasses: 2, confirmed: true });
    });

    it('resets the run — and any decision — when the item reappears', async () => {
      await ledger.recordIfAbsent(at('d-2', 'Q1', 'hd2'));
      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-2');
      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-2');
      await ledger.resolveDeletion(TEST_TENANT_ID, TEST_MAPPING_ID, 'd-2', 'keep');

      await ledger.clearAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-2');

      expect(await ledger.listDeletions(TEST_TENANT_ID, TEST_MAPPING_ID, 'file')).toEqual([]);
      // The acknowledgement goes with the count: a stale one would silently
      // suppress the report the NEXT time this item vanishes.
      const row = await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-2');
      expect(row?.absentPasses).toBe(0);
      expect(row?.deletionAcknowledgedAt).toBeUndefined();
      // And the run starts again from one, not from three.
      expect(await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-2')).toBe(1);
    });

    it('will not let anyone decide about an absence that is only being watched', async () => {
      await ledger.recordIfAbsent(at('d-3', 'Q1', 'hd3'));
      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-3');
      // One absence: watched, not confirmed. Closing it early would retire the
      // check that makes the claim trustworthy.
      expect(await ledger.resolveDeletion(TEST_TENANT_ID, TEST_MAPPING_ID, 'd-3', 'keep')).toBe(
        false,
      );

      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-3');
      expect(await ledger.resolveDeletion(TEST_TENANT_ID, TEST_MAPPING_ID, 'd-3', 'keep')).toBe(
        true,
      );
      // Twice is not a second decision.
      expect(await ledger.resolveDeletion(TEST_TENANT_ID, TEST_MAPPING_ID, 'd-3', 'keep')).toBe(
        false,
      );
    });

    it('lists open disappearances ahead of decided ones, longest-missing first', async () => {
      await ledger.recordIfAbsent(at('d-4', 'Q1', 'hd4'));
      await ledger.recordIfAbsent(at('d-5', 'Q1', 'hd5'));
      await ledger.recordIfAbsent(at('d-6', 'Q1', 'hd6'));
      for (const k of ['d-4', 'd-5']) {
        await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', k);
        await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', k);
      }
      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-5');
      await ledger.resolveDeletion(TEST_TENANT_ID, TEST_MAPPING_ID, 'd-4', 'keep');

      const queue = await ledger.listDeletions(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      // d-6 never vanished and must not appear at all. d-5 is open, so it comes
      // before the decided d-4 — NULLS FIRST spelled out, because Postgres reads
      // ASC as NULLS LAST and 0022 shipped exactly that bug.
      expect(queue.map((d) => d.naturalKeyHash)).toEqual(['d-5', 'd-4']);
      expect(queue[0]!.acknowledgedAt).toBeUndefined();
      expect(queue[1]!.acknowledgedAt).toBeDefined();
    });

    it('will not let one tenant decide about another\'s disappearance', async () => {
      await ledger.recordIfAbsent(at('d-7', 'Q1', 'hd7'));
      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-7');
      await ledger.recordAbsent(TEST_TENANT_ID, TEST_MAPPING_ID, 'file', 'd-7');
      expect(
        await ledger.resolveDeletion(TEST_TENANT_2_ID, TEST_MAPPING_2_ID, 'd-7', 'keep'),
      ).toBe(false);
    });

    it('records the source href and finds the row by it', async () => {
      // The bridge a removal report walks across. RFC 6578 `sync-collection`
      // reports a deleted object as its href and nothing else — no body, so no
      // UID, so no natural key — and this lookup is the only way back.
      await ledger.recordIfAbsent({
        ...at('s-1', 'personal', 'hs1'),
        itemType: 'calendar',
        sourceRef: '/calendars/alice/personal/evt-1.ics',
      });

      const found = await ledger.findBySourceRef(
        TEST_TENANT_ID,
        TEST_MAPPING_ID,
        'calendar',
        '/calendars/alice/personal/evt-1.ics',
      );
      expect(found?.naturalKeyHash).toBe('s-1');
      // And it round-trips on the row itself, not just through the lookup.
      expect(
        (await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 's-1'))?.sourceRef,
      ).toBe('/calendars/alice/personal/evt-1.ics');
    });

    it('never matches a row that recorded no href', async () => {
      // Every row written before migration 0025 carries `{}`. Matching the empty
      // string against those would attach a removal report to whichever old row
      // came first — the wrong item, reported as deleted.
      await ledger.recordIfAbsent({ ...at('s-2', 'personal', 'hs2'), itemType: 'calendar' });

      expect(
        await ledger.findBySourceRef(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', ''),
      ).toBeUndefined();
      expect(
        (await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 's-2'))?.sourceRef,
      ).toBeUndefined();
    });

    it('keeps the href through an update, and does not blank it', async () => {
      // Conditional in the SET clause, like `collection`: the column is NOT NULL
      // with a `{}` default meaning "not recorded", so a caller with nothing to
      // say must not retire the item's removal-report link.
      await ledger.recordIfAbsent({
        ...at('s-3', 'personal', 'hs3'),
        itemType: 'calendar',
        sourceRef: '/calendars/alice/personal/evt-3.ics',
      });
      await ledger.recordUpdate({ ...at('s-3', 'personal', 'hs3b'), itemType: 'calendar' });

      expect(
        (await ledger.find(TEST_TENANT_ID, TEST_MAPPING_ID, 'calendar', 's-3'))?.sourceRef,
      ).toBe('/calendars/alice/personal/evt-3.ics');
    });

    it('does not match an href across domains or tenants', async () => {
      const href = '/shared/collision.ics';
      await ledger.recordIfAbsent({ ...at('s-4', 'personal', 'hs4'), itemType: 'calendar', sourceRef: href });

      expect(
        await ledger.findBySourceRef(TEST_TENANT_ID, TEST_MAPPING_ID, 'contact', href),
      ).toBeUndefined();
      expect(
        await ledger.findBySourceRef(TEST_TENANT_2_ID, TEST_MAPPING_2_ID, 'calendar', href),
      ).toBeUndefined();
    });

    it('does not cross domains, mappings or tenants', async () => {
      await ledger.recordIfAbsent(at('c-10', 'Shared', 'h10'));
      await ledger.recordIfAbsent({ ...at('c-11', 'Shared', 'h11'), itemType: 'calendar' });

      const files = await ledger.placedItems(TEST_TENANT_ID, TEST_MAPPING_ID, 'file');
      expect(files.map((r) => r.naturalKeyHash)).toEqual(['c-10']);
      expect(await ledger.placedItems(TEST_TENANT_2_ID, TEST_MAPPING_2_ID, 'file')).toEqual([]);
    });
  });
});

describe('PgCursorStore (integration)', () => {
  let cursorStore: PgCursorStore;
  let db: PgDatabase;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    cursorStore = new PgCursorStore(db);

    // Create test data (tenant, connection, mailbox, mapping)
    // Insert tenant
    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TEST_TENANT_ID}, 'Test Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert source connection
    const sourceConnId = '5a0b0000-e29b-41d4-a716-446655440001';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${TEST_TENANT_ID}, 'source', 'imap', 'IMAP Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert target connection
    const targetConnId = '5a0b0000-e29b-41d4-a716-446655440002';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${TEST_TENANT_ID}, 'target', 'imap', 'IMAP Target', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert source mailbox
    const sourceMailboxId = '5a0b0000-e29b-41d4-a716-446655440001';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TEST_TENANT_ID}, ${sourceConnId}, 'source@dev.local', 'user', 'Source Mailbox', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert target mailbox
    const targetMailboxId = '5a0b0000-e29b-41d4-a716-446655440002';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TEST_TENANT_ID}, ${targetConnId}, 'target@dev.local', 'user', 'Target Mailbox', 'active')
      ON CONFLICT (id) DO NOTHING
    `);

    // Insert mailbox mapping
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${TEST_MAPPING_ID}, ${TEST_TENANT_ID}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    // Clean up cursor data before each test
    await db.execute(sql`DELETE FROM cursor WHERE tenant_id = ${TEST_TENANT_ID}`);
  });

  it('should return undefined for non-existent cursor', async () => {
    const result = await cursorStore.get(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'INBOX',
    );
    expect(result).toBeUndefined();
  });

  it('should set and get a cursor', async () => {
    const cursor = { value: '12345:67890' };

    await cursorStore.set(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'INBOX',
      cursor,
    );

    const result = await cursorStore.get(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'INBOX',
    );

    expect(result).toBeDefined();
    expect(result?.value).toBe('12345:67890');
  });

  it('should update an existing cursor', async () => {
    const cursor1 = { value: '11111:22222' };
    const cursor2 = { value: '33333:44444' };

    await cursorStore.set(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'Sent',
      cursor1,
    );

    await cursorStore.set(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'Sent',
      cursor2,
    );

    const result = await cursorStore.get(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'Sent',
    );

    expect(result).toBeDefined();
    expect(result?.value).toBe('33333:44444');
  });

  it('should maintain separate cursors for different folders', async () => {
    const cursor1 = { value: 'folder1:100' };
    const cursor2 = { value: 'folder2:200' };

    await cursorStore.set(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'INBOX',
      cursor1,
    );

    await cursorStore.set(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'Sent',
      cursor2,
    );

    const inboxCursor = await cursorStore.get(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'INBOX',
    );
    const sentCursor = await cursorStore.get(
      TEST_TENANT_ID,
      TEST_MAPPING_ID,
      'Sent',
    );

    expect(inboxCursor?.value).toBe('folder1:100');
    expect(sentCursor?.value).toBe('folder2:200');
  });
});
