// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST MIGRATION IS NEVER SWITCHED OVER (workplan 0162 §2 (e), T3).
 *
 * A test migration copies only the items whose title carries its marker, and
 * its check measures them as any migration's check measures what it copied:
 * the verdict, the score and every count are the same as without the marker.
 * What differs is the one answer the cutover reads. `canProceedToCutover` is
 * false whatever the verdict, the first recommendation says why, and the
 * report carries the marker, so the Verify and Finish pages say it in their
 * reader's language without reading the recommendation's English.
 *
 * Both directions, because either alone is escapable: the same migration
 * without a marker can proceed, and its report carries no marker.
 */

import { describe, it, expect } from 'vitest';
import { A_TEST_IS_NOT_SWITCHED_OVER, asMappingId, asTenantId } from '@openmig/shared';
import { runVerification, type VerificationConfig, type VerificationDeps } from './verification.ts';

const TENANT = asTenantId('01620004-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('01620004-e29b-41d4-a716-446655440002' as never);
const MARKER = '[Ownpace-test]';

/** A migration of all five data types, whose ten copies of each are all on the target. */
function deps(config: Partial<VerificationConfig> = {}, overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    config: {
      verifyMail: true,
      verifyCalendar: true,
      verifyContacts: true,
      verifyFiles: true,
      verifyTasks: true,
      ...config,
    },
    getSourceCount: async () => 10,
    getTargetCount: async () => 10,
    getSourceSamples: async () => [],
    getTargetSamples: async () => [],
    // No hasher: the counts decide, as for any target that cannot hash.
    targetCanHash: () => false,
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [],
    getTotalBytesSource: async () => 0,
    ...overrides,
  } as VerificationDeps;
}

describe('the check of a test migration', () => {
  it('measures as any other, and never clears it for its cutover', async () => {
    const plain = await runVerification(deps());
    const test = await runVerification(deps({ testMarker: MARKER }));

    expect(test.overallStatus).toBe('PASS');
    for (const d of [test.mail, test.calendar, test.contacts, test.files, test.tasks]) expect(d.status).toBe('PASS');
    expect(test.score).toBe(plain.score);
    expect(test.totalItemsSource).toBe(50);
    expect(test.totalItemsTarget).toBe(50);
    expect(test.canProceedToCutover).toBe(false);
  });

  it('names the reason first, and does not call itself ready', async () => {
    const r = await runVerification(deps({ testMarker: MARKER }));

    expect(r.recommendations).toEqual([A_TEST_IS_NOT_SWITCHED_OVER.en]);
    expect(r.recommendations).not.toContain('All verifications passed. Ready for cutover.');
  });

  it('carries the marker, for the pages to say it in their reader’s language', async () => {
    expect((await runVerification(deps({ testMarker: MARKER }))).testMarker).toBe(MARKER);
  });

  it('stays held when a WARN would have opened the gate, and its findings follow the reason', async () => {
    // One extra item on the target is a WARN within the gate's score.
    const warned = { findExtraOnTarget: async () => [{ id: 'x', targetRef: 'x' }] } as Partial<VerificationDeps>;
    const plain = await runVerification(deps({}, warned));
    expect(plain.overallStatus).toBe('WARN');
    expect(plain.canProceedToCutover).toBe(true);

    const test = await runVerification(deps({ testMarker: MARKER }, warned));
    expect(test.overallStatus).toBe('WARN');
    expect(test.canProceedToCutover).toBe(false);
    expect(test.recommendations[0]).toBe(A_TEST_IS_NOT_SWITCHED_OVER.en);
    expect(test.recommendations.slice(1)).toEqual(plain.recommendations);
  });
});

describe('the check of the same migration without a marker', () => {
  it('clears it for its cutover, and carries no marker', async () => {
    const r = await runVerification(deps());

    expect(r.overallStatus).toBe('PASS');
    expect(r.canProceedToCutover).toBe(true);
    expect(r.recommendations).toEqual(['All verifications passed. Ready for cutover.']);
    expect(r).not.toHaveProperty('testMarker');
  });
});
