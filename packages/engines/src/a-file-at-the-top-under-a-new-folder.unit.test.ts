// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE AT THE TOP, UNDER A FOLDER THAT IS NOT THERE YET (workplan 0179;
 * the maintainer's decision "a" of 2026-11-27).
 *
 * 0179 T5's first E2E migrated into a Nextcloud under a destination folder
 * (`targetFolderPrefix`) that did not exist yet. 61 files in subfolders were
 * copied; the 28 files at the TOP of the source failed five times each with
 *
 *   404 File with name /<folder> could not be located
 *
 * and were left failed. The prefix was made only on the way to a subfolder
 * (`ensureCollectionPath` → `ensurePrefixRoot`): `ensureDirectory('')`
 * returned early, and `upsertFile` made a parent only when there was one. A
 * file at the top was PUT into a collection that was not there, and whether
 * it worked depended on whether a file in a subfolder happened to go first.
 *
 * The test that existed (`a-folder-only-the-directories-honoured`) could not
 * see it: its target answers 207 and 201 to everything. This one answers as
 * Sabre does — a PROPFIND or a PUT under a missing collection is 404 naming
 * the parent, a MKCOL whose parent is missing is 409, a MKCOL of a collection
 * that is there is 405, a MOVE to a missing parent is 409.
 */

import { describe, expect, it } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';
import { TargetFolderMissingError, type RawFileItem } from '@openmig/shared';

const ORIGIN = 'https://cloud.example';
const FILES = `${ORIGIN}/remote.php/dav/files/alice`;
const UPLOADS = `${ORIGIN}/remote.php/dav/uploads/alice/`;
/** Two levels, so the prefix's own chain is walked and not only its last folder. */
const PREFIX = 'From Google/Drive';
const PREFIX_CHAIN = [`${FILES}/From%20Google`, `${FILES}/From%20Google/Drive`];

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly destination?: string;
}

const decode = (url: string): string =>
  decodeURIComponent(url.slice(FILES.length)).replace(/^\/+|\/+$/g, '');
const parentOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
};
const notFound = (path: string): HttpResponse => ({
  status: 404,
  headers: {},
  body:
    '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
    `<s:exception>Sabre\\DAV\\Exception\\NotFound</s:exception><s:message>File with name /${path} could not be located</s:message></d:error>`,
});

/**
 * A Nextcloud's files area, in memory, answering as Sabre answers.
 * `collections` and `files` are wire-relative paths (the prefix included).
 */
function sabreTarget(options: { collections?: string[]; files?: string[] } = {}): {
  client: HttpClient;
  seen: Seen[];
  files: Set<string>;
} {
  const collections = new Set<string>(['', ...(options.collections ?? [])]);
  const files = new Set<string>(options.files ?? []);
  const uploads = new Set<string>();
  const seen: Seen[] = [];
  const client: HttpClient = {
    async request(req: HttpRequestOptions): Promise<HttpResponse> {
      const destination = req.headers?.['Destination'];
      seen.push({ method: req.method, url: req.url, ...(destination ? { destination } : {}) });

      if (req.url.startsWith(UPLOADS)) {
        const transfer = req.url.slice(UPLOADS.length).split('/')[0]!;
        if (req.method === 'MKCOL') {
          if (uploads.has(transfer)) return { status: 405, body: '', headers: {} };
          uploads.add(transfer);
          return { status: 201, body: '', headers: {} };
        }
        if (req.method === 'PUT') {
          // Read the piece, as a server does: the writer's slicer waits on it.
          if (req.body instanceof ReadableStream) await new Response(req.body).arrayBuffer();
          return { status: 201, body: '', headers: {} };
        }
        if (req.method === 'MOVE') {
          const target = decode(destination!);
          // Sabre answers a MOVE into a missing collection with 409.
          if (!collections.has(parentOf(target))) {
            return { status: 409, body: 'The destination node is not found', headers: {} };
          }
          files.add(target);
          return { status: 201, body: '', headers: { etag: '"v1"' } };
        }
        return { status: 400, body: `unexpected ${req.method}`, headers: {} };
      }

      const path = decode(req.url);
      switch (req.method) {
        case 'PROPFIND': {
          if (files.has(path)) {
            return {
              status: 207,
              headers: {},
              body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${req.url.slice(ORIGIN.length)}</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
            };
          }
          if (!collections.has(path)) return notFound(collections.has(parentOf(path)) ? path : parentOf(path));
          const children = [...files].filter((f) => parentOf(f) === path);
          const responses = children
            .map(
              (f) =>
                `<d:response><d:href>/remote.php/dav/files/alice/${f.split('/').map(encodeURIComponent).join('/')}</d:href><d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
            )
            .join('');
          return {
            status: 207,
            headers: {},
            body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
          };
        }
        case 'MKCOL':
          if (collections.has(path) || files.has(path)) return { status: 405, body: 'The resource you tried to create already exists', headers: {} };
          if (!collections.has(parentOf(path))) return { status: 409, body: 'Parent node does not exist', headers: {} };
          collections.add(path);
          return { status: 201, body: '', headers: {} };
        case 'PUT':
          if (!collections.has(parentOf(path))) return notFound(parentOf(path));
          if (req.headers?.['If-None-Match'] === '*' && files.has(path)) {
            return { status: 412, body: 'An If-None-Match header was specified', headers: {} };
          }
          files.add(path);
          return { status: 201, body: '', headers: { etag: '"v1"' } };
        default:
          return { status: 400, body: `unexpected ${req.method}`, headers: {} };
      }
    },
  };
  return { client, seen, files };
}

function writerFor(client: HttpClient, extra: { prefix?: string; pieceBytes?: number } = {}): WebDAVTargetWriter {
  return new WebDAVTargetWriter(
    {
      url: FILES,
      username: 'alice',
      password: 'pw',
      ...(extra.prefix ? { targetFolderPrefix: extra.prefix } : {}),
      ...(extra.pieceBytes ? { uploadChunkBytes: extra.pieceBytes } : {}),
    },
    {
      ledger: { find: async () => undefined, recordIfAbsent: async () => undefined } as never,
      tenantId: 't' as never,
      mappingId: 'm' as never,
      httpClient: client,
    },
  );
}

const fileAt = (path: string, size = 3): RawFileItem =>
  ({
    item: { path, isDirectory: false, size, modifiedAt: '2026-11-27T10:00:00Z', sourceRef: path, mimeType: 'text/plain' },
    content: new Uint8Array(size).map((_, i) => i % 251),
  }) as RawFileItem;

/** The index of the last request that matches, -1 for none (the lib here predates `findLastIndex`). */
const lastIndexOf = (seen: Seen[], match: (s: Seen) => boolean): number =>
  seen.reduce((last, s, i) => (match(s) ? i : last), -1);

const mkcols = (seen: Seen[]): string[] => seen.filter((s) => s.method === 'MKCOL' && s.url.startsWith(FILES)).map((s) => s.url);

describe('a file at the top of the source, under a destination folder that is not there yet', () => {
  it('makes the folder before the PUT when a top-level file goes first, and the PUT succeeds', async () => {
    const { client, seen, files } = sabreTarget();
    const result = await writerFor(client, { prefix: PREFIX }).upsertFile('', fileAt('readme.txt'));

    expect(result.created, 'the file was not written').toBe(true);
    expect(files.has('From Google/Drive/readme.txt')).toBe(true);
    expect(mkcols(seen)).toEqual(PREFIX_CHAIN);
    const put = seen.findIndex((s) => s.method === 'PUT');
    const lastMkcol = lastIndexOf(seen, (s) => s.method === 'MKCOL');
    expect(lastMkcol, 'the folder was made after the PUT, or not at all').toBeLessThan(put);
  });

  it('makes the folder when the sync loop asks for the root folder (ensureDirectory of "")', async () => {
    const { client, seen } = sabreTarget();
    const writer = writerFor(client, { prefix: PREFIX });
    expect(await writer.ensureDirectory({ path: '' } as never)).toBe('');
    expect(mkcols(seen)).toEqual(PREFIX_CHAIN);

    const result = await writer.upsertFile('', fileAt('readme.txt'));
    expect(result.created).toBe(true);
  });

  it('takes a folder that is already there (405) as done, and asks for it once per writer', async () => {
    const { client, seen, files } = sabreTarget({ collections: ['From Google', 'From Google/Drive'] });
    const writer = writerFor(client, { prefix: PREFIX });
    await writer.ensureDirectory({ path: '' } as never);
    // Concurrently, as the sync loop writes: one ask of the chain, not one per file.
    await Promise.all(['a.txt', 'b.txt', 'c.txt'].map((name) => writer.upsertFile('', fileAt(name))));
    await writer.upsertFile('', fileAt('d.txt'));

    expect(mkcols(seen)).toEqual(PREFIX_CHAIN);
    expect([...files].sort()).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((n) => `From Google/Drive/${n}`));
  });

  it('makes no folder for a top-level file when there is no destination folder', async () => {
    const { client, seen, files } = sabreTarget();
    const writer = writerFor(client);
    await writer.ensureDirectory({ path: '' } as never);
    const result = await writer.upsertFile('', fileAt('readme.txt'));

    expect(result.created).toBe(true);
    expect(files.has('readme.txt')).toBe(true);
    expect(mkcols(seen)).toEqual([]);
  });

  it('leaves the overwrite path as it was: no MKCOL, one PUT under the folder', async () => {
    const { client, seen } = sabreTarget({
      collections: ['From Google', 'From Google/Drive'],
      files: ['From Google/Drive/readme.txt'],
    });
    const result = await writerFor(client, { prefix: PREFIX }).upsertFile('', fileAt('readme.txt'), {
      overwrite: true,
    });

    expect(result.updated).toBe(true);
    expect(mkcols(seen)).toEqual([]);
    expect(seen.filter((s) => s.method === 'PUT').map((s) => s.url)).toEqual([
      `${FILES}/From%20Google/Drive/readme.txt`,
    ]);
  });

  it('puts a top-level file that goes up in pieces under the folder, made before the pieces are joined', async () => {
    const { client, seen, files } = sabreTarget();
    const result = await writerFor(client, { prefix: PREFIX, pieceBytes: 1024 }).upsertFile(
      '',
      fileAt('film.mp4', 3000),
    );

    expect(result.created, 'the file was not written').toBe(true);
    expect(files.has('From Google/Drive/film.mp4')).toBe(true);
    const move = seen.find((s) => s.method === 'MOVE');
    expect(move?.destination).toBe(`${FILES}/From%20Google/Drive/film.mp4`);
    expect(mkcols(seen)).toEqual(PREFIX_CHAIN);
    expect(lastIndexOf(seen, (s) => s.method === 'MKCOL' && s.url.startsWith(FILES))).toBeLessThan(
      seen.findIndex((s) => s.method === 'MOVE'),
    );
  });
});

describe('what reading a missing destination folder says, unchanged (workplan 0156 T2)', () => {
  it('lists a missing destination folder as TargetFolderMissingError, and makes nothing', async () => {
    const { client, seen } = sabreTarget();
    const read = async (): Promise<void> => {
      for await (const _ of writerFor(client, { prefix: PREFIX }).listEntries()) void _;
    };
    await expect(read()).rejects.toBeInstanceOf(TargetFolderMissingError);
    await expect(read()).rejects.toThrow('/From Google/Drive');
    expect(mkcols(seen), 'a read made the folder it was asked about').toEqual([]);
  });
});
