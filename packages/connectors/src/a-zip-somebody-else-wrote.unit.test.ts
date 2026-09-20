// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ZIP SOMEBODY ELSE WROTE (workplan 0116 D7: the reader we own).
 *
 * Every other test of the zip reader reads archives `zip-test-writer.ts`
 * builds. The decision was to own the reader rather than depend on one, and
 * a writer of ours proving a reader of ours is exactly the loop that lets a
 * shared misreading of the format pass unnoticed. This test reads the two
 * parts in `test/e2e/fixtures/takeout-zip`, written by Info-ZIP (`zip -r -X`,
 * the writer behind a good share of the `.zip` files in the world), and
 * checks that the Takeout reader answers over them precisely what it answers
 * over the extracted folder in `test/e2e/fixtures/takeout`: items, hashes,
 * folders, placement, kinds, links, sidecars, dates and bytes. The same two
 * parts are what the self-hosted E2E mounts into the appliance for the
 * zip-route gate, so the gate and this test read one archive.
 *
 * A checked-in binary, deliberately: the reader's compatibility with a real
 * writer is a fact about bytes, and a fixture built at test time by whatever
 * `zip` happens to be on the machine would prove something different on
 * every machine.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { ArchiveHandle } from '@openmig/core/archive-reader';
import { createTakeoutArchiveReader } from './takeout-archive-reader.ts';
import { openFileSource, openZip, ZIP_METHOD_DEFLATE, ZIP_METHOD_STORED } from './zip-archive.ts';

const FIXTURES = fileURLToPath(new URL('../../../test/e2e/fixtures/', import.meta.url));
const FOLDER = `${FIXTURES}takeout`;
const PART_ONE = `${FIXTURES}takeout-zip/takeout-20240506T070810Z-001.zip`;
const PART_TWO = `${FIXTURES}takeout-zip/takeout-20240506T070810Z-002.zip`;

const reader = createTakeoutArchiveReader();

/** Everything the reader says about an archive, in an order that does not depend on the container. */
async function listing(path: string) {
  const handle: ArchiveHandle = await reader.open({ provider: 'google-takeout', path });
  try {
    const items = [];
    for await (const item of reader.items(handle)) items.push(item);
    items.sort((a, b) => a.contentHash.localeCompare(b.contentHash));
    const bytes: Record<string, string> = {};
    for (const item of items) bytes[item.path] = Buffer.from(await reader.content(handle, item)).toString('hex');
    return { items, summary: await reader.summary(handle), bytes };
  } finally {
    await handle.close();
  }
}

describe('a zip written by Info-ZIP, not by our test writer', () => {
  it('has the shapes a real writer emits: a directory placeholder, stored and deflated members', async () => {
    const zip = await openZip(await openFileSource(PART_TWO));
    try {
      const placeholder = zip.entries.find((e) => e.name === 'Takeout/Google Photos/Photos from 2024/');
      expect(placeholder?.isDirectory, 'Info-ZIP writes the folder as a member of its own').toBe(true);
      const methods = new Set(zip.entries.filter((e) => !e.isDirectory).map((e) => e.method));
      // Info-ZIP stores what deflate cannot shrink and deflates the rest, so
      // one small archive exercises both paths of the reader.
      expect(methods).toEqual(new Set([ZIP_METHOD_STORED, ZIP_METHOD_DEFLATE]));
      expect(zip.entries.map((e) => e.name).sort()).toEqual([
        'Takeout/Google Photos/Photos from 2024/',
        'Takeout/Google Photos/Photos from 2024/IMG_0001-edited.jpg',
        'Takeout/Google Photos/Photos from 2024/IMG_0001.jpg',
        'Takeout/Google Photos/Photos from 2024/IMG_0001.jpg.supplemental-metadata.json',
        'Takeout/Google Photos/Photos from 2024/IMG_0002.jpg',
      ]);
    } finally {
      await zip.close();
    }
  });

  it('is read by the Takeout reader exactly as the folder it extracts to, from either part', async () => {
    const folder = await listing(FOLDER);
    expect(folder.items).toHaveLength(3);
    expect(folder.items.find((i) => i.path === 'IMG_0001.jpg')?.metadata.sidecarFound).toBe(true);
    // Part 1 holds only the album copy; the sidecar, the edit and the second
    // photo are in part 2. Pointed at either, the reader reads both.
    expect(await listing(PART_ONE)).toEqual(folder);
    expect(await listing(PART_TWO)).toEqual(folder);
  });
});
