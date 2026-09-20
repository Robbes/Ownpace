// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A zip WRITER, for tests only — never imported by product code.
 *
 * `zip-archive.ts` only reads, deliberately (see its header). Proving a reader
 * needs archives with the shapes the real exports have — stored and deflated
 * members, data descriptors, zip64 records, a trailing comment — and the
 * shapes they must refuse — a spanned set, a truncation, a flipped byte.
 * Node ships no zip writer either, so this is the smallest one that emits
 * every structure the reader parses, with knobs to emit the wrong ones.
 *
 * Kept beside the reader rather than in `@openmig/testing` so the two cannot
 * drift apart in what "a zip64 record" means; nothing in `index.ts` exports it.
 */

import { deflateRawSync, crc32 } from 'node:zlib';
import type { RandomAccessSource } from './zip-archive.ts';

export interface ZipTestFile {
  readonly name: string;
  readonly data: Uint8Array | string;
  readonly method?: 'store' | 'deflate';
  /** Emit sizes and CRC in a data descriptor after the data (flag bit 3), zeros in the local header. */
  readonly dataDescriptor?: boolean;
  /** Set flag bit 11 (UTF-8 name). Off by default, which is how many writers spell ASCII names. */
  readonly utf8Flag?: boolean;
  /** The name as raw bytes, for a name that is not UTF-8 at all. Overrides `name` on the wire. */
  readonly nameBytes?: Uint8Array;
  /** Flag bit 0, to test the encrypted refusal. The data is not actually encrypted. */
  readonly encrypted?: boolean;
  /** The compression method number to WRITE, when testing an unsupported one (the data is stored). */
  readonly methodOverride?: number;
}

export interface ZipTestOptions {
  /** Emit zip64 records and sentinels even though nothing is large. */
  readonly zip64?: boolean;
  /** A trailing archive comment, verbatim. */
  readonly comment?: Uint8Array | string;
  /** Write these disk numbers into the end record, to simulate a spanned set. */
  readonly spannedDisk?: number;
  /** For a zip64 archive: the locator's total-disks field, to simulate a spanned set. */
  readonly zip64TotalDisks?: number;
}

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD64_SIGNATURE = 0x06064b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_SIGNATURE = 0x06054b50;

/** A fixed stamp — 2024-05-06 07:08:10 — so tests can assert the packed words. */
export const TEST_DOS_TIME = (7 << 11) | (8 << 5) | (10 >> 1);
export const TEST_DOS_DATE = ((2024 - 1980) << 9) | (5 << 5) | 6;

class Out {
  private readonly parts: Uint8Array[] = [];
  length = 0;
  u16(v: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.push(b);
  }
  u32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.push(b);
  }
  u64(v: number): void {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
    this.push(b);
  }
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.byteLength;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }
}

const encoder = new TextEncoder();

/** Build a zip with exactly the members and structures asked for. */
export function buildZip(files: ReadonlyArray<ZipTestFile>, options: ZipTestOptions = {}): Uint8Array {
  const out = new Out();
  const zip64 = options.zip64 === true;
  const central: Array<{ file: ZipTestFile; nameBytes: Uint8Array; method: number; flags: number; crc: number; csize: number; usize: number; offset: number }> = [];

  for (const file of files) {
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const nameBytes = file.nameBytes ?? encoder.encode(file.name);
    const deflate = file.method === 'deflate';
    const body = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const method = file.methodOverride ?? (deflate ? 8 : 0);
    const crc = crc32(data);
    const flags = (file.dataDescriptor ? 0x0008 : 0) | (file.utf8Flag ? 0x0800 : 0) | (file.encrypted ? 0x0001 : 0);
    const offset = out.length;

    out.u32(LOCAL_SIGNATURE);
    out.u16(zip64 ? 45 : 20);
    out.u16(flags);
    out.u16(method);
    out.u16(TEST_DOS_TIME);
    out.u16(TEST_DOS_DATE);
    out.u32(file.dataDescriptor ? 0 : crc);
    if (zip64) {
      out.u32(0xffffffff);
      out.u32(0xffffffff);
    } else {
      out.u32(file.dataDescriptor ? 0 : body.byteLength);
      out.u32(file.dataDescriptor ? 0 : data.byteLength);
    }
    out.u16(nameBytes.byteLength);
    out.u16(zip64 ? 20 : 0);
    out.push(nameBytes);
    if (zip64) {
      out.u16(0x0001);
      out.u16(16);
      out.u64(data.byteLength);
      out.u64(body.byteLength);
    }
    out.push(body);
    if (file.dataDescriptor) {
      out.u32(DESCRIPTOR_SIGNATURE);
      out.u32(crc);
      if (zip64) {
        out.u64(body.byteLength);
        out.u64(data.byteLength);
      } else {
        out.u32(body.byteLength);
        out.u32(data.byteLength);
      }
    }
    central.push({ file, nameBytes, method, flags, crc, csize: body.byteLength, usize: data.byteLength, offset });
  }

  const directoryOffset = out.length;
  for (const c of central) {
    out.u32(CENTRAL_SIGNATURE);
    out.u16(zip64 ? 45 : 20);
    out.u16(zip64 ? 45 : 20);
    out.u16(c.flags);
    out.u16(c.method);
    out.u16(TEST_DOS_TIME);
    out.u16(TEST_DOS_DATE);
    out.u32(c.crc);
    out.u32(zip64 ? 0xffffffff : c.csize);
    out.u32(zip64 ? 0xffffffff : c.usize);
    out.u16(c.nameBytes.byteLength);
    out.u16(zip64 ? 32 : 0);
    out.u16(0);
    out.u16(zip64 ? 0xffff : 0);
    out.u16(0);
    out.u32(0);
    out.u32(zip64 ? 0xffffffff : c.offset);
    out.push(c.nameBytes);
    if (zip64) {
      out.u16(0x0001);
      out.u16(28);
      out.u64(c.usize);
      out.u64(c.csize);
      out.u64(c.offset);
      out.u32(0);
    }
  }
  const directorySize = out.length - directoryOffset;

  const comment = typeof options.comment === 'string' ? encoder.encode(options.comment) : (options.comment ?? new Uint8Array(0));

  if (zip64) {
    const eocd64Offset = out.length;
    out.u32(EOCD64_SIGNATURE);
    out.u64(44);
    out.u16(45);
    out.u16(45);
    out.u32(0);
    out.u32(0);
    out.u64(central.length);
    out.u64(central.length);
    out.u64(directorySize);
    out.u64(directoryOffset);
    out.u32(EOCD64_LOCATOR_SIGNATURE);
    out.u32(0);
    out.u64(eocd64Offset);
    out.u32(options.zip64TotalDisks ?? 1);
    out.u32(EOCD_SIGNATURE);
    out.u16(0xffff);
    out.u16(0xffff);
    out.u16(0xffff);
    out.u16(0xffff);
    out.u32(0xffffffff);
    out.u32(0xffffffff);
    out.u16(comment.byteLength);
    out.push(comment);
  } else {
    const disk = options.spannedDisk ?? 0;
    out.u32(EOCD_SIGNATURE);
    out.u16(disk);
    out.u16(disk);
    out.u16(central.length);
    out.u16(central.length);
    out.u32(directorySize);
    out.u32(directoryOffset);
    out.u16(comment.byteLength);
    out.push(comment);
  }
  return out.bytes();
}

/** A source over bytes in memory that records every read, to prove what was NOT read. */
export function memorySource(bytes: Uint8Array): RandomAccessSource & {
  readonly reads: Array<{ offset: number; length: number }>;
  bytesRead(): number;
  closed(): boolean;
} {
  const reads: Array<{ offset: number; length: number }> = [];
  let closed = false;
  return {
    size: bytes.byteLength,
    reads,
    bytesRead: () => reads.reduce((n, r) => n + r.length, 0),
    closed: () => closed,
    async read(offset, length) {
      reads.push({ offset, length });
      if (offset + length > bytes.byteLength) {
        throw new Error(`short read: ${offset}+${length} > ${bytes.byteLength}`);
      }
      return bytes.slice(offset, offset + length);
    },
    async close() {
      closed = true;
    },
  };
}
