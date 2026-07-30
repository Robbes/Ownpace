// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// `apply` — the one destructive operation in the product (ADR-0024) — against REAL
// servers, for the first time. Everything proving it so far
// (packages/core/src/apply-deletion.unit.test.ts and its neighbours) runs against
// MemoryLedger and fake target writers; the real CalDAV/WebDAV/JMAP `removeItem`
// implementations have never met an actual Nextcloud or Stalwart until this file.
//
// One already-migrated item per domain (the restart-resume gate that runs before
// this step put them there):
//   - a FILE, `dav-seed-file-2.txt` (WebDAV/Nextcloud) — `trashed` evidence (the
//     account's own trashbin), `binned` removal (the DELETE lands in the target
//     account's own trashbin too).
//   - a MESSAGE, `<seed-2@dev.local>` (JMAP/Stalwart) — `trashed` evidence (the
//     source's own `\Trash`-role mailbox is the signal mail has); removal kind
//     depends on whether the target account has a `\Trash`-role mailbox of its
//     own, so this is verified rather than assumed.
//   - a calendar EVENT, `dav-seed-event-2@dev.local` (CalDAV/Nextcloud) —
//     `reported` evidence (the `sync-collection` REPORT names it directly),
//     `deleted` removal (the writer never claims `binned` for calendar objects —
//     see ADR-0024).
//
// `-2` rather than `-1` on purpose: the restart-resume gate that runs first
// relocates `dav-seed-event-1@dev.local` (its move-detection case) and its runbook
// script default deletes `dav-seed-file-1.txt` / `<seed-1@dev.local>` by hand, so
// `-2` is guaranteed untouched by anything upstream of this file as long as
// SEED_COUNT >= 2 (the workflow's default is 5).
//
// For each domain: delete the item on the source, wait for `GET /deletions` to
// confirm it with the expected evidence, `POST .../apply`, then verify DIRECTLY
// AGAINST THE REAL TARGET SERVER — never just the appliance's own say-so — that the
// copy is actually gone (or actually binned). Also proves apply's two safety
// properties for real, not just against MemoryLedger:
//   - a second `apply` on the same item is refused (`already_applied`), not a
//     silently-successful no-op — the ledger's own conditional UPDATE is what makes
//     this true, and that SQL has never run outside `ledger.integration.test.ts`
//     (Testcontainers, not a real appliance) until now.
//   - the tombstone survives a further real sync pass: the item is not resurrected
//     on the target. This is exactly the self-introduced bug ADR-0024 documents
//     catching before it ever reached a test run
//     (`packages/core/src/tombstone-not-restored.unit.test.ts` proves it against
//     MemoryLedger; this proves the same property end-to-end).
//
// PREREQUISITES: same running stack as selfhost-restart-resume.e2e.test.ts, which
// MUST have run to completion first — this needs already-synced items to delete.
// The mapping config must also carry `allowApplyDeletions: true` (e2e.yml's config-
// generation step sets this); a fixture missing it fails every case here at gate 1
// with `not_enabled`, which would be a false negative about removal itself.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

// ---------------------------------------------------------------------------
// Natural-key hashes, duplicated from packages/shared/src/hash.ts rather than
// imported — see the identical note in selfhost-restart-resume.e2e.test.ts: this
// file lives at the repo root, outside any workspace package, so it has no
// node_modules link to `@openmig/shared` and importing it dies with
// ERR_MODULE_NOT_FOUND on the runner. If the real definitions ever change, these
// simply stop matching anything in the failure/deletions queues, which fails
// loudly rather than quietly.
// ---------------------------------------------------------------------------

function fileNaturalKeyHash(path: string): string {
  return createHash('sha256').update(`file:${path}`).digest('hex');
}

function calendarNaturalKeyHash(uid: string): string {
  return createHash('sha256').update(`cal:${uid.toLowerCase()}`).digest('hex');
}

function normalizeMessageId(messageId: string): string {
  return messageId
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .trim();
}

function mailNaturalKeyHash(messageId: string): string {
  return createHash('sha256').update(`mid:${normalizeMessageId(messageId)}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Environment — same names, same defaults, as selfhost-restart-resume.e2e.test.ts
// and selfhost-verification.e2e.test.ts.
// ---------------------------------------------------------------------------

const SELFHOST_PORT = process.env.SELFHOST_PORT || '8081';
const SELFHOST_BIND = process.env.SELFHOST_BIND || '127.0.0.1';
const BASE_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}`;
const STATUS_URL = `${BASE_URL}/status`;
const DELETIONS_URL = `${BASE_URL}/deletions`;

const NEXTCLOUD_URL = `http://127.0.0.1:${process.env.DEV_NEXTCLOUD_PORT || '8082'}`;
const DAV_TARGET_USER = process.env.NEXTCLOUD_TARGET_USER || 'e2e-target';
const TARGET_DAV_PASSWORD = process.env.TARGET_DAV_PASSWORD || '';

const STALWART_IMAPS_PORT = process.env.STALWART_IMAPS_PORT || '1993';
const SOURCE_IMAP_PASSWORD = process.env.SOURCE_IMAP_PASSWORD || 'source_password';
const TARGET_JMAP_PASSWORD = process.env.TARGET_JMAP_PASSWORD || 'target_password';

/** How long to wait for a scheduled pass (the fixture cron fires every minute). */
const PASS_WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 200000);

// ---------------------------------------------------------------------------
// Appliance API helpers
// ---------------------------------------------------------------------------

interface DeletionEntry {
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
interface DeletionsForMapping {
  confirmed: DeletionEntry[];
  watching: DeletionEntry[];
  acknowledged: DeletionEntry[];
}

async function getDeletions(): Promise<{ mappingId: string } & DeletionsForMapping> {
  const response = await fetch(DELETIONS_URL);
  const raw = await response.text();
  if (!response.ok) throw new Error(`GET /deletions -> ${response.status}: ${raw}`);
  const body = JSON.parse(raw) as Record<string, DeletionsForMapping>;
  const mappingId = Object.keys(body)[0];
  if (!mappingId) throw new Error('GET /deletions returned no mapping at all');
  return { mappingId, ...body[mappingId]! };
}

/** Poll until `hash` shows up CONFIRMED (never `watching`, which an operator cannot act on). */
async function waitForConfirmedDeletion(
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

async function applyDeletion(
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

interface DomainStatus {
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

async function getDomainStatus(domain: string): Promise<DomainStatus | null> {
  const response = await fetch(STATUS_URL);
  const status = JSON.parse(await response.text()) as StatusPayload;
  return status.mappings?.[0]?.domains?.find((d) => d.domain === domain) ?? null;
}

/** Wait for a pass that COMPLETES strictly after `after` — proof the pass ran post-apply. */
async function waitForNextPass(domain: string, after: string | undefined, maxMs: number): Promise<DomainStatus> {
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

function davAuthHeader(user: string, password: string): Record<string, string> {
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
async function readTargetTrashbin(): Promise<string[]> {
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
// imap-message-locations.mjs, which is where `imap-simple` is imported, rather
// than imported here directly: this file must import nothing but vitest and
// node builtins (test/e2e/no-workspace-imports.unit.test.ts).
// ---------------------------------------------------------------------------

/** Every mailbox in the TARGET account that currently holds a copy of `messageId`. */
function messageLocations(messageId: string): string[] {
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
  return JSON.parse(raw) as string[];
}

// =============================================================================

describe('apply — file domain (WebDAV/Nextcloud)', () => {
  const FILE_NAME = 'dav-seed-file-2.txt';
  const FILE_HASH = fileNaturalKeyHash(FILE_NAME);
  const LIVE_URL = `${NEXTCLOUD_URL}/remote.php/dav/files/${DAV_TARGET_USER}/${encodeURIComponent(FILE_NAME)}`;

  let mappingId = '';
  let lastSyncedAtBeforeApply: string | undefined;

  it(
    'deletes the file on the source and the appliance reports it as trashed',
    async () => {
      execSync('node test/e2e/trash-dav-file-source.mjs', {
        stdio: 'inherit',
        env: { ...process.env, TRASH_FILE_NAME: FILE_NAME },
      });
      const { mappingId: id, entry } = await waitForConfirmedDeletion(FILE_HASH, PASS_WAIT_MS);
      mappingId = id;
      expect(entry.evidence).toBe('trashed');
      lastSyncedAtBeforeApply = (await getDomainStatus('file'))?.lastSyncedAt;
    },
    PASS_WAIT_MS + 60000,
  );

  it('apply removes the target copy, verified directly against the real Nextcloud', async () => {
    const before = await fetch(LIVE_URL, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(before.status, 'the file must still be live on the target before apply').toBe(200);

    const { status, body } = await applyDeletion(mappingId, FILE_HASH);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.action).toBe('apply');
    // A Nextcloud files DELETE always lands in that account's own trashbin.
    expect(body.kind).toBe('binned');

    const afterLive = await fetch(LIVE_URL, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(afterLive.status, 'the file must no longer be at its live target path').toBe(404);

    const bin = await readTargetTrashbin();
    expect(bin, `target trashbin does not list ${FILE_NAME}: ${JSON.stringify(bin)}`).toContain(FILE_NAME);
  }, 30000);

  it('a second apply on the same item is refused, not a silent no-op', async () => {
    const { status, body } = await applyDeletion(mappingId, FILE_HASH);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('already_applied');
  }, 15000);

  it(
    'the removal survives one more sync pass — no resurrection on the target',
    async () => {
      await waitForNextPass('file', lastSyncedAtBeforeApply, PASS_WAIT_MS);

      const afterLive = await fetch(LIVE_URL, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
      expect(afterLive.status, 'apply must not be silently undone by the next pass').toBe(404);

      const q = await getDeletions();
      expect(q.confirmed.map((d) => d.naturalKeyHash)).not.toContain(FILE_HASH);
      expect(q.acknowledged.map((d) => d.naturalKeyHash)).toContain(FILE_HASH);
    },
    PASS_WAIT_MS + 60000,
  );
});

describe('apply — mail domain (JMAP/Stalwart)', () => {
  const MESSAGE_ID = '<seed-2@dev.local>';
  const MESSAGE_HASH = mailNaturalKeyHash(MESSAGE_ID);

  let mappingId = '';
  let lastSyncedAtBeforeApply: string | undefined;

  it(
    'moves the message into the source bin and the appliance reports it as trashed',
    async () => {
      execSync('node test/e2e/trash-imap-source.mjs', {
        stdio: 'inherit',
        env: {
          ...process.env,
          SEED_IMAP_HOST: '127.0.0.1',
          SEED_IMAP_PORT: STALWART_IMAPS_PORT,
          SEED_IMAP_TLS: 'true',
          SEED_IMAP_USER: 'source@dev.local',
          SEED_IMAP_PASSWORD: SOURCE_IMAP_PASSWORD,
          TRASH_MESSAGE_ID: MESSAGE_ID,
        },
      });
      const { mappingId: id, entry } = await waitForConfirmedDeletion(MESSAGE_HASH, PASS_WAIT_MS);
      mappingId = id;
      expect(entry.evidence).toBe('trashed');
      lastSyncedAtBeforeApply = (await getDomainStatus('email'))?.lastSyncedAt;
    },
    PASS_WAIT_MS + 60000,
  );

  it('apply removes the target copy, verified directly over IMAP against the real account', async () => {
    const before = await messageLocations(MESSAGE_ID);
    expect(
      before.some((path) => /inbox/i.test(path)),
      `message must still be visible on the target before apply (found in: ${before.join(', ') || 'nowhere'})`,
    ).toBe(true);

    const { status, body } = await applyDeletion(mappingId, MESSAGE_HASH);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.action).toBe('apply');
    expect(['binned', 'deleted']).toContain(body.kind);

    const after = await messageLocations(MESSAGE_ID);
    expect(
      after.some((path) => /inbox/i.test(path)),
      `message must be gone from its original mailbox, still found in: ${after.join(', ')}`,
    ).toBe(false);

    // Verified against what actually happened rather than assumed: whether the
    // Stalwart target account provisions a \Trash-role mailbox is a property of
    // the server, and jmap-target.ts's trashMailboxId() decides `kind` at
    // runtime from exactly that — see ADR-0024.
    if (body.kind === 'binned') {
      expect(
        after.some((path) => /trash/i.test(path)),
        `kind=binned but the message is not in any mailbox matching /trash/: ${after.join(', ') || 'nowhere'}`,
      ).toBe(true);
    } else {
      expect(after, 'kind=deleted must mean the message is gone from every mailbox, not just its original one').toHaveLength(0);
    }
  }, 30000);

  it('a second apply on the same item is refused, not a silent no-op', async () => {
    const { status, body } = await applyDeletion(mappingId, MESSAGE_HASH);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('already_applied');
  }, 15000);

  it(
    'the removal survives one more sync pass — no resurrection on the target',
    async () => {
      await waitForNextPass('email', lastSyncedAtBeforeApply, PASS_WAIT_MS);

      const after = await messageLocations(MESSAGE_ID);
      expect(
        after.some((path) => /inbox/i.test(path)),
        `apply must not be silently undone by the next pass, but found in: ${after.join(', ')}`,
      ).toBe(false);

      const q = await getDeletions();
      expect(q.confirmed.map((d) => d.naturalKeyHash)).not.toContain(MESSAGE_HASH);
      expect(q.acknowledged.map((d) => d.naturalKeyHash)).toContain(MESSAGE_HASH);
    },
    PASS_WAIT_MS + 60000,
  );
});

describe('apply — calendar domain (CalDAV/Nextcloud)', () => {
  const EVENT_UID = 'dav-seed-event-2@dev.local';
  const EVENT_HASH = calendarNaturalKeyHash(EVENT_UID);
  const TARGET_HREF = `${NEXTCLOUD_URL}/remote.php/dav/calendars/${DAV_TARGET_USER}/personal/${EVENT_UID}.ics`;

  let mappingId = '';
  let lastSyncedAtBeforeApply: string | undefined;

  it(
    'deletes the event on the source and the appliance reports it as reported',
    async () => {
      execSync('node test/e2e/trash-caldav-source.mjs', {
        stdio: 'inherit',
        env: { ...process.env, TRASH_EVENT_UID: EVENT_UID },
      });
      const { mappingId: id, entry } = await waitForConfirmedDeletion(EVENT_HASH, PASS_WAIT_MS);
      mappingId = id;
      expect(entry.evidence).toBe('reported');
      lastSyncedAtBeforeApply = (await getDomainStatus('calendar'))?.lastSyncedAt;
    },
    PASS_WAIT_MS + 60000,
  );

  it('apply removes the target copy, verified directly against the real Nextcloud', async () => {
    const before = await fetch(TARGET_HREF, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(before.status, 'the event must still be live on the target before apply').toBe(200);

    const { status, body } = await applyDeletion(mappingId, EVENT_HASH);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.action).toBe('apply');
    // CalDAV/CardDAV removals always report `deleted` — see ADR-0024: whether a
    // given Nextcloud version retains a deleted calendar object is not
    // detectable from the outside, so recoverability is never claimed here.
    expect(body.kind).toBe('deleted');

    const after = await fetch(TARGET_HREF, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(after.status, 'the event must no longer exist at its target href').toBe(404);
  }, 30000);

  it('a second apply on the same item is refused, not a silent no-op', async () => {
    const { status, body } = await applyDeletion(mappingId, EVENT_HASH);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('already_applied');
  }, 15000);

  it(
    'the removal survives one more sync pass — no resurrection on the target',
    async () => {
      await waitForNextPass('calendar', lastSyncedAtBeforeApply, PASS_WAIT_MS);

      const after = await fetch(TARGET_HREF, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
      expect(after.status, 'apply must not be silently undone by the next pass').toBe(404);

      const q = await getDeletions();
      expect(q.confirmed.map((d) => d.naturalKeyHash)).not.toContain(EVENT_HASH);
      expect(q.acknowledged.map((d) => d.naturalKeyHash)).toContain(EVENT_HASH);
    },
    PASS_WAIT_MS + 60000,
  );
});
