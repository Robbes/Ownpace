// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * A file download must not be UTF-8 decoded just because it arrived.
 *
 * The DAV HTTP clients decoded every response body to a string eagerly. For
 * the small XML that DAV methods return that is exactly right — every caller
 * reads `.body`. For file content it is the opposite: those are the LARGE
 * responses and no caller reads `.body` at all (`fetchFileContent` and the
 * checksum sampler both use `bodyBytes`).
 *
 * So every migrated file was also decoded into a string that was immediately
 * thrown away. Binary bytes decode to U+FFFD, two bytes of UTF-16 each, so a
 * 1 MB image cost an extra ~2 MB string — with `concurrency` of them alive at
 * once. Run #39 moved 65 MB of file content this way.
 *
 * These tests observe whether the decode HAPPENS, which is the only way to
 * hold laziness fixed: a regression to eager decoding is invisible in output.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebdavFileSource } from './webdav-source.ts';

/** Bytes that are not valid UTF-8 — the population this matters for. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function davSource() {
  return new WebdavFileSource({
    url: 'https://cloud.example.com/remote.php/dav/files/alice',
    username: 'alice',
    password: 'pw',
  } as never);
}

/** Serve `bytes` with `status` to every request. */
function serve(bytes: Uint8Array, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      headers: { forEach: () => undefined },
    })),
  );
}

/**
 * Spy on UTF-8 decoding, keeping the real behaviour.
 *
 * Counting `TextDecoder.decode` calls is what makes these tests load-bearing:
 * asserting on returned bytes alone passes with or without the fix, because
 * eager decoding was wasteful, not wrong.
 */
function spyOnDecode() {
  const real = TextDecoder.prototype.decode;
  const spy = vi.spyOn(TextDecoder.prototype, 'decode');
  spy.mockImplementation(function (this: TextDecoder, ...args: unknown[]) {
    return real.apply(this, args as never);
  });
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DAV response bodies', () => {
  const MULTISTATUS = new TextEncoder().encode(
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>',
  );

  it('does not decode a file download that nobody reads as text', async () => {
    serve(JPEG, 200);
    const decode = spyOnDecode();

    const content = await davSource().fetchFileContent('https://cloud.example.com/x.jpg');

    // The bytes are intact...
    expect(Array.from(content)).toEqual(Array.from(JPEG));
    // ...and nothing spent time turning them into a string first.
    expect(
      decode,
      'the response body was decoded even though only bytes were used',
    ).not.toHaveBeenCalled();
  });

  it('still decodes when a caller does read the text', async () => {
    // The XML path — every DAV method response goes through it. Laziness must
    // not mean unavailable.
    serve(MULTISTATUS, 207);
    const decode = spyOnDecode();

    await davSource().listFolders();

    expect(decode).toHaveBeenCalled();
  });

  it('decodes exactly once however often the text is read', async () => {
    // A cached getter, not a re-decode per access. Error paths read `.body`
    // more than once, and re-decoding a large body each time would be worse
    // than the eager decode this replaces.
    serve(MULTISTATUS, 207);

    const client = (
      davSource() as unknown as {
        httpClient: { request: (o: unknown) => Promise<{ body: string }> };
      }
    ).httpClient;
    const response = await client.request({ method: 'PROPFIND', url: 'https://x/y' });

    // Installed AFTER the request resolves, so it sees only reads of `.body`.
    const decode = spyOnDecode();

    const first = response.body;
    const second = response.body;
    const third = response.body;

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(decode).toHaveBeenCalledTimes(1);
  });
});
