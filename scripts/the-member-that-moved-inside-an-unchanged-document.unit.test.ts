// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A guard that an unstable export can name the part of itself that moved.
 *
 * #963 recorded `export-office` as NOT STABLE with the same length on all five
 * draws — 17644 bytes every time, five different hashes — and offered
 * `docProps/core.xml` timestamps as the explanation. It said so plainly as a
 * hypothesis: nobody had opened the containers. `drive-export-members.ts` is
 * the opening, and this is its proof.
 *
 * THE ZIPS HERE ARE BUILT BY HAND, by a writer that shares no code with the
 * reader under test. That is the point. A test that built its fixtures with the
 * reader's own arithmetic would agree with itself about a wrong offset and pass
 * while the real `.docx` was misread. `zip()` below writes the format from the
 * specification — local headers, a central directory, an end record — with real
 * CRC-32s from `node:zlib`, so a reader that misplaces a field fails here.
 *
 * What it pins is the set of answers the instrument exists to tell apart — a
 * member whose CONTENT changed, a member that was only RESTAMPED, a container
 * that is not a zip at all — and, just as deliberately, the LIMIT of
 * `containerNormalisedHash`: it ignores the zip's own bookkeeping and nothing
 * inside a member, so a timestamp written into the XML still moves it. That
 * limit has a test of its own because an early draft of this work described
 * that hash as the normalised-hash route in 0042 T3. It is not, and a guard is
 * worth more than a corrected sentence.
 */

import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import {
  compareMembers,
  containerNormalisedHash,
  readZipMembers,
  type ZipMember,
} from './drive-export-members.ts';

interface Entry {
  readonly name: string;
  readonly body: string;
  /** The DOS time word. Anything; only ever compared. */
  readonly time?: number;
  /** The DOS date word. */
  readonly date?: number;
}

/**
 * A minimal, store-only zip writer, from the specification rather than from the
 * module under test. Deliberately independent — see the header.
 */
function zip(entries: readonly Entry[], comment = ''): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = Buffer.from(entry.body, 'utf8');
    const sum = crc32(body);
    const time = entry.time ?? 0x4a20;
    const date = entry.date ?? 0x5931;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const tail = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(tail.length, 20);

  return new Uint8Array(Buffer.concat([...locals, directory, end, tail]));
}

/** The shape of a `.docx`, small enough to read and real enough to mean something. */
function docx(created: string, body = '<w:document>the same words</w:document>'): Uint8Array {
  return zip([
    { name: '[Content_Types].xml', body: '<Types/>' },
    { name: 'docProps/core.xml', body: `<cp:coreProperties>${created}</cp:coreProperties>` },
    { name: 'word/document.xml', body },
  ]);
}

describe('readZipMembers', () => {
  it('reads every member out of the central directory', () => {
    const members = readZipMembers(docx('2026-09-16T14:00:00Z'));
    expect(members?.map((m) => m.name)).toEqual([
      '[Content_Types].xml',
      'docProps/core.xml',
      'word/document.xml',
    ]);
  });

  it('reports the uncompressed size and a real CRC-32 for each member', () => {
    const members = readZipMembers(zip([{ name: 'a.xml', body: 'hello' }]));
    expect(members?.[0]?.size).toBe(5);
    expect(members?.[0]?.crc32).toBe(crc32(Buffer.from('hello')));
  });

  it('finds the end record behind a trailing comment', () => {
    // The comment is why the scan runs backwards rather than reading a fixed
    // offset: its length lives inside the record being looked for.
    const members = readZipMembers(zip([{ name: 'a.xml', body: 'hi' }], 'written by a tool'));
    expect(members?.map((m) => m.name)).toEqual(['a.xml']);
  });

  it('answers null for a container that is not a zip, rather than throwing', () => {
    // A PDF is the case this exists for: `export-pdf` is a real policy and
    // "not a zip" is an ordinary answer on that path, not a failure.
    const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nnot a zip at all\n%%EOF\n', 'utf8'));
    expect(readZipMembers(pdf)).toBeNull();
  });

  it('refuses an index that points past the end, in words rather than a RangeError', () => {
    // Each refusal is asserted by its OWN sentence, not by a shared word. The
    // first draft matched /central directory/, which both guards satisfy — so
    // deleting the bounds check left every test green while the reader fell
    // through to a DataView RangeError. A refusal that cannot say what is
    // wrong is the failure this script's whole design argues against.
    const bytes = docx('2026-09-16T14:00:00Z').slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.byteLength - 22 + 16, bytes.byteLength - 4, true);
    expect(() => readZipMembers(bytes)).toThrow(/entry 1 runs past the end/);
  });

  it('refuses an index pointing at a local header instead of a central one', () => {
    // Offset zero is a LOCAL file header — the right shape, the wrong record.
    // Its fields sit at different offsets, so a reader that does not check the
    // signature comes back with member names and sizes that are simply wrong
    // and says nothing about it. A confident wrong list of what changed is
    // worse than no list, which is the whole reason this refuses.
    const bytes = docx('2026-09-16T14:00:00Z').slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(bytes.byteLength - 22 + 16, 0, true);
    expect(() => readZipMembers(bytes)).toThrow(/no header signature/);
  });

  it('refuses a header whose name runs off the end', () => {
    // A signature in the right place and nothing behind it: the one case that
    // gets past the first guard and has to be caught by the second.
    const bytes = docx('2026-09-16T14:00:00Z').slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Exactly a header's width from the end: the fixed part fits, so the first
    // guard passes it through and only the name overruns.
    const forged = bytes.byteLength - 46;
    view.setUint32(forged, 0x02014b50, true);
    view.setUint16(forged + 28, 8, true); // a name length that cannot fit
    view.setUint16(forged + 30, 0, true);
    view.setUint16(forged + 32, 0, true);
    view.setUint32(bytes.byteLength - 22 + 16, forged, true);
    view.setUint16(bytes.byteLength - 22 + 10, 1, true);
    expect(() => readZipMembers(bytes)).toThrow(/name running past the end/);
  });
});

describe('compareMembers', () => {
  it('names the member whose content changed, and only that one', () => {
    // The `export-office` hypothesis, stated as a measurement: the metadata
    // member moves and the document body does not.
    const verdict = compareMembers([
      readZipMembers(docx('2026-09-16T14:00:00Z'))!,
      readZipMembers(docx('2026-09-16T14:00:03Z'))!,
      readZipMembers(docx('2026-09-16T14:00:06Z'))!,
    ]);
    expect(verdict.changed).toEqual(['docProps/core.xml']);
    expect(verdict.unchanged).toBe(2);
    expect(verdict.note).toContain('does not read inside them');
  });

  it('separates a body that changed from metadata that changed', () => {
    const verdict = compareMembers([
      readZipMembers(docx('a', '<w:document>one</w:document>'))!,
      readZipMembers(docx('b', '<w:document>two</w:document>'))!,
    ]);
    expect(verdict.changed).toEqual(['docProps/core.xml', 'word/document.xml']);
  });

  it('calls a member only restamped when its content held', () => {
    // The cheapest failure there is: nothing inside the document moved, the
    // container was simply rebuilt. Worth its own word, because it is the one
    // case where no normalisation of CONTENT is needed at all.
    const first = zip([{ name: 'word/document.xml', body: 'same', time: 0x4a20 }]);
    const later = zip([{ name: 'word/document.xml', body: 'same', time: 0x4a5a }]);
    const verdict = compareMembers([readZipMembers(first)!, readZipMembers(later)!]);
    expect(verdict.changed).toEqual([]);
    expect(verdict.restamped).toEqual(['word/document.xml']);
    expect(verdict.note).toContain('byte-identical inside a rebuilt container');
  });

  it('reports a member missing from one draw as structural, above everything else', () => {
    const full = readZipMembers(docx('a'))!;
    const short = readZipMembers(zip([{ name: 'word/document.xml', body: 'the same words' }]))!;
    const verdict = compareMembers([full, short]);
    expect(verdict.absent).toContain('docProps/core.xml');
    expect(verdict.note).toContain('do not hold the same parts');
  });

  it('says the container moved when every part is identical', () => {
    const members = readZipMembers(docx('a'))!;
    const verdict = compareMembers([members, members]);
    expect(verdict.changed).toEqual([]);
    expect(verdict.restamped).toEqual([]);
    expect(verdict.note).toContain('CONTAINER');
  });

  it('refuses a single draw, which cannot disagree with anything', () => {
    // The same refusal `stabilityVerdict` makes. One draw reported as "nothing
    // changed" would read as evidence for enabling the policy.
    expect(() => compareMembers([readZipMembers(docx('a'))!])).toThrow(/at least 2 draws/);
  });
});

describe('containerNormalisedHash', () => {
  it('agrees across draws that differ only in their stamps', () => {
    // Two containers no whole-file hash could reconcile, holding one identical
    // part. This is the CONTAINER being rebuilt and nothing more.
    const first = zip([{ name: 'word/document.xml', body: 'same', time: 0x4a20 }]);
    const later = zip([{ name: 'word/document.xml', body: 'same', time: 0x4a5a }]);
    expect(first).not.toEqual(later);
    expect(containerNormalisedHash(readZipMembers(first)!)).toBe(
      containerNormalisedHash(readZipMembers(later)!),
    );
  });

  it('still moves when the timestamp is written INSIDE a member', () => {
    // The limit of this hash, pinned so the name cannot quietly grow a meaning
    // it does not have. `docProps/core.xml` carries `dcterms:modified` in its
    // XML, so a changed stamp there changes that member's CRC and this hash
    // moves with it, exactly as a whole-file hash would. Ignoring THAT is
    // content normalisation — a different, larger thing that needs a parser per
    // format, and it is the open route in 0042 T3, not something measured here.
    expect(containerNormalisedHash(readZipMembers(docx('2026-09-16T14:00:00Z'))!)).not.toBe(
      containerNormalisedHash(readZipMembers(docx('2026-09-16T14:00:03Z'))!),
    );
  });

  it('still disagrees when a member is actually different', () => {
    // Without this the route would be worthless: a hash that ignores the stamps
    // must NOT ignore the document.
    expect(containerNormalisedHash(readZipMembers(docx('a', '<w:document>one</w:document>'))!)).not.toBe(
      containerNormalisedHash(readZipMembers(docx('a', '<w:document>two</w:document>'))!),
    );
  });

  it('does not depend on the order members happen to sit in', () => {
    const forwards: ZipMember[] = [
      { name: 'b.xml', crc32: 2, size: 20, stamp: 1 },
      { name: 'a.xml', crc32: 1, size: 10, stamp: 1 },
    ];
    const backwards = [...forwards].reverse();
    expect(containerNormalisedHash(forwards)).toBe(containerNormalisedHash(backwards));
  });
});
