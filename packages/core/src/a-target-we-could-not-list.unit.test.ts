// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A target we could not list is not an empty target (workplan 0117 T2, slice 5).
 *
 * The adapter between `TargetReindexer` — which streams a whole account — and
 * `ConfirmationReader`, which asks about one item and has to survive one of
 * them failing. Most of it is bookkeeping. One rule is not.
 *
 * **If the enumeration fails, every item must read `unchecked`, never
 * `missing`.** An unlistable target read as an empty one puts *we placed it and
 * it is gone* on every row of somebody's account at once — a whole library
 * reported lost by one failed request, on the document they delete their
 * originals from. Slice 2 encoded this rule for a single item; this is the same
 * rule one level up, where the blast radius is the account.
 *
 * Driven THROUGH the real pass rather than by poking the reader, because the
 * lesson of the last two slices is that a piece built alone fits its own tests
 * and not its consumer. The reader is asked directly only where the pass
 * cannot tell two implementations apart — and each of those says why.
 */

import { describe, it, expect } from 'vitest';
import { readerOverTarget } from './confirmation-reader.ts';
import { confirmEach, type ConfirmableItem } from './confirmation-pass.ts';
import {
  fileNaturalKeyHash,
  naturalKeyHash,
  type TargetEntry,
  type TargetReindexer,
} from '@openmig/shared';

/** A reindexer over a fixed list, optionally one that falls over. */
const reindexer = (
  entries: TargetEntry[],
  opts: { throws?: boolean; hashes?: Record<string, string | undefined> } = {},
): TargetReindexer => ({
  async *listEntries() {
    if (opts.throws) throw new Error('the target would not list');
    for (const e of entries) yield e;
  },
  ...(opts.hashes
    ? {
        contentHashFor: async (entry: TargetEntry) => opts.hashes![entry.naturalKey],
      }
    : {}),
});

const entry = (naturalKey: string): TargetEntry => ({
  naturalKey,
  targetId: `t-${naturalKey}`,
  mailboxId: 'INBOX',
});

const item = (naturalKey: string, over: Partial<ConfirmableItem> = {}): ConfirmableItem => ({
  naturalKeyHash: naturalKeyHash(naturalKey),
  status: 'copied',
  contentHash: null,
  ...over,
});

const statesFor = async (
  reader: Awaited<ReturnType<typeof readerOverTarget>>,
  items: ConfirmableItem[],
): Promise<string[]> => {
  const out: string[] = [];
  for await (const found of confirmEach('email', items, reader)) out.push(found.row.state);
  return out;
};

describe('a target we could not list', () => {
  it('reads every item as unchecked, never missing', async () => {
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([], { throws: true }),
    });
    const states = await statesFor(reader, [item('a'), item('b'), item('c')]);
    expect(states).toEqual(['unchecked', 'unchecked', 'unchecked']);
    expect(states).not.toContain('missing');
  });

  it('refuses to hash over it too, when a direct caller asks', async () => {
    // The pass cannot reach this branch: `answerFor` asks `isPresent` first,
    // which refuses, so `hashOnTarget` is never called after a failed
    // enumeration. That makes it the one rule here no test through the pass
    // can prove — and an unreachable safety net is the kind that rots. It has
    // to refuse rather than answer `undefined`, because `undefined` means
    // *present, nothing to compare*: an outage would come out `present`.
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([], { throws: true, hashes: {} }),
    });
    await expect(reader.hashOnTarget!(item('a'))).rejects.toThrow(/would not list/);
  });

  it('does not fail the build, so one bad domain does not take the pass down', async () => {
    // Throwing from the build would fail the whole run on one unlistable
    // domain. Every row of THAT domain is honestly unchecked; the others are
    // untouched.
    await expect(
      readerOverTarget({ domain: 'email', reindexer: reindexer([], { throws: true }) }),
    ).resolves.toBeDefined();
  });
});

describe('a target we could list', () => {
  it('finds what is there and misses what is not', async () => {
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([entry('a'), entry('b')]),
    });
    expect(await statesFor(reader, [item('a'), item('b'), item('gone')])).toEqual([
      'present',
      'present',
      'missing',
    ]);
  });

  it('matches on the LEDGER’s key, not the raw one the target stores', async () => {
    // The target lists a Message-ID; the ledger holds a hash of it. Comparing
    // the two directly would match nothing and report a healthy account as
    // entirely missing.
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([entry('<abc@example.com>')]),
    });
    expect(await reader.isPresent(item('<abc@example.com>'))).toBe(true);
  });

  it('uses each domain’s own key function', async () => {
    // A file's key is its path, hashed by `fileNaturalKeyHash` — a different
    // function from mail's. Using one for the other silently matches nothing.
    const reader = await readerOverTarget({
      domain: 'file',
      reindexer: reindexer([entry('/Documents/a.txt')]),
    });
    expect(
      await reader.isPresent({
        naturalKeyHash: fileNaturalKeyHash('/Documents/a.txt'),
        status: 'copied',
        contentHash: null,
      }),
    ).toBe(true);
  });
});

describe('the byte comparison, where the target can make one', () => {
  it('verifies when the hashes agree', async () => {
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([entry('a')], { hashes: { a: 'HASH' } }),
    });
    expect(await statesFor(reader, [item('a', { contentHash: 'HASH' })])).toEqual(['verified']);
  });

  it('says differs when they do not', async () => {
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([entry('a')], { hashes: { a: 'OTHER' } }),
    });
    expect(await statesFor(reader, [item('a', { contentHash: 'HASH' })])).toEqual(['differs']);
  });

  it('is absent entirely when the target cannot hash — the §7d ceiling', async () => {
    // CalDAV and CardDAV implement no `contentHashFor`, deliberately and
    // permanently (`ports.ts`): those servers re-serialise what they store, so
    // a hash off the target could never equal the source's. The consequence
    // reaches the page — calendar, contacts and tasks come out `present`,
    // never `verified` — and this is where it bites.
    const reader = await readerOverTarget({
      domain: 'calendar',
      reindexer: reindexer([entry('uid-1')]),
    });
    expect(reader.hashOnTarget).toBeUndefined();
  });

  it('answers undefined rather than throwing for an item that is not there', async () => {
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: reindexer([entry('a')], { hashes: { a: 'HASH' } }),
    });
    await expect(reader.hashOnTarget!(item('gone'))).resolves.toBeUndefined();
  });
});
