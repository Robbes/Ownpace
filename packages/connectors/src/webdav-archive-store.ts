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

/**
 * How much read-ahead every source of ONE STORE may hold BETWEEN THEM.
 *
 * A window is per source and the window is the point: a 25 GB library read in
 * 1 MiB steps is a few thousand requests rather than twenty-five thousand. But
 * a multi-part Takeout is opened ALL AT ONCE — `openZipTree` needs every
 * part's central directory before it can answer anything, and it holds them
 * open because a pass never closes its source. So "8 MiB" is a per-part
 * figure, and 25 GB of Takeout is 25 parts: **200 MiB of buffers, resident for
 * the whole pass**, on an edition whose run containers are sized for a job and
 * not for an archive.
 *
 * Four windows, shared. The access pattern is what makes that enough: the
 * reader walks the parts in order and members front to back, so at any moment
 * one part is being read and its neighbour may be about to be — the other
 * twenty-three windows are stale and never touched again. The budget evicts
 * the least recently used, so the part being read keeps its full window and
 * the ceiling stops growing with the size of the download.
 *
 * A single window is always allowed to exceed this: a read longer than the
 * budget must still be servable, and refusing it would turn a large central
 * directory into an unreadable archive.
 */
export const DEFAULT_RANGE_BUDGET_BYTES = 32 * 1024 * 1024;

/** One source's claim on the shared read-ahead budget — see {@link rangeBudget}. */
export interface RangeBudget {
  /** Take (or replace) this source's window, evicting least-recently-used ones until it fits. */
  hold(source: object, bytes: number, drop: () => void): void;
  /** Served from this source's window just now, so it is not the next evicted. */
  touch(source: object): void;
  /** This source is closing; its window stops counting. */
  release(source: object): void;
  /** What is held right now — the number the ceiling is about. */
  heldBytes(): number;
}

/**
 * A shared read-ahead ceiling for the sources of one store, least recently
 * used evicted first.
 *
 * `Map` iterates in insertion order, so re-inserting on every hold and touch
 * IS the recency order and the oldest key is the first one out. Eviction only
 * drops a window the reader has moved past; the next read of that source
 * simply fetches again, which is a request, not a failure.
 */
export function rangeBudget(limitBytes: number = DEFAULT_RANGE_BUDGET_BYTES): RangeBudget {
  const held = new Map<object, { readonly bytes: number; readonly drop: () => void }>();
  let total = 0;

  function evictUntilItFits(keep: object): void {
    for (const [source, entry] of held) {
      if (total <= limitBytes) return;
      // Never the one just held: a read longer than the whole budget must
      // still be servable, and dropping it here would make it unreadable
      // rather than merely expensive.
      if (source === keep) continue;
      held.delete(source);
      total -= entry.bytes;
      entry.drop();
    }
  }

  return {
    hold(source, bytes, drop) {
      const previous = held.get(source);
      if (previous) {
        held.delete(source);
        total -= previous.bytes;
      }
      held.set(source, { bytes, drop });
      total += bytes;
      evictUntilItFits(source);
    },
    touch(source) {
      const entry = held.get(source);
      if (!entry) return;
      held.delete(source);
      held.set(source, entry);
    },
    release(source) {
      const entry = held.get(source);
      if (!entry) return;
      held.delete(source);
      total -= entry.bytes;
    },
    heldBytes() {
      return total;
    },
  };
}

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

/** A stretch of the file, fetched whole and sliced by the reads it covers. */
interface RangeWindow {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

/** A window on its way, and the extent it will cover, so a second reader can wait rather than ask again. */
interface RangeWindowOnItsWay {
  readonly offset: number;
  /** Inclusive, as the `Range` header spells it. */
  readonly end: number;
  readonly at: Promise<RangeWindow>;
}

/** Whether a window (held or promised) can answer a read of `length` at `offset`. */
function covers(from: number, toInclusive: number, offset: number, length: number): boolean {
  return offset >= from && offset + length <= toInclusive + 1;
}

/**
 * A file in the target as a random-access source, by `Range`.
 *
 * `size` comes from the caller (a PROPFIND already answered it); each read
 * fetches a window from the asked offset — the asked length or the window,
 * whichever is larger, clipped to the file — and later reads inside that
 * window are served from memory. The zip reader reads members front to back,
 * so a window is spent before the next is fetched; the tail (the end record
 * and the central directory) costs one window of its own.
 *
 * READ BY FOUR AT ONCE. The file loop downloads inside a bounded concurrency
 * of four (`DEFAULT_CONCURRENCY`), and an archive's members are read THERE —
 * so four members of one Takeout part are read through this one source at the
 * same time. Two rules follow, and both are the point of the shape below:
 *
 * - **A window is a value a read holds, never a field it re-reads.** There is
 *   an `await` between wanting a window and slicing one, and the field can
 *   change under it — another read's fetch landing, or the budget evicting.
 *   Reading it afterwards gave a read somebody else's window to slice itself
 *   out of, which `Uint8Array.slice` answers by clamping to NOTHING rather
 *   than refusing: a SHORT READ, with no error where the mistake is. What the
 *   person is told comes later and depends on where it landed — a CRC-32
 *   failure in a member's data, a `RangeError` off a truncated local header,
 *   or a bare `TypeError` when the budget evicted between the fetch and the
 *   slice. All three blame their export. The cache stays; what a read returns
 *   no longer depends on who else was reading.
 * - **Reads wanting the same window share one request.** Four members inside
 *   one 8 MiB window are one `Range` request, not four — against the
 *   customer's own server, which is also the one being written to.
 *
 * The budget still counts ONE window per source, and four reads can briefly
 * have four in the air; only the last survives the tick, the rest are the
 * readers' own and are gone when their reads return. So the ceiling holds
 * between reads, and the transient above it is bounded by the loop's
 * concurrency rather than by the size of the download — which is the property
 * {@link DEFAULT_RANGE_BUDGET_BYTES} is there for.
 */
export function openRangeSource(
  dav: { request(method: string, path: string, options?: { readonly headers?: Record<string, string> }): Promise<HttpResponse>; url(path: string): string },
  path: string,
  size: number,
  options: { readonly windowBytes?: number; readonly budget?: RangeBudget } = {},
): RandomAccessSource {
  const windowBytes = options.windowBytes ?? DEFAULT_RANGE_WINDOW_BYTES;
  const budget = options.budget;
  /** This source's identity in the shared budget — see {@link rangeBudget}. */
  const claim = {};
  /** The last window fetched, kept so the next read inside it costs nothing. A cache, not a result. */
  let held: RangeWindow | undefined;
  /** The fetch in flight, so concurrent readers of one window make one request. */
  let onItsWay: RangeWindowOnItsWay | undefined;

  async function fetchWindow(offset: number, length: number): Promise<RangeWindow> {
    const end = Math.min(size, offset + Math.max(length, windowBytes)) - 1;
    const at = (async (): Promise<RangeWindow> => {
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
      const window: RangeWindow = { offset, bytes };
      held = window;
      // The budget may drop this window from the CACHE at any point after
      // here — including before the read that asked for it gets to slice it.
      // That is why the window is returned rather than read back out of
      // `held`: an eviction costs a later request, never a short read.
      budget?.hold(claim, bytes.byteLength, () => {
        held = undefined;
      });
      return window;
    })();
    onItsWay = { offset, end, at };
    try {
      return await at;
    } finally {
      if (onItsWay?.at === at) onItsWay = undefined;
    }
  }

  async function windowFor(offset: number, length: number): Promise<RangeWindow> {
    const cached = held;
    if (cached && covers(cached.offset, cached.offset + cached.bytes.byteLength - 1, offset, length)) {
      budget?.touch(claim);
      return cached;
    }
    const coming = onItsWay;
    if (coming && covers(coming.offset, coming.end, offset, length)) return coming.at;
    return fetchWindow(offset, length);
  }

  return {
    size,
    async read(offset, length) {
      if (offset < 0 || offset + length > size) {
        throw new ZipUnreadable(`A read of ${length} byte(s) at ${offset} lies beyond the ${size}-byte archive ${dav.url(path)}.`);
      }
      const window = await windowFor(offset, length);
      const start = offset - window.offset;
      // A copy, not a view: the caller may hold the bytes after the window moves on.
      return window.bytes.slice(start, start + length);
    },
    async close() {
      held = undefined;
      onItsWay = undefined;
      budget?.release(claim);
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
  options: { readonly windowBytes?: number; readonly budgetBytes?: number } = {},
): ArchiveStore {
  const dav = new Dav(endpoint, httpClient);
  // ONE budget for every source this store opens, which is one per tree:
  // `openZipTree` asks the store for a source per part and holds them all.
  // Without this the read-ahead ceiling is per part and grows with the size
  // of the download — see `DEFAULT_RANGE_BUDGET_BYTES`.
  const budget = rangeBudget(options.budgetBytes);

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
      return openRangeSource(dav, path, found.size, {
        ...(options.windowBytes === undefined ? {} : { windowBytes: options.windowBytes }),
        budget,
      });
    },
    describe(path) {
      return dav.url(path);
    },
    split: splitStorePath,
    join: joinStorePath,
  };
}
