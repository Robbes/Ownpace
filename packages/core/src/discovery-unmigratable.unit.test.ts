// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Discovery must not quietly shrink the mailbox.
//
// `ImapSource.listSince` drops messages with no Message-ID — correctly, since
// the natural key IS the Message-ID and copying an unkeyable message would
// duplicate it on every pass. What was wrong is that it dropped them with a
// bare `continue`, counting nothing.
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
// These tests pin the counting, and pin that the count is reported SEPARATELY:
// `items` stays the migratable total, because that is the number the customer
// agrees to at the confirm screen.

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

    expect(result.unmigratableItems).toBe(3);
  });

  it('keeps them OUT of the item total the customer approves', async () => {
    // The load-bearing assertion. `items` is what the confirm screen presents
    // as "what we will move"; folding in three messages we are not moving would
    // be the same lie in the other direction.
    const result = await discoverSource(
      source([{ name: 'INBOX', items: [{ id: 'a' }, { id: 'b' }], unkeyable: 3 }]),
    );

    expect(result.items).toBe(2);
    expect(result.unmigratableItems).toBe(3);
  });

  it('breaks the count down per collection, so an operator can find them', async () => {
    const result = await discoverSource(
      source([
        { name: 'INBOX', items: [{ id: 'a' }], unkeyable: 4 },
        { name: 'Archive', items: [{ id: 'b' }] },
      ]),
    );

    const byName = Object.fromEntries(
      (result.perCollection ?? []).map((c) => [c.name, c.unmigratableItems]),
    );
    expect(byName['INBOX']).toBe(4);
    // Absent rather than 0 — nothing to report for this folder.
    expect(byName['Archive']).toBeUndefined();
  });

  it('omits the field entirely when everything is migratable', async () => {
    // A clean mailbox must not sprout a "0 cannot migrate" line; the confirm
    // screen should stay quiet when there is nothing to say.
    const result = await discoverSource(source([{ name: 'INBOX', items: [{ id: 'a' }] }]));

    expect(result.unmigratableItems).toBeUndefined();
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
    expect(result.unmigratableItems).toBeUndefined();
  });

  it('still totals bytes for the items it can migrate', async () => {
    const result = await discoverSource(
      source([{ name: 'INBOX', items: [{ id: 'a', size: 100 }, { id: 'b', size: 50 }], unkeyable: 1 }]),
      { itemBytes: (i) => i.size },
    );

    // Bytes describe the migratable set too — we never read the others.
    expect(result.bytes).toBe(150);
    expect(result.unmigratableItems).toBe(1);
  });
});
