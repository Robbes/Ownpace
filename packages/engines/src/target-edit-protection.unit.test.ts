// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one path in this product that can destroy a person's work.
 *
 * Shadow migration invites the owner into the new system before cutover — that
 * is the whole proposition. Suppose they take it up and correct an event we
 * copied. Later the same event changes on the source. `classifyKnownItem` sees
 * a row we wrote ourselves and decides the bytes are ours to replace, which was
 * true when we wrote them; the pass then overwrites their correction without
 * reading it, and counts `updated: 1`. Nothing fails, nothing is logged, and
 * the edit is gone.
 *
 * Hard rule 2 was being enforced against a stale idea of ownership: status
 * 'copied' records that we wrote the bytes once, not that they are still ours.
 *
 * These tests hold the fix at the writer boundary, where it has to live — the
 * decision is only sound if the WRITE does not happen, and only the writer can
 * see what the target currently holds.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';
import { readEtag, ownershipOf } from './dav-target-version.ts';

const TENANT = asTenantId('6d330000-e29b-41d4-a716-4466554471a1' as never);
const MAPPING = asMappingId('6d330000-e29b-41d4-a716-4466554471a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

describe('readEtag', () => {
  it('finds the header whatever the server capitalised it as', () => {
    // Only the Fetch API guarantees lowercase keys. A writer built with a
    // custom HTTP client gets whatever that client produced, and a
    // case-sensitive lookup would silently find nothing — which reads as "no
    // protection available" and quietly re-opens the hole this closes.
    expect(readEtag({ status: 200, headers: { ETag: '"abc"' } })).toBe('abc');
    expect(readEtag({ status: 200, headers: { etag: '"abc"' } })).toBe('abc');
    expect(readEtag({ status: 200, headers: { 'E-Tag': '"abc"' } })).toBeUndefined();
  });

  it('normalises quoting and the weak validator away', () => {
    // The same object must compare equal however the server spells it. A
    // comparison sensitive to that would report a phantom edit the first time a
    // server changed its formatting — and a phantom edit freezes a real item for good.
    expect(readEtag({ status: 200, headers: { etag: 'W/"abc"' } })).toBe('abc');
    expect(readEtag({ status: 200, headers: { etag: '  "abc" ' } })).toBe('abc');
    expect(readEtag({ status: 200, headers: { etag: 'abc' } })).toBe('abc');
  });

  it('treats an empty ETag as none at all', () => {
    expect(readEtag({ status: 200, headers: { etag: '""' } })).toBeUndefined();
    expect(readEtag({ status: 200, headers: {} })).toBeUndefined();
  });
});

describe('ownershipOf', () => {
  it('only a KNOWN mismatch stops the write', () => {
    expect(ownershipOf('v1', 'v1')).toBe('ours');
    expect(ownershipOf('v1', 'v2')).toBe('changed');
  });

  it('compares a weak recorded version by its value (workplan 0149 T3)', () => {
    // A weak ETag is recorded with its W/ so it is never sent as If-Match; the
    // read-and-compare check it keeps compares the value, as `readEtag` reads it.
    expect(ownershipOf('W/v1', 'v1')).toBe('ours');
    expect(ownershipOf('W/v1', 'v2')).toBe('changed');
  });

  it('proceeds whenever either side is unknown', () => {
    // Both unknowns are ordinary, not suspicious: rows written before migration
    // 0023 have no recorded version, and plenty of servers answer HEAD without
    // one. Failing closed would refuse every source change until each row had
    // been rewritten once — a protection that presents as an outage.
    expect(ownershipOf(undefined, 'v2')).toBe('ours');
    expect(ownershipOf('v1', undefined)).toBe('ours');
    expect(ownershipOf(undefined, undefined)).toBe('ours');
  });
});

interface Call {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** What the server answered: a refused PUT is not a write. */
  status?: number;
}

/**
 * A DAV target that reports `currentEtag` for everything and stamps
 * `putEtag` on whatever it accepts.
 *
 * It honours `If-Match` as a real server does (RFC 9110 §13.1.1): a PUT that
 * names another version, or any version when the target reports none, is
 * refused with 412. Since workplan 0149 T3 that is where a rewrite over an
 * edited copy is stopped, so a stub that accepted every PUT would prove
 * nothing.
 */
function server(currentEtag: string | undefined, putEtag = 'after-our-write') {
  const calls: Call[] = [];
  const client: HttpClient = {
    async request(o) {
      const call: Call = { method: o.method, url: o.url, ...(o.headers ? { headers: o.headers } : {}) };
      calls.push(call);
      if (o.method === 'HEAD') {
        const headers: Record<string, string> = {};
        if (currentEtag !== undefined) headers.etag = `"${currentEtag}"`;
        return { status: 200, body: '', headers };
      }
      if (o.method === 'PUT') {
        const ifMatch = o.headers?.['If-Match'];
        if (ifMatch !== undefined && ifMatch !== `"${currentEtag}"`) {
          call.status = 412;
          return { status: 412, body: '', headers: {} };
        }
        call.status = 204;
        return { status: 204, body: '', headers: { etag: `"${putEtag}"` } };
      }
      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  };
  return {
    calls,
    client,
    /** The PUTs the server ACCEPTED: the writes that happened. */
    puts: () => calls.filter((c) => c.method === 'PUT' && c.status === 204),
    /** Every PUT sent, accepted or refused. */
    sent: () => calls.filter((c) => c.method === 'PUT'),
  };
}

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:evt-1\r\nSUMMARY:Corrected\r\nEND:VEVENT\r\nEND:VCALENDAR';
const VCF = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:card-1\r\nFN:Corrected\r\nEND:VCARD';

function calWriter(client: HttpClient) {
  return new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
}

describe('a rewrite whose target copy has been edited', () => {
  it('writes NOTHING and reports the conflict', async () => {
    // The assertion that matters is the absence of a PUT. Everything else in
    // this feature is bookkeeping; if the write goes out, the edit is gone
    // whatever the ledger says afterwards.
    const s = server('somebody-elses-version');
    const result = await calWriter(s.client).upsertCalendarEvent(
      '/calendars/alice/personal/',
      { item: { uid: 'evt-1', type: 'event', summary: 'Corrected', start: '', etag: 'e2', sourcePath: '', icalendar: ICS }, icalendar: ICS },
      { overwrite: true, expectedTargetVersion: 'the-version-we-wrote' },
    );

    expect(result.conflicted).toBe(true);
    expect(result.updated).toBeUndefined();
    expect(s.puts(), 'the customer edit must survive').toHaveLength(0);
    // The server refused it, on the version we recorded, in the write itself
    // (workplan 0149 T3): no read first, and no gap between the two.
    expect(s.sent()[0]?.headers?.['If-Match']).toBe('"the-version-we-wrote"');
    expect(s.calls.filter((c) => c.method === 'HEAD')).toHaveLength(0);
  });

  it('rewrites normally when the target still holds our version', async () => {
    const s = server('the-version-we-wrote');
    const result = await calWriter(s.client).upsertCalendarEvent(
      '/calendars/alice/personal/',
      { item: { uid: 'evt-1', type: 'event', summary: 'Corrected', start: '', etag: 'e2', sourcePath: '', icalendar: ICS }, icalendar: ICS },
      { overwrite: true, expectedTargetVersion: 'the-version-we-wrote' },
    );

    expect(result.conflicted).toBeUndefined();
    expect(result.updated).toBe(true);
    expect(s.puts()).toHaveLength(1);
    // The new version travels back, so the NEXT rewrite has something to check.
    // Without this the protection would work exactly once per item.
    expect(result.targetVersion).toBe('after-our-write');
  });

  it('does not check, or block, when we never recorded a version', async () => {
    // Every row written before migration 0023. Refusing here would stall update
    // propagation for an entire existing migration until each row happened to
    // be rewritten once, which cannot happen — the rewrite is the thing being
    // refused.
    const s = server('anything-at-all');
    const result = await calWriter(s.client).upsertCalendarEvent(
      '/calendars/alice/personal/',
      { item: { uid: 'evt-1', type: 'event', summary: 'Corrected', start: '', etag: 'e2', sourcePath: '', icalendar: ICS }, icalendar: ICS },
      { overwrite: true },
    );

    expect(result.updated).toBe(true);
    expect(s.puts()).toHaveLength(1);
    expect(s.calls.filter((c) => c.method === 'HEAD'), 'no version to check against').toHaveLength(0);
  });

  it('is refused when the target reports no version for the copy now', async () => {
    // It went ahead: nothing to compare, and silence is not evidence of an
    // edit. Since workplan 0149 T3 the server does the comparing, and
    // `If-Match` with our version cannot match a copy that has none, so the
    // server refuses and the rewrite is a conflict. The row then stays as it is
    // on the target, which errs on the side of the owner's data.
    const s = server(undefined);
    const result = await calWriter(s.client).upsertCalendarEvent(
      '/calendars/alice/personal/',
      { item: { uid: 'evt-1', type: 'event', summary: 'Corrected', start: '', etag: 'e2', sourcePath: '', icalendar: ICS }, icalendar: ICS },
      { overwrite: true, expectedTargetVersion: 'the-version-we-wrote' },
    );

    expect(result.conflicted).toBe(true);
    expect(s.puts()).toHaveLength(0);
  });

  it('keeps a read and a comparison for a WEAK version, which If-Match cannot carry (D4)', async () => {
    const s = server('the-version-we-wrote');
    const result = await calWriter(s.client).upsertCalendarEvent(
      '/calendars/alice/personal/',
      { item: { uid: 'evt-1', type: 'event', summary: 'Corrected', start: '', etag: 'e2', sourcePath: '', icalendar: ICS }, icalendar: ICS },
      { overwrite: true, expectedTargetVersion: 'W/the-version-we-wrote' },
    );

    expect(result.updated).toBe(true);
    expect(s.calls.filter((c) => c.method === 'HEAD'), 'the read it keeps').toHaveLength(1);
    expect(s.sent()[0]?.headers?.['If-Match'], 'never sent: it could not match').toBeUndefined();
  });
});

describe('the same rule in the other two writers', () => {
  it('CardDAV refuses a rewrite over an edited contact', async () => {
    const s = server('somebody-elses-version');
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: s.client },
    );
    const result = await writer.upsertContact(
      '/addressbooks/alice/contacts/',
      { item: { uid: 'card-1', type: 'person' as const, version: '3.0', name: 'Corrected', etag: 'e2', sourcePath: '', vcard: VCF }, vcard: VCF },
      { overwrite: true, expectedTargetVersion: 'the-version-we-wrote' },
    );
    expect(result.conflicted).toBe(true);
    expect(s.puts()).toHaveLength(0);
  });

  it('WebDAV refuses a rewrite over an edited file', async () => {
    const s = server('somebody-elses-version');
    const writer = new WebDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: s.client },
    );
    const result = await writer.upsertFile(
      '/files/alice/',
      {
        item: { path: 'notes.txt', name: 'notes.txt', isDirectory: false, size: 3, modifiedAt: '', etag: 'e2', sourceRef: 'notes.txt' },
        content: new TextEncoder().encode('new'),
      },
      { overwrite: true, expectedTargetVersion: 'the-version-we-wrote' },
    );
    expect(result.conflicted).toBe(true);
    expect(s.puts()).toHaveLength(0);
  });
});
