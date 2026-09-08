// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The archive half of the memory ceiling — and the one that looked hard.
 *
 * `fetch` read every item into a `Uint8Array` whatever its size. An archive is
 * the size of somebody's photo library and a single video in one can be larger
 * than the runner, which killed the process mid-pass with no failure row and
 * no sentence.
 *
 * ## Why it is the CHEAPEST of the five, not the hardest
 *
 * The expectation going in was that a body would be expensive here: re-opening
 * would mean re-reading a zip entry, so `open()` might cost a pass over the
 * archive each time. It does not. `takeout-archive-reader` takes an EXTRACTED
 * tree — a directory, not the `.zip` — so an item is a file on disk and
 * re-opening is one more `createReadStream`. No second pass, no re-issued
 * request, no signed URL to expire. Of the five connectors this one has the
 * cheapest `open()` by some distance.
 *
 * ## What that costs the port, and why it is optional
 *
 * `ArchiveReader.contentStream` is OPTIONAL. A reader that cannot stream omits
 * it, this source keeps buffering for that reader, and
 * `MAX_BUFFERED_FILE_BYTES` still turns "the container died" into a sentence.
 * Requiring it would have made every reader a compile error to gain a
 * capability only some of them have — the same shape as the three transports
 * that gained an optional `body`.
 *
 * ## The manifest is never streamed
 *
 * It is synthesised in memory and small by construction, so it is returned
 * before the threshold is consulted at all — the same reason Drive's exports
 * stay buffered, arrived at from the opposite direction: there the size is
 * unknowable, here it is trivially small.
 */

import { describe, it, expect } from 'vitest';
import { ArchiveFileSource } from './archive-file-source.ts';
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';
import type { ArchiveHandle, ArchiveItem, ArchiveReader } from '@openmig/core/archive-reader';
import { createHash } from 'node:crypto';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x2a, 0x00, 0x7f, 0x41]);
const HASH = createHash('sha256').update(BYTES).digest('hex');

function archiveItem(sizeBytes: number): ArchiveItem {
  return {
    path: 'Photos from 2021/holiday.jpg',
    sizeBytes,
    contentHash: HASH,
    createdAt: '2021-07-14T10:00:00.000Z',
    // No album: the item sits in the import's root folder, which is the
    // shape `listSince` filters with `placeIn.length === 0`.
    placeIn: [],
  } as unknown as ArchiveItem;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** A reader over one item, counting how often each half is asked for bytes. */
function readerFor(item: ArchiveItem, opts: { canStream: boolean }) {
  const calls = { content: 0, contentStream: 0 };
  const reader = {
    provider: 'google-takeout',
    open: async (): Promise<ArchiveHandle> =>
      ({ provider: 'google-takeout', root: '/tmp/takeout', close: async () => {} }) as ArchiveHandle,
    async *items() {
      yield item;
    },
    summary: async () => ({ items: 1, bytes: item.sizeBytes }),
    content: async () => {
      calls.content += 1;
      return BYTES;
    },
    ...(opts.canStream
      ? {
          contentStream: async () => {
            calls.contentStream += 1;
            return streamOf(BYTES);
          },
        }
      : {}),
  } as unknown as ArchiveReader;
  return { reader, calls };
}

/** The item as the source itself places it, so the test never invents a path. */
async function fileItemFor(source: ArchiveFileSource) {
  const folders = await source.listFolders();
  const { items } = await source.listSince(folders[folders.length - 1]!);
  const found = items.find((raw) => raw.item.sourceRef === HASH);
  expect(found, 'the fixture item must be listed, or this test proves nothing').toBeDefined();
  return found!.item;
}

const LOCATION = { provider: 'google-takeout' as const, path: '/tmp/takeout' };

describe('a large archive item arrives as a body', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('reports the listed size without reading a byte', async () => {
    const { reader, calls } = readerFor(archiveItem(big), { canStream: true });
    const source = new ArchiveFileSource(reader, LOCATION);

    const fetched = await source.fetch(await fileItemFor(source));

    expect(fetched.content, 'nothing is buffered').toBeUndefined();
    expect(fetched.body?.sizeBytes).toBe(big);
    expect(calls, 'neither half is asked for bytes until open()').toEqual({
      content: 0,
      contentStream: 0,
    });
  });

  it('opens a fresh read each time, because a retry starts from the beginning', async () => {
    const { reader, calls } = readerFor(archiveItem(big), { canStream: true });
    const source = new ArchiveFileSource(reader, LOCATION);

    const fetched = await source.fetch(await fileItemFor(source));
    await fetched.body?.open();
    await fetched.body?.open();

    expect(
      calls.contentStream,
      'A body that hands back the same consumed stream twice writes an empty file on\n' +
        'the retry and records it as a copy. Here a fresh read is one more\n' +
        'createReadStream, so there is no excuse for caching one.',
    ).toBe(2);
  });

  it('reads the same bytes through the stream', async () => {
    const { reader } = readerFor(archiveItem(big), { canStream: true });
    const source = new ArchiveFileSource(reader, LOCATION);

    const fetched = await source.fetch(await fileItemFor(source));
    const stream = await fetched.body!.open();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    expect(Array.from(chunks[0] ?? [])).toEqual(Array.from(BYTES));
  });

  it('buffers instead when the reader cannot stream, rather than refusing', async () => {
    const { reader, calls } = readerFor(archiveItem(big), { canStream: false });
    const source = new ArchiveFileSource(reader, LOCATION);

    const fetched = await source.fetch(await fileItemFor(source));

    expect(
      fetched.body,
      'contentStream is optional on the port. A reader without it keeps the buffered\n' +
        'path — and MAX_BUFFERED_FILE_BYTES still refuses by sentence rather than by\n' +
        'death — where requiring it would have made every reader a compile error.',
    ).toBeUndefined();
    expect(fetched.content).toBeDefined();
    expect(calls.content).toBe(1);
  });
});

describe('a small item is still buffered', () => {
  it('returns bytes, with no body', async () => {
    const { reader, calls } = readerFor(archiveItem(BYTES.length), { canStream: true });
    const source = new ArchiveFileSource(reader, LOCATION);

    const fetched = await source.fetch(await fileItemFor(source));

    expect(Array.from(fetched.content ?? [])).toEqual(Array.from(BYTES));
    expect(fetched.body).toBeUndefined();
    expect(calls.contentStream, 'the cheap path stays the common one').toBe(0);
  });

  it('leaves an item AT the threshold buffered, not above it', async () => {
    const { reader } = readerFor(archiveItem(STREAM_FILES_LARGER_THAN_BYTES), { canStream: true });
    const source = new ArchiveFileSource(reader, LOCATION);

    const fetched = await source.fetch(await fileItemFor(source));

    expect(fetched.content).toBeDefined();
    expect(fetched.body).toBeUndefined();
  });
});
