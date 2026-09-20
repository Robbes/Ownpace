// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE INSIDE THE CUSTOMER'S TARGET, READ IN PLACE (workplan 0116 T4,
 * the relay's first slice).
 *
 * A WebDAV server in memory answers PROPFIND and GET the way Nextcloud does —
 * percent-encoded hrefs under the account root, a trailing slash on a
 * collection, `206` with the asked bytes for a `Range` — and the Takeout
 * reader is pointed at the two Info-ZIP parts sitting in it, and at the
 * extracted folder sitting in it. Both must answer exactly what the reader
 * answers over the same fixture on disk: the store is a seam, and a seam that
 * changed the answer would import a different library on the managed edition
 * than on the appliance.
 *
 * Then the two things a real server can get wrong: one that answers a range
 * request with the whole file (refused by sentence rather than downloading a
 * gigabyte to read a kilobyte), and the read-ahead, counted, so a 25 GB
 * library is not twenty-five thousand requests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchiveUnreadable, type ArchiveHandle } from '@openmig/core/archive-reader';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { localStore, type ArchiveStore } from './archive-store.ts';
import { createTakeoutArchiveReader } from './takeout-archive-reader.ts';
import { openRangeSource, parseMultistatus, webdavStore } from './webdav-archive-store.ts';
import { buildZip } from './zip-test-writer.ts';

const FIXTURES = fileURLToPath(new URL('../../../test/e2e/fixtures/', import.meta.url));
const FOLDER = `${FIXTURES}takeout`;
const PART_ONE = readFileSync(`${FIXTURES}takeout-zip/takeout-20240506T070810Z-001.zip`);
const PART_TWO = readFileSync(`${FIXTURES}takeout-zip/takeout-20240506T070810Z-002.zip`);

const BASE = 'https://cloud.example.test/remote.php/dav/files/rob/';
const ENDPOINT = { url: BASE, username: 'rob', password: 'app-password' };

/** A WebDAV server in memory: files by `/`-path under the account root; folders are implied. */
class FakeDav implements HttpClient {
  readonly files = new Map<string, Uint8Array>();
  readonly requests: HttpRequestOptions[] = [];
  ignoresRanges = false;

  put(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes);
  }

  /** The fixture folder on disk, served under `prefix`. */
  putTree(dir: string, prefix: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const at = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) this.putTree(full, at);
      else this.put(at, readFileSync(full));
    }
  }

  rangeRequests(): HttpRequestOptions[] {
    return this.requests.filter((r) => r.method === 'GET' && r.headers?.Range !== undefined);
  }

  private pathOf(url: string): string {
    if (!url.startsWith(BASE)) throw new Error(`a request left the account root: ${url}`);
    return decodeURIComponent(url.slice(BASE.length)).replace(/^\/+|\/+$/g, '');
  }

  private isFolder(path: string): boolean {
    if (path === '') return true;
    return [...this.files.keys()].some((k) => k.startsWith(`${path}/`));
  }

  private childrenOf(folder: string): Array<{ name: string; folder: boolean; size?: number }> {
    const out = new Map<string, { name: string; folder: boolean; size?: number }>();
    for (const [key, bytes] of this.files) {
      if (folder !== '' && !key.startsWith(`${folder}/`)) continue;
      const rest = folder === '' ? key : key.slice(folder.length + 1);
      const head = rest.split('/')[0]!;
      if (rest.includes('/')) out.set(head, { name: head, folder: true });
      else out.set(head, { name: head, folder: false, size: bytes.byteLength });
    }
    return [...out.values()];
  }

  private response(path: string, folder: boolean, size?: number): string {
    const href = `/remote.php/dav/files/rob/${path.split('/').filter(Boolean).map(encodeURIComponent).join('/')}${folder ? '/' : ''}`;
    return (
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
      `<d:resourcetype>${folder ? '<d:collection/>' : ''}</d:resourcetype>` +
      (size === undefined ? '' : `<d:getcontentlength>${size}</d:getcontentlength>`) +
      `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    );
  }

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.requests.push(options);
    if (!options.headers?.Authorization?.startsWith('Basic ')) return { status: 401, body: '', headers: {} };
    const path = this.pathOf(options.url);
    if (options.method === 'PROPFIND') {
      const file = this.files.get(path);
      const folder = file === undefined && this.isFolder(path);
      if (file === undefined && !folder) return { status: 404, body: 'not found', headers: {} };
      const responses = [this.response(path, folder, file?.byteLength)];
      if (folder && options.headers?.Depth === '1') {
        for (const child of this.childrenOf(path)) {
          responses.push(this.response(path === '' ? child.name : `${path}/${child.name}`, child.folder, child.size));
        }
      }
      return {
        status: 207,
        body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses.join('')}</d:multistatus>`,
        headers: { 'content-type': 'application/xml' },
      };
    }
    if (options.method === 'GET') {
      const bytes = this.files.get(path);
      if (!bytes) return { status: 404, body: 'not found', headers: {} };
      const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers?.Range ?? '');
      if (range && !this.ignoresRanges) {
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), bytes.byteLength - 1);
        return {
          status: 206,
          body: '',
          bodyBytes: bytes.slice(start, end + 1),
          headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
        };
      }
      return options.stream
        ? { status: 200, body: '', bodyStream: new Blob([new Uint8Array(bytes)]).stream(), headers: {} }
        : { status: 200, body: '', bodyBytes: bytes, headers: {} };
    }
    return { status: 405, body: '', headers: {} };
  }
}

/** Everything the reader says about an archive, in an order that does not depend on where it is. */
async function listing(store: ArchiveStore, path: string) {
  const reader = createTakeoutArchiveReader(store);
  const handle: ArchiveHandle = await reader.open({ provider: 'google-takeout', path });
  try {
    const items = [];
    for await (const item of reader.items(handle)) items.push(item);
    items.sort((a, b) => a.contentHash.localeCompare(b.contentHash));
    const bytes: Record<string, string> = {};
    for (const item of items) bytes[item.path] = Buffer.from(await reader.content(handle, item)).toString('hex');
    const streamed: Record<string, string> = {};
    for (const item of items) {
      const chunks: Uint8Array[] = [];
      for await (const c of (await reader.contentStream!(handle, item)) as unknown as AsyncIterable<Uint8Array>) chunks.push(c);
      streamed[item.path] = Buffer.concat(chunks).toString('hex');
    }
    return { items, summary: await reader.summary(handle), bytes, streamed };
  } finally {
    await handle.close();
  }
}

describe('a multistatus, as servers spell it', () => {
  it('reads hrefs, collections and sizes under any prefix', () => {
    const entries = parseMultistatus(
      '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/files/rob/Photos%20export/</D:href>' +
        '<D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>' +
        '<D:response><D:href>https://cloud.example.test/dav/files/rob/Photos%20export/a.zip</D:href>' +
        '<D:propstat><D:prop><D:resourcetype/><D:getcontentlength>1316</D:getcontentlength></D:prop></D:propstat></D:response>' +
        '</D:multistatus>',
    );
    expect(entries).toEqual([
      { path: '/dav/files/rob/Photos export', isCollection: true, size: undefined },
      { path: '/dav/files/rob/Photos export/a.zip', isCollection: false, size: 1316 },
    ]);
  });
});

describe('the Takeout reader over a file target', () => {
  it('reads the two-part download inside the target exactly as it reads it on disk', async () => {
    const dav = new FakeDav();
    dav.put('Ownpace import/takeout-20240506T070810Z-001.zip', PART_ONE);
    dav.put('Ownpace import/takeout-20240506T070810Z-002.zip', PART_TWO);
    const onDisk = await listing(localStore(), FOLDER);
    expect(onDisk.items).toHaveLength(3);
    const inTarget = await listing(webdavStore(ENDPOINT, dav), 'Ownpace import/takeout-20240506T070810Z-001.zip');
    expect(inTarget).toEqual(onDisk);
    // Never a whole-file GET: every byte of the archive came by range.
    expect(dav.requests.filter((r) => r.method === 'GET' && !r.headers?.Range)).toHaveLength(0);
  });

  it('reads a folder the person extracted into their target exactly as it reads it on disk', async () => {
    const dav = new FakeDav();
    dav.putTree(FOLDER, 'Photos export');
    const onDisk = await listing(localStore(), FOLDER);
    expect(await listing(webdavStore(ENDPOINT, dav), 'Photos export')).toEqual(onDisk);
  });

  it('names the target when nothing is at the path', async () => {
    const dav = new FakeDav();
    const reader = createTakeoutArchiveReader(webdavStore(ENDPOINT, dav));
    const err = await reader
      .open({ provider: 'google-takeout', path: 'Ownpace import/takeout-20240506T070810Z-001.zip' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toContain('nothing is at');
    expect((err as ArchiveUnreadable).reason).toContain(`${BASE}Ownpace%20import/takeout-20240506T070810Z-001.zip`);
  });

  it('refuses a target that answers a byte-range request with the whole file', async () => {
    const dav = new FakeDav();
    dav.ignoresRanges = true;
    dav.put('takeout-20240506T070810Z-001.zip', PART_ONE);
    const reader = createTakeoutArchiveReader(webdavStore(ENDPOINT, dav));
    const err = await reader.open({ provider: 'google-takeout', path: 'takeout-20240506T070810Z-001.zip' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveUnreadable);
    expect((err as ArchiveUnreadable).reason).toMatch(/byte-range request with the whole file/);
  });
});

describe('the read-ahead', () => {
  const clip = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
  const archive = buildZip([{ name: 'Takeout/Google Photos/Photos from 2024/clip.mp4', data: clip, method: 'store' }]);

  async function streamThrough(dav: FakeDav, windowBytes?: number): Promise<number> {
    dav.put('takeout-20240506T070810Z-001.zip', archive);
    const store = webdavStore(ENDPOINT, dav, windowBytes === undefined ? {} : { windowBytes });
    const reader = createTakeoutArchiveReader(store);
    const handle = await reader.open({ provider: 'google-takeout', path: 'takeout-20240506T070810Z-001.zip' });
    try {
      let total = 0;
      for await (const item of reader.items(handle)) {
        for await (const c of (await reader.contentStream!(handle, item)) as unknown as AsyncIterable<Uint8Array>) total += c.byteLength;
      }
      return total;
    } finally {
      await handle.close();
    }
  }

  it('fetches windows, so a member read in 1 MiB steps is one request and not three', async () => {
    const dav = new FakeDav();
    expect(await streamThrough(dav)).toBe(clip.byteLength);
    // The walk hashes the member once and the stream reads it again; each
    // pass is the tail (end record and directory) plus one window over the
    // member, never a request per step.
    expect(dav.rangeRequests().length).toBeLessThanOrEqual(4);
    const fetched = dav.rangeRequests().reduce((n, r) => {
      const m = /^bytes=(\d+)-(\d+)$/.exec(r.headers!.Range!)!;
      return n + (Number(m[2]) - Number(m[1]) + 1);
    }, 0);
    expect(fetched, 'more than twice the archive was fetched to read it twice').toBeLessThanOrEqual(2 * archive.byteLength + 2 * 65_557);
  });

  it('with a window the size of a step, every step is a request', async () => {
    const dav = new FakeDav();
    expect(await streamThrough(dav, 1024 * 1024)).toBe(clip.byteLength);
    expect(dav.rangeRequests().length).toBeGreaterThanOrEqual(6);
  });

  it('shares ONE read-ahead budget across every source the store opens', async () => {
    // The wiring claim, and the one a per-source budget cannot make: a
    // multi-part download is opened all at once (`openZipTree` needs every
    // part's central directory), so the ceiling has to be the STORE's, not
    // each source's. Two windows' worth of budget, five parts.
    const dav = new FakeDav();
    for (let i = 0; i < 5; i += 1) dav.put(`part-${i}.bin`, new Uint8Array(4096).fill(i + 1));
    const store = webdavStore(ENDPOINT, dav, { windowBytes: 1024, budgetBytes: 2048 });

    const sources = [];
    for (let i = 0; i < 5; i += 1) {
      const source = await store.source(`part-${i}.bin`);
      expect([...(await source.read(0, 4))]).toEqual([i + 1, i + 1, i + 1, i + 1]);
      sources.push(source);
    }
    const afterOpening = dav.rangeRequests().length;

    // The part just read still has its window: no request.
    await sources[4]!.read(4, 4);
    expect(dav.rangeRequests().length, 'the live window was evicted').toBe(afterOpening);

    // The first part's window is long gone — five parts, two windows — so it
    // fetches again, and gets ITS OWN bytes back, not a neighbour's.
    const again = await sources[0]!.read(0, 4);
    expect(dav.rangeRequests().length, 'a stale window survived a five-part open').toBe(afterOpening + 1);
    expect([...again], 'the refetch read the wrong part').toEqual([1, 1, 1, 1]);

    await Promise.all(sources.map((s) => s.close()));
  });

  it('refuses a read beyond the file, and serves inside the window from memory', async () => {
    const dav = new FakeDav();
    dav.put('a.bin', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const requestsOf = (): number => dav.rangeRequests().length;
    const source = openRangeSource(
      {
        request: (method, path, options) => dav.request({ url: `${BASE}${path}`, method, headers: { Authorization: 'Basic x', ...(options?.headers ?? {}) } }),
        url: (path) => `${BASE}${path}`,
      },
      'a.bin',
      8,
      { windowBytes: 4 },
    );
    expect([...(await source.read(0, 2))]).toEqual([1, 2]);
    expect([...(await source.read(2, 2))]).toEqual([3, 4]);
    expect(requestsOf()).toBe(1);
    expect([...(await source.read(4, 4))]).toEqual([5, 6, 7, 8]);
    expect(requestsOf()).toBe(2);
    await expect(source.read(6, 4)).rejects.toThrow(/beyond the 8-byte archive/);
    await source.close();
  });
});
