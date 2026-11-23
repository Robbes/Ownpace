// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * VERIFICATION AND THE ADDRESS TABLE (workplan 0168 T5, S2, S11; ADR-0055
 * decision 5).
 *
 * The §20 report says how many copies of a data type carry a declared address
 * change and names the table's digest. A copy a change waits for is never a
 * match: its sample is set aside, counted as unavailable, and said as a
 * warning, whatever its hash says, in a person's words (no decision's number),
 * with what it waits for. A sample every item of which waits holds the gate,
 * as no sample drawn does: nothing was compared (S2).
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

const withTable = (olderKeys: string[], waitsFor?: 'pass' | 'press', over: Partial<VerificationDeps> = {}) =>
  deps({
    getAddressChanges: async () => ({ digest: DIGEST, changed: 2, olderKeys, ...(waitsFor ? { waitsFor } : {}) }),
    ...over,
  });

describe('verification under the address table', () => {
  it('names the digest and counts the copies changed under it', async () => {
    const result = await runVerification(withTable([]));
    expect(result.contacts.addressChanges).toEqual({ digest: DIGEST, changed: 2, older: 0 });
    expect(result.contacts.checksumMatches).toBe(3);
    expect(result.contacts.issues.find((i) => i.id.startsWith('ADDRESS_'))).toBeUndefined();
  });

  it('never counts a copy a change waits for as a match, and says so in a person’s words', async () => {
    const result = await runVerification(withTable(['bbb'], 'pass'));
    const c = result.contacts;
    expect(c.addressChanges).toEqual({ digest: DIGEST, changed: 2, older: 1, waitsFor: 'pass' });
    expect(c.checksumMatches).toBe(2);
    expect(c.checksumUnavailable).toBe(1);
    expect(c.checksumMatches + c.checksumMismatches + c.checksumUnavailable).toBe(c.checksumSampleSize);
    const issue = c.issues.find((i) => i.id === 'ADDRESS_OLDER_TABLE_contacts');
    expect(issue?.severity).toBe('WARNING');
    expect(issue?.message).toMatch(/wait for an address change to reach them, which the next pass writes/);
    // No decision's number in a person's sentence (the screens' review S11).
    expect(issue?.message).not.toMatch(/ADR/);
  });

  it('says a copy past the switch waits for the press, never for the next pass', async () => {
    const result = await runVerification(withTable(['bbb'], 'press'));
    const issue = result.contacts.issues.find((i) => i.id === 'ADDRESS_OLDER_TABLE_contacts');
    expect(issue?.message).toMatch(/Apply the new addresses here too/);
    expect(issue?.message).not.toMatch(/next pass/);
    expect(result.contacts.addressChanges?.waitsFor).toBe('press');
  });

  it('holds the gate when every sample waits for an address change: nothing was compared (S2)', async () => {
    const result = await runVerification(withTable(['aaa', 'bbb', 'ccc'], 'pass'));
    const c = result.contacts;
    expect(c.checksumMatches).toBe(0);
    expect(c.status).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
    const held = c.issues.find((i) => i.id === 'ADDRESS_NOT_COMPARED_contacts');
    expect(held?.severity).toBe('ERROR');
    expect(held?.message).toMatch(/the next pass/);
    // Not the connection's sentence: the target was never asked.
    expect(c.issues.find((i) => i.id === 'CHECKSUM_NOT_COMPARED_contacts')).toBeUndefined();
  });

  it('names the press when every sample past the switch waits for one', async () => {
    const result = await runVerification(withTable(['aaa', 'bbb', 'ccc'], 'press'));
    expect(result.contacts.status).toBe('FAIL');
    expect(result.contacts.issues.find((i) => i.id === 'ADDRESS_NOT_COMPARED_contacts')?.message).toMatch(
      /Apply the new addresses here too/,
    );
  });

  it('lets the counts decide for a target with no way to hash, as for no sample drawn there', async () => {
    const result = await runVerification(withTable(['aaa', 'bbb', 'ccc'], 'pass', { targetCanHash: () => false }));
    expect(result.contacts.status).toBe('PASS');
    expect(result.contacts.issues.find((i) => i.id === 'ADDRESS_NOT_COMPARED_contacts')).toBeUndefined();
  });

  it('says nothing about a table when the reader keeps none, exactly as before', async () => {
    const result = await runVerification(deps());
    expect(result.contacts.addressChanges).toBeUndefined();
    expect(result.contacts.checksumMatches).toBe(3);
  });

});

/**
 * NO VERSION TO GUARD THE WRITE (workplan 0168 S1, and its finding on the
 * way). A copy that waits with no strong target version is left as it is by
 * every pass and every press. It was said to wait for "the next pass" all the
 * same; now it is said apart, and a sample of only those is never told to
 * check again after a pass.
 */
describe('copies no pass changes, with no version to guard the write', () => {
  const unguardedTable = (olderKeys: string[], unguardedKeys: string[], waitsFor?: 'pass' | 'press') =>
    deps({
      getAddressChanges: async () => ({
        digest: DIGEST,
        changed: 2,
        olderKeys,
        unguardedKeys,
        ...(waitsFor ? { waitsFor } : {}),
      }),
    });

  it('counts them apart, and says only the rest wait for the next pass', async () => {
    const result = await runVerification(unguardedTable(['aaa', 'bbb'], ['bbb'], 'pass'));
    const c = result.contacts;
    expect(c.addressChanges).toEqual({ digest: DIGEST, changed: 2, older: 2, unguarded: 1, waitsFor: 'pass' });
    expect(c.issues.find((i) => i.id === 'ADDRESS_OLDER_TABLE_contacts')?.message).toMatch(/^1 contacts item\(s\) wait/);
    const left = c.issues.find((i) => i.id === 'ADDRESS_UNGUARDED_contacts');
    expect(left?.severity).toBe('WARNING');
    expect(left?.message).toMatch(/^1 contacts item\(s\) do not carry an address change and are left as they are/);
    expect(left?.message).not.toMatch(/next pass/);
  });

  it('says nothing waits when every one of them is unguarded', async () => {
    const result = await runVerification(unguardedTable(['bbb'], ['bbb']));
    const c = result.contacts;
    expect(c.addressChanges).toEqual({ digest: DIGEST, changed: 2, older: 1, unguarded: 1 });
    expect(c.issues.find((i) => i.id === 'ADDRESS_OLDER_TABLE_contacts')).toBeUndefined();
    expect(c.issues.find((i) => i.id === 'ADDRESS_UNGUARDED_contacts')).toBeDefined();
  });

  it('never tells a held sample of only those to check again after the next pass', async () => {
    const result = await runVerification(unguardedTable(['aaa', 'bbb', 'ccc'], ['aaa', 'bbb', 'ccc'], 'pass'));
    const held = result.contacts.issues.find((i) => i.id === 'ADDRESS_NOT_COMPARED_contacts');
    expect(result.contacts.status).toBe('FAIL');
    expect(held?.message).toMatch(/No pass changes them/);
    expect(held?.message).not.toMatch(/next pass/);
  });
});
