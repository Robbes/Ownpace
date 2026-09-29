// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JMAP FILE NOTHING HOLDS (workplan 0143 T3b).
 *
 * A source reads a file larger than `STREAM_FILES_LARGER_THAN_BYTES` (8 MB) as
 * a `FileBody`: a size, and a way to read the bytes that nothing holds whole.
 * The JMAP file target could not send one, so it refused every file above
 * 8 MB (T3a), on the target the alpha calls primary. Now the stream goes out
 * as the upload's body.
 *
 * What this holds:
 *
 *  1. A 32 MB body arrives at the upload endpoint byte for byte, with its
 *     length, sent as a stream: the target never makes the file's bytes into
 *     one buffer (there is no `content` to make them from), and asks fetch not
 *     to keep a copy either (`redirect: 'error'`).
 *  2. A retry opens the body afresh, so the attempt the server accepts sends
 *     the whole file.
 *  3. A rewrite of a copy already there sends the stream the same way.
 *  4. A file larger than the server's own `maxSizeUpload` is refused before a
 *     byte is read or a folder is made, in a sentence that names the server's
 *     limit, stated as the target's answer and waiting for a person. A server
 *     that states no limit is not second-guessed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { RawFileItem } from '@openmig/shared';
import { isDecisionError, statedFailureCategoryOf } from '@openmig/shared';
import { JmapFileTarget } from './jmap-file-target.ts';

const MB = 1024 * 1024;
const SIZE = 32 * MB;
/** The chunk a source hands the stream, as a download would. */
const CHUNK = MB;

/** The byte at `offset` of the stub file: never all zeroes, never periodic at a chunk. */
const byteAt = (offset: number): number => (offset * 31 + (offset >>> 13)) & 0xff;

function chunkAt(offset: number, length: number): Uint8Array {
  const chunk = new Uint8Array(length);
  for (let i = 0; i < length; i++) chunk[i] = byteAt(offset + i);
  return chunk;
}

/** The digest of the whole stub file, computed a chunk at a time. */
const EXPECTED = (() => {
  const hash = createHash('sha256');
  for (let offset = 0; offset < SIZE; offset += CHUNK) hash.update(chunkAt(offset, Math.min(CHUNK, SIZE - offset)));
  return hash.digest('hex');
})();

/** A stub source's body: generated a chunk at a time, and counting its opens. */
function streamedBody(sizeBytes = SIZE): { body: RawFileItem['body'] & object; opens: () => number } {
  let opens = 0;
  return {
    opens: () => opens,
    body: {
      sizeBytes,
      open: async () => {
        opens += 1;
        let offset = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= sizeBytes) {
              controller.close();
              return;
            }
            const length = Math.min(CHUNK, sizeBytes - offset);
            controller.enqueue(chunkAt(offset, length));
            offset += length;
          },
        });
      },
    },
  };
}

function streamed(path: string, body: RawFileItem['body']): RawFileItem {
  return {
    item: {
      path,
      isDirectory: false,
      size: body!.sizeBytes,
      modifiedAt: '2026-09-29T01:00:00.000Z',
      mimeType: 'video/quicktime',
      sourceRef: `id:${path}`,
    },
    body,
  };
}

/** What the fake upload endpoint saw of one request. */
interface Upload {
  readonly asStream: boolean;
  readonly duplex: unknown;
  readonly redirect: unknown;
  readonly contentLength: string | undefined;
  readonly contentType: string | undefined;
  readonly bytes: number;
  readonly sha256: string;
}

let session: Record<string, unknown>;
let uploads: Upload[];
let methods: string[];
/** How the next uploads answer, first to last; then 200. */
let uploadAnswers: Array<() => Response>;
/** The fake store: node id -> node. */
let nodes: Map<string, Record<string, unknown>>;

function target(): JmapFileTarget {
  return new JmapFileTarget({ baseUrl: 'http://jmap.test', username: 'target@dev.local', password: 'pw' });
}

beforeEach(() => {
  session = {
    accounts: { acct: { email: 'target@dev.local' } },
    primaryAccounts: { 'urn:ietf:params:jmap:filenode': 'acct' },
    capabilities: { 'urn:ietf:params:jmap:core': { maxSizeUpload: 50_000_000 } },
  };
  uploads = [];
  methods = [];
  uploadAnswers = [];
  nodes = new Map();

  vi.stubGlobal('fetch', async (url: string, init: RequestInit & { duplex?: unknown }) => {
    if (url.includes('/.well-known/jmap')) {
      return new Response(JSON.stringify(session), { status: 200 });
    }
    if (url.includes('/upload/')) {
      const answer = uploadAnswers.shift();
      if (answer) return answer();
      const headers = (init.headers ?? {}) as Record<string, string>;
      // Read the way a server reads a request: a chunk at a time, keeping a
      // digest and a count, never the file.
      const hash = createHash('sha256');
      let bytes = 0;
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        bytes += value.byteLength;
      }
      uploads.push({
        asStream: init.body instanceof ReadableStream,
        duplex: init.duplex,
        redirect: init.redirect,
        contentLength: headers['Content-Length'],
        contentType: headers['Content-Type'],
        bytes,
        sha256: hash.digest('hex'),
      });
      return new Response(JSON.stringify({ blobId: `uploaded-${uploads.length}` }), { status: 200 });
    }

    const body = JSON.parse(String(init.body)) as { methodCalls: Array<[string, Record<string, unknown>, string]> };
    const [method, args] = body.methodCalls[0]!;
    methods.push(method);
    let result: unknown;
    if (method === 'FileNode/get') {
      const ids = args.ids as string[] | null;
      result = { list: ids === null ? [...nodes.values()] : ids.flatMap((id) => (nodes.has(id) ? [nodes.get(id)] : [])) };
    } else if (method === 'FileNode/set') {
      const created: Record<string, { id: string }> = {};
      for (const [key, value] of Object.entries((args.create ?? {}) as Record<string, Record<string, unknown>>)) {
        const id = `n${nodes.size + 1}`;
        nodes.set(id, { id, nodeType: value.blobId ? 'file' : 'directory', size: SIZE, ...value, blobId: `stored-${id}` });
        created[key] = { id };
      }
      for (const [id, value] of Object.entries((args.update ?? {}) as Record<string, Record<string, unknown>>)) {
        nodes.set(id, { ...nodes.get(id), ...value, blobId: `stored-again-${id}` });
      }
      result = { created, updated: Object.fromEntries(Object.keys((args.update ?? {}) as object).map((id) => [id, null])) };
    } else {
      throw new Error(`the fake has no answer for ${method}`);
    }
    return new Response(JSON.stringify({ methodResponses: [[method, result, 'c1']] }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a file handed over as a stream', () => {
  it('arrives byte for byte, with its length, sent as a stream fetch keeps no copy of', async () => {
    const { body, opens } = streamedBody();

    const result = await target().upsertFile('', streamed('holiday.mov', body));

    expect(result.created).toBe(true);
    expect(opens()).toBe(1);
    expect(uploads).toEqual([
      {
        asStream: true,
        duplex: 'half',
        redirect: 'error',
        contentLength: String(SIZE),
        contentType: 'video/quicktime',
        bytes: SIZE,
        sha256: EXPECTED,
      },
    ]);
    // The node is made with the blob that upload returned.
    const made = [...nodes.values()].find((n) => n.name === 'holiday.mov');
    expect(made?.type).toBe('video/quicktime');
  });

  it('is opened afresh for a retry, so the attempt the server takes sends the whole file', async () => {
    uploadAnswers = [() => new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } })];
    const { body, opens } = streamedBody();

    await target().upsertFile('', streamed('holiday.mov', body));

    expect(opens()).toBe(2);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ bytes: SIZE, sha256: EXPECTED });
  });

  it('rewrites a copy already there the same way', async () => {
    nodes.set('f1', { id: 'f1', name: 'holiday.mov', parentId: null, nodeType: 'file', blobId: 'stored-f1', size: 1 });
    const { body } = streamedBody();

    const result = await target().upsertFile('', streamed('holiday.mov', body), { overwrite: true });

    expect(result).toMatchObject({ targetId: 'f1', updated: true });
    expect(uploads).toEqual([expect.objectContaining({ asStream: true, bytes: SIZE, sha256: EXPECTED })]);
    expect(nodes.get('f1')?.blobId).toBe('stored-again-f1');
  });
});

describe('a file larger than the server takes in one upload', () => {
  const SENTENCE =
    'Videos/holiday.mov is 32.0 MB. This JMAP server takes files up to 16.0 MB in one upload, so it ' +
    'would refuse this one. Nothing was copied and nothing was changed; every other file continues. ' +
    "Raise the server's upload limit, or copy this file to a WebDAV target, such as Nextcloud.";

  it('is refused before a byte is read or a folder is made, as the target’s answer, for a person', async () => {
    session.capabilities = { 'urn:ietf:params:jmap:core': { maxSizeUpload: 16 * MB } };
    const { body, opens } = streamedBody();

    const refused = await target()
      .upsertFile('', streamed('Videos/holiday.mov', body))
      .then(() => undefined, (error: unknown) => error);

    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toBe(SENTENCE);
    expect(statedFailureCategoryOf(refused)).toBe('target_refused');
    expect(isDecisionError(refused)).toBe(true);
    expect(opens()).toBe(0);
    expect(uploads).toHaveLength(0);
    expect(methods).not.toContain('FileNode/set');
  });

  it('holds for bytes the source already read', async () => {
    session.capabilities = { 'urn:ietf:params:jmap:core': { maxSizeUpload: MB } };
    const raw: RawFileItem = {
      item: { path: 'notes.txt', isDirectory: false, size: 2 * MB, modifiedAt: '2026-09-29T01:00:00.000Z', sourceRef: 'id:n' },
      content: new Uint8Array(2 * MB).fill(7),
    };

    await expect(target().upsertFile('', raw)).rejects.toThrow(
      /^notes\.txt is 2\.0 MB\. This JMAP server takes files up to 1\.0 MB in one upload/,
    );
    expect(uploads).toHaveLength(0);
  });

  it('refuses a rewrite too, and leaves the copy there as it was', async () => {
    session.capabilities = { 'urn:ietf:params:jmap:core': { maxSizeUpload: 16 * MB } };
    nodes.set('f1', { id: 'f1', name: 'holiday.mov', parentId: null, nodeType: 'file', blobId: 'stored-f1', size: 1 });
    const { body, opens } = streamedBody();

    await expect(
      target().upsertFile('', streamed('holiday.mov', body), { overwrite: true }),
    ).rejects.toThrow(/^holiday\.mov is 32\.0 MB\. This JMAP server takes files up to 16\.0 MB in one upload/);
    expect(opens()).toBe(0);
    expect(uploads).toHaveLength(0);
    expect(nodes.get('f1')?.blobId).toBe('stored-f1');
  });

  it('takes a file exactly at the limit', async () => {
    session.capabilities = { 'urn:ietf:params:jmap:core': { maxSizeUpload: SIZE } };
    const { body } = streamedBody();

    await target().upsertFile('', streamed('holiday.mov', body));

    expect(uploads).toEqual([expect.objectContaining({ bytes: SIZE, sha256: EXPECTED })]);
  });

  it('is left to the server when its session states no limit', async () => {
    session.capabilities = { 'urn:ietf:params:jmap:core': {} };
    const { body } = streamedBody();

    await target().upsertFile('', streamed('holiday.mov', body));

    expect(uploads).toEqual([expect.objectContaining({ bytes: SIZE, sha256: EXPECTED })]);
  });
});
