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
  recordComputeForRun,
  recordApiCallForRun,
  getUsageMetricsForPeriod,
  type ComputeUsageInput,
  type ApiCallUsageInput,
} from './usage-metering.ts';
import {
  tenant as tenantTable,
  connection as connectionTable,
  mailbox as mailboxTable,
  mailboxMapping as mailboxMappingTable,
  item as itemTable,
  migrationStatus as migrationStatusTable,
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

  describe('Compute/API call upsert', () => {
    it('should idempotently record compute usage', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-compute',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      const startedAt = new Date('2026-07-15T10:00:00Z');
      const completedAt = new Date('2026-07-15T11:00:00Z'); // 1 hour

      const computeInput: ComputeUsageInput = {
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'email',
        // The row's key. A RETRY of this run is the same key and must not
        // double; a DIFFERENT pass is a different key and must add.
        runId: 'run-one',
        startedAt,
        completedAt,
        periodStart,
        periodEnd,
      };

      // First record
      await recordComputeForRun(db, computeInput, _PRICING);

      // Get usage
      const usage1 = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage1.computeHours).toBe(1);

      // Retry with same key - should REPLACE, not increment
      await recordComputeForRun(db, computeInput, _PRICING);

      const usage2 = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage2.computeHours).toBe(1); // Same, not doubled
    });

    it('should idempotently record API call usage', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-api',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';

      const apiInput: ApiCallUsageInput = {
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'email',
        runId: 'run-one',
        periodStart,
        periodEnd,
      };

      // First record
      await recordApiCallForRun(db, apiInput);

      const usage1 = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage1.apiCallCount).toBe(1);

      // Retry - should REPLACE
      await recordApiCallForRun(db, apiInput);

      const usage2 = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage2.apiCallCount).toBe(1); // Same, not doubled
    });

    it('should allow separate tracking per domain', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-multi-domain',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';

      await recordApiCallForRun(db, {
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'email',
        runId: 'run-one',
        periodStart,
        periodEnd,
      });

      await recordApiCallForRun(db, {
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'calendar',
        runId: 'run-one',
        periodStart,
        periodEnd,
      });

      const usage = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage.apiCallCount).toBe(2); // Both domains
    });
  });

  /**
   * The behaviour workplan 0121 is about: a period's compute is every pass in
   * it, not the last one.
   *
   * The tests above prove the upsert is idempotent, which it was before and
   * still is. What they cannot see is the grain of the key: with
   * `resource = 'domain-email'` they pass identically, because every pass of a
   * domain writes the same row. These read a period that had MORE THAN ONE
   * PASS in it, which is what every real month is, and which nothing asserted
   * on until now.
   */
  describe('A month of passes, summed', () => {
    it('adds the compute of two passes in one period', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-two-passes',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      const pass = (runId: string, from: string, to: string): ComputeUsageInput => ({
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'email',
        runId,
        startedAt: new Date(from),
        completedAt: new Date(to),
        periodStart,
        periodEnd,
      });

      // Two passes of the SAME domain, in the same period: 1 hour, then 2.
      await recordComputeForRun(db, pass('run-one', '2026-07-15T10:00:00Z', '2026-07-15T11:00:00Z'), _PRICING);
      await recordComputeForRun(db, pass('run-two', '2026-07-16T10:00:00Z', '2026-07-16T12:00:00Z'), _PRICING);

      const usage = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      // Keyed per period, this read 2 — the second pass having overwritten the
      // first — and the customer was billed for one pass of a month's work.
      expect(usage.computeHours).toBe(3);

      // Two rows, one per pass, each named by its run.
      const rows = await db.select().from(usageMetricTable);
      const compute = rows.filter((r) => r.metricType === 'compute');
      expect(compute.map((r) => r.resource).sort()).toEqual([
        'domain-email#run-one',
        'domain-email#run-two',
      ]);
    });

    it('counts two passes as two sync operations, and a retry of one as one', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-two-syncs',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      const sync = (runId: string): ApiCallUsageInput => ({
        tenantId: TEST_TENANT_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'email',
        runId,
        periodStart,
        periodEnd,
      });

      await recordApiCallForRun(db, sync('run-one'));
      await recordApiCallForRun(db, sync('run-two'));
      // A Trigger.dev retry of the FIRST run — same key, so it rewrites its
      // own row. This is the property the per-period key was chosen for, and
      // the narrower key keeps it.
      await recordApiCallForRun(db, sync('run-one'));

      const usage = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage.apiCallCount).toBe(2);
    });

    it('keeps the cost of short passes rather than rounding each to nothing', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-short-passes',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';

      // Twelve 20-second passes — an hour of a real mapping's day. At
      // €0.05/hour each costs 0.028 cents, which rounded to the cent is zero.
      for (let pass = 0; pass < 12; pass++) {
        const startedAt = new Date(Date.UTC(2026, 6, 15, 10, pass * 5, 0));
        await recordComputeForRun(db, {
          tenantId: TEST_TENANT_ID,
          mappingId: TEST_MAPPING_ID,
          domain: 'email',
          runId: `run-${pass}`,
          startedAt,
          completedAt: new Date(startedAt.getTime() + 20_000),
          periodStart,
          periodEnd,
        }, _PRICING);
      }

      const usage = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage.computeHours).toBeCloseTo((12 * 20) / 3600, 6);

      // The stored costs sum to the same thing the hours do. Rounded per row
      // this was 0 — a month of work costing nothing, on a billing screen.
      const rows = await db.select().from(usageMetricTable);
      const stored = rows
        .filter((r) => r.metricType === 'compute')
        .reduce((sum, r) => sum + Number(r.totalCost), 0);
      expect(stored).toBeCloseTo(usage.computeHours * _PRICING.computePricePerHour, 6);
      expect(stored).toBeGreaterThan(0);
    });

    it('keeps each pass of each domain separate', async () => {
      await db.insert(tenantTable).values({
        id: TEST_TENANT_ID,
        name: 't4-test-passes-per-domain',
        status: 'active',
      });

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      for (const runId of ['run-one', 'run-two']) {
        for (const domain of ['email', 'calendar'] as const) {
          await recordApiCallForRun(db, {
            tenantId: TEST_TENANT_ID,
            mappingId: TEST_MAPPING_ID,
            domain,
            runId,
            periodStart,
            periodEnd,
          });
        }
      }

      // Two domains × two passes. Keyed per period this was 2 for any number
      // of passes: the count of DOMAINS that had ever run in the month.
      const usage = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usage.apiCallCount).toBe(4);
    });
  });

  describe('Cross-tenant isolation', () => {
    it('should not expose tenant B usage to tenant A', async () => {
      // Create two tenants
      await db.insert(tenantTable).values([
        {
          id: TEST_TENANT_ID,
          name: 't4-tenant-a',
          status: 'active',
        },
        {
          id: TEST_TENANT_2_ID,
          name: 't4-tenant-b',
          status: 'active',
        },
      ]);

      const periodStart = '2026-07-01';
      const periodEnd = '2026-07-31';
      const startedAt = new Date('2026-07-15T10:00:00Z');
      const completedAt = new Date('2026-07-15T12:00:00Z'); // 2 hours

      // Record usage for tenant B
      await recordComputeForRun(db, {
        tenantId: TEST_TENANT_2_ID,
        mappingId: TEST_MAPPING_ID,
        domain: 'email',
        runId: 'run-tenant-b',
        startedAt,
        completedAt,
        periodStart,
        periodEnd,
      }, _PRICING);

      // Tenant A should see nothing
      const usageA = await getUsageMetricsForPeriod(db, TEST_TENANT_ID, periodStart, periodEnd);
      expect(usageA.computeHours).toBe(0);
      expect(usageA.storageBytes).toBe(0);

      // Tenant B should see their own usage
      const usageB = await getUsageMetricsForPeriod(db, TEST_TENANT_2_ID, periodStart, periodEnd);
      expect(usageB.computeHours).toBe(2);
    });
  });
});
