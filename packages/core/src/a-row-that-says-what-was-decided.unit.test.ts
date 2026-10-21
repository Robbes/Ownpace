// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROW THAT SAYS WHAT WAS DECIDED (workplan 0159 §6 item 6), over
 * `MemoryLedger`.
 *
 * Deletions and Moves list what is already decided under *Already decided*,
 * and until now nothing on a row said WHICH decision it was. The ledger closes
 * the entry the same way for *Keep* and for an apply, so the UX sweep's title
 * *Kept on the new system* named the opposite of what happened after *Delete
 * it here too*, and its review took the title back. What tells the two apart
 * was always on the row: `deletion_applied_at` is set only by the two writes
 * that remove a copy.
 *
 * Which of those two writes it was matters as well. `applyRelocation` sets
 * `deletion_applied_at` too, and closes a deletion entry the same row carried,
 * so "applied" alone would call the old copy of a RENAMED file deleted on the
 * Deletions page, while the item is on the new system under its new name. The
 * relocation closes the move in the same write, with the same time, and that
 * is what says it was one.
 *
 * The SQL half of the same contract is
 * `packages/ledger/src/a-row-that-says-what-was-decided.integration.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, type LedgerRecord } from '@openmig/shared';

const TENANT = asTenantId('0159d6e0-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0159d6e0-e29b-41d4-a716-446655440002');

function copied(naturalKeyHash: string, contentHash: string): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash,
    contentHash,
    targetId: `t-${naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
  };
}

describe('a decided row says what was decided (MemoryLedger)', () => {
  let ledger: MemoryLedger;

  /** A file renamed on the old system: the old row, and its arrival. */
  async function renamed(old: string): Promise<void> {
    await ledger.recordIfAbsent(copied(old, `bytes-${old}`));
    await ledger.recordIfAbsent(copied(`${old}-new`, `bytes-${old}`));
    await ledger.recordMove(TENANT, MAPPING, 'file', old, 'Docs', `${old}-new`);
  }

  /** A file the old system reported deleted. */
  async function reported(key: string): Promise<void> {
    await ledger.recordIfAbsent(copied(key, `bytes-${key}`));
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', key);
  }

  const deletionOf = async (key: string) =>
    (await ledger.listDeletions(TENANT, MAPPING)).find((d) => d.naturalKeyHash === key);
  const moveOf = async (key: string) =>
    (await ledger.listMoves(TENANT, MAPPING)).find((m) => m.naturalKeyHash === key);

  beforeEach(() => {
    ledger = new MemoryLedger();
  });

  it('a kept deletion says kept', async () => {
    await reported('kept');
    expect(await ledger.resolveDeletion(TENANT, MAPPING, 'kept', 'keep')).toBe(true);

    expect(await deletionOf('kept')).toMatchObject({ decided: 'kept' });
  });

  it('a deletion carried out on the new system says applied', async () => {
    await reported('deleted');
    expect(await ledger.applyDeletion(TENANT, MAPPING, 'file', 'deleted')).toBe(true);

    expect(await deletionOf('deleted')).toMatchObject({ decided: 'applied' });
  });

  it('the old copy of a renamed file, removed, says relocated on Deletions and applied on Moves', async () => {
    // Renamed, and reported deleted under its old name as well: in both
    // queues at once, which `applyRelocation` closes together.
    await renamed('moved');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'moved');
    expect(await ledger.applyRelocation(TENANT, MAPPING, 'file', 'moved')).toBe(true);

    expect(await deletionOf('moved')).toMatchObject({ decided: 'relocated' });
    expect(await moveOf('moved')).toMatchObject({ decided: 'applied' });
  });

  it('a renamed file removed through Deletions says applied there, and its move stays open', async () => {
    // The other write that removes a copy, on a row that also carries a
    // relocation. It was the deletion that was carried out, so Deletions says
    // applied, not relocated, and the move still waits on a person.
    await renamed('both');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'both');
    expect(await ledger.applyDeletion(TENANT, MAPPING, 'file', 'both')).toBe(true);

    expect(await deletionOf('both')).toMatchObject({ decided: 'applied' });
    const move = await moveOf('both');
    expect(move?.acknowledgedAt).toBeUndefined();
    expect(move?.decided).toBeUndefined();
  });

  it('a move left where it is says kept', async () => {
    await renamed('left');
    expect(await ledger.resolveMove(TENANT, MAPPING, 'left', 'keep')).toBe(true);

    expect(await moveOf('left')).toMatchObject({ decided: 'kept' });
  });

  it('an open row says nothing: nothing has been decided', async () => {
    await reported('open-deletion');
    await renamed('open-move');

    const deletion = await deletionOf('open-deletion');
    expect(deletion?.acknowledgedAt).toBeUndefined();
    expect(deletion).not.toHaveProperty('decided');
    const move = await moveOf('open-move');
    expect(move?.acknowledgedAt).toBeUndefined();
    expect(move).not.toHaveProperty('decided');
  });
});
