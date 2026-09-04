// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE READER THAT LETS ITS CALLER COUNT A PHOTO FOUR TIMES.
 *
 * Workplan 0116 T2. An interface with no implementation is a wish, so this file
 * builds the smallest real one — an in-memory archive — and holds it to the
 * three rules the seam exists to enforce. It is also the shape T3a's Takeout
 * reader has to satisfy: when that lands, this reference reader is what its
 * tests can be written against.
 *
 * ## Why these three and not more
 *
 * Each of them is a rule the CALLER cannot check and would not notice breaking:
 *
 * 1. **De-duplication.** Takeout files one photo under every album it is in and
 *    again under its year. A caller iterating naively writes it four times, and
 *    every count downstream — the measure, the manifest, the ledger — agrees
 *    with itself while being four times wrong. Nothing goes red.
 * 2. **The hash convention.** SHA-256 over the bytes, the same value the file
 *    domain computes. Get this wrong and an archive import silently duplicates
 *    every file a live Drive migration already carried, because the ledger
 *    cannot tell the same bytes apart when the hashes disagree.
 * 3. **Unopenable is `unknown`, never `no`.** A truncated download must not read
 *    as "you have no photos".
 *
 * A fourth rule — that `summary()` agrees with what `items()` yields — is
 * asserted too, because a summary derived separately from the iteration is how
 * the measure comes to promise a number the import then contradicts.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ArchiveUnreadable,
  ARCHIVE_ITEM_KINDS,
  ARCHIVE_PROVIDERS,
  type ArchiveItemKind,
  type ArchiveHandle,
  type ArchiveItem,
  type ArchiveLocation,
  type ArchiveReader,
  type ArchiveSummary,
} from './archive-reader.ts';

/** What a Takeout-shaped archive does: one photo, filed in three places. */
const PHOTO = new TextEncoder().encode('the same bytes, whichever folder found them');
const PHOTO_SHA256 = createHash('sha256').update(PHOTO).digest('hex');

interface FakeEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly folder: string;
  readonly createdAt?: string;
}

/**
 * The archive as the provider laid it out — WITH the duplication, because
 * removing it here would test nothing. The reader is what must collapse it.
 */
const LAID_OUT: ReadonlyArray<FakeEntry> = [
  { path: 'Photos/2019/IMG_1.jpg', bytes: PHOTO, folder: '2019', createdAt: '2019-06-01T10:00:00Z' },
  { path: 'Albums/Holiday/IMG_1.jpg', bytes: PHOTO, folder: 'Holiday', createdAt: '2019-06-01T10:00:00Z' },
  { path: 'Albums/Favourites/IMG_1.jpg', bytes: PHOTO, folder: 'Favourites', createdAt: '2019-06-01T10:00:00Z' },
  {
    path: 'Photos/2021/IMG_2.jpg',
    bytes: new TextEncoder().encode('a second, genuinely different photo'),
    folder: '2021',
    createdAt: '2021-01-02T09:00:00Z',
  },
];

/** A reference reader: in memory, no filesystem, obeying the three rules. */
function referenceReader(entries: ReadonlyArray<FakeEntry> = LAID_OUT): ArchiveReader {
  const collapse = (): ArchiveItem[] => {
    const byHash = new Map<string, { entry: FakeEntry; folders: string[] }>();
    for (const entry of entries) {
      const hash = createHash('sha256').update(entry.bytes).digest('hex');
      const seen = byHash.get(hash);
      if (seen) {
        seen.folders.push(entry.folder);
        continue;
      }
      byHash.set(hash, { entry, folders: [entry.folder] });
    }
    return [...byHash].map(([contentHash, { entry, folders }]) => ({
      contentHash,
      path: entry.path,
      sizeBytes: entry.bytes.byteLength,
      folders,
      ...(entry.createdAt ? { createdAt: entry.createdAt } : {}),
      // Every entry in this fixture is an original. The reference reader does
      // not classify — recognising `-edited` is Takeout's own convention and
      // belongs to Takeout's reader (0116 T7), not to the seam. What the seam
      // says is that the field EXISTS and that a summary breaks down by it.
      kind: 'original' as const,
      metadata: { laidOutAs: entry.path },
    }));
  };

  return {
    provider: 'google-takeout',
    async open(location: ArchiveLocation): Promise<ArchiveHandle> {
      if (location.path === '') {
        throw new ArchiveUnreadable('This archive could not be opened — the download looks incomplete.');
      }
      return { provider: 'google-takeout', close: async () => {} };
    },
    async *items(): AsyncIterable<ArchiveItem> {
      yield* collapse();
    },
    async summary(): Promise<ArchiveSummary> {
      const items = collapse();
      const dates = items.map((i) => i.createdAt).filter((d): d is string => Boolean(d)).sort();
      const byKind = Object.fromEntries(ARCHIVE_ITEM_KINDS.map((k) => [k, 0])) as Record<
        ArchiveItemKind,
        number
      >;
      for (const item of items) byKind[item.kind] += 1;
      return {
        items: items.length,
        bytes: items.reduce((n, i) => n + i.sizeBytes, 0),
        folders: new Set(items.flatMap((i) => i.folders)).size,
        byKind,
        ...(dates[0] ? { earliest: dates[0] } : {}),
        ...(dates.at(-1) ? { latest: dates.at(-1)! } : {}),
      };
    },
  };
}

const AT: ArchiveLocation = { provider: 'google-takeout', path: '/tmp/takeout.zip' };

async function collect(reader: ArchiveReader, handle: ArchiveHandle): Promise<ArchiveItem[]> {
  const out: ArchiveItem[] = [];
  for await (const item of reader.items(handle)) out.push(item);
  return out;
}

describe('the reader collapses what the provider duplicated', () => {
  it('yields one record per DISTINCT item, not one per folder it was filed in', async () => {
    const reader = referenceReader();
    const handle = await reader.open(AT);
    const items = await collect(reader, handle);

    // Four entries in the archive, two actual photos. A caller that got four
    // here would write the same image three times and count it as three.
    expect(LAID_OUT.length).toBe(4);
    expect(
      items.length,
      'the reader yielded one record per archive entry rather than per distinct item — ' +
        'Takeout files a photo under every album AND its year, so this duplicates silently',
    ).toBe(2);
    expect(new Set(items.map((i) => i.contentHash)).size).toBe(2);
  });

  it('keeps EVERY folder the item was filed under, not the first', async () => {
    // The folders are what the person organised. Collapsing to one loses the
    // albums, which is the whole thing placement has to work from.
    const reader = referenceReader();
    const items = await collect(reader, await reader.open(AT));
    const photo = items.find((i) => i.contentHash === PHOTO_SHA256);
    expect(photo?.folders).toEqual(expect.arrayContaining(['2019', 'Holiday', 'Favourites']));
    expect(photo?.folders.length).toBe(3);
  });
});

describe('the hash is the one the file domain would compute', () => {
  it('is SHA-256 over the bytes, hex', async () => {
    // The rule that costs the most when broken: a live Drive migration and an
    // archive import of the same file must agree it is one file, or the second
    // route writes a duplicate of everything the first already carried.
    const reader = referenceReader();
    const items = await collect(reader, await reader.open(AT));
    expect(items.map((i) => i.contentHash)).toContain(PHOTO_SHA256);
    expect(PHOTO_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('an archive that will not open is unknown, never a no', () => {
  it('throws ArchiveUnreadable with a sentence to show', async () => {
    const reader = referenceReader();
    await expect(reader.open({ ...AT, path: '' })).rejects.toBeInstanceOf(ArchiveUnreadable);
    await reader.open({ ...AT, path: '' }).catch((e: unknown) => {
      expect(e).toBeInstanceOf(ArchiveUnreadable);
      // A distinguishable type is the point: a caller must be able to tell
      // "could not open" from a bug, because the two render differently and
      // only one of them may ever reach a person as a count of zero.
      expect((e as ArchiveUnreadable).reason).toContain('could not be opened');
      expect((e as ArchiveUnreadable).name).toBe('ArchiveUnreadable');
    });
  });
});

describe('the summary describes the items that will actually arrive', () => {
  it('agrees with the iteration on count, bytes and folders', async () => {
    // Derived separately, these drift — and the measure then promises a number
    // the import contradicts, which is worse than not measuring at all.
    const reader = referenceReader();
    const handle = await reader.open(AT);
    const items = await collect(reader, handle);
    const summary = await reader.summary(handle);

    expect(summary.items).toBe(items.length);
    expect(summary.bytes).toBe(items.reduce((n, i) => n + i.sizeBytes, 0));
    expect(summary.folders).toBe(new Set(items.flatMap((i) => i.folders)).size);
  });

  it('carries the span, because an archive is a snapshot with a date', async () => {
    const reader = referenceReader();
    const summary = await reader.summary(await reader.open(AT));
    expect(summary.earliest).toBe('2019-06-01T10:00:00Z');
    expect(summary.latest).toBe('2021-01-02T09:00:00Z');
  });

  it('leaves the span absent when the archive carries no dates, rather than zero', async () => {
    // An absent span is a legitimate answer. A zero would be a claim.
    const undated = referenceReader([{ path: 'a.jpg', bytes: PHOTO, folder: 'x' }]);
    const summary = await undated.summary(await undated.open(AT));
    expect(summary.earliest).toBeUndefined();
    expect(summary.latest).toBeUndefined();
    expect(summary.items).toBe(1);
  });
});

describe('the provider is a closed set, because it selects the reader', () => {
  it('names both exports this product plans to read', () => {
    // `provider` is not decoration: it decides which reader opens the archive
    // and which sentences the surfaces show. It is what stops an Apple card
    // promising Google's two-monthly schedule.
    expect([...ARCHIVE_PROVIDERS]).toEqual(['google-takeout', 'apple-privacy']);
  });
});
