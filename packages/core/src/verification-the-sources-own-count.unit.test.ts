// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// THE CHECK COUNTS FROM THE SOURCE ITSELF, WHERE THE SOURCE CAN SAY (the
// owner, 2026-11-24: "count from Gmail itself on Confirm and Check").
//
// The source figure used to be the ledger's own count, so a message no pass
// ever listed was on neither side of the comparison and the gate passed over
// it: Gmail's label-less archived mail. `getSourceSideCount` is Gmail's All
// Mail figure; these pin how the gate reads it at its two edges, an empty
// ledger and a figure that cannot be read.

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import { runVerification, type VerificationDeps } from './verification.ts';

const TENANT = asTenantId('5c0c0000-e29b-41d4-a716-4466554433d1' as never);
const MAPPING = asMappingId('5c0c0000-e29b-41d4-a716-4466554433d2' as never);

function deps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    config: {
      checksumSamplePercentage: 5,
      minSampleSize: 1,
      maxSampleSize: 10,
      requiredMatchPercentage: 0.99,
      maxDiscrepancyPercentage: 0.01,
      verifyMail: true,
      verifyCalendar: false,
      verifyContacts: false,
      verifyFiles: false,
      verifyTasks: false,
    },
    getSourceCount: async () => 0,
    getTargetCount: async () => 0,
    getSourceSamples: async () => [],
    getTargetSamples: async () => [],
    targetCanHash: () => false,
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [],
    getTotalBytesSource: async () => 0,
    ...overrides,
  } as VerificationDeps;
}

describe("the source's own count", () => {
  it('an empty ledger beside a Gmail that holds mail FAILS, never SKIPPED', async () => {
    const r = await runVerification(deps({ getSourceSideCount: async () => 7 }));
    expect(r.mail.status).toBe('FAIL');
    expect(r.mail).toMatchObject({ sourceCount: 7, matchedCount: 0, missingOnTarget: 7 });
    expect(r.mail.issues.map((i) => i.id)).toContain('NEVER_COPIED_mail');
  });

  it('an empty ledger beside an empty Gmail is still SKIPPED: nothing to compare', async () => {
    const r = await runVerification(deps({ getSourceSideCount: async () => 0 }));
    expect(r.mail.status).toBe('SKIPPED');
  });

  it('one message never copied FAILS whatever the tolerance', async () => {
    // 1 of 10,000 is inside the 1% a lost copy on the target is allowed.
    // A message no pass ever recorded is not: the remedy is a pass.
    const r = await runVerification(
      deps({
        getSourceCount: async () => 9_999,
        getTargetCount: async () => 9_999,
        getSourceSideCount: async () => 10_000,
      }),
    );
    expect(r.mail.status).toBe('FAIL');
    expect(r.mail.issues.find((i) => i.id === 'NEVER_COPIED_mail')?.message).toMatch(
      /counts 10000 mail item\(s\), and 9999 were copied: 1 were never copied/,
    );
  });

  it('a Gmail that holds fewer than were copied (deleted since) is no loss', async () => {
    const r = await runVerification(
      deps({ getSourceCount: async () => 5, getTargetCount: async () => 5, getSourceSideCount: async () => 4 }),
    );
    expect(r.mail.issues.map((i) => i.id)).not.toContain('NEVER_COPIED_mail');
    expect(r.mail.status).not.toBe('FAIL');
  });

  it('a count that cannot be read is NOT_VERIFIABLE with the reason, never a pass', async () => {
    const unreadable = async (): Promise<number> => {
      throw new Error("Gmail's All Mail is not listed over IMAP");
    };
    const empty = await runVerification(deps({ getSourceSideCount: unreadable }));
    expect(empty.mail.status).toBe('NOT_VERIFIABLE');
    expect(empty.mail.issues[0]?.message).toMatch(/All Mail is not listed/);

    const some = await runVerification(
      deps({ getSourceCount: async () => 3, getTargetCount: async () => 3, getSourceSideCount: unreadable }),
    );
    expect(some.mail.status).toBe('NOT_VERIFIABLE');
    expect(some.mail.issues[0]?.message).toMatch(/All Mail is not listed/);
  });
});
