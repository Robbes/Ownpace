// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAKEOUT THAT IS NOT IN ENGLISH.
 *
 * The reader looked for `Takeout/Google Photos`, a constant, and for
 * `Photos from <year>` inside it. Google translates both. The owner's own
 * 45 GB export (2026-09-21) is `Takeout/Google Foto_s` holding
 * `Foto_s van 2025` — Dutch, with `'` written as `_` — and the reader refused
 * the entire export with a sentence that blamed his download:
 *
 *     This archive could not be opened — no “Takeout/Google Photos” folder was
 *     found in … If the download is still running, or only some parts
 *     arrived, it will look like this.
 *
 * He had clicked forty-six download buttons to get it. The sentence would have
 * sent him to do it again, to be told the same thing.
 *
 * WHAT MADE IT HARD TO SEE, recorded because it fooled me first: Takeout's own
 * picker lists these folders in ENGLISH (`Photos from 2011`, `Trash`) even for
 * a Dutch account. Only the paths are translated, and a display name is not a
 * path. I read the picker, saw English, and nearly concluded there was no
 * defect. (`archive_browser.html`, the report in part 001, turned out to say
 * it the other way round: its folder names ARE the Dutch paths. It carries one
 * English key, `data-english-name="PHOTOS"`, and that is for the SERVICE only
 * — the folders under it have no English name anywhere in the export.)
 *
 * So the root is FOUND, not named: one level under `Takeout`, the folder whose
 * subfolders hold photos — media with sidecars beside them where there are
 * sidecars, media by extension where there are not. That is what a photo tree
 * IS in any language. These tests hold the reader to answering identically
 * whatever Google called the folders, and to naming what it DID see when it
 * finds no photo tree at all.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveUnreadable } from '@openmig/core/archive-reader';
import type { ArchiveItem } from '@openmig/core/archive-reader';
import { createTakeoutArchiveReader } from './takeout-archive-reader.ts';

const PHOTO = Buffer.from('one photo, in a library that is not in English');
const OTHER = Buffer.from('a second photo, a year later');

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** The same two-photo library, under whatever Google called the folders. */
async function libraryNamed(product: string, year: (n: number) => string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'not-in-english-'));
  made.push(root);
  for (const [n, data] of [[2019, PHOTO] as const, [2021, OTHER] as const]) {
    const dir = join(root, 'Takeout', product, year(n));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `IMG_000${n === 2019 ? 1 : 2}.jpg`), data);
    await writeFile(
      join(dir, `IMG_000${n === 2019 ? 1 : 2}.jpg.supplemental-metadata.json`),
      JSON.stringify({ title: `IMG_000${n === 2019 ? 1 : 2}.jpg`, photoTakenTime: { timestamp: '1561968000' } }),
    );
  }
  return root;
}

const reader = createTakeoutArchiveReader();

async function itemsOf(path: string): Promise<ArchiveItem[]> {
  const handle = await reader.open({ provider: 'google-takeout', path });
  try {
    const out: ArchiveItem[] = [];
    for await (const item of reader.items(handle)) out.push(item);
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  } finally {
    await handle.close();
  }
}

/** What a comparison between two exports may look at: everything but the folder names. */
const shapeOf = (items: ArchiveItem[]): unknown =>
  items.map((i) => ({ hash: i.contentHash, size: i.sizeBytes, created: i.createdAt, kind: i.kind }));

describe('the folder names Google translates', () => {
  it('reads a Dutch export — the owner’s own, which today is refused outright', async () => {
    const items = await itemsOf(await libraryNamed('Google Foto_s', (n) => `Foto_s van ${n}`));
    expect(items).toHaveLength(2);
    // The metadata survived too: finding the root is worth nothing if the
    // sidecar beside the photo is then looked for in the wrong place.
    expect(items.every((i) => i.createdAt !== undefined)).toBe(true);
  });

  it('reads German and Spanish ones, which are different translations again', async () => {
    const de = await itemsOf(await libraryNamed('Google Fotos', (n) => `Fotos aus ${n}`));
    const es = await itemsOf(await libraryNamed('Google Fotos', (n) => `Fotos de ${n}`));
    expect(de).toHaveLength(2);
    expect(es).toHaveLength(2);
  });

  it('answers the same for every language, byte for byte', async () => {
    // The property that matters: the export is the same library whatever
    // locale requested it, so the hashes, sizes, dates and kinds must match.
    // Only the folder NAMES differ, and those are the person's own words.
    const en = shapeOf(await itemsOf(await libraryNamed('Google Photos', (n) => `Photos from ${n}`)));
    const nl = shapeOf(await itemsOf(await libraryNamed('Google Foto_s', (n) => `Foto_s van ${n}`)));
    expect(nl).toEqual(en);
  });

  it('finds the photo tree beside other products, not the first folder it meets', async () => {
    // A Takeout of several products. `Drive` sorts before `Google Foto_s`, so
    // a reader that took the first child would import a folder of documents
    // as a photo library.
    const root = await libraryNamed('Google Foto_s', (n) => `Foto_s van ${n}`);
    const drive = join(root, 'Takeout', 'Drive', 'Werk');
    await mkdir(drive, { recursive: true });
    await writeFile(join(drive, 'begroting.txt'), 'not a photo');
    const items = await itemsOf(root);
    expect(items).toHaveLength(2);
    expect(items.every((i) => !i.path.includes('begroting'))).toBe(true);
  });
});

describe('what makes a folder the photo tree, when the sidecars are not there', () => {
  it('reads a library whose sidecars are ALL missing — this reader’s own rule', async () => {
    // "A missing sidecar is not an error" is written into the reader. A first
    // pass that demanded the media+sidecar PAIR and stopped there refused such
    // an export outright — the same class of defect as naming the root, found
    // by five other suites when this change first ran.
    const root = await mkdtemp(join(tmpdir(), 'no-sidecars-'));
    made.push(root);
    const dir = join(root, 'Takeout', 'Google Foto_s', 'Foto_s van 2019');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'IMG_0001.jpg'), PHOTO);
    await writeFile(join(dir, 'VID_0002.mp4'), OTHER);

    const items = await itemsOf(root);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.metadata.sidecarFound === false)).toBe(true);
  });

  it('lets metadata out-vote a stray snap in someone’s Drive, whatever the folders sort like', async () => {
    // `Drive` sorts before `Google Foto_s`, and a Drive export can perfectly
    // well hold a JPEG. If the media-extension fallback ran per product, the
    // first product with a photo in it would win and the real library would be
    // skipped. So the PAIR is asked of every product before the fallback is
    // asked of any.
    const root = await libraryNamed('Google Foto_s', (n) => `Foto_s van ${n}`);
    const drive = join(root, 'Takeout', 'Drive', 'Vakantie');
    await mkdir(drive, { recursive: true });
    await writeFile(join(drive, 'strandfoto.jpg'), Buffer.from('a snap filed in Drive, not Photos'));

    const items = await itemsOf(root);
    expect(items.map((i) => i.path)).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg']);
    expect(items.every((i) => i.metadata.sidecarFound)).toBe(true);
  });
});

describe('when there is no photo tree, the refusal says what was there', () => {
  it('names the products it found instead of blaming the download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'no-photos-'));
    made.push(root);
    for (const product of ['Drive', 'Mail']) {
      await mkdir(join(root, 'Takeout', product, 'Werk'), { recursive: true });
      await writeFile(join(root, 'Takeout', product, 'Werk', 'begroting.txt'), 'not a photo');
    }
    const err = await reader.open({ provider: 'google-takeout', path: root }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    const reason = (err as ArchiveUnreadable).reason;
    expect(reason).toContain('Drive');
    expect(reason).toContain('Mail');
    // The two things the old sentence got wrong: it named a path that was
    // never going to be there, and it sent the person back to their download.
    // The product's English name may still appear as prose — what must not
    // appear is the path the reader used to go looking.
    expect(reason).not.toContain('Takeout/Google Photos');
    expect(reason).not.toMatch(/still\s+running/);
  });

  it('still says a missing Takeout is a missing Takeout', async () => {
    // The unfinished-download sentence is right HERE and must survive: there
    // is no `Takeout` folder at all, which is what half an export looks like.
    const root = await mkdtemp(join(tmpdir(), 'no-takeout-'));
    made.push(root);
    await mkdir(join(root, 'notes'), { recursive: true });
    await writeFile(join(root, 'notes', 'todo.txt'), 'not an export');
    const err = await reader.open({ provider: 'google-takeout', path: root }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toMatch(/still\s+running|only some parts/);
  });
});

describe('the half this change does NOT close, pinned so it cannot ship quietly', () => {
  /**
   * Finding the root is one of two translated things. `Photos from <year>` is
   * the other, and it is still a constant — so under a Dutch root every folder
   * reads as an ALBUM, year folders included.
   *
   * For the owner's own export that is invisible: it has no albums, so each
   * photo sits in exactly one folder and lands in exactly one place. Add an
   * album and it stops being invisible — the photo is placed twice, once under
   * the album and once under the year folder that 0112 §3 says must not be
   * reproduced when an album exists.
   *
   * This test asserts the WRONG answer on purpose. It is here because the
   * right one cannot be written yet: it needs a rule that tells an album from
   * a year folder without reading English, and the export that settles which
   * rule that is has not arrived. Measured against the owner's real export
   * (8517 files, 45.03 GB), what is NOT the rule:
   *
   *   - the folder's own `metadata.json` — no folder in his export has one,
   *     year folders included, so the "albums carry one" rule is untested,
   *     not confirmed;
   *   - the filename — Trash is `Prullenbak`, translated like everything else,
   *     and only 1 of its 25 media carries Android's `.trashed-` prefix;
   *   - the report — `archive_browser.html` names the service in English and
   *     the folders in Dutch.
   *
   * When that rule lands, this test fails, and the expectation below is what
   * changes: `placeIn` becomes `['Reis']` alone.
   */
  it('places an album photo twice, because a Dutch year folder still reads as an album', async () => {
    const root = await libraryNamed('Google Foto_s', (n) => `Foto_s van ${n}`);
    const album = join(root, 'Takeout', 'Google Foto_s', 'Reis');
    await mkdir(album, { recursive: true });
    await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);

    const items = await itemsOf(root);
    const shared = items.find((i) => i.folders.length > 1);
    expect(shared).toBeDefined();
    expect([...shared!.folders].sort()).toEqual(['Foto_s van 2019', 'Reis']);
    // Today: both, so the photo is written under the year folder as well.
    expect([...shared!.placeIn].sort()).toEqual(['Foto_s van 2019', 'Reis']);
    // And the year folder is reported as one of the person's albums.
    expect(shared!.metadata.years).toEqual([]);
  });

  it('gets the same library right in English, which is what makes this a translation defect', async () => {
    const root = await libraryNamed('Google Photos', (n) => `Photos from ${n}`);
    const album = join(root, 'Takeout', 'Google Photos', 'Reis');
    await mkdir(album, { recursive: true });
    await writeFile(join(album, 'IMG_0001.jpg'), PHOTO);

    const items = await itemsOf(root);
    const shared = items.find((i) => i.folders.length > 1);
    expect(shared).toBeDefined();
    expect(shared!.placeIn).toEqual(['Reis']);
    expect(shared!.metadata.years).toEqual(['Photos from 2019']);
  });
});
