// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * An item this tool deliberately REMOVED must never be silently re-created.
 *
 * `applyDeletion` sets `status: 'tombstoned'` after removing an item's copy from
 * the target, on an explicit owner decision. The very next ordinary sync pass
 * then sees the source still listing that key (the owner may not have deleted it
 * on the source at all — `apply` is available for reported/trashed evidence, and
 * an owner can legitimately choose to remove the target's copy of something the
 * source still has) — and `classifyKnownItem` has to resist the completely
 * ordinary reading of "the source has it, we don't, copy it" (§11.1). Getting
 * this wrong would silently UNDO a destructive decision an operator made on
 * purpose, which is a worse failure than the one `apply` exists to fix.
 *
 * This is a regression test for a real bug caught while building this feature:
 * `classifyKnownItem` was taught to return `'tombstoned'`, but the loop had no
 * branch for that action and fell through to the ordinary fetch-and-upsert path,
 * which would have re-created the item and flipped its status straight back to
 * `copied` — as if the removal had never happened.
 */

import { describe, it, expect } from 'vitest';
import { runDomainSync, classifyKnownItem } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('e2aa0000-e29b-41d4-a716-4466554406aa');
const MAPPING = asMappingId('e2aa0000-e29b-41d4-a716-4466554406bb');

describe('classifyKnownItem: a tombstoned row', () => {
  it('is its own action, ahead of every version rule', () => {
    expect(
      classifyKnownItem({ status: 'tombstoned', collection: 'Personal', sourceVersion: 'e1' }, 'e1'),
    ).toBe('tombstoned');
    // Even when the source version has moved on since the removal — the version
    // question does not arise for a row with no bytes on the target to compare.
    expect(
      classifyKnownItem({ status: 'tombstoned', collection: 'Personal', sourceVersion: 'e1' }, 'e2'),
    ).toBe('tombstoned');
  });
});

describe('the sync loop, given a tombstoned row', () => {
  function world() {
    const folders = new Map<string, Array<{ key: string; body: string }>>();
    const target = new Map<string, string>();
    let upsertCalls = 0;

    const run = (ledger: MemoryLedger) =>
      runDomainSync<unknown, unknown, { key: string; body: string }, { path: string }>({
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'calendar',
        source: {},
        target: {},
        ledger,
        listFolders: async () => [...folders.keys()].map((path) => ({ path })),
        listSince: async (folder) => ({
          items: folders.get(folder.path) ?? [],
          nextCursor: { value: '' },
        }),
        fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
        upsert: async (collectionId, raw, i): Promise<UpsertResult> => {
          upsertCalls += 1;
          const at = `${collectionId}:${i.key}`;
          target.set(at, raw as string);
          return { targetId: at, created: true };
        },
        naturalKey: (i) => i.key,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async (folder) => `t/${folder.path}`,
      });

    return { folders, target, run, upsertCalls: () => upsertCalls };
  }

  it('is left exactly as tombstoned when the source still lists the key', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V1' }]);

    // Seed a row exactly as `applyDeletion` would leave it: removed, and marked so.
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'uid-1',
      contentHash: 'h:V1',
      targetId: 't/Personal:uid-1',
      createdAt: new Date().toISOString(),
      status: 'tombstoned',
      collection: 'Personal',
      deletionReportedAt: new Date().toISOString(),
      deletionAppliedAt: new Date().toISOString(),
      deletionAcknowledgedAt: new Date().toISOString(),
    });

    const result = await w.run(ledger);

    // THE ASSERTION THAT MATTERS. Nothing was written to the target — the whole
    // point is that a removed item stays removed.
    expect(w.upsertCalls()).toBe(0);
    expect(w.target.size).toBe(0);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);

    // Reported rather than silently absorbed into a routine `skip`.
    expect(result.reappearedAfterRemoval).toBe(1);

    // The row itself is untouched — still tombstoned, still carrying the
    // original removal date.
    const row = await ledger.find(TENANT, MAPPING, 'calendar', 'uid-1');
    expect(row?.status).toBe('tombstoned');
    expect(row?.deletionAppliedAt).toBeDefined();
  });

  it('reports it every pass the key keeps appearing, not just the first', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V1' }]);
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'uid-1',
      contentHash: 'h:V1',
      targetId: 't/Personal:uid-1',
      createdAt: new Date().toISOString(),
      status: 'tombstoned',
      collection: 'Personal',
      deletionTrashedAt: new Date().toISOString(),
      deletionAppliedAt: new Date().toISOString(),
    });

    await w.run(ledger);
    const second = await w.run(ledger);

    expect(second.reappearedAfterRemoval).toBe(1);
    expect(w.upsertCalls()).toBe(0);
  });

  it('does not report anything once the source stops listing the key too', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    // Empty listing: the source no longer has it either.
    w.folders.set('Personal', []);
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'uid-1',
      contentHash: 'h:V1',
      targetId: 't/Personal:uid-1',
      createdAt: new Date().toISOString(),
      status: 'tombstoned',
      collection: 'Personal',
      deletionReportedAt: new Date().toISOString(),
      deletionAppliedAt: new Date().toISOString(),
    });

    const result = await w.run(ledger);

    expect(result.reappearedAfterRemoval).toBe(0);
    expect(w.upsertCalls()).toBe(0);
  });
});
