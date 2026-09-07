// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE LANDS WHERE THE PERSON FILED IT, AND THE MANIFEST KEEPS THE REST.
 *
 * Workplan 0116 T5, 0112 §3. Placement is the one decision the import makes
 * that a person will SEE: open the target after the move and the albums are
 * folders, each holding the photos that were in it — and nothing else is
 * there twice. This file holds the three rules of it:
 *
 * 1. **Albums are folders, and a photo in two albums is in both** (0112's
 *    decision 5: copy per album). The reader collapsed four byte-identical
 *    files to one item; placement writes that one item once per album the
 *    person made.
 * 2. **The year folder is Google's filing, not the person's**, so a photo that
 *    is in an album is NOT written under its year as well — and a photo in no
 *    album lands under its year, because that is the only home the export
 *    gave it and a flat root is where two cameras' `IMG_0001.jpg` collide.
 * 3. **Everything the export knew goes in one manifest at the root**, named
 *    by a fingerprint of the archive so the same archive is the same file —
 *    sidecar verbatim, every folder, what each item is and what it belongs
 *    to. A target has no field for most of it and the download link expires.
 *
 * And the seam's rule 2, proved rather than assumed: the hash on the listing
 * is the hash the file domain computes over the bytes `fetch` returns, so a
 * live Drive migration and an archive import of the same file agree.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileContentHash } from '@openmig/shared';
import { ArchiveUnreadable } from '@openmig/core/archive-reader';
import { createTakeoutArchiveReader } from './takeout-archive-reader.ts';
import { ARCHIVE_MANIFEST_PREFIX, ArchiveFileSource } from './archive-file-source.ts';

const PHOTO = Buffer.from('one photo, in two albums and its year');
const EDIT = Buffer.from('the same photo, cropped in Google Photos');
const OTHER = Buffer.from('a photo in no album at all');

const made: string[] = [];
let root: string;

/** A Takeout as Google lays one out: albums, years, an edit, a sidecar. */
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'archive-placement-'));
  made.push(root);
  const photos = join(root, 'Takeout', 'Google Photos');
  for (const folder of ['Holiday in Kent', 'Favourites', 'Photos from 2019']) {
    await mkdir(join(photos, folder), { recursive: true });
    await writeFile(join(photos, folder, 'IMG_0001.jpg'), PHOTO);
  }
  // The edit sits beside the original in the year folder only, as Takeout
  // often ships it; the sidecar sits there too.
  await writeFile(join(photos, 'Photos from 2019', 'IMG_0001-edited.jpg'), EDIT);
  await writeFile(
    join(photos, 'Photos from 2019', 'IMG_0001.jpg.supplemental-metadata.json'),
    JSON.stringify({
      title: 'IMG_0001.jpg',
      description: 'Whitstable, before the rain',
      photoTakenTime: { timestamp: '1561968000' },
    }),
  );
  await mkdir(join(photos, 'Photos from 2021'), { recursive: true });
  await writeFile(join(photos, 'Photos from 2021', 'IMG_0002.jpg'), OTHER);
});

afterAll(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const sourceOver = (path: string) =>
  new ArchiveFileSource(createTakeoutArchiveReader(), { provider: 'google-takeout', path });

async function pathsIn(source: ArchiveFileSource, folder: string): Promise<string[]> {
  const { items } = await source.listSince({ path: folder });
  return items.map((i) => i.item.path).sort();
}

describe('albums are folders, and the year folder is not reproduced for a photo that has one', () => {
  it('lists the root, every album, and a year folder only for what lives nowhere else', async () => {
    const folders = (await sourceOver(root).listFolders()).map((f) => f.path);
    // `Photos from 2019` is here for the EDIT, which Takeout filed under the
    // year alone; `Photos from 2021` for the album-less photo. Neither is here
    // for IMG_0001.jpg, which has two albums of its own.
    expect(folders).toEqual(['', 'Favourites', 'Holiday in Kent', 'Photos from 2019', 'Photos from 2021']);
  });

  it('writes a photo once under EACH album it was in, under the album/name path', async () => {
    const source = sourceOver(root);
    expect(await pathsIn(source, 'Holiday in Kent')).toEqual(['Holiday in Kent/IMG_0001.jpg']);
    expect(await pathsIn(source, 'Favourites')).toEqual(['Favourites/IMG_0001.jpg']);
    // Two placements, one item: the same hash on both, which is how the
    // ledger and the manifest know they are one photo filed twice.
    const [kent] = (await source.listSince({ path: 'Holiday in Kent' })).items;
    const [fav] = (await source.listSince({ path: 'Favourites' })).items;
    expect(kent!.item.contentHash).toBe(fav!.item.contentHash);
    expect(kent!.item.createdAt).toBe('2019-07-01T08:00:00.000Z');
  });

  it('does NOT write the album photo under its year too — only what has no album lands there', async () => {
    const source = sourceOver(root);
    expect(
      await pathsIn(source, 'Photos from 2019'),
      'a photo that has an album was written under its year as well, so the person finds it twice',
    ).toEqual(['Photos from 2019/IMG_0001-edited.jpg']);
    expect(await pathsIn(source, 'Photos from 2021')).toEqual(['Photos from 2021/IMG_0002.jpg']);
  });
});

describe('the manifest beside the tree', () => {
  it('is one JSON file at the root carrying everything the export knew, fingerprinted by the archive', async () => {
    const source = sourceOver(root);
    const { items } = await source.listSince({ path: '' });
    expect(items).toHaveLength(1);
    const manifest = items[0]!.item;
    expect(manifest.path.startsWith(ARCHIVE_MANIFEST_PREFIX)).toBe(true);
    expect(manifest.path.endsWith('.json')).toBe(true);
    const { content } = await source.fetch(manifest);
    const parsed = JSON.parse(new TextDecoder().decode(content)) as {
      provider: string;
      items: Array<{ path: string; placedIn: string[]; kind: string; relatedTo?: string; metadata: { sidecar?: { description?: string } } }>;
    };
    expect(parsed.provider).toBe('google-takeout');
    expect(parsed.items).toHaveLength(3);
    const original = parsed.items.find((i) => i.path === 'IMG_0001.jpg')!;
    // Verbatim (0116 T2, rule 3): the description Google held and the file does not.
    expect(original.metadata.sidecar?.description).toBe('Whitstable, before the rain');
    expect(original.placedIn.sort()).toEqual(['Favourites', 'Holiday in Kent']);
    const edit = parsed.items.find((i) => i.path === 'IMG_0001-edited.jpg')!;
    expect(edit.kind).toBe('edited');
    expect(edit.relatedTo).toBe('IMG_0001.jpg');
  });

  it('is the SAME file for the same archive, so a second import skips it like any other item', async () => {
    const a = (await sourceOver(root).listSince({ path: '' })).items[0]!.item;
    const b = (await sourceOver(root).listSince({ path: '' })).items[0]!.item;
    expect(b.path).toBe(a.path);
    expect(b.contentHash).toBe(a.contentHash);
  });
});

describe("the seam's rule 2: the listing's hash is the file domain's hash over the fetched bytes", () => {
  it('holds for every placement and for the manifest', async () => {
    const source = sourceOver(root);
    for (const folder of await source.listFolders()) {
      for (const listed of (await source.listSince(folder)).items) {
        const { content } = await source.fetch(listed.item);
        expect(content, `${listed.item.path} fetched no bytes`).toBeDefined();
        expect(
          fileContentHash(content!),
          `${listed.item.path}: the listed hash is not the hash of its bytes — a live migration ` +
            'and an archive import of this file would write it twice',
        ).toBe(listed.item.contentHash);
        expect(content!.byteLength).toBe(listed.item.size);
      }
    }
    const [kent] = (await source.listSince({ path: 'Holiday in Kent' })).items;
    expect(Buffer.from((await source.fetch(kent!.item)).content!)).toEqual(PHOTO);
  });
});

describe('what a snapshot refuses to say', () => {
  it('declares itself a snapshot and offers neither a key set nor a bin', () => {
    const source = sourceOver(root);
    // Read by `runFileSync`: with it, the loop never counts an absence.
    expect(source.snapshot).toBe(true);
    // And nothing here could feed absence-counting even if it were on.
    expect('listKeys' in source).toBe(false);
    expect('listTrashedPaths' in source).toBe(false);
  });

  it('ignores a cursor — an archive has no change feed, so every pass lists everything', async () => {
    const source = sourceOver(root);
    const fresh = await source.listSince({ path: 'Favourites' });
    const again = await source.listSince({ path: 'Favourites' }, fresh.nextCursor);
    expect(again.items.map((i) => i.item.path)).toEqual(fresh.items.map((i) => i.item.path));
  });
});

describe('an archive that will not open', () => {
  it("fails the pass with the reader's sentence, and never lists an empty archive instead", async () => {
    const empty = await mkdtemp(join(tmpdir(), 'not-a-takeout-'));
    made.push(empty);
    const source = sourceOver(empty);
    await expect(source.listFolders()).rejects.toBeInstanceOf(ArchiveUnreadable);
    await expect(source.listFolders()).rejects.toThrow(/could not be opened/);
  });
});
