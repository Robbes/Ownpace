// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Checksum sampling must compare the SAME items on both sides.
 *
 * The source side samples the first N ledger rows by natural-key hash. The
 * target side used to slice its own first N the same way — which only lines up
 * when the two sets are equal, and they are not. A target legitimately holds
 * items the ledger never recorded: whatever was already on the destination
 * account before the migration.
 *
 * Every such extra that sorted into the target's first N pushed a real sample
 * out of the slice. The pushed-out item then had no counterpart to compare,
 * and the comparison loop scored "no counterpart" as a CONTENT MISMATCH —
 * ERROR severity, `canProceedToCutover: false`.
 *
 * That is a false FAIL on a healthy migration, and it was observed on a real
 * run: calendar and contacts each had 3 pre-existing items on the target and
 * each reported exactly 1 "content mismatch", while mail and files, with no
 * extras, reported none — with `missingOnTarget: 0` everywhere.
 *
 * Two things are fixed and pinned here:
 *   1. the target side honours the keys the caller asks for, and
 *   2. absence is scored as `unavailable`, never as a mismatch — absence is a
 *      claim `findMissingOnTarget` already makes, over the full sets.
 */

import { describe, it, expect } from 'vitest';
import { naturalKeyHash, type LedgerVerificationReader, type TargetEntry, type TargetReindexer } from '@openmig/shared';
import { runVerification, type VerificationDeps } from './verification';
import { createRealVerificationDeps } from './verification-implementations';

const BASE_CONFIG = {
  checksumSamplePercentage: 100,
  minSampleSize: 3,
  maxSampleSize: 100,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
  verifyMail: true,
  verifyCalendar: false,
  verifyContacts: false,
  verifyFiles: false,
};

/** Three migrated items, all present and identical on the target. */
const LEDGER = [
  { id: 'l1', naturalKeyHash: 'aaa', content: 'hash-1' },
  { id: 'l2', naturalKeyHash: 'bbb', content: 'hash-2' },
  { id: 'l3', naturalKeyHash: 'ccc', content: 'hash-3' },
];

/**
 * What the target actually holds: the three migrated items PLUS two that were
 * already on the destination account. Their hashes sort FIRST, so a naive
 * "first N" slice returns only extras and one real item.
 */
const TARGET = [
  { id: 't0', naturalKeyHash: '000', content: 'pre-existing-a' },
  { id: 't1', naturalKeyHash: '111', content: 'pre-existing-b' },
  { id: 'l1', naturalKeyHash: 'aaa', content: 'hash-1' },
  { id: 'l2', naturalKeyHash: 'bbb', content: 'hash-2' },
  { id: 'l3', naturalKeyHash: 'ccc', content: 'hash-3' },
];

function deps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    tenantId: 't' as never,
    mappingId: 'm' as never,
    config: BASE_CONFIG,
    canVerifyTarget: () => true,
    getSourceCount: async () => LEDGER.length,
    getTargetCount: async () => LEDGER.length,
    getSourceSamples: async (_d, count) => LEDGER.slice(0, count),
    // The honest implementation: return exactly what was asked for.
    getTargetSamples: async (_d, count, hashes) => {
      const sorted = [...TARGET].sort((a, b) => a.naturalKeyHash.localeCompare(b.naturalKeyHash));
      if (hashes && hashes.length > 0) {
        const wanted = new Set(hashes);
        return sorted.filter((e) => wanted.has(e.naturalKeyHash));
      }
      return sorted.slice(0, count);
    },
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [
      { id: 't0', targetRef: 't0' },
      { id: 't1', targetRef: 't1' },
    ],
    getTotalBytesSource: async () => 0,
    getTotalBytesTarget: async () => 0,
    ...overrides,
  } as VerificationDeps;
}

describe('checksum sampling alignment', () => {
  it('asks the target for the items the source sampled', async () => {
    const asked: Array<ReadonlyArray<string> | undefined> = [];
    await runVerification(
      deps({
        getTargetSamples: async (_d, count, hashes) => {
          asked.push(hashes);
          const wanted = new Set(hashes ?? []);
          return TARGET.filter((e) => wanted.has(e.naturalKeyHash));
        },
      }),
    );

    expect(asked[0], 'the source sample keys were not passed to the target side').toEqual([
      'aaa',
      'bbb',
      'ccc',
    ]);
  });

  it('does not invent mismatches when the target holds pre-existing items', async () => {
    // The false FAIL. Nothing is missing and nothing differs; the target simply
    // also contains two items the ledger never recorded.
    const result = await runVerification(deps());

    expect(result.mail.checksumMismatches, 'a pre-existing item was scored as corruption').toBe(0);
    expect(result.mail.checksumMatches).toBe(3);
    expect(result.mail.status).not.toBe('FAIL');
    expect(result.canProceedToCutover).toBe(true);
  });

  it('still scores a genuine content difference as a mismatch', async () => {
    // The guard on the fix above: absence stops counting, corruption must not.
    const result = await runVerification(
      deps({
        getTargetSamples: async () => [
          { id: 'l1', naturalKeyHash: 'aaa', content: 'hash-1' },
          { id: 'l2', naturalKeyHash: 'bbb', content: 'DIFFERENT' },
          { id: 'l3', naturalKeyHash: 'ccc', content: 'hash-3' },
        ],
      }),
    );

    expect(result.mail.checksumMismatches).toBe(1);
    expect(result.mail.checksumMatches).toBe(2);
  });

  it('counts an absent counterpart as unavailable, not as a content mismatch', async () => {
    // Absence is `findMissingOnTarget`'s finding, made over the FULL sets, and
    // it fails the gate on its own. Scoring it here too both double-counted it
    // and mislabelled a missing item as a corrupt one.
    const result = await runVerification(
      deps({
        getTargetSamples: async () => [{ id: 'l1', naturalKeyHash: 'aaa', content: 'hash-1' }],
      }),
    );

    expect(result.mail.checksumMismatches).toBe(0);
    expect(result.mail.checksumUnavailable).toBe(2);
    expect(result.mail.checksumMatches).toBe(1);
  });

  it('the real reindexer-backed implementation returns the requested items, not its own first N', async () => {
    // Covers `getTargetSamplesFromReindexer` itself, which the stubs above
    // bypass.
    //
    // The extras are chosen so their natural-key HASHES sort ahead of the
    // migrated ones — the slice is ordered by hash, not by key, so the names
    // themselves say nothing about position. These specific values are checked
    // by the assertion below, which would pass vacuously if they ever stopped
    // sorting first:
    //   sha256('mid:pre-1@example.com') = 004c5859...
    //   sha256('mid:pre-6@example.com') = 0e8ff402...
    //   sha256('mid:keep-1@example.com') = 44082046...
    //   sha256('mid:keep-2@example.com') = 5043fecb...
    const migrated = ['keep-1@example.com', 'keep-2@example.com'];
    const preExisting = ['pre-1@example.com', 'pre-6@example.com'];

    const entries: TargetEntry[] = [...preExisting, ...migrated].map((id, i) => ({
      naturalKey: id,
      targetId: `t${i}`,
      mailboxId: 'INBOX',
    }));

    const reader = {
      countItems: async () => migrated.length,
      totalSizeBytes: async () => 0,
      getAllNaturalKeyHashes: async () => migrated.map((id) => naturalKeyHash(id)),
      getSamples: async () => [],
    } as unknown as LedgerVerificationReader;

    const reindexer = {
      async *listEntries(): AsyncIterable<TargetEntry> {
        for (const e of entries) yield e;
      },
    } as unknown as TargetReindexer;

    const realDeps = createRealVerificationDeps({
      tenantId: 't' as never,
      mappingId: 'm' as never,
      config: BASE_CONFIG,
      verificationReader: reader,
      targetReindexers: { mail: reindexer },
    });

    const wanted = migrated.map((id) => naturalKeyHash(id));

    // Guard: if the extras stopped sorting ahead of the migrated items, the
    // naive slice would return the right answer by accident and this test would
    // prove nothing.
    const extraHashes = preExisting.map((id) => naturalKeyHash(id));
    expect(
      Math.max(...extraHashes.map((h) => h.localeCompare(wanted[0]!))),
      'the pre-existing fixtures no longer sort ahead — this test can no longer detect the bug',
    ).toBeLessThan(0);

    const samples = await realDeps.getTargetSamples('mail', 2, wanted);

    expect(samples.map((s) => s.naturalKeyHash).sort()).toEqual([...wanted].sort());
  });

  it('a genuinely missing item still FAILS, through the check that measures it', async () => {
    // Proof the leniency above costs no signal.
    const result = await runVerification(
      deps({
        findMissingOnTarget: async () => [{ id: 'l3', sourceRef: 'l3' }],
        getTargetSamples: async () => [
          { id: 'l1', naturalKeyHash: 'aaa', content: 'hash-1' },
          { id: 'l2', naturalKeyHash: 'bbb', content: 'hash-2' },
        ],
      }),
    );

    expect(result.mail.missingOnTarget).toBe(1);
    expect(result.mail.status).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
  });
});
