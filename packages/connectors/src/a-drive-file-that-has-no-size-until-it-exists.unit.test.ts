// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Drive half of the memory ceiling, and the one file it must NOT stream.
 *
 * `fetch` read every file into a `Uint8Array` whatever its size, so the largest
 * file a Drive migration could move was decided by the runner's RAM — and
 * crossing that killed the process mid-pass, with no failure row and no
 * sentence. Above `STREAM_FILES_LARGER_THAN_BYTES` an ordinary file now
 * arrives as a `FileBody`: a size, and a way to read that nothing holds.
 *
 * ## A GOOGLE DOC HAS NO SIZE UNTIL THE EXPORT EXISTS
 *
 * That is the Drive-specific decision, and it is why this connector's branch is
 * not the same shape as Dropbox's. Drive reports no `size` for a native editor
 * file — a Doc is not bytes, it is a document — so the listing carries 0, and
 * the exported length is unknowable until Drive has produced the export.
 *
 * `FileBody.sizeBytes` has to be honest BEFORE a byte is read: the daily byte
 * meter spends it ahead of the fetch (0090), and the target promises it as
 * `Content-Length` (T4 — without which the PUT is chunked, which some servers
 * refuse and others accept while reporting a size of zero). A guessed size
 * there is worse than a buffer. So an export is always buffered, and only a
 * file with a real listing size can stream.
 *
 * This is also why `fetch` corrects the size on the buffered path
 * (`size: bytes.byteLength`): that correction exists FOR exports, whose size
 * was never known. Streaming does not lose it, because exports do not stream.
 *
 * ## And the metadata call stays where it was
 *
 * Unlike the Graph and Dropbox bodies, which issue nothing until `open()`,
 * Drive's `fetch` still makes one request before deciding: the native-file
 * REFUSAL has to land inside the sync loop's per-item boundary, and whether
 * the file can be streamed at all is what that same call answers. A large
 * native file under `policy: 'refuse'` must therefore still throw at `fetch` —
 * deferring that into `open()` would move a per-item failure to a place the
 * loop reports differently.
 */

import { describe, it, expect, vi } from 'vitest';
import { GoogleDriveSource, NativeFileRefused } from './google-drive-source.ts';
import { STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';
import type { DriveResponse, DriveTransport } from './google-drive-source.types.ts';
import type { FileItem } from '@openmig/shared';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x2a, 0x00]);

const item = (size: number): FileItem => ({
  path: 'Reports/scan.pdf',
  isDirectory: false,
  size,
  modifiedAt: new Date().toISOString(),
  sourceRef: '1AbCdEfGhIjKlMnOp',
});

function jsonResponse(value: unknown): DriveResponse {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => JSON.stringify(value),
  };
}

function bytesResponse(bytes: Uint8Array): DriveResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    // A COPY, not a view onto the fixture. `bytes.buffer.slice(...)` types as
    // `ArrayBuffer | SharedArrayBuffer` here and the interface promises an
    // `ArrayBuffer`; a fresh Uint8Array allocates one and hands it over.
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

/**
 * A transport that answers the metadata call with `mimeType` and everything
 * else with bytes, recording every URL it was given.
 */
function transportFor(mimeType: string, download: () => DriveResponse = () => bytesResponse(BYTES)) {
  const urls: string[] = [];
  const transport = vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes('fields=id,name,mimeType')) {
      return jsonResponse({ id: '1AbCdEfGhIjKlMnOp', name: 'scan.pdf', mimeType });
    }
    return download();
  }) as unknown as DriveTransport;
  return { transport, urls };
}

const PDF = 'application/pdf';
const GOOGLE_DOC = 'application/vnd.google-apps.document';

describe('an ordinary file bigger than the threshold arrives as a body', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('reports the listing size and downloads nothing yet', async () => {
    const { transport, urls } = transportFor(PDF);

    const fetched = await new GoogleDriveSource(transport).fetch(item(big));

    expect(fetched.content, 'nothing is buffered').toBeUndefined();
    expect(fetched.body?.sizeBytes).toBe(big);
    expect(
      urls,
      'One request, and it is the METADATA call — the native-file decision needs it\n' +
        'before anything else can be decided. The bytes are not touched until open().',
    ).toHaveLength(1);
    expect(urls[0]).toContain('fields=id,name,mimeType');
  });

  it('opens a fresh download each time, because a retry starts from the beginning', async () => {
    const { transport, urls } = transportFor(PDF);

    const fetched = await new GoogleDriveSource(transport).fetch(item(big));
    await fetched.body?.open();
    await fetched.body?.open();

    const downloads = urls.filter((url) => url.includes('alt=media'));
    expect(
      downloads.length,
      'A body that hands back the same consumed stream twice writes an empty file on\n' +
        'the retry and records it as a copy.',
    ).toBe(2);
  });

  it('downloads through alt=media, with shared-drive support', async () => {
    const { transport, urls } = transportFor(PDF);

    const fetched = await new GoogleDriveSource(transport).fetch(item(big));
    await fetched.body?.open();

    const download = urls.find((url) => url.includes('alt=media'));
    expect(download).toBeDefined();
    expect(
      download,
      'Without supportsAllDrives a files.get on a shared-drive item 404s, and this\n' +
        'path would report a missing file for one that is there.',
    ).toContain('supportsAllDrives=true');
  });

  it('reads the same bytes through the stream', async () => {
    const { transport } = transportFor(PDF);

    const fetched = await new GoogleDriveSource(transport).fetch(item(big));
    const stream = await fetched.body!.open();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    expect(Array.from(chunks[0] ?? [])).toEqual(Array.from(BYTES));
  });

  it('refuses a 200 with no body rather than writing an empty file', async () => {
    const { transport } = transportFor(PDF, () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
      body: null,
    }));

    const fetched = await new GoogleDriveSource(transport).fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/no body to read/);
  });

  it("carries Drive's own words when it refuses the download", async () => {
    const { transport } = transportFor(PDF, () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '{"error":{"message":"The user has exceeded their quota"}}',
    }));

    const fetched = await new GoogleDriveSource(transport).fetch(item(big));

    await expect(fetched.body!.open()).rejects.toThrow(/exceeded their quota/);
    await expect(fetched.body!.open()).rejects.toThrow(/Reports\/scan\.pdf/);
  });
});

describe('a native editor file is never streamed, whatever its listed size', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('buffers the export even above the threshold', async () => {
    const { transport } = transportFor(GOOGLE_DOC);
    const source = new GoogleDriveSource(transport, { nativeFilePolicy: 'export-office' });

    const fetched = await source.fetch(item(big));

    expect(
      fetched.body,
      'A Doc has no size until the export exists, and FileBody.sizeBytes must be\n' +
        'honest before a byte is read — the byte meter spends it and the target promises\n' +
        'it as Content-Length. A guessed size is worse than a buffer.',
    ).toBeUndefined();
    expect(fetched.content).toBeDefined();
  });

  it('corrects the size from the exported bytes, which is why the buffer stays', async () => {
    const { transport } = transportFor(GOOGLE_DOC);
    const source = new GoogleDriveSource(transport, { nativeFilePolicy: 'export-office' });

    const fetched = await source.fetch(item(big));

    expect(
      fetched.item.size,
      'The listing said one thing and the export is another. This correction is the\n' +
        'reason exports cannot stream, and it must survive the change.',
    ).toBe(BYTES.length);
  });

  it('still refuses at fetch, not inside open(), under the refuse policy', async () => {
    const { transport } = transportFor(GOOGLE_DOC);
    const source = new GoogleDriveSource(transport, { nativeFilePolicy: 'refuse' });

    await expect(
      source.fetch(item(big)),
      'The refusal belongs inside the sync loop\'s per-item boundary, where it is\n' +
        'recorded as this file\'s failure and the rest of the folder migrates. Deferring\n' +
        'it into open() would move it somewhere the loop reports differently.',
    ).rejects.toBeInstanceOf(NativeFileRefused);
  });
});

describe('a small file is still buffered', () => {
  it('returns bytes, with no body', async () => {
    const { transport } = transportFor(PDF);

    const fetched = await new GoogleDriveSource(transport).fetch(item(BYTES.length));

    expect(Array.from(fetched.content ?? [])).toEqual(Array.from(BYTES));
    expect(fetched.body).toBeUndefined();
  });

  it('leaves a file AT the threshold buffered, not above it', async () => {
    const { transport } = transportFor(PDF);

    const fetched = await new GoogleDriveSource(transport).fetch(item(STREAM_FILES_LARGER_THAN_BYTES));

    expect(fetched.content).toBeDefined();
    expect(fetched.body).toBeUndefined();
  });
});
