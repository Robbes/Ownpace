// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CURSOR THAT RETIRED ITEMS NOBODY COPIED (found live 2026-09-11, diagnosed
 * 2026-09-12).
 *
 * A Google → Nextcloud migration listed FIVE calendars, wrote a `sync-token`
 * for each of them, recorded ZERO calendar items, and then reported
 * `calendar: 0 created, 0 skipped` every fifteen minutes for days. Nothing
 * errored. The connection Test counted the five calendars live, the grant
 * carried `.../auth/calendar`, and the ledger held nothing.
 *
 * The mechanism, once the cursor rows were read: `nextCursor` means "do not
 * show me these items again". On the FIRST read of a collection an empty
 * answer is ambiguous — a collection that is genuinely empty, or a read that
 * failed to see what is in it — and the loop cannot tell them apart. It stored
 * the token either way, so the second case became PERMANENT: every later pass
 * asked "what changed since this token", was correctly told "nothing", and
 * reported a completed domain that had never copied an item.
 *
 * **The invariant is narrow on purpose.** Once a cursor EXISTS, an empty answer
 * is the ordinary incremental case and must go on advancing — otherwise every
 * pass after the first re-lists the whole account for ever. So only the first
 * read, and only when it saw nothing at all, withholds the cursor. The tests
 * below pin BOTH directions, because a fix that stopped cursors advancing in
 * general would be a far worse bug than the one it replaced.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('7e550000-e29b-41d4-a716-4466554404aa');
const MAPPING = asMappingId('7e550000-e29b-41d4-a716-4466554404bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

interface Item {
  key: string;
  body: string;
}

/**
 * One pass over `folders`, where each folder answers with whatever
 * `answer` says — items, reported removals, and the token it hands back.
 */
function pass(
  ledger: MemoryLedger,
  cursors: MemoryCursorStore | undefined,
  folders: ReadonlyArray<{ path: string }>,
  answer: (folder: { path: string }) => {
    items: Item[];
    removed?: string[];
    token: string;
  },
) {
  const asked: Array<string | undefined> = [];
  return {
    /** What cursor value each folder was asked WITH, in order. */
    asked,
    run: () =>
      runDomainSync<unknown, unknown, Item, { path: string }>({
        sourceIsAuthorityOnExistence: true,
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'calendar',
        source: {},
        target: {},
        ledger,
        ...(cursors ? { cursors } : {}),
        listFolders: async () => folders,
        listSince: async (folder, cursor) => {
          asked.push(cursor?.value);
          const a = answer(folder);
          return {
            items: a.items,
            nextCursor: { value: a.token },
            ...(a.removed ? { removed: a.removed } : {}),
          };
        },
        fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
        upsert: async (): Promise<UpsertResult> => ({ targetId: 't', created: true }),
        naturalKey: (i) => i.key,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async (f) => f.path,
      }),
  };
}

const ONE_CALENDAR = [{ path: '/caldav/v2/rob%40example.com/events/' }];

describe('a first read that saw nothing claims nothing', () => {
  it('does NOT store a cursor when the first read has no items and no removals', async () => {
    // The live case, exactly: a collection the source lists but reads as empty.
    const cursors = new MemoryCursorStore();
    const { run } = pass(new MemoryLedger(), cursors, ONE_CALENDAR, () => ({
      items: [],
      token: 'sync-token:first',
    }));

    await run();

    expect(await cursors.get(TENANT, MAPPING, ONE_CALENDAR[0]!.path)).toBeUndefined();
  });

  it('so the NEXT pass reads that collection from the beginning again', async () => {
    // The property that matters. Withholding the cursor is only worth anything
    // if it means the collection is asked again — and when the second read
    // works, the items land rather than having been retired unseen.
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    let readCount = 0;
    const source = () => {
      readCount += 1;
      return readCount === 1
        ? { items: [], token: 'sync-token:first' }
        : { items: [{ key: 'event-1', body: 'BEGIN:VEVENT' }], token: 'sync-token:second' };
    };

    const first = pass(ledger, cursors, ONE_CALENDAR, source);
    const r1 = await first.run();
    expect(r1.created).toBe(0);
    expect(first.asked).toEqual([undefined]);

    const second = pass(ledger, cursors, ONE_CALENDAR, source);
    const r2 = await second.run();
    // Asked from the beginning, NOT from the first read's token.
    expect(second.asked).toEqual([undefined]);
    expect(r2.created).toBe(1);
  });

  it('stores the cursor when the first read DID see items', async () => {
    const cursors = new MemoryCursorStore();
    const { run } = pass(new MemoryLedger(), cursors, ONE_CALENDAR, () => ({
      items: [{ key: 'event-1', body: 'BEGIN:VEVENT' }],
      token: 'sync-token:first',
    }));

    await run();

    expect((await cursors.get(TENANT, MAPPING, ONE_CALENDAR[0]!.path))?.value).toBe(
      'sync-token:first',
    );
  });

  it('stores it when the first read reported only REMOVALS', async () => {
    // A reported removal is positive evidence the server answered about this
    // collection's contents (RFC 6578). Nothing was copied, but something was
    // genuinely read, so there is a claim to make.
    const cursors = new MemoryCursorStore();
    const { run } = pass(new MemoryLedger(), cursors, ONE_CALENDAR, () => ({
      items: [],
      removed: ['event-gone'],
      token: 'sync-token:first',
    }));

    await run();

    expect((await cursors.get(TENANT, MAPPING, ONE_CALENDAR[0]!.path))?.value).toBe(
      'sync-token:first',
    );
  });
});

describe('the ordinary incremental case still advances', () => {
  it('advances an EXISTING cursor over an empty read — nothing changed is not nothing seen', async () => {
    // The direction a careless fix breaks. Once a cursor exists, "no items"
    // means the collection is unchanged since it, and refusing to move it
    // would re-list the whole account on every pass for ever.
    const cursors = new MemoryCursorStore();
    await cursors.set(TENANT, MAPPING, ONE_CALENDAR[0]!.path, { value: 'sync-token:held' });

    const { run, asked } = pass(new MemoryLedger(), cursors, ONE_CALENDAR, () => ({
      items: [],
      token: 'sync-token:moved-on',
    }));
    await run();

    expect(asked).toEqual(['sync-token:held']);
    expect((await cursors.get(TENANT, MAPPING, ONE_CALENDAR[0]!.path))?.value).toBe(
      'sync-token:moved-on',
    );
  });
});

describe('a domain says how many collections it listed', () => {
  it('reports the collections even when not one of them yielded an item', async () => {
    // The half that made the live bug invisible. `scanned: 0` reads the same
    // for an empty source and for five collections none of whose items could
    // be listed; `collectionsListed` is what separates them, and every caller
    // that logs a pass summary now has the fact available.
    const five = Array.from({ length: 5 }, (_, n) => ({ path: `/caldav/v2/cal-${n}/events/` }));
    const { run } = pass(new MemoryLedger(), new MemoryCursorStore(), five, () => ({
      items: [],
      token: 'sync-token:x',
    }));

    const result = await run();

    expect(result.collectionsListed).toBe(5);
    expect(result.scanned).toBe(0);
    expect(result.created).toBe(0);
  });

  it('reports zero collections when the source listed none, which is a different fact', async () => {
    const { run } = pass(new MemoryLedger(), new MemoryCursorStore(), [], () => ({
      items: [],
      token: 'sync-token:x',
    }));

    const result = await run();

    expect(result.collectionsListed).toBe(0);
    expect(result.scanned).toBe(0);
  });
});
