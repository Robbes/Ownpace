// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CHECKSUM THAT DOWNLOADED THE WHOLE FILE (workplan 0150 T1).
 *
 * Verification reads a sample of the copied files back from the target and
 * hashes them (§20). The WebDAV writer's `contentHashFor` read each sampled
 * file whole into memory first, like every other response its client read. A
 * sample is any file a migration copied, so on a pass machine of half a
 * gigabyte a sampled video was a verification killed for memory, the way the
 * owner's Dropbox passes were killed by their uploads
 * (`an-upload-that-kept-every-byte`).
 *
 * What this holds:
 *
 *  1. A whole-file hash asks its client for a stream and hashes it as it
 *     arrives, to the same value the bytes give. A client that answers with
 *     bytes anyway is still hashed.
 *  2. `container-parts` still reads the bytes whole: a container is opened to
 *     be hashed.
 *  3. A refused read, or one that breaks off, is `undefined`, never a hash of
 *     part of a file, and a refused stream is not left open.
 *  4. Through the real client and `fetch`, against a server on this machine, a
 *     64 MiB file is hashed holding less than a quarter of itself three
 *     quarters in. Before, it held all it had read.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';
import { fileContentHash } from '@openmig/shared';
import type { Ledger, MappingId, TenantId } from '@openmig/shared';

const TENANT = 'aa aa' as unknown as TenantId;
const MAPPING = 'bb bb' as unknown as MappingId;
const ledger = { find: async () => undefined } as unknown as Ledger;
const ENTRY = { naturalKey: 'Videos/clip.mp4', targetId: 'Videos/clip.mp4', mailboxId: '' };

/** 3 MB in 64 KB pieces, so a hash over one piece would differ. */
const BYTES = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);

function piecesOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + 64 * 1024));
      at += 64 * 1024;
    },
  });
}

const writerWith = (httpClient: HttpClient, url = 'https://dav.example/remote.php/dav/files/x'): WebDAVTargetWriter =>
  new WebDAVTargetWriter({ url, username: 'u', password: 'p' }, { ledger, tenantId: TENANT, mappingId: MAPPING, ...(httpClient ? { httpClient } : {}) });

/** A client that answers every GET with `answer`, and writes down what it was asked. */
function answering(asked: HttpRequestOptions[], answer: (options: HttpRequestOptions) => HttpResponse): HttpClient {
  return {
    async request(options) {
      asked.push(options);
      return answer(options);
    },
  };
}

describe('a whole-file hash', () => {
  it('asks for a stream, and hashes it to what the bytes give', async () => {
    const asked: HttpRequestOptions[] = [];
    const client = answering(asked, (o) =>
      o.stream
        ? { status: 200, body: '', headers: {}, bodyStream: piecesOf(BYTES) }
        : { status: 200, body: '', headers: {}, bodyBytes: BYTES },
    );

    const hash = await writerWith(client).contentHashFor(ENTRY);

    expect(asked).toHaveLength(1);
    expect(asked[0]!.stream).toBe(true);
    expect(hash).toBe(fileContentHash(BYTES));
  });

  it('is still taken from bytes, from a client that answers with bytes anyway', async () => {
    const client = answering([], () => ({ status: 200, body: '', headers: {}, bodyBytes: BYTES }));

    expect(await writerWith(client).contentHashFor(ENTRY)).toBe(fileContentHash(BYTES));
  });

  it('is undefined for a refused read, and the refused stream is not left open', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = answering([], () => ({ status: 404, body: '', headers: {}, bodyStream: body }));

    expect(await writerWith(client).contentHashFor(ENTRY)).toBeUndefined();
    expect(cancelled, 'the refused stream was left open').toBe(true);
  });

  it('is undefined for a read that breaks off, never a hash of part of the file', async () => {
    let sent = 0;
    const breaking = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 3) controller.enqueue(new Uint8Array(1024));
        else controller.error(new Error('connection reset'));
      },
    });
    const client = answering([], () => ({ status: 200, body: '', headers: {}, bodyStream: breaking }));

    expect(await writerWith(client).contentHashFor(ENTRY)).toBeUndefined();
  });
});

describe('a container-parts hash', () => {
  it('still reads the bytes whole', async () => {
    const asked: HttpRequestOptions[] = [];
    const client = answering(asked, () => ({ status: 200, body: '', headers: {}, bodyBytes: new Uint8Array([1, 2, 3]) }));

    await writerWith(client).contentHashFor(ENTRY, 'container-parts');

    expect(asked).toHaveLength(1);
    expect(asked[0]!.stream).toBeUndefined();
  });
});

describe('through the real fetch', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  it('a 64 MiB file is hashed holding less than a quarter of itself three quarters in', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const size = 64 * 1024 * 1024;
    const piece = new Uint8Array(64 * 1024).map((_, i) => i % 251);

    let heldMidway: number | undefined;
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-length': String(size) });
      // Written as the client reads, so what was sent is what was read.
      Readable.from(
        (async function* () {
          for (let sent = 0; sent < size; sent += piece.byteLength) {
            // Three quarters in, the server stops for a moment, so the client
            // has read everything sent. Then two full collections, a turn
            // apart, so that what was freed is gone from the count: what is
            // left is what the client still holds.
            if (heldMidway === undefined && sent >= (size * 3) / 4) {
              await new Promise((settle) => setTimeout(settle, 50));
              gc();
              await new Promise((settle) => setImmediate(settle));
              gc();
              heldMidway = process.memoryUsage().arrayBuffers;
            }
            yield piece;
          }
        })(),
      ).pipe(res);
    });
    await new Promise<void>((listening) => server!.listen(0, '127.0.0.1', () => listening()));
    const { port } = server.address() as AddressInfo;

    gc();
    const before = process.memoryUsage().arrayBuffers;
    const hash = await new WebDAVTargetWriter(
      { url: `http://127.0.0.1:${port}/dav`, username: 'u', password: 'p' },
      { ledger, tenantId: TENANT, mappingId: MAPPING },
    ).contentHashFor(ENTRY);

    const whole = new Uint8Array(size);
    for (let at = 0; at < size; at += piece.byteLength) whole.set(piece, at);
    expect(hash).toBe(fileContentHash(whole));
    expect(heldMidway, 'the file was never read three quarters in').toBeDefined();
    expect(
      heldMidway! - before,
      `${Math.round((heldMidway! - before) / 1048576)} MiB of a 64 MiB file was held three quarters in`,
    ).toBeLessThan(size / 4);
  });
});
