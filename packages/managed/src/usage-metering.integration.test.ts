// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Usage Metering Integration Tests
 * 
 * Tests for the hybrid usage metering approach:
 * - Storage/Egress: Derive-at-read from item ledger
 * - Compute/API calls: Idempotent upsert from job runs
 * 
 * Security: All tests use withTenant for RLS enforcement.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createPgDb } from '@openmig/ledger/db';
import {
  deriveStorageAndEgressForPeriod,
  deriveComputeForPeriod,
  getUsageMetricsForPeriod,
  BILLABLE_RUN_KINDS,
} from './usage-metering.ts';
import {
  tenant as tenantTable,
  connection as connectionTable,
  mailbox as mailboxTable,
  mailboxMapping as mailboxMappingTable,
  item as itemTable,
  migrationStatus as migrationStatusTable,
  run as runTable,
} from '@openmig/ledger/schema-pg';
import { usageMetric as usageMetricTable } from './schema-managed.ts';
import type { TenantId, MappingId } from '@openmig/shared';
import { randomUUID } from 'crypto';

// Connection string from Testcontainers
const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
    'Run: pnpm test:integration'
  );
}

const _PRICING = {
  computePricePerHour: 5,
};

// Fixed UUIDs for testing - namespace 5a0c for usage-metering.integration.test.ts
const TEST_TENANT_ID = '5a0c0000-e29b-41d4-a716-446655440001' as never as TenantId;
const TEST_TENANT_2_ID = '5a0c0000-e29b-41d4-a716-446655440002' as never as TenantId;
const TEST_MAPPING_ID = '5a0c0000-e29b-41d4-a716-446655440003' as never as MappingId;

describe('Usage Metering - Integration', () => {
  let db: ReturnType<typeof createPgDb>;

  beforeAll(() => {
    db = createPgDb(PG_CONNECTION_STRING);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await db.delete(usageMetricTable);
    await db.delete(runTable);
    await db.delete(itemTable);
    await db.delete(migrationStatusTable);
    await db.delete(mailboxMappingTable);
    await db.delete(mailboxTable);
    await db.delete(connectionTable);
    await db.delete(tenantTable);
  });

  /**
   * Helper to create a complete test fixture with tenant, connections, mailboxes, and mapping
   */
  async function createFixture(tenantId: TenantId, mappingId: MappingId) {
    await db.insert(tenantTable).values({
      id: tenantId,
      name: `t4-test-${tenantId}`,
      status: 'active',
    });

    const sourceConn = (await db.insert(connectionTable).values({
      tenantId,
      role: 'source',
      kind: 'o365',
      displayName: 'Source',
      config: {},
    }).returning())[0]!;

    const targetConn = (await db.insert(connectionTable).values({
      tenantId,
      role: 'target',
      kind: 'imap',
      displayName: 'Target',
      config: {},
    }).returning())[0]!;

    const sourceMailboxId = randomUUID() as never;
    const targetMailboxId = randomUUID() as never;
    
    await db.insert(mailboxTable).values([
      {
        id: sourceMailboxId,
        tenantId,
        connectionId: sourceConn.id,
        displayName: 'Source Inbox',
        kind: 'user',
      },
      {
        id: targetMailboxId,
        tenantId,
        connectionId: targetConn.id,
        displayName: 'Target Inbox',
        kind: 'user',
      },
    ]);

    await db.insert(mailboxMappingTable).values({
      id: mappingId,
      tenantId,
      sourceMailboxId,
      targetMailboxId,
      status: 'active',
    });

    return { sourceConn, targetConn };
  }

  describe('Storage/Egress derivation', () => {
    it('should derive correct storage and egress from item ledger', async () => {
      await createFixture(TEST_TENANT_ID, TEST_MAPPING_ID);

      // Create items with known sizes and lastSyncedAt
      const testDate = new Date('2026-07-15T10:00:00Z');
      await db.insert(itemTable).values([
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-1',
          naturalKeyHash: 'hash1',
          sizeBytes: 1024n,
          status: 'copied',
          lastSyncedAt: testDate,
        },
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-2',
          naturalKeyHash: 'hash2',
          sizeBytes: 2048n,
          status: 'copied',
          lastSyncedAt: testDate,
        },
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-3',
          naturalKeyHash: 'hash3',
          sizeBytes: 512n,
          status: 'copied',
          lastSyncedAt: testDate,
        },
      ]);

      // Derive usage for the period
      const result = await deriveStorageAndEgressForPeriod(
        db,
        TEST_TENANT_ID,
        '2026-07-01',
        '2026-07-31'
      );

      expect(result.storageBytes).toBe(3584); // 1024 + 2048 + 512
      expect(result.egressBytes).toBe(3584); // Same as storage
    });

    it('should exclude items outside the billing period', async () => {
      await createFixture(TEST_TENANT_ID, TEST_MAPPING_ID);

      // Items in different periods
      await db.insert(itemTable).values([
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-june',
          naturalKeyHash: 'hash-june',
          sizeBytes: 1000n,
          status: 'copied',
          lastSyncedAt: new Date('2026-06-15T10:00:00Z'), // Before period
        },
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'InBox',
          naturalKey: 'msg-july',
          naturalKeyHash: 'hash-july',
          sizeBytes: 2000n,
          status: 'copied',
          lastSyncedAt: new Date('2026-07-15T10:00:00Z'), // In period
        },
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-aug',
          naturalKeyHash: 'hash-aug',
          sizeBytes: 3000n,
          status: 'copied',
          lastSyncedAt: new Date('2026-08-15T10:00:00Z'), // After period
        },
      ]);

      const result = await deriveStorageAndEgressForPeriod(
        db,
        TEST_TENANT_ID,
        '2026-07-01',
        '2026-07-31'
      );

      expect(result.storageBytes).toBe(2000); // Only July item
      expect(result.egressBytes).toBe(2000);
    });

    it('should handle null lastSyncedAt (exclude from counts)', async () => {
      await createFixture(TEST_TENANT_ID, TEST_MAPPING_ID);

      await db.insert(itemTable).values([
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-synced',
          naturalKeyHash: 'hash-synced',
          sizeBytes: 1000n,
          status: 'copied',
          lastSyncedAt: new Date('2026-07-15T10:00:00Z'),
        },
        {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          collection: 'Inbox',
          naturalKey: 'msg-not-synced',
          naturalKeyHash: 'hash-not-synced',
          sizeBytes: 5000n,
          status: 'pending',
          lastSyncedAt: null, // Not synced yet
        },
      ]);

      const result = await deriveStorageAndEgressForPeriod(
        db,
        TEST_TENANT_ID,
        '2026-07-01',
        '2026-07-31'
      );

      expect(result.storageBytes).toBe(1000); // Only synced item
      expect(result.egressBytes).toBe(1000);
    });

    it('should return zeros for empty set', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-empty',
        status: 'active',
      });

      const result = await deriveStorageAndEgressForPeriod(
        db,
        TEST_TENANT_ID,
        '2026-07-01',
        '2026-07-31'
      );

      expect(result.storageBytes).toBe(0);
      expect(result.egressBytes).toBe(0);
    });
  });

  /**
   * Compute, DERIVED from the run ledger. Nothing is written.
   *
   * These are the same properties 0121's per-pass rows were built to satisfy —
   * a period with more than one pass in it sums, a retry does not double —
   * asserted against a mechanism that stores nothing. That is deliberate: they
   * were the specification the derivation had to meet, so they survive the
   * change that replaced the thing they were written for.
   */
  describe('Compute derived from the run ledger', () => {
    const PERIOD_START = '2026-07-01';
    const PERIOD_END = '2026-07-31';

    /** One closed run of `seconds`, `dayOfMonth` days into the period. */
    async function seedRun(
      tenantId: TenantId,
      opts: {
        seconds: number;
        dayOfMonth?: number;
        kind?: string;
        finished?: boolean;
        domainSeconds?: Record<string, number>;
      },
    ) {
      const startedAt = new Date(Date.UTC(2026, 6, opts.dayOfMonth ?? 15, 10, 0, 0));
      await db.insert(runTable).values({
        tenantId,
        mappingId: TEST_MAPPING_ID,
        kind: (opts.kind ?? 'incremental') as 'incremental',
        trigger: 'schedule',
        status: 'succeeded',
        stats: opts.domainSeconds ? { domainSeconds: opts.domainSeconds } : {},
        startedAt,
        createdAt: startedAt,
        finishedAt:
          opts.finished === false ? null : new Date(startedAt.getTime() + opts.seconds * 1000),
      });
    }

    beforeEach(async () => {
      await createFixture(TEST_TENANT_ID, TEST_MAPPING_ID);
    });

    it('adds every pass in the period, rather than reporting the last one', async () => {
      await seedRun(TEST_TENANT_ID, { seconds: 3600, dayOfMonth: 15 });
      await seedRun(TEST_TENANT_ID, { seconds: 7200, dayOfMonth: 16 });

      const usage = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      // The defect 0121 fixed, restated against the derivation: this read 2.
      expect(usage.computeHours).toBeCloseTo(3, 6);
      expect(usage.passCount).toBe(2);
    });

    it('counts a pass once however often the task retried, because nothing is written', async () => {
      // A Trigger.dev retry re-enters the SAME task run and closes the SAME
      // run row. Idempotency is structural here: there is no second row to
      // add, and no upsert whose key could be got wrong.
      await seedRun(TEST_TENANT_ID, { seconds: 1800 });

      const first = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      const second = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(second).toEqual(first);
      expect(second.passCount).toBe(1);
    });

    it('bills the initial copy, which the old meter never wrote a row for', async () => {
      // run-full-sync opens `initial_copy` runs and never called either meter,
      // so the biggest compute of a migration was charged at zero.
      await seedRun(TEST_TENANT_ID, { seconds: 3600, kind: 'initial_copy', dayOfMonth: 2 });
      await seedRun(TEST_TENANT_ID, { seconds: 3600, kind: 'incremental', dayOfMonth: 3 });

      const usage = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(usage.computeHours).toBeCloseTo(2, 6);
      expect(BILLABLE_RUN_KINDS).toContain('initial_copy');
    });

    it('ignores a pass that never closed', async () => {
      // Killed outright: no finished_at. The upsert only ever metered on the
      // success path, so this bills nothing now that was billed before.
      await seedRun(TEST_TENANT_ID, { seconds: 3600, finished: false });

      const usage = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(usage.computeHours).toBe(0);
      expect(usage.passCount).toBe(0);
    });

    it('counts the last day of the period', async () => {
      // `periodEnd` is a DATE, so `<= periodEnd` is midnight and drops the
      // whole of the 31st. The window is half-open on purpose.
      await seedRun(TEST_TENANT_ID, { seconds: 3600, dayOfMonth: 31 });

      const usage = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(usage.passCount).toBe(1);
    });

    it('excludes a pass outside the period', async () => {
      await db.insert(runTable).values({
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        kind: 'incremental',
        trigger: 'schedule',
        status: 'succeeded',
        stats: {},
        startedAt: new Date('2026-08-01T10:00:00Z'),
        createdAt: new Date('2026-08-01T10:00:00Z'),
        finishedAt: new Date('2026-08-01T11:00:00Z'),
      });

      const usage = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(usage.passCount).toBe(0);
    });

    it('keeps the per-domain split, summed across passes, at no extra rows', async () => {
      await seedRun(TEST_TENANT_ID, {
        seconds: 100,
        dayOfMonth: 10,
        domainSeconds: { email: 60, calendar: 40 },
      });
      await seedRun(TEST_TENANT_ID, {
        seconds: 50,
        dayOfMonth: 11,
        domainSeconds: { email: 30, file: 20 },
      });

      const usage = await deriveComputeForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(usage.byDomain).toEqual({ email: 90, calendar: 40, file: 20 });

      // And the whole point: not one row was written to do it.
      const written = await db.select().from(usageMetricTable);
      expect(written).toHaveLength(0);
    });

    it('is what the read model serves for compute and sync operations', async () => {
      await seedRun(TEST_TENANT_ID, { seconds: 3600, dayOfMonth: 5 });
      await seedRun(TEST_TENANT_ID, { seconds: 3600, dayOfMonth: 6 });

      const usage = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, PERIOD_START, PERIOD_END);
      expect(usage.computeHours).toBeCloseTo(2, 6);
      expect(usage.apiCallCount).toBe(2);
    });
  });

  describe('Cross-tenant isolation', () => {
    it('should not expose tenant B usage to tenant A', async () => {
      await db.insert(tenantTable).values([
        { id: TEST_TENANT_ID, name: 't4-tenant-a', status: 'active' },
        { id: TEST_TENANT_2_ID, name: 't4-tenant-b', status: 'active' },
      ]);

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      const startedAt = new Date('2026-07-15T10:00:00Z');

      // Two hours of compute, for tenant B only. `mappingId` is null: the
      // billing window is (tenant, period), and RLS is what this is about.
      await db.insert(runTable).values({
        tenantId: TEST_TENANT_2_ID,
        mappingId: null,
        kind: 'incremental',
        trigger: 'schedule',
        status: 'succeeded',
        stats: {},
        startedAt,
        createdAt: startedAt,
        finishedAt: new Date('2026-07-15T12:00:00Z'),
      });

      const usageA = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usageA.computeHours).toBe(0);
      expect(usageA.storageBytes).toBe(0);

      const usageB = await getUsageMetricsForPeriod(db, TEST_TENANT_2_ID, periodStart, periodEnd);
      expect(usageB.computeHours).toBeCloseTo(2, 6);
    });
  });
});
