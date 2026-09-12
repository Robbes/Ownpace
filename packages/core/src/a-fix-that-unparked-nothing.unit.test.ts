// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIX THAT UNPARKED NOTHING.
 *
 * Live, 2026-09-11. A non-recursive MKCOL meant every file in a subfolder was
 * refused by the DAV target, and each one retried until `MAX_ITEM_ATTEMPTS`
 * took it out of the loop. The fix landed, the target started creating parent
 * collections, and **82 items stayed exactly where they were** — because
 * parking is a stored `attempt_count`, and nothing about deploying a fix
 * lowers it. The migration reported itself complete over a hole.
 *
 * The two routes out were 82 button presses or SQL against the ledger. The
 * owner ran the SQL, which does the first half of a retry and not the second:
 * the product's retry has always been "zero the attempts AND drop the cursors"
 * (ADR-0020), and a hand-written UPDATE is only ever the first.
 *
 * So one decision over a group. These tests are over `MemoryLedger`, which is
 * the mirror `PgLedger` is written against — the Postgres half of the same
 * contract is pinned in
 * `packages/ledger/src/a-needle-postgres-read-as-a-pattern.integration.test.ts`,
 * because the one property a fake cannot prove is what LIKE does with a `%`.
 */

import { describe, it, expect } from 'vitest';
import { MemoryLedger } from './__testing__/memory.ts';
import { asMappingId, asTenantId, type LedgerRecord } from '@openmig/shared';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111' as never);
const OTHER_TENANT = asTenantId('22222222-2222-4222-8222-222222222222' as never);
const MAPPING = asMappingId('33333333-3333-4333-8333-333333333333' as never);
const OTHER_MAPPING = asMappingId('44444444-4444-4444-8444-444444444444' as never);

function record(over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: 'h1',
    createdAt: new Date().toISOString(),
    ...over,
  } as LedgerRecord;
}

/** Seeds a row, then fails it — parked, exactly as the live 82 were. */
async function parked(
  ledger: MemoryLedger,
  over: Partial<LedgerRecord>,
  error: string,
): Promise<void> {
  const r = record(over);
  await ledger.recordIfAbsent(r);
  await ledger.recordFailure(r, error, { park: true });
}

describe('one decision over a group of failures', () => {
  it('retries every item in a domain and says how many it changed', async () => {
    const ledger = new MemoryLedger();
    for (const n of [1, 2, 3]) {
      await parked(ledger, { naturalKeyHash: `f${n}` }, 'MKCOL 404 on the parent collection');
    }
    // A calendar item failed for its own, unrelated reason.
    await parked(ledger, { naturalKeyHash: 'c1', itemType: 'calendar' }, 'calendar said no');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', { domain: 'file' });

    expect(matched).toBe(3);
    // The count is not the claim — the rows are. A retry is a zeroed attempt
    // count, which is the whole of "eligible again".
    for (const n of [1, 2, 3]) {
      expect((await ledger.find(TENANT, MAPPING, 'file', `f${n}`))?.attemptCount).toBe(0);
    }
    // And the calendar item is untouched: a domain the press did not name is
    // not "everything else".
    expect((await ledger.find(TENANT, MAPPING, 'calendar', 'c1'))?.attemptCount).toBeGreaterThan(0);
  });

  it('matches the error substring LITERALLY — a % in the needle is a % in the text', async () => {
    const ledger = new MemoryLedger();
    // `(50%).pdf` came out of a real filename. If `%` were LIKE's wildcard,
    // the needle `50%` would match "50" followed by anything — which on a
    // bulk retry is the difference between the group somebody chose and most
    // of the queue.
    await parked(ledger, { naturalKeyHash: 'a' }, 'PUT refused for (50%).pdf');
    await parked(ledger, { naturalKeyHash: 'b' }, 'PUT refused for 500-page-report.pdf');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: '50%',
    });

    expect(matched).toBe(1);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'a'))?.attemptCount).toBe(0);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'b'))?.attemptCount).toBeGreaterThan(0);
  });

  it('narrows on domain AND substring together, not either of them', async () => {
    const ledger = new MemoryLedger();
    await parked(ledger, { naturalKeyHash: 'a' }, 'MKCOL 404');
    await parked(ledger, { naturalKeyHash: 'b' }, 'quota exceeded');
    await parked(ledger, { naturalKeyHash: 'c', itemType: 'calendar' }, 'MKCOL 404');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      domain: 'file',
      errorContains: 'MKCOL',
    });

    expect(matched).toBe(1);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'a'))?.attemptCount).toBe(0);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'b'))?.attemptCount).toBeGreaterThan(0);
    expect((await ledger.find(TENANT, MAPPING, 'calendar', 'c'))?.attemptCount).toBeGreaterThan(0);
  });

  it('accepts a group terminally, and keeps the error that justified it', async () => {
    const ledger = new MemoryLedger();
    await parked(ledger, { naturalKeyHash: 'a' }, 'Google-native file has no bytes to copy');
    await parked(ledger, { naturalKeyHash: 'b' }, 'Google-native file has no bytes to copy');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'accept', {
      errorContains: 'Google-native',
    });

    expect(matched).toBe(2);
    const row = await ledger.find(TENANT, MAPPING, 'file', 'a');
    expect(row?.status).toBe('left_behind');
    // The audit trail for a decision is worthless without the reason it was
    // made, so `accept` moves the row and leaves the error on it.
    expect(row?.lastError).toContain('Google-native');
  });

  it('touches only rows that are still FAILED', async () => {
    const ledger = new MemoryLedger();
    // One succeeded on a later pass; one somebody already accepted.
    const ok = record({ naturalKeyHash: 'ok' });
    await ledger.recordIfAbsent(ok);
    await ledger.recordFailure(ok, 'MKCOL 404', { park: true });
    await ledger.recordUpdate({ ...ok, status: 'copied', targetId: 't1', attemptCount: 0 });

    await parked(ledger, { naturalKeyHash: 'gone' }, 'MKCOL 404');
    await ledger.resolveFailure(TENANT, MAPPING, 'gone', 'accept');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: 'MKCOL',
    });

    // Neither is reopened. A bulk press is not a way around the scoping the
    // per-item route has always had.
    expect(matched).toBe(0);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'ok'))?.status).not.toBe('failed');
    expect((await ledger.find(TENANT, MAPPING, 'file', 'gone'))?.status).toBe('left_behind');
  });

  it('never reaches another tenant or another mapping', async () => {
    const ledger = new MemoryLedger();
    await parked(ledger, { naturalKeyHash: 'mine' }, 'MKCOL 404');
    await parked(ledger, { naturalKeyHash: 'theirs', tenantId: OTHER_TENANT }, 'MKCOL 404');
    await parked(ledger, { naturalKeyHash: 'other-map', mappingId: OTHER_MAPPING }, 'MKCOL 404');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: 'MKCOL',
    });

    expect(matched).toBe(1);
    expect(
      (await ledger.find(OTHER_TENANT, MAPPING, 'file', 'theirs'))?.attemptCount,
    ).toBeGreaterThan(0);
    expect(
      (await ledger.find(TENANT, OTHER_MAPPING, 'file', 'other-map'))?.attemptCount,
    ).toBeGreaterThan(0);
  });

  it('answers 0 rather than everything when the substring occurs nowhere', async () => {
    const ledger = new MemoryLedger();
    await parked(ledger, { naturalKeyHash: 'a' }, 'MKCOL 404');

    // The failure mode to rule out: an empty or absent clause that degrades to
    // "match all". The route refuses a request that narrows on nothing, but
    // the ledger is also called by the appliance, and a widening bug here
    // would retry a whole queue on a typo.
    expect(
      await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', { errorContains: 'no such text' }),
    ).toBe(0);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'a'))?.attemptCount).toBeGreaterThan(0);
  });
});
