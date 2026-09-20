// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE INSIDE THE CUSTOMER'S OWN FILE TARGET (workplan 0116 T4, the
 * relay's first slice; owner 2026-09-20: "I pick Relay").
 *
 * On the managed edition a pass has no disk of its own to read an export
 * from. What it does have is the customer's file target — the WebDAV account
 * the migration writes into — and a `.zip` the person put there (by the relay
 * of the next slice, or by any means of their own) can be read IN PLACE:
 * the zip reader asks for bytes by offset, and a WebDAV server answers a
 * `Range` request with exactly those bytes. Nothing of the archive is ever
 * ours to hold, which is the whole point.
 *
 * Three things live here, all over one `HttpClient` (the DAV connectors'
 * seam, so a test can be a fake server and a pass the real one):
 *
 * - {@link openRangeSource}: a `RandomAccessSource` over one file. The zip
 *   reader reads a member in 1 MiB steps; the source fetches READ-AHEAD
 *   WINDOWS (8 MiB by default) so a 25 GB library is a few thousand requests
 *   rather than twenty-five thousand. A server that answers a `Range` request
 *   with the whole file (200 rather than 206) is refused by sentence: the
 *   alternative is downloading a gigabyte to read a kilobyte.
 * - {@link webdavStore}: the store seam over a target — what is at a path,
 *   what sits beside it, a folder as a tree, a file as a source.
 * - the folder tree, for a person who extracted the export INTO their
 *   target: the same five questions, answered by PROPFIND and GET.
 *
 * Paths are `/`-separated and relative to the endpoint's URL, never leading
 * with one; each segment is percent-encoded on the wire and decoded on the
 * way back, so an album called `Photos from 2024` round-trips.
 */

import { Readable } from 'node:stream';
import type { HttpClient, HttpResponse } from './dav-http.types.ts';
import { DEFAULT_TREE_READ_BYTES, type ArchiveTree, type TreeEntry } from './archive-tree.ts';
import { joinStorePath, splitStorePath, type ArchiveStore, type StoreEntry } from './archive-store.ts';
import { ZipUnreadable, type RandomAccessSource } from './zip-archive.ts';
import { createFileHttpClient } from './webdav-source.ts';

/** Where the target is and how to sign in: the same three things every DAV endpoint carries. */
export interface WebDavArchiveEndpoint {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

/** How much a range read fetches beyond what was asked, so sequential 1 MiB reads share a request. */
export const DEFAULT_RANGE_WINDOW_BYTES = 8 * 1024 * 1024;

/** Every request this file makes goes through here: one place for the URL, the auth and the refusals. */
class Dav {
  private readonly base: string;
  private readonly auth: string;
  /** Declared rather than a constructor parameter property: `erasableSyntaxOnly`. */
  private readonly http: HttpClient;
  constructor(endpoint: WebDavArchiveEndpoint, http: HttpClient) {
    this.http = http;
    this.base = endpoint.url.endsWith('/') ? endpoint.url : `${endpoint.url}/`;
    this.auth = `Basic ${Buffer.from(`${endpoint.username}:${endpoint.password}`).toString('base64')}`;
  }

  /** The URL of a store path; a folder gets its trailing slash, which is how a DAV server names a collection. */
  url(path: string, folder = false): string {
    const segments = path.split('/').filter((s) => s !== '');
    const joined = segments.map(encodeURIComponent).join('/');
    if (joined === '') return this.base;
    return `${this.base}${joined}${folder ? '/' : ''}`;
  }

  async request(
    method: string,
    path: string,
    options: { readonly headers?: Record<string, string>; readonly folder?: boolean; readonly body?: string; readonly stream?: boolean } = {},
  ): Promise<HttpResponse> {
    return this.http.request({
      url: this.url(path, options.folder),
      method,
      headers: { Authorization: this.auth, ...(options.headers ?? {}) },
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.stream ? { stream: true } : {}),
    });
  }

  /** What a PROPFIND says is at `path` and (Depth 1) directly inside it. */
  async propfind(path: string, depth: 0 | 1): Promise<ReadonlyArray<DavEntry> | undefined> {
    const response = await this.request('PROPFIND', path, {
      // Asked without a trailing slash: a server redirects or answers either
      // way for a collection, and a file must never be asked for as one.
      headers: { Depth: String(depth), 'Content-Type': 'application/xml' },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>',
    });
    if (response.status === 404) return undefined;
    if (response.status !== 207) {
      throw new Error(`PROPFIND ${this.url(path)} answered ${response.status}: ${response.body.slice(0, 200)}`);
    }
    return parseMultistatus(response.body);
  }
}

interface DavEntry {
  /** The decoded path of the entry, as the server spelled it, without a trailing slash. */
  readonly path: string;
  readonly isCollection: boolean;
  readonly size: number | undefined;
}

const RESPONSE = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
const HREF = /<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i;
const COLLECTION = /<(?:[\w-]+:)?resourcetype\b[^>]*>[\s\S]*?<(?:[\w-]+:)?collection\b/i;
const LENGTH = /<(?:[\w-]+:)?getcontentlength\b[^>]*>\s*(\d+)\s*</i;

/** The parts of a multistatus this file needs; namespace prefixes are the server's business. */
export function parseMultistatus(body: string): DavEntry[] {
  const out: DavEntry[] = [];
  for (const match of body.matchAll(RESPONSE)) {
    const block = match[1]!;
    const href = HREF.exec(block)?.[1]?.trim();
    if (!href) continue;
    let pathname = href;
    try {
      pathname = new URL(href, 'http://dav.invalid/').pathname;
    } catch {
      // A malformed href is kept as written; the comparison below will simply not match it.
    }
    const path = decodeURIComponent(pathname).replace(/\/+$/, '');
    const length = LENGTH.exec(block)?.[1];
    out.push({ path, isCollection: COLLECTION.test(block), size: length === undefined ? undefined : Number(length) });
  }
  return out;
}

/** The decoded, slash-trimmed path a request URL names, to tell a listed folder from its children. */
function requestedPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '');
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A file in the target as a random-access source, by `Range`.
 *
 * `size` comes from the caller (a PROPFIND already answered it); each read
 * fetches a window from the asked offset — the asked length or the window,
 * whichever is larger, clipped to the file — and later reads inside that
 * window are served from memory. The zip reader reads members front to back,
 * so a window is spent before the next is fetched; the tail (the end record
 * and the central directory) costs one window of its own.
 */
export function openRangeSource(
  dav: { request(method: string, path: string, options?: { readonly headers?: Record<string, string> }): Promise<HttpResponse>; url(path: string): string },
  path: string,
  size: number,
  windowBytes = DEFAULT_RANGE_WINDOW_BYTES,
): RandomAccessSource {
  let window: { readonly offset: number; readonly bytes: Uint8Array } | undefined;

  async function fetchWindow(offset: number, length: number): Promise<void> {
    const end = Math.min(size, offset + Math.max(length, windowBytes)) - 1;
    const response = await dav.request('GET', path, { headers: { Range: `bytes=${offset}-${end}` } });
    if (response.status === 200) {
      throw new ZipUnreadable(
        `${dav.url(path)} answers a byte-range request with the whole file, so an archive there cannot be read in place: reading one member would mean downloading all of it.`,
      );
    }
    if (response.status !== 206) {
      throw new ZipUnreadable(`${dav.url(path)} answered ${response.status} to a byte-range request: ${response.body.slice(0, 200)}`);
    }
    const bytes = response.bodyBytes ?? new TextEncoder().encode(response.body);
    if (bytes.byteLength !== end - offset + 1) {
      throw new ZipUnreadable(
        `${dav.url(path)} answered ${bytes.byteLength} byte(s) to a request for ${end - offset + 1}: the archive is not the size the target reported.`,
      );
    }
    window = { offset, bytes };
  }

  return {
    size,
    async read(offset, length) {
      if (offset < 0 || offset + length > size) {
        throw new ZipUnreadable(`A read of ${length} byte(s) at ${offset} lies beyond the ${size}-byte archive ${dav.url(path)}.`);
      }
      const served = window && offset >= window.offset && offset + length <= window.offset + window.bytes.byteLength;
      if (!served) await fetchWindow(offset, length);
      const start = offset - window!.offset;
      // A copy, not a view: the caller may hold the bytes after the window moves on.
      return window!.bytes.slice(start, start + length);
    },
    async close() {
      window = undefined;
    },
  };
}

/** A folder in the target as a tree: PROPFIND to look, GET to read — the extracted-into-the-target case. */
function webdavFolderTree(dav: Dav, root: string): ArchiveTree {
  const at = (path: string): string => joinStorePath(root, path);

  async function entry(path: string): Promise<DavEntry | undefined> {
    const found = await dav.propfind(at(path), 0);
    return found?.[0];
  }

  return {
    async isDirectory(path) {
      return (await entry(path))?.isCollection === true;
    },
    async list(path) {
      const url = dav.url(at(path), true);
      const found = await dav.propfind(at(path), 1);
      if (!found) throw new Error(`${at(path)} is not in the target.`);
      const self = requestedPath(url);
      const out: TreeEntry[] = [];
      for (const e of found) {
        if (e.path === self) continue;
        out.push({ name: nameOf(e.path), isDirectory: e.isCollection });
      }
      return out;
    },
    async read(path, maxBytes = DEFAULT_TREE_READ_BYTES) {
      const found = await entry(path);
      if (!found || found.isCollection) throw new Error(`${at(path)} is not a file in the target.`);
      if ((found.size ?? 0) > maxBytes) {
        throw new Error(`${at(path)} is ${found.size} bytes, more than the ${maxBytes} this read will hold; stream it instead.`);
      }
      const response = await dav.request('GET', at(path));
      if (response.status !== 200) throw new Error(`GET ${dav.url(at(path))} answered ${response.status}.`);
      return response.bodyBytes ?? new TextEncoder().encode(response.body);
    },
    async stream(path) {
      const found = await entry(path);
      if (!found || found.isCollection) throw new Error(`${at(path)} is not a file in the target.`);
      const response = await dav.request('GET', at(path), { stream: true });
      if (response.status !== 200) throw new Error(`GET ${dav.url(at(path))} answered ${response.status}.`);
      if (response.bodyStream) return response.bodyStream;
      // A client that buffered anyway (a fake in a test) still answers as a stream.
      const bytes = response.bodyBytes ?? new TextEncoder().encode(response.body);
      return Readable.toWeb(Readable.from([Buffer.from(bytes)])) as ReadableStream<Uint8Array>;
    },
    async close() {},
  };
}

/**
 * The customer's file target as an archive store.
 *
 * `httpClient` is the DAV connectors' seam; the default client is the one
 * every WebDAV connector uses, built lazily so importing this file costs
 * nothing on the appliance, where no target is ever a store.
 */
export function webdavStore(
  endpoint: WebDavArchiveEndpoint,
  httpClient: HttpClient = createFileHttpClient(),
  options: { readonly windowBytes?: number } = {},
): ArchiveStore {
  const dav = new Dav(endpoint, httpClient);

  async function statOf(path: string): Promise<StoreEntry> {
    const found = await dav.propfind(path, 0);
    const first = found?.[0];
    if (!first) return { kind: 'absent' };
    if (first.isCollection) return { kind: 'folder' };
    return { kind: 'file', size: first.size ?? 0 };
  }

  return {
    stat: statOf,
    async list(folder) {
      const found = await dav.propfind(folder, 1);
      if (!found) throw new Error(`${folder} is not in the target.`);
      const self = requestedPath(dav.url(folder, true));
      return found.filter((e) => e.path !== self).map((e) => nameOf(e.path));
    },
    folderTree(path) {
      return webdavFolderTree(dav, path);
    },
    async source(path) {
      const found = await statOf(path);
      if (found.kind !== 'file') throw new ZipUnreadable(`${dav.url(path)} is not a file in the target.`);
      return openRangeSource(dav, path, found.size, options.windowBytes);
    },
    describe(path) {
      return dav.url(path);
    },
    split: splitStorePath,
    join: joinStorePath,
  };
}
