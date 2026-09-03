// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A verification that measured NOTHING must not open the cutover gate.
//
// Found 2026-09-03 by the catch-all sweep that followed workplan 0113's seventh
// fan-out. `calculateOverallStatus` treats SKIPPED as neutral — correctly, one
// domain at a time: a mail-only migration should not report WARN for ever
// because it did not check calendars. But the neutrality had no floor, so ALL
// domains skipped fell through to the final `return 'PASS'`, and
// `calculateVerificationScore` answered 1 for an empty `measured` list. The
// report then read:
//
//     overallStatus: 'PASS'   score: 1   canProceedToCutover: true
//
// and `apps/worker/src/cli/cutover-commands.ts` printed "Data verification
// passed — …" to the person about to cut over.
//
// REACHABLE by two roads. A domain is SKIPPED when it is disabled in the
// config, and when `canVerifyTarget` says its target cannot be read AND the
// ledger recorded nothing for it. So both a mapping with no domains selected
// and one whose targets have no reindexer and which has copied nothing passed
// the §20 gate with a perfect score. The absence of data reported as the
// absence of problems — the same lie the managed smoke refuses with "a verify
// that reached 'done' but compared NOTHING", one layer down and with a cutover
// behind it.
//
// Nothing broke when the fix landed, which is the other half of the finding:
// no test had ever asserted what an all-skipped report says.

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import { runVerification, type VerificationDeps } from './verification.ts';

const TENANT = asTenantId('6a6e0000-e29b-41d4-a716-4466554433b1' as never);
const MAPPING = asMappingId('6a6e0000-e29b-41d4-a716-4466554433b2' as never);

function deps(overrides: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    config: {
      verifyMail: true,
      verifyCalendar: true,
      verifyContacts: true,
      verifyFiles: true,
      verifyTasks: true,
    },
    getSourceCount: async () => 10,
    getTargetCount: async () => 10,
    getSourceSamples: async () => [],
    getTargetSamples: async () => [],
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [],
    getTotalBytesSource: async () => 0,
    ...overrides,
  } as VerificationDeps;
}

describe('a verification that measured nothing', () => {
  /**
   * Every domain enabled, no target readable, nothing in the ledger — the
   * appliance shape of "this migration has not happened". `canVerifyTarget`
   * gates the branch, so it takes BOTH halves to reach SKIPPED rather than
   * NOT_VERIFIABLE, and a zero ledger is what separates them.
   */
  const neverSynced = () =>
    deps({ canVerifyTarget: () => false, getSourceCount: async () => 0 } as Partial<VerificationDeps>);

  it('skips every domain when the ledger recorded nothing', async () => {
    const r = await runVerification(neverSynced());
    for (const d of [r.mail, r.calendar, r.contacts, r.files, r.tasks]) {
      expect(d.status).toBe('SKIPPED');
    }
  });

  it('does NOT report PASS — nothing was checked', async () => {
    const r = await runVerification(neverSynced());
    expect(r.overallStatus).toBe('FAIL');
  });

  it('does NOT score 1.0 for evidence it never gathered', async () => {
    // The score is the other half of the gate: `canProceedToCutover` has a
    // `score >= 0.95` arm, so a 1.0 here walks a WARN through on a number
    // nothing earned.
    const r = await runVerification(neverSynced());
    expect(r.score).toBe(0);
  });

  it('REFUSES the cutover — the assertion the customer is protected by', async () => {
    const r = await runVerification(neverSynced());
    expect(r.canProceedToCutover).toBe(false);
  });

  it('is still not silent: every skipped domain says so in the report', async () => {
    // The neutrality this fix bounds was never about hiding anything, and the
    // fix must not make it quieter — a FAIL whose reasons are absent is its own
    // problem.
    const r = await runVerification(neverSynced());
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it('leaves a genuinely partial migration alone — one measured domain is enough', async () => {
    // The regression risk of the fix, pinned. A mail-only mapping measures mail
    // and skips four; that must still PASS, or every honest partial migration
    // is blocked from cutting over.
    const mailOnly = deps({
      config: {
        verifyMail: true,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: false,
        verifyTasks: false,
      },
    } as Partial<VerificationDeps>);

    const r = await runVerification(mailOnly);
    expect(r.mail.status).toBe('PASS');
    expect(r.calendar.status).toBe('SKIPPED');
    expect(r.overallStatus).toBe('PASS');
    expect(r.canProceedToCutover).toBe(true);
  });
});
