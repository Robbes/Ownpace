// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RETRY THAT REUSED A SPENT STREAM (live 2026-09-12).
 *
 * `uploadStreamed` opened the source body ONCE and handed the resulting
 * `ReadableStream` to `requestWithDavRetry`, which sends the same options
 * object again on a transient status. A stream is consumed by the first send,
 * so the second attempt did not retry the request — it failed it, with
 *
 *   TypeError: Response body object should not be disturbed or locked
 *
 * Five photo uploads to Nextcloud carried exactly that error, each after ONE
 * pass-level attempt. The retry exists because Nextcloud's default SQLite is a
 * single-writer database that answers `500 … database is locked` under
 * concurrent writes (see dav-retry.ts) — precisely the condition several
 * uploads into one new folder produce. So the mechanism written to survive the
 * lock was the mechanism turning the lock into a permanent failure, and the
 * server's real answer never reached the failure queue.
 *
 * Two properties, and neither can be satisfied by reusing one stream:
 *
 *  1. **Every attempt gets its own body.** `FileBody.open()` exists for this —
 *     "a retry after a half-written upload starts from the beginning, and a
 *     stream that has been consumed cannot" (webdav-source.ts). Only this call
 *     site was spending the first open on all five attempts.
 *  2. **Every attempt gets its own hasher.** A digest is a fact about the bytes
 *     the accepted request carried. Hashing across a failed attempt and a
 *     successful one describes neither — and that value is what the ledger
 *     stores and what §20 compares the target against.
 *
 * The non-transient case is asserted too: a 403 must be answered on the first
 * attempt, with no second read of the source. Re-opening a body costs a second
 * GET against the source, which is metered (0090's daily ceiling).
 */

import { describe, it, expect } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';
import { fileContentHash, type FileBody, type RawFileItem } from '@openmig/shared';
import type { Ledger, MappingId, TenantId } from '@openmig/shared';

const TENANT = 'aa aa' as unknown as TenantId;
const MAPPING = 'bb bb' as unknown as MappingId;

/** Big enough to take the streamed path, and several chunks of it. */
const BYTES = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);

const readAll = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

/**
 * A body that counts its opens and hands out a FRESH stream each time — what
 * every real streaming source in this product does, and what the old call site
 * asked for exactly once.
 */
function countingBody(content: Uint8Array): FileBody & { readonly opens: () => number } {
  let opens = 0;
  return {
    sizeBytes: content.byteLength,
    open: async () => {
      opens += 1;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      });
    },
    opens: () => opens,
  };
}

interface Put {
  /** What the server actually received on this attempt. */
  readonly received: Uint8Array;
}

/**
 * A server that refuses the first `failTimes` PUTs with a transient status and
 * accepts the next — Nextcloud's locked-SQLite behaviour, in a stub.
 *
 * It READS the body on every attempt, including the refused ones. That is the
 * whole point: a server that ignored the body would leave a spent stream
 * looking fresh, and the bug under test would not reproduce.
 */
function lockingClient(
  puts: Put[],
  failTimes: number,
  transientStatus = 500,
): HttpClient {
  let seen = 0;
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      if (options.method === 'PROPFIND') {
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      }
      if (options.method !== 'PUT') return { status: 201, body: '', headers: {} };

      // Node's fetch refuses a consumed stream before the request leaves; the
      // stub has to be at least as strict or the test proves nothing.
      const body = options.body;
      if (!(body instanceof ReadableStream)) {
        throw new Error('the streamed PUT did not carry a stream');
      }
      if (body.locked) {
        throw new TypeError('Response body object should not be disturbed or locked');
      }
      puts.push({ received: await readAll(body) });

      seen += 1;
      if (seen <= failTimes) {
        return {
          status: transientStatus,
          body: 'SQLSTATE[HY000]: General error: 5 database is locked',
          headers: {},
        };
      }
      return { status: 201, body: '', headers: { etag: '"written"' } };
    },
  };
}

function recordingLedger(rows: Array<Record<string, unknown>>): Ledger {
  return {
    find: async () => undefined,
    recordIfAbsent: async (row: Record<string, unknown>) => {
      rows.push(row);
    },
  } as unknown as Ledger;
}

const writerWith = (client: HttpClient, ledger: Ledger): WebDAVTargetWriter =>
  new WebDAVTargetWriter(
    { url: 'https://dav.example/remote.php/dav/files/x', username: 'u', password: 'p' },
    { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );

const itemWith = (body: FileBody): RawFileItem => ({
  item: {
    path: 'Wieke/Foto shoot Emma/IMG20230122143958.jpg',
    isDirectory: false,
    size: body.sizeBytes,
    modifiedAt: new Date().toISOString(),
    sourceRef: 'ref',
  },
  body,
});

describe('a streamed upload survives the lock it was written to survive', () => {
  it('re-opens the body for the second attempt, and the bytes arrive whole', async () => {
    const puts: Put[] = [];
    const body = countingBody(BYTES);

    await writerWith(lockingClient(puts, 1), recordingLedger([])).upsertFile('', itemWith(body));

    // Two attempts, two opens. With one open the second attempt carried a
    // spent stream and the upload failed with a TypeError about disturbance.
    expect(body.opens()).toBe(2);
    expect(puts).toHaveLength(2);
    // And the accepted attempt carried the WHOLE file, not the tail of a
    // partly-read one.
    expect(puts[1]?.received).toEqual(BYTES);
  });

  it('records the hash of the attempt the server accepted', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const body = countingBody(BYTES);

    await writerWith(lockingClient([], 2), recordingLedger(rows)).upsertFile('', itemWith(body));

    const recorded = rows.find((r) => r.contentHash);
    expect(recorded, 'nothing was recorded in the ledger').toBeDefined();
    // Three attempts, one digest, and it is the file's. A hasher carried
    // across attempts would have seen the bytes three times over.
    expect(recorded!.contentHash).toBe(fileContentHash(BYTES));
  });

  it('gives up after the attempts run out, without pretending the file landed', async () => {
    const puts: Put[] = [];
    const body = countingBody(BYTES);

    await expect(
      writerWith(lockingClient(puts, 99), recordingLedger([])).upsertFile('', itemWith(body)),
    ).rejects.toThrow(/500/);

    // The shared retry's five attempts (dav-retry.ts), each with its own body.
    expect(body.opens()).toBe(5);
  });

  it('does NOT re-read the source on a refusal that is not transient', async () => {
    // A 403 is the server's answer, not a request to come back. Re-opening
    // would spend a second metered download to be told the same thing.
    const puts: Put[] = [];
    const body = countingBody(BYTES);
    const client: HttpClient = {
      async request(options: HttpRequestOptions): Promise<HttpResponse> {
        if (options.method === 'PROPFIND') {
          return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
        }
        if (options.method !== 'PUT') return { status: 201, body: '', headers: {} };
        const b = options.body as ReadableStream<Uint8Array>;
        puts.push({ received: await readAll(b) });
        return { status: 403, body: '<d:error xmlns:d="DAV:"><s:exception>Forbidden</s:exception></d:error>', headers: {} };
      },
    };

    await expect(
      writerWith(client, recordingLedger([])).upsertFile('', itemWith(body)),
    ).rejects.toThrow(/403/);

    expect(body.opens()).toBe(1);
    expect(puts).toHaveLength(1);
  });
});
