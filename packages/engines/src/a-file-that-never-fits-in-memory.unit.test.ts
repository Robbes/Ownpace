// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A file crosses from source to target without anybody holding it.
 *
 * ## The ceiling, and where it lived
 *
 * A file used to exist as a `Uint8Array` at three points at once: the source
 * read it whole, the loop carried it, the target hashed it and built a request
 * body from it. Three copies of one file per item in flight, `concurrency`
 * items at a time — so the largest file a migration could move was decided by
 * the runner's RAM. Crossing that did not fail the item: it killed the
 * process, mid-pass, with no failure-queue row and no sentence.
 *
 * ## What is asserted
 *
 * The properties an implementation cannot fake:
 *
 *  - the PUT's body is a stream, not bytes — the target never assembles it;
 *  - the hash the ledger records is the hash of the actual bytes, computed as
 *    they passed, and equals what the buffered path would have produced;
 *  - the bytes arrive intact and in order (a hasher spliced into a stream is
 *    exactly where an off-by-one silently corrupts every file);
 *  - the file is read ONCE. A second read would double a metered download
 *    (0090's daily ceiling) for one file.
 */

import { describe, it, expect } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';
import { fileContentHash, bodyOfBytes, type RawFileItem } from '@openmig/shared';
import type { Ledger, MappingId, TenantId } from '@openmig/shared';

const TENANT = 'aa aa' as unknown as TenantId;
const MAPPING = 'bb bb' as unknown as MappingId;

/** 3 MB in 64 KB pieces — several chunks, so a one-chunk implementation fails. */
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

interface Sent {
  method: string;
  streamed: boolean;
  received?: Uint8Array;
  contentLength?: string;
}

function recordingClient(sent: Sent[]): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      const streamed = options.body instanceof ReadableStream;
      const entry: Sent = {
        method: options.method,
        streamed,
        ...(options.headers?.['Content-Length']
          ? { contentLength: options.headers['Content-Length'] }
          : {}),
      };
      // The server reads the body, which is what makes the source stream flow
      // and the hasher see every byte — exactly what a real PUT does.
      if (streamed) {
        entry.received = await readAll(options.body as ReadableStream<Uint8Array>);
      }
      sent.push(entry);
      if (options.method === 'PROPFIND') {
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      }
      return { status: 201, body: '', headers: { etag: '"written"' } };
    },
  };
}

/** Just enough ledger for the write path: nothing known, records accepted. */
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

describe('a streamed file reaches the target without being assembled', () => {
  it('sends the bytes as a stream, and they arrive intact', async () => {
    const sent: Sent[] = [];
    const rows: Array<Record<string, unknown>> = [];
    const raw: RawFileItem = {
      item: {
        path: 'Docs/big.bin',
        isDirectory: false,
        size: BYTES.byteLength,
        modifiedAt: new Date().toISOString(),
        sourceRef: 'ref',
      },
      body: bodyOfBytes(BYTES),
    };

    await writerWith(recordingClient(sent), recordingLedger(rows)).upsertFile('', raw);

    const put = sent.find((s) => s.method === 'PUT');
    expect(put, 'no PUT was sent').toBeDefined();
    expect(put!.streamed, 'the body was assembled instead of streamed').toBe(true);
    expect(put!.received, 'the server received nothing').toEqual(BYTES);
  });

  it('declares the length the source promised', async () => {
    // Without it the request is chunked transfer-encoded: some DAV servers
    // refuse it outright, others accept it and then report a size of zero.
    const sent: Sent[] = [];
    const raw: RawFileItem = {
      item: {
        path: 'Docs/big.bin',
        isDirectory: false,
        size: BYTES.byteLength,
        modifiedAt: new Date().toISOString(),
        sourceRef: 'ref',
      },
      body: bodyOfBytes(BYTES),
    };

    await writerWith(recordingClient(sent), recordingLedger([])).upsertFile('', raw);

    const put = sent.find((s) => s.method === 'PUT');
    expect(put?.contentLength, 'the streamed PUT declared no Content-Length').toBe(
      String(BYTES.byteLength),
    );
  });

  it('records the hash of what actually crossed', async () => {
    const sent: Sent[] = [];
    const rows: Array<Record<string, unknown>> = [];
    const raw: RawFileItem = {
      item: {
        path: 'Docs/big.bin',
        isDirectory: false,
        size: BYTES.byteLength,
        modifiedAt: new Date().toISOString(),
        sourceRef: 'ref',
      },
      body: bodyOfBytes(BYTES),
    };

    await writerWith(recordingClient(sent), recordingLedger(rows)).upsertFile('', raw);

    const recorded = rows.find((r) => r.contentHash);
    expect(recorded, 'nothing was recorded in the ledger').toBeDefined();
    // The same answer the buffered path gives. A hasher spliced into a stream
    // is exactly where an off-by-one corrupts every file silently, and this is
    // the assertion that cannot pass if it does.
    expect(recorded!.contentHash).toBe(fileContentHash(BYTES));
    expect(recorded!.sizeBytes).toBe(BYTES.byteLength);
  });

  it('reads the file once', async () => {
    // A second read doubles a metered download (0090's daily ceiling) for one
    // file. The write path must take its hash from the bytes going past, not
    // from a pass of its own.
    let opens = 0;
    const body = bodyOfBytes(BYTES);
    const counted = {
      sizeBytes: body.sizeBytes,
      open: async () => {
        opens += 1;
        return body.open();
      },
    };
    const raw: RawFileItem = {
      item: {
        path: 'Docs/big.bin',
        isDirectory: false,
        size: BYTES.byteLength,
        modifiedAt: new Date().toISOString(),
        sourceRef: 'ref',
      },
      body: counted,
    };

    await writerWith(recordingClient([]), recordingLedger([])).upsertFile('', raw);
    expect(opens, 'the file was read more than once').toBe(1);
  });
});
