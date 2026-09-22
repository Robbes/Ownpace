// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FOLDER ONLY THE DIRECTORIES HONOURED.
 *
 * The operator asked for his Drive to land under `Google`. What he got, live
 * 2026-09-22, was TWO trees: a complete, EMPTY folder structure under
 * `Google/`, and a second complete structure at the account root with all 162
 * files in it.
 *
 * `dav-sync.ts` applied `targetFolderPrefix` to `folder.path` before
 * `ensureDirectory`, so the directories were created under it.
 * `upsertFile` ignored its `parentId` and wrote to `raw.item.path` — the
 * SOURCE path, never prefixed — and a WebDAV PUT to `Wieke/foto.jpg`
 * auto-creates `Wieke/` on the way past. Hence the second tree.
 *
 * WHY THE PREFIX HAD TO MOVE INTO THE WRITER rather than be bolted onto
 * `upsertFile` where it was missing. Adoption reads the target: `listEntries`
 * walks it and yields `naturalKey: entry.path`, and those keys have to match
 * what the ledger holds or every existing file is copied again. Prefix only
 * the write and the read side drifts; prefix both by hand and the two spaces
 * have to be kept in step forever. `buildUrl` is the single place a
 * source-relative path becomes a URL — and `listEntries` already measures
 * every href against `buildUrl('')`, so moving the base moves the measurement
 * with it and the keys come back source-relative for nothing.
 *
 * THAT SYMMETRY IS WHAT THESE TESTS HOLD. Not "files are prefixed" — that
 * alone was true of directories before, and it is exactly what a wrong fix
 * would satisfy. What is asserted is that the wire and the ledger disagree in
 * precisely one way: the wire has the prefix, the keys never do.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';

const ROOT = 'https://dav.example.invalid/remote.php/dav/files/me';
const PREFIX = 'Google';

interface Seen {
  readonly method: string;
  readonly url: string;
}

/** A target that holds nothing, remembering every request made of it. */
function emptyTarget(): { client: HttpClient; seen: Seen[] } {
  const seen: Seen[] = [];
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      seen.push({ method: options.method, url: options.url });
      if (options.method === 'PROPFIND') {
        return {
          status: 207,
          body: '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>',
          headers: {},
        };
      }
      return { status: 201, body: '', headers: {} };
    }),
  };
  return { client, seen };
}

function writerFor(client: HttpClient, prefix?: string): WebDAVTargetWriter {
  return new WebDAVTargetWriter(
    {
      url: ROOT,
      username: 'me',
      password: 'pw',
      ...(prefix ? { targetFolderPrefix: prefix } : {}),
    },
    {
      ledger: { find: async () => undefined, recordIfAbsent: async () => undefined } as never,
      tenantId: 't' as never,
      mappingId: 'm' as never,
      httpClient: client,
    },
  );
}

const FILE = {
  item: { path: 'Wieke/foto.jpg', mimeType: 'image/jpeg', size: 3 },
  content: new Uint8Array([1, 2, 3]),
} as never;

describe('a folder only the directories honoured', () => {
  it('puts the file under the same prefix as its directory', async () => {
    // THE BUG, in one assertion: these two used to disagree.
    const { client, seen } = emptyTarget();
    const writer = writerFor(client, PREFIX);
    await writer.ensureDirectory({ path: 'Wieke' } as never);
    await writer.upsertFile('Wieke', FILE);

    const mkcol = seen.filter((s) => s.method === 'MKCOL').map((s) => s.url);
    const put = seen.filter((s) => s.method === 'PUT').map((s) => s.url);
    expect(put, 'nothing was written').not.toHaveLength(0);
    // Under the prefix — which includes the prefix's OWN directory, whose URL
    // ends there and has no trailing separator.
    for (const url of [...mkcol, ...put]) {
      expect(
        url === `${ROOT}/${PREFIX}` || url.startsWith(`${ROOT}/${PREFIX}/`),
        `escaped the prefix: ${url}`,
      ).toBe(true);
    }
    expect(put[0]).toBe(`${ROOT}/${PREFIX}/Wieke/foto.jpg`);
  });

  it('creates the prefix folder itself, which no natural key contains', async () => {
    // `ensureCollectionPath` walks the segments of a SOURCE path, and `Google`
    // is in none of them — so without this the first MKCOL beneath it answers
    // 409 and every file in the migration fails behind it.
    const { client, seen } = emptyTarget();
    await writerFor(client, PREFIX).ensureDirectory({ path: 'Wieke' } as never);
    expect(seen.some((s) => s.method === 'MKCOL' && s.url === `${ROOT}/${PREFIX}`)).toBe(true);
  });

  it('keeps the prefix off the natural key, so the ledger still matches', async () => {
    // The wire and the ledger disagree in exactly one way. If the key picked up
    // the prefix, every file already migrated would be copied a second time.
    const { client } = emptyTarget();
    const written = await writerFor(client, PREFIX).upsertFile('Wieke', FILE);
    expect((written as { targetId: string }).targetId).toBe('Wieke/foto.jpg');
  });

  it('reads the target back in the same space it writes the keys', async () => {
    // Adoption walks the target and yields `naturalKey: entry.path`. With a
    // prefix on the wire those hrefs carry it, and a key that carries it
    // matches nothing the ledger holds. `listEntries` measures against
    // `buildUrl('')`, so the two move together.
    const client: HttpClient = {
      request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
        if (options.method !== 'PROPFIND') return { status: 201, body: '', headers: {} };
        const deep = options.url.includes('Wieke');
        return {
          status: 207,
          headers: {},
          body: deep
            ? `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
                 <d:response><d:href>/remote.php/dav/files/me/${PREFIX}/Wieke/foto.jpg</d:href>
                   <d:propstat><d:prop><d:getcontentlength>3</d:getcontentlength></d:prop>
                   <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
               </d:multistatus>`
            : `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
                 <d:response><d:href>/remote.php/dav/files/me/${PREFIX}/Wieke/</d:href>
                   <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
                   <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
               </d:multistatus>`,
        };
      }),
    };
    const keys: string[] = [];
    for await (const entry of writerFor(client, PREFIX).listEntries()) keys.push(entry.naturalKey);
    expect(keys, 'a key carrying the prefix matches nothing in the ledger').toEqual([
      'Wieke/foto.jpg',
    ]);
  });

  it('changes nothing at all when no prefix is configured', async () => {
    // The behaviour every existing migration has. A prefix is opt-in and its
    // absence must be byte-for-byte what it always was.
    const { client, seen } = emptyTarget();
    const writer = writerFor(client);
    await writer.ensureDirectory({ path: 'Wieke' } as never);
    await writer.upsertFile('Wieke', FILE);
    expect(seen.filter((s) => s.method === 'PUT').map((s) => s.url)).toEqual([
      `${ROOT}/Wieke/foto.jpg`,
    ]);
    expect(seen.every((s) => !s.url.includes(PREFIX))).toBe(true);
  });

  it('tells dav-sync that it owns the prefix, so it is not applied twice', () => {
    // Without the handshake the caller prefixes `folder.path` AND `buildUrl`
    // prefixes everything: directories land in `Google/Google`.
    expect(writerFor(emptyTarget().client, PREFIX).ownsTargetFolderPrefix).toBe(true);
  });
});
