// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A file larger than the runner's memory, and what happens to it.
 *
 * Until this vocabulary existed, the answer was: the process is killed
 * mid-pass. No run event, no failure-queue row, no sentence — from a
 * customer's side, a migration that stalls for ever on one file and never says
 * which. That is not a limit, it is an outage with a size threshold.
 *
 * Two properties are asserted here, and they are the two halves of the fix:
 *
 *  1. **The bytes need not all exist at once.** A `FileBody` is a size and a
 *     way to read, re-openable because a retry starts from the beginning.
 *  2. **A path that cannot stream refuses, in words.** A named error with the
 *     file, its size, the limit and a way forward — never an OOM.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_BUFFERED_FILE_BYTES,
  bodyOfBytes,
  tooLargeToBuffer,
  type FileBody,
} from './file-body.ts';
import { fileContentHash, streamingFileContentHash } from './hash.ts';

const drain = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

describe('a body is a size and a way to read, not the bytes', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);

  it('knows its size before anything is read', () => {
    expect(bodyOfBytes(bytes).sizeBytes).toBe(5);
  });

  it('can be opened again, because a retry starts from the beginning', async () => {
    // The failure this prevents: a source hands back a stream it has already
    // consumed, the retry writes nothing, and an EMPTY file is recorded as a
    // copy — the worst outcome available to this code.
    const body = bodyOfBytes(bytes);
    expect(await drain(await body.open())).toEqual(bytes);
    expect(await drain(await body.open())).toEqual(bytes);
  });
});

describe('the hash no longer needs the whole file', () => {
  const bytes = new Uint8Array(Array.from({ length: 4096 }, (_, i) => i % 251));

  it('agrees with the buffered hash, chunk by chunk', async () => {
    const hasher = streamingFileContentHash();
    const body: FileBody = {
      sizeBytes: bytes.byteLength,
      open: async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            // Deliberately several chunks: a hasher that only worked on one
            // would pass a single-chunk test and fail on every real file.
            for (let at = 0; at < bytes.byteLength; at += 512) {
              controller.enqueue(bytes.slice(at, at + 512));
            }
            controller.close();
          },
        }),
    };
    const out = await drain((await body.open()).pipeThrough(hasher.through));
    expect(out).toEqual(bytes);
    expect(hasher.digest()).toBe(fileContentHash(bytes));
    expect(hasher.bytesSeen()).toBe(bytes.byteLength);
  });

  it('refuses to answer before the stream has ended', async () => {
    // A digest over a prefix compares equal to nothing and unequal to
    // everything, and would be written to the ledger as though it were the
    // file. Silence would be better; a refusal is better still.
    const hasher = streamingFileContentHash();
    expect(() => hasher.digest()).toThrow(/read to the end/);
  });

  it('gives the same answer twice', async () => {
    const hasher = streamingFileContentHash();
    await drain((await bodyOfBytes(bytes).open()).pipeThrough(hasher.through));
    expect(hasher.digest()).toBe(hasher.digest());
  });
});

describe('a path that cannot stream says so', () => {
  const refusal = tooLargeToBuffer('written to', 'Microsoft Graph', '/Design/master.psd', 900 * 1024 * 1024);

  it('names the file, its size and the limit', () => {
    expect(refusal.message).toContain('/Design/master.psd');
    expect(refusal.message).toContain('900 MB');
    expect(refusal.message).toContain('256 MB');
  });

  it('names which end cannot carry it — the only actionable part', () => {
    expect(refusal.message).toContain('written to Microsoft Graph');
  });

  it('says nothing was changed, and that the rest continues', () => {
    // A per-item refusal that reads like a pass failure sends somebody
    // looking for a broken migration. Nothing here is broken.
    expect(refusal.message).toContain('Nothing was copied and nothing was changed');
    expect(refusal.message).toContain('every other file in this folder continues normally');
  });

  it('offers a way forward rather than only a wall', () => {
    expect(refusal.message).toMatch(/by hand|resumable/);
  });
});

describe('the ceiling is a stated number, not a guess at the machine', () => {
  it('is the same everywhere, because a per-deployment limit cannot be supported', () => {
    // "It worked on my appliance" is not something a customer can act on.
    expect(MAX_BUFFERED_FILE_BYTES).toBe(256 * 1024 * 1024);
  });
});
