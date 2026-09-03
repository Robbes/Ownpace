// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// The gate must measure the domains it says it measured — and only those.
//
// Two defects lived here, and they compounded:
//
//  1. `VerificationConfig.verifyMail` / `verifyCalendar` / `verifyContacts` /
//     `verifyFiles` were accepted and then IGNORED. `runVerification`
//     destructured the config as `_config` and verified all four domains
//     unconditionally, so the flags were decorative.
//
//  2. A single `targetReindexer` was applied to every domain. Callers pass the
//     MAIL target (it is what `buildDepsFromMapping` returns), so the ledger's
//     calendar/contact/file rows were compared against a listing of MAILBOXES,
//     hashed with the calendar/contact/file prefix — nothing could match, every
//     item came back missing, and any multi-domain migration FAILed the gate no
//     matter how complete it was.
//
// And where there was no reindexer at all, the two halves disagreed in the
// worst possible way: `getTargetCount` returned the LEDGER count (perfect
// fabricated parity) while `findMissingOnTarget` declared every item missing.
//
// A domain nobody looked at has not passed. These tests pin that.

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  calendarNaturalKeyHash,
  type LedgerVerificationReader,
  type TargetReindexer,
  type TargetEntry,
} from '@openmig/shared';
import { runVerification } from './verification.ts';
import { createRealVerificationDeps } from './verification-implementations.ts';

const TENANT = asTenantId('5f8a0000-e29b-41d4-a716-4466554436a1' as never);
const MAPPING = asMappingId('5f8a0000-e29b-41d4-a716-4466554436a2' as never);

const MAIL_IDS = ['m1@example.com', 'm2@example.com'];
const CAL_UIDS = ['event-1', 'event-2'];

/** Ledger holding two mail items and two calendar items. */
function ledgerReader(): LedgerVerificationReader {
  const byDomain: Record<string, string[]> = {
    email: MAIL_IDS.map((id) => naturalKeyHash(id)),
    calendar: CAL_UIDS.map((u) => calendarNaturalKeyHash(u)),
    contact: [],
    file: [],
  };
  return {
    countItems: async (_t: unknown, _m: unknown, domain: string) => byDomain[domain]!.length,
    totalSizeBytes: async () => 100,
    getAllNaturalKeyHashes: async (_t: unknown, _m: unknown, domain: string) => byDomain[domain]!,
    getSamples: async () => [],
  } as unknown as LedgerVerificationReader;
}

function reindexer(entries: TargetEntry[]): TargetReindexer {
  return {
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const e of entries) yield e;
    },
  } as unknown as TargetReindexer;
}

/** The mail target: yields raw Message-IDs, like JMAP/IMAP-DAV really do. */
const mailReindexer = () =>
  reindexer(MAIL_IDS.map((id, i) => ({ naturalKey: id, targetId: `t${i}`, mailboxId: 'INBOX' })));

const BASE_CONFIG = {
  checksumSamplePercentage: 5,
  minSampleSize: 10,
  maxSampleSize: 1000,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
};

function deps(overrides: {
  verifyCalendar?: boolean;
  verifyContacts?: boolean;
  verifyFiles?: boolean;
  targetReindexers?: Parameters<typeof createRealVerificationDeps>[0]['targetReindexers'];
}) {
  return createRealVerificationDeps({
    tenantId: TENANT,
    mappingId: MAPPING,
    config: {
      ...BASE_CONFIG,
      verifyMail: true,
      verifyCalendar: overrides.verifyCalendar ?? false,
      verifyContacts: overrides.verifyContacts ?? false,
      verifyFiles: overrides.verifyFiles ?? false,
      verifyTasks: false,
    },
    verificationReader: ledgerReader(),
    targetReindexers: overrides.targetReindexers ?? { mail: mailReindexer() },
  });
}

describe('verification domain scope', () => {
  it('honours verifyCalendar=false instead of measuring it anyway', async () => {
    const result = await runVerification(deps({}));

    expect(result.calendar.status).toBe('SKIPPED');
    // The specific regression: before, calendar was measured against the mail
    // reindexer and came back with 2 missing.
    expect(result.calendar.missingOnTarget).toBe(0);
  });

  it('verifies mail correctly while the other domains are off', async () => {
    const result = await runVerification(deps({}));

    expect(result.mail.status).toBe('PASS');
    expect(result.mail.sourceCount).toBe(2);
    expect(result.mail.targetCount).toBe(2);
    expect(result.mail.missingOnTarget).toBe(0);
  });

  it('reports an enabled domain with no reindexer as NOT_VERIFIABLE, and blocks cutover', async () => {
    const result = await runVerification(deps({ verifyCalendar: true }));

    expect(result.calendar.status).toBe('NOT_VERIFIABLE');
    expect(result.overallStatus).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
    expect(result.recommendations.join(' ')).toMatch(/Cannot verify calendar/);
  });

  it('never reports fabricated parity for an unreadable domain', async () => {
    const result = await runVerification(deps({ verifyCalendar: true }));

    // The old fallback returned the ledger count as the target count, so a
    // domain nobody could read showed sourceCount === targetCount. The report
    // still says what the ledger recorded — it just never claims a target-side
    // number it does not have.
    expect(result.calendar.sourceCount).toBe(2);
    expect(result.calendar.targetCount).toBe(0);
    expect(result.calendar.targetCount).not.toBe(result.calendar.sourceCount);
    expect(result.calendar.status).not.toBe('PASS');
    // ...and it is not dressed up as data loss either.
    expect(result.calendar.missingOnTarget).toBe(0);
  });

  it('verifies calendar for real once a calendar reindexer is supplied', async () => {
    const result = await runVerification(
      deps({
        verifyCalendar: true,
        targetReindexers: {
          mail: mailReindexer(),
          calendar: reindexer(
            CAL_UIDS.map((u, i) => ({ naturalKey: u, targetId: `c${i}`, mailboxId: 'default' })),
          ),
        },
      }),
    );

    expect(result.calendar.status).toBe('PASS');
    expect(result.calendar.sourceCount).toBe(2);
    expect(result.calendar.targetCount).toBe(2);
    // Contacts and files are switched off, which is neutral for the verdict.
    expect(result.overallStatus).toBe('PASS');
    expect(result.canProceedToCutover).toBe(true);
  });

  it('catches genuinely missing calendar items when calendar IS readable', async () => {
    const result = await runVerification(
      deps({
        verifyCalendar: true,
        targetReindexers: {
          mail: mailReindexer(),
          // Only the first event made it across.
          calendar: reindexer([{ naturalKey: CAL_UIDS[0]!, targetId: 'c0', mailboxId: 'default' }]),
        },
      }),
    );

    expect(result.calendar.missingOnTarget).toBe(1);
    expect(result.calendar.status).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
  });

  it('does not let skipped domains inflate the score', async () => {
    // Mail is genuinely broken; every other domain is switched off. Averaging
    // the whole set, where the others score a perfect 1.0, would hide it.
    const broken = createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: {
        ...BASE_CONFIG,
        verifyMail: true,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: false,
        verifyTasks: false,
      },
      verificationReader: ledgerReader(),
      targetReindexers: { mail: reindexer([]) }, // target holds nothing
    });

    const result = await runVerification(broken);

    expect(result.mail.missingOnTarget).toBe(2);
    expect(result.score).toBeLessThan(0.5);
    expect(result.canProceedToCutover).toBe(false);
  });

  it('names every skipped domain in the report rather than passing silently', async () => {
    const result = await runVerification(deps({}));

    // A deliberate config choice does not degrade the verdict — a mail-only
    // migration should not report WARN forever because it did not check
    // calendars. But "we did not look" must never be invisible either: the
    // domain carries SKIPPED, an issue, and a recommendation line.
    expect(result.mail.status).toBe('PASS');
    expect(result.overallStatus).toBe('PASS');

    for (const domain of ['calendar', 'contacts', 'files'] as const) {
      expect(result[domain].status).toBe('SKIPPED');
      expect(result.recommendations.join('\n')).toContain(`${domain} was not verified`);
    }
    // The one thing it must never say about an unchecked domain.
    expect(result.calendar.status).not.toBe('PASS');
  });
});
