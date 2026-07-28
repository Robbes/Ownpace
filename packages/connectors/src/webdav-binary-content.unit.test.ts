// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * File content must survive the read byte for byte.
 *
 * `fetchFileContent` used to do `new TextEncoder().encode(response.body)`,
 * where `body` was `await response.text()` — a UTF-8 decode. That is lossless
 * only for files that ARE valid UTF-8. For everything else each invalid byte
 * sequence becomes U+FFFD and the original byte is gone; re-encoding produces
 * different, longer, permanently wrong content. Measured on a 476 KB JPEG:
 * 476,387 bytes in, 863,389 out.
 *
 * The corrupted bytes went both into the ledger as the content hash and into
 * the PUT, so the copy agreed with its own record and the migration looked
 * clean. Nothing in the sync could notice; the §20 gate reading the real target
 * was the first thing that could, and it did — every binary sample in the first
 * full run mismatched while every text sample matched.
 *
 * (In that run the binaries sampled were pre-existing files the writer ADOPTED
 * rather than uploaded, so what it caught was the wrong hash rather than a
 * corrupt copy. The upload path is corrupted just the same — nothing had ever
 * exercised it, because the e2e seeds only text files. These tests cover the
 * read, which is where both consequences originate.)
 *
 * Every case here uses byte sequences that are invalid UTF-8, because that is
 * the whole population of files this broke: images, PDFs, video, Office
 * documents, archives, encrypted blobs.
 */

import { describe, it, expect } from 'vitest';
import { WebdavFileSource } from './webdav-source';
import type { HttpClient, HttpResponse } from './dav-http.types';

/** A client that answers every request with these exact bytes. */
function clientReturning(bytes: Uint8Array, opts: { withBytes?: boolean } = {}): HttpClient {
  return {
    async request(): Promise<HttpResponse> {
      return {
        status: 200,
        // Exactly what a text-only client produces — kept here so the test
        // proves the code reads `bodyBytes` rather than this.
        body: new TextDecoder().decode(bytes),
        ...(opts.withBytes === false ? {} : { bodyBytes: bytes }),
        headers: {},
      };
    },
  };
}

function sourceWith(client: HttpClient): WebdavFileSource {
  return new WebdavFileSource(
    { url: 'https://cloud.example.com/remote.php/dav/files/alice', username: 'alice', password: 'pw' },
    { httpClient: client },
  );
}

/** The first bytes of a real JPEG, which are not valid UTF-8. */
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('WebdavFileSource.fetchFileContent', () => {
  it('returns a JPEG header unchanged', async () => {
    const source = sourceWith(clientReturning(JPEG_HEADER));

    const content = await source.fetchFileContent('https://cloud.example.com/x.jpg');

    expect(Array.from(content)).toEqual(Array.from(JPEG_HEADER));
  });

  it('does not inflate high-entropy content', async () => {
    // The signature of the bug: replacement characters are three bytes each, so
    // random binary came back roughly twice its true size.
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;

    const content = await sourceWith(clientReturning(bytes)).fetchFileContent('https://x/y.bin');

    expect(content.byteLength).toBe(bytes.byteLength);
    expect(Array.from(content)).toEqual(Array.from(bytes));
  });

  it('preserves every byte value, including the ones UTF-8 cannot represent alone', async () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;

    const content = await sourceWith(clientReturning(bytes)).fetchFileContent('https://x/all-bytes');

    expect(Array.from(content)).toEqual(Array.from(bytes));
  });

  it('leaves genuinely-UTF-8 content alone too', async () => {
    // The path that always worked, and the reason the bug survived: text files
    // round-trip perfectly, so a migration of documents looked fine.
    const bytes = new TextEncoder().encode('# Readme\n\nnaïve café — ok\n');

    const content = await sourceWith(clientReturning(bytes)).fetchFileContent('https://x/readme.md');

    expect(new TextDecoder().decode(content)).toBe('# Readme\n\nnaïve café — ok\n');
  });

  it('throws rather than silently corrupting when the client cannot supply bytes', async () => {
    // A half-working copy of someone's photo library is worse than a failed
    // run: the ledger records it as migrated and the fast-path never retries.
    const source = sourceWith(clientReturning(JPEG_HEADER, { withBytes: false }));

    await expect(source.fetchFileContent('https://x/y.jpg')).rejects.toThrow(/bodyBytes/);
  });
});
