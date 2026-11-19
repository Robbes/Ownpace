// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CIRRUX DRIVE'S `CXDRV2` WIRE FORMAT: the bytes a chunked upload or a replace
 * sends (workplan 0160 T5).
 *
 * Cirrux encrypts a simple upload itself. A chunked upload and EVERY replace
 * are encrypted by the client: Cirrux hands over a per-file `data_key` and
 * presigned part URLs, and *"your client does the AES-256-GCM chunk encryption
 * itself, so plaintext never touches Cirrux"* (`https://cirrux.co/help/api/drive`,
 * *Large files* and *Replace a file's contents*, read 2026-11-19). So this file
 * is the format, as that page states it, and nothing more:
 *
 * - **The object** is a 16-byte header followed by the chunks.
 * - **The header**: the 8 magic bytes `CXDRV2` plus two zero bytes, the format
 *   version (1 byte, `1`), the algorithm id (1 byte, `1` for AES-256-GCM),
 *   `chunk_size_bytes` as a little-endian u32, and 2 zero bytes. It goes in
 *   front of the first chunk.
 * - **Each chunk**: a fresh 12-byte IV, the AES-256-GCM ciphertext of up to
 *   `chunk_size_bytes` of plaintext, and the 16-byte tag.
 * - **The AAD**, 56 bytes per chunk: the file's `file_uuid` as 16 raw bytes,
 *   then the chunk index, the chunk count and that chunk's plaintext size as
 *   little-endian u32s, then zero padding. Always the `file_uuid`, never the
 *   `version_uuid`, including for a replace.
 *
 * ## What the page does not say, and what this file does about it
 *
 * Each is written down in workplan 0160 §6, and each fails LOUDLY if it is
 * wrong: Cirrux's `complete` decrypts the first chunk and refuses an upload it
 * cannot decrypt (`422 undecryptable_content`), discarding it, and a replace
 * leaves the live file as it was.
 *
 * - **Where the chunk index starts.** Not stated. Zero here, as an index
 *   (the part numbers, which the page does number from 1, are a different
 *   count). The first chunk's AAD carries it, so a wrong guess is refused on
 *   the first `complete`, never stored.
 * - **Which part carries the header.** The object is header-then-chunks and
 *   the header *"goes in front of the first chunk"*, so part 1 is the header
 *   and chunk 0, and part `n` is chunk `n − 1`: one part per chunk, which is
 *   the count `chunk_count` names. Checked against Cirrux's own
 *   `ciphertext_size_bytes` before a byte is read (`expectedCiphertextBytes`).
 * - **The UUID's bytes.** A UUID's 16 bytes in the order its text writes them
 *   (RFC 9562), the only reading of "16 raw bytes" for a UUID given as text.
 *
 * ## Streaming, never the whole file
 *
 * `encryptedParts` reads the plaintext as it is handed over and yields one
 * part at a time, holding one chunk of plaintext (5 MiB by Cirrux's answer)
 * and its ciphertext, never the file. A source that hands over more or fewer
 * bytes than it promised is refused: the chunk count and the ciphertext size
 * were declared to Cirrux before the first byte was read.
 */

import { createCipheriv, randomBytes } from 'node:crypto';

/** `CXDRV2` and two zero bytes. */
export const CXDRV2_MAGIC = Uint8Array.from([0x43, 0x58, 0x44, 0x52, 0x56, 0x32, 0x00, 0x00]);
export const CXDRV2_FORMAT_VERSION = 1;
/** The algorithm id for AES-256-GCM. */
export const CXDRV2_ALGORITHM_AES_256_GCM = 1;
export const CXDRV2_HEADER_BYTES = 16;
export const CXDRV2_IV_BYTES = 12;
export const CXDRV2_TAG_BYTES = 16;
export const CXDRV2_AAD_BYTES = 56;
/** What a chunk adds to its plaintext: the IV in front, the tag behind. */
export const CXDRV2_CHUNK_OVERHEAD_BYTES = CXDRV2_IV_BYTES + CXDRV2_TAG_BYTES;
/** Where the first chunk's index starts. Not stated by Cirrux; see the header. */
export const CXDRV2_FIRST_CHUNK_INDEX = 0;

const U32_MAX = 0xffff_ffff;

/** The 16-byte header for a chunk size. */
export function cxdrv2Header(chunkSizeBytes: number): Uint8Array {
  assertU32(chunkSizeBytes, 'chunk_size_bytes');
  if (chunkSizeBytes === 0) throw new Error('chunk_size_bytes must be at least 1');
  const header = new Uint8Array(CXDRV2_HEADER_BYTES);
  header.set(CXDRV2_MAGIC, 0);
  header[8] = CXDRV2_FORMAT_VERSION;
  header[9] = CXDRV2_ALGORITHM_AES_256_GCM;
  new DataView(header.buffer).setUint32(10, chunkSizeBytes, true);
  // Bytes 14 and 15 stay zero.
  return header;
}

/** A UUID's 16 bytes, in the order its text writes them. */
export function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.trim().toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Not a UUID, so it cannot be the file's 16 raw bytes: ${JSON.stringify(uuid)}`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** The 56 bytes of additional data one chunk is authenticated with. */
export function cxdrv2ChunkAad(
  fileUuid: string,
  chunkIndex: number,
  chunkCount: number,
  plaintextSizeBytes: number,
): Uint8Array {
  assertU32(chunkIndex, 'the chunk index');
  assertU32(chunkCount, 'the chunk count');
  assertU32(plaintextSizeBytes, "the chunk's plaintext size");
  const aad = new Uint8Array(CXDRV2_AAD_BYTES);
  aad.set(uuidBytes(fileUuid), 0);
  const view = new DataView(aad.buffer);
  view.setUint32(16, chunkIndex, true);
  view.setUint32(20, chunkCount, true);
  view.setUint32(24, plaintextSizeBytes, true);
  // Bytes 28 to 55 stay zero: the padding.
  return aad;
}

/** How many chunks a file of this size is cut into. A 0-byte file has none. */
export function cxdrv2ChunkCount(plaintextSizeBytes: number, chunkSizeBytes: number): number {
  if (plaintextSizeBytes === 0) return 0;
  return Math.ceil(plaintextSizeBytes / chunkSizeBytes);
}

/**
 * The size of the whole object for a file: the header, and each chunk's
 * plaintext with its IV and tag. Compared with Cirrux's own
 * `ciphertext_size_bytes` before anything is sent, so a disagreement about
 * the format is a refusal here rather than a `422 upload_size_mismatch` after
 * the whole file has gone.
 */
export function expectedCiphertextBytes(plaintextSizeBytes: number, chunkSizeBytes: number): number {
  const chunks = cxdrv2ChunkCount(plaintextSizeBytes, chunkSizeBytes);
  return CXDRV2_HEADER_BYTES + chunks * CXDRV2_CHUNK_OVERHEAD_BYTES + plaintextSizeBytes;
}

/** Encrypt one chunk: a fresh IV, the ciphertext, the tag, in that order. */
export function encryptCxdrv2Chunk(p: {
  readonly key: Uint8Array;
  readonly fileUuid: string;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly plaintext: Uint8Array;
  /** Only tests name the IV; everything else gets a fresh random one. */
  readonly iv?: Uint8Array;
}): Uint8Array {
  if (p.key.byteLength !== 32) {
    throw new Error(`An AES-256-GCM key is 32 bytes; this data_key is ${p.key.byteLength}.`);
  }
  const iv = p.iv ?? randomBytes(CXDRV2_IV_BYTES);
  if (iv.byteLength !== CXDRV2_IV_BYTES) throw new Error(`A chunk's IV is ${CXDRV2_IV_BYTES} bytes.`);
  const cipher = createCipheriv('aes-256-gcm', p.key, iv, { authTagLength: CXDRV2_TAG_BYTES });
  cipher.setAAD(cxdrv2ChunkAad(p.fileUuid, p.chunkIndex, p.chunkCount, p.plaintext.byteLength));
  const body = Buffer.concat([cipher.update(p.plaintext), cipher.final()]);
  const out = new Uint8Array(CXDRV2_IV_BYTES + body.byteLength + CXDRV2_TAG_BYTES);
  out.set(iv, 0);
  out.set(body, CXDRV2_IV_BYTES);
  out.set(cipher.getAuthTag(), CXDRV2_IV_BYTES + body.byteLength);
  return out;
}

/**
 * The per-file key Cirrux hands over, as bytes.
 *
 * *"a per-file `data_key` (base64, over TLS)"*: which base64, the page does not
 * say, and it uses both elsewhere (a download's `data` is URL-safe without
 * padding). Either alphabet is read, padded or not, and anything that is not
 * exactly 32 bytes is refused.
 */
export function dataKeyBytes(dataKey: string): Uint8Array {
  const normal = dataKey.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]+$/.test(normal)) {
    throw new Error('Cirrux handed over a data_key that is not base64, so nothing can be encrypted with it.');
  }
  const key = Uint8Array.from(Buffer.from(normal, 'base64'));
  if (key.byteLength !== 32) {
    throw new Error(
      `Cirrux handed over a data_key of ${key.byteLength} bytes; an AES-256-GCM key is 32, so nothing ` +
        'was encrypted with it.',
    );
  }
  return key;
}

/** One part of the object: its number (from 1, as Cirrux numbers them) and its bytes. */
export interface Cxdrv2Part {
  readonly partNumber: number;
  readonly bytes: Uint8Array;
}

/**
 * The object's parts, encrypted as the plaintext arrives.
 *
 * Holds one chunk of plaintext and its ciphertext at a time. Part 1 is the
 * header and chunk 0 (see the file's header). Refuses a stream that ends early
 * or runs long: Cirrux was told the size before the first byte was read.
 */
export async function* encryptedParts(p: {
  readonly plaintext: ReadableStream<Uint8Array>;
  readonly plaintextSizeBytes: number;
  readonly chunkSizeBytes: number;
  readonly key: Uint8Array;
  readonly fileUuid: string;
  /** Where the file's name goes in a refusal. */
  readonly path: string;
}): AsyncGenerator<Cxdrv2Part, void, undefined> {
  const count = cxdrv2ChunkCount(p.plaintextSizeBytes, p.chunkSizeBytes);
  const buffer = new Uint8Array(Math.min(p.chunkSizeBytes, Math.max(p.plaintextSizeBytes, 1)));
  let filled = 0;
  let index = 0;
  let read = 0;
  const reader = p.plaintext.getReader();
  let drained = false;

  const part = (plaintext: Uint8Array): Cxdrv2Part => {
    const chunk = encryptCxdrv2Chunk({
      key: p.key,
      fileUuid: p.fileUuid,
      chunkIndex: CXDRV2_FIRST_CHUNK_INDEX + index,
      chunkCount: count,
      plaintext,
    });
    const partNumber = index + 1;
    index += 1;
    if (partNumber !== 1) return { partNumber, bytes: chunk };
    const withHeader = new Uint8Array(CXDRV2_HEADER_BYTES + chunk.byteLength);
    withHeader.set(cxdrv2Header(p.chunkSizeBytes), 0);
    withHeader.set(chunk, CXDRV2_HEADER_BYTES);
    return { partNumber, bytes: withHeader };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        drained = true;
        break;
      }
      read += value.byteLength;
      if (read > p.plaintextSizeBytes) {
        throw new Error(
          `${p.path} handed over more than the ${p.plaintextSizeBytes} bytes it promised, so the upload ` +
            'was stopped: Cirrux was told the size before the first byte was read.',
        );
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(value.byteLength - offset, buffer.byteLength - filled);
        buffer.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === buffer.byteLength) {
          // A copy, because the buffer is filled again for the next chunk
          // while this part may still be in flight.
          yield part(buffer.slice(0, filled));
          filled = 0;
        }
      }
    }
    if (filled > 0) yield part(buffer.slice(0, filled));
    if (read !== p.plaintextSizeBytes || index !== count) {
      throw new Error(
        `${p.path} handed over ${read} of the ${p.plaintextSizeBytes} bytes it promised, so the upload ` +
          'was stopped: Cirrux was told the size before the first byte was read.',
      );
    }
  } finally {
    // Stopped early (a part refused, a stream that ran long): the source is
    // told, so a download behind it does not hold its connection open.
    if (!drained) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function assertU32(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw new Error(`${what} must be a whole number from 0 to ${U32_MAX}; got ${value}.`);
  }
}
