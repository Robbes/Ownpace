// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CIRRUX'S `CXDRV2` FORMAT, AS THE PAGE STATES IT (workplan 0160 T5).
 *
 * Three kinds of proof, because Cirrux publishes no test vector:
 *
 * 1. **The bytes the page names, named here byte by byte**: the header and the
 *    56-byte AAD.
 * 2. **A known-answer vector computed outside the encoder**: the object below
 *    was built with WebCrypto by a stand-alone script written from the page's
 *    wire-format paragraph (key 0x00..0x1f, UUID
 *    0f1e2d3c-4b5a-4968-8778-a1b2c3d4e5f6, chunk size 8, the 20 bytes
 *    `Cirrux Drive vector!`, IV of chunk i the twelve bytes 16i..16i+11). The
 *    encoder, given the same IVs, must produce exactly it.
 * 3. **A round trip through a decryptor written from the page**
 *    (`__testing__/cirrux-fake.ts`'s `decryptCxdrv2`, which shares no code with
 *    the encoder), at the sizes where chunking goes wrong: one byte, a chunk
 *    less one, a chunk, a chunk more one, several chunks and a remainder.
 *
 * What none of them proves: that Cirrux reads the page as this does. The
 * chunk index's base is the one reading the page leaves open (workplan 0160
 * §6); a wrong one is refused by Cirrux's own `complete`, which decrypts the
 * first chunk, and T2b's live replace is where it is measured.
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CXDRV2_FIRST_CHUNK_INDEX,
  cxdrv2ChunkAad,
  cxdrv2ChunkCount,
  cxdrv2Header,
  dataKeyBytes,
  encryptCxdrv2Chunk,
  encryptedParts,
  expectedCiphertextBytes,
  uuidBytes,
} from './cirrux-drive-format.ts';
import { decryptCxdrv2 } from './__testing__/cirrux-fake.ts';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const UUID = '0f1e2d3c-4b5a-4968-8778-a1b2c3d4e5f6';

/** Built outside the encoder, from the page (see the header). */
const VECTOR =
  '43584452563200000101080000000000000102030405060708090a0b046ba469b09de25f77bf074f49d615617dd3d0' +
  '2b9fca5d13101112131415161718191a1b0f97ee7369bf5fd0b545e1e60debc542e4405cfb7aa27912202122232425' +
  '262728292a2ba655d45194171348224523280d63fa906844b175';

function streamOf(bytes: Uint8Array, piece = 7): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(at, at + piece));
      at += piece;
    },
  });
}

async function collect(p: Parameters<typeof encryptedParts>[0]) {
  const parts: Array<{ partNumber: number; bytes: Uint8Array }> = [];
  for await (const part of encryptedParts(p)) parts.push(part);
  return parts;
}

describe('the bytes the page names', () => {
  it('writes the header: CXDRV2, two zero bytes, version 1, algorithm 1, the chunk size LE, two zero bytes', () => {
    const header = cxdrv2Header(5 * 1024 * 1024);
    expect(Buffer.from(header).toString('hex')).toBe('4358445256320000' + '01' + '01' + '00005000' + '0000');
    expect(header.byteLength).toBe(16);
  });

  it('writes the AAD: the file uuid raw, index, count and plaintext size LE, then zeros, 56 bytes in all', () => {
    const aad = cxdrv2ChunkAad(UUID, 2, 3, 4);
    expect(aad.byteLength).toBe(56);
    expect(Buffer.from(aad.subarray(0, 16)).toString('hex')).toBe(UUID.replace(/-/g, ''));
    expect(Buffer.from(aad.subarray(16, 28)).toString('hex')).toBe('02000000' + '03000000' + '04000000');
    expect([...aad.subarray(28)].every((b) => b === 0)).toBe(true);
  });

  it('starts the chunk index at zero, the one reading the page leaves open (0160 §6)', () => {
    expect(CXDRV2_FIRST_CHUNK_INDEX).toBe(0);
  });

  it('reads a UUID as its 16 bytes in the order its text writes them, and refuses what is not one', () => {
    expect(Buffer.from(uuidBytes(UUID)).toString('hex')).toBe('0f1e2d3c4b5a49688778a1b2c3d4e5f6');
    expect(() => uuidBytes('not-a-uuid')).toThrow(/Not a UUID/);
  });
});

describe('the known-answer vector, computed outside the encoder', () => {
  it('is what the encoder writes for the same key, uuid, chunk size, plaintext and IVs', () => {
    const plaintext = new TextEncoder().encode('Cirrux Drive vector!');
    const chunkSize = 8;
    const count = cxdrv2ChunkCount(plaintext.byteLength, chunkSize);
    expect(count).toBe(3);
    const pieces: Uint8Array[] = [cxdrv2Header(chunkSize)];
    for (let i = 0; i < count; i++) {
      pieces.push(
        encryptCxdrv2Chunk({
          key: KEY,
          fileUuid: UUID,
          chunkIndex: i,
          chunkCount: count,
          plaintext: plaintext.slice(i * chunkSize, (i + 1) * chunkSize),
          iv: Uint8Array.from({ length: 12 }, (_, j) => 16 * i + j),
        }),
      );
    }
    const object = Buffer.concat(pieces);
    expect(object.byteLength).toBe(expectedCiphertextBytes(plaintext.byteLength, chunkSize));
    expect(object.toString('hex')).toBe(VECTOR);
  });

  it('decrypts with the decryptor written from the page', () => {
    const plain = decryptCxdrv2({ object: Buffer.from(VECTOR, 'hex'), key: KEY, fileUuid: UUID, plaintextSizeBytes: 20 });
    expect(new TextDecoder().decode(plain)).toBe('Cirrux Drive vector!');
  });

  it('and the AAD binds the index: read with the index starting at one, it does not decrypt', () => {
    expect(() =>
      decryptCxdrv2({ object: Buffer.from(VECTOR, 'hex'), key: KEY, fileUuid: UUID, plaintextSizeBytes: 20, firstIndex: 1 }),
    ).toThrow();
  });

  it('and binds the file: another uuid does not decrypt it', () => {
    expect(() =>
      decryptCxdrv2({
        object: Buffer.from(VECTOR, 'hex'),
        key: KEY,
        fileUuid: '0f1e2d3c-4b5a-4968-8778-a1b2c3d4e5f7',
        plaintextSizeBytes: 20,
      }),
    ).toThrow();
  });
});

describe('the parts, streamed, round-tripped through the page’s own reading', () => {
  const CHUNK = 64;
  it.each([1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 7, 5 * CHUNK])('a file of %i bytes', async (size) => {
    const plaintext = randomBytes(size);
    const key = randomBytes(32);
    const parts = await collect({ plaintext: streamOf(plaintext), plaintextSizeBytes: size, chunkSizeBytes: CHUNK, key, fileUuid: UUID, path: 'f.bin' });
    expect(parts.map((p) => p.partNumber)).toEqual(Array.from({ length: cxdrv2ChunkCount(size, CHUNK) }, (_, i) => i + 1));
    // Part 1 carries the header in front of chunk 0; every other part is one chunk.
    expect(Buffer.from(parts[0]!.bytes.subarray(0, 6)).toString('latin1')).toBe('CXDRV2');
    const object = Buffer.concat(parts.map((p) => p.bytes));
    expect(object.byteLength).toBe(expectedCiphertextBytes(size, CHUNK));
    expect(Buffer.from(decryptCxdrv2({ object, key, fileUuid: UUID, plaintextSizeBytes: size })).equals(plaintext)).toBe(true);
  });

  it('gives a fresh IV to every chunk', async () => {
    const parts = await collect({
      plaintext: streamOf(new Uint8Array(4 * CHUNK)),
      plaintextSizeBytes: 4 * CHUNK,
      chunkSizeBytes: CHUNK,
      key: KEY,
      fileUuid: UUID,
      path: 'zeros.bin',
    });
    const ivs = parts.map((p, i) => Buffer.from(p.bytes.subarray(i === 0 ? 16 : 0, (i === 0 ? 16 : 0) + 12)).toString('hex'));
    expect(new Set(ivs).size).toBe(4);
  });

  it('never holds the whole file: part 1 is out before the source has been read to the end', async () => {
    const size = 20 * CHUNK;
    let pulled = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= size) return controller.close();
        controller.enqueue(new Uint8Array(CHUNK));
        pulled += CHUNK;
      },
    });
    const parts = encryptedParts({ plaintext: source, plaintextSizeBytes: size, chunkSizeBytes: CHUNK, key: KEY, fileUuid: UUID, path: 'big.bin' });
    const first = await parts.next();
    expect(first.value?.partNumber).toBe(1);
    expect(pulled).toBeLessThan(size / 2);
    await parts.return(undefined);
  });

  it('refuses a source that hands over fewer bytes than it promised', async () => {
    await expect(
      collect({ plaintext: streamOf(new Uint8Array(100)), plaintextSizeBytes: 130, chunkSizeBytes: CHUNK, key: KEY, fileUuid: UUID, path: 'short.bin' }),
    ).rejects.toThrow(/handed over 100 of the 130 bytes/);
  });

  it('refuses a source that hands over more bytes than it promised', async () => {
    await expect(
      collect({ plaintext: streamOf(new Uint8Array(200)), plaintextSizeBytes: 130, chunkSizeBytes: CHUNK, key: KEY, fileUuid: UUID, path: 'long.bin' }),
    ).rejects.toThrow(/more than the 130 bytes/);
  });
});

describe('the sizes Cirrux is told before a byte is read', () => {
  it('counts the header, and an IV and a tag per chunk', () => {
    expect(expectedCiphertextBytes(0, 8)).toBe(16);
    expect(expectedCiphertextBytes(20, 8)).toBe(16 + 3 * 28 + 20);
    expect(cxdrv2ChunkCount(0, 8)).toBe(0);
  });

  it('cuts a 2 GiB file into 410 chunks of 5 MiB, inside the 10 000 parts Cirrux takes', () => {
    expect(cxdrv2ChunkCount(2 * 1024 ** 3, 5 * 1024 * 1024)).toBe(410);
  });
});

describe('the data key', () => {
  it('reads standard and URL-safe base64, padded or not', () => {
    const key = randomBytes(32);
    expect(Buffer.from(dataKeyBytes(key.toString('base64'))).equals(key)).toBe(true);
    expect(Buffer.from(dataKeyBytes(key.toString('base64url'))).equals(key)).toBe(true);
  });

  it('refuses a key that is not 32 bytes, and one that is not base64', () => {
    expect(() => dataKeyBytes(randomBytes(16).toString('base64'))).toThrow(/16 bytes/);
    expect(() => dataKeyBytes('not base64!')).toThrow(/not base64/);
  });
});
