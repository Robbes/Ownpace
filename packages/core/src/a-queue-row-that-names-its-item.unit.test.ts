// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A QUEUE ROW THAT NAMES ITS ITEM (found 2026-11-19), over `MemoryLedger`.
 *
 * A row on *Moved on the old system* read *Files / renamed* beside a hash, and
 * the owner could not tell which file it asked about. The names were held
 * already: a file row's path (`naturalKey`), a message's, an event's or a
 * contact's name (`displayName`), and a relocation's new name on the row its
 * new key names. Both ledgers now read them through one rule (`nameOnRow`).
 *
 * The SQL half of the same contract, including the other organisation's rows
 * under row security and outside it, is
 * `packages/ledger/src/a-queue-row-that-names-its-item.unit.test.ts`. This
 * holds the fake to the same answers, so a test that runs on the fake cannot
 * pass on a name the real store would not give.
 *
 * Every file, folder, event and person here is invented.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, type LedgerRecord } from '@openmig/shared';

const A = asTenantId('1119a0e6-e29b-41d4-a716-446655440001');
const B = asTenantId('1119a0e6-e29b-41d4-a716-446655440002');
const MAP_A = asMappingId('1119a0e6-e29b-41d4-a716-446655440031');
const MAP_A2 = asMappingId('1119a0e6-e29b-41d4-a716-446655440032');

function copied(
  tenantId: LedgerRecord['tenantId'],
  mappingId: LedgerRecord['mappingId'],
  over: Partial<LedgerRecord> & Pick<LedgerRecord, 'naturalKeyHash'>,
): LedgerRecord {
  return {
    tenantId,
    mappingId,
    itemType: 'file',
    contentHash: `bytes-${over.naturalKeyHash}`,
    targetId: `t-${over.naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
    ...over,
  };
}

describe('a queue row names its item (MemoryLedger)', () => {
  let ledger: MemoryLedger;

  async function relocated(
    from: { key: string; path: string; folder: string },
    to: { key: string; path: string; folder: string },
  ): Promise<void> {
    await ledger.recordIfAbsent(copied(A, MAP_A, { naturalKeyHash: from.key, naturalKey: from.path, collection: from.folder }));
    await ledger.recordIfAbsent(
      copied(A, MAP_A, { naturalKeyHash: to.key, naturalKey: to.path, collection: to.folder, contentHash: `bytes-${from.key}` }),
    );
    await ledger.recordMove(A, MAP_A, 'file', from.key, to.folder, to.key);
  }

  const moveOf = async (key: string) => (await ledger.listMoves(A, MAP_A)).find((m) => m.naturalKeyHash === key);

  beforeEach(() => {
    ledger = new MemoryLedger();
  });

  it('a renamed file, by its old name and by the name on its new copy', async () => {
    await relocated(
      { key: 'h-report', path: 'Docs/report.pdf', folder: 'Docs' },
      { key: 'h-report-final', path: 'Docs/report-final.pdf', folder: 'Docs' },
    );

    const moves = await ledger.listMoves(A, MAP_A);
    expect(moves.map((m) => m.naturalKeyHash)).toEqual(['h-report']);
    expect(moves[0]).toMatchObject({
      displayName: 'report.pdf',
      from: 'Docs',
      to: 'Docs',
      toNaturalKeyHash: 'h-report-final',
      toDisplayName: 'report-final.pdf',
    });
  });

  it('a moved file, by its name in both folders', async () => {
    await relocated(
      { key: 'h-plan', path: 'Docs/plan.pdf', folder: 'Docs' },
      { key: 'h-plan-archived', path: 'Archive/2026/plan.pdf', folder: 'Archive/2026' },
    );

    expect(await moveOf('h-plan')).toMatchObject({
      displayName: 'plan.pdf',
      from: 'Docs',
      to: 'Archive/2026',
      toDisplayName: 'plan.pdf',
    });
  });

  it('a message and an event, by the names the pass stored, and a name an update repaired', async () => {
    await ledger.recordIfAbsent(
      copied(A, MAP_A, {
        itemType: 'email',
        naturalKeyHash: 'h-message',
        naturalKey: 'invented-1@example.com',
        displayName: 'Quarterly figures',
        collection: 'INBOX/Projects',
      }),
    );
    // Written before names were recorded, then copied again by a pass that
    // read one: PgLedger's update repairs the column, and so must the fake.
    await ledger.recordIfAbsent(
      copied(A, MAP_A, { itemType: 'calendar', naturalKeyHash: 'h-event', naturalKey: 'invented-uid-1', collection: 'Personal' }),
    );
    await ledger.recordUpdate(
      copied(A, MAP_A, {
        itemType: 'calendar',
        naturalKeyHash: 'h-event',
        displayName: 'Dentist',
        collection: 'Personal',
        status: 'updated',
      }),
    );
    await ledger.recordMove(A, MAP_A, 'email', 'h-message', 'Archive/2026');
    await ledger.recordMove(A, MAP_A, 'calendar', 'h-event', 'Work');

    expect(await moveOf('h-message')).toMatchObject({ displayName: 'Quarterly figures', from: 'INBOX/Projects', to: 'Archive/2026' });
    expect(await moveOf('h-message')).not.toHaveProperty('toDisplayName');
    expect(await moveOf('h-event')).toMatchObject({ displayName: 'Dentist', from: 'Personal', to: 'Work' });
  });

  it('a row from before names were recorded says what it always said: its folders', async () => {
    await relocated(
      { key: 'h-old', path: '', folder: 'Docs' },
      { key: 'h-old-new', path: '', folder: 'Docs' },
    );
    await ledger.recordIfAbsent(
      copied(A, MAP_A, { itemType: 'contact', naturalKeyHash: 'h-card', naturalKey: 'invented-card-uid', collection: 'Family' }),
    );
    await ledger.recordMove(A, MAP_A, 'contact', 'h-card', 'Work');

    const file = await moveOf('h-old');
    expect(file).toMatchObject({ from: 'Docs', to: 'Docs', toNaturalKeyHash: 'h-old-new' });
    expect(file).not.toHaveProperty('displayName');
    expect(file).not.toHaveProperty('toDisplayName');
    expect(await moveOf('h-card')).not.toHaveProperty('displayName');
  });

  it('a deleted file, a deleted contact and an earlier export are named; an unrecorded file is not', async () => {
    for (const record of [
      copied(A, MAP_A, { naturalKeyHash: 'h-tax', naturalKey: 'Docs/tax-2025.pdf' }),
      copied(A, MAP_A, { itemType: 'contact', naturalKeyHash: 'h-jan', naturalKey: 'invented-uid-2', displayName: 'Jan Jansen', collection: 'Family' }),
      copied(A, MAP_A, { naturalKeyHash: 'h-unrecorded', naturalKey: '' }),
    ]) {
      await ledger.recordIfAbsent(record);
      await ledger.recordReportedDeletion(A, MAP_A, record.itemType, record.naturalKeyHash);
    }
    await ledger.recordIfAbsent(copied(A, MAP_A, { naturalKeyHash: 'h-plan-odt', naturalKey: 'Docs/Plan.odt' }));
    await ledger.markEarlierExports(A, MAP_A, 'file', [{ formerNaturalKeyHash: 'h-plan-odt', naturalKeyHash: 'h-plan-docx' }]);

    const deletions = await ledger.listDeletions(A, MAP_A);
    const of = (key: string) => deletions.find((d) => d.naturalKeyHash === key);
    expect(of('h-tax')).toMatchObject({ displayName: 'tax-2025.pdf', collection: 'Docs' });
    expect(of('h-jan')).toMatchObject({ displayName: 'Jan Jansen', collection: 'Family' });
    expect(of('h-unrecorded')).not.toHaveProperty('displayName');
    expect((await ledger.listEarlierExports(A, MAP_A))[0]).toMatchObject({ naturalKeyHash: 'h-plan-odt', displayName: 'Plan.odt' });
  });

  it("never takes a new name from another organisation's row, or another migration's", async () => {
    await ledger.recordIfAbsent(copied(A, MAP_A, { naturalKeyHash: 'h-mine', naturalKey: 'Docs/mine.pdf' }));
    await ledger.recordMove(A, MAP_A, 'file', 'h-mine', 'Docs', 'h-elsewhere');
    await ledger.recordIfAbsent(copied(A, MAP_A2, { naturalKeyHash: 'h-elsewhere', naturalKey: 'Docs/another-migration.pdf' }));
    await ledger.recordIfAbsent(copied(B, MAP_A, { naturalKeyHash: 'h-elsewhere', naturalKey: 'Docs/another-organisation.pdf' }));

    const [move, ...more] = await ledger.listMoves(A, MAP_A);
    expect(more).toEqual([]);
    expect(move).toMatchObject({ displayName: 'mine.pdf', toNaturalKeyHash: 'h-elsewhere' });
    expect(move).not.toHaveProperty('toDisplayName');
  });
});
