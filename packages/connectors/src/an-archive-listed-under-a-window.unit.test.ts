// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE EXPORT ARCHIVE UNDER A WINDOW (workplan 0170 §4.2, D6).
 *
 * An archive has no server to ask, so it is walked whole, as it always is, and
 * an item dated before the window goes back as `unmarked`: the window saves
 * the uploads, not the walk. An item with NO date is in the window, the
 * owner's answer to D6, *"one uploads all"*: an export item without a sidecar
 * date carries the epoch, and the epoch is not "old", it is "unknown".
 *
 * The cursor is a marker, never read back, so it can claim nothing about an
 * item the window set aside: read back without a window, every item is listed.
 */

import { describe, it, expect } from 'vitest';
import { ArchiveFileSource } from './archive-file-source.ts';
import type { ArchiveHandle, ArchiveItem, ArchiveReader } from '@openmig/core/archive-reader';

const SINCE = new Date('2026-08-26T00:00:00Z');
const LOCATION = { provider: 'google-takeout' as const, path: '/tmp/takeout' };

function item(path: string, contentHash: string, createdAt?: string): ArchiveItem {
  return {
    path,
    sizeBytes: 8,
    contentHash,
    ...(createdAt ? { createdAt } : {}),
    // In the import's root folder, which `listSince` lists for path ''.
    placeIn: [],
  } as unknown as ArchiveItem;
}

const OLD = item('Photos from 2021/holiday.jpg', 'a'.repeat(64), '2021-07-14T10:00:00.000Z');
const NEW = item('Photos from 2026/autumn.jpg', 'b'.repeat(64), '2026-11-01T10:00:00.000Z');
const UNDATED = item('Unsorted/scan.jpg', 'c'.repeat(64));

function readerOf(items: ReadonlyArray<ArchiveItem>): ArchiveReader {
  return {
    provider: 'google-takeout',
    open: async (): Promise<ArchiveHandle> =>
      ({ provider: 'google-takeout', root: '/tmp/takeout', close: async () => {} }) as ArchiveHandle,
    async *items() {
      yield* items;
    },
    summary: async () => ({ items: items.length, bytes: 8 * items.length }),
    content: async () => new Uint8Array(8),
  } as unknown as ArchiveReader;
}

/** The archive's own items, by path, without the manifest it adds to the root. */
const paths = (listed: ReadonlyArray<{ item: { path: string; sourceRef?: string } }> | undefined) =>
  (listed ?? []).filter((raw) => !raw.item.sourceRef?.startsWith('manifest:')).map((raw) => raw.item.path);

describe('the export archive, listed under a window (workplan 0170)', () => {
  it('without `since` lists every item, as it always did, and sets nothing aside', async () => {
    const source = new ArchiveFileSource(readerOf([OLD, NEW, UNDATED]), LOCATION);

    const listed = await source.listSince({ path: '' });

    expect(paths(listed.items)).toEqual([OLD.path, NEW.path, UNDATED.path]);
    expect(listed.unmarked).toBeUndefined();
  });

  it('with `since` keeps the window, and an item with NO date is in it (D6)', async () => {
    const source = new ArchiveFileSource(readerOf([OLD, NEW, UNDATED]), LOCATION);

    const listed = await source.listSince({ path: '' }, undefined, { since: SINCE });

    expect(paths(listed.items)).toEqual([NEW.path, UNDATED.path]);
    expect(paths(listed.unmarked)).toEqual([OLD.path]);
  });

  it('the cursor claims nothing: read back without a window, the older item is listed', async () => {
    const source = new ArchiveFileSource(readerOf([OLD, NEW]), LOCATION);

    const { nextCursor } = await source.listSince({ path: '' }, undefined, { since: SINCE });
    const after = await source.listSince({ path: '' }, nextCursor);

    expect(paths(after.items)).toEqual([OLD.path, NEW.path]);
  });
});
