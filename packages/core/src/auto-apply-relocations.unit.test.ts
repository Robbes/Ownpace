// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * ADR-0031's four gates — the ones that replace the human who is no longer
 * looking. `applyRelocation`'s own gates are proven in
 * `apply-relocation.unit.test.ts`; what is exercised here is everything
 * auto-apply adds IN FRONT of that function, plus the proof that it never
 * becomes a second destructive path (the flags compose, they do not bypass).
 */

import { describe, it, expect, vi } from 'vitest';
import { autoApplyRelocations, AUTO_APPLY_RELOCATIONS_CAP } from './apply-deletion';
import { MemoryLedger } from './__testing__/memory';
import { asTenantId, asMappingId, type LedgerRecord, type RemovalResult } from '@openmig/shared';

const TENANT = asTenantId('a3110000-e29b-41d4-a716-4466554408aa');
const MAPPING = asMappingId('a3110000-e29b-41d4-a716-4466554408bb');

/** Every relocation was recorded before this, so the age gate reads "survived". */
const NEXT_PASS = '9999-01-01T00:00:00.000Z';
/** And before this one, nothing has survived anything. */
const SAME_PASS = '1970-01-01T00:00:00.000Z';

function row(key: string, hash: string, overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: key,
    contentHash: hash,
    targetId: `target/${key}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
    ...overrides,
  };
}

function fakeRemover(answer: RemovalResult = { kind: 'deleted' }, present = true) {
  return {
    removeItem: vi.fn(async () => answer),
    hasItem: vi.fn(async () => present),
  };
}

/** Seed one relocation pair: old row (moved) + arrival, sharing `hash`. */
async function seedPair(ledger: MemoryLedger, oldKey: string, newKey: string, hash: string) {
  await ledger.recordIfAbsent(row(oldKey, hash));
  await ledger.recordIfAbsent(row(newKey, hash));
  await ledger.recordMove(TENANT, MAPPING, 'file', oldKey, 'Docs', newKey);
}

/** Stable rows so the breaker's floor (20 placed items) can be crossed at will. */
async function seedStable(ledger: MemoryLedger, n: number) {
  for (let i = 0; i < n; i++) {
    await ledger.recordIfAbsent(row(`stable-${i}.txt`, `h-stable-${i}`));
  }
}

function deps(
  ledger: MemoryLedger,
  target: unknown,
  flags: { allow?: boolean; auto?: boolean } = {},
  onApplied?: (a: { naturalKeyHash: string; kind: string }) => Promise<void>,
) {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file' as const,
    ledger,
    target,
    allowApplyDeletions: flags.allow ?? true,
    autoApplyRelocations: flags.auto ?? true,
    ...(onApplied ? { onApplied } : {}),
  };
}

describe('the opt-in (ADR-0031: default OFF, and off means untouched)', () => {
  it('does nothing at all when the mapping has not opted in', async () => {
    const ledger = new MemoryLedger();
    await seedPair(ledger, 'a.txt', 'b.txt', 'h-1');
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target, { auto: false }), NEXT_PASS);

    expect(report.enabled).toBe(false);
    expect(report.applied).toEqual([]);
    expect(target.removeItem).not.toHaveBeenCalled();
  });

  it('does NOT bypass gate 1: auto on with allowApplyDeletions off refuses every item', async () => {
    // The auto flag EXTENDS the destructive opt-in, it never substitutes for
    // it — an owner who armed neither switch must get the same refusal a
    // button press would.
    const ledger = new MemoryLedger();
    await seedPair(ledger, 'a.txt', 'b.txt', 'h-1');
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target, { allow: false }), NEXT_PASS);

    expect(report.applied).toEqual([]);
    expect(report.leftForReview.map((l) => l.code)).toEqual(['not_enabled']);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});

describe('the happy path, narrated', () => {
  it('applies a clean, survived, unique pair — and tells the caller for the audit trail', async () => {
    const ledger = new MemoryLedger();
    await seedPair(ledger, 'a.txt', 'b.txt', 'h-1');
    const target = fakeRemover();
    const attributed: string[] = [];

    const report = await autoApplyRelocations(
      deps(ledger, target, {}, async ({ naturalKeyHash, kind }) => {
        attributed.push(`${naturalKeyHash}:${kind}`);
      }),
      NEXT_PASS,
    );

    expect(report.enabled).toBe(true);
    expect(report.applied).toEqual([{ naturalKeyHash: 'a.txt', kind: 'deleted' }]);
    expect(report.leftForReview).toEqual([]);
    // The durable half of "performed by system:auto-apply" is the caller's —
    // receipts and audit rows live per edition — so the hook must fire.
    expect(attributed).toEqual(['a.txt:deleted']);
    // And it went through the REAL applyRelocation: the target was asked
    // whether the new copy is present before the old one was removed.
    expect(target.hasItem).toHaveBeenCalled();
    expect(target.removeItem).toHaveBeenCalledTimes(1);
  });
});

describe('gate 2: survived a pass', () => {
  it('leaves a relocation recorded during the current pass in the queue', async () => {
    // A correlation born of a flaky listing looks exactly like a real move for
    // one pass and self-corrects on the next. Manual apply is protected by
    // human latency; this gate is that latency, restored.
    const ledger = new MemoryLedger();
    await seedPair(ledger, 'a.txt', 'b.txt', 'h-1');
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target), SAME_PASS);

    expect(report.applied).toEqual([]);
    expect(report.leftForReview.map((l) => l.code)).toEqual(['not_survived_pass']);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});

describe('gate 1: the pairing must be UNIQUE', () => {
  it('refuses when a third placed item holds the same bytes', async () => {
    // Under auto-apply the pairing IS the decision — nobody sees the from/to
    // paths who could notice nonsense. Every empty file shares a hash with
    // every other, so in practice this is the empty-file gate.
    const ledger = new MemoryLedger();
    await seedPair(ledger, 'a.txt', 'b.txt', 'h-empty');
    await ledger.recordIfAbsent(row('c.txt', 'h-empty'));
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target), NEXT_PASS);

    expect(report.applied).toEqual([]);
    expect(report.leftForReview.map((l) => l.code)).toEqual(['hash_not_unique']);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});

describe('gate 3: the breaker decides for the PASS', () => {
  it('stops wholesale when the open share would trip the mass-relocation breaker', async () => {
    // 10 open relocations against 40 placed items is 25% — above the 20%
    // threshold. NOTHING is applied: a per-pass cap must not become a way to
    // nibble through a mass event a human was supposed to look at.
    const ledger = new MemoryLedger();
    await seedStable(ledger, 20);
    for (let i = 0; i < 10; i++) {
      await seedPair(ledger, `old-${i}.txt`, `new-${i}.txt`, `h-pair-${i}`);
    }
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target), NEXT_PASS);

    expect(report.applied).toEqual([]);
    expect(report.stopped).toContain('moved or renamed');
    expect(report.considered).toBe(10);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});

describe('gate 4: the cap', () => {
  it('applies at most the cap per pass and says why the rest wait', async () => {
    const ledger = new MemoryLedger();
    // Enough stable rows that two open relocations stay under the breaker.
    await seedStable(ledger, 20);
    await seedPair(ledger, 'a.txt', 'b.txt', 'h-1');
    await seedPair(ledger, 'c.txt', 'd.txt', 'h-2');
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target), NEXT_PASS, 1);

    expect(report.applied).toHaveLength(1);
    expect(report.leftForReview.map((l) => l.code)).toEqual(['cap_reached']);
    expect(target.removeItem).toHaveBeenCalledTimes(1);
  });

  it('the default cap is the ADR number, exported for the owner to see', () => {
    expect(AUTO_APPLY_RELOCATIONS_CAP).toBe(50);
  });
});

describe('what never auto-applies', () => {
  it('ignores plain moves and acknowledged relocations — only OPEN relocations are candidates', async () => {
    const ledger = new MemoryLedger();
    await seedStable(ledger, 20);
    // A collection-only move (mail-shaped): no toNaturalKeyHash, never a candidate.
    await ledger.recordIfAbsent(row('mail-1', 'h-m'));
    await ledger.recordMove(TENANT, MAPPING, 'file', 'mail-1', 'Elsewhere');
    // A relocation somebody already answered with keep.
    await seedPair(ledger, 'kept-old.txt', 'kept-new.txt', 'h-kept');
    await ledger.resolveMove(TENANT, MAPPING, 'kept-old.txt', 'keep');
    const target = fakeRemover();

    const report = await autoApplyRelocations(deps(ledger, target), NEXT_PASS);

    expect(report.considered).toBe(0);
    expect(report.applied).toEqual([]);
    expect(target.removeItem).not.toHaveBeenCalled();
  });
});
