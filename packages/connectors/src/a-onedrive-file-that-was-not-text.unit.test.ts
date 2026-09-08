// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every OneDrive file that was not plain text came back destroyed.
 *
 * `GraphDriveSource.fetchFileContent` read the response as TEXT and re-encoded
 * it:
 *
 *     const encoder = new TextEncoder();
 *     return encoder.encode(response.body);   // response.body = await res.text()
 *
 * A UTF-8 decode followed by a UTF-8 re-encode is lossless only for input that
 * IS valid UTF-8. Every other byte sequence became U+FFFD at the DECODE — the
 * bytes were already gone before the encode had anything to do. The same
 * defect was found on the DAV path and fixed there, measured on a 476 KB JPEG
 * that came back as 863 KB of replacement characters, not one of them
 * original.
 *
 * ## Why it survived a suite of 49 tests
 *
 * Because the double answered `text: async () => 'file content here'`. A
 * double that models a response as a STRING cannot express the defect: there
 * are no bytes for the decode to lose, so text-decoding a "file" passes and
 * looks like proof. The fixture was the reason the test was green, which is
 * the same shape as 0120 T6 — every DAV fixture being smaller than a chunk
 * meant the buffering was never exercised either.
 *
 * So the payloads here are BYTES THAT ARE NOT VALID UTF-8: a JPEG's leading
 * bytes, and a lone 0x80 continuation byte that no decoder can rescue. Both
 * survive `arrayBuffer()` and neither survives the old path.
 *
 * ## And the ceiling, for the same connector (0120 T5)
 *
 * Above `STREAM_FILES_LARGER_THAN_BYTES` the file arrives as a `FileBody` — a
 * size and a way to read that nothing holds — so the largest file a OneDrive
 * migration can move stops being decided by the runner's RAM. Below it
 * nothing changed, deliberately: most files are small and a buffer is simpler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphDriveSource } from './graph-drive-source.ts';
import { STREAM_FILES_LARGER_THAN_BYTES } from '@openmig/shared';
import type { GraphDriveSourceConfig } from './graph-drive-source.types.ts';
import type { FileItem } from '@openmig/shared';

/** A JPEG's first bytes: 0xFF 0xD8 is not a valid UTF-8 sequence. */
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
/** A lone continuation byte — invalid on its own, and unrecoverable once decoded. */
const LONE_CONTINUATION = new Uint8Array([0x41, 0x80, 0x42]);

const config: GraphDriveSourceConfig = {
  tokenProvider: {
    getToken: vi.fn().mockResolvedValue({ accessToken: 'token', expiresAt: Date.now() + 60_000 }),
  },
  tenantId: '11111111-1111-4111-8111-111111111111',
} as unknown as GraphDriveSourceConfig;

const item = (size: number): FileItem => ({
  path: 'Documents/holiday.jpg',
  isDirectory: false,
  size,
  modifiedAt: new Date().toISOString(),
  sourceRef: '01ABCDEF',
});

/** A response whose bytes are real bytes, the way Graph actually answers. */
function byteResponse(bytes: Uint8Array, status = 200): unknown {
  return {
    status,
    headers: new Map(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => new TextDecoder().decode(bytes),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = global.fetch;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('a file that is not text survives the download', () => {
  it('returns the bytes Graph sent, not a UTF-8 round trip of them', async () => {
    fetchMock.mockResolvedValueOnce(byteResponse(JPEG_HEAD));

    const fetched = await new GraphDriveSource(config).fetch(item(JPEG_HEAD.length));

    expect(
      Array.from(fetched.content ?? []),
      'The bytes must arrive as they left. Reading the response as text and re-encoding\n' +
        'it replaces every invalid sequence with U+FFFD (EF BF BD) — irreversibly, at the\n' +
        'decode. This assertion is the whole guard: it fails on the old implementation.',
    ).toEqual(Array.from(JPEG_HEAD));
  });

  it('does not silently grow the file, which is what the round trip did', async () => {
    fetchMock.mockResolvedValueOnce(byteResponse(LONE_CONTINUATION));

    const fetched = await new GraphDriveSource(config).fetch(item(LONE_CONTINUATION.length));

    // The measured symptom on the DAV path: 476,387 bytes in, 863,389 out.
    // Each replaced byte becomes three (EF BF BD), so a corrupted read is
    // LONGER than the file — a size the ledger then records as the truth.
    expect(fetched.content?.length).toBe(LONE_CONTINUATION.length);
  });

  it('never reaches for the decoded text of a file response', async () => {
    const response = byteResponse(JPEG_HEAD) as { text: () => Promise<string> };
    const text = vi.fn(response.text);
    fetchMock.mockResolvedValueOnce({ ...response, text });

    await new GraphDriveSource(config).fetch(item(JPEG_HEAD.length));

    expect(
      text,
      'A file body must never be decoded, not even to look at it. `text()` on a\n' +
        'response holding a JPEG destroys it whether or not the result is used.',
    ).not.toHaveBeenCalled();
  });

  it('names the file and the face when Graph refuses the download', async () => {
    fetchMock.mockResolvedValueOnce(byteResponse(new TextEncoder().encode('{"error":{"code":"accessDenied"}}'), 403));

    await expect(new GraphDriveSource(config).fetch(item(10))).rejects.toThrow(/accessDenied/);
  });
});

describe('a file bigger than the threshold arrives as a body', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('reports the size without reading a byte', async () => {
    const fetched = await new GraphDriveSource(config).fetch(item(big));

    expect(fetched.content, 'nothing is buffered').toBeUndefined();
    expect(fetched.body?.sizeBytes).toBe(big);
    expect(
      fetchMock,
      'The listing size decides this, so no request is made until open() — the point\n' +
        'of a body is that holding one costs nothing.',
    ).not.toHaveBeenCalled();
  });

  it('opens a fresh read each time, because a retry starts from the beginning', async () => {
    fetchMock.mockResolvedValue(byteResponse(JPEG_HEAD));

    const fetched = await new GraphDriveSource(config).fetch(item(big));
    await fetched.body?.open();
    await fetched.body?.open();

    expect(
      fetchMock.mock.calls.length,
      'A body that returns the same consumed stream twice writes an empty file on the\n' +
        'retry and records it as a copy.',
    ).toBe(2);
  });

  it('reads the same bytes through the stream', async () => {
    fetchMock.mockResolvedValue(byteResponse(JPEG_HEAD));

    const fetched = await new GraphDriveSource(config).fetch(item(big));
    const stream = await fetched.body!.open();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    expect(Array.from(chunks[0] ?? [])).toEqual(Array.from(JPEG_HEAD));
  });

  it('refuses a 200 with no body rather than writing an empty file', async () => {
    fetchMock.mockResolvedValue({ status: 200, headers: new Map(), body: null, text: async () => '' });

    const fetched = await new GraphDriveSource(config).fetch(item(big));

    await expect(
      fetched.body!.open(),
      'An empty stream here would write an empty file and record it as a copy — the\n' +
        'worst outcome available to this code.',
    ).rejects.toThrow(/no body to read/);
  });

  it('leaves a file at the threshold buffered, so the cheap path stays the common one', async () => {
    fetchMock.mockResolvedValueOnce(byteResponse(JPEG_HEAD));

    const fetched = await new GraphDriveSource(config).fetch(item(STREAM_FILES_LARGER_THAN_BYTES));

    expect(fetched.body, 'at the threshold, not above it').toBeUndefined();
    expect(fetched.content).toBeDefined();
  });
});
