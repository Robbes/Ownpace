// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A `targetId` means one thing, whichever path produced it.
 *
 * The DAV writers address everything relative to their configured endpoint:
 * `buildUrl` prepends `https://host/remote.php/dav` to whatever it is handed,
 * and the WRITE path records exactly that kind of path — `${calendarId}${filename}`,
 * which `normalizeCalendarPath` gives a leading slash and no host.
 *
 * The LISTING path recorded something else. `decodeHref(item.href)` is the
 * href as the server said it, and Sabre says it endpoint-absolute:
 * `/remote.php/dav/calendars/u/c/x.ics`. That value reached the ledger through
 * adoption — the branch that fires when a UID is already on the target — so a
 * single mapping ended up holding two coordinate systems at once:
 *
 *     /calendars/admin/feddematsagenda/                 644 rows   (written)
 *     /remote.php/dav/calendars/admin/feddematsagenda/    4 rows   (adopted)
 *
 * Feed one of those four back through `buildUrl` and the prefix appears twice.
 * Every request built from it 404s — and `removeDavResource` reads 404 on a
 * DELETE as "already gone" and reports `deleted`. So an owner-approved erasure
 * of an adopted item would tombstone the row, report success, and leave the
 * item sitting in the calendar. That is the failure this file exists to stop.
 *
 * The doubling was already known. `caldav-target-writer.ts` carries the story
 * in its own words — `remote.php/dav/remote.php/dav`, every REPORT 404 — and
 * fixed it for COLLECTIONS, noting that "only the reindexer feeds server hrefs
 * back in". A hundred lines further down the ITEM hrefs were still fed back
 * raw, and one consumer (`contentHashFor`) converted them locally instead. A
 * fix at one consumer leaves every other consumer holding the raw value, and
 * the ledger is a consumer that outlives the run.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { targetIdRelativeTo } from './dav-multistatus.ts';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461a2' as never);
const HOST = 'https://cloud.example.com';
const BASE = `${HOST}/remote.php/dav`;
const COLLECTION = '/calendars/alice/personal/';
const ON_TARGET = 'already-there@example.invalid';

/** The href shape Sabre returns: endpoint-absolute, not relative to our base. */
const serverHref = (uid: string) => `/remote.php/dav${COLLECTION}${uid}.ics`;

interface Call {
  method: string;
  url: string;
  body: string;
}

/** Every `recordIfAbsent` the writer made, in order. */
function capturingLedger(records: Array<Record<string, unknown>>): Ledger {
  return {
    find: async () => undefined,
    recordIfAbsent: async (record: Record<string, unknown>) => {
      records.push(record);
      return undefined;
    },
  } as unknown as Ledger;
}

function multistatus(dataElement: string, uid: string): string {
  return (
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" ' +
    'xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav">' +
    `<d:response><d:href>${serverHref(uid)}</d:href><d:propstat><d:prop>` +
    `<${dataElement}>${uid.startsWith('vcard') ? vcard(uid) : ical(uid)}</${dataElement}>` +
    '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
  );
}

const ical = (uid: string) =>
  `BEGIN:VCALENDAR&#13;&#10;BEGIN:VEVENT&#13;&#10;UID:${uid}&#13;&#10;SUMMARY:s&#13;&#10;END:VEVENT&#13;&#10;END:VCALENDAR`;
const vcard = (uid: string) =>
  `BEGIN:VCARD&#13;&#10;VERSION:3.0&#13;&#10;UID:${uid}&#13;&#10;FN:n&#13;&#10;END:VCARD`;

/** A server holding exactly one object, at an endpoint-absolute href. */
function serverHolding(uid: string, dataElement: 'cal:calendar-data' | 'card:address-data') {
  const calls: Call[] = [];
  const client = {
    async request(o: { method: string; url: string; body?: unknown }) {
      calls.push({ method: o.method, url: o.url, body: String(o.body ?? '') });
      if (o.method === 'PUT') return { status: 201, body: '', headers: { etag: '"e1"' } };
      if (o.method === 'DELETE') return { status: 204, body: '', headers: {} };
      if (o.method === 'MKCALENDAR' || o.method === 'MKCOL') {
        return { status: 201, body: '', headers: {} };
      }
      if (o.method === 'PROPFIND' && o.body === undefined) {
        return { status: 404, body: '', headers: {} };
      }
      if (o.method === 'REPORT') {
        return { status: 207, body: multistatus(dataElement, uid), headers: {} };
      }
      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;
  return { client, calls };
}

const event = (uid: string) =>
  ({
    icalendar: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR`,
  }) as never;

function calendarWriter(records: Array<Record<string, unknown>>, uid = ON_TARGET) {
  const { client, calls } = serverHolding(uid, 'cal:calendar-data');
  const writer = new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    {
      domain: 'calendar',
      ledger: capturingLedger(records),
      tenantId: TENANT,
      mappingId: MAPPING,
      httpClient: client,
    },
  );
  return { writer, calls };
}

describe('a handle the writer can actually address', () => {
  it('the listing yields a path relative to the endpoint, not the server href', async () => {
    const { writer } = calendarWriter([]);
    const entries = [];
    for await (const entry of writer.listEntries(COLLECTION)) entries.push(entry);

    expect(entries, 'the stub holds exactly one object').toHaveLength(1);
    expect(entries[0]?.targetId).toBe(`${COLLECTION}${ON_TARGET}.ics`);
    // The whole point: the DAV prefix belongs to `buildUrl`, never to the handle.
    expect(entries[0]?.targetId).not.toContain('remote.php');
  });

  it('the CardDAV listing says the same thing — the defect is shared, so the fix is', async () => {
    const { client } = serverHolding('vcard-1@example.invalid', 'card:address-data');
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger: capturingLedger([]), tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    );

    const entries = [];
    for await (const entry of writer.listEntries('/addressbooks/alice/contacts/')) entries.push(entry);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetId).not.toContain('remote.php');
    expect(entries[0]?.targetId.startsWith('/')).toBe(true);
  });

  it('adoption and writing record the SAME coordinate system for one collection', async () => {
    // This is the invariant, stated as the equality it is. The two paths ran
    // against one collection and one endpoint; if they disagree about how to
    // name a resource, the ledger holds two languages and nothing can tell.
    const adopted: Array<Record<string, unknown>> = [];
    const { writer: a } = calendarWriter(adopted);
    await a.upsertCalendarEvent(COLLECTION, event(ON_TARGET));

    const written: Array<Record<string, unknown>> = [];
    const { writer: b } = calendarWriter(written);
    await b.upsertCalendarEvent(COLLECTION, event('brand-new@example.invalid'));

    expect(adopted[0]?.status, 'the UID was on the target, so this is the adoption path').toBe(
      'adopted',
    );
    expect(written[0]?.status ?? 'copied').not.toBe('adopted');

    const prefixOf = (id: unknown) => String(id).slice(0, String(id).lastIndexOf('/') + 1);
    expect(prefixOf(adopted[0]?.targetId)).toBe(prefixOf(written[0]?.targetId));
    expect(adopted[0]?.targetId).toBe(`${COLLECTION}${ON_TARGET}.ics`);
  });

  it('the per-item REPORT fallback answers in that coordinate system too', async () => {
    // The snapshot is the fast path; this is what answers when a collection
    // cannot be enumerated. Both feed `existingTargetId`, so both must agree.
    const { writer } = calendarWriter([]);
    const found = await writer.findCalendarByNaturalKey(COLLECTION, ON_TARGET, 'VEVENT');
    expect(found).toBe(`${COLLECTION}${ON_TARGET}.ics`);
  });
});

describe('what the doubled prefix would have cost', () => {
  it('an adopted handle deletes the item, not a path that never existed', async () => {
    // `removeDavResource` reads 404 on a DELETE as "already gone" and reports
    // `deleted` — right for a real href, catastrophic for a doubled one: the
    // row is tombstoned, the erasure is reported done, and the item is still
    // in the calendar. So the URL must carry the DAV prefix exactly once.
    const records: Array<Record<string, unknown>> = [];
    const { writer, calls } = calendarWriter(records);
    await writer.upsertCalendarEvent(COLLECTION, event(ON_TARGET));

    await writer.removeItem(String(records[0]?.targetId));

    const deletes = calls.filter((c) => c.method === 'DELETE');
    expect(deletes, 'exactly one DELETE was issued').toHaveLength(1);
    expect(deletes[0]!.url).toBe(`${BASE}${COLLECTION}${ON_TARGET}.ics`);
    expect(deletes[0]!.url.split('remote.php').length - 1, 'the DAV prefix appears once').toBe(1);
  });
});

describe('an href that is not ours to key', () => {
  it('refuses it rather than inventing a handle', () => {
    // `hrefRelativeTo` returns undefined here and COLLECTIONS are right to drop
    // it. An item is not: dropped, it reads as missing from a target that holds
    // it; kept raw, it reads as present at a path that does not resolve.
    expect(() => targetIdRelativeTo('/some/other/mount/x.ics', `${BASE}/`)).toThrow(
      /not addressable under/,
    );
  });

  it('accepts an absolute URL under the same base, because servers send those too', () => {
    expect(targetIdRelativeTo(`${BASE}${COLLECTION}x.ics`, `${BASE}/`)).toBe(
      `${COLLECTION}x.ics`,
    );
  });
});
