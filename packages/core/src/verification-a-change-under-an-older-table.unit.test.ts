// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * VERIFICATION AND THE ADDRESS TABLE (workplan 0168 T5; ADR-0055 decision 5).
 *
 * The §20 report says how many copies of a data type carry a declared address
 * change and names the table's digest. A copy written under an older table is
 * never a match: its sample is set aside, counted as unavailable, and said as
 * a warning, whatever its hash says.
 */

import { describe, it, expect } from 'vitest';
import { runVerification, type VerificationDeps } from './verification.ts';

const CONFIG = {
  checksumSamplePercentage: 100,
  minSampleSize: 3,
  maxSampleSize: 100,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
  verifyMail: false,
  verifyCalendar: false,
  verifyContacts: true,
  verifyFiles: false,
  verifyTasks: false,
};

const LEDGER = [
  { id: 'l1', naturalKeyHash: 'aaa', content: 'card1:1' },
  { id: 'l2', naturalKeyHash: 'bbb', content: 'card1:2' },
  { id: 'l3', naturalKeyHash: 'ccc', content: 'card1:3' },
];

const DIGEST = 'd'.repeat(64);

function deps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    tenantId: 't' as never,
    mappingId: 'm' as never,
    config: CONFIG,
    canVerifyTarget: () => true,
    targetCanHash: () => true,
    getSourceCount: async () => LEDGER.length,
    getTargetCount: async () => LEDGER.length,
    getSourceSamples: async (_d, count) => LEDGER.slice(0, count),
    // The target holds exactly what the ledger recorded: every hash agrees.
    getTargetSamples: async (_d, _count, hashes) => LEDGER.filter((e) => (hashes ?? []).includes(e.naturalKeyHash)),
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [],
    getTotalBytesSource: async () => 0,
    getTotalBytesTarget: async () => 0,
    ...overrides,
  } as VerificationDeps;
}

const withTable = (olderKeys: string[]) =>
  deps({ getAddressChanges: async () => ({ digest: DIGEST, changed: 2, olderKeys }) });

describe('verification under the address table', () => {
  it('names the digest and counts the copies changed under it', async () => {
    const result = await runVerification(withTable([]));
    expect(result.contacts.addressChanges).toEqual({ digest: DIGEST, changed: 2, older: 0 });
    expect(result.contacts.checksumMatches).toBe(3);
    expect(result.contacts.issues.find((i) => i.id.startsWith('ADDRESS_'))).toBeUndefined();
  });

  it('never counts a copy under an older table as a match, and says so', async () => {
    const result = await runVerification(withTable(['bbb']));
    const c = result.contacts;
    expect(c.addressChanges).toEqual({ digest: DIGEST, changed: 2, older: 1 });
    expect(c.checksumMatches).toBe(2);
    expect(c.checksumUnavailable).toBe(1);
    expect(c.checksumMatches + c.checksumMismatches + c.checksumUnavailable).toBe(c.checksumSampleSize);
    const issue = c.issues.find((i) => i.id === 'ADDRESS_OLDER_TABLE_contacts');
    expect(issue?.severity).toBe('WARNING');
    expect(issue?.message).toMatch(/older address table/);
  });

  it('says nothing about a table when the reader keeps none, exactly as before', async () => {
    const result = await runVerification(deps());
    expect(result.contacts.addressChanges).toBeUndefined();
    expect(result.contacts.checksumMatches).toBe(3);
  });

});
