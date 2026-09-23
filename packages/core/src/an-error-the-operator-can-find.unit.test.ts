// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THE OPERATOR CAN FIND (workplan 0129 T1): the pass's own warnings.
 *
 * Two readers in a pass may fail without failing the pass: the listing of a
 * collection's keys, and the owner's bin. Either costs that pass its moves and
 * deletions, which the log line has always said, to the container's output.
 * Each is now also recorded for the operator's log page, as a warning with the
 * reference that line carries, and the pass goes on as before.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setAppEventSink,
  type AppEvent,
  type DiscardedListing,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('0e250000-e29b-41d4-a716-446655440001');
const MAPPING = asMappingId('0e250000-e29b-41d4-a716-446655440002');

interface Obj {
  readonly uid: string;
}

function pass(readers: {
  readonly keys?: () => Promise<ReadonlyArray<string>>;
  readonly bin?: () => Promise<DiscardedListing>;
}) {
  return runDomainSync<unknown, unknown, Obj, { path: string }>({
    sourceIsAuthorityOnExistence: true,
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'calendar',
    source: {},
    target: {},
    ledger: new MemoryLedger(),
    listFolders: async () => [{ path: 'Work' }],
    listSince: async () => ({ items: [{ uid: 'uid-1' }], nextCursor: { value: '1' } }),
    ...(readers.keys ? { listCollectionKeys: readers.keys } : {}),
    ...(readers.bin ? { listDiscardedKeys: readers.bin } : {}),
    fetchRaw: async (o) => ({ raw: o.uid, sizeBytes: 1 }),
    upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
    naturalKey: (o) => o.uid,
    contentHash: (raw) => `h:${raw as string}`,
    ensureCollection: async (folder) => folder.path,
  });
}

function recorded(): AppEvent[] {
  const events: AppEvent[] = [];
  setAppEventSink({ record: async (e) => void events.push(e) });
  return events;
}

const refused = async (): Promise<never> => {
  throw new Error('503 from the server');
};

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe("a pass that could not read what it needs for moves and deletions", () => {
  it.each([
    ["a collection's keys", 'keys-unreadable', { keys: refused }],
    ["the owner's bin", 'bin-unreadable', { bin: refused }],
  ] as const)('records %s as a warning, under the reference its log line carries', async (_what, name, readers) => {
    const events = recorded();
    const said = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await pass(readers);

    // The pass itself goes on: the item is copied.
    expect(result.created).toBe(1);
    expect(events).toEqual([
      { level: 'warn', event: `sync.calendar.${name}`, reference: events[0]!.reference, tenantId: TENANT, mappingId: MAPPING },
    ]);
    const lines = said.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).toContain(`[ref ${events[0]!.reference}]`);
    expect(JSON.stringify(events)).not.toContain('503');
  });

  it('records nothing when both could be read', async () => {
    const events = recorded();

    await pass({ keys: async () => ['uid-1'], bin: async () => ({ keys: [], unnameable: 0 }) });

    expect(events).toEqual([]);
  });
});
