// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The source half of the memory ceiling (workplan 0120).
 *
 * `fetch` read every file into a `Uint8Array`, whatever its size, so the
 * largest file a migration could move was decided by the runner's RAM — and
 * crossing that killed the process rather than failing the item.
 *
 * Above the threshold the file now arrives as a `FileBody`: a size, and a way
 * to read that nothing holds. Below it nothing changed, deliberately — most
 * files are small, a buffer is simpler, and the machinery is not free.
 */

import { describe, it, expect } from 'vitest';
import { WebdavFileSource, STREAM_FILES_LARGER_THAN_BYTES } from './webdav-source.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import type { FileItem } from '@openmig/shared';

const CONTENT = new Uint8Array([7, 8, 9, 10]);

const item = (size: number): FileItem => ({
  path: 'Docs/thing.bin',
  isDirectory: false,
  size,
  modifiedAt: new Date().toISOString(),
  sourceRef: '/remote.php/dav/files/x/Docs/thing.bin',
});

function client(seen: HttpRequestOptions[]): HttpClient {
  return {
    async request(options: HttpRequestOptions): Promise<HttpResponse> {
      seen.push(options);
      if (options.stream) {
        return {
          status: 200,
          body: '',
          headers: {},
          bodyStream: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(CONTENT);
              c.close();
            },
          }),
        };
      }
      return { status: 200, body: '', headers: {}, bodyBytes: CONTENT };
    },
  };
}

const sourceWith = (seen: HttpRequestOptions[]): WebdavFileSource =>
  new WebdavFileSource(
    { url: 'https://dav.example/remote.php/dav/files/x', username: 'u', password: 'p' },
    { httpClient: client(seen) },
  );

describe('a small file still arrives as bytes', () => {
  it('is buffered, and asks for no stream', async () => {
    const seen: HttpRequestOptions[] = [];
    const raw = await sourceWith(seen).fetch(item(1024));
    expect(raw.content).toEqual(CONTENT);
    expect(raw.body, 'a small file should not pay for the streaming machinery').toBeUndefined();
    expect(seen.some((s) => s.stream)).toBe(false);
  });
});

describe('a large file arrives as a body', () => {
  const big = STREAM_FILES_LARGER_THAN_BYTES + 1;

  it('carries a size, and no bytes', async () => {
    const seen: HttpRequestOptions[] = [];
    const raw = await sourceWith(seen).fetch(item(big));
    expect(raw.content, 'the bytes were buffered after all').toBeUndefined();
    expect(raw.body?.sizeBytes).toBe(big);
  });

  it('downloads nothing until somebody opens it', async () => {
    // The fetch is metadata: the bytes move when the target starts writing,
    // inside the loop's bounded concurrency, and not a moment before.
    const seen: HttpRequestOptions[] = [];
    await sourceWith(seen).fetch(item(big));
    expect(seen, 'fetch made a request before anybody asked to read').toEqual([]);
  });

  it('can be opened twice, because a retry starts from the beginning', async () => {
    const seen: HttpRequestOptions[] = [];
    const raw = await sourceWith(seen).fetch(item(big));
    const read = async (): Promise<number> => {
      const reader = (await raw.body!.open()).getReader();
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value?.byteLength ?? 0;
      }
      return n;
    };
    expect(await read()).toBe(CONTENT.byteLength);
    expect(await read()).toBe(CONTENT.byteLength);
    // Two GETs, not one stream handed out twice — the second would be already
    // consumed, and an exhausted stream writes an empty file and calls it a
    // copy.
    expect(seen.filter((s) => s.method === 'GET' && s.stream)).toHaveLength(2);
  });
});

describe('a body the server will not produce is a refusal', () => {
  it('never hands back an empty stream', async () => {
    // A 200 with no body, on a file the listing gave a size to. Returning an
    // empty stream writes an empty file and records it as a copy — the worst
    // outcome available to this code.
    const bodiless: HttpClient = {
      async request(): Promise<HttpResponse> {
        return { status: 200, body: '', headers: {} };
      },
    };
    const source = new WebdavFileSource(
      { url: 'https://dav.example/remote.php/dav/files/x', username: 'u', password: 'p' },
      { httpClient: bodiless },
    );
    const raw = await source.fetch(item(STREAM_FILES_LARGER_THAN_BYTES + 1));
    await expect(raw.body!.open()).rejects.toThrow(/no body to read/);
  });
});
