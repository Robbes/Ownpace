// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN UPLOAD THAT KEPT EVERY BYTE (workplan 0150 T1).
 *
 * A file above 8 MB crosses as a stream (`FileBody`), so that no pass has to
 * hold it. `a-file-that-never-fits-in-memory` proved the writer hands the PUT
 * a stream, through a client of its own. The real client, Node's `fetch`,
 * held the file anyway. Unless a request's redirect mode is `error`, fetch
 * sends a clone of the request and keeps the original, whose body is the
 * other branch of a tee that nobody reads. Every chunk the upload sent stayed
 * in memory until the request was gone.
 *
 * On the owner's Dropbox migration every file above 8 MB went out that way,
 * on a pass machine of half a gigabyte. From the first pass that met a large
 * file, every pass was killed partway through copying (SIGKILL), and 1,351 of
 * 55,245 files had been copied in three days.
 *
 * What this holds, for the writer's own client (`createDefaultHttpClient`):
 *
 *  1. A stream body goes to `fetch` with `redirect: 'error'` beside
 *     `duplex: 'half'`, and every other request goes as it did.
 *  2. Through the real `fetch`, against a server on this machine, a 64 MiB
 *     upload holds less than a quarter of itself while it is under way: read
 *     when three quarters have arrived, after a full collection, so that only
 *     what is still referenced counts. Before, it held everything sent so far,
 *     so the peak was the file; the pass died there, not after.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { Ledger, MappingId, RawFileItem, TenantId } from '@openmig/shared';

const TENANT = 'aa aa' as unknown as TenantId;
const MAPPING = 'bb bb' as unknown as MappingId;
const EMPTY_LISTING = '<d:multistatus xmlns:d="DAV:"></d:multistatus>';

/** Just enough ledger for the write path: nothing known, records accepted. */
const ledger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

/** A writer with no client of its own, so it builds the real one. */
const writerAt = (url: string): WebDAVTargetWriter =>
  new WebDAVTargetWriter({ url, username: 'u', password: 'p' }, { ledger, tenantId: TENANT, mappingId: MAPPING });

/** A file of `size` bytes, handed over as a stream of fresh 64 KiB chunks, as a download's are. */
function streamed(path: string, size: number): RawFileItem {
  return {
    item: { path, isDirectory: false, size, modifiedAt: '2026-09-28T19:00:00Z', sourceRef: 'ref' },
    body: {
      sizeBytes: size,
      open: async () => {
        let sent = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= size) {
              controller.close();
              return;
            }
            const n = Math.min(64 * 1024, size - sent);
            sent += n;
            controller.enqueue(new Uint8Array(n));
          },
        });
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the writer's own client", () => {
  /** Every call `fetch` receives, answered as a DAV server would, the body read to its end. */
  function recordFetch(): Array<{ method: string; init: Record<string, unknown> }> {
    const calls: Array<{ method: string; init: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: Record<string, unknown>) => {
      calls.push({ method: String(init.method), init });
      if (init.body instanceof ReadableStream) await new Response(init.body).arrayBuffer();
      if (init.method === 'PROPFIND') return new Response(EMPTY_LISTING, { status: 207 });
      return new Response(null, { status: 201, headers: { etag: '"written"' } });
    });
    return calls;
  }

  it('sends a stream with redirect "error" beside duplex "half"', async () => {
    const calls = recordFetch();

    await writerAt('https://dav.example/remote.php/dav/files/x').upsertFile('', streamed('Videos/clip.mp4', 9 * 1024 * 1024));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put, 'no PUT was sent').toBeDefined();
    expect(put!.init.body).toBeInstanceOf(ReadableStream);
    expect(put!.init.duplex).toBe('half');
    expect(put!.init.redirect).toBe('error');
  });

  it('sends everything else as before: a listing, and a file sent as bytes', async () => {
    const calls = recordFetch();
    const small: RawFileItem = {
      item: { path: 'Docs/note.txt', isDirectory: false, size: 5, modifiedAt: '2026-09-28T19:00:00Z', sourceRef: 'ref' },
      content: new TextEncoder().encode('hello'),
    };

    await writerAt('https://dav.example/remote.php/dav/files/x').upsertFile('', small);

    const listing = calls.find((c) => c.method === 'PROPFIND');
    const put = calls.find((c) => c.method === 'PUT');
    expect(listing, 'no listing was asked for').toBeDefined();
    expect(put, 'no PUT was sent').toBeDefined();
    for (const call of [listing!, put!]) {
      expect(call.init.body).not.toBeInstanceOf(ReadableStream);
      expect(call.init).not.toHaveProperty('redirect');
      expect(call.init).not.toHaveProperty('duplex');
    }
  });
});

describe('through the real fetch', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  it('a 64 MiB upload holds less than a quarter of itself while it is under way', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const size = 64 * 1024 * 1024;

    let received = 0;
    let heldMidway: number | undefined;
    server = createServer((req, res) => {
      req.on('data', (chunk: Buffer) => {
        if (req.method !== 'PUT') return;
        received += chunk.byteLength;
        // Three quarters in: a full collection, then what is still referenced.
        // Everything the server has read is garbage by now; a copy of it that
        // the client still holds is not.
        if (heldMidway === undefined && received >= (size * 3) / 4) {
          gc();
          heldMidway = process.memoryUsage().arrayBuffers;
        }
      });
      req.on('end', () => {
        if (req.method === 'PROPFIND') {
          res.writeHead(207, { 'content-type': 'application/xml' });
          res.end(EMPTY_LISTING);
          return;
        }
        res.writeHead(201, { etag: '"written"' });
        res.end();
      });
    });
    await new Promise<void>((listening) => server!.listen(0, '127.0.0.1', () => listening()));
    const { port } = server.address() as AddressInfo;

    gc();
    const before = process.memoryUsage().arrayBuffers;
    const written = await writerAt(`http://127.0.0.1:${port}/dav`).upsertFile('', streamed('Videos/clip.mp4', size));

    expect(written.created, 'the file was not written').toBe(true);
    expect(received, 'the server did not receive the whole file').toBe(size);
    expect(heldMidway, 'the upload was never read three quarters in').toBeDefined();
    expect(
      heldMidway! - before,
      `${Math.round((heldMidway! - before) / 1048576)} MiB of a 64 MiB upload was held three quarters in`,
    ).toBeLessThan(size / 4);
  });
});
