// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TYPE THE BIG FILES LOST.
 *
 * `webdav-target-writer` sends the source's own MIME type on a PUT and falls
 * back to `application/octet-stream` only when the source declared nothing.
 * Twice. The third PUT — the chunked one, taken for anything over
 * `chunkSize` — sent the fallback UNCONDITIONALLY.
 *
 * So a file arrived typed or untyped on the target according to its SIZE, and
 * the ones that lost it are exactly the ones where a type matters most:
 * photos and video, the files a person opens by double-clicking.
 *
 * WHY THE RULE IS "EVERY PUT", NOT "THE CHUNKED ONE". Written as a test of the
 * chunked path alone it would pass a fourth upload path added tomorrow with
 * the same hardcode. What is asserted instead is the property that was broken:
 * a file's type on the wire does not depend on its size.
 *
 * ## The chunked path it was written against is gone (workplan 0156)
 *
 * That path PUT the same URL repeatedly with `Content-Range`, which Sabre
 * refuses on any PUT, and nothing in either edition ever switched it on. A
 * file larger than one piece now goes up as Nextcloud's chunked upload:
 * pieces PUT into the account's upload area and one MOVE that assembles them
 * at the destination. Nextcloud types the assembled file by its name, so the
 * type on a piece changes nothing there — but the rule stands as it was
 * written, because it is about the wire and not about one server: every PUT
 * carries the source's type, whatever the file's size, and no PUT carries
 * `Content-Range` at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';

/** Every Content-Type this writer put on the wire, in order. */
function recordingClient(): {
  client: HttpClient;
  types: string[];
  ranged: boolean[];
  pieces: string[];
} {
  const types: string[] = [];
  const ranged: boolean[] = [];
  const pieces: string[] = [];
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      // A server reads what it is sent: a piece is a window onto one stream,
      // and the next piece starts where this one was read to.
      if (options.body instanceof ReadableStream) await new Response(options.body).arrayBuffer();
      if (options.method === 'PUT') {
        const headers = (options.headers ?? {}) as Record<string, string>;
        types.push(headers['Content-Type'] ?? '(none)');
        ranged.push(headers['Content-Range'] !== undefined);
        if (options.url.includes('/dav/uploads/')) pieces.push(options.url);
      }
      return { status: 201, body: '', headers: {} };
    }),
  };
  return { client, types, ranged, pieces };
}

const CHUNK = 64;

function writerFor(client: HttpClient): WebDAVTargetWriter {
  return new WebDAVTargetWriter(
    {
      url: 'https://dav.example.invalid/remote.php/dav/files/me',
      username: 'me',
      password: 'pw',
      uploadChunkBytes: CHUNK,
    },
    { httpClient: client } as never,
  );
}

/** A file of `bytes` bytes that the source says is a JPEG. */
function photo(bytes: number): never {
  return {
    item: { path: 'Wieke/foto.jpg', mimeType: 'image/jpeg', size: bytes },
    content: new Uint8Array(bytes),
  } as never;
}

describe('a type the big files lost', () => {
  it('sends the source type on a small file', async () => {
    const { client, types, pieces } = recordingClient();
    await (writerFor(client) as never as {
      uploadFile: (raw: unknown, overwrite: boolean) => Promise<unknown>;
    }).uploadFile(photo(CHUNK - 1), false);
    expect(pieces, 'expected the single-PUT path').toEqual([]);
    expect(types).toEqual(['image/jpeg']);
  });

  it('sends the same type on every piece of a file big enough to go up in pieces', async () => {
    const { client, types, ranged, pieces } = recordingClient();
    await (writerFor(client) as never as {
      uploadFile: (raw: unknown, overwrite: boolean) => Promise<unknown>;
    }).uploadFile(photo(CHUNK * 3), false);
    expect(pieces.length, 'expected the chunked path, in more than one piece').toBe(3);
    // THE RULE: the type does not depend on the size. Every piece, not just
    // the first.
    expect(types.every((t) => t === 'image/jpeg'), `piece types: ${types.join(', ')}`).toBe(true);
    // And the refused mechanism is gone from the wire.
    expect(ranged.some(Boolean), 'a PUT carried Content-Range').toBe(false);
  });

  it('still falls back when the source declared nothing', async () => {
    // The fallback is correct where the source is silent; what was wrong was
    // sending it where the source had spoken.
    const { client, types, pieces } = recordingClient();
    const untyped = { item: { path: 'x', size: CHUNK * 2 }, content: new Uint8Array(CHUNK * 2) };
    await (writerFor(client) as never as {
      uploadFile: (raw: unknown, overwrite: boolean) => Promise<unknown>;
    }).uploadFile(untyped as never, false);
    expect(pieces.length).toBe(2);
    expect(types.every((t) => t === 'application/octet-stream')).toBe(true);
  });
});
