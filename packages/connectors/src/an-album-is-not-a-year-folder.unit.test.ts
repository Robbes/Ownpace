// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ALBUM IS NOT A YEAR FOLDER, AND THE BIN IS NEITHER.
 *
 * Takeout puts albums, year folders and the bin side by side under the photo
 * tree, and #1047 left this file's predecessor telling them apart with
 * `/^Photos from (\d{4})$/` — English, so under a translated root EVERY folder
 * read as an album and a photo that had one was placed under its year folder
 * as well. #1047 pinned that wrong answer on purpose and said the rule which
 * fixed it would make the test fail; it did.
 *
 * THE RULE, MEASURED on the owner's two real exports rather than reasoned
 * about — the second requested 2026-09-21, 8477 files, 44.87 GB:
 *
 * | folder                     | own `metadata.json` | bucket |
 * |----------------------------|---------------------|--------|
 * | `Foto_s van 2024/25/26`    | no (all three)      | year   |
 * | `Wandeling`, `Oud Album_7$#_`  | YES (both)          | album  |
 * | `Prullenbak` (the bin)     | no                  | other  |
 *
 * An album is known POSITIVELY, by its own `metadata.json`, so the year test
 * only has to catch what is left — which is what makes an album called
 * `Thailand 2019` safe. Nothing here reads English.
 *
 * Two facts from that export drive the rest of this file:
 *
 * - **All four album photos were in a year folder too.** So the double
 *   placement #1047 warned about was real, not theoretical.
 * - **`Oud Album'7$#%` reaches disk as `Oud Album_7$#_`** — Takeout replaces
 *   `'` and `%` with `_` but leaves `$` and `#`. The folder name has lost
 *   characters the album's own `metadata.json` still has, so the title there
 *   is the only place the person's real name survives.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchiveItem, ArchiveSummary } from '@openmig/core/archive-reader';
import { createTakeoutArchiveReader } from './takeout-archive-reader.ts';
import { buildZip, type ZipTestFile } from './zip-test-writer.ts';

const PHOTO = Buffer.from('a photo that is in an album and in its year');
const BINNED = Buffer.from('a photo the person deleted');

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const reader = createTakeoutArchiveReader();

/** The owner's real export in miniature: a year folder, two albums, a bin. */
async function realShapedExport(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'album-rule-'));
  made.push(root);
  const photos = join(root, 'Takeout', 'Google Foto_s');

  const year = join(photos, 'Foto_s van 2026');
  await mkdir(year, { recursive: true });
  for (const name of ['IMG_0001.jpg', 'IMG_0002.jpg']) {
    await writeFile(join(year, name), name === 'IMG_0001.jpg' ? PHOTO : BINNED);
    await writeFile(
      join(year, `${name}.supplemental-metadata.json`),
      JSON.stringify({ title: name, photoTakenTime: { timestamp: '1789636930' } }),
    );
  }

  // The album: the SAME photo again, plus its own metadata.json — with the
  // real title, which the folder name has already lost.
  const album = join(photos, 'Oud Album_7$#_');
  await mkdir(album, { recursive: true });
  await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);
  await writeFile(
    join(album, 'metadata.json'),
    JSON.stringify({
      title: "Oud Album'7$#%",
      sharedAlbumComments: [{ text: 'a note to somebody', contentOwnerName: 'The owner' }],
      access: 'protected',
    }),
  );

  // The bin: translated, no metadata.json, and photos that are nowhere else.
  const bin = join(photos, 'Prullenbak');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'IMG_0009.jpg'), Buffer.from('binned, and not going anywhere'));
  await writeFile(join(bin, 'IMG_0010.jpg'), Buffer.from('also binned'));
  return root;
}

async function readAll(path: string): Promise<{ items: ArchiveItem[]; summary: ArchiveSummary }> {
  const handle = await reader.open({ provider: 'google-takeout', path });
  try {
    const items: ArchiveItem[] = [];
    for await (const item of reader.items(handle)) items.push(item);
    return { items: items.sort((a, b) => (a.path < b.path ? -1 : 1)), summary: await reader.summary(handle) };
  } finally {
    await handle.close();
  }
}

describe('the three buckets, on the shape the owner’s export actually has', () => {
  it('places the album photo ONCE — under the album, not under its year as well', async () => {
    const { items } = await readAll(await realShapedExport());
    const shared = items.find((i) => i.path === 'IMG_0001.jpg');
    expect(shared).toBeDefined();
    // It IS in both folders — that is what Takeout wrote.
    expect([...shared!.folders].sort()).toEqual(['Foto_s van 2026', 'Oud Album_7$#_']);
    // It is PLACED in one. The year folder is not reproduced (0112 §3).
    expect(shared!.placeIn).toEqual(['Oud Album_7$#_']);
  });

  it('leaves the bin behind and says how much it left', async () => {
    const { items, summary } = await readAll(await realShapedExport());
    expect(items.map((i) => i.path)).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg']);
    expect(items.some((i) => i.folders.includes('Prullenbak'))).toBe(false);
    // Counted, never silently dropped — the person is owed the reason their
    // target holds fewer photos than Google showed them.
    expect(summary.skipped).toEqual({ folders: ['Prullenbak'], items: 2 });
  });

  it('carries the person’s own spelling, which the folder name has lost', async () => {
    const { items, summary } = await readAll(await realShapedExport());
    const shared = items.find((i) => i.path === 'IMG_0001.jpg')!;
    // The folder is what Takeout wrote; the title is what the person typed.
    expect(shared.metadata.albums).toEqual(['Oud Album_7$#_']);
    expect(shared.metadata.albumTitles).toEqual(["Oud Album'7$#%"]);
    expect(summary.albums).toEqual([
      {
        folder: 'Oud Album_7$#_',
        title: "Oud Album'7$#%",
        shareActivity: true,
        metadata: {
          title: "Oud Album'7$#%",
          sharedAlbumComments: [{ text: 'a note to somebody', contentOwnerName: 'The owner' }],
          access: 'protected',
        },
      },
    ]);
  });

  it('flags share ACTIVITY, and does not pretend to know an album was shared', async () => {
    // A correction worth keeping, because I had this wrong for an hour:
    // `access: "protected"` is NOT a share signal. Both of the owner's albums
    // carry it and he shared only one — so it is the default, and a reader
    // that took it for sharing would flag every album the person has.
    //
    // What IS evidence is `sharedAlbumComments`, which only the shared album
    // carried. It is evidence of ACTIVITY, not a complete answer: an album
    // shared with nobody commenting has none. So the flag is named for what it
    // measures, and the guide tells EVERYONE with albums that sharing does not
    // travel, rather than relying on a signal that under-reports.
    const { summary } = await readAll(await realShapedExport());
    expect(summary.albums?.[0]?.shareActivity).toBe(true);
    expect(summary.albums?.[0]?.metadata.access).toBe('protected');
  });

  it('is still an album with neither `access` nor comments in its metadata', async () => {
    // The owner's point, 2026-09-21: he TYPED a message when sharing, so the
    // comments field exists because of that — share in silence and it is
    // absent. He adds that `access` may be missing on a shared album too.
    //
    // So neither field may be load-bearing, and this pins that they are not:
    // a `metadata.json` holding nothing but a title still makes an album, and
    // the absence of the flag says nothing about whether it was shared.
    const root = await mkdtemp(join(tmpdir(), 'bare-album-'));
    made.push(root);
    const photos = join(root, 'Takeout', 'Google Foto_s');
    const year = join(photos, 'Foto_s van 2024');
    await mkdir(year, { recursive: true });
    await writeFile(join(year, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(year, 'IMG_0001.jpg.supplemental-metadata.json'), JSON.stringify({ title: 'IMG_0001.jpg' }));
    const album = join(photos, 'Thailand');
    await mkdir(album, { recursive: true });
    await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(album, 'metadata.json'), JSON.stringify({ title: 'Thailand' }));

    const { items, summary } = await readAll(root);
    expect(items[0]!.placeIn).toEqual(['Thailand']);
    expect(summary.albums).toEqual([{ folder: 'Thailand', title: 'Thailand', metadata: { title: 'Thailand' } }]);
    expect(summary.albums?.[0]?.shareActivity).toBeUndefined();
  });

  it('is still an album when its metadata.json is empty', async () => {
    // The floor of the same property: `{}` is an object, so it is an album.
    // Nothing inside is required, because the reader must not depend on a
    // field Google may or may not write.
    const root = await mkdtemp(join(tmpdir(), 'empty-metadata-'));
    made.push(root);
    const album = join(root, 'Takeout', 'Google Foto_s', 'Wandeling');
    await mkdir(album, { recursive: true });
    await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(album, 'metadata.json'), '{}');

    const { items, summary } = await readAll(root);
    expect(items[0]!.placeIn).toEqual(['Wandeling']);
    // No title in the metadata, so the folder name is the honest fallback.
    expect(summary.albums?.[0]?.title).toBe('Wandeling');
  });

  it('does not flag activity on an album that merely has the default access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unshared-'));
    made.push(root);
    const album = join(root, 'Takeout', 'Google Foto_s', 'Wandeling');
    await mkdir(album, { recursive: true });
    await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);
    // Exactly what the owner's UNSHARED album carries.
    await writeFile(
      join(album, 'metadata.json'),
      JSON.stringify({ title: 'Wandeling', description: '', access: 'protected' }),
    );
    const { summary } = await readAll(root);
    expect(summary.albums?.[0]?.title).toBe('Wandeling');
    expect(summary.albums?.[0]?.shareActivity).toBeUndefined();
  });
});

describe('the properties the rule’s ORDER is there for', () => {
  it('reads an album named for a year as an album, not a year folder', async () => {
    // The trap the positive test avoids: `Thailand 2019` contains a year, so a
    // rule that asked the year question first would place its photos under it
    // as a year folder and lose the album.
    const root = await mkdtemp(join(tmpdir(), 'album-2019-'));
    made.push(root);
    const photos = join(root, 'Takeout', 'Google Foto_s');
    const year = join(photos, 'Foto_s van 2019');
    await mkdir(year, { recursive: true });
    await writeFile(join(year, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(year, 'IMG_0001.jpg.supplemental-metadata.json'), JSON.stringify({ title: 'IMG_0001.jpg' }));
    const album = join(photos, 'Thailand 2019');
    await mkdir(album, { recursive: true });
    await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(album, 'metadata.json'), JSON.stringify({ title: 'Thailand 2019' }));

    const { items } = await readAll(root);
    expect(items[0]!.placeIn).toEqual(['Thailand 2019']);
    expect(items[0]!.metadata.years).toEqual(['Foto_s van 2019']);
  });

  it('does not take a `metadata.json` that is not an object as an album', async () => {
    // A year folder that happened to hold a `metadata.json` holding an array
    // would otherwise be promoted to an album on the file name alone.
    const root = await mkdtemp(join(tmpdir(), 'not-an-object-'));
    made.push(root);
    const year = join(root, 'Takeout', 'Google Foto_s', 'Foto_s van 2020');
    await mkdir(year, { recursive: true });
    await writeFile(join(year, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(year, 'IMG_0001.jpg.supplemental-metadata.json'), JSON.stringify({ title: 'IMG_0001.jpg' }));
    await writeFile(join(year, 'metadata.json'), JSON.stringify(['not', 'an', 'album']));

    const { items, summary } = await readAll(root);
    expect(items[0]!.metadata.years).toEqual(['Foto_s van 2020']);
    expect(items[0]!.metadata.albums).toEqual([]);
    expect(summary.albums).toBeUndefined();
  });

  it('says nothing about skipping when there was nothing to skip', async () => {
    // Absent rather than a zero: a zero reads as a fact about an export this
    // reader bucketed, and an export with no bin has no such fact.
    const root = await mkdtemp(join(tmpdir(), 'no-bin-'));
    made.push(root);
    const year = join(root, 'Takeout', 'Google Foto_s', 'Foto_s van 2022');
    await mkdir(year, { recursive: true });
    await writeFile(join(year, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(year, 'IMG_0001.jpg.supplemental-metadata.json'), JSON.stringify({ title: 'IMG_0001.jpg' }));

    const { summary } = await readAll(root);
    expect(summary.skipped).toBeUndefined();
  });
});

describe('an album whose metadata.json is in a DIFFERENT part of the download', () => {
  it('still reads as an album, because the parts are one tree', async () => {
    // The owner found this in his real 46-part export (2026-09-21): the
    // `Oud Album_7$#_` folder appeared in two `.zip` parts, the photos in one
    // and `metadata.json` in the other. A reader that classified per part
    // would see a folder with no metadata and call it the bin — and skip it.
    //
    // Nothing in the repository's fixtures had that shape: they split by year
    // folder, so every album stayed whole inside one part. This is the case
    // that works on two parts and would have failed on forty-six.
    const work = await mkdtemp(join(tmpdir(), 'split-album-'));
    made.push(work);
    const member = (name: string, data: Buffer): ZipTestFile => ({ name, data, method: 'store' });

    // Part 1: the year folder, and the album's PHOTOS — but no metadata.json.
    await writeFile(
      join(work, 'takeout-20260921T085049Z-1-001.zip'),
      buildZip([
        member('Takeout/Google Foto_s/Foto_s van 2026/IMG_0001.jpg', PHOTO),
        member(
          'Takeout/Google Foto_s/Foto_s van 2026/IMG_0001.jpg.supplemental-metadata.json',
          Buffer.from(JSON.stringify({ title: 'IMG_0001.jpg' })),
        ),
        member('Takeout/Google Foto_s/Wandeling/IMG_0001.jpg', PHOTO),
      ]),
    );
    // Part 2: the SAME album folder, carrying only its metadata.json.
    await writeFile(
      join(work, 'takeout-20260921T085049Z-1-002.zip'),
      buildZip([
        member(
          'Takeout/Google Foto_s/Wandeling/metadata.json',
          Buffer.from(JSON.stringify({ title: 'Wandeling', access: 'protected' })),
        ),
      ]),
    );

    // Pointed at either part, the reader opens both and sees one tree.
    for (const part of ['takeout-20260921T085049Z-1-001.zip', 'takeout-20260921T085049Z-1-002.zip']) {
      const { items, summary } = await readAll(join(work, part));
      expect(items).toHaveLength(1);
      // An album, not the bin: metadata from part 2 classified a folder whose
      // photos are in part 1.
      expect(items[0]!.placeIn).toEqual(['Wandeling']);
      expect(summary.albums?.map((a) => a.title)).toEqual(['Wandeling']);
      expect(summary.skipped).toBeUndefined();
    }
  });
});
