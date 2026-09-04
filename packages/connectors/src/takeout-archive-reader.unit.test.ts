// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAKEOUT SIDECAR NOBODY COULD FIND, AND A PHOTO COUNTED FOUR TIMES.
 *
 * Workplan 0116 T3a, implementing 0112 T1. Two failure modes, both silent:
 *
 * **The photo counted four times.** Takeout files one image under every album it
 * belongs to *and* under its year, byte-identical each time. A reader that
 * yielded one record per file on disk would have the migration write it four
 * times, and the measure, the manifest and the ledger would all agree with each
 * other while being four times wrong. Nothing goes red — which is exactly why
 * de-duplication is the reader's job (0116 T2, rule 1) and why it is the first
 * thing tested here.
 *
 * **The sidecar nobody could find.** Google's metadata — a taken-time set by
 * hand, a location added in Photos, the people tagged — lives only in a JSON
 * file beside the media, and Takeout has spelled that file at least four
 * different ways, including truncating it at 51 characters and putting the `(1)`
 * duplicate marker on the SIDECAR rather than on the photo. A reader that tries
 * only the current spelling loses every one of those fields on an older export
 * **and still succeeds**, because the bytes arrive regardless. The person gets
 * their photos with the dates and descriptions quietly missing.
 *
 * That second one is why `sidecarNamesFor` is exported and tested on its own
 * rather than only through the reader: the spellings ARE the finding, and a list
 * of them is the kind of thing that gets shortened by somebody tidying up.
 *
 * ## What is deliberately NOT asserted here
 *
 * That `-edited` versions and motion-photo clips are handled correctly, because
 * **this reader does not yet decide what they are** and pretending otherwise
 * would be worse than the gap. 0112 describes them as attributes of one record;
 * treating them as distinct items is also defensible since their bytes differ.
 * The question is open, it is recorded in 0112/0116 rather than settled by an
 * implementation detail, and until it is answered they fall through as ordinary
 * distinct items — visible in these fixtures, not hidden.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ArchiveUnreadable } from '@openmig/core/archive-reader';
import type { ArchiveHandle, ArchiveItem } from '@openmig/core/archive-reader';
import { createTakeoutArchiveReader, sidecarNamesFor } from './takeout-archive-reader.ts';

const PHOTO = Buffer.from('one photo, filed in three albums and a year');
const PHOTO_SHA256 = createHash('sha256').update(PHOTO).digest('hex');
const OTHER = Buffer.from('a different photo entirely');

let root: string;

/** A Takeout laid out the way Google lays one out — duplication included. */
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'takeout-'));
  const photos = join(root, 'Takeout', 'Google Photos');

  // The same image under two albums and its year: three files, one photo.
  for (const folder of ['Holiday in Kent', 'Favourites', 'Photos from 2019']) {
    await mkdir(join(photos, folder), { recursive: true });
    await writeFile(join(photos, folder, 'IMG_0001.jpg'), PHOTO);
  }
  // Only ONE of the three carries a sidecar, which is normal: the reader must
  // find it from whichever folder it happens to meet the photo in first.
  await writeFile(
    join(photos, 'Photos from 2019', 'IMG_0001.jpg.supplemental-metadata.json'),
    JSON.stringify({
      title: 'IMG_0001.jpg',
      description: 'Whitstable, before the rain',
      photoTakenTime: { timestamp: '1561968000' },
      geoData: { latitude: 51.36, longitude: 1.02 },
      people: [{ name: 'Someone' }],
      favorited: true,
    }),
  );

  // A second photo, in a year folder only, whose sidecar uses the OLDER
  // spelling — the one a reader that knows only today's name would miss.
  await mkdir(join(photos, 'Photos from 2021'), { recursive: true });
  await writeFile(join(photos, 'Photos from 2021', 'IMG_0002.jpg'), OTHER);
  await writeFile(
    join(photos, 'Photos from 2021', 'IMG_0002.jpg.json'),
    JSON.stringify({ title: 'IMG_0002.jpg', photoTakenTime: { timestamp: '1609574400' } }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const reader = createTakeoutArchiveReader();
const at = () => ({ provider: 'google-takeout' as const, path: root });

async function collect(handle: ArchiveHandle): Promise<ArchiveItem[]> {
  const out: ArchiveItem[] = [];
  for await (const item of reader.items(handle)) out.push(item);
  return out;
}

describe('the sidecar spellings Takeout has actually used', () => {
  it('tries the current name, the older one, and both duplicate forms', () => {
    const names = sidecarNamesFor('IMG_0001.jpg');
    expect(names).toContain('IMG_0001.jpg.supplemental-metadata.json');
    expect(names).toContain('IMG_0001.jpg.json');
    // The `(1)` marker lands on the SIDECAR, after the media extension — the
    // quirk most likely to be "tidied up" by somebody who has not met it.
    expect(names).toContain('IMG_0001.jpg(1).json');
  });

  it('offers a 51-character truncation for names Takeout would cut', () => {
    // Takeout caps sidecar filenames, so a long photo name gets a sidecar that
    // does not end in `.json` at all. A reader without this loses every field
    // on exactly the files whose names people chose themselves.
    const long = 'a-photograph-with-a-very-long-descriptive-file-name-indeed.jpg';
    const names = sidecarNamesFor(long);
    const truncated = names.filter((n) => n.length === 51);
    expect(truncated.length, `no 51-character candidate among: ${names.join(', ')}`).toBeGreaterThan(0);
    // Truncated forms are offered IN ADDITION to the full ones, never instead.
    expect(names).toContain(`${long}.supplemental-metadata.json`);
  });

  it('never returns the same spelling twice', () => {
    const names = sidecarNamesFor('short.jpg');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('one photo in three folders is one item', () => {
  it('collapses the duplication and keeps every folder', async () => {
    const items = await collect(await reader.open(at()));

    expect(
      items.length,
      'the reader yielded one record per file on disk — Takeout files a photo under every ' +
        'album AND its year, so a migration would write it three times and every count ' +
        'downstream would agree with itself while being wrong',
    ).toBe(2);

    const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
    expect(photo?.folders).toEqual(
      expect.arrayContaining(['Holiday in Kent', 'Favourites', 'Photos from 2019']),
    );
    expect(photo?.folders.length).toBe(3);
  });

  it('tells an album apart from a year folder', async () => {
    // Placement needs to know: an album is something the person made, a year
    // folder is Takeout's own filing. Writing years as albums would invent
    // organisation the person never chose.
    const items = await collect(await reader.open(at()));
    const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
    expect(photo?.metadata.albums).toEqual(
      expect.arrayContaining(['Holiday in Kent', 'Favourites']),
    );
    expect(photo?.metadata.years).toEqual(['Photos from 2019']);
  });
});

describe('what Google knew is carried, in whichever spelling it was written', () => {
  it('finds the current sidecar and keeps its fields verbatim', async () => {
    const items = await collect(await reader.open(at()));
    const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
    expect(photo?.metadata.sidecarFound).toBe(true);
    const sidecar = photo?.metadata.sidecar as Record<string, unknown>;
    // Verbatim (0116 T2, rule 3): the reader cannot know which field a later
    // task needs, and the archive's link expires.
    expect(sidecar.description).toBe('Whitstable, before the rain');
    expect(sidecar.geoData).toEqual({ latitude: 51.36, longitude: 1.02 });
    expect(sidecar.favorited).toBe(true);
  });

  it('finds the OLDER `.json` spelling too', async () => {
    // The silent one. Without this the photo still arrives and its date does
    // not, and nothing anywhere reports a problem.
    const items = await collect(await reader.open(at()));
    const other = items.find((i) => i.contentHash !== PHOTO_SHA256);
    expect(other?.metadata.sidecarFound).toBe(true);
    expect(other?.createdAt).toBe('2021-01-02T08:00:00.000Z');
  });

  it('turns the taken-time into an ISO date, from seconds', async () => {
    const items = await collect(await reader.open(at()));
    const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
    expect(photo?.createdAt).toBe('2019-07-01T08:00:00.000Z');
  });
});

describe('an archive that is not one says so, and never reads as empty', () => {
  it('refuses a folder with no Takeout in it, with a sentence naming the folder', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'not-a-takeout-'));
    try {
      await expect(reader.open({ provider: 'google-takeout', path: empty })).rejects.toBeInstanceOf(
        ArchiveUnreadable,
      );
      const err = await reader.open({ provider: 'google-takeout', path: empty }).catch((e) => e);
      // The sentence has to survive to a person, and say the useful thing: a
      // part-finished download looks exactly like this, and "0 photos" would
      // be the worst possible way to report it.
      expect((err as ArchiveUnreadable).reason).toContain('could not be opened');
      expect((err as ArchiveUnreadable).reason).toMatch(/still\s+running|only some parts/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('refuses an Apple export handed to the Google reader', async () => {
    await expect(
      reader.open({ provider: 'apple-privacy', path: root }),
    ).rejects.toBeInstanceOf(ArchiveUnreadable);
  });
});

describe('the measure describes what will actually arrive', () => {
  it('counts the collapsed items, not the files on disk', async () => {
    const handle = await reader.open(at());
    const summary = await reader.summary(handle);
    const items = await collect(handle);

    expect(summary.items).toBe(items.length);
    expect(summary.items).toBe(2);
    expect(summary.bytes).toBe(PHOTO.byteLength + OTHER.byteLength);
    expect(summary.folders).toBe(4);
  });

  it('carries the span, because an archive is a snapshot with a date', async () => {
    const summary = await reader.summary(await reader.open(at()));
    expect(summary.earliest).toBe('2019-07-01T08:00:00.000Z');
    expect(summary.latest).toBe('2021-01-02T08:00:00.000Z');
  });
});
