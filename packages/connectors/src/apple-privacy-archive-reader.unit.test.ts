// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * APPLE'S EXPORT, READ ON THE ONE SHAPE ANYONE HAS SEEN (workplan 0171 T1).
 *
 * Every zip here is built in the test after workplan 0116's description of
 * the one export opened: two wrapper folders, `Drive Details.csv` inside the
 * data with no path column, the person's own tree below. No real export is
 * quoted. The photos zips follow Apple's description only, which is why the
 * column names come from the reader's one table rather than being spelled
 * here.
 *
 * What is held:
 *  - the data root is found by its manifest, both wrapper names ignored;
 *  - the manifest is excluded at its one path, and a same-named file of the
 *    person's deeper down is copied;
 *  - an iWork package folder arrives files and all;
 *  - the CSV is joined one to one, verbatim, and its dates never parsed (D6);
 *  - dates come from the zip: the UTC field when present, the DOS stamp else;
 *  - two parts read as one export, a duplicate across them is one item;
 *  - fewer parts than the person counted is refused, naming both numbers;
 *  - a photos part with its CSV: albums become folders, the rest is said;
 *  - a zip with neither manifest is `ArchiveUnreadable`, never an empty import;
 *  - two parts carrying different manifests are two exports, refused.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ArchiveUnreadable,
  type ArchiveHandle,
  type ArchiveItem,
  type ArchiveLocation,
} from '@openmig/core/archive-reader';
import {
  APPLE_DRIVE_COLUMNS,
  APPLE_PHOTOS_COLUMNS,
  createApplePrivacyArchiveReader,
  parseAppleCsv,
} from './apple-privacy-archive-reader.ts';
import { buildZip, type ZipTestFile } from './zip-test-writer.ts';

const sha = (data: string): string => createHash('sha256').update(data).digest('hex');

const DRIVE = 'iCloud Drive/Drive';
const HEADER = APPLE_DRIVE_COLUMNS.join(',');

/** A row of `Drive Details.csv`: dates in the export's own `MM-DD-YYYY HH:MM:SS`, no zone. */
const row = (title: string, size: number, favourite = 'no'): string =>
  `${title},abc123,file,${size},03-14-2025 09:30:00,03-15-2025 10:00:00,03-16-2025 11:00:00,${favourite},no,`;

const NOTES = 'my notes, written by hand';
const REPORT = 'a report the person keeps';
const THEIR_CSV = 'a,b\n1,2\n';
const PAGES_INDEX = 'iwork index bytes';
const PAGES_PREVIEW = 'iwork preview bytes';
/** 2025-01-02T03:04:05Z, written in the extended-timestamp field. */
const UTC_SECONDS = Date.UTC(2025, 0, 2, 3, 4, 5) / 1000;

function driveFiles(): ZipTestFile[] {
  return [
    {
      name: `${DRIVE}/Drive Details.csv`,
      data: [
        HEADER,
        row('notes.txt', NOTES.length, 'yes'),
        row('report.txt', REPORT.length),
        // Two rows that could both be one file: neither is joined.
        row('Drive Details.csv', THEIR_CSV.length),
        row('Drive Details.csv', THEIR_CSV.length),
        // A row no file matches (size differs): ignored.
        row('missing.txt', 999),
      ].join('\r\n'),
    },
    { name: `${DRIVE}/testmap/notes.txt`, data: NOTES, modifiedUtcSeconds: UTC_SECONDS },
    { name: `${DRIVE}/testmap/sub/report.txt`, data: REPORT, method: 'deflate' },
    // The person's own file with the manifest's name, deeper down: copied.
    { name: `${DRIVE}/testmap/Drive Details.csv`, data: THEIR_CSV },
    // An iWork package, arriving as a folder.
    { name: `${DRIVE}/testmap/Plan.pages/Index.zip`, data: PAGES_INDEX },
    { name: `${DRIVE}/testmap/Plan.pages/preview.jpg`, data: PAGES_PREVIEW },
  ];
}

const PHOTO_A = 'photo a bytes';
const PHOTO_B = 'photo b bytes';
const CLIP = 'a short video';
const PHOTOS = 'iCloud Photos/Photos';
const FILE_COL = APPLE_PHOTOS_COLUMNS.file[0];
const SUM_COL = APPLE_PHOTOS_COLUMNS.checksum[0];

function photoFiles(): ZipTestFile[] {
  return [
    {
      name: `${PHOTOS}/Photo Details.csv`,
      data: `${FILE_COL},${SUM_COL},favorite,originalCreationDate\nIMG_0001.JPG,c1,yes,"Monday March 3,2025 9:15 AM GMT"\nIMG_0002.HEIC,c2,no,x\n`,
    },
    { name: `${PHOTOS}/IMG_0001.JPG`, data: PHOTO_A },
    { name: `${PHOTOS}/IMG_0002.HEIC`, data: PHOTO_B },
    { name: `${PHOTOS}/IMG_0003.MOV`, data: CLIP },
    { name: `${PHOTOS}/Albums/Holiday.csv`, data: `${FILE_COL}\nIMG_0001.JPG\n` },
    // Beside the photos and not a photo: counted, not copied.
    { name: `${PHOTOS}/readme.txt`, data: 'not a photo' },
  ];
}

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'apple-export-'));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function writeZip(name: string, files: ZipTestFile[]): Promise<string> {
  const path = join(work, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buildZip(files));
  return path;
}

const reader = createApplePrivacyArchiveReader();

async function openAll(
  location: Omit<ArchiveLocation, 'provider'>,
): Promise<{ handle: ArchiveHandle; items: ArchiveItem[] }> {
  const handle = await reader.open({ provider: 'apple-privacy', ...location });
  const items: ArchiveItem[] = [];
  for await (const item of reader.items(handle)) items.push(item);
  return { handle, items };
}

const byName = (items: ArchiveItem[], name: string, hash?: string): ArchiveItem => {
  const found = items.filter((i) => i.path === name && (hash === undefined || i.contentHash === hash));
  expect(found, name).toHaveLength(1);
  return found[0]!;
};

async function refusal(location: Omit<ArchiveLocation, 'provider'>): Promise<ArchiveUnreadable> {
  const err = await reader.open({ provider: 'apple-privacy', ...location }).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ArchiveUnreadable);
  return err as ArchiveUnreadable;
}

describe('iCloud Drive, after 0116’s layout', () => {
  it('finds the data root by its manifest and keeps the person’s tree as it is', async () => {
    const zip = await writeZip('iCloud Drive.zip', driveFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      expect(items.map((i) => `${i.placeIn.join('|')}/${i.path}`).sort()).toEqual([
        'testmap/Drive Details.csv',
        'testmap/Plan.pages/Index.zip',
        'testmap/Plan.pages/preview.jpg',
        'testmap/notes.txt',
        'testmap/sub/report.txt',
      ]);
      // Neither wrapper became a folder.
      expect(items.flatMap((i) => i.folders).some((f) => f.startsWith('iCloud'))).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('excludes the manifest at its one path and copies the person’s own file of that name', async () => {
    const zip = await writeZip('iCloud Drive.zip', driveFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      const theirs = byName(items, 'Drive Details.csv');
      expect(theirs.placeIn).toEqual(['testmap']);
      expect(theirs.contentHash).toBe(sha(THEIR_CSV));
      expect(items.filter((i) => i.path === 'Drive Details.csv')).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it('carries an iWork package as the folder it arrived as, files and all', async () => {
    const zip = await writeZip('iCloud Drive.zip', driveFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      expect(byName(items, 'Index.zip').placeIn).toEqual(['testmap/Plan.pages']);
      expect(byName(items, 'preview.jpg').placeIn).toEqual(['testmap/Plan.pages']);
    } finally {
      await handle.close();
    }
  });

  it('joins a row one to one by Title and Size, verbatim, dates as text (D6)', async () => {
    const zip = await writeZip('iCloud Drive.zip', driveFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      expect(byName(items, 'notes.txt').metadata['driveDetails']).toEqual({
        Favourite: 'yes',
        'Created On': '03-14-2025 09:30:00',
        'Modified On': '03-15-2025 10:00:00',
        'Last Opened On': '03-16-2025 11:00:00',
      });
      expect(byName(items, 'report.txt').metadata['driveDetails']).toMatchObject({ Favourite: 'no' });
      // Two rows for one file say nothing about which is its: not joined.
      expect(byName(items, 'Drive Details.csv').metadata['driveDetails']).toBeUndefined();
      expect(byName(items, 'Index.zip').metadata['driveDetails']).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('dates a file from the zip: the UTC field when present, the DOS stamp otherwise', async () => {
    const zip = await writeZip('iCloud Drive.zip', driveFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      expect(byName(items, 'notes.txt').createdAt).toBe('2025-01-02T03:04:05.000Z');
      // The test writer's DOS stamp, 2024-05-06 07:08:10, read as if UTC.
      expect(byName(items, 'report.txt').createdAt).toBe('2024-05-06T07:08:10.000Z');
      // The CSV said 2025-03-14 for notes.txt; it is never the date.
      expect(items.some((i) => i.createdAt?.startsWith('2025-03'))).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('hands back the bytes it hashed, buffered and streamed', async () => {
    const zip = await writeZip('iCloud Drive.zip', driveFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      const report = byName(items, 'report.txt');
      expect(Buffer.from(await reader.content(handle, report)).toString()).toBe(REPORT);
      const chunks: Uint8Array[] = [];
      for await (const c of (await reader.contentStream!(handle, report)) as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(c);
      }
      expect(Buffer.concat(chunks).toString()).toBe(REPORT);
    } finally {
      await handle.close();
    }
  });

  it('reads an extracted export the same way, dated by the files themselves', async () => {
    const folder = join(work, 'extracted');
    for (const f of driveFiles()) {
      await mkdir(dirname(join(folder, f.name)), { recursive: true });
      await writeFile(join(folder, f.name), f.data);
    }
    const fromZip = await openAll({ path: await writeZip('iCloud Drive.zip', driveFiles()) });
    const fromFolder = await openAll({ path: folder });
    try {
      const shape = (items: ArchiveItem[]) =>
        items.map((i) => [i.path, i.placeIn, i.contentHash, i.metadata['driveDetails']]).sort();
      expect(shape(fromFolder.items)).toEqual(shape(fromZip.items));
      expect(fromFolder.items.every((i) => typeof i.createdAt === 'string')).toBe(true);
    } finally {
      await fromZip.handle.close();
      await fromFolder.handle.close();
    }
  });
});

describe('several parts (§2.3)', () => {
  const PART_TWO: ZipTestFile[] = [
    { name: `${DRIVE}/later/more.txt`, data: 'in the second part' },
    // The same name and bytes as part one's notes, in another folder: one item, placed twice.
    { name: `${DRIVE}/elsewhere/notes.txt`, data: NOTES },
    // The same path as in part one: answered by the first part it was met in.
    { name: `${DRIVE}/testmap/sub/report.txt`, data: REPORT },
  ];

  it('reads every .zip in the folder as one export, a duplicate across parts as one item', async () => {
    await writeZip('export/part-1.zip', driveFiles());
    await writeZip('export/part-2.zip', PART_TWO);
    const { handle, items } = await openAll({ path: join(work, 'export'), parts: 2 });
    try {
      expect(byName(items, 'more.txt').placeIn).toEqual(['later']);
      const notes = byName(items, 'notes.txt');
      expect(notes.placeIn).toEqual(['elsewhere', 'testmap']);
      expect(byName(items, 'report.txt').placeIn).toEqual(['testmap/sub']);
    } finally {
      await handle.close();
    }
  });

  it('refuses fewer parts than the person said Apple gave them, naming both numbers', async () => {
    await writeZip('export/part-1.zip', driveFiles());
    await writeZip('export/part-2.zip', PART_TWO);
    const err = await refusal({ path: join(work, 'export'), parts: 3 });
    expect(err.reason).toContain('found 2 of the 3 parts');
  });

  it('counts one named .zip as one part', async () => {
    const zip = await writeZip('export/part-1.zip', driveFiles());
    await writeZip('export/part-2.zip', PART_TWO);
    expect((await refusal({ path: zip, parts: 2 })).reason).toContain('found 1 of the 2 parts');
  });

  it('refuses two parts whose manifests disagree: two different exports', async () => {
    await writeZip('export/a.zip', driveFiles());
    await writeZip('export/b.zip', [
      { name: `${DRIVE}/Drive Details.csv`, data: `${HEADER}\r\n${row('other.txt', 3)}` },
      { name: `${DRIVE}/x/other.txt`, data: 'abc' },
    ]);
    expect((await refusal({ path: join(work, 'export') })).reason).toContain('two different exports');
  });
});

describe('iCloud Photos, written against Apple’s description', () => {
  it('reads the media beside the manifest; albums become folders; the rest is said', async () => {
    const zip = await writeZip('iCloud Photos.zip', photoFiles());
    const { handle, items } = await openAll({ path: zip });
    try {
      expect(byName(items, 'IMG_0001.JPG').placeIn).toEqual(['Holiday']);
      // In no album: under the export's own wrapper, never loose among Drive files.
      expect(byName(items, 'IMG_0002.HEIC').placeIn).toEqual(['iCloud Photos']);
      expect(byName(items, 'IMG_0003.MOV').placeIn).toEqual(['iCloud Photos']);
      expect(items.map((i) => i.path)).not.toContain('readme.txt');
      expect(items.map((i) => i.path)).not.toContain('Holiday.csv');
      expect(byName(items, 'IMG_0001.JPG').metadata['photoDetails']).toMatchObject({
        favorite: 'yes',
        originalCreationDate: 'Monday March 3,2025 9:15 AM GMT',
      });
      const summary = await reader.summary(handle);
      expect(summary.items).toBe(3);
      expect(summary.albums?.map((a) => a.title)).toEqual(['Holiday']);
      expect(summary.skipped?.items).toBe(1);
      expect(summary.byKind).toEqual({ original: 3, edited: 0, motion: 0 });
    } finally {
      await handle.close();
    }
  });

  it('reads a Drive part and a photos part together', async () => {
    await writeZip('export/1.zip', driveFiles());
    await writeZip('export/2.zip', photoFiles());
    const { handle, items } = await openAll({ path: join(work, 'export'), parts: 2 });
    try {
      expect(items).toHaveLength(8);
      expect(byName(items, 'notes.txt').metadata['services']).toEqual(['icloud-drive']);
      expect(byName(items, 'IMG_0001.JPG').metadata['services']).toEqual(['icloud-photos']);
    } finally {
      await handle.close();
    }
  });
});

describe('what it does not know, it refuses', () => {
  it('a zip with neither manifest is ArchiveUnreadable, never an empty import', async () => {
    const zip = await writeZip('something.zip', [
      { name: 'iCloud Mail/Mail/inbox.mbox', data: 'mail' },
      // A CSV with a header the reader does not know is not a manifest.
      { name: 'iCloud Drive/Drive/Drive Details.csv', data: 'Name,Size\nx,1\n' },
    ]);
    const err = await refusal({ path: zip });
    expect(err.reason).toContain('This does not look like an Apple export we know');
  });

  it('says what lay outside the known data roots instead of reading it', async () => {
    const zip = await writeZip('mixed.zip', [
      ...driveFiles(),
      { name: 'iCloud Mail/Mail/inbox.mbox', data: 'mail' },
      { name: 'iCloud Mail/Mail/sent.mbox', data: 'more mail' },
    ]);
    const { handle, items } = await openAll({ path: zip });
    try {
      expect(items.map((i) => i.path)).not.toContain('inbox.mbox');
      expect((await reader.summary(handle)).skipped).toEqual({ folders: ['iCloud Mail'], items: 2 });
    } finally {
      await handle.close();
    }
  });

  it('nothing at the path, a file that is not a zip, and another company’s export', async () => {
    expect((await refusal({ path: join(work, 'nothing-here') })).reason).toContain('nothing is at');
    await writeFile(join(work, 'export.tar.gz'), 'x');
    expect((await refusal({ path: join(work, 'export.tar.gz') })).reason).toContain('not a folder or a .zip');
    await expect(reader.open({ provider: 'google-takeout', path: work })).rejects.toBeInstanceOf(ArchiveUnreadable);
  });

  it('a truncated zip is ArchiveUnreadable with the zip reader’s sentence', async () => {
    const whole = buildZip(driveFiles());
    await writeFile(join(work, 'cut.zip'), whole.subarray(0, whole.byteLength - 10));
    expect((await refusal({ path: join(work, 'cut.zip') })).reason).toContain('could not be opened');
  });
});

describe('the CSV parser', () => {
  it('reads quotes, doubled quotes, CR LF and a BOM', () => {
    expect(parseAppleCsv('﻿a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });
});
