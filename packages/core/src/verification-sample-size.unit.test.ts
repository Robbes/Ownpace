// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * How much of the §20 content gate actually ran — and saying so honestly.
 *
 * Found in the self-hosted e2e on 2026-08-06, which printed:
 *
 *     [e2e] mail checksums: 8 match, 0 mismatch, 0 unavailable of 10 sampled
 *
 * 8 + 0 + 0 does not reach 10, and the comparison loop is exhaustive — every
 * source sample increments exactly one of those three counters. So the
 * DENOMINATOR was wrong, not the numerators. `checksumSampleSize` published
 * `calculateSampleSize()`, the number REQUESTED, while `minSampleSize` is a
 * floor on the percentage and not a promise that many items exist: 8 mail items
 * against a floor of 10 asked for 10, got the 8 that were there, and reported
 * 10.
 *
 * Nothing was mis-verified by that. What was wrong is the coverage figure in
 * the report an operator reads before authorising a cutover — it was larger
 * than the coverage. A number that can exceed what was examined can only ever
 * overstate.
 *
 * The fix is in two places on purpose, and both are tested here:
 *
 *   1. `calculateSampleSize` clamps to the item count — never ask for more than
 *      exist. This is the cause.
 *   2. `checksumSampleSize` reports `sourceSamples.length` — what was examined,
 *      whatever any `getSourceSamples` implementation hands back. This holds
 *      the invariant true by construction rather than by agreement between two
 *      functions.
 *
 * **The fake reader below honours its `count` argument.** That is the whole
 * load-bearing property of this file: a fake that returned everything it had
 * regardless of `count` would pass every test here while proving nothing about
 * the clamp.
 */

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

/** Eight messages — the count the e2e was actually carrying. */
const IDS = Array.from({ length: 8 }, (_, i) => `m${i + 1}@example.com`);
const HASHES = IDS.map((id) => naturalKeyHash(id));

/** Every `getSamples` call this run made, so the CLAMP can be asserted. */
interface Recorder {
  readonly requested: number[];
}

/**
 * A ledger reader over `itemCount` messages.
 *
 * `getSamples` applies `.slice(0, count)` exactly as the real Drizzle query
 * applies `.limit(count)` — and `countItems` and `getSamples` read the same
 * population through the same filter, which is true of the real implementation
 * too. `shortfall` breaks that on purpose for the two tests that need a deps
 * implementation returning less than it was asked for.
 */
function reader(
  itemCount: number,
  rec: Recorder,
  opts: { readonly shortfall?: number } = {},
): LedgerVerificationReader {
  const hashes = HASHES.slice(0, itemCount);
  return {
    countItems: async (_t: unknown, _m: unknown, domain: string) =>
      domain === 'email' ? itemCount : 0,
    totalSizeBytes: async () => 0,
    getAllNaturalKeyHashes: async (_t: unknown, _m: unknown, domain: string) =>
      domain === 'email' ? hashes : [],
    getSamples: async (_t: unknown, _m: unknown, domain: string, count: number) => {
      if (domain !== 'email') return [];
      rec.requested.push(count);
      const take = opts.shortfall === undefined ? count : Math.min(count, opts.shortfall);
      return hashes
        .slice(0, take)
        .map((h, i) => ({ id: `s${i}`, naturalKeyHash: h, contentHash: `src-${i}` }));
    },
  } as unknown as LedgerVerificationReader;
}

/** A target holding all `itemCount` messages, with hashes that all match. */
function reindexer(itemCount: number, hashable = true): TargetReindexer {
  const entries = IDS.slice(0, itemCount).map(
    (id, i) => ({ naturalKey: id, targetId: `t${i}`, mailboxId: 'INBOX' }) as TargetEntry,
  );
  return {
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const e of entries) yield e;
    },
    // Matching the ledger's `src-${i}`, so these samples COMPARE rather than
    // landing in `checksumUnavailable` — the counters only add up to something
    // interesting if the comparison actually happens.
    contentHashFor: async (entry: TargetEntry) =>
      hashable ? `src-${IDS.indexOf(entry.naturalKey)}` : undefined,
  } as unknown as TargetReindexer;
}

function config(over: Partial<Record<string, number | boolean>> = {}) {
  return {
    checksumSamplePercentage: 10,
    minSampleSize: 10,
    maxSampleSize: 100,
    requiredMatchPercentage: 0.99,
    maxDiscrepancyPercentage: 0.01,
    verifyMail: true,
    verifyCalendar: false,
    verifyContacts: false,
    verifyFiles: false,
    ...over,
  } as never;
}

async function verify(
  itemCount: number,
  over: Partial<Record<string, number | boolean>> = {},
  opts: { readonly shortfall?: number; readonly hashable?: boolean } = {},
) {
  const rec: Recorder = { requested: [] };
  const result = await runVerification(
    createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: config(over),
      verificationReader: reader(itemCount, rec, opts),
      targetReindexers: { mail: reindexer(itemCount, opts.hashable ?? true) },
    } as never),
  );
  return { mail: result.mail, requested: rec.requested };
}

describe('the sample size the report publishes', () => {
  it('reproduces the e2e case: 8 items, a floor of 10, and the counters ADD UP', async () => {
    // The exact shape of the run that exposed this — `minSampleSize: 10` over a
    // domain holding 8. The old code published 10 here.
    const { mail } = await verify(8);

    expect(mail.checksumSampleSize).toBe(8);
    expect(mail.checksumMatches + mail.checksumMismatches + mail.checksumUnavailable).toBe(
      mail.checksumSampleSize,
    );
  });

  it('CLAMPS THE REQUEST too, not just the number it prints afterwards', async () => {
    // The assertion that makes this a fix rather than a cosmetic patch. If the
    // clamp lived only in the returned report, the ledger would still be asked
    // for 10 rows on every domain smaller than the floor — the report would
    // merely stop admitting it.
    const { requested } = await verify(8);

    expect(requested).toEqual([8]);
  });

  it('leaves the ordinary case alone — a floor BELOW the item count still applies', async () => {
    // 8 items, floor 3, 10% -> calculated 0 -> the floor wins at 3. The clamp
    // must not disturb this; a fix that quietly made every sample the whole
    // population would pass the test above and cost a full content scan on a
    // million-item mailbox.
    const { mail, requested } = await verify(8, { minSampleSize: 3 });

    expect(requested).toEqual([3]);
    expect(mail.checksumSampleSize).toBe(3);
  });

  it('still honours maxSampleSize when it bites before the item count does', async () => {
    const { mail, requested } = await verify(8, {
      minSampleSize: 1,
      checksumSamplePercentage: 100,
      maxSampleSize: 5,
    });

    expect(requested).toEqual([5]);
    expect(mail.checksumSampleSize).toBe(5);
  });

  it('samples everything when the percentage asks for everything', async () => {
    const { mail } = await verify(8, { checksumSamplePercentage: 100, minSampleSize: 1 });

    expect(mail.checksumSampleSize).toBe(8);
    expect(mail.checksumMatches).toBe(8);
  });

  it('keeps the invariant when samples are UNCOMPARABLE rather than matching', async () => {
    // The live JMAP-contacts shape: samples drawn, no target content hash. The
    // three counters must still account for every examined item, or the
    // "unavailable" warning is measured against a denominator nobody can trust.
    const { mail } = await verify(8, {}, { hashable: false });

    expect(mail.checksumSampleSize).toBe(8);
    expect(mail.checksumUnavailable).toBe(8);
    expect(mail.checksumMatches + mail.checksumMismatches + mail.checksumUnavailable).toBe(8);
  });

  it('is 0 for an empty domain, which is a real answer and not a warning', async () => {
    const { mail } = await verify(0);

    expect(mail.checksumSampleSize).toBe(0);
    expect(mail.issues.map((i) => i.id)).not.toContain('CHECKSUM_NOT_SAMPLED_mail');
  });
});

describe('a deps implementation that returns less than it was asked for', () => {
  it('reports what was EXAMINED, not what was requested', async () => {
    // The brace to the clamp's belt. `calculateSampleSize` and the ledger query
    // agree today because they read the same rows through the same filter — but
    // that is an agreement between two functions, and this is the invariant
    // holding without it.
    const { mail, requested } = await verify(8, { minSampleSize: 4 }, { shortfall: 2 });

    expect(requested).toEqual([4]);
    expect(mail.checksumSampleSize).toBe(2);
    expect(mail.checksumMatches).toBe(2);
  });

  it('WARNS when nothing at all could be sampled from a domain that holds items', async () => {
    // A checksum leg that never ran otherwise scores exactly like one that ran
    // and found nothing wrong: `checksumMatchPercentage` falls back to 1 for
    // want of contrary evidence, and `checksumUnavailable` is 0 so the
    // neighbouring warning stays silent too. The operator reading the §20
    // report could not tell "no content evidence" from "content evidence, all
    // good".
    const { mail } = await verify(8, {}, { shortfall: 0 });

    expect(mail.checksumSampleSize).toBe(0);
    const issue = mail.issues.find((i) => i.id === 'CHECKSUM_NOT_SAMPLED_mail');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/did not run at all/);
    expect(issue!.message).toMatch(/ABSENCE of content evidence/);
    // The count is named so the reader can see it is not an empty domain.
    expect(issue!.message).toMatch(/8 item\(s\) are recorded/);
  });
});
