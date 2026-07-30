// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Shared harness for the three `apply` (ADR-0024) real-server e2e files —
// selfhost-apply-deletion-{file,mail,calendar}.e2e.test.ts. Split into three
// FILES rather than three `describe` blocks in one, specifically so vitest's
// normal per-file thread pool runs them in parallel: a single `pnpm test:e2e`
// invocation naming all three lets vitest schedule them concurrently by
// default, cutting this gate's wall time from the SUM of three domains
// (~400s in practice, run #64) to roughly the SLOWEST one. `describe.concurrent`
// was tried first and rejected — nested `.sequential` describes inside it did
// NOT preserve in-order execution the way the vitest docs suggest; verified
// empirically (a throwaway unit test proved the nested tests either ran fully
// serially or raced with each other, neither of which is safe here, since each
// domain's steps depend on state the previous step left behind). Separate
// FILES sidestep that entirely: vitest's file-level parallelism is the
// well-established, unsurprising mechanism, and each file's own tests run in
// plain declaration order exactly like any other test file.
//
// This module itself is NOT a `*.e2e.test.ts` file, so
// test/e2e/no-workspace-imports.unit.test.ts's "imports only vitest and node
// builtins" rule does not apply to it directly — but it still imports nothing
// from `packages/*` or `apps/*`, for the same reason that rule exists: these
// are black-box tests of a DEPLOYED appliance. The three e2e files import this
// via a relative path, which the guard explicitly allows.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// ---------------------------------------------------------------------------
// Natural-key hashes, duplicated from packages/shared/src/hash.ts rather than
// imported — see the identical note in selfhost-restart-resume.e2e.test.ts:
// this file lives at the repo root, outside any workspace package, so it has
// no node_modules link to `@openmig/shared` and importing it dies with
// ERR_MODULE_NOT_FOUND on the runner. If the real definitions ever change,
// these simply stop matching anything in the failure/deletions queues, which
// fails loudly rather than quietly.
// ---------------------------------------------------------------------------

export function fileNaturalKeyHash(path: string): string {
  return createHash('sha256').update(`file:${path}`).digest('hex');
}

export function calendarNaturalKeyHash(uid: string): string {
  return createHash('sha256').update(`cal:${uid.toLowerCase()}`).digest('hex');
}

export function normalizeMessageId(messageId: string): string {
  return messageId
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .trim();
}

export function mailNaturalKeyHash(messageId: string): string {
  return createHash('sha256').update(`mid:${normalizeMessageId(messageId)}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Environment — same names, same defaults, as selfhost-restart-resume.e2e.test.ts
// and selfhost-verification.e2e.test.ts.
// ---------------------------------------------------------------------------

export const SELFHOST_PORT = process.env.SELFHOST_PORT || '8081';
export const SELFHOST_BIND = process.env.SELFHOST_BIND || '127.0.0.1';
export const BASE_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}`;
export const STATUS_URL = `${BASE_URL}/status`;
export const DELETIONS_URL = `${BASE_URL}/deletions`;

export const NEXTCLOUD_URL = `http://127.0.0.1:${process.env.DEV_NEXTCLOUD_PORT || '8082'}`;
export const DAV_TARGET_USER = process.env.NEXTCLOUD_TARGET_USER || 'e2e-target';
export const TARGET_DAV_PASSWORD = process.env.TARGET_DAV_PASSWORD || '';

export const STALWART_IMAPS_PORT = process.env.STALWART_IMAPS_PORT || '1993';
export const SOURCE_IMAP_PASSWORD = process.env.SOURCE_IMAP_PASSWORD || 'source_password';
export const TARGET_JMAP_PASSWORD = process.env.TARGET_JMAP_PASSWORD || 'target_password';

/** How long to wait for a scheduled pass (the fixture cron fires every minute). */
export const PASS_WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 200000);

// ---------------------------------------------------------------------------
// Appliance API helpers
// ---------------------------------------------------------------------------

export interface DeletionEntry {
  domain: string;
  naturalKeyHash: string;
  collection: string;
  absentPasses: number;
  confirmed: boolean;
  evidence: 'reported' | 'trashed' | 'inferred';
  reportedAt?: string;
  trashedAt?: string;
  acknowledgedAt?: string;
}
export interface DeletionsForMapping {
  confirmed: DeletionEntry[];
  watching: DeletionEntry[];
  acknowledged: DeletionEntry[];
}

export async function getDeletions(): Promise<{ mappingId: string } & DeletionsForMapping> {
  const response = await fetch(DELETIONS_URL);
  const raw = await response.text();
  if (!response.ok) throw new Error(`GET /deletions -> ${response.status}: ${raw}`);
  const body = JSON.parse(raw) as Record<string, DeletionsForMapping>;
  const mappingId = Object.keys(body)[0];
  if (!mappingId) throw new Error('GET /deletions returned no mapping at all');
  return { mappingId, ...body[mappingId]! };
}

/** Poll until `hash` shows up CONFIRMED (never `watching`, which an operator cannot act on). */
export async function waitForConfirmedDeletion(
  hash: string,
  maxMs: number,
): Promise<{ mappingId: string; entry: DeletionEntry }> {
  const deadline = Date.now() + maxMs;
  let lastWatching: DeletionEntry | undefined;
  while (Date.now() < deadline) {
    const q = await getDeletions();
    const entry = q.confirmed.find((d) => d.naturalKeyHash === hash);
    if (entry) return { mappingId: q.mappingId, entry };
    lastWatching = q.watching.find((d) => d.naturalKeyHash === hash) ?? lastWatching;
    await sleep(3000);
  }
  throw new Error(
    `timed out after ${maxMs}ms waiting for ${hash.slice(0, 12)} to become a CONFIRMED deletion` +
      (lastWatching
        ? ` (seen only as watching: evidence=${lastWatching.evidence}, absentPasses=${lastWatching.absentPasses})`
        : ' (never seen in /deletions at all — did the trash/delete script actually run against the source?)'),
  );
}

export async function applyDeletion(
  mappingId: string,
  hash: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(
    `${BASE_URL}/mappings/${encodeURIComponent(mappingId)}/deletions/${hash}/apply`,
    { method: 'POST' },
  );
  const raw = await response.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = { raw };
  }
  return { status: response.status, body };
}

export interface DomainStatus {
  domain: string;
  state: string;
  itemsSynced: number;
  itemsFailed: number;
  lastSyncedAt?: string;
}
interface StatusPayload {
  status: 'ok';
  mappings: Array<{ mappingId: string; domains: DomainStatus[] }>;
}

export async function getDomainStatus(domain: string): Promise<DomainStatus | null> {
  const response = await fetch(STATUS_URL);
  const status = JSON.parse(await response.text()) as StatusPayload;
  return status.mappings?.[0]?.domains?.find((d) => d.domain === domain) ?? null;
}

/** Wait for a pass that COMPLETES strictly after `after` — proof the pass ran post-apply. */
export async function waitForNextPass(
  domain: string,
  after: string | undefined,
  maxMs: number,
): Promise<DomainStatus> {
  const deadline = Date.now() + maxMs;
  let last: DomainStatus | null = null;
  while (Date.now() < deadline) {
    last = await getDomainStatus(domain);
    if (last && last.state === 'completed' && last.lastSyncedAt && last.lastSyncedAt !== after) return last;
    await sleep(3000);
  }
  throw new Error(
    `${domain}: timed out after ${maxMs}ms waiting for a sync pass after ${after ?? '(never synced)'}. ` +
      `Last seen: state=${last?.state}, lastSyncedAt=${last?.lastSyncedAt ?? 'never'}.`,
  );
}

// ---------------------------------------------------------------------------
// Real-Nextcloud helpers (independent of the appliance — these hit the target
// account directly, which is the whole point: the appliance saying `kind: binned`
// means nothing if the file is not actually sitting in the target's own trashbin).
// ---------------------------------------------------------------------------

export function davAuthHeader(user: string, password: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}

/** Decode the five XML entities — this is element TEXT, not a URI. Same as trash-dav-file-source.mjs. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Every original location the TARGET account's trashbin reports. */
export async function readTargetTrashbin(): Promise<string[]> {
  const url = `${NEXTCLOUD_URL}/remote.php/dav/trashbin/${DAV_TARGET_USER}/trash/`;
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      ...davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD),
      'Content-Type': 'application/xml',
      Depth: '1',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <d:propfind xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
        <d:prop><nc:trashbin-original-location/></d:prop>
      </d:propfind>`,
  });
  if (response.status !== 207) {
    throw new Error(`target trashbin PROPFIND -> ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.text();
  const locations: string[] = [];
  const responseRegex = /<[A-Za-z][\w-]*:response[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(body)) !== null) {
    const found = match[1]?.match(
      /<[A-Za-z][\w-]*:trashbin-original-location[^>]*>([\s\S]*?)<\/[A-Za-z][\w-]*:trashbin-original-location>/i,
    );
    const raw = found?.[1]?.trim();
    if (raw) locations.push(decodeXmlEntities(raw));
  }
  return locations;
}

// ---------------------------------------------------------------------------
// Real-Stalwart helper, over IMAP against the TARGET account. Same server the
// JMAP target writer uses (Stalwart serves both protocols off one account), so
// this is an independent view of exactly what `removeItem` did — not a re-read
// through the same JMAP API the appliance itself called. Shelled out to
// imap-message-locations.mjs, which is where `imap-simple` is imported.
// ---------------------------------------------------------------------------

/** One mailbox holding the message, with its RFC 6154 LIST attributes. */
export interface MailboxLocation {
  readonly path: string;
  readonly attribs: ReadonlyArray<string>;
}

/** Every mailbox in the TARGET account that currently holds a copy of `messageId`. */
export function messageLocations(messageId: string): MailboxLocation[] {
  const raw = execSync('node test/e2e/imap-message-locations.mjs', {
    encoding: 'utf8',
    env: {
      ...process.env,
      IMAP_HOST: '127.0.0.1',
      IMAP_PORT: STALWART_IMAPS_PORT,
      IMAP_TLS: 'true',
      IMAP_USER: 'target@dev.local',
      IMAP_PASSWORD: TARGET_JMAP_PASSWORD,
      MESSAGE_ID: messageId,
    },
  });
  return JSON.parse(raw) as MailboxLocation[];
}

/**
 * Whether a mailbox is the account's bin, BY FLAG — never by name.
 *
 * Servers disagree entirely about the name: Stalwart's `\Trash` mailbox is called
 * "Deleted Items", others say Trash, Deleted Messages or [Gmail]/Trash. Matching
 * the name is how a correct removal gets reported as a failure, which is exactly
 * what happened before this existed. `\Deleted` is accepted alongside `\Trash`,
 * the same pair `mapImapSpecialUse` treats as a bin in the product.
 */
export function isBin(mailbox: MailboxLocation): boolean {
  return mailbox.attribs.some((a) => {
    const lower = String(a).toLowerCase();
    return lower === '\\trash' || lower === '\\deleted';
  });
}

/** Human-readable location list for assertion messages, flags included. */
export function describeLocations(locations: ReadonlyArray<MailboxLocation>): string {
  if (locations.length === 0) return 'nowhere';
  return locations.map((m) => `${m.path} [${m.attribs.join(' ') || 'no flags'}]`).join(', ');
}
