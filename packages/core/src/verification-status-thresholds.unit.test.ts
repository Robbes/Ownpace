// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The three independent conditions that FAIL the §20 cutover gate.
 *
 * Found by mutation on 2026-08-07, during a deliberate sweep for assertions
 * that pass while proving nothing. `determineVerificationStatus` fails on any
 * of:
 *
 *   1. matchPercentage        < requiredMatchPercentage
 *   2. checksumMatchPercentage < requiredMatchPercentage
 *   3. discrepancyPercentage  > maxDiscrepancyPercentage
 *
 * Deleting (1) failed a test. Deleting (2) failed a test. **Deleting (3)
 * failed nothing at all**, across 571 tests.
 *
 * That is not carelessness, it is arithmetic. `matchedCount` is
 * `sourceCount - missingOnTarget`, so
 *
 *     matchPercentage = 1 - discrepancyPercentage
 *
 * and at the DOCUMENTED DEFAULTS — `requiredMatchPercentage: 0.99`,
 * `maxDiscrepancyPercentage: 0.01` — condition (3) is exactly equivalent to
 * condition (1). Every existing test uses complementary values, so no test
 * could ever tell them apart.
 *
 * **It stops being redundant the moment the two numbers are not complements**,
 * which any deployment is free to configure: `requiredMatchPercentage: 0.90`
 * with `maxDiscrepancyPercentage: 0.01` leans entirely on (3) to fail a
 * migration that is missing 5% of its items. Untested, on the gate that stands
 * between a customer and a DNS cutover.
 *
 * These tests use a deliberately NON-complementary config so each condition can
 * be exercised alone.
 */

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  type LedgerVerificationReader,
  type TargetReindexer,
  type TargetEntry,
} from '@openmig/shared';
import { runVerification } from './verification.ts';
import { createRealVerificationDeps } from './verification-implementations.ts';

const TENANT = asTenantId('5fae0000-e29b-41d4-a716-4466554439b1' as never);
const MAPPING = asMappingId('5fae0000-e29b-41d4-a716-4466554439b2' as never);

/** `count` message ids, and their hashes, in a stable order. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `m${i}@example.com`);
}

/**
 * A ledger holding `total` mail items.
 *
 * Content hashes are omitted (`''`), which the comparison counts as
 * `checksumUnavailable` rather than as a mismatch — so `checksumMatchPercentage`
 * stays 1 and condition (2) cannot fire. That isolation is the point: each test
 * below must fail for ONE reason.
 */
function reader(total: number): LedgerVerificationReader {
  const hashes = ids(total).map((id) => naturalKeyHash(id));
  return {
    countItems: async (_t: unknown, _m: unknown, domain: string) =>
      domain === 'email' ? total : 0,
    totalSizeBytes: async () => 0,
    getAllNaturalKeyHashes: async (_t: unknown, _m: unknown, domain: string) =>
      domain === 'email' ? hashes : [],
    getSamples: async (_t: unknown, _m: unknown, domain: string, count: number) =>
      domain === 'email'
        ? hashes.slice(0, count).map((h, i) => ({ id: `s${i}`, naturalKeyHash: h, contentHash: '' }))
        : [],
  } as unknown as LedgerVerificationReader;
}

/** A target holding the FIRST `present` of those items, and nothing else. */
function reindexer(present: number): TargetReindexer {
  const entries = ids(present).map(
    (id, i) => ({ naturalKey: id, targetId: `t${i}`, mailboxId: 'INBOX' }) as TargetEntry,
  );
  return {
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const e of entries) yield e;
    },
  } as unknown as TargetReindexer;
}

/**
 * A config whose two thresholds are NOT complements.
 *
 * `requiredMatchPercentage: 0.5` and `maxDiscrepancyPercentage: 0.01` open a
 * wide band — between 1% and 50% missing — in which condition (3) is the only
 * thing that fails the gate. Every pre-existing test used 0.99/0.01, where the
 * two conditions coincide exactly.
 */
function config(over: Record<string, unknown> = {}) {
  return {
    checksumSamplePercentage: 100,
    minSampleSize: 1,
    maxSampleSize: 100,
    requiredMatchPercentage: 0.5,
    maxDiscrepancyPercentage: 0.01,
    verifyMail: true,
    verifyCalendar: false,
    verifyContacts: false,
    verifyFiles: false,
    ...over,
  } as never;
}

function verify(total: number, present: number, over: Record<string, unknown> = {}) {
  return runVerification(
    createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: config(over),
      verificationReader: reader(total),
      targetReindexers: { mail: reindexer(present) },
    } as never),
  );
}

describe('the missing-items threshold, on its own', () => {
  it('FAILS on 10% missing even though the match rate is comfortably inside its own limit', async () => {
    // THE CASE NO TEST COVERED. 90 of 100 arrived:
    //   matchPercentage       = 0.90  >= 0.5  -> condition (1) does NOT fire
    //   checksumMatchPercentage = 1          -> condition (2) does NOT fire
    //   discrepancyPercentage = 0.10  > 0.01 -> condition (3) is the only one
    //
    // Delete condition (3) and this is the test that notices.
    const report = await verify(100, 90);

    expect(report.mail.sourceCount).toBe(100);
    expect(report.mail.missingOnTarget).toBe(10);
    expect(report.mail.status).toBe('FAIL');
  });

  it('does not fire below its limit, so it is a threshold and not a blanket refusal', async () => {
    // 100 of 100. A condition that failed everything would satisfy the test
    // above while making the gate useless.
    const report = await verify(100, 100);

    expect(report.mail.missingOnTarget).toBe(0);
    expect(report.mail.status).toBe('PASS');
  });

  it('respects a raised limit, so the number is read rather than hard-coded', async () => {
    // Same 10% shortfall, but the deployment has said 20% is acceptable. If
    // this still failed, the threshold would be decoration.
    const report = await verify(100, 90, { maxDiscrepancyPercentage: 0.2 });

    expect(report.mail.missingOnTarget).toBe(10);
    expect(report.mail.status).not.toBe('FAIL');
  });
});

describe('the match-rate threshold, on its own', () => {
  it('FAILS when the match rate drops below its limit', async () => {
    // 40 of 100: discrepancy 0.60 AND match 0.40 — both conditions fire here,
    // which is the ordinary case and why condition (1) has always been tested.
    const report = await verify(100, 40);

    expect(report.mail.status).toBe('FAIL');
  });
});
