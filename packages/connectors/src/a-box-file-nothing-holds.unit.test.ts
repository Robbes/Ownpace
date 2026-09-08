// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Box half of the memory ceiling (workplan 0120 T5).
 *
 * `fetch` read every file into a `Uint8Array` whatever its size, so the largest
 * file a Box migration could move was decided by the runner's RAM — and
 * crossing that killed the process mid-pass, with no failure row and no
 * sentence. From a customer's side, a migration that stops on one file and
 * never says which.
 *
 * Above `STREAM_FILES_LARGER_THAN_BYTES` the file now arrives as a `FileBody`:
 * a size, and a way to read that nothing holds. Below it nothing changed,
 * deliberately — most files are small and a buffer is simpler.
 *
 * ## What is specific to Box
 *
 * `/files/{id}/content` answers a REDIRECT to a signed download URL, which
 * `fetch` follows and which needs no Authorization header of its own. A signed
 * URL is time-limited, so re-opening a body cannot mean "use the URL from last
 * time": each `open()` asks Box again and follows a fresh redirect. Nothing is
 * cached here, and the guard counts the calls to prove it.
 *
 * The size correction on the buffered path (`size: bytes.byteLength`) stays
 * where it is. Box's listing asks for `size` and usually has it, but when it
 * does not the item reads as 0 — which falls BELOW the threshold, takes the
 * buffered path, and gets corrected there. A missing size can therefore never
 * produce a body that lies about its length.
 *
 * The bytes were never in question: this connector already read
 * `arrayBuffer()`. Worth stating, because the Graph connector did not —
 * `the-decode-that-was-waiting-in-the-next-connector` now holds that property
 * for every `FileSource` in the repository.
 */

import { describe, it, expect, vi } from 'vitest';
import { BoxFileSource } from './box-file-source.ts';
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';
import type { BoxTransport } from './box-file-source.types.ts';
import type { FileItem } from '@openmig/shared';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x2a, 0x00, 0x7f]);

const item = (size: number): FileItem => ({
  path: 'Contracts/signed.pdf',
  isDirectory: false,
  size,
  modifiedAt: new Date().toISOString(),
  sourceRef: '1234567890',
});

type BoxResponse = Awaited<ReturnType<BoxTransport>>;

function bytesResponse(bytes: Uint8Array): BoxResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer,
    text: async () => new TextDecoder().decode(bytes),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function transportFor(response: () => BoxResponse = () => bytesResponse(BYTES)) {
  const urls: string[] = [];
  const transport = vi.fn(async (url: string) => {
    urls.push(url);
    return response();
  }) as unknown as BoxTransport;
  return { transport, urls };
}

describe('a large Box file arrives as a body', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('reports the listing size without asking for a byte', async () => {
    const { transport, urls } = transportFor();

    const fetched = await new BoxFileSource(transport).fetch(item(big));

    expect(fetched.content, 'nothing is buffered').toBeUndefined();
    expect(fetched.body?.sizeBytes).toBe(big);
    expect(
      urls,
      'Holding a body has to cost nothing, or it is a buffer with extra steps.',
    ).toHaveLength(0);
  });

  it('asks Box again on every open, because a signed URL is time-limited', async () => {
    const { transport, urls } = transportFor();

    const fetched = await new BoxFileSource(transport).fetch(item(big));
    await fetched.body?.open();
    await fetched.body?.open();

    expect(
      urls.length,
      'Re-opening cannot mean reusing last time\'s signed URL: it expires, and a body\n' +
        'that hands back the same consumed stream writes an empty file on the retry and\n' +
        'records it as a copy.',
    ).toBe(2);
    expect(urls[0]).toContain('/files/1234567890/content');
  });

  it('reads the same bytes through the stream', async () => {
    const { transport } = transportFor();

    const fetched = await new BoxFileSource(transport).fetch(item(big));
    const stream = await fetched.body!.open();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    expect(Array.from(chunks[0] ?? [])).toEqual(Array.from(BYTES));
  });

  it('refuses a 200 with no body rather than writing an empty file', async () => {
    const { transport } = transportFor(() => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
      body: null,
    }));

    const fetched = await new BoxFileSource(transport).fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/no body to read/);
  });

  it("carries Box's own words, and the file's name, when it refuses", async () => {
    const { transport } = transportFor(() => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '{"code":"storage_limit_exceeded"}',
    }));

    const fetched = await new BoxFileSource(transport).fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/storage_limit_exceeded/);
    await expect(fetched.body!.open()).rejects.toThrow(/Contracts\/signed\.pdf/);
  });
});

describe('a small file is still buffered, and its size still corrected', () => {
  it('returns bytes, with no body', async () => {
    const { transport } = transportFor();

    const fetched = await new BoxFileSource(transport).fetch(item(BYTES.length));

    expect(Array.from(fetched.content ?? [])).toEqual(Array.from(BYTES));
    expect(fetched.body).toBeUndefined();
  });

  it('leaves a file AT the threshold buffered, not above it', async () => {
    const { transport } = transportFor();

    const fetched = await new BoxFileSource(transport).fetch(item(STREAM_FILES_LARGER_THAN_BYTES));

    expect(fetched.content).toBeDefined();
    expect(fetched.body).toBeUndefined();
  });

  it('corrects a size Box did not report, rather than trusting the 0', async () => {
    const { transport } = transportFor();

    // `toFileItem` reads `file.size ?? 0`, so an item Box gave no size to
    // arrives here as 0 — below the threshold, buffered, and corrected from
    // the bytes. That is why a missing size can never produce a body whose
    // sizeBytes is a lie.
    const fetched = await new BoxFileSource(transport).fetch(item(0));

    expect(fetched.body).toBeUndefined();
    expect(fetched.item.size).toBe(BYTES.length);
  });
});
