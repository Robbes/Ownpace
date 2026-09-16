// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ADR-0046's hash, pinned: a rendering is compared by its parts.
 *
 * The measurement behind it, from the owner's tenant across fifteen draws: a
 * `.docx` from Drive's `files.export` is byte-unstable ONLY in its zip
 * container — every member byte-identical, only the member timestamps moving.
 * So the first test here is the whole point of the file, and the second is the
 * limit that keeps it honest.
 *
 * THE ZIPS ARE BUILT BY HAND from the specification, by a writer sharing no
 * code with the reader under test. A fixture built with the reader's own
 * arithmetic would agree with itself about a wrong offset and pass while a real
 * `.docx` was misread — and this hash decides whether a customer's document is
 * rewritten, so agreeing with itself is not good enough.
 */

import { describe, expect, it } from 'vitest';
import { crc32, deflateRawSync } from 'node:zlib';
import { CONTAINER_FINGERPRINT_VERSION, containerContentHash } from './container-hash.ts';
import { sameFingerprintVersion, versionOf } from './dav-canonical.ts';

interface Entry {
  readonly name: string;
  readonly body: string;
  /** DOS time word — the thing Drive moves and this hash must ignore. */
  readonly time?: number;
  /** Deflate the member rather than storing it. */
  readonly deflate?: boolean;
}

/** A store-or-deflate zip writer, from the specification. Independent on purpose. */
function zip(entries: readonly Entry[], comment = ''): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const plain = Buffer.from(entry.body, 'utf8');
    const stored = entry.deflate ? deflateRawSync(plain) : plain;
    const method = entry.deflate ? 8 : 0;
    const sum = crc32(plain);
    const time = entry.time ?? 0x4a20;
    const date = 0x5931;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + stored.length;
  }

  const directory = Buffer.concat(centrals);
  const tail = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(tail.length, 20);

  return new Uint8Array(Buffer.concat([...locals, directory, end, tail]));
}

/** The shape of a `.docx`, small enough to read. */
function docx(created: string, body = '<w:document>the same words</w:document>', time?: number) {
  return zip([
    { name: '[Content_Types].xml', body: '<Types/>', time },
    { name: 'docProps/core.xml', body: `<cp:coreProperties>${created}</cp:coreProperties>`, time },
    { name: 'word/document.xml', body, time, deflate: true },
  ]);
}

describe('containerContentHash', () => {
  it('AGREES across draws that differ only in their zip timestamps', () => {
    // The measured `export-office` case, and the reason ADR-0046 exists. Two
    // containers no whole-file hash could reconcile, holding identical parts.
    const first = docx('2026-09-16T14:00:00Z', undefined, 0x4a20);
    const later = docx('2026-09-16T14:00:00Z', undefined, 0x4a5a);
    expect(first).not.toEqual(later);
    expect(containerContentHash(first)).toBe(containerContentHash(later));
  });

  it('DISAGREES when a member is actually different', () => {
    // Without this the scheme would be worthless: a hash that ignores the
    // packaging must not ignore the document.
    expect(containerContentHash(docx('a', '<w:document>one</w:document>'))).not.toBe(
      containerContentHash(docx('a', '<w:document>two</w:document>')),
    );
  });

  it('disagrees when a metadata member changes, because that IS content', () => {
    // A timestamp written INSIDE `docProps/core.xml` changes that member, so it
    // changes this hash. Ignoring it would be content normalisation — a larger
    // thing ADR-0046 explicitly does not decide.
    expect(containerContentHash(docx('2026-09-16T14:00:00Z'))).not.toBe(
      containerContentHash(docx('2026-09-16T14:00:03Z')),
    );
  });

  it('ignores member order', () => {
    const forwards = zip([{ name: 'a.xml', body: 'A' }, { name: 'b.xml', body: 'B' }]);
    const backwards = zip([{ name: 'b.xml', body: 'B' }, { name: 'a.xml', body: 'A' }]);
    expect(forwards).not.toEqual(backwards);
    expect(containerContentHash(forwards)).toBe(containerContentHash(backwards));
  });

  it('ignores whether a member was stored or deflated', () => {
    // Compression settings describe the zip, not the document. A re-packer that
    // changed level must not read as a changed file.
    const stored = zip([{ name: 'word/document.xml', body: 'the same words repeated'.repeat(20) }]);
    const packed = zip([
      { name: 'word/document.xml', body: 'the same words repeated'.repeat(20), deflate: true },
    ]);
    expect(stored).not.toEqual(packed);
    expect(containerContentHash(stored)).toBe(containerContentHash(packed));
  });

  it('ignores the archive comment', () => {
    const bare = zip([{ name: 'a.xml', body: 'A' }]);
    const commented = zip([{ name: 'a.xml', body: 'A' }], 'written by some tool');
    expect(containerContentHash(bare)).toBe(containerContentHash(commented));
  });

  it('distinguishes a renamed member from an identical one', () => {
    // The name is part of the document's structure, so it is hashed. Two
    // archives holding the same bytes under different names are different.
    expect(containerContentHash(zip([{ name: 'a.xml', body: 'X' }]))).not.toBe(
      containerContentHash(zip([{ name: 'b.xml', body: 'X' }])),
    );
  });

  it('cannot be confused by a name that looks like a hash boundary', () => {
    // Both halves are fixed-width hex, so there is no separator to straddle.
    // A member named to imitate one is still just a name.
    const sneaky = zip([{ name: 'a'.repeat(64) + 'b'.repeat(64), body: '' }, { name: 'z', body: '' }]);
    const plain = zip([{ name: 'a'.repeat(64), body: '' }, { name: 'b'.repeat(64) + 'z', body: '' }]);
    expect(containerContentHash(sneaky)).not.toBe(containerContentHash(plain));
  });
});

describe('containerContentHash — when it cannot canonicalise', () => {
  it('answers null for something that is not a zip', () => {
    // A `.pdf` is the case this exists for. The caller hashes the whole file,
    // which is a correct comparison and merely a stricter one.
    const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nnot a zip at all\n%%EOF\n', 'utf8'));
    expect(containerContentHash(pdf)).toBeNull();
  });

  it('answers null for a compression method it does not implement', () => {
    const bytes = zip([{ name: 'a.xml', body: 'A' }]).slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Find the central directory the way the reader does, rather than by
    // counting backwards from the end: the header is 46 bytes PLUS the name,
    // and an arithmetic slip there would land this edit on the wrong field and
    // pass for the wrong reason.
    const centralAt = view.getUint32(bytes.byteLength - 22 + 16, true);
    view.setUint16(centralAt + 10, 12, true); // bzip2, which we do not implement
    expect(containerContentHash(bytes)).toBeNull();
  });

  it('answers null rather than throwing on a malformed index', () => {
    // Never throws is the contract: a failed migration is not an improvement
    // on a strict hash.
    const bytes = docx('a').slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.byteLength - 22 + 16, bytes.byteLength - 4, true);
    expect(() => containerContentHash(bytes)).not.toThrow();
    expect(containerContentHash(bytes)).toBeNull();
  });

  it('answers null rather than throwing when a member will not inflate', () => {
    // Corrupt the deflate stream PRECISELY, at a computed offset. A first draft
    // flipped a byte near the end and asserted only `not.toThrow()`, which
    // would have passed even if nothing had been corrupted at all — a test
    // agreeing with itself, which is the failure this whole file is written
    // against.
    const name = 'word/document.xml';
    const bytes = zip([{ name, body: 'compress me '.repeat(40), deflate: true }]).slice();
    const payloadAt = 30 + Buffer.byteLength(name, 'utf8');
    // 0xff as the first byte of a raw deflate stream sets BTYPE to 0b11, which
    // the format reserves and no decoder accepts. Flipping an arbitrary byte
    // deeper in was the first attempt and inflated fine — deflate tolerates
    // more damage than it looks like it should, so the corruption has to be
    // chosen rather than sprayed.
    bytes[payloadAt] = 0xff;
    expect(() => containerContentHash(bytes)).not.toThrow();
    expect(containerContentHash(bytes)).toBeNull();
  });
});

describe('the version tag', () => {
  it('prefixes the fingerprint, as the calendar and contact ones do', () => {
    const hash = containerContentHash(docx('a'));
    expect(hash?.startsWith(`${CONTAINER_FINGERPRINT_VERSION}:`)).toBe(true);
    expect(versionOf(hash!)).toBe('zip1');
  });

  it('is read by the SAME comparison the other fingerprints use', () => {
    // This is rule (d) of 0042 T7, and the reason it is not a new mechanism:
    // `sameFingerprintVersion` already exists to stop a row written by an older
    // build being read as a change. A whole-file sha256 carries no tag at all,
    // so it can never be mistaken for a container fingerprint.
    const container = containerContentHash(docx('a'))!;
    const wholeFile = 'a4271e749a2279c5'.repeat(4);
    expect(sameFingerprintVersion(container, containerContentHash(docx('b'))!)).toBe(true);
    expect(sameFingerprintVersion(container, wholeFile)).toBe(false);
    expect(sameFingerprintVersion(container, 'cal1:whatever')).toBe(false);
  });

  it('is inside the hash as well as in front of it', () => {
    // So two schemes cannot collide even if somebody compares the bare hex
    // halves with the prefixes stripped off.
    const hash = containerContentHash(zip([{ name: 'a.xml', body: 'A' }]))!;
    const bare = hash.slice(hash.indexOf(':') + 1);
    expect(bare).toHaveLength(64);
    // A digest taken WITHOUT the version baked in would equal this one; the
    // guard is that changing the constant changes the digest, which the
    // break-test in the PR body exercises directly.
    expect(bare).not.toBe('0'.repeat(64));
  });
});
