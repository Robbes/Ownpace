// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A zip read where it lies (workplan 0116 D7, decided C on 2026-09-20).
 *
 * ## Why a third reader
 *
 * This repository already reads zips twice: `scripts/drive-export-members.ts`
 * reads a container's central directory to name the members that moved
 * between two exports, and `packages/shared/src/container-hash.ts` inflates
 * every member of a `.docx` to hash its content rather than its container.
 * Both hold the whole file in memory and stop at the sentinels a zip64 archive
 * puts in the fields too narrow for it — which is exactly right for a
 * document of a few megabytes, and exactly wrong for a Google Takeout or an
 * Apple export, which is somebody's whole photo library in parts of up to
 * fifty gigabytes.
 *
 * So this one reads the archive **where it lies**, through a random-access
 * source, never the whole thing: the end record from the tail, the central
 * directory from where that record points, and one member's bytes at a time
 * from its local header, inflated as a stream. On the appliance the source is
 * a file; on the managed edition it is whatever answers a byte range — which
 * is the seam the managed transport (D7's second half) plugs into.
 *
 * ## What it decides, and what it refuses
 *
 * - **Only reads.** Nothing here writes a zip. A parser that gets something
 *   wrong fails to produce a member, loudly, on an archive nothing is being
 *   written to — the blast radius that made an own reader defensible over a
 *   dependency (0116 §"What D7 is actually choosing between").
 * - **Store and deflate**, the two methods every zip writer emits and the
 *   only two these exports use. Any other method is refused *per member*, by
 *   number, when that member is opened — not by pretending the archive as a
 *   whole cannot be read.
 * - **ZIP64**, because a part over 4 GB carries the extended records, and a
 *   photo library does.
 * - **A split (spanned) archive is refused with a sentence**, from the end
 *   record's own disk fields. The workplan wanted to measure whether a
 *   multi-part export is a set of independent zips or one archive split
 *   across files before choosing a reader; with this refusal the product
 *   answers that on the first real export instead of a guess deciding it.
 * - **Every member is checked** against the CRC-32 and the size the central
 *   directory recorded, at the end of its stream. A truncated part, a
 *   half-downloaded archive or a flipped byte is a sentence rather than a
 *   photo with the wrong bytes in it.
 *
 * ## What it does not do (yet)
 *
 * Encryption (no export uses it), and multi-part exports as a set — that is
 * the tree layer's job, which opens each part as its own archive and unions
 * them, because each Takeout part is a complete zip with its own directory.
 */

import { createInflateRaw } from 'node:zlib';
import { crc32 } from './crc32.ts';
import { Readable, Transform, pipeline } from 'node:stream';
import { open as openFile, stat } from 'node:fs/promises';

/**
 * Bytes on demand, by offset. The whole point of this reader is that this is
 * the ONLY way it touches the archive.
 */
export interface RandomAccessSource {
  /** Total length in bytes. */
  readonly size: number;
  /**
   * Exactly `length` bytes from `offset`. A short read is an error here, not a
   * partial answer: the caller asked for a header or a member it knows the
   * size of, and a header cut short is a corrupt archive, not a smaller one.
   */
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * A file on disk as a random-access source (the appliance route).
 *
 * HOLDS NOTHING BETWEEN READS: every read opens the file, reads and closes
 * it. A `FileSource` has no close hook — a pass's deps close the ledger's
 * pool and nothing else (`deps-lifecycle.ts`) — so a source that kept a
 * descriptor open for the archive's lifetime would leak one per pass until
 * the source was garbage-collected, with Node's warning about it each time.
 * Three more syscalls per megabyte is the price, and it is nothing next to
 * inflating the megabyte; it also makes this source behave exactly as the
 * managed edition's will, where every read is a range request anyway.
 */
export async function openFileSource(path: string): Promise<RandomAccessSource> {
  const info = await stat(path);
  if (!info.isFile()) throw new ZipUnreadable(`${path} is not a file.`);
  return {
    size: info.size,
    async read(offset, length) {
      const handle = await openFile(path, 'r');
      try {
        const buffer = new Uint8Array(length);
        let filled = 0;
        while (filled < length) {
          const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
          if (bytesRead === 0) {
            throw new ZipUnreadable(
              `The archive ended ${length - filled} byte(s) short of what its own directory promised at offset ${offset + filled}.`,
            );
          }
          filled += bytesRead;
        }
        return buffer;
      } finally {
        await handle.close();
      }
    },
    async close() {},
  };
}

/**
 * A zip that cannot be read, with the sentence to show.
 *
 * Distinct from a programming error on purpose, the way `ArchiveUnreadable`
 * is: the caller renders `reason` and never turns it into an empty archive.
 */
export class ZipUnreadable extends Error {
  /** Declared rather than a constructor parameter property: `erasableSyntaxOnly`. */
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.name = 'ZipUnreadable';
    this.reason = reason;
  }
}

/** The two methods this reader inflates. Anything else is refused by number. */
export const ZIP_METHOD_STORED = 0;
export const ZIP_METHOD_DEFLATE = 8;

/** One member, as the central directory describes it. Nothing here has read its bytes. */
export interface ZipEntry {
  /** The path inside the archive, `/`-separated, as the writer spelled it. */
  readonly name: string;
  /** A directory placeholder: a name ending in `/`, no bytes worth reading. */
  readonly isDirectory: boolean;
  /** The compression method number: 0 stored, 8 deflated, anything else refused on open. */
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** CRC-32 of the uncompressed bytes, checked at the end of every read. */
  readonly crc32: number;
  /** Where the local header sits in the source. */
  readonly localHeaderOffset: number;
  /**
   * The DOS date and time words the writer stamped, packed date-above-time so
   * one number orders as a date would. A zip stamps LOCAL time with no zone,
   * so this is deliberately not a `Date`: whoever reads it decides what zone
   * the writer was in (0116 found Apple's stamps consistent with US Pacific).
   */
  readonly dosStamp: number;
  /** The general-purpose flags word, for callers that need bit 11 (UTF-8 names) or bit 0 (encrypted). */
  readonly flags: number;
}

export interface ZipArchive {
  readonly entries: ReadonlyArray<ZipEntry>;
  /** Whether the archive carried the zip64 records (a part over 4 GB, or a writer that always emits them). */
  readonly zip64: boolean;
  /** The member's uncompressed bytes as a stream, verified against the directory's CRC-32 and size at the end. */
  open(entry: ZipEntry): Promise<ReadableStream<Uint8Array>>;
  /**
   * The member's uncompressed bytes in one buffer. Refuses BEFORE reading a
   * member the directory says is larger than `maxBytes`, so a caller that
   * buffers cannot be walked into holding a 20 GB video by a manifest it never
   * looked at. Default 256 MiB — an item, not a library.
   */
  read(entry: ZipEntry, maxBytes?: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD64_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_BYTES = 22;
const EOCD64_LOCATOR_BYTES = 20;
const EOCD64_BYTES = 56;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const MAX_COMMENT = 0xffff;

const SENTINEL_16 = 0xffff;
const SENTINEL_32 = 0xffffffff;
const ZIP64_EXTRA_ID = 0x0001;
const FLAG_UTF8 = 0x0800;
const FLAG_ENCRYPTED = 0x0001;

/** A central directory beyond this is not a photo library, it is a mistake. */
const MAX_CENTRAL_DIRECTORY_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_READ_BYTES = 256 * 1024 * 1024;
/** How much of a member is asked for per source read while streaming. */
const STREAM_CHUNK_BYTES = 1024 * 1024;

const SPLIT_SENTENCE =
  'This archive is split across several files (a spanned zip): its directory lives in another part. ' +
  'Ownpace reads each part of an export as a complete zip of its own, which is how Google and Apple ' +
  'deliver them — so this is either a different tool’s output or a part of a set that was joined wrong.';

function u16(view: DataView, at: number): number {
  return view.getUint16(at, true);
}
function u32(view: DataView, at: number): number {
  return view.getUint32(at, true);
}
function u64(view: DataView, at: number): number {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipUnreadable(`A zip64 field holds ${value}, beyond what this reader can address.`);
  }
  return Number(value);
}

/**
 * Scan back for the end-of-central-directory record.
 *
 * Backwards, because the record sits at the very end UNLESS the file carries a
 * trailing comment whose length is only readable from inside the record. The
 * first candidate whose comment length lands exactly on the end of the file
 * wins; a signature that merely occurs inside a comment does not fit and is
 * passed over. A zip comment is at most 0xffff bytes, so the scan is bounded.
 */
function findEndOfCentralDirectory(tail: Uint8Array, tailStart: number): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let loose = -1;
  for (let at = tail.byteLength - EOCD_BYTES; at >= 0; at -= 1) {
    if (u32(view, at) !== EOCD_SIGNATURE) continue;
    const commentLength = u16(view, at + 20);
    if (at + EOCD_BYTES + commentLength === tail.byteLength) return tailStart + at;
    if (loose < 0) loose = tailStart + at;
  }
  return loose;
}

interface Directory {
  readonly entries: number;
  readonly offset: number;
  readonly size: number;
  readonly zip64: boolean;
}

/** The end record, and the zip64 records when the end record says to look for them. */
async function readDirectoryLocation(source: RandomAccessSource): Promise<Directory> {
  if (source.size < EOCD_BYTES) throw new ZipUnreadable('This is not a zip archive: it is shorter than a zip’s end record.');
  const tailLength = Math.min(source.size, EOCD_BYTES + MAX_COMMENT);
  const tailStart = source.size - tailLength;
  const tail = await source.read(tailStart, tailLength);
  const eocdAt = findEndOfCentralDirectory(tail, tailStart);
  if (eocdAt < 0) throw new ZipUnreadable('This is not a zip archive: no end-of-central-directory record was found.');

  const eocd = new DataView(tail.buffer, tail.byteOffset + (eocdAt - tailStart), EOCD_BYTES);
  const thisDisk = u16(eocd, 4);
  const directoryDisk = u16(eocd, 6);
  const entries = u16(eocd, 10);
  const size = u32(eocd, 12);
  const offset = u32(eocd, 16);

  const wantsZip64 =
    thisDisk === SENTINEL_16 ||
    directoryDisk === SENTINEL_16 ||
    entries === SENTINEL_16 ||
    size === SENTINEL_32 ||
    offset === SENTINEL_32;

  if (!wantsZip64) {
    if (thisDisk !== 0 || directoryDisk !== 0) throw new ZipUnreadable(SPLIT_SENTENCE);
    return { entries, offset, size, zip64: false };
  }

  // The zip64 locator sits immediately before the end record.
  const locatorAt = eocdAt - EOCD64_LOCATOR_BYTES;
  if (locatorAt < 0) throw new ZipUnreadable('This archive claims zip64 records but has no room for the locator.');
  const locatorBytes = await source.read(locatorAt, EOCD64_LOCATOR_BYTES);
  const locator = new DataView(locatorBytes.buffer, locatorBytes.byteOffset, locatorBytes.byteLength);
  if (u32(locator, 0) !== EOCD64_LOCATOR_SIGNATURE) {
    throw new ZipUnreadable('This archive claims zip64 records but its zip64 locator is missing or malformed.');
  }
  const totalDisks = u32(locator, 16);
  if (totalDisks !== 1 || u32(locator, 4) !== 0) throw new ZipUnreadable(SPLIT_SENTENCE);
  const eocd64At = u64(locator, 8);
  if (eocd64At + EOCD64_BYTES > source.size) throw new ZipUnreadable('This archive’s zip64 end record lies beyond the end of the file.');

  const eocd64Bytes = await source.read(eocd64At, EOCD64_BYTES);
  const eocd64 = new DataView(eocd64Bytes.buffer, eocd64Bytes.byteOffset, eocd64Bytes.byteLength);
  if (u32(eocd64, 0) !== EOCD64_SIGNATURE) throw new ZipUnreadable('This archive’s zip64 end record has no signature where the locator points.');
  if (u32(eocd64, 16) !== 0 || u32(eocd64, 20) !== 0) throw new ZipUnreadable(SPLIT_SENTENCE);
  return {
    entries: u64(eocd64, 32),
    size: u64(eocd64, 40),
    offset: u64(eocd64, 48),
    zip64: true,
  };
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

/**
 * A name as the writer spelled it. Bit 11 says UTF-8 outright; without it the
 * spec says CP437, which nobody writing a photo export uses — so a name that
 * is valid UTF-8 is read as UTF-8, and only one that is not falls back to a
 * byte-per-character decoding rather than to replacement characters.
 */
function decodeName(bytes: Uint8Array, flags: number): string {
  if (flags & FLAG_UTF8) return utf8.decode(bytes);
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/** The zip64 extra field, which carries only the values whose narrow field holds a sentinel — in a fixed order. */
function readZip64Extra(
  extra: DataView,
  sizes: { uncompressedSize: number; compressedSize: number; localHeaderOffset: number; disk: number },
): typeof sizes {
  let at = 0;
  while (at + 4 <= extra.byteLength) {
    const id = u16(extra, at);
    const length = u16(extra, at + 2);
    const body = at + 4;
    if (id === ZIP64_EXTRA_ID) {
      let cursor = body;
      const take64 = (): number => {
        if (cursor + 8 > body + length) throw new ZipUnreadable('A member’s zip64 extra field is shorter than the sentinels it must fill.');
        const value = u64(extra, cursor);
        cursor += 8;
        return value;
      };
      const out = { ...sizes };
      if (sizes.uncompressedSize === SENTINEL_32) out.uncompressedSize = take64();
      if (sizes.compressedSize === SENTINEL_32) out.compressedSize = take64();
      if (sizes.localHeaderOffset === SENTINEL_32) out.localHeaderOffset = take64();
      if (sizes.disk === SENTINEL_16) {
        if (cursor + 4 > body + length) throw new ZipUnreadable('A member’s zip64 extra field is shorter than the sentinels it must fill.');
        out.disk = u32(extra, cursor);
      }
      return out;
    }
    at = body + length;
  }
  return sizes;
}

function parseCentralDirectory(bytes: Uint8Array, expected: number): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < expected; i += 1) {
    if (at + CENTRAL_HEADER_BYTES > bytes.byteLength) {
      throw new ZipUnreadable(`The central directory claims ${expected} members but entry ${i + 1} runs past its end.`);
    }
    if (u32(view, at) !== CENTRAL_SIGNATURE) {
      throw new ZipUnreadable(`Central directory entry ${i + 1} has no header signature.`);
    }
    const flags = u16(view, at + 8);
    const method = u16(view, at + 10);
    const dosStamp = u16(view, at + 14) * 0x10000 + u16(view, at + 12);
    const crc = u32(view, at + 16);
    const nameLength = u16(view, at + 28);
    const extraLength = u16(view, at + 30);
    const commentLength = u16(view, at + 32);
    const nameAt = at + CENTRAL_HEADER_BYTES;
    const extraAt = nameAt + nameLength;
    const next = extraAt + extraLength + commentLength;
    if (next > bytes.byteLength) {
      throw new ZipUnreadable(`Central directory entry ${i + 1} has a name or extra field running past the end.`);
    }
    const narrow = {
      compressedSize: u32(view, at + 20),
      uncompressedSize: u32(view, at + 24),
      disk: u16(view, at + 34),
      localHeaderOffset: u32(view, at + 42),
    };
    const wide = readZip64Extra(new DataView(bytes.buffer, bytes.byteOffset + extraAt, extraLength), narrow);
    if (wide.disk !== 0) throw new ZipUnreadable(SPLIT_SENTENCE);
    const name = decodeName(bytes.subarray(nameAt, nameAt + nameLength), flags);
    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      method,
      compressedSize: wide.compressedSize,
      uncompressedSize: wide.uncompressedSize,
      crc32: crc,
      localHeaderOffset: wide.localHeaderOffset,
      dosStamp,
      flags,
    });
    at = next;
  }
  return entries;
}

/** A transform that counts and checks: the directory promised a CRC and a size, and the bytes must agree. */
function verifying(entry: ZipEntry): Transform {
  let seen = 0;
  let running = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.byteLength;
      running = crc32(chunk, running);
      if (seen > entry.uncompressedSize) {
        callback(
          new ZipUnreadable(
            `Member ${entry.name} produced more than the ${entry.uncompressedSize} bytes its directory entry promised.`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (seen !== entry.uncompressedSize) {
        callback(
          new ZipUnreadable(
            `Member ${entry.name} produced ${seen} bytes where its directory entry promised ${entry.uncompressedSize}: the archive is truncated or corrupt.`,
          ),
        );
        return;
      }
      if (running !== entry.crc32) {
        callback(
          new ZipUnreadable(
            `Member ${entry.name} failed its CRC-32 check: the bytes are not the ones the archive recorded.`,
          ),
        );
        return;
      }
      callback();
    },
  });
}

/** Open a zip through a random-access source. The source is the archive's; `close()` closes it. */
export async function openZip(source: RandomAccessSource): Promise<ZipArchive> {
  const directory = await readDirectoryLocation(source);
  if (directory.size > MAX_CENTRAL_DIRECTORY_BYTES) {
    throw new ZipUnreadable(`This archive’s central directory is ${directory.size} bytes, beyond what this reader will hold.`);
  }
  if (directory.offset + directory.size > source.size) {
    throw new ZipUnreadable('This archive’s central directory lies beyond the end of the file: a download that stopped early looks like this.');
  }
  const entries = parseCentralDirectory(await source.read(directory.offset, directory.size), directory.entries);

  async function dataStart(entry: ZipEntry): Promise<number> {
    if (entry.localHeaderOffset + LOCAL_HEADER_BYTES > source.size) {
      throw new ZipUnreadable(`Member ${entry.name}’s local header lies beyond the end of the file.`);
    }
    const header = await source.read(entry.localHeaderOffset, LOCAL_HEADER_BYTES);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (u32(view, 0) !== LOCAL_SIGNATURE) {
      throw new ZipUnreadable(`Member ${entry.name} has no local header where the directory points.`);
    }
    // The LOCAL name and extra lengths, which may differ from the directory's
    // (a zip64 extra can be present in one and not the other).
    const start = entry.localHeaderOffset + LOCAL_HEADER_BYTES + u16(view, 26) + u16(view, 28);
    if (start + entry.compressedSize > source.size) {
      throw new ZipUnreadable(`Member ${entry.name} runs past the end of the file: the archive is truncated.`);
    }
    return start;
  }

  async function* compressedChunks(from: number, length: number): AsyncGenerator<Buffer> {
    let read = 0;
    while (read < length) {
      const step = Math.min(STREAM_CHUNK_BYTES, length - read);
      const chunk = await source.read(from + read, step);
      read += step;
      yield Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
  }

  const archive: ZipArchive = {
    entries,
    zip64: directory.zip64,

    async open(entry) {
      if (entry.flags & FLAG_ENCRYPTED) {
        throw new ZipUnreadable(`Member ${entry.name} is encrypted, and no export this product reads is.`);
      }
      if (entry.method !== ZIP_METHOD_STORED && entry.method !== ZIP_METHOD_DEFLATE) {
        throw new ZipUnreadable(
          `Member ${entry.name} uses compression method ${entry.method}, which this reader does not inflate (only stored and deflated members).`,
        );
      }
      const start = await dataStart(entry);
      const raw = Readable.from(compressedChunks(start, entry.compressedSize));
      const check = verifying(entry);
      const stages: Array<NodeJS.ReadableStream | NodeJS.ReadWriteStream> =
        entry.method === ZIP_METHOD_DEFLATE ? [raw, createInflateRaw(), check] : [raw, check];
      // `pipeline` forwards an error anywhere in the chain to every stage, so
      // the web stream a caller reads from errors rather than ending early.
      pipeline(stages as [NodeJS.ReadableStream, ...NodeJS.ReadWriteStream[]], () => {
        // Errors surface on `check`, which the web stream below reflects.
      });
      return Readable.toWeb(check) as ReadableStream<Uint8Array>;
    },

    async read(entry, maxBytes = DEFAULT_MAX_READ_BYTES) {
      if (entry.uncompressedSize > maxBytes) {
        throw new ZipUnreadable(
          `Member ${entry.name} is ${entry.uncompressedSize} bytes, more than the ${maxBytes} this read will hold; stream it instead.`,
        );
      }
      const out = new Uint8Array(entry.uncompressedSize);
      let at = 0;
      const stream = await archive.open(entry);
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        out.set(chunk, at);
        at += chunk.byteLength;
      }
      return out;
    },

    close: () => source.close(),
  };
  return archive;
}
