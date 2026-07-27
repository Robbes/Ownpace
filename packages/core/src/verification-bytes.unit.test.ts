// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The verification gate must not report bytes it never measured.
//
// `getTotalBytesFromTarget()` used to return the SOURCE total, so every report
// came back with totalBytesTarget === totalBytesSource — which reads as
// "byte-level parity verified" when the target had never been asked. AGENTS.md
// calls the verification gate "the product promise"; fabricating evidence for it
// is the worst version of the hard-rule-9 problem.
//
// These tests pin the honest contract: unmeasured target bytes are `null`, and
// the summary's "bytes transferred" is the source figure (what we actually
// copied) rather than a target-sounding restatement of it.

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import { runVerification, type VerificationDeps } from './verification';

const TENANT = asTenantId('5f5d0000-e29b-41d4-a716-4466554433a1' as never);
const MAPPING = asMappingId('5f5d0000-e29b-41d4-a716-4466554433a2' as never);

/** Deps where every domain has 10 items that all match, and 1234 source bytes. */
function baseDeps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    config: {
      verifyMail: true,
      verifyCalendar: true,
      verifyContacts: true,
      verifyFiles: true,
    },
    getSourceCount: async () => 10,
    getTargetCount: async () => 10,
    getSourceSamples: async () => [],
    getTargetSamples: async () => [],
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [],
    getTotalBytesSource: async () => 1234,
    ...overrides,
  } as VerificationDeps;
}

describe('verification byte reporting', () => {
  it('reports totalBytesTarget as null when the target cannot be measured', async () => {
    // getTotalBytesTarget deliberately not supplied — the real wiring in
    // verification-implementations.ts omits it for exactly this reason.
    const result = await runVerification(baseDeps());

    expect(result.mail.totalBytesTarget).toBeNull();
    expect(result.calendar.totalBytesTarget).toBeNull();
    expect(result.contacts.totalBytesTarget).toBeNull();
    expect(result.files.totalBytesTarget).toBeNull();
  });

  it('never reports target bytes that merely echo the source (the old fake parity)', async () => {
    const result = await runVerification(baseDeps());

    for (const domain of [result.mail, result.calendar, result.contacts, result.files]) {
      expect(domain.totalBytesSource).toBe(1234);
      // The specific regression: target must NOT come back equal to source
      // just because nobody measured it.
      expect(domain.totalBytesTarget).not.toBe(domain.totalBytesSource);
    }
  });

  it('still reports source bytes, which are genuinely known from the ledger', async () => {
    const result = await runVerification(baseDeps());

    expect(result.mail.totalBytesSource).toBe(1234);
  });

  it('derives totalBytesTransferred from source bytes (what was actually copied)', async () => {
    const result = await runVerification(baseDeps());

    // Four domains x 1234. Summing totalBytesTarget instead would now be
    // summing nulls — and previously produced a target-sounding number that was
    // really the source figure.
    expect(result.totalBytesTransferred).toBe(4 * 1234);
    expect(Number.isNaN(result.totalBytesTransferred)).toBe(false);
  });

  it('uses a real target measurement when one IS supplied', async () => {
    const result = await runVerification(
      baseDeps({ getTotalBytesTarget: async () => 999 }),
    );

    expect(result.mail.totalBytesTarget).toBe(999);
    // A real measurement is allowed to differ from source — that difference is
    // the whole point of measuring.
    expect(result.mail.totalBytesSource).toBe(1234);
  });

  it('keeps byte reporting out of the pass/fail verdict', async () => {
    // Counts and checksums decide the verdict; bytes are reported, not gating.
    // A missing target measurement must therefore not degrade the status.
    const withBytes = await runVerification(baseDeps({ getTotalBytesTarget: async () => 999 }));
    const withoutBytes = await runVerification(baseDeps());

    expect(withoutBytes.overallStatus).toBe(withBytes.overallStatus);
    expect(withoutBytes.canProceedToCutover).toBe(withBytes.canProceedToCutover);
  });
});
