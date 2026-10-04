// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FIRST COPY THAT WAITS AT THE CEILING (workplan 0109 T6, ADR-0014's
 * amendment of 2026-10-03).
 *
 * Every step up is consented and paid for: at the customer's data ceiling,
 * new first copies wait for their yes to a move up or a top-up. What the
 * engine owes that rule, whoever asks the question (`firstCopyAllowed`, which
 * the managed worker builds from the ceiling; the appliance never asks):
 *
 *   - a held item is not fetched, not written and given no ledger row: it was
 *     never looked at, so it is neither failed nor skipped, only counted;
 *   - an update to what was already copied carries on: the hold stops new
 *     data, never the sync of data the customer already has;
 *   - the collection keeps its cursor, so the pass after the yes lists the
 *     held items again and copies them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, setLogLevel, resetLogLevel, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('7c110000-e29b-41d4-a716-4466554409aa');
const MAPPING = asMappingId('7c110000-e29b-41d4-a716-4466554409bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
  version: string;
}

function pass(ledger: MemoryLedger, items: Item[], firstCopyAllowed?: (bytesThisPass: number) => boolean) {
  const written: string[] = [];
  const fetched: string[] = [];
  const cursorsSet: string[] = [];
  const asked: number[] = [];
  return {
    written,
    fetched,
    cursorsSet,
    asked,
    run: () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        sourceIsAuthorityOnExistence: true,
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        source: {},
        target: {},
        ledger,
        cursors: {
          get: async () => undefined,
          set: async (_t, _m, key) => {
            cursorsSet.push(key);
          },
          clear: async () => {},
        },
        concurrency: 1,
        listFolders: async () => [{ path: 'f1' }],
        listSince: async () => ({ items, nextCursor: { value: '1' } }),
        fetchRaw: async (i) => {
          fetched.push(i.key);
          return { raw: i.body, sizeBytes: i.body.length };
        },
        upsert: async (_c, raw): Promise<UpsertResult> => {
          written.push(raw as string);
          return { targetId: `t:${raw as string}`, created: true };
        },
        naturalKey: (i) => i.key,
        sourceVersion: (i) => i.version,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async (f) => f.path,
        ...(firstCopyAllowed
          ? {
              firstCopyAllowed: (n: number) => {
                asked.push(n);
                return firstCopyAllowed(n);
              },
            }
          : {}),
      }),
  };
}

describe('at the ceiling', () => {
  it('a new item is not fetched, not written and given no row: it waits, counted', async () => {
    const ledger = new MemoryLedger();
    const p = pass(ledger, [{ key: 'a', body: 'AAAA', version: '1' }], () => false);
    const result = await p.run();
    expect(result.heldAtCeiling).toBe(1);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(p.fetched).toEqual([]);
    expect(p.written).toEqual([]);
    expect(ledger.size()).toBe(0);
  });

  it('keeps the collection\'s cursor, so the pass after the yes lists the held items again', async () => {
    const ledger = new MemoryLedger();
    const held = pass(ledger, [{ key: 'a', body: 'AAAA', version: '1' }], () => false);
    await held.run();
    expect(held.cursorsSet).toEqual([]);

    const afterTheYes = pass(ledger, [{ key: 'a', body: 'AAAA', version: '1' }], () => true);
    const result = await afterTheYes.run();
    expect(result.heldAtCeiling).toBe(0);
    expect(afterTheYes.written).toEqual(['AAAA']);
    expect(ledger.size()).toBe(1);
    expect(afterTheYes.cursorsSet.length).toBeGreaterThan(0);
  });

  it('copies up to the ceiling, asking with what this pass has copied so far, and holds the rest', async () => {
    const ledger = new MemoryLedger();
    const items = [
      { key: 'a', body: 'AAAA', version: '1' },
      { key: 'b', body: 'BBBB', version: '1' },
      { key: 'c', body: 'CCCC', version: '1' },
    ];
    // Room for one more item of four bytes: the second is asked with four.
    const p = pass(ledger, items, (bytesThisPass) => bytesThisPass < 4);
    const result = await p.run();
    expect(p.written).toEqual(['AAAA']);
    expect(result.heldAtCeiling).toBe(2);
    expect(p.asked.slice(0, 2)).toEqual([0, 4]);
  });

  it('carries an update to what was already copied across: the hold stops new data, not the sync', async () => {
    const ledger = new MemoryLedger();
    await pass(ledger, [{ key: 'a', body: 'AAAA', version: '1' }]).run();

    const p = pass(
      ledger,
      [
        { key: 'a', body: 'AAAA, edited', version: '2' },
        { key: 'b', body: 'BBBB', version: '1' },
      ],
      () => false,
    );
    const result = await p.run();
    expect(result.updated).toBe(1);
    expect(result.heldAtCeiling).toBe(1);
    expect(p.written).toEqual(['AAAA, edited']);
  });

  it('is never asked where nobody asks it: the appliance, and the alpha', async () => {
    const ledger = new MemoryLedger();
    const p = pass(ledger, [{ key: 'a', body: 'AAAA', version: '1' }]);
    const result = await p.run();
    expect(result.heldAtCeiling).toBe(0);
    expect(p.written).toEqual(['AAAA']);
  });
});
