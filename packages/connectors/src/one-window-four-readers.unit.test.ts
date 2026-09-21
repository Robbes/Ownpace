// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE WINDOW, FOUR READERS.
 *
 * The file loop downloads inside a bounded concurrency, and that bound is
 * four: `runFileSync` hands `fetchRaw` to `runDomainSync`, which runs it at
 * `DEFAULT_CONCURRENCY`, and `ArchiveFileSource.fetch` does its reading THERE
 * rather than during the listing — deliberately, because a listing that
 * downloaded would buffer a whole folder.
 *
 * So four members of the same Takeout part are read AT THE SAME TIME, through
 * the one `RandomAccessSource` that part was opened with. On the appliance
 * that is safe by construction: `openFileSource` opens a descriptor per read
 * and reads positionally, holding nothing between calls. The relay's source
 * holds a READ-AHEAD WINDOW, in one field, and `read` looked at that field
 * again AFTER awaiting a fetch — so the last fetch to land decided which
 * window every in-flight read then sliced itself out of.
 *
 * What that produces is not an error. It is a read that returns fewer bytes
 * than it asked for, because `Uint8Array.slice` clamps an offset that lies
 * outside the array instead of refusing it. The zip reader then says what a
 * short read looks like from where it stands:
 *
 *     Member Holiday/IMG_0001.jpg failed its CRC-32 check: the bytes are not
 *     the ones the archive recorded.
 *
 * — which is a sound export being called corrupt, on the managed edition
 * only, with nothing wrong on the appliance running the same import. Both
 * halves of that are the thing 0116 is written against.
 *
 * The fix is that a window is a VALUE a read holds, never a field it re-reads
 * across an await; and that reads wanting the same window share one request
 * instead of racing to make four. Every test below fails without it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRangeSource, rangeBudget } from './webdav-archive-store.ts';
import { openFileSource } from './zip-archive.ts';

const PART_BYTES = 64 * 1024;
const WINDOW = 8 * 1024;
/** `DEFAULT_CONCURRENCY` in `packages/core/src/domain-sync.ts` — the number of readers this is about. */
const LOOP_CONCURRENCY = 4;

/** Byte i of the part, by the one rule both fakes and the real file below obey. */
const byteAt = (offset: number): number => offset % 251;

/** A WebDAV file that answers any range, counting what it served. */
function fakeDav() {
  let served = 0;
  let requests = 0;
  return {
    servedBytes: () => served,
    requests: () => requests,
    url: (path: string) => `https://cloud.example.org/${path}`,
    async request(_method: string, _path: string, options?: { readonly headers?: Record<string, string> }) {
      const range = /bytes=(\d+)-(\d+)/.exec(options?.headers?.Range ?? '');
      if (!range) throw new Error('a range source asked without a Range header');
      const from = Number(range[1]);
      const to = Number(range[2]);
      const length = to - from + 1;
      requests += 1;
      served += length;
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = byteAt(from + i);
      return { status: 206, body: '', bodyBytes: bytes, headers: {} };
    },
  };
}

/** What every read must come back with, whoever else was reading at the time. */
function expected(offset: number, length: number): number[] {
  return Array.from({ length }, (_, i) => byteAt(offset + i));
}

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('a range source read by the loop’s four', () => {
  it('serves two concurrent reads in DIFFERENT windows their own bytes', async () => {
    // THE DEFECT, at its smallest. Two reads far enough apart that one window
    // cannot hold both, started before either has landed. With the window in
    // a field, the second fetch to arrive wins it, and the first read slices
    // itself out of somebody else's window: `slice` clamps a start of -40960
    // to nothing and hands back an EMPTY array where sixteen bytes were asked
    // for — no throw, no status, nothing to see until a CRC fails.
    const dav = fakeDav();
    const source = openRangeSource(dav, 'part-1.zip', PART_BYTES, { windowBytes: WINDOW });
    const [head, far] = await Promise.all([source.read(0, 16), source.read(40960, 16)]);
    expect(head.byteLength, 'a read came back short — it sliced another read’s window').toBe(16);
    expect(far.byteLength, 'a read came back short — it sliced another read’s window').toBe(16);
    expect([...head]).toEqual(expected(0, 16));
    expect([...far]).toEqual(expected(40960, 16));
    await source.close();
  });

  it('serves the loop’s four concurrent members, each its own bytes', async () => {
    // The shape the file loop actually produces: four members of one part,
    // spread across it, fetched at once. Every one of them must be exact.
    const dav = fakeDav();
    const source = openRangeSource(dav, 'part-1.zip', PART_BYTES, { windowBytes: WINDOW });
    const members = [0, 12 * 1024, 30 * 1024, 52 * 1024];
    const read = await Promise.all(members.map((offset) => source.read(offset, 512)));
    read.forEach((bytes, i) => {
      const offset = members[i]!;
      expect(bytes.byteLength, `member at ${offset} came back short`).toBe(512);
      expect([...bytes], `member at ${offset} got another member’s bytes`).toEqual(expected(offset, 512));
    });
    await source.close();
  });

  it('asks once for a window four concurrent reads share', async () => {
    // The other half, and the reason this is worth doing rather than simply
    // serialising: four members inside one 8 MiB window are ONE request. The
    // racing version made four — the whole read-ahead saving, paid four times
    // over, against the customer's own server.
    const dav = fakeDav();
    const source = openRangeSource(dav, 'part-1.zip', PART_BYTES, { windowBytes: WINDOW });
    const offsets = [0, 1024, 2048, 3072];
    const read = await Promise.all(offsets.map((offset) => source.read(offset, 256)));
    expect(dav.requests(), 'reads inside one window each fetched their own').toBe(1);
    read.forEach((bytes, i) => expect([...bytes]).toEqual(expected(offsets[i]!, 256)));
    await source.close();
  });

  it('answers the same bytes as the appliance’s own source, read the same way', async () => {
    // Hard rule 5, as a test. The disk source and the relay's source are two
    // implementations of one seam, and a pass cannot tell which it has. An
    // import that succeeds on the appliance and reports a corrupt archive on
    // the managed edition is the difference this file exists to remove.
    const root = await mkdtemp(join(tmpdir(), 'one-window-four-readers-'));
    made.push(root);
    const path = join(root, 'part-1.zip');
    const whole = new Uint8Array(PART_BYTES);
    for (let i = 0; i < PART_BYTES; i += 1) whole[i] = byteAt(i);
    await writeFile(path, whole);

    const dav = fakeDav();
    const overDav = openRangeSource(dav, 'part-1.zip', PART_BYTES, { windowBytes: WINDOW });
    const onDisk = await openFileSource(path);
    const reads: ReadonlyArray<readonly [number, number]> = [
      [0, 64],
      [9000, 64],
      [24 * 1024, 4096],
      [PART_BYTES - 64, 64],
    ];
    const [relay, disk] = await Promise.all([
      Promise.all(reads.map(([offset, length]) => overDav.read(offset, length))),
      Promise.all(reads.map(([offset, length]) => onDisk.read(offset, length))),
    ]);
    relay.forEach((bytes, i) => {
      const [offset, length] = reads[i]!;
      expect([...bytes], `the two editions disagree about ${length} bytes at ${offset}`).toEqual([
        ...disk[i]!,
      ]);
    });
    await Promise.all([overDav.close(), onDisk.close()]);
  });

  it('keeps the ceiling while four readers are in flight', async () => {
    // The budget counts one window per source, and four concurrent reads can
    // have four in the air. Only one survives the tick — the others are the
    // readers' own and are gone the moment their read returns — so the
    // ceiling holds between reads, which is what it is a ceiling for.
    const dav = fakeDav();
    const budget = rangeBudget(2 * WINDOW);
    const parts = [0, 1, 2, 3, 4].map((i) =>
      openRangeSource(dav, `part-${i}.zip`, PART_BYTES, { windowBytes: WINDOW, budget }),
    );
    await Promise.all(
      parts.map((part, i) =>
        Promise.all(
          Array.from({ length: LOOP_CONCURRENCY }, (_, k) => part.read(i * 1024 + k * 9000, 128)),
        ),
      ),
    );
    expect(budget.heldBytes(), 'concurrent reads left more than the budget held').toBeLessThanOrEqual(
      2 * WINDOW,
    );
    await Promise.all(parts.map((p) => p.close()));
    expect(budget.heldBytes(), 'closing every source left bytes held').toBe(0);
  });

  it('still refuses a read beyond the archive, whoever else is reading', async () => {
    // The guard that must not be lost in the rearranging: a read past the end
    // is our own arithmetic being wrong, and it says so rather than asking a
    // server for a range it cannot answer.
    const dav = fakeDav();
    const source = openRangeSource(dav, 'part-1.zip', PART_BYTES, { windowBytes: WINDOW });
    const settled = await Promise.allSettled([
      source.read(0, 16),
      source.read(PART_BYTES - 8, 16),
    ]);
    expect(settled[0]!.status).toBe('fulfilled');
    expect(settled[1]!.status).toBe('rejected');
    if (settled[1]!.status === 'rejected') {
      expect(String(settled[1]!.reason)).toContain('lies beyond');
    }
    await source.close();
  });
});
