// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * FREE SPACE AT THE DESTINATION, READ BEFORE START (workplan 0171 §6, T9).
 *
 * Each destination writer that can say how much room it has implements
 * `capacity()` (ports.ts); what it hears is turned into a `DestinationCapacity`
 * here, by pure functions over the server's own answer, so every reading is
 * pinned by a unit test over a recorded answer rather than by a live server.
 *
 * Four readers, one per way a destination says it:
 * - WebDAV (Nextcloud, any): `quota-available-bytes` and `quota-used-bytes`
 *   on a `Depth: 0` PROPFIND (RFC 4331). Nextcloud answers negative numbers
 *   for what it has not got: −3 unlimited, −1 and −2 not computed.
 * - IMAP: `GETQUOTAROOT INBOX` (RFC 9208), read only when `QUOTA` is
 *   announced; `STORAGE` is in KiB on the wire (the library multiplies).
 * - JMAP: `Quota/get` (RFC 9425), read only when the session lists
 *   `urn:ietf:params:jmap:quota`; the `octets` quotas count.
 * - Cirrux Drive: `GET /workspace/storage`, the pool every file counts against.
 *
 * And the sum: data types that land in the same pool are added together
 * against ONE number (`spaceByPool`), never counted against it twice.
 *
 * Nothing here is stored (§6.3, §8): the screen reads it live.
 */
import type { DestinationCapacity } from './ports.ts';
import { davElement, firstTextBeforeTag } from './xml-elements.ts';

type Unknown = Extract<DestinationCapacity, { known: false }>;
const unknown = (why: Unknown['why']): Unknown => ({ known: false, why });

/** A whole, non-negative number of bytes, or undefined. */
function byteCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : undefined;
}

function known(freeBytes: number, totalBytes: number | undefined, pool: string): DestinationCapacity {
  return {
    known: true,
    freeBytes: Math.max(0, freeBytes),
    ...(totalBytes === undefined ? {} : { totalBytes }),
    pool,
  };
}

// ---------------------------------------------------------------------------
// WebDAV (RFC 4331)
// ---------------------------------------------------------------------------

/**
 * One DAV property's text, whatever prefix the server gave its namespace
 * (`d:` from Sabre, `D:` from others, none at all from some). A property the
 * server listed under a 404 propstat comes back EMPTY (`<d:quota-available-bytes/>`),
 * which this does not match: absent, as it should read.
 */
function davProperty(body: string, name: string): string | undefined {
  // Read a tag at a time (`davElement`), as `<(?:p:)?name(?:\s[^>]*)?>\s*(\S…)\s*</(?:p:)?name>`
  // read it: that pattern read a body that opens a tag and never ends it in
  // time quadratic in it. The text holds no tag, and is trimmed and not empty.
  const element = davElement(name, /^[A-Za-z][\w.-]*:/, { optionalPrefix: true, after: (rest) => rest === '' || /^\s/.test(rest) });
  return firstTextBeforeTag(body, element.opens, (text, next) => /\S/.test(text) && next !== undefined && element.closes(next))?.trim();
}

/** A DAV integer, which Nextcloud may send negative and may send as a float (`1.5E+10`). */
function davInteger(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** The PROPFIND body that asks for the two quota properties and nothing else. */
export const DAV_QUOTA_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:quota-available-bytes/>
    <d:quota-used-bytes/>
  </d:prop>
</d:propfind>`;

/**
 * A `Depth: 0` PROPFIND's answer, read as room. Absent: `not_offered`.
 * Nextcloud's −3: `unlimited`. Its −1 and −2 (not computed, unknown):
 * `not_answered`, because the server does keep the number and did not give it.
 */
export function capacityFromDavQuota(body: string, pool: string): DestinationCapacity {
  const available = davInteger(davProperty(body, 'quota-available-bytes'));
  if (available === undefined) return unknown('not_offered');
  if (available === -3) return unknown('unlimited');
  if (available < 0) return unknown('not_answered');
  const used = davInteger(davProperty(body, 'quota-used-bytes'));
  return known(available, used !== undefined && used >= 0 ? available + used : undefined, pool);
}

// ---------------------------------------------------------------------------
// IMAP (RFC 9208)
// ---------------------------------------------------------------------------

/** Whether an IMAP server announces quotas: `QUOTA`, or RFC 9208's `QUOTA=RES-*`. */
export function imapAnnouncesQuota(capabilities: Iterable<string>): boolean {
  for (const c of capabilities) {
    const u = c.toUpperCase();
    if (u === 'QUOTA' || u.startsWith('QUOTA=RES-')) return true;
  }
  return false;
}

/** What `imapflow`'s `getQuota` answers: storage already in bytes. */
export interface ImapQuotaAnswer {
  readonly quotaRoot?: string;
  readonly storage?: { readonly usage?: number; readonly limit?: number };
}

/**
 * `GETQUOTAROOT INBOX`'s answer, read as room. `answer` is what the library
 * returned: `false` when the command failed on a server that announces
 * `QUOTA` is `not_answered` (the library folds a failure into `false`, so the
 * caller asks about the capability first and only then about the answer).
 * No `STORAGE` resource, or no limit on it: `not_offered`.
 *
 * `account` qualifies the root: two accounts on one server each have a root
 * named `""` and are two pools.
 */
export function capacityFromImapQuota(
  announced: boolean,
  answer: ImapQuotaAnswer | false | undefined,
  account: string,
): DestinationCapacity {
  if (!announced) return unknown('not_offered');
  if (!answer) return unknown('not_answered');
  const limit = byteCount(answer.storage?.limit);
  if (limit === undefined) return unknown('not_offered');
  const usage = byteCount(answer.storage?.usage) ?? 0;
  return known(limit - usage, limit, `${account}#quota-root:${answer.quotaRoot ?? ''}`);
}

// ---------------------------------------------------------------------------
// JMAP (RFC 9425)
// ---------------------------------------------------------------------------

export const JMAP_QUOTA_CAPABILITY = 'urn:ietf:params:jmap:quota';

/** One `Quota` object, as `Quota/get` lists it; only what is read here. */
export interface JmapQuota {
  readonly resourceType?: string;
  readonly scope?: string;
  readonly used?: number;
  readonly hardLimit?: number;
}

/**
 * `Quota/get`'s list, read as room. Every `octets` quota that applies to the
 * account limits it, whatever its scope, so the TIGHTEST one is the room;
 * `count` quotas (messages) are not bytes and are left out.
 *
 * None in octets: `unlimited`, because the server keeps quotas and lists none
 * on bytes for this account. A `hardLimit` of 0 is read the same way: it is
 * how a server says "no limit set" (Stalwart's account default), and a mail
 * account that truly held no byte would refuse its first message anyway.
 */
export function capacityFromJmapQuotas(
  announced: boolean,
  list: ReadonlyArray<JmapQuota> | undefined,
  pool: string,
): DestinationCapacity {
  if (!announced) return unknown('not_offered');
  if (!list) return unknown('not_answered');
  let tightest: { free: number; total: number } | undefined;
  for (const q of list) {
    if (q.resourceType !== 'octets') continue;
    const limit = byteCount(q.hardLimit);
    if (limit === undefined || limit === 0) continue;
    const free = limit - (byteCount(q.used) ?? 0);
    if (!tightest || free < tightest.free) tightest = { free, total: limit };
  }
  return tightest ? known(tightest.free, tightest.total, pool) : unknown('unlimited');
}

// ---------------------------------------------------------------------------
// Cirrux Drive
// ---------------------------------------------------------------------------

/** `GET /workspace/storage`'s answer, read as room; a part missing is `not_answered`. */
export function capacityFromCirruxStorage(
  answer: { readonly used_bytes?: unknown; readonly pool_bytes?: unknown } | undefined,
  pool: string,
): DestinationCapacity {
  const total = byteCount(answer?.pool_bytes);
  const used = byteCount(answer?.used_bytes);
  if (total === undefined || used === undefined) return unknown('not_answered');
  return known(total - used, total, pool);
}

// ---------------------------------------------------------------------------
// The sum, per pool
// ---------------------------------------------------------------------------

/** One data type's destination, read: what it needs, and what its writer said. */
export interface DataTypeSpace<D extends string = string> {
  readonly dataType: D;
  readonly needBytes: number;
  readonly capacity: DestinationCapacity;
  /**
   * Where an unknown answer is grouped, since it names no pool: the
   * destination it came from, so mail and files to one server that says
   * nothing are one line, not two.
   */
  readonly destination: string;
}

/** One line on *Review and start*: a pool, the data types that land in it, and their need added up. */
export interface PoolSpace<D extends string = string> {
  readonly pool: string;
  readonly destination: string;
  readonly dataTypes: D[];
  readonly needBytes: number;
  readonly capacity: DestinationCapacity;
}

/**
 * Data types that land in the same pool, added together against one number
 * (workplan 0171 §6.2). A known pool keeps the FIRST answer it got: two
 * writers into one account read the same number a moment apart, and adding
 * their free space would count the room twice too.
 *
 * Unknown answers group by destination and reason, so a line says one thing.
 * Order is the order the data types came in.
 */
export function spaceByPool<D extends string>(rows: ReadonlyArray<DataTypeSpace<D>>): PoolSpace<D>[] {
  const out = new Map<string, { pool: string; destination: string; dataTypes: D[]; needBytes: number; capacity: DestinationCapacity }>();
  for (const r of rows) {
    const key = r.capacity.known ? `pool:${r.capacity.pool}` : `unknown:${r.capacity.why}:${r.destination}`;
    const pool = r.capacity.known ? r.capacity.pool : key;
    const line = out.get(key) ?? { pool, destination: r.destination, dataTypes: [], needBytes: 0, capacity: r.capacity };
    if (!line.dataTypes.includes(r.dataType)) {
      line.dataTypes.push(r.dataType);
      line.needBytes += Math.max(0, r.needBytes);
    }
    out.set(key, line);
  }
  return [...out.values()];
}

/** What one line says: room enough, too little, or not known. */
export type SpaceVerdict = 'fits' | 'short' | 'unknown';

export function spaceVerdict(line: { readonly needBytes: number; readonly capacity: DestinationCapacity }): SpaceVerdict {
  if (!line.capacity.known) return 'unknown';
  return line.needBytes > line.capacity.freeBytes ? 'short' : 'fits';
}

/**
 * Whether Start waits behind *Start anyway* (D4 (a)): a pool KNOWN to be too
 * small. An unknown pool is said and lets Start through (D3 (a)).
 */
export function spaceHoldsStart(lines: ReadonlyArray<{ readonly needBytes: number; readonly capacity: DestinationCapacity }>): boolean {
  return lines.some((l) => spaceVerdict(l) === 'short');
}
