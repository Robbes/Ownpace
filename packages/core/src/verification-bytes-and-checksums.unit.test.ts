// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The two halves of §20 that had never actually run.
//
//  - `totalBytesTarget` was null for every domain, because nothing on
//    `TargetEntry` carried a size. (Before that it was worse: it returned the
//    SOURCE total, so every report showed perfect byte parity, measured on
//    nothing.)
//  - `checksumUnavailable` was non-zero for every sample, because no reindexer
//    supplied a content hash — so "checksum sampling", half the gate, never
//    compared anything.
//
// Both now measure for real. What these tests defend is the honesty of the
// boundary: a partial measurement must read as "not measured", never as a
// smaller number than the source.

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  type LedgerVerificationReader,
  type TargetReindexer,
  type TargetEntry,
} from '@openmig/shared';
import { runVerification } from './verification';
import { createRealVerificationDeps } from './verification-implementations';

const TENANT = asTenantId('5fad0000-e29b-41d4-a716-4466554439a1' as never);
const MAPPING = asMappingId('5fad0000-e29b-41d4-a716-4466554439a2' as never);

const IDS = ['m1@example.com', 'm2@example.com'];
const HASHES = IDS.map((id) => naturalKeyHash(id));
/** What the ledger recorded for each message's source content. */
const SOURCE_HASHES: Record<string, string> = { [HASHES[0]!]: 'src-1', [HASHES[1]!]: 'src-2' };

function reader(): LedgerVerificationReader {
  return {
    countItems: async (_t: unknown, _m: unknown, domain: string) => (domain === 'email' ? 2 : 0),
    totalSizeBytes: async (_t: unknown, _m: unknown, domain: string) => (domain === 'email' ? 300 : 0),
    getAllNaturalKeyHashes: async (_t: unknown, _m: unknown, domain: string) =>
      domain === 'email' ? HASHES : [],
    getSamples: async (_t: unknown, _m: unknown, domain: string) =>
      domain === 'email'
        ? HASHES.map((h, i) => ({ id: `s${i}`, naturalKeyHash: h, contentHash: SOURCE_HASHES[h]! }))
        : [],
  } as unknown as LedgerVerificationReader;
}

function reindexer(
  entries: TargetEntry[],
  contentHashFor?: (entry: TargetEntry) => Promise<string | undefined>,
): TargetReindexer {
  const base = {
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const e of entries) yield e;
    },
  };
  return (contentHashFor ? { ...base, contentHashFor } : base) as unknown as TargetReindexer;
}

const CONFIG = {
  checksumSamplePercentage: 100,
  minSampleSize: 2,
  maxSampleSize: 100,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
  verifyMail: true,
  verifyCalendar: false,
  verifyContacts: false,
  verifyFiles: false,
};

function verify(mail: TargetReindexer) {
  return runVerification(
    createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: CONFIG,
      verificationReader: reader(),
      targetReindexers: { mail },
    }),
  );
}

/** Entries with sizes, matching the ledger's two messages. */
const sized = (sizes: Array<number | undefined>) =>
  IDS.map((id, i) => ({
    naturalKey: id,
    targetId: `t${i}`,
    mailboxId: 'INBOX',
    ...(sizes[i] === undefined ? {} : { sizeBytes: sizes[i] }),
  })) as TargetEntry[];

describe('totalBytesTarget', () => {
  it('sums the sizes the target reported', async () => {
    const result = await verify(reindexer(sized([100, 200])));

    expect(result.mail.totalBytesTarget).toBe(300);
    expect(result.mail.totalBytesSource).toBe(300);
  });

  it('reports a real difference rather than hiding it', async () => {
    // A target that is genuinely 40 bytes short. Measuring is only worth doing
    // if it can disagree with the source.
    const result = await verify(reindexer(sized([100, 160])));

    expect(result.mail.totalBytesTarget).toBe(260);
    expect(result.mail.totalBytesSource).toBe(300);
  });

  it('stays null when only SOME items could be measured', async () => {
    // The dangerous alternative is summing what we have: 100 against a source
    // total of 300 reads as two-thirds of the mail missing.
    const result = await verify(reindexer(sized([100, undefined])));

    expect(result.mail.totalBytesTarget).toBeNull();
  });

  it('is null when nothing carries a size at all', async () => {
    const result = await verify(reindexer(sized([undefined, undefined])));
    expect(result.mail.totalBytesTarget).toBeNull();
  });

  it('never gates the verdict on bytes', async () => {
    const short = await verify(reindexer(sized([1, 1])));
    const exact = await verify(reindexer(sized([100, 200])));

    // Counts and checksums decide; bytes are reported.
    expect(short.mail.status).toBe(exact.mail.status);
    expect(short.canProceedToCutover).toBe(exact.canProceedToCutover);
  });
});

describe('checksum sampling', () => {
  it('compares real target hashes when the reindexer can supply them', async () => {
    const entries = sized([100, 200]);
    const byTarget: Record<string, string> = { t0: 'src-1', t1: 'src-2' };
    const result = await verify(
      reindexer(entries, async (e) => byTarget[e.targetId]),
    );

    // The whole point: the checksum leg actually ran.
    expect(result.mail.checksumMatches).toBe(2);
    expect(result.mail.checksumMismatches).toBe(0);
    expect(result.mail.checksumUnavailable).toBe(0);
    expect(result.mail.status).toBe('PASS');
  });

  it('FAILS on a genuine content mismatch', async () => {
    const entries = sized([100, 200]);
    const byTarget: Record<string, string> = { t0: 'src-1', t1: 'CORRUPTED' };
    const result = await verify(reindexer(entries, async (e) => byTarget[e.targetId]));

    expect(result.mail.checksumMismatches).toBe(1);
    expect(result.mail.status).toBe('FAIL');
    expect(result.canProceedToCutover).toBe(false);
  });

  it('counts an unreadable item as unavailable, not as corrupt', async () => {
    // A GET that fails is not evidence of corruption. Scoring it as a mismatch
    // is the bug that made the gate FAIL every healthy migration (#139).
    const entries = sized([100, 200]);
    const byTarget: Record<string, string | undefined> = { t0: 'src-1', t1: undefined };
    const result = await verify(reindexer(entries, async (e) => byTarget[e.targetId]));

    expect(result.mail.checksumMatches).toBe(1);
    expect(result.mail.checksumMismatches).toBe(0);
    expect(result.mail.checksumUnavailable).toBe(1);
    expect(result.mail.status).toBe('PASS');
  });

  it('stays unavailable for a reindexer that cannot hash at all (CalDAV/CardDAV)', async () => {
    const result = await verify(reindexer(sized([100, 200])));

    expect(result.mail.checksumUnavailable).toBe(2);
    expect(result.mail.checksumMismatches).toBe(0);
    // Reported, not silent — and count parity still gates.
    expect(result.mail.issues.map((i) => i.id)).toContain('CHECKSUM_UNAVAILABLE_mail');
    expect(result.recommendations.join(' ')).toMatch(/could not be content-verified/);
  });

  it('prefers a hash already present on the entry over a fetch', async () => {
    // If the listing was cheap enough to carry one, do not pay for a GET.
    let fetches = 0;
    const entries = IDS.map((id, i) => ({
      naturalKey: id,
      targetId: `t${i}`,
      mailboxId: 'INBOX',
      sizeBytes: 10,
      contentHash: SOURCE_HASHES[HASHES[i]!]!,
    })) as TargetEntry[];

    const result = await verify(
      reindexer(entries, async () => {
        fetches++;
        return undefined;
      }),
    );

    expect(fetches).toBe(0);
    expect(result.mail.checksumMatches).toBe(2);
  });
});
