// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE TOO LARGE FOR ONE REQUEST (workplan 0156; the owner's report of
 * 2026-10-03).
 *
 * A Dropbox migration into the demo Nextcloud parked its four largest files
 * after five tries each (1.3 GB twice, 2.1 GB, 4.5 GB), every one with
 *
 *   PUT failed for 2021/Nog uitzoeken Onedrive/VID_20211003_095021.mp4 with
 *   status 413: Sabre\DAV\Exception\BadRequest — Verwachte bestandsgrootte
 *   van 1401302831 bytes maar gelezen … 0 bytes
 *
 * under *"We could not classify this one"*, while a 1 GB VOB arrived. Every
 * file above 8 MB went up as ONE streamed PUT, and the demo's Apache takes a
 * request of at most 1 GiB (`APACHE_BODY_LIMIT`). Past that it withholds the
 * body, Sabre reads nothing, and the answer is a 413. Any Nextcloud behind a
 * limit on one request does the same: nginx's `client_max_body_size`, a CDN's
 * 100 MB.
 *
 * Nextcloud's own answer is its chunked upload, which nothing here spoke: a
 * `Content-Range` path existed that Sabre refuses on a PUT, needed the whole
 * file in memory, and no caller switched on. What these tests hold, against a
 * fake Nextcloud that keeps the protocol's rules as they were MEASURED on
 * nextcloud:34-apache (see `nextcloud-chunked-upload.ts`):
 *
 *  1. a file larger than one piece goes up as MKCOL, numbered PUTs and one
 *     MOVE, with the headers the manual names, and arrives byte for byte;
 *  2. a file of one piece or less, and every file on a target with no upload
 *     area, goes as the one PUT it always did — decided once, and said once;
 *  3. a create stays create-only, and a path taken in the meantime is adopted
 *     or refused exactly as the single PUT's 412 is;
 *  4. a rewrite carries our strong version where the server checks it;
 *  5. a failure leaves no file at the destination, removes the upload folder,
 *     and surfaces the error that stopped it;
 *  6. a transient answer to a piece retries the whole send, and the hash is
 *     the whole file's, read once per send;
 *  7. no piece is ever held: the source is never further ahead of the server
 *     than a few of its own chunks;
 *  8. a 413 says what it is, waits for a person, and is not tried again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';
import {
  fileContentHash,
  isDecisionError,
  statedFailureCategoryOf,
  type FileBody,
  type Ledger,
  type MappingId,
  type RawFileItem,
  type TenantId,
} from '@openmig/shared';

const TENANT = 'aa aa' as unknown as TenantId;
const MAPPING = 'bb bb' as unknown as MappingId;
const ORIGIN = 'https://cloud.example';
const FILES = `${ORIGIN}/remote.php/dav/files/alice`;
const UPLOADS = `${ORIGIN}/remote.php/dav/uploads/alice/`;
const EMPTY_LISTING = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>';

/** Small pieces, so a test crosses the line without a 64 MiB fixture. */
const PIECE = 1024;

/** A file's bytes, distinct at every offset so a piece in the wrong place shows. */
const bytesOf = (size: number): Uint8Array => new Uint8Array(size).map((_, i) => (i * 7 + (i >> 8)) % 251);

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A source body handed out in pieces of `step` bytes, made as they are read,
 * as a download's are. Counts its opens, and how many bytes it has produced.
 */
function streamedBody(
  content: Uint8Array,
  step = 256,
  options: { declared?: number } = {},
): FileBody & { opens: () => number; produced: () => number } {
  let opens = 0;
  let produced = 0;
  return {
    sizeBytes: options.declared ?? content.byteLength,
    open: async () => {
      opens += 1;
      let at = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= content.byteLength) {
            controller.close();
            return;
          }
          const piece = content.slice(at, Math.min(at + step, content.byteLength));
          at += piece.byteLength;
          produced += piece.byteLength;
          controller.enqueue(piece);
        },
      });
    },
    opens: () => opens,
    produced: () => produced,
  };
}

const itemOf = (path: string, body: FileBody, mimeType = 'video/mp4'): RawFileItem => ({
  item: {
    path,
    isDirectory: false,
    size: body.sizeBytes,
    modifiedAt: '2026-10-03T09:50:21Z',
    sourceRef: 'ref',
    mimeType,
  },
  body,
});

const readAll = async (stream: ReadableStream<Uint8Array>, onRead?: (n: number) => void): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onRead?.(value.byteLength);
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
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  /** Bytes the server read from the body, when there was one. */
  bytes?: number;
  streamed?: boolean;
  status?: number;
}

interface NextcloudOptions {
  /** Paths (root-relative, decoded) already on the target, as a file (with its ETag) or a directory. */
  readonly existing?: Record<string, { readonly etag: string } | 'dir'>;
  /** The answer to a MKCOL in the upload area. */
  readonly uploadsStatus?: number;
  /** The answer to piece `n` on send `attempt` (1-based); a thrown value is a broken request. */
  readonly piece?: (n: number, attempt: number) => number | Error | undefined;
  /** The answer to a single PUT among the files. */
  readonly singlePutStatus?: number;
  /** A 413 body, as Apache in front of Sabre sends it. */
  readonly refusalBody?: string;
}

/**
 * A Nextcloud, as far as a chunked upload goes, keeping the rules that were
 * measured (`nextcloud-chunked-upload.ts`): pieces live in the upload area
 * until a MOVE assembles them at the destination, `Overwrite: F` refuses a
 * taken path with 412, a tagged `If` is checked against the destination,
 * `OC-Total-Length` against what arrived, and the folder is gone after.
 */
function fakeNextcloud(options: NextcloudOptions = {}) {
  const sent: Sent[] = [];
  const files = new Map<string, { bytes?: Uint8Array; etag: string } | 'dir'>(
    Object.entries(options.existing ?? {}),
  );
  const uploads = new Map<string, Map<string, Uint8Array>>();
  const attemptsOfPiece = new Map<number, number>();
  let etags = 0;

  const pathOf = (url: string, base: string): string =>
    decodeURIComponent(url.slice(base.length).replace(/^\/+|\/+$/g, ''));

  const client: HttpClient = {
    async request(o: HttpRequestOptions): Promise<HttpResponse> {
      const call: Sent = { method: o.method, url: o.url, headers: (o.headers ?? {}) as Record<string, string> };
      sent.push(call);
      const answer = (status: number, headers: Record<string, string> = {}, body = ''): HttpResponse => {
        call.status = status;
        return { status, body, headers };
      };
      const take = async (): Promise<Uint8Array> => {
        call.streamed = o.body instanceof ReadableStream;
        const bytes =
          o.body instanceof ReadableStream
            ? await readAll(o.body)
            : o.body === undefined
              ? new Uint8Array(0)
              : typeof o.body === 'string'
                ? new TextEncoder().encode(o.body)
                : new Uint8Array(o.body);
        call.bytes = bytes.byteLength;
        return bytes;
      };

      if (o.url.startsWith(UPLOADS)) {
        const rest = o.url.slice(UPLOADS.length);
        const [transfer = '', name] = rest.split('/');
        if (o.method === 'MKCOL') {
          const status = options.uploadsStatus ?? 201;
          if (status === 201) uploads.set(transfer, new Map());
          return answer(status, {}, status === 201 ? '' : 'refused');
        }
        if (o.method === 'DELETE') {
          return answer(uploads.delete(transfer) ? 204 : 404);
        }
        const folder = uploads.get(transfer);
        if (!folder) return answer(404);
        if (o.method === 'PUT' && name !== undefined) {
          const n = Number(name);
          const attempt = (attemptsOfPiece.get(n) ?? 0) + 1;
          attemptsOfPiece.set(n, attempt);
          const planned = options.piece?.(n, attempt);
          if (planned instanceof Error) throw planned;
          const bytes = await take();
          if (planned !== undefined && planned !== 201) {
            return answer(planned, {}, options.refusalBody ?? `refused piece ${n}`);
          }
          folder.set(name, bytes);
          return answer(201);
        }
        if (o.method === 'MOVE' && name === '.file') {
          const destination = pathOf(call.headers.Destination ?? '', FILES);
          const held = files.get(destination);
          if (call.headers.Overwrite === 'F' && held !== undefined) return answer(412);
          const tagged = /^<([^>]*)> \(\[("[^"]*")\]\)$/.exec(call.headers.If ?? '');
          if (call.headers.If !== undefined) {
            if (!tagged || pathOf(tagged[1]!, FILES) !== destination) return answer(400);
            if (held === undefined) return answer(404);
            if (held === 'dir' || `"${held.etag}"` !== tagged[2]) return answer(412);
          }
          const names = [...folder.keys()].sort((a, b) => Number(a) - Number(b));
          const whole = new Uint8Array(names.reduce((n, k) => n + folder.get(k)!.byteLength, 0));
          let at = 0;
          for (const k of names) {
            whole.set(folder.get(k)!, at);
            at += folder.get(k)!.byteLength;
          }
          if (String(whole.byteLength) !== call.headers['OC-Total-Length']) return answer(400);
          etags += 1;
          const etag = `assembled-${etags}`;
          files.set(destination, { bytes: whole, etag });
          uploads.delete(transfer);
          return answer(held === undefined ? 201 : 204, { ETag: `"${etag}"`, 'OC-ETag': `"${etag}"` });
        }
        return answer(405);
      }

      const path = pathOf(o.url, FILES);
      if (o.method === 'PROPFIND') {
        if (call.headers.Depth === '1') return answer(207, {}, EMPTY_LISTING);
        const held = files.get(path);
        if (held === undefined) return answer(404);
        const type = held === 'dir' ? '<d:collection/>' : '';
        return answer(
          207,
          {},
          `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/alice/${path}</d:href>` +
            `<d:propstat><d:prop><d:resourcetype>${type}</d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`,
        );
      }
      if (o.method === 'MKCOL') return answer(201);
      if (o.method === 'HEAD') {
        const held = files.get(path);
        if (held === undefined) return answer(404);
        return answer(200, held === 'dir' ? {} : { ETag: `"${held.etag}"` });
      }
      if (o.method === 'PUT') {
        const bytes = await take();
        const status = options.singlePutStatus ?? 201;
        if (status !== 201) return answer(status, {}, options.refusalBody ?? 'refused');
        etags += 1;
        files.set(path, { bytes, etag: `single-${etags}` });
        return answer(201, { ETag: `"single-${etags}"` });
      }
      return answer(405);
    },
  };
  return {
    client,
    sent,
    files,
    uploads,
    of: (method: string, where: 'uploads' | 'files' = 'uploads') =>
      sent.filter((s) => s.method === method && s.url.startsWith(where === 'uploads' ? UPLOADS : FILES)),
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

const writerFor = (
  client: HttpClient,
  ledger: Ledger = recordingLedger([]),
  config: { url?: string; targetFolderPrefix?: string } = {},
): WebDAVTargetWriter =>
  new WebDAVTargetWriter(
    { url: config.url ?? FILES, username: 'alice', password: 'pw', uploadChunkBytes: PIECE, ...(config.targetFolderPrefix ? { targetFolderPrefix: config.targetFolderPrefix } : {}) },
    { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );

describe('a file larger than one piece goes up in pieces', () => {
  it('as MKCOL, numbered PUTs and one MOVE, with the headers the manual names', async () => {
    const nc = fakeNextcloud();
    const rows: Array<Record<string, unknown>> = [];
    const content = bytesOf(PIECE * 2 + 300);

    const result = await writerFor(nc.client, recordingLedger(rows)).upsertFile(
      '',
      itemOf('2021/Nog uitzoeken/VID #1.mp4', streamedBody(content)),
    );

    const destination = `${FILES}/2021/Nog%20uitzoeken/VID%20%231.mp4`;
    const [mkcol, ...rest] = nc.sent.filter((s) => s.url.startsWith(UPLOADS));
    expect(mkcol?.method).toBe('MKCOL');
    expect(mkcol?.url).toMatch(/^https:\/\/cloud\.example\/remote\.php\/dav\/uploads\/alice\/ownpace-[0-9a-f-]{36}$/);
    expect(mkcol?.headers.Destination).toBe(destination);
    const transfer = mkcol!.url;

    expect(rest.map((s) => `${s.method} ${s.url.slice(transfer.length)}`)).toEqual([
      'PUT /00001',
      'PUT /00002',
      'PUT /00003',
      'MOVE /.file',
    ]);
    const puts = rest.filter((s) => s.method === 'PUT');
    expect(puts.map((s) => s.headers['Content-Length'])).toEqual([String(PIECE), String(PIECE), '300']);
    expect(puts.map((s) => s.bytes)).toEqual([PIECE, PIECE, 300]);
    for (const put of puts) {
      expect(put.streamed, 'a piece was assembled in memory instead of streamed').toBe(true);
      expect(put.headers.Destination).toBe(destination);
      expect(put.headers['OC-Total-Length']).toBe(String(content.byteLength));
      expect(put.headers['Content-Type']).toBe('video/mp4');
    }
    const move = rest.at(-1)!;
    expect(move.headers.Destination).toBe(destination);
    expect(move.headers['OC-Total-Length']).toBe(String(content.byteLength));
    // Create-only: the MOVE's `If-None-Match: *`.
    expect(move.headers.Overwrite).toBe('F');
    expect(move.headers['X-OC-Mtime'], 'the single PUT sends no time, so neither does this').toBeUndefined();

    // Arrived whole, nothing left in the upload area, nothing to clean up.
    const landed = nc.files.get('2021/Nog uitzoeken/VID #1.mp4');
    expect(landed !== 'dir' && landed?.bytes).toEqual(content);
    expect(nc.uploads.size).toBe(0);
    expect(nc.of('DELETE')).toHaveLength(0);

    // Recorded as the single PUT records: created, the whole file's hash, the
    // version the MOVE answered with.
    expect(result).toEqual({ targetId: '2021/Nog uitzoeken/VID #1.mp4', created: true, targetVersion: 'assembled-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contentHash).toBe(fileContentHash(content));
    expect(rows[0]!.targetVersion).toBe('assembled-1');
    expect(rows[0]!.sizeBytes).toBe(content.byteLength);
  });

  it('reads the file once', async () => {
    const nc = fakeNextcloud();
    const body = streamedBody(bytesOf(PIECE * 3));
    await writerFor(nc.client).upsertFile('', itemOf('big.bin', body));
    expect(body.opens()).toBe(1);
  });

  it('sends a file the source handed over whole through the same pieces', async () => {
    const nc = fakeNextcloud();
    const rows: Array<Record<string, unknown>> = [];
    const content = bytesOf(PIECE * 2 + 1);
    await writerFor(nc.client, recordingLedger(rows)).upsertFile('', {
      item: { path: 'scan.pdf', isDirectory: false, size: content.byteLength, modifiedAt: '', sourceRef: 'r' },
      content,
    });
    expect(nc.of('PUT').map((s) => s.bytes)).toEqual([PIECE, PIECE, 1]);
    expect(rows[0]!.contentHash).toBe(fileContentHash(content));
  });

  it('puts the destination under targetFolderPrefix, and the upload area where the account has it', async () => {
    const nc = fakeNextcloud();
    await writerFor(nc.client, undefined, { targetFolderPrefix: 'Dropbox' }).upsertFile(
      '',
      itemOf('a/clip.mp4', streamedBody(bytesOf(PIECE + 1))),
    );
    const move = nc.of('MOVE')[0]!;
    expect(move.headers.Destination).toBe(`${FILES}/Dropbox/a/clip.mp4`);
    expect(move.url.startsWith(UPLOADS)).toBe(true);
    expect(nc.files.has('Dropbox/a/clip.mp4')).toBe(true);
  });

  it('only above one piece: a file of exactly one piece goes as one PUT', async () => {
    const one = fakeNextcloud();
    await writerFor(one.client).upsertFile('', itemOf('one.bin', streamedBody(bytesOf(PIECE))));
    expect(one.of('MKCOL')).toHaveLength(0);
    expect(one.of('PUT', 'files').map((s) => s.bytes)).toEqual([PIECE]);

    const over = fakeNextcloud();
    await writerFor(over.client).upsertFile('', itemOf('over.bin', streamedBody(bytesOf(PIECE + 1))));
    expect(over.of('PUT').map((s) => s.bytes)).toEqual([PIECE, 1]);
    expect(over.of('PUT', 'files')).toHaveLength(0);
  });
});

describe('a target with no upload area', () => {
  it('a URL that is not Nextcloud\'s files shape: one PUT, as before, and said once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sent: Sent[] = [];
    const client: HttpClient = {
      async request(o): Promise<HttpResponse> {
        sent.push({ method: o.method, url: o.url, headers: (o.headers ?? {}) as Record<string, string> });
        if (o.body instanceof ReadableStream) await readAll(o.body);
        if (o.method === 'PROPFIND') return { status: 207, body: EMPTY_LISTING, headers: {} };
        return { status: 201, body: '', headers: { ETag: '"one"' } };
      },
    };
    const writer = writerFor(client, undefined, { url: 'https://dav.example/webdav' });
    await writer.upsertFile('', itemOf('a.bin', streamedBody(bytesOf(PIECE * 2))));
    await writer.upsertFile('', itemOf('b.bin', streamedBody(bytesOf(PIECE * 2))));

    expect(sent.some((s) => s.url.includes('/uploads/')), 'something went to an upload area').toBe(false);
    expect(sent.filter((s) => s.method === 'PUT').map((s) => s.url)).toEqual([
      'https://dav.example/webdav/a.bin',
      'https://dav.example/webdav/b.bin',
    ]);
    const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('in one request'));
    expect(said, 'the fallback was not said, or was said for every file').toHaveLength(1);
    expect(said[0]).toMatch(/not Nextcloud's/);
  });

  for (const status of [404, 405, 409, 501]) {
    it(`an upload area that answers MKCOL with ${status}: one PUT, decided once and said once`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const nc = fakeNextcloud({ uploadsStatus: status });
      const writer = writerFor(nc.client);
      await writer.upsertFile('', itemOf('a.bin', streamedBody(bytesOf(PIECE * 2))));
      await writer.upsertFile('', itemOf('b.bin', streamedBody(bytesOf(PIECE * 2))));

      // Asked by the first file only: one upload folder was ever named (a
      // 501 is retried as every 5xx is, `dav-retry.ts`), and the second file
      // does not ask again.
      expect(new Set(nc.of('MKCOL').map((s) => s.url)).size).toBe(1);
      expect(nc.of('PUT', 'files').map((s) => s.bytes)).toEqual([PIECE * 2, PIECE * 2]);
      expect(nc.files.has('a.bin') && nc.files.has('b.bin')).toBe(true);
      const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('in one request'));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain(`MKCOL with ${status}`);
    });
  }

  it('an upload area that refuses for any other reason fails the file, verbatim', async () => {
    const nc = fakeNextcloud({ uploadsStatus: 401 });
    await expect(
      writerFor(nc.client).upsertFile('', itemOf('a.bin', streamedBody(bytesOf(PIECE * 2)))),
    ).rejects.toThrow(/MKCOL of the upload folder answered 401: refused/);
    expect(nc.of('PUT', 'files'), 'a refusal was taken for "unsupported"').toHaveLength(0);
  });
});

describe('the same answers as the single PUT', () => {
  it('a path taken since the listing is adopted, never replaced, and the pieces are removed', async () => {
    // The listing said the folder was empty; by the MOVE a file is there.
    const nc = fakeNextcloud({ existing: { 'clip.mp4': { etag: 'theirs' } } });
    const rows: Array<Record<string, unknown>> = [];

    const result = await writerFor(nc.client, recordingLedger(rows)).upsertFile(
      '',
      itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 2))),
    );

    expect(nc.of('MOVE')[0]!.status).toBe(412);
    expect(result).toEqual({ targetId: 'clip.mp4', created: false, adopted: true });
    expect(rows[0]!.status).toBe('adopted');
    const held = nc.files.get('clip.mp4');
    expect(held !== 'dir' && held?.etag, 'the file already there was replaced').toBe('theirs');
    expect(nc.of('DELETE')).toHaveLength(1);
    expect(nc.uploads.size).toBe(0);
  });

  it('a DIRECTORY at the path is refused, as the single PUT refuses it', async () => {
    const nc = fakeNextcloud({ existing: { 'clip.mp4': 'dir' } });
    await expect(
      writerFor(nc.client).upsertFile('', itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 2)))),
    ).rejects.toThrow(/DIRECTORY at that path/);
    expect(nc.of('DELETE')).toHaveLength(1);
  });

  it('a rewrite carries our strong version on the MOVE, where the server checks the destination', async () => {
    const nc = fakeNextcloud({ existing: { 'clip.mp4': { etag: 'ours' } } });
    const content = bytesOf(PIECE * 2);
    const result = await writerFor(nc.client).upsertFile('', itemOf('clip.mp4', streamedBody(content)), {
      overwrite: true,
      expectedTargetVersion: 'ours',
    });

    const move = nc.of('MOVE')[0]!;
    expect(move.headers.If).toBe(`<${FILES}/clip.mp4> (["ours"])`);
    expect(move.headers.Overwrite, 'a rewrite replaces').toBeUndefined();
    expect(move.headers['If-Match'], 'If-Match on this MOVE is checked against .file').toBeUndefined();
    expect(nc.of('HEAD', 'files'), 'a strong version needs no read first').toHaveLength(0);
    expect(result).toEqual({ targetId: 'clip.mp4', created: false, updated: true, targetVersion: 'assembled-1' });
    const held = nc.files.get('clip.mp4');
    expect(held !== 'dir' && held?.bytes).toEqual(content);
  });

  it("a rewrite over the owner's edit is a conflict, and nothing is assembled", async () => {
    const nc = fakeNextcloud({ existing: { 'clip.mp4': { etag: 'their-edit' } } });
    const result = await writerFor(nc.client).upsertFile('', itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 2))), {
      overwrite: true,
      expectedTargetVersion: 'ours',
    });
    expect(result).toEqual({ targetId: 'clip.mp4', created: false, conflicted: true });
    const held = nc.files.get('clip.mp4');
    expect(held !== 'dir' && held?.etag).toBe('their-edit');
    expect(nc.of('DELETE')).toHaveLength(1);
  });

  it('a rewrite of a file the owner removed is a conflict too, as If-Match makes it', async () => {
    const nc = fakeNextcloud();
    const result = await writerFor(nc.client).upsertFile('', itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 2))), {
      overwrite: true,
      expectedTargetVersion: 'ours',
    });
    expect(nc.of('MOVE')[0]!.status).toBe(404);
    expect(result.conflicted).toBe(true);
    expect(nc.files.has('clip.mp4'), 'the removed file was put back').toBe(false);
  });
});

describe('a failure part way', () => {
  it('a refused piece: no MOVE, the upload folder removed, the refusal surfaced', async () => {
    const nc = fakeNextcloud({
      piece: (n) => (n === 2 ? 403 : undefined),
      refusalBody:
        '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
        '<s:exception>Sabre\\DAV\\Exception\\Forbidden</s:exception><s:message>Read-only share</s:message></d:error>',
    });
    await expect(
      writerFor(nc.client).upsertFile('', itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 3)))),
    ).rejects.toThrow(
      'PUT failed for clip.mp4 (piece 2 of 3, 1024 bytes, Nextcloud chunked upload) with status 403: ' +
        'Sabre\\DAV\\Exception\\Forbidden — Read-only share',
    );
    expect(nc.of('MOVE')).toHaveLength(0);
    expect(nc.of('PUT')).toHaveLength(2);
    expect(nc.of('DELETE')).toHaveLength(1);
    expect(nc.uploads.size).toBe(0);
    expect(nc.files.has('clip.mp4'), 'a partial file reached the destination').toBe(false);
  });

  it('a request that breaks: the same error, unchanged, and the folder removed', async () => {
    const broken = new TypeError('fetch failed');
    const nc = fakeNextcloud({ piece: (n) => (n === 2 ? broken : undefined) });
    const failure = await writerFor(nc.client)
      .upsertFile('', itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 3))))
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    expect(failure, 'the error was replaced on the way out').toBe(broken);
    expect(nc.of('DELETE')).toHaveLength(1);
    expect(nc.files.has('clip.mp4')).toBe(false);
  });

  it('a source that ends early: its own sentence, and nothing assembled', async () => {
    const nc = fakeNextcloud();
    await expect(
      writerFor(nc.client).upsertFile(
        '',
        itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 2), 256, { declared: PIECE * 3 })),
      ),
    ).rejects.toThrow(/the source ended 1024 bytes before the size it declared/);
    expect(nc.of('MOVE')).toHaveLength(0);
    expect(nc.of('DELETE')).toHaveLength(1);
  });

  it('a source that holds more than it declared is refused before the assembly', async () => {
    const nc = fakeNextcloud();
    await expect(
      writerFor(nc.client).upsertFile(
        '',
        itemOf('clip.mp4', streamedBody(bytesOf(PIECE * 3), 256, { declared: PIECE * 2 })),
      ),
    ).rejects.toThrow(/sent more than the 2048 bytes it declared/);
    expect(nc.of('MOVE')).toHaveLength(0);
    expect(nc.files.has('clip.mp4')).toBe(false);
  });

  it('a transient answer to a piece sends every piece again from a fresh read', async () => {
    // Nextcloud's lock (dav-retry.ts), on the second piece of the first send.
    const nc = fakeNextcloud({ piece: (n, attempt) => (n === 2 && attempt === 1 ? 503 : undefined) });
    const rows: Array<Record<string, unknown>> = [];
    const content = bytesOf(PIECE * 2 + 10);
    const body = streamedBody(content);

    await writerFor(nc.client, recordingLedger(rows)).upsertFile('', itemOf('clip.mp4', body));

    expect(body.opens(), 'the second send read the source again').toBe(2);
    expect(nc.of('PUT').map((s) => s.url.slice(-5))).toEqual(['00001', '00002', '00001', '00002', '00003']);
    expect(nc.of('MKCOL'), 'one upload, not two').toHaveLength(1);
    const held = nc.files.get('clip.mp4');
    expect(held !== 'dir' && held?.bytes).toEqual(content);
    // One digest, of the file, from the send that was accepted.
    expect(rows[0]!.contentHash).toBe(fileContentHash(content));
  });
});

describe('no piece is ever held', () => {
  it('the source is never more than a few of its own chunks ahead of the server', async () => {
    // 64 KiB from the source at a time, 1 MiB pieces, 5.5 MiB in all. A piece
    // assembled before its request would put the source a whole piece ahead
    // of what the server has read.
    const step = 64 * 1024;
    const pieceBytes = 1024 * 1024;
    const content = bytesOf(5.5 * pieceBytes);
    const body = streamedBody(content, step);
    let received = 0;
    let furthestAhead = 0;
    const client: HttpClient = {
      async request(o) {
        if (o.body instanceof ReadableStream) {
          await readAll(o.body, (n) => {
            received += n;
            furthestAhead = Math.max(furthestAhead, body.produced() - received);
          });
        }
        if (o.method === 'PROPFIND') return { status: 207, body: EMPTY_LISTING, headers: {} };
        return { status: 201, body: '', headers: {} };
      },
    };
    const writer = new WebDAVTargetWriter(
      { url: FILES, username: 'alice', password: 'pw', uploadChunkBytes: pieceBytes },
      { ledger: recordingLedger([]), tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    await writer.upsertFile('', itemOf('big.mp4', body));

    expect(received).toBe(content.byteLength);
    expect(
      furthestAhead,
      `the source ran ${furthestAhead} bytes ahead of the server; a piece is ${pieceBytes}`,
    ).toBeLessThanOrEqual(4 * step);
  });
});

describe('a 413, said as what it is', () => {
  const APACHE_AND_SABRE =
    '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>413 Request Entity Too Large</title>' +
    '</head><body><h1>Request Entity Too Large</h1></body></html>\n<?xml version="1.0" encoding="utf-8"?>' +
    '<d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:exception>Sabre\\DAV\\Exception\\BadRequest' +
    '</s:exception><s:message>Expected filesize of 1401302831 bytes but read (from Nextcloud client) and wrote ' +
    '(to Nextcloud storage) 0 bytes.</s:message></d:error>';

  it('on the single PUT: the size, the limit, the target, and a person rather than four more tries', async () => {
    const nc = fakeNextcloud({ singlePutStatus: 413, refusalBody: APACHE_AND_SABRE });
    const failure = await writerFor(nc.client)
      .upsertFile('', itemOf('2021/VID_20211003_095021.mp4', streamedBody(bytesOf(PIECE))))
      .then(
        () => undefined,
        (err: unknown) => err as Error,
      );
    expect(failure).toBeInstanceOf(Error);
    expect(failure!.message).toMatch(/^PUT failed for 2021\/VID_20211003_095021\.mp4 with status 413: /);
    expect(failure!.message).toContain('this 1.0 KB file (1024 bytes) in one request');
    expect(failure!.message).toContain('LimitRequestBody');
    expect(failure!.message).toContain('APACHE_BODY_LIMIT');
    // The server's own words, as `davRefusalBody` reads Sabre's document.
    expect(failure!.message).toContain('Sabre\\DAV\\Exception\\BadRequest — Expected filesize of 1401302831 bytes');
    expect(statedFailureCategoryOf(failure)).toBe('target_refused');
    expect(isDecisionError(failure), 'a limit answers the same on every pass').toBe(true);
    expect(nc.of('PUT', 'files'), 'retried, as if a limit were transient').toHaveLength(1);
  });

  it('on a piece: names the piece, and an HTML page by its title', async () => {
    const nc = fakeNextcloud({
      piece: () => 413,
      refusalBody: '<html><head><title>413 Request Entity Too Large</title></head><body>…</body></html>',
    });
    const failure = await writerFor(nc.client)
      .upsertFile('', itemOf('big.mp4', streamedBody(bytesOf(PIECE * 3))))
      .then(
        () => undefined,
        (err: unknown) => err as Error,
      );
    expect(failure!.message).toContain('(piece 1 of 3, Nextcloud chunked upload) with status 413');
    expect(failure!.message).toContain('one 1.0 KB piece of this 3.0 KB file');
    expect(failure!.message).toContain('The server said: 413 Request Entity Too Large (an HTML error page)');
    expect(statedFailureCategoryOf(failure)).toBe('target_refused');
    expect(isDecisionError(failure)).toBe(true);
    expect(nc.of('DELETE')).toHaveLength(1);
  });

  it('on a target with no upload area, says the file has to fit in one request', async () => {
    const nc = fakeNextcloud({ uploadsStatus: 404, singlePutStatus: 413 });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      writerFor(nc.client).upsertFile('', itemOf('big.mp4', streamedBody(bytesOf(PIECE * 3)))),
    ).rejects.toThrow(/does not take a file in pieces, so the whole file has to fit in one request/);
  });
});

describe('through the real fetch', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  it('a 72 MiB file in 16 MiB pieces holds less than half a piece while it is under way', async () => {
    // The memory half of `an-upload-that-kept-every-byte`, for pieces: what
    // is still referenced three quarters in, after full collections. A piece
    // read into memory before its request would hold 16 MiB here.
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const pieceBytes = 16 * 1024 * 1024;
    const size = 72 * 1024 * 1024;
    const methods: string[] = [];

    let received = 0;
    let heldMidway: number | undefined;
    server = createServer((req, res) => {
      methods.push(`${req.method} ${req.url}`);
      req.on('data', (chunk: Buffer) => {
        if (req.method !== 'PUT') return;
        received += chunk.byteLength;
        if (heldMidway === undefined && received >= (size * 3) / 4) {
          heldMidway = -1;
          req.pause();
          void (async () => {
            await new Promise((settle) => setTimeout(settle, 50));
            gc();
            await new Promise((settle) => setImmediate(settle));
            gc();
            heldMidway = process.memoryUsage().arrayBuffers;
            req.resume();
          })();
        }
      });
      req.on('end', () => {
        if (req.method === 'PROPFIND') {
          res.writeHead(207, { 'content-type': 'application/xml' });
          res.end(EMPTY_LISTING);
          return;
        }
        if (req.method === 'MOVE') {
          res.writeHead(201, { etag: '"assembled"' });
          res.end();
          return;
        }
        res.writeHead(201);
        res.end();
      });
    });
    await new Promise<void>((listening) => server!.listen(0, '127.0.0.1', () => listening()));
    const { port } = server.address() as AddressInfo;
    const writer = new WebDAVTargetWriter(
      { url: `http://127.0.0.1:${port}/remote.php/dav/files/u`, username: 'u', password: 'p', uploadChunkBytes: pieceBytes },
      {
        ledger: { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
      },
    );
    const body: FileBody = {
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
    };

    gc();
    const before = process.memoryUsage().arrayBuffers;
    const written = await writer.upsertFile('', itemOf('Videos/clip.mp4', body));

    expect(written).toMatchObject({ created: true, targetVersion: 'assembled' });
    expect(received, 'the server did not receive the whole file').toBe(size);
    expect(methods.filter((m) => m.startsWith('PUT ')).map((m) => m.slice(-5))).toEqual([
      '00001',
      '00002',
      '00003',
      '00004',
      '00005',
    ]);
    expect(methods.at(-1)).toMatch(/^MOVE \/remote\.php\/dav\/uploads\/u\/ownpace-[0-9a-f-]+\/\.file$/);
    expect(heldMidway, 'the upload was never read three quarters in').toBeGreaterThanOrEqual(0);
    expect(
      heldMidway! - before,
      `${Math.round((heldMidway! - before) / 1048576)} MiB was held three quarters in; a piece is 16 MiB`,
    ).toBeLessThan(pieceBytes / 2);
  });
});
