// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAKEOUT SIDECAR NOBODY COULD FIND, A PHOTO COUNTED FOUR TIMES, AND THE
 * SAME ANSWER FROM THE FOLDER AND FROM THE ZIP.
 *
 * Workplan 0116 T3a, implementing 0112 T1; since 2026-09-20 also 0116 D7's
 * second slice. Three failure modes, all silent:
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
 * **The zip that answered differently.** The reader now reads the download
 * itself — one `.zip`, or every part of a multi-part download from any one of
 * them — through the tree seam in `archive-tree.ts`. A reader that collapsed,
 * hashed or found sidecars differently over a zip than over the folder the
 * same zip extracts to would import two different libraries from one export,
 * depending on whether the person pressed "extract". So ONE fixture is laid
 * out four ways below and every assertion runs against each; then the four
 * listings are compared to each other outright.
 *
 * `sidecarNamesFor` is exported and tested on its own rather than only through
 * the reader: the spellings ARE the finding, and a list of them is the kind of
 * thing that gets shortened by somebody tidying up.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { ArchiveUnreadable } from '@openmig/core/archive-reader';
import type { ArchiveHandle, ArchiveItem } from '@openmig/core/archive-reader';
import {
  createTakeoutArchiveReader,
  sidecarNamesFor,
  takeoutPartsBeside,
} from './takeout-archive-reader.ts';
import { buildZip, type ZipTestFile } from './zip-test-writer.ts';

const PHOTO = Buffer.from('one photo, filed in three albums and a year');
const PHOTO_SHA256 = createHash('sha256').update(PHOTO).digest('hex');
const OTHER = Buffer.from('a different photo entirely');

/**
 * A Takeout laid out the way Google lays one out — duplication included — as
 * a list of files, so it can be written as a folder or as zips.
 */
const FIXTURE: ReadonlyArray<{ readonly path: string; readonly data: Buffer }> = [
  // Every export carries this beside the data; it is not a photo and must
  // never be counted as one.
  { path: 'Takeout/archive_browser.html', data: Buffer.from('<html>not a photo</html>') },
  // The same image under two albums and its year: three files, one photo.
  { path: 'Takeout/Google Photos/Holiday in Kent/IMG_0001.jpg', data: PHOTO },
  { path: 'Takeout/Google Photos/Favourites/IMG_0001.jpg', data: PHOTO },
  { path: 'Takeout/Google Photos/Photos from 2019/IMG_0001.jpg', data: PHOTO },
  // AN ALBUM CARRIES ITS OWN `metadata.json` AND A YEAR FOLDER DOES NOT — which
  // is how the reader tells the two apart in any language (2026-09-21, measured
  // on two real exports). The fixture said otherwise until then, modelling a
  // Takeout that does not exist; these two lines are what a real one has.
  {
    path: 'Takeout/Google Photos/Holiday in Kent/metadata.json',
    data: Buffer.from(JSON.stringify({ title: 'Holiday in Kent', description: '', access: 'protected' })),
  },
  {
    path: 'Takeout/Google Photos/Favourites/metadata.json',
    data: Buffer.from(JSON.stringify({ title: 'Favourites', description: '' })),
  },
  // Only ONE of the three carries a sidecar, which is normal: the reader must
  // find it from whichever folder it happens to meet the photo in first.
  {
    path: 'Takeout/Google Photos/Photos from 2019/IMG_0001.jpg.supplemental-metadata.json',
    data: Buffer.from(
      JSON.stringify({
        title: 'IMG_0001.jpg',
        description: 'Whitstable, before the rain',
        photoTakenTime: { timestamp: '1561968000' },
        geoData: { latitude: 51.36, longitude: 1.02 },
        people: [{ name: 'Someone' }],
        favorited: true,
      }),
    ),
  },
  // A second photo, in a year folder only, whose sidecar uses the OLDER
  // spelling — the one a reader that knows only today's name would miss.
  { path: 'Takeout/Google Photos/Photos from 2021/IMG_0002.jpg', data: OTHER },
  {
    path: 'Takeout/Google Photos/Photos from 2021/IMG_0002.jpg.json',
    data: Buffer.from(JSON.stringify({ title: 'IMG_0002.jpg', photoTakenTime: { timestamp: '1609574400' } })),
  },
];

const STAMP = 'takeout-20240506T070810Z';

async function writeFolder(root: string): Promise<void> {
  for (const file of FIXTURE) {
    await mkdir(join(root, dirname(file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.data);
  }
}

const asMembers = (files: typeof FIXTURE, method: ZipTestFile['method']): ZipTestFile[] =>
  files.map((file) => ({ name: file.path, data: file.data, method }));

let work: string;
let folderRoot: string;
let singleZip: string;
let partOne: string;
let partTwo: string;

/** The one fixture, four ways. */
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'takeout-'));

  folderRoot = join(work, 'extracted');
  await writeFolder(folderRoot);

  // The download itself, every member deflated, in a folder of its own so
  // the part rule below cannot mistake it for a sibling.
  await mkdir(join(work, 'single'));
  singleZip = join(work, 'single', `${STAMP}-001.zip`);
  await writeFile(singleZip, buildZip(asMembers(FIXTURE, 'deflate')));

  // A two-part download, split BY FILE the way Google splits one: the album
  // copies in part 1, the year copies — and with them every sidecar — in
  // part 2. Pointed at part 1, a reader that ignored part 2 would find no
  // sidecar, no second photo, and one folder fewer; part 1 stores its
  // members and part 2 deflates them, so both methods are exercised.
  await mkdir(join(work, 'parts'));
  partOne = join(work, 'parts', `${STAMP}-001.zip`);
  partTwo = join(work, 'parts', `${STAMP}-002.zip`);
  const inYear = (file: (typeof FIXTURE)[number]): boolean => file.path.includes('/Photos from ');
  await writeFile(partOne, buildZip(asMembers(FIXTURE.filter((f) => !inYear(f)), 'store')));
  await writeFile(partTwo, buildZip(asMembers(FIXTURE.filter(inYear), 'deflate')));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

const reader = createTakeoutArchiveReader();

async function collect(handle: ArchiveHandle): Promise<ArchiveItem[]> {
  const out: ArchiveItem[] = [];
  for await (const item of reader.items(handle)) out.push(item);
  return out;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
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

const LAYOUTS = [
  { name: 'the folder the person extracted', path: () => folderRoot },
  { name: 'the .zip download itself', path: () => singleZip },
  { name: 'a two-part download, pointed at part 1', path: () => partOne },
  { name: 'a two-part download, pointed at part 2', path: () => partTwo },
] as const;

describe.each(LAYOUTS)('over $name', (layout) => {
  const at = () => ({ provider: 'google-takeout' as const, path: layout.path() });

  describe('one photo in three folders is one item', () => {
    it('collapses the duplication and keeps every folder', async () => {
      const handle = await reader.open(at());
      try {
        const items = await collect(handle);

        expect(
          items.length,
          'the reader yielded one record per file — Takeout files a photo under every album ' +
            'AND its year, so a migration would write it three times and every count downstream ' +
            'would agree with itself while being wrong',
        ).toBe(2);

        const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
        expect(photo?.folders).toEqual(
          expect.arrayContaining(['Holiday in Kent', 'Favourites', 'Photos from 2019']),
        );
        expect(photo?.folders.length).toBe(3);
      } finally {
        await handle.close();
      }
    });

    it('tells an album apart from a year folder', async () => {
      // Placement needs to know: an album is something the person made, a year
      // folder is Takeout's own filing. Writing years as albums would invent
      // organisation the person never chose.
      const handle = await reader.open(at());
      try {
        const items = await collect(handle);
        const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
        expect(photo?.metadata.albums).toEqual(expect.arrayContaining(['Holiday in Kent', 'Favourites']));
        expect(photo?.metadata.years).toEqual(['Photos from 2019']);
      } finally {
        await handle.close();
      }
    });
  });

  describe('what Google knew is carried, in whichever spelling it was written', () => {
    it('finds the current sidecar and keeps its fields verbatim', async () => {
      const handle = await reader.open(at());
      try {
        const items = await collect(handle);
        const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
        expect(photo?.metadata.sidecarFound).toBe(true);
        const sidecar = photo?.metadata.sidecar as Record<string, unknown>;
        // Verbatim (0116 T2, rule 3): the reader cannot know which field a later
        // task needs, and the archive's link expires.
        expect(sidecar.description).toBe('Whitstable, before the rain');
        expect(sidecar.geoData).toEqual({ latitude: 51.36, longitude: 1.02 });
        expect(sidecar.favorited).toBe(true);
      } finally {
        await handle.close();
      }
    });

    it('finds the OLDER `.json` spelling too', async () => {
      // The silent one. Without this the photo still arrives and its date does
      // not, and nothing anywhere reports a problem.
      const handle = await reader.open(at());
      try {
        const items = await collect(handle);
        const other = items.find((i) => i.contentHash !== PHOTO_SHA256);
        expect(other?.metadata.sidecarFound).toBe(true);
        expect(other?.createdAt).toBe('2021-01-02T08:00:00.000Z');
      } finally {
        await handle.close();
      }
    });

    it('turns the taken-time into an ISO date, from seconds', async () => {
      const handle = await reader.open(at());
      try {
        const items = await collect(handle);
        const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
        expect(photo?.createdAt).toBe('2019-07-01T08:00:00.000Z');
      } finally {
        await handle.close();
      }
    });
  });

  describe('the bytes come out exactly as they went in', () => {
    it('hashes the bytes the file domain would, and hands the same bytes back buffered and streamed', async () => {
      const handle = await reader.open(at());
      try {
        const items = await collect(handle);
        const photo = items.find((i) => i.contentHash === PHOTO_SHA256)!;
        expect(photo.sizeBytes).toBe(PHOTO.byteLength);
        expect(Buffer.from(await reader.content(handle, photo)).equals(PHOTO)).toBe(true);
        // Twice, because a retry after a half-written upload opens the stream
        // again and must get the whole item again — a consumed stream cannot.
        expect((await drain(await reader.contentStream!(handle, photo))).equals(PHOTO)).toBe(true);
        expect((await drain(await reader.contentStream!(handle, photo))).equals(PHOTO)).toBe(true);
        const other = items.find((i) => i.contentHash !== PHOTO_SHA256)!;
        expect((await drain(await reader.contentStream!(handle, other))).equals(OTHER)).toBe(true);
      } finally {
        await handle.close();
      }
    });
  });

  describe('the measure describes what will actually arrive', () => {
    it('counts the collapsed items, not the files', async () => {
      const handle = await reader.open(at());
      try {
        const summary = await reader.summary(handle);
        const items = await collect(handle);

        expect(summary.items).toBe(items.length);
        expect(summary.items).toBe(2);
        expect(summary.bytes).toBe(PHOTO.byteLength + OTHER.byteLength);
        expect(summary.folders).toBe(4);
      } finally {
        await handle.close();
      }
    });

    it('carries the span, because an archive is a snapshot with a date', async () => {
      const handle = await reader.open(at());
      try {
        const summary = await reader.summary(handle);
        expect(summary.earliest).toBe('2019-07-01T08:00:00.000Z');
        expect(summary.latest).toBe('2021-01-02T08:00:00.000Z');
      } finally {
        await handle.close();
      }
    });
  });
});

describe('the four layouts are one archive', () => {
  it('lists the same items, with the same hashes, folders, metadata and dates, whichever way it was laid out', async () => {
    const byLayout = new Map<string, ArchiveItem[]>();
    for (const layout of LAYOUTS) {
      const handle = await reader.open({ provider: 'google-takeout', path: layout.path() });
      try {
        const items = await collect(handle);
        // In hash order, because the order a folder and a zip list their
        // entries is each one's own business and no promise of the seam.
        byLayout.set(layout.name, [...items].sort((a, b) => a.contentHash.localeCompare(b.contentHash)));
      } finally {
        await handle.close();
      }
    }
    const fromFolder = byLayout.get(LAYOUTS[0].name)!;
    for (const [name, items] of byLayout) {
      expect(
        items.map((i) => ({ ...i, folders: [...i.folders].sort(), placeIn: [...i.placeIn].sort() })),
        `${name} answered differently from the extracted folder`,
      ).toEqual(fromFolder.map((i) => ({ ...i, folders: [...i.folders].sort(), placeIn: [...i.placeIn].sort() })));
    }
  });
});

describe('the parts of a multi-part download, from any one of them', () => {
  it('finds every numbered sibling, in order, from whichever part is named', async () => {
    expect(await takeoutPartsBeside(partOne)).toEqual([partOne, partTwo]);
    expect(await takeoutPartsBeside(partTwo)).toEqual([partOne, partTwo]);
  });

  it('opens a file somebody named with a number on their own as itself', async () => {
    // `photos-2024.zip` is not part 2024 of anything: no leading zero, no
    // part set, and a person who keeps last year's export beside this one
    // must not be told two thousand parts are missing.
    const dir = join(work, 'named');
    await mkdir(dir);
    const one = join(dir, 'photos-2024.zip');
    const two = join(dir, 'photos-2023.zip');
    await writeFile(one, buildZip(asMembers(FIXTURE, 'store')));
    await writeFile(two, buildZip(asMembers(FIXTURE, 'store')));
    expect(await takeoutPartsBeside(one)).toEqual([one]);
  });

  it('refuses a set with a part missing from the middle, naming the part', async () => {
    // A part that never finished downloading. Reading the rest would carry
    // most of a library and say nothing about the rest — the silent kind of
    // wrong 0116 §1 exists to prevent.
    const dir = join(work, 'gap');
    await mkdir(dir);
    const first = join(dir, `${STAMP}-001.zip`);
    await writeFile(first, buildZip(asMembers(FIXTURE, 'store')));
    await writeFile(join(dir, `${STAMP}-003.zip`), buildZip(asMembers(FIXTURE, 'store')));
    const err = await reader.open({ provider: 'google-takeout', path: first }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toContain('could not be opened');
    expect((err as ArchiveUnreadable).reason).toContain(`${STAMP}-002.zip`);
    expect((err as ArchiveUnreadable).reason).toContain('missing');
  });

  it('refuses part 2 on its own, because part 1 is not there', async () => {
    const dir = join(work, 'second-only');
    await mkdir(dir);
    const second = join(dir, `${STAMP}-002.zip`);
    await writeFile(second, buildZip(asMembers(FIXTURE, 'store')));
    await expect(takeoutPartsBeside(second)).rejects.toThrow(`${STAMP}-001.zip`);
  });
});

describe('a download that cannot be read says so, and never reads as empty', () => {
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

  it('refuses a zip with no Takeout in it, naming the file', async () => {
    // EXPECTATION CHANGED 2026-09-21, and the old one was the defect. This
    // asserted the reason contained the literal `Takeout/Google Photos` —
    // pinning the hard-coded English root that made every translated export
    // unreadable. The behaviour under test is unchanged and the assertion is
    // stronger: the sentence names what is missing and the file it looked in,
    // and must NOT invent a product folder that was never there.
    const zip = join(work, 'notes.zip');
    await writeFile(zip, buildZip([{ name: 'notes/todo.txt', data: 'not an export' }]));
    const err = await reader.open({ provider: 'google-takeout', path: zip }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toContain('Takeout');
    expect((err as ArchiveUnreadable).reason).toContain('notes.zip');
    expect((err as ArchiveUnreadable).reason).not.toContain('Google Photos');
  });

  it('refuses a download that stopped early as unreadable, with the zip reader’s reason', async () => {
    const whole = buildZip(asMembers(FIXTURE, 'deflate'));
    const cut = join(work, 'cut.zip');
    await writeFile(cut, whole.subarray(0, Math.floor(whole.byteLength * 0.6)));
    const err = await reader.open({ provider: 'google-takeout', path: cut }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toContain('could not be opened');
    expect((err as ArchiveUnreadable).reason).toMatch(/still\s+running|only some parts/);
  });

  it('refuses a member whose bytes are not the ones the archive recorded, naming it', async () => {
    // A corrupt download that still has its directory intact: the walk finds
    // it at the member, and the answer is a refusal — never a library with
    // one photo fewer, or one photo with the wrong bytes.
    const zip = buildZip(asMembers(FIXTURE, 'store'));
    const flipped = Buffer.from(zip);
    const at = flipped.indexOf(PHOTO);
    expect(at).toBeGreaterThan(0);
    flipped.writeUInt8(flipped.readUInt8(at + 3) ^ 0xff, at + 3);
    const path = join(work, 'flipped.zip');
    await writeFile(path, flipped);
    const handle = await reader.open({ provider: 'google-takeout', path });
    try {
      const err = await reader.summary(handle).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ArchiveUnreadable);
      expect((err as ArchiveUnreadable).reason).toContain('CRC-32');
      expect((err as ArchiveUnreadable).reason).toContain('IMG_0001.jpg');
    } finally {
      await handle.close();
    }
  });

  it('refuses a tar archive with a sentence naming what we read', async () => {
    const tgz = join(work, 'takeout.tgz');
    await writeFile(tgz, Buffer.from('not really a tarball'));
    const err = await reader.open({ provider: 'google-takeout', path: tgz }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toContain('.zip');
    expect((err as ArchiveUnreadable).reason).toContain(basename(tgz));
  });

  it('refuses a path nothing is at', async () => {
    const err = await reader
      .open({ provider: 'google-takeout', path: join(work, 'never-downloaded.zip') })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toContain('nothing is at');
  });

  it('refuses an Apple export handed to the Google reader', async () => {
    await expect(reader.open({ provider: 'apple-privacy', path: folderRoot })).rejects.toBeInstanceOf(
      ArchiveUnreadable,
    );
  });
});
