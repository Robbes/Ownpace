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
 * NOTHING ABOUT A CHUNK ARGUES FOR THE GENERIC TYPE. `Content-Range` is the
 * header that says "this is a piece of something bigger"; `Content-Type`
 * describes the entity being assembled, and that entity is the file. A server
 * putting the pieces together now gets the source's own answer on every chunk
 * instead of a shrug on all of them.
 *
 * WHY THE RULE IS "EVERY PUT", NOT "THE CHUNKED ONE". Written as a test of the
 * chunked path alone it would pass a fourth upload path added tomorrow with
 * the same hardcode. What is asserted instead is the property that was broken:
 * a file's type on the wire does not depend on its size.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './webdav-target-writer.ts';

/** Every Content-Type this writer put on the wire, in order. */
function recordingClient(): { client: HttpClient; types: string[]; ranged: boolean[] } {
  const types: string[] = [];
  const ranged: boolean[] = [];
  const client: HttpClient = {
    request: vi.fn(async (options: HttpRequestOptions): Promise<HttpResponse> => {
      if (options.method === 'PUT') {
        const headers = (options.headers ?? {}) as Record<string, string>;
        types.push(headers['Content-Type'] ?? '(none)');
        ranged.push(headers['Content-Range'] !== undefined);
      }
      return { status: 201, body: '', headers: {} };
    }),
  };
  return { client, types, ranged };
}

const CHUNK = 64;

function writerFor(client: HttpClient): WebDAVTargetWriter {
  return new WebDAVTargetWriter(
    {
      url: 'https://dav.example.invalid/files/me',
      username: 'me',
      password: 'pw',
      chunkedUploads: true,
      chunkSize: CHUNK,
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
    const { client, types, ranged } = recordingClient();
    await (writerFor(client) as never as {
      uploadFile: (raw: unknown, overwrite: boolean) => Promise<unknown>;
    }).uploadFile(photo(CHUNK - 1), false);
    expect(ranged.some(Boolean), 'expected the single-PUT path').toBe(false);
    expect(types).toEqual(['image/jpeg']);
  });

  it('sends the same type on a file big enough to be chunked', async () => {
    const { client, types, ranged } = recordingClient();
    await (writerFor(client) as never as {
      uploadFile: (raw: unknown, overwrite: boolean) => Promise<unknown>;
    }).uploadFile(photo(CHUNK * 3), false);
    expect(ranged.every(Boolean), 'expected the chunked path').toBe(true);
    expect(types.length, 'expected more than one chunk').toBeGreaterThan(1);
    // THE RULE: the type does not depend on the size. Every chunk, not just
    // the first — a server may take the type from any of them.
    expect(types.every((t) => t === 'image/jpeg'), `chunk types: ${types.join(', ')}`).toBe(true);
  });

  it('still falls back when the source declared nothing', async () => {
    // The fallback is correct where the source is silent; what was wrong was
    // sending it where the source had spoken.
    const { client, types } = recordingClient();
    const untyped = { item: { path: 'x', size: CHUNK * 2 }, content: new Uint8Array(CHUNK * 2) };
    await (writerFor(client) as never as {
      uploadFile: (raw: unknown, overwrite: boolean) => Promise<unknown>;
    }).uploadFile(untyped as never, false);
    expect(types.every((t) => t === 'application/octet-stream')).toBe(true);
  });
});
