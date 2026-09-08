// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Dropbox half of the memory ceiling (workplan 0120 T5).
 *
 * `fetch` read every file into a `Uint8Array`, whatever its size, so the
 * largest file a Dropbox migration could move was decided by the runner's RAM
 * — and crossing that killed the process mid-pass, with no failure row and no
 * sentence. From a customer's side, a migration that stops on one file and
 * never says which.
 *
 * Above `STREAM_FILES_LARGER_THAN_BYTES` the file now arrives as a `FileBody`:
 * a size, and a way to read that nothing holds. Below it nothing changed,
 * deliberately — most files are small, a buffer is simpler, and the machinery
 * is not free.
 *
 * ## What is specific to Dropbox here
 *
 * The download is a POST to `content.dropboxapi.com` whose argument travels in
 * a HEADER (`Dropbox-API-Arg`), not a body. A streamed read that reproduced
 * the request without that header would get a 400 from Dropbox and read as a
 * broken file rather than a broken request — so the header is asserted on the
 * STREAMED path too, not just the buffered one.
 *
 * The bytes were never in question: this connector already read
 * `arrayBuffer()`. That is worth stating, because the Graph connector did not,
 * and the same PR that found that fixed it —
 * `the-decode-that-was-waiting-in-the-next-connector` now holds the property
 * for every `FileSource` in the repository.
 */

import { describe, it, expect, vi } from 'vitest';
import { DropboxFileSource } from './dropbox-file-source.ts';
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';
import type { DropboxTransport } from './dropbox-file-source.types.ts';
import type { FileItem } from '@openmig/shared';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x2a]);

const item = (size: number): FileItem => ({
  path: 'Photos/holiday.jpg',
  isDirectory: false,
  size,
  modifiedAt: new Date().toISOString(),
  sourceRef: 'id:AAAAAAAAAAAAAAAAAAAAAA',
});

function bytesResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => new TextDecoder().decode(bytes),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as Response;
}

/** A transport that records what it was asked for. */
function transportFor(response: () => Response): {
  transport: DropboxTransport;
  calls: Array<{ url: string; init: { headers?: Record<string, string> } }>;
} {
  const calls: Array<{ url: string; init: { headers?: Record<string, string> } }> = [];
  const transport = vi.fn(async (url: string, init: { headers?: Record<string, string> }) => {
    calls.push({ url, init });
    return response();
  }) as unknown as DropboxTransport;
  return { transport, calls };
}

describe('a small Dropbox file is still buffered', () => {
  it('returns bytes, with no body', async () => {
    const { transport, calls } = transportFor(() => bytesResponse(BYTES));
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(BYTES.length));

    expect(Array.from(fetched.content ?? [])).toEqual(Array.from(BYTES));
    expect(fetched.body, 'the cheap path stays the common one').toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('leaves a file AT the threshold buffered, not above it', async () => {
    const { transport } = transportFor(() => bytesResponse(BYTES));
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(STREAM_FILES_LARGER_THAN_BYTES));

    expect(fetched.content).toBeDefined();
    expect(fetched.body).toBeUndefined();
  });
});

describe('a large Dropbox file arrives as a body', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('reports the size without asking for a byte', async () => {
    const { transport, calls } = transportFor(() => bytesResponse(BYTES));
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));

    expect(fetched.content, 'nothing is buffered').toBeUndefined();
    expect(fetched.body?.sizeBytes).toBe(big);
    expect(
      calls,
      'The listing size decides this, so no request is made until open() — holding a\n' +
        'body has to cost nothing, or it is just a buffer with extra steps.',
    ).toHaveLength(0);
  });

  it('opens a fresh download each time, because a retry starts from the beginning', async () => {
    const { transport, calls } = transportFor(() => bytesResponse(BYTES));
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));
    await fetched.body?.open();
    await fetched.body?.open();

    expect(
      calls.length,
      'A body that hands back the same consumed stream twice writes an EMPTY FILE on\n' +
        'the retry and records it as a copy — the worst outcome available here.',
    ).toBe(2);
  });

  it('sends the file id in Dropbox-API-Arg on the streamed path too', async () => {
    const { transport, calls } = transportFor(() => bytesResponse(BYTES));
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));
    await fetched.body?.open();

    expect(calls[0]?.url).toContain('/files/download');
    expect(
      calls[0]?.init.headers?.['Dropbox-API-Arg'],
      'The download argument travels in a HEADER, not a body. A streamed read that\n' +
        'rebuilt the request without it gets a 400 and reads as a broken file rather\n' +
        'than a broken request.',
    ).toBe(JSON.stringify({ path: 'id:AAAAAAAAAAAAAAAAAAAAAA' }));
  });

  it('reads the same bytes through the stream', async () => {
    const { transport } = transportFor(() => bytesResponse(BYTES));
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));
    const stream = await fetched.body!.open();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    expect(Array.from(chunks[0] ?? [])).toEqual(Array.from(BYTES));
  });

  it('refuses a 200 with no body rather than writing an empty file', async () => {
    const { transport } = transportFor(
      () => ({ ok: true, status: 200, body: null, text: async () => '' }) as unknown as Response,
    );
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/no body to read/);
  });

  it("carries Dropbox's own words when it refuses the download", async () => {
    const { transport } = transportFor(
      () =>
        ({
          ok: false,
          status: 409,
          text: async () => '{"error_summary":"path/not_found/..."}',
        }) as unknown as Response,
    );
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/path\/not_found/);
  });

  it('names the file in that refusal, since a pass fails one item at a time', async () => {
    const { transport } = transportFor(
      () => ({ ok: false, status: 409, text: async () => 'nope' }) as unknown as Response,
    );
    const source = new DropboxFileSource(transport);

    const fetched = await source.fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/Photos\/holiday\.jpg/);
  });
});
