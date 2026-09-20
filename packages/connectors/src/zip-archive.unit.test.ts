// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The zip reader, proved against archives built to have each shape the real
 * exports have and each fault they can arrive with (workplan 0116 D7 = C).
 *
 * Every archive here is written by `zip-test-writer.ts`, which emits the
 * structures by hand; nothing round-trips through a library, because the
 * decision was to own the reader rather than depend on one, and a test that
 * trusted a dependency's writer would be trusting exactly what was declined.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openZip, openFileSource, ZipUnreadable, type ZipEntry } from './zip-archive.ts';
import { buildZip, memorySource, TEST_DOS_DATE, TEST_DOS_TIME } from './zip-test-writer.ts';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const byName = (entries: ReadonlyArray<ZipEntry>, name: string): ZipEntry => {
  const found = entries.find((e) => e.name === name);
  if (!found) throw new Error(`no entry ${name}`);
  return found;
};

/** A payload deflate can actually shrink, so a deflated member differs from a stored one on the wire. */
const PROSE = text('the same sentence, repeated so that deflate has something to do; '.repeat(40));

describe('reading members', () => {
  it('reads stored and deflated members, buffered and streamed, and flags directories', async () => {
    const bytes = buildZip([
      { name: 'Takeout/', data: '' },
      { name: 'Takeout/Google Photos/Album/IMG_0001.jpg', data: PROSE, method: 'deflate' },
      { name: 'Takeout/Google Photos/Album/IMG_0001.jpg.json', data: '{"title":"IMG_0001.jpg"}', method: 'store' },
    ]);
    const zip = await openZip(memorySource(bytes));

    expect(zip.zip64).toBe(false);
    expect(zip.entries.map((e) => e.name)).toEqual([
      'Takeout/',
      'Takeout/Google Photos/Album/IMG_0001.jpg',
      'Takeout/Google Photos/Album/IMG_0001.jpg.json',
    ]);
    expect(zip.entries[0]!.isDirectory).toBe(true);

    const photo = byName(zip.entries, 'Takeout/Google Photos/Album/IMG_0001.jpg');
    expect(photo.method).toBe(8);
    expect(photo.uncompressedSize).toBe(PROSE.byteLength);
    expect(photo.compressedSize).toBeLessThan(PROSE.byteLength);
    expect(photo.dosStamp).toBe(TEST_DOS_DATE * 0x10000 + TEST_DOS_TIME);
    expect(await zip.read(photo)).toEqual(PROSE);
    expect(await drain(await zip.open(photo))).toEqual(PROSE);

    const sidecar = byName(zip.entries, 'Takeout/Google Photos/Album/IMG_0001.jpg.json');
    expect(sidecar.method).toBe(0);
    expect(utf8(await zip.read(sidecar))).toBe('{"title":"IMG_0001.jpg"}');

    await zip.close();
  });

  it('reads a member whose sizes live in a data descriptor after the data', async () => {
    const bytes = buildZip([{ name: 'streamed.txt', data: PROSE, method: 'deflate', dataDescriptor: true }]);
    const zip = await openZip(memorySource(bytes));
    expect(await zip.read(byName(zip.entries, 'streamed.txt'))).toEqual(PROSE);
  });

  it('decodes names: bit 11 UTF-8, valid UTF-8 without the bit, and a byte-per-character fallback', async () => {
    const bytes = buildZip([
      { name: 'Vakantie – Zürich/foto.jpg', data: 'a', utf8Flag: true },
      { name: 'Vakantie – Zürich/twee.jpg', data: 'b' },
      { name: 'legacy', data: 'c', nameBytes: new Uint8Array([0x63, 0x61, 0x66, 0xe9]) },
    ]);
    const zip = await openZip(memorySource(bytes));
    expect(zip.entries.map((e) => e.name)).toEqual(['Vakantie – Zürich/foto.jpg', 'Vakantie – Zürich/twee.jpg', 'café']);
  });

  it('reads an archive that carries zip64 records and sentinels', async () => {
    const bytes = buildZip(
      [
        { name: 'big/one.bin', data: PROSE, method: 'deflate' },
        { name: 'big/two.bin', data: 'tiny' },
      ],
      { zip64: true },
    );
    const zip = await openZip(memorySource(bytes));
    expect(zip.zip64).toBe(true);
    const one = byName(zip.entries, 'big/one.bin');
    expect(one.uncompressedSize).toBe(PROSE.byteLength);
    expect(one.localHeaderOffset).toBe(0);
    expect(await zip.read(one)).toEqual(PROSE);
    expect(utf8(await zip.read(byName(zip.entries, 'big/two.bin')))).toBe('tiny');
  });

  it('finds the real end record behind a comment that contains a fake one', async () => {
    const fake = new Uint8Array(4 + 18);
    fake.set([0x50, 0x4b, 0x05, 0x06], 0);
    const comment = new Uint8Array([...text('note: '), ...fake, ...text(' end')]);
    const bytes = buildZip([{ name: 'a.txt', data: 'alpha' }], { comment });
    const zip = await openZip(memorySource(bytes));
    expect(zip.entries.map((e) => e.name)).toEqual(['a.txt']);
    expect(utf8(await zip.read(zip.entries[0]!))).toBe('alpha');
  });

  it('reads where it lies: opening and reading one small member never reads the large one', async () => {
    const large = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < large.length; i += 1) large[i] = i % 251;
    const bytes = buildZip([
      { name: 'video.mp4', data: large, method: 'store' },
      { name: 'note.json', data: '{"n":1}' },
    ]);
    const source = memorySource(bytes);
    const zip = await openZip(source);
    expect(utf8(await zip.read(byName(zip.entries, 'note.json')))).toBe('{"n":1}');
    // The tail (at most 64 KiB + 22), the directory (two entries) and the
    // small member's header and bytes — nothing of the 2 MiB member.
    expect(source.bytesRead()).toBeLessThan(bytes.byteLength / 4);
    await zip.close();
    expect(source.closed()).toBe(true);
  });

  it('works through a file on disk (the appliance route)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zip-read-'));
    try {
      const path = join(dir, 'export.zip');
      await writeFile(path, buildZip([{ name: 'f.txt', data: PROSE, method: 'deflate' }]));
      const zip = await openZip(await openFileSource(path));
      expect(await zip.read(byName(zip.entries, 'f.txt'))).toEqual(PROSE);
      await zip.close();
      await expect(openFileSource(dir)).rejects.toThrow(/is not a file/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('what it refuses, and how it says so', () => {
  it('a spanned set, by the end record’s disk fields', async () => {
    const bytes = buildZip([{ name: 'a', data: 'a' }], { spannedDisk: 1 });
    await expect(openZip(memorySource(bytes))).rejects.toThrow(/split across several files/);
  });

  it('a spanned zip64 set, by the locator’s disk count', async () => {
    const bytes = buildZip([{ name: 'a', data: 'a' }], { zip64: true, zip64TotalDisks: 2 });
    await expect(openZip(memorySource(bytes))).rejects.toThrow(/split across several files/);
  });

  it('something that is not a zip, in words rather than an empty archive', async () => {
    await expect(openZip(memorySource(text('%PDF-1.4 ' + 'x'.repeat(100))))).rejects.toThrow(
      /not a zip archive: no end-of-central-directory/,
    );
    await expect(openZip(memorySource(text('short')))).rejects.toThrow(/shorter than/);
  });

  it('a download that stopped early, before the directory', async () => {
    const whole = buildZip([{ name: 'a.txt', data: PROSE, method: 'deflate' }, { name: 'b.txt', data: 'b' }]);
    // Keep the end record, drop bytes from the middle: the record now points
    // past the end of what is there.
    const cut = new Uint8Array([...whole.subarray(0, 40), ...whole.subarray(whole.byteLength - 22)]);
    await expect(openZip(memorySource(cut))).rejects.toThrow(ZipUnreadable);
  });

  it('a member the directory promises beyond the end of the file', async () => {
    // A stored member, then the file truncated inside that member but with
    // the directory rewritten to fit: the directory is fine, the bytes are not.
    const whole = buildZip([{ name: 'a.bin', data: PROSE, method: 'store' }]);
    const zip = await openZip(memorySource(whole));
    const entry = byName(zip.entries, 'a.bin');
    const lying = { ...entry, compressedSize: entry.compressedSize + whole.byteLength };
    await expect(zip.open(lying)).rejects.toThrow(/runs past the end of the file/);
  });

  it('a compression method it does not inflate, per member and by number', async () => {
    const bytes = buildZip([
      { name: 'ok.txt', data: 'fine' },
      { name: 'bz.txt', data: 'not really bzip2', methodOverride: 12 },
    ]);
    const zip = await openZip(memorySource(bytes));
    expect(utf8(await zip.read(byName(zip.entries, 'ok.txt')))).toBe('fine');
    await expect(zip.read(byName(zip.entries, 'bz.txt'))).rejects.toThrow(/compression method 12/);
  });

  it('an encrypted member', async () => {
    const bytes = buildZip([{ name: 'secret.txt', data: 'x', encrypted: true }]);
    const zip = await openZip(memorySource(bytes));
    await expect(zip.read(zip.entries[0]!)).rejects.toThrow(/encrypted/);
  });

  it('a flipped byte in a stored member, by the CRC the directory recorded', async () => {
    const bytes = buildZip([{ name: 'a.bin', data: PROSE, method: 'store' }]);
    // The stored data begins after the 30-byte local header and the name.
    const dataAt = 30 + 'a.bin'.length;
    bytes[dataAt + 5] = bytes[dataAt + 5]! ^ 0xff;
    const zip = await openZip(memorySource(bytes));
    await expect(zip.read(zip.entries[0]!)).rejects.toThrow(/CRC-32/);
  });

  it('a flipped byte in a deflated member, rather than plausible bytes', async () => {
    const bytes = buildZip([{ name: 'a.bin', data: PROSE, method: 'deflate' }]);
    const dataAt = 30 + 'a.bin'.length;
    bytes[dataAt + 20] = bytes[dataAt + 20]! ^ 0x5a;
    const zip = await openZip(memorySource(bytes));
    await expect(zip.read(zip.entries[0]!)).rejects.toThrow();
  });

  it('a member larger than the buffered read will hold, before reading it', async () => {
    const bytes = buildZip([{ name: 'a.bin', data: PROSE, method: 'store' }]);
    const source = memorySource(bytes);
    const zip = await openZip(source);
    const before = source.bytesRead();
    await expect(zip.read(zip.entries[0]!, 16)).rejects.toThrow(/more than the 16/);
    expect(source.bytesRead()).toBe(before);
  });
});
