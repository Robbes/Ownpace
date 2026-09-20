// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The tree seam on its own (workplan 0116 D7, second slice): what the zip
 * tree and the folder tree each promise, apart from any reader. The reader's
 * own tests (`takeout-archive-reader.unit.test.ts`) prove the two answer the
 * same over one fixture; this file pins the properties that make that true
 * and the ones the reader never exercises — the folders a zip only implies,
 * a name met in two parts, a member name that looks like a path, a read that
 * refuses before it reads.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readdir, readlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFolderTree, openZipTree, zipTreeOf } from './archive-tree.ts';
import { openZip } from './zip-archive.ts';
import { buildZip, memorySource } from './zip-test-writer.ts';

const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return utf8(Buffer.concat(chunks));
}

const inMemory = (files: Parameters<typeof buildZip>[0]) => openZip(memorySource(buildZip(files)));

describe('the zip tree', () => {
  it('implies every folder from the member names, with or without directory placeholders', async () => {
    // Two writers, two habits: one emits `Takeout/` as a member, one emits no
    // directory entries at all. A tree that trusted the placeholders would
    // see nothing under the second.
    const withPlaceholders = zipTreeOf([
      await inMemory([
        { name: 'Takeout/', data: '' },
        { name: 'Takeout/Google Photos/', data: '' },
        { name: 'Takeout/Google Photos/Album/a.jpg', data: 'a' },
      ]),
    ]);
    const without = zipTreeOf([await inMemory([{ name: 'Takeout/Google Photos/Album/a.jpg', data: 'a' }])]);
    for (const tree of [withPlaceholders, without]) {
      expect(await tree.isDirectory('')).toBe(true);
      expect(await tree.isDirectory('Takeout')).toBe(true);
      expect(await tree.isDirectory('Takeout/Google Photos')).toBe(true);
      expect(await tree.isDirectory('Takeout/Google Photos/Album')).toBe(true);
      expect(await tree.isDirectory('Takeout/Google Photos/Album/a.jpg')).toBe(false);
      expect(await tree.isDirectory('Takeout/Nowhere')).toBe(false);
      expect(await tree.list('Takeout/Google Photos')).toEqual([{ name: 'Album', isDirectory: true }]);
      expect(await tree.list('Takeout/Google Photos/Album')).toEqual([{ name: 'a.jpg', isDirectory: false }]);
      expect(utf8(await tree.read('Takeout/Google Photos/Album/a.jpg'))).toBe('a');
      await tree.close();
    }
  });

  it('answers a path spelled with a leading or trailing slash the same way', async () => {
    const tree = zipTreeOf([await inMemory([{ name: 'Takeout/Google Photos/Album/a.jpg', data: 'a' }])]);
    expect(await tree.isDirectory('/Takeout/Google Photos/')).toBe(true);
    expect(await tree.list('Takeout/Google Photos/Album/')).toEqual([{ name: 'a.jpg', isDirectory: false }]);
    await tree.close();
  });

  it('joins several parts into one tree, and the first part answers for a name met twice', async () => {
    const one = await inMemory([
      { name: 'Takeout/archive_browser.html', data: 'from part one' },
      { name: 'Takeout/Google Photos/Album/a.jpg', data: 'a' },
    ]);
    const two = await inMemory([
      { name: 'Takeout/archive_browser.html', data: 'from part two' },
      { name: 'Takeout/Google Photos/Photos from 2019/b.jpg', data: 'b' },
    ]);
    const tree = zipTreeOf([one, two]);
    expect((await tree.list('Takeout/Google Photos')).map((e) => e.name).sort()).toEqual([
      'Album',
      'Photos from 2019',
    ]);
    expect(utf8(await tree.read('Takeout/Google Photos/Photos from 2019/b.jpg'))).toBe('b');
    expect(utf8(await tree.read('Takeout/archive_browser.html'))).toBe('from part one');
    await tree.close();
  });

  it('treats a member name as a key, so a name shaped like a path escape reaches nothing', async () => {
    // The name is looked up in a map built from the members; it is never
    // joined onto anything on disk. What comes back is the member's own
    // bytes, and a name that is not a member is simply absent.
    const tree = zipTreeOf([await inMemory([{ name: '../../etc/passwd', data: 'just a member' }])]);
    expect(utf8(await tree.read('../../etc/passwd'))).toBe('just a member');
    await expect(tree.read('etc/passwd')).rejects.toThrow(/not in this archive/);
    await tree.close();
  });

  it('refuses a whole-file read larger than the cap before reading a byte, and streams it instead', async () => {
    const source = memorySource(buildZip([{ name: 'big.bin', data: 'x'.repeat(1000), method: 'store' }]));
    const tree = zipTreeOf([await openZip(source)]);
    const before = source.bytesRead();
    await expect(tree.read('big.bin', 100)).rejects.toThrow(/stream it instead/);
    expect(source.bytesRead(), 'the refusal read the member anyway').toBe(before);
    expect((await drain(await tree.stream('big.bin'))).length).toBe(1000);
    await tree.close();
  });

  it('is absent for a missing member or folder, by sentence', async () => {
    const tree = zipTreeOf([await inMemory([{ name: 'Takeout/a.txt', data: 'a' }])]);
    await expect(tree.read('Takeout/b.txt')).rejects.toThrow(/not in this archive/);
    await expect(tree.stream('Takeout/b.txt')).rejects.toThrow(/not in this archive/);
    await expect(tree.list('Nowhere')).rejects.toThrow(/not a folder/);
    await tree.close();
  });

  it('holds no descriptor between reads, so a tree nobody closes leaks nothing (Linux, by /proc)', async () => {
    // A pass never closes its `FileSource` (`deps-lifecycle.ts` closes the
    // ledger's pool and nothing else), so a tree that kept a descriptor open
    // would leak one per pass. Counted by what /proc says points at the zip,
    // not by the number of descriptors, so nothing else the worker does can
    // move the number.
    if (process.platform !== 'linux') return;
    const dir = await mkdtemp(join(tmpdir(), 'zip-fd-'));
    try {
      const path = join(dir, 'part-001.zip');
      await writeFile(path, buildZip([{ name: 'Takeout/a.txt', data: 'a'.repeat(5000), method: 'deflate' }]));
      const pointingAtZip = async (): Promise<number> => {
        const links = await Promise.all(
          (await readdir('/proc/self/fd')).map((fd) => readlink(`/proc/self/fd/${fd}`).catch(() => '')),
        );
        return links.filter((target) => target === path).length;
      };
      const tree = await openZipTree([path]);
      expect(await pointingAtZip(), 'a descriptor held after the directory was read').toBe(0);
      expect((await tree.list('Takeout')).map((e) => e.name)).toEqual(['a.txt']);
      expect((await drain(await tree.stream('Takeout/a.txt'))).length).toBe(5000);
      expect(utf8(await tree.read('Takeout/a.txt')).length).toBe(5000);
      // Deliberately never closed.
      expect(await pointingAtZip(), 'a descriptor held after the reads finished').toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('closes every part it opened, and everything it opened before a part that would not open', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zip-tree-'));
    try {
      const good = join(dir, 'part-001.zip');
      const bad = join(dir, 'part-002.zip');
      await writeFile(good, buildZip([{ name: 'Takeout/a.txt', data: 'a' }]));
      await writeFile(bad, Buffer.from('this is not a zip'));
      await expect(openZipTree([good, bad])).rejects.toThrow(/not a zip archive/);
      // And a set that does open reads across both.
      await writeFile(bad, buildZip([{ name: 'Takeout/b.txt', data: 'b' }]));
      const tree = await openZipTree([good, bad]);
      expect((await tree.list('Takeout')).map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt']);
      await tree.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the folder tree', () => {
  it('answers the same five questions over a folder on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'folder-tree-'));
    try {
      await mkdir(join(dir, 'Takeout', 'Google Photos', 'Album'), { recursive: true });
      await writeFile(join(dir, 'Takeout', 'Google Photos', 'Album', 'a.jpg'), 'a');
      const tree = openFolderTree(dir);
      expect(await tree.isDirectory('')).toBe(true);
      expect(await tree.isDirectory('Takeout/Google Photos')).toBe(true);
      expect(await tree.isDirectory('Takeout/Google Photos/Album/a.jpg')).toBe(false);
      expect(await tree.isDirectory('Takeout/Nowhere')).toBe(false);
      expect(await tree.list('Takeout/Google Photos')).toEqual([{ name: 'Album', isDirectory: true }]);
      expect(await tree.list('Takeout/Google Photos/Album')).toEqual([{ name: 'a.jpg', isDirectory: false }]);
      expect(utf8(await tree.read('Takeout/Google Photos/Album/a.jpg'))).toBe('a');
      expect(await drain(await tree.stream('Takeout/Google Photos/Album/a.jpg'))).toBe('a');
      await expect(tree.read('Takeout/Google Photos/Album/a.jpg', 0)).rejects.toThrow(/stream it instead/);
      await expect(tree.read('Takeout/Google Photos/Album/b.jpg')).rejects.toThrow();
      await expect(tree.stream('Takeout/Google Photos/Album/b.jpg')).rejects.toThrow();
      await expect(tree.read('Takeout/Google Photos/Album')).rejects.toThrow(/not a file/);
      await tree.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
