// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { runVerification } from './verification.ts';
import { createRealVerificationDeps } from './verification-implementations.ts';

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
  verifyTasks: false,
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

  it('stays unavailable for a reindexer that cannot hash at all (JMAP contacts)', async () => {
    // RENAMED 2026-08-05. This said "(CalDAV/CardDAV)", which stopped being
    // true when #143 was reversed — both DAV writers hash canonically now. The
    // property under test is unchanged and still load-bearing; only the
    // example was wrong, and a test named after a case that no longer exists
    // is how somebody deletes it as obsolete.
    //
    // The real one today is `JmapContactTarget`: a stored JMAP ContactCard has
    // no blobId and no route back to vCard bytes, so it omits `contentHashFor`
    // deliberately. This is the test that stops that omission turning into a
    // silent pass.
    const result = await verify(reindexer(sized([100, 200])));

    expect(result.mail.checksumUnavailable).toBe(2);
    expect(result.mail.checksumMismatches).toBe(0);
    // Reported, not silent — and count parity still gates.
    expect(result.mail.issues.map((i) => i.id)).toContain('CHECKSUM_UNAVAILABLE_mail');
    expect(result.recommendations.join(' ')).toMatch(/could not be content-verified/);
  });

  it('opens the cutover gate on count parity alone when NOTHING could be hashed — the owner\u2019s call', async () => {
    /**
     * WHAT THIS PINS, AND WHY IT IS NOT AN ASSERTION THAT THE POLICY IS RIGHT.
     *
     * The test above proves an all-unavailable checksum leg is REPORTED. It
     * stops there, and the consequence was left implicit. It is this:
     *
     * 1. nothing comparable → `checksumComparable === 0` → the ratio takes its
     *    documented `: 1` fallback, in BOTH `verifyDataType` (which feeds
     *    `determineVerificationStatus`) and `calculateVerificationScore`;
     * 2. counts match, so `matchPercentage` is 1 and there are no
     *    discrepancies;
     * 3. `determineVerificationStatus` therefore returns PASS — it reads
     *    percentages and counts, never `issues`, so the WARNING raised above
     *    cannot move it;
     * 4. PASS is the first arm of `canProceedToCutover`, so the gate opens on
     *    a report whose own issue list says *"this is an ABSENCE of content
     *    evidence, not evidence of a match"*.
     *
     * The fallback is DELIBERATE and the trade is real in both directions. A
     * `JmapContactTarget` has no route back to vCard bytes and omits
     * `contentHashFor` on purpose; scoring that 0 would put every JMAP-contact
     * migration permanently below the gate, which is not honesty, it is a
     * product that cannot cut over. And the counts ARE evidence — parity over
     * every recorded item, not a sample.
     *
     * But the report cannot presently tell those two apart:
     *   - a domain whose target CANNOT hash, ever, by design; and
     *   - a domain whose target CAN hash and failed on every single sample.
     * Both land on ratio 1, PASS, and an open gate. The first is a known
     * property of a connector. The second is a fault, and it is the one that
     * reads as "we checked and it was fine" when nothing was checked.
     *
     * Whether that second case should hold the gate shut is a decision about
     * when somebody may delete their Google account, which is the owner's and
     * not this test's. Recorded in workplan 0009. What this test does is make
     * the policy EXPLICIT: it is now stated, so changing it turns this red and
     * the change is visible rather than silent.
     */
    const result = await verify(reindexer(sized([100, 200])));

    expect(result.mail.checksumUnavailable).toBe(2);
    expect(result.mail.checksumMatches + result.mail.checksumMismatches, 'something was comparable after all').toBe(0);
    // Count parity is real evidence and it held.
    expect(result.mail.matchedCount).toBe(2);
    expect(result.mail.missingOnTarget).toBe(0);
    // ...and on that alone, the gate opens.
    expect(result.mail.status).toBe('PASS');
    expect(result.overallStatus).toBe('PASS');
    expect(result.canProceedToCutover).toBe(true);
    // The contradiction, in one place: the gate says proceed, the report says
    // no content was verified. Both of these must keep being true together,
    // or the owner has decided something and this test should say so.
    expect(result.mail.issues.map((i) => i.id)).toContain('CHECKSUM_UNAVAILABLE_mail');
    // ANSWERED 2026-09-21, and this is the line that answers it. The owner's
    // decision was (b): the gate still opens, and the report stops being
    // silent about WHY it opened. `contentEvidence` is that second axis — the
    // verdict above is unchanged, and beside it the report now says the
    // content leg had nothing.
    expect(result.contentEvidence).toBe('none');
  });

  it('says `checked` when every sampled item really was compared', async () => {
    // The control for the case above: same shape, evidence present. Without
    // this, `none` could be the only value the field ever takes and nobody
    // would notice.
    const result = await verify(reindexer(IDS.map((id, i) => ({
      naturalKey: id,
      targetId: `t${i}`,
      mailboxId: 'INBOX',
      sizeBytes: 10,
      contentHash: SOURCE_HASHES[HASHES[i]!]!,
    })) as TargetEntry[]));
    expect(result.mail.checksumUnavailable).toBe(0);
    expect(result.mail.checksumMatches).toBeGreaterThan(0);
    expect(result.contentEvidence).toBe('checked');
    expect(result.overallStatus).toBe('PASS');

    // AND THE FOUR DOMAINS NOBODY ASKED FOR DID NOT VOTE. `CONFIG` turns
    // calendar, contacts, files and tasks off, so this report carries four
    // SKIPPED domains beside the one that was measured — and it still reads
    // `checked`, not `partial` and not `none`.
    //
    // This is the whole of what keeps a mail-only migration honest, and it is
    // load-bearing rather than incidental: `summariseContentEvidence` sums
    // over EVERY domain, so it holds only because `notMeasured` reports a
    // domain it never measured with all three checksum counters at zero. Give
    // a not-measured domain a non-zero `checksumUnavailable` and this line
    // goes red, which is the point — that would be a mail migration reporting
    // partial content evidence because of a calendar nobody asked it to check.
    for (const domain of ['calendar', 'contacts', 'files', 'tasks'] as const) {
      expect(result[domain].status, domain).toBe('SKIPPED');
      expect(result[domain].checksumUnavailable, domain).toBe(0);
      expect(result[domain].checksumMatches + result[domain].checksumMismatches, domain).toBe(0);
    }
  });

  it('still says `checked` when every comparison came back DIFFERENT', async () => {
    // `contentEvidence` measures whether the content leg RAN, not whether it
    // was happy — that second question is `overallStatus`, and the two must
    // not be allowed to collapse into one.
    //
    // A mismatch is evidence. It is the most expensive evidence this gate can
    // buy: the item was sampled, the target was read, the hashes were compared
    // and they differ. Counting only the matches would report that same run as
    // `none` — "the content leg has no evidence behind it either way" — and a
    // person reading a FAIL beside `none` would reasonably conclude the check
    // could not be performed, when in fact it was performed and the bytes came
    // back wrong. That is the one misreading this field exists to prevent,
    // pointed the other way round.
    const result = await verify(reindexer(IDS.map((id, i) => ({
      naturalKey: id,
      targetId: `t${i}`,
      mailboxId: 'INBOX',
      sizeBytes: 10,
      // Same shape, same scheme, different bytes.
      contentHash: `${SOURCE_HASHES[HASHES[i]!]!}-changed`,
    })) as TargetEntry[]));

    expect(result.mail.checksumMismatches, 'nothing was compared at all').toBeGreaterThan(0);
    expect(result.mail.checksumMatches).toBe(0);
    expect(result.mail.checksumUnavailable).toBe(0);
    // Evidence: complete. Verdict: bad. Both, separately.
    expect(result.contentEvidence).toBe('checked');
    expect(result.overallStatus).not.toBe('PASS');
  });

  it('says `partial` when some were compared and some could not be', async () => {
    // The middle value has to be reachable too, or `partial` is decoration.
    // One entry carries its hash, the rest cannot be fetched.
    const entries = IDS.map((id, i) => ({
      naturalKey: id,
      targetId: `t${i}`,
      mailboxId: 'INBOX',
      sizeBytes: 10,
      contentHash: SOURCE_HASHES[HASHES[i]!]!,
    })) as TargetEntry[];
    const result = await verify(
      reindexer(
        entries.map((e, i) => (i === 0 ? e : { ...e, contentHash: undefined })) as TargetEntry[],
        async () => undefined,
      ),
    );
    expect(result.mail.checksumMatches).toBeGreaterThan(0);
    expect(result.mail.checksumUnavailable).toBeGreaterThan(0);
    expect(result.contentEvidence).toBe('partial');
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
