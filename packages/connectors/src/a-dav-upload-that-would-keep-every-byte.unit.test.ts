// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DAV UPLOAD THAT WOULD KEEP EVERY BYTE (workplan 0150 T1).
 *
 * The WebDAV source's client, `createFileHttpClient`, sends a stream body the
 * way the target writer's does, and so held the whole of it the same way:
 * Node's `fetch` keeps the original of every request it clones, and under any
 * redirect mode but `error` it clones every request. A cloned stream body is a
 * tee whose other branch nobody reads. `an-upload-that-kept-every-byte`, in
 * the engines package, measures that through the writer; this holds the same
 * rule for this client:
 *
 *  1. a stream body goes to `fetch` with `redirect: 'error'` beside
 *     `duplex: 'half'`;
 *  2. every other request goes as it did, with fetch's own redirect mode.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileHttpClient } from './webdav-source.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every `RequestInit` fetch receives, the body read to its end, as a server would. */
function recordFetch(): Array<Record<string, unknown>> {
  const inits: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (_url: string, init: Record<string, unknown>) => {
    inits.push(init);
    if (init.body instanceof ReadableStream) await new Response(init.body).arrayBuffer();
    return new Response(null, { status: 201 });
  });
  return inits;
}

describe("the WebDAV source's client", () => {
  it('sends a stream with redirect "error" beside duplex "half"', async () => {
    const inits = recordFetch();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });

    await createFileHttpClient().request({ method: 'PUT', url: 'https://dav.example/a.bin', body });

    expect(inits).toHaveLength(1);
    expect(inits[0]!.body).toBeInstanceOf(ReadableStream);
    expect(inits[0]!.duplex).toBe('half');
    expect(inits[0]!.redirect).toBe('error');
  });

  it('sends everything else as before: text, bytes, and no body at all', async () => {
    const inits = recordFetch();
    const client = createFileHttpClient();

    await client.request({ method: 'PROPFIND', url: 'https://dav.example/', body: '<d:propfind xmlns:d="DAV:"/>' });
    await client.request({ method: 'PUT', url: 'https://dav.example/n.txt', body: new TextEncoder().encode('hello') });
    await client.request({ method: 'GET', url: 'https://dav.example/n.txt' });

    expect(inits).toHaveLength(3);
    for (const init of inits) {
      expect(init).not.toHaveProperty('redirect');
      expect(init).not.toHaveProperty('duplex');
    }
  });
});
