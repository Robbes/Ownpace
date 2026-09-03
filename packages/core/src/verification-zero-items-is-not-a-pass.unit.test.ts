// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// AN ENABLED DOMAIN THAT RECORDED NOTHING REPORTED PASS, BECAUSE 0 == 0.
//
// #754 gave `calculateOverallStatus` a floor: every domain SKIPPED is a FAIL,
// not a pass. Its own PR body named what it deliberately left: a domain that is
// ENABLED and whose target IS readable never becomes SKIPPED at all. It goes to
// `verifyDataType`, where every comparison is vacuous —
//
//     matchPercentage        sourceCount > 0 ? … : 1      ->  1
//     checksumMatchPercentage  comparable > 0 ? … : 1     ->  1
//     missingOnTarget          []                          ->  0
//
// — and `determineVerificationStatus` returns PASS on two ratios that measured
// nothing. The domain then counts as MEASURED, so #754's all-SKIPPED rule never
// fires, `calculateVerificationScore` averages in a perfect 1.0, and the report
// reads PASS / score 1 / canProceedToCutover: true.
//
// That is workplan 0113's seventh fan-out precisely. `runTaskSync` was never
// dispatched, the ledger got no task rows, and §20 said the task domain was
// fine. Only the managed smoke caught it, through its own "compared NOTHING:
// totalItemsSource=0" assertion — a workaround in one gate script, over an
// engine that shipped the hole. The self-hosted gate never asked at all.
//
// ## The fix, and why SKIPPED rather than FAIL
//
// `verifyDomain` already treated a zero ledger as SKIPPED — but only inside the
// `canVerifyTarget` branch, so the answer depended on whether the target
// happened to be readable, which is a fact about the TARGET and not about
// whether anything was copied. The check now runs first, for every domain.
//
// Per-domain SKIPPED, overall FAIL, and the split is the design: one empty
// domain beside a mail migration that moved 10,000 messages is a user with no
// tasks, not a defect. `calculateOverallStatus` decides what a collection of
// SKIPPEDs means; since #754 it fails when every one of them is. Each answer
// stays where its evidence is.
//
// ## What these tests hold
//
// Both directions, because either alone is escapable: the empty domain must
// stop reporting PASS, AND the honest partial migration must still cut over. A
// fix that only did the first would block every mail-only customer.

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import { runVerification, type VerificationDeps } from './verification.ts';

const TENANT = asTenantId('7b7f0000-e29b-41d4-a716-4466554433c1' as never);
const MAPPING = asMappingId('7b7f0000-e29b-41d4-a716-4466554433c2' as never);

/** Every domain enabled, and — unlike #754's fixture — the target IS readable. */
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
    getSourceCount: async () => 0,
    getTargetCount: async () => 0,
    getSourceSamples: async () => [],
    getTargetSamples: async () => [],
    findMissingOnTarget: async () => [],
    findExtraOnTarget: async () => [],
    getTotalBytesSource: async () => 0,
    ...overrides,
  } as VerificationDeps;
}

describe('an enabled domain that recorded nothing', () => {
  it('reports SKIPPED, not PASS — nothing was compared', async () => {
    const r = await runVerification(deps());
    for (const d of [r.mail, r.calendar, r.contacts, r.files, r.tasks]) {
      expect(d.status).toBe('SKIPPED');
    }
  });

  it('does not open the cutover gate when EVERY domain is empty', async () => {
    // The seventh fan-out's shape end to end: enabled, dispatched, nothing
    // landed, target readable. Before the fix this was PASS / 1 / true.
    const r = await runVerification(deps());
    expect(r.overallStatus).toBe('FAIL');
    expect(r.score).toBe(0);
    expect(r.canProceedToCutover).toBe(false);
  });

  it('says why, rather than failing silently', async () => {
    const r = await runVerification(deps());
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  /**
   * THE REGRESSION THIS FIX COULD CAUSE, pinned in the opposite direction.
   *
   * A real mail migration where the customer simply has no tasks. Mail measured
   * 10,000 items and matched them; tasks recorded nothing. If the fix fired on
   * the whole report, every honest partial migration would be blocked from
   * cutting over — a worse bug than the one being fixed, because it would hit
   * people whose migration actually worked.
   */
  it('still passes a migration where one domain is empty and another is not', async () => {
    const mailFullTasksEmpty = deps({
      getSourceCount: async (d: string) => (d === 'tasks' ? 0 : 10_000),
      getTargetCount: async (d: string) => (d === 'tasks' ? 0 : 10_000),
    } as Partial<VerificationDeps>);

    const r = await runVerification(mailFullTasksEmpty);
    expect(r.mail.status).toBe('PASS');
    expect(r.tasks.status).toBe('SKIPPED');
    expect(r.overallStatus).toBe('PASS');
    expect(r.canProceedToCutover).toBe(true);
  });

  it('scores only the domains it measured, so the empty one cannot inflate it', async () => {
    // A SKIPPED domain is excluded from the average by #754's `measured`
    // filter. Before this fix the empty domain was PASS — i.e. measured — and
    // contributed a perfect 1.0 it had not earned.
    const r = await runVerification(
      deps({
        getSourceCount: async (d: string) => (d === 'tasks' ? 0 : 100),
        getTargetCount: async (d: string) => (d === 'tasks' ? 0 : 100),
      } as Partial<VerificationDeps>),
    );
    expect(r.tasks.sourceCount).toBe(0);
    expect(r.score).toBeGreaterThan(0);
  });

  it('leaves the unreadable-target branch alone: items recorded is still NOT_VERIFIABLE', async () => {
    // The check moved ABOVE `canVerifyTarget`, so this branch had to keep
    // working for the case that does reach it — copied items whose target
    // cannot be read, which must still block cutover.
    const r = await runVerification(
      deps({
        canVerifyTarget: () => false,
        getSourceCount: async () => 42,
      } as Partial<VerificationDeps>),
    );
    expect(r.mail.status).toBe('NOT_VERIFIABLE');
    expect(r.canProceedToCutover).toBe(false);
  });

  it('does not ask the target about a domain there is nothing to say about', async () => {
    // The documented trade-off, asserted rather than claimed: deciding on the
    // ledger alone means one fewer round trip per empty domain against a live
    // provider. It is also why an `EXTRA_*` finding is no longer raised for
    // such a domain — that is deliberate, and this is the behaviour that makes
    // it so.
    const asked: string[] = [];
    await runVerification(
      deps({
        getTargetCount: async (d: string) => {
          asked.push(d);
          return 0;
        },
      } as Partial<VerificationDeps>),
    );
    expect(asked).toEqual([]);
  });
});
