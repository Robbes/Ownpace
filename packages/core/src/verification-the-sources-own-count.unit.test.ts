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
      /counts 10000 mail item\(s\) that arrived before the last completed pass started, and 9999 were copied: 1 were never copied/,
    );
    expect(r.mail.neverCopied).toBe(1);
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
    // The old account's count, not the target, is what could not be read.
    expect(some.mail.issues[0]?.message).toMatch(/old account's own count could not be read/);
    expect(some.mail.issues[0]?.id).toBe('NOT_VERIFIABLE_mail');
  });

  it('before the switch, an unreadable count stays NOT_VERIFIABLE', async () => {
    const r = await runVerification(
      deps({
        getSourceCount: async () => 3,
        getTargetCount: async () => 3,
        getSourceSideCount: async () => {
          throw new Error('Invalid credentials (Failure)');
        },
        pastTheSwitch: async () => false,
      }),
    );
    expect(r.mail.status).toBe('NOT_VERIFIABLE');
  });

  describe('after the switch, when the old account cannot be asked (the owner, 2026-11-24: "ok")', () => {
    const gone = async (): Promise<number> => {
      throw new Error('Invalid credentials (Failure)');
    };

    it('measures against our own record, as before, and says so', async () => {
      const r = await runVerification(
        deps({
          getSourceCount: async () => 3,
          getTargetCount: async () => 3,
          getSourceSideCount: gone,
          pastTheSwitch: async () => true,
        }),
      );
      expect(r.mail.status).toBe('PASS');
      expect(r.mail).toMatchObject({ sourceCount: 3, matchedCount: 3, missingOnTarget: 0 });
      const own = r.mail.issues.find((i) => i.id === 'SOURCE_COUNT_OWN_RECORD_mail');
      expect(own?.severity).toBe('WARNING');
      expect(own?.message).toMatch(/our own record of what was copied/);
      expect(own?.message).toMatch(/Invalid credentials/);
    });

    it('still FAILS what our own record says is missing on the new system', async () => {
      const r = await runVerification(
        deps({
          getSourceCount: async () => 3,
          getTargetCount: async () => 2,
          findMissingOnTarget: async () => [{ id: 'k3', sourceRef: 'INBOX:3' }],
          getSourceSideCount: gone,
          pastTheSwitch: async () => true,
        }),
      );
      expect(r.mail.status).toBe('FAIL');
      expect(r.mail.issues.map((i) => i.id)).toContain('SOURCE_COUNT_OWN_RECORD_mail');
    });

    it('with nothing recorded, is SKIPPED as before, and still says why', async () => {
      const r = await runVerification(deps({ getSourceSideCount: gone, pastTheSwitch: async () => true }));
      expect(r.mail.status).toBe('SKIPPED');
      expect(r.mail.issues.map((i) => i.id)).toContain('SOURCE_COUNT_OWN_RECORD_mail');
    });
  });
});

// LEFT BEHIND IS ACCOUNTED FOR (the owner, 2026-11-24: "E yes"). Mail the
// person chose to leave behind (§11.2) is outside the ledger's count and
// inside Gmail's, so it read as never copied and FAILed the Check. It is now
// on the recorded side.
describe('mail left behind by choice, beside the source\'s own count', () => {
  it('a mailbox with left-behind mail PASSES the Check', async () => {
    const r = await runVerification(
      deps({
        getSourceCount: async () => 97,
        getTargetCount: async () => 97,
        getSourceSideCount: async () => 100,
        getLeftBehindCount: async () => 3,
      }),
    );
    expect(r.mail.issues.map((i) => i.id)).not.toContain('NEVER_COPIED_mail');
    expect(r.mail.neverCopied).toBeUndefined();
    expect(r.mail).toMatchObject({ status: 'PASS', sourceCount: 97, matchedCount: 97 });
  });

  it('a message really missing still FAILS, and the issue names what was left behind', async () => {
    const r = await runVerification(
      deps({
        getSourceCount: async () => 96,
        getTargetCount: async () => 96,
        getSourceSideCount: async () => 100,
        getLeftBehindCount: async () => 3,
      }),
    );
    expect(r.mail.status).toBe('FAIL');
    expect(r.mail.neverCopied).toBe(1);
    expect(r.mail.issues.find((i) => i.id === 'NEVER_COPIED_mail')?.message).toMatch(
      /counts 100 mail item\(s\) .* and 96 were copied and 3 left behind by your choice: 1 were never copied/,
    );
  });

  it('without a source figure, left behind is not even asked', async () => {
    let asked = 0;
    const r = await runVerification(
      deps({
        getSourceCount: async () => 5,
        getTargetCount: async () => 5,
        getLeftBehindCount: async () => {
          asked++;
          return 3;
        },
      }),
    );
    expect(asked).toBe(0);
    expect(r.mail).toMatchObject({ status: 'PASS', sourceCount: 5 });
  });
});
