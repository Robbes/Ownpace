// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FLAG STORED IN A COUNTER IS READ BACK AS A COUNT, AND THE SCREEN PRINTS IT.
 *
 * Live, 2026-09-14. The owner's Failures page showed `5 tries` against a Google
 * Doc under `nativeFilePolicy="refuse"`, and `6 tries` on two rows beside it —
 * above `MAX_ITEM_ATTEMPTS`, so not a count of anything. Every one of those
 * items had been attempted ONCE.
 *
 * `attempt_count` was doing two jobs. Parking — "a person must decide this,
 * stop retrying it" — was implemented by writing the ceiling into the counter
 * (`attempt_count = MAX_ITEM_ATTEMPTS` on insert, `GREATEST(count + 1, MAX)`
 * on update), and `needsDecision` was derived back out of it. The mechanism
 * worked. What it could not do is tell the truth, because the screen renders
 * that number verbatim: a policy refusal the loop deliberately parks on FIRST
 * sight — `domain-sync.ts` says so in as many words, "a policy that answers the
 * same way every time is not something to try five times" — arrived in front of
 * the owner as five attempts against their Google account that never happened.
 *
 * Migration 0046 separates them. These are over `MemoryLedger`, the mirror
 * `PgLedger` is written against; the Postgres half of the same contract is
 * pinned in `packages/ledger/src/a-parked-row-is-not-a-tall-count.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { MemoryLedger } from './__testing__/memory.ts';
import { classifyKnownItem } from './domain-sync.ts';
import {
  asMappingId,
  asTenantId,
  MAX_ITEM_ATTEMPTS,
  type LedgerRecord,
} from '@openmig/shared';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111' as never);
const MAPPING = asMappingId('33333333-3333-4333-8333-333333333333' as never);

function record(over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: 'h1',
    contentHash: 'c1',
    targetId: '',
    createdAt: new Date().toISOString(),
    sizeBytes: 0,
    status: 'failed',
    ...over,
  } as LedgerRecord;
}

const POLICY_REFUSAL =
  '"Voorbeeldtekst.docx" is a Google document and has no file to copy.';

describe('a parked item was tried once, and says so', () => {
  it('counts ONE attempt, not the ceiling', async () => {
    // THE HEADLINE. Before this, a park wrote MAX_ITEM_ATTEMPTS into the count
    // and the Failures page printed it as "5 tries".
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    const row = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(row.attemptCount).toBe(1);
    expect(row.attemptCount).not.toBe(MAX_ITEM_ATTEMPTS);
  });

  it('records the park as its own fact', async () => {
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    const row = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(row.parkedAt).toBeDefined();
  });

  it('still waits on a person, on one attempt', async () => {
    // The behaviour the old encoding bought, kept: `needsDecision` no longer
    // reads a count, so parking at 1 attempt still takes the item out of the
    // automatic lane.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(1);
    expect(failure?.needsDecision).toBe(true);
    expect(failure?.parkedAt).toBeDefined();
  });

  it('never walks past the ceiling when parked again', async () => {
    // `GREATEST(count + 1, MAX)` on an already-parked row gave 6, then 7 — a
    // number that is neither attempts nor parked-ness. Two of those were on
    // the owner's screen.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });
    const again = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(again.attemptCount).toBe(2);
    expect(again.attemptCount).toBeLessThan(MAX_ITEM_ATTEMPTS);
  });

  it('keeps the FIRST park time when parked again', async () => {
    // "Waiting since" is the question an operator asks of a parked row, and
    // re-stamping it on every pass would answer "since a moment ago" forever.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    const first = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });
    const again = await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(again.parkedAt).toBe(first.parkedAt);
  });
});

describe('an ordinary failure is untouched', () => {
  it('counts up one at a time and is not parked', async () => {
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, 'ECONNRESET');
    const second = await ledger.recordFailure(r, 'ECONNRESET');

    expect(second.attemptCount).toBe(2);
    expect(second.parkedAt).toBeUndefined();
  });

  it('still waits on a person once its attempts run out', async () => {
    // The OTHER route to needsDecision, and the one where the count is the
    // truth and worth printing.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    for (let i = 0; i < MAX_ITEM_ATTEMPTS; i++) await ledger.recordFailure(r, 'ECONNRESET');

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(MAX_ITEM_ATTEMPTS);
    expect(failure?.needsDecision).toBe(true);
    expect(failure?.parkedAt).toBeUndefined();
  });
});

describe('a retry un-parks as well as zeroing', () => {
  it('clears the park, so the next pass fetches the item again', async () => {
    // A row left parked would be skipped however low its count went — which is
    // the same "fix that unparked nothing" shape, one layer down.
    const ledger = new MemoryLedger();
    const r = record();
    await ledger.recordIfAbsent(r);
    await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });

    expect(await ledger.resolveFailure(TENANT, MAPPING, 'h1', 'retry')).toBe(true);

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(0);
    expect(failure?.needsDecision).toBe(false);
    expect(failure?.parkedAt).toBeUndefined();
  });

  it('clears it for a whole group too', async () => {
    const ledger = new MemoryLedger();
    for (const n of [1, 2]) {
      const r = record({ naturalKeyHash: `g${n}` });
      await ledger.recordIfAbsent(r);
      await ledger.recordFailure(r, POLICY_REFUSAL, { park: true });
    }

    expect(
      await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', { errorContains: 'Google' }),
    ).toBe(2);

    for (const f of await ledger.listFailures(TENANT, MAPPING)) {
      expect(f.needsDecision).toBe(false);
      expect(f.parkedAt).toBeUndefined();
    }
  });
});

describe('the sync loop skips a parked item without consulting its count', () => {
  it('calls a parked row needs-decision on ONE attempt', () => {
    // Without this the loop would fetch the item four more times, against a
    // policy that answers the same way every pass — the waste `park` exists to
    // prevent, and which the old ceiling-write bought by accident.
    expect(
      classifyKnownItem(
        { status: 'failed', attemptCount: 1, parkedAt: new Date().toISOString() },
        undefined,
        undefined,
      ),
    ).toBe('needs-decision');
  });

  it('still retries an ordinary failure that has attempts left', () => {
    expect(classifyKnownItem({ status: 'failed', attemptCount: 1 }, undefined, undefined)).toBe(
      'retry-failed',
    );
  });

  it('still stops an ordinary failure at the ceiling', () => {
    expect(
      classifyKnownItem(
        { status: 'failed', attemptCount: MAX_ITEM_ATTEMPTS },
        undefined,
        undefined,
      ),
    ).toBe('needs-decision');
  });
});
