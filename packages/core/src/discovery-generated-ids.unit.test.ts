// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Discovery must not quietly shrink the mailbox.
//
// `ImapSource.listSince` used to DROP messages with no Message-ID, with a bare
// `continue` that counted nothing. They are now emitted, given a generated
// Message-ID derived from their own bytes, and migrated — but discovery still
// reports how many there are, because we modify those copies.
//
// That made them invisible in three places at once, and the three reinforced
// each other into a false all-clear:
//   - no ledger row, because they were never synced;
//   - nothing for the target reindexer to list, because they were never written;
//   - missing from discovery's item total — because discovery counts by calling
//     this very method.
// Both halves of the verification gate agreed on nothing and reported PASS. A
// mailbox could leave messages behind and still be certified complete.
//
// These tests pin the counting, and pin that the count is a SUBSET of `items`:
// these messages are migrated, so excluding them would understate the
// migration just as badly as hiding them did.

import { describe, it, expect } from 'vitest';
import type { SyncCursor } from '@openmig/shared';
import { discoverSource, type ListingSource } from './discovery';

interface Folder {
  name: string;
}
interface Item {
  id: string;
  size?: number;
}

const CURSOR: SyncCursor = { value: 'c' };

/** A source whose folders each hold some listable items and some unkeyable ones. */
function source(
  folders: Array<{ name: string; items: Item[]; unkeyable?: number }>,
): ListingSource<Folder, Item> {
  return {
    async listFolders() {
      return folders.map((f) => ({ name: f.name }));
    },
    async listSince(folder: Folder) {
      const found = folders.find((f) => f.name === folder.name)!;
      return {
        items: found.items,
        nextCursor: CURSOR,
        ...(found.unkeyable ? { unkeyable: found.unkeyable } : {}),
      };
    },
  };
}

describe('discovery reports what cannot be migrated', () => {
  it('counts unkeyable items across all collections', async () => {
    const result = await discoverSource(
      source([
        { name: 'INBOX', items: [{ id: 'a' }, { id: 'b' }], unkeyable: 2 },
        { name: 'Sent', items: [{ id: 'c' }], unkeyable: 1 },
      ]),
    );

    expect(result.generatedIdItems).toBe(3);
  });

  it('counts them WITHIN the item total, because they are migrated', async () => {
    // The load-bearing assertion, and the one that flipped: these messages are
    // now copied (with a generated Message-ID), so `items` — what the confirm
    // screen presents as "what we will move" — must include them. The source
    // emits them, so `items` already does; this pins that the reported subset
    // never exceeds the whole.
    const result = await discoverSource(
      source([{ name: 'INBOX', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], unkeyable: 3 }]),
    );

    expect(result.items).toBe(3);
    expect(result.generatedIdItems).toBe(3);
    expect(result.generatedIdItems!).toBeLessThanOrEqual(result.items);
  });

  it('breaks the count down per collection, so an operator can find them', async () => {
    const result = await discoverSource(
      source([
        { name: 'INBOX', items: [{ id: 'a' }], unkeyable: 4 },
        { name: 'Archive', items: [{ id: 'b' }] },
      ]),
    );

    const byName = Object.fromEntries(
      (result.perCollection ?? []).map((c) => [c.name, c.generatedIdItems]),
    );
    expect(byName['INBOX']).toBe(4);
    // Absent rather than 0 — nothing to report for this folder.
    expect(byName['Archive']).toBeUndefined();
  });

  it('omits the field entirely when every message already has an id', async () => {
    // A clean mailbox must not sprout a "0 need an ID" line; the confirm screen
    // should stay quiet when there is nothing to say.
    const result = await discoverSource(source([{ name: 'INBOX', items: [{ id: 'a' }] }]));

    expect(result.generatedIdItems).toBeUndefined();
    expect(result.items).toBe(1);
  });

  it('works with sources that do not report the field at all', async () => {
    // Calendar/contact/file sources have no such concept; their listSince
    // returns no `unkeyable`, and discovery must not invent one.
    const noField: ListingSource<Folder, Item> = {
      async listFolders() {
        return [{ name: 'personal' }];
      },
      async listSince() {
        return { items: [{ id: 'e1' }, { id: 'e2' }], nextCursor: CURSOR };
      },
    };

    const result = await discoverSource(noField);
    expect(result.items).toBe(2);
    expect(result.generatedIdItems).toBeUndefined();
  });

  it('still totals bytes across everything it will move', async () => {
    const result = await discoverSource(
      source([{ name: 'INBOX', items: [{ id: 'a', size: 100 }, { id: 'b', size: 50 }], unkeyable: 1 }]),
      { itemBytes: (i) => i.size },
    );

    expect(result.bytes).toBe(150);
    expect(result.generatedIdItems).toBe(1);
  });
});
