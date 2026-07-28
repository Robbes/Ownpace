// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * How many requests a DAV write costs, and that cutting them changed nothing
 * about what gets written.
 *
 * Migrating 203 calendar events — **52 KB in total** — took 76 seconds in a
 * real run: 374 ms an item, essentially none of it data transfer. The cost was
 * round trips. Each item did a `calendar-query` REPORT to ask "is this already
 * here?", then a PUT. One of those two is answerable for the whole collection
 * in a single request, because `listEntries` already enumerates it.
 *
 * These tests COUNT requests rather than trusting the code to look right, so a
 * regression that reintroduces the per-item probe fails here rather than in
 * someone's migration window.
 *
 * The behaviour they hold fixed while it gets faster:
 *   - an item already on the target is still adopted, not rewritten;
 *   - an item not on the target is still created exactly once;
 *   - a target that cannot be enumerated still migrates, via the old path.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer';
import { CardDAVTargetWriter } from './carddav-target-writer';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

/** A ledger that knows nothing — so every item takes the target-check path. */
const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

interface Call {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

/** A CalDAV collection holding `existing` UIDs, counting every request. */
function calServer(existing: string[]) {
  const calls: Call[] = [];
  const present = new Set(existing);

  const client = {
    async request(o: { method: string; url: string; headers?: Record<string, string>; body?: unknown }) {
      calls.push({ method: o.method, url: o.url, headers: o.headers });

      if (o.method === 'REPORT') {
        const responses = [...present]
          .map(
            (uid) =>
              `<d:response><d:href>/remote.php/dav/calendars/alice/personal/${uid}.ics</d:href>` +
              `<d:propstat><d:prop><cal:calendar-data>BEGIN:VEVENT\nUID:${uid}\nEND:VEVENT` +
              `</cal:calendar-data></d:prop></d:propstat></d:response>`,
          )
          .join('');
        return {
          status: 207,
          body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`,
          headers: {},
        };
      }

      if (o.method === 'PUT') {
        const uid = decodeURIComponent(o.url.split('/').pop() ?? '').replace(/\.ics$/, '');
        // A server honouring If-None-Match: * refuses to replace.
        if (present.has(uid) && o.headers?.['If-None-Match'] === '*') {
          return { status: 412, body: '', headers: {} };
        }
        present.add(uid);
        return { status: 201, body: '', headers: {} };
      }

      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;

  const writer = new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls, present };
}

function event(uid: string) {
  return { icalendar: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR` };
}

describe('CalDAV write cost', () => {
  it('asks the collection once, not once per item', async () => {
    const { writer, calls } = calServer([]);
    const collection = '/calendars/alice/personal/';

    for (let i = 1; i <= 20; i++) {
      await writer.upsertCalendarEvent(collection, event(`e${i}`) as never);
    }

    const reports = calls.filter((c) => c.method === 'REPORT');
    const puts = calls.filter((c) => c.method === 'PUT');

    // One listing for the whole collection, and one write per item. Before
    // this, `reports` was 20 — a round trip per item to ask a question the
    // listing already answers.
    expect(reports).toHaveLength(1);
    expect(puts).toHaveLength(20);
  });

  it('still adopts what the target already has, without writing over it', async () => {
    const { writer, calls } = calServer(['e1', 'e2']);
    const collection = '/calendars/alice/personal/';

    const first = await writer.upsertCalendarEvent(collection, event('e1') as never);
    const third = await writer.upsertCalendarEvent(collection, event('e3') as never);

    expect(first.created).toBe(false);
    expect(first.adopted).toBe(true);
    expect(third.created).toBe(true);

    // The adopted item was never written to.
    const writtenUids = calls
      .filter((c) => c.method === 'PUT')
      .map((c) => decodeURIComponent(c.url.split('/').pop() ?? ''));
    expect(writtenUids).toEqual(['e3.ics']);
  });

  it('sends a create-only precondition, so a stale snapshot cannot overwrite', async () => {
    // The check and the write are separate requests. `If-None-Match: *` is what
    // makes the pair safe rather than merely usually-safe: the server refuses
    // to replace, instead of us finding out afterwards.
    const { writer, calls } = calServer([]);
    await writer.upsertCalendarEvent('/calendars/alice/personal/', event('e1') as never);

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers?.['If-None-Match']).toBe('*');
  });

  it('treats the precondition failing as "already there", not as an error', async () => {
    // Something landed at that href after our snapshot was taken. The resource
    // exists and is keyed the way we would have keyed it, so this is an
    // adoption, not a failure — and certainly not something to retry over.
    const { writer, present } = calServer([]);
    const collection = '/calendars/alice/personal/';
    // Populate the server AFTER the snapshot is built.
    await writer.upsertCalendarEvent(collection, event('warm') as never);
    present.add('racer');

    const result = await writer.upsertCalendarEvent(collection, event('racer') as never);
    expect(result.targetId).toContain('racer.ics');
  });

  it('falls back to the per-item check when the collection cannot be listed', async () => {
    // A target we cannot enumerate must still migrate — just not as fast.
    const calls: Call[] = [];
    const client = {
      async request(o: { method: string; url: string; headers?: Record<string, string> }) {
        calls.push({ method: o.method, url: o.url, headers: o.headers });
        if (o.method === 'REPORT') return { status: 403, body: 'no listing for you', headers: {} };
        if (o.method === 'PUT') return { status: 201, body: '', headers: {} };
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;

    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    const result = await writer.upsertCalendarEvent('/calendars/alice/personal/', event('e1') as never);

    expect(result.created).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });
});

describe('CardDAV write cost', () => {
  function cardServer() {
    const calls: Call[] = [];
    const client = {
      async request(o: { method: string; url: string; headers?: Record<string, string> }) {
        calls.push({ method: o.method, url: o.url, headers: o.headers });
        if (o.method === 'REPORT')
          return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
        if (o.method === 'PUT') return { status: 201, body: '', headers: {} };
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client as never },
    );
    return { writer, calls };
  }

  it('asks the address book once, not once per contact', async () => {
    const { writer, calls } = cardServer();
    const book = '/addressbooks/users/alice/contacts/';

    for (let i = 1; i <= 15; i++) {
      await writer.upsertContact(book, { vcard: `BEGIN:VCARD\r\nUID:c${i}\r\nFN:n\r\nEND:VCARD` } as never);
    }

    expect(calls.filter((c) => c.method === 'REPORT')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(15);
    expect(calls.find((c) => c.method === 'PUT')?.headers?.['If-None-Match']).toBe('*');
  });
});
