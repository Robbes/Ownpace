// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The verification gate must compare like with like.
//
// The ledger stores `item.natural_key_hash` = sha256Hex('mid:<message-id>') (and
// 'cal:'/'card:'/'file:' for the other domains). The target reindexers yield
// `TargetEntry.naturalKey` = the RAW Message-ID. verification-implementations.ts
// compared those two directly, so the sets could never intersect: every item was
// reported missing, every target entry reported extra, and the mandatory
// pre-cutover gate would FAIL on first real use.
//
// It survived because verification.integration.test.ts seeds
// `naturalKeyHash: 'hash1'` into the ledger AND `naturalKey: 'hash1'` into a fake
// reindexer — both sides are literally the same string, so they match by
// construction. That proves the algorithm, not the wiring.
//
// These tests use REAL derived keys on both sides: the ledger side is hashed the
// way a real sync hashes it, the target side is the raw key a real reindexer
// yields.

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  naturalKeyHash,
  fileNaturalKeyHash,
  type LedgerVerificationReader,
  type TargetReindexer,
  type TargetEntry,
} from '@openmig/shared';
import { createRealVerificationDeps } from './verification-implementations';

const TENANT = asTenantId('5f6e0000-e29b-41d4-a716-4466554434a1' as never);
const MAPPING = asMappingId('5f6e0000-e29b-41d4-a716-4466554434a2' as never);

// Three messages that were genuinely synced: the ledger holds their hashes.
const MESSAGE_IDS = ['a1@example.com', 'b2@example.com', 'c3@example.com'];
const MAIL_HASHES = MESSAGE_IDS.map((id) => naturalKeyHash(id));

/** Ledger reader returning the same hashes a real sync would have written. */
function ledgerReaderWith(hashes: string[]): LedgerVerificationReader {
  return {
    countItems: async () => hashes.length,
    totalSizeBytes: async () => 1000,
    getAllNaturalKeyHashes: async () => hashes,
    getSampleItems: async () => [],
  } as unknown as LedgerVerificationReader;
}

/** Reindexer yielding RAW natural keys, exactly as jmap/imap-dav listEntries does. */
function reindexerYielding(entries: TargetEntry[]): TargetReindexer {
  return {
    async *listEntries(): AsyncIterable<TargetEntry> {
      for (const e of entries) yield e;
    },
  } as unknown as TargetReindexer;
}

describe('verification natural-key comparison', () => {
  it('matches a target entry against its ledger row (raw key vs stored hash)', async () => {
    // The target genuinely holds all three messages, keyed the way JMAP/IMAP
    // report them: the raw Message-ID.
    const deps = createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: {
        checksumSamplePercentage: 5,
        minSampleSize: 10,
        maxSampleSize: 1000,
        requiredMatchPercentage: 0.99,
        maxDiscrepancyPercentage: 0.01,
        verifyMail: true,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: false,
      },
      verificationReader: ledgerReaderWith(MAIL_HASHES),
      targetReindexer: reindexerYielding(
        MESSAGE_IDS.map((id, i) => ({
          naturalKey: id, // RAW — this is what the real reindexers yield
          targetId: `t${i}`,
          mailboxId: 'INBOX',
        })),
      ),
    } as never);

    // Nothing is missing: every ledger row has its message on the target.
    const missing = await deps.findMissingOnTarget('mail');
    expect(missing).toEqual([]);
  });

  it('reports nothing extra when the target holds exactly the synced set', async () => {
    const deps = createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: {
        checksumSamplePercentage: 5,
        minSampleSize: 10,
        maxSampleSize: 1000,
        requiredMatchPercentage: 0.99,
        maxDiscrepancyPercentage: 0.01,
        verifyMail: true,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: false,
      },
      verificationReader: ledgerReaderWith(MAIL_HASHES),
      targetReindexer: reindexerYielding(
        MESSAGE_IDS.map((id, i) => ({ naturalKey: id, targetId: `t${i}`, mailboxId: 'INBOX' })),
      ),
    } as never);

    const extra = await deps.findExtraOnTarget('mail');
    expect(extra).toEqual([]);
  });

  it('counts the target items that correspond to ledger rows', async () => {
    const deps = createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: {
        checksumSamplePercentage: 5,
        minSampleSize: 10,
        maxSampleSize: 1000,
        requiredMatchPercentage: 0.99,
        maxDiscrepancyPercentage: 0.01,
        verifyMail: true,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: false,
      },
      verificationReader: ledgerReaderWith(MAIL_HASHES),
      targetReindexer: reindexerYielding(
        MESSAGE_IDS.map((id, i) => ({ naturalKey: id, targetId: `t${i}`, mailboxId: 'INBOX' })),
      ),
    } as never);

    expect(await deps.getTargetCount('mail')).toBe(3);
  });

  it('STILL detects a genuinely missing message (the gate must not just pass everything)', async () => {
    // The target is missing the third message — a real data-loss case.
    const deps = createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: {
        checksumSamplePercentage: 5,
        minSampleSize: 10,
        maxSampleSize: 1000,
        requiredMatchPercentage: 0.99,
        maxDiscrepancyPercentage: 0.01,
        verifyMail: true,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: false,
      },
      verificationReader: ledgerReaderWith(MAIL_HASHES),
      targetReindexer: reindexerYielding(
        MESSAGE_IDS.slice(0, 2).map((id, i) => ({
          naturalKey: id,
          targetId: `t${i}`,
          mailboxId: 'INBOX',
        })),
      ),
    } as never);

    const missing = await deps.findMissingOnTarget('mail');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.id).toBe(MAIL_HASHES[2]);
  });

  it('uses the file-domain hash for files, not the mail one', async () => {
    const paths = ['/Documents/a.txt', '/Documents/b.txt'];
    const deps = createRealVerificationDeps({
      tenantId: TENANT,
      mappingId: MAPPING,
      config: {
        checksumSamplePercentage: 5,
        minSampleSize: 10,
        maxSampleSize: 1000,
        requiredMatchPercentage: 0.99,
        maxDiscrepancyPercentage: 0.01,
        verifyMail: false,
        verifyCalendar: false,
        verifyContacts: false,
        verifyFiles: true,
      },
      verificationReader: ledgerReaderWith(paths.map((p) => fileNaturalKeyHash(p))),
      // Per-domain: `targetReindexer` (singular) is the MAIL target only, since
      // that is what every caller actually passes. A file reindexer goes here.
      targetReindexers: {
        files: reindexerYielding(
          paths.map((p, i) => ({ naturalKey: p, targetId: `f${i}`, mailboxId: '/' })),
        ),
      },
    } as never);

    expect(await deps.findMissingOnTarget('files')).toEqual([]);
  });
});
