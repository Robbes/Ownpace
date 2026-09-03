// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The writer asks the server about the component it is actually writing
 * (workplan 0113 T4).
 *
 * Both read-back queries filtered `comp-filter name="VEVENT"`. So a task
 * already on the target came back as "not there", and was re-PUT on every
 * pass, for ever. Nothing duplicated (same href, same UID) and nothing was
 * lost — it is the idempotency CHECK that was blind, not the write, which is
 * why a green suite never noticed.
 *
 * REACHABLE WITHOUT ANY TASK FEATURE AT ALL. `sync-collection` (RFC 6578) is
 * component-agnostic, so a MIXED collection — Nextcloud's default calendar
 * declares VEVENT,VTODO — already carries tasks through this writer today. A
 * customer migrating that calendar has been rewriting their to-do list on
 * every pass since the first one.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

interface Call {
  method: string;
  url: string;
  body: string;
}

/**
 * A server that answers everything emptily, so every read-back finds nothing
 * and the write path runs in full. What is under test is what we ASK, not what
 * comes back.
 */
function recordingServer(
  options: { putStatus?: number; componentSet?: string; listingFails?: boolean } = {},
) {
  const calls: Call[] = [];
  const client = {
    async request(o: { method: string; url: string; body?: unknown }) {
      calls.push({ method: o.method, url: o.url, body: String(o.body ?? '') });
      if (o.method === 'PUT') {
        return { status: options.putStatus ?? 201, body: 'refused', headers: {} };
      }
      if (o.method === 'MKCALENDAR') {
        return { status: 201, body: '', headers: {} };
      }
      // `calendarExists` PROPFINDs with NO body; `collectionComponents` sends
      // one. That is how this stub tells the two apart.
      if (o.method === 'PROPFIND' && o.body === undefined) {
        return { status: 404, body: '', headers: {} };
      }
      if (o.method === 'PROPFIND' && options.componentSet !== undefined) {
        return {
          status: 207,
          headers: {},
          body:
            '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">' +
            `<d:response><d:href>/c/</d:href><d:propstat><d:prop>${options.componentSet}` +
            '</d:prop></d:propstat></d:response></d:multistatus>',
        };
      }
      if (o.method === 'REPORT' && options.listingFails && !String(o.body).includes('prop-filter')) {
        return { status: 500, body: 'cannot enumerate', headers: {} };
      }
      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;
  const writer = new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls };
}

const object = (component: string, uid: string) => ({
  icalendar:
    `BEGIN:VCALENDAR\r\nBEGIN:${component}\r\nUID:${uid}\r\nSUMMARY:s\r\nEND:${component}\r\nEND:VCALENDAR`,
});

describe('the read-back follows the component being written', () => {
  it('a task is looked for as a VTODO — asking only for VEVENT is what made it invisible', async () => {
    const { writer, calls } = recordingServer();
    await writer.findCalendarByNaturalKey('calendars/alice/personal/', 'task-1', 'VTODO');
    const report = calls.find((c) => c.method === 'REPORT');
    expect(report?.body).toContain('<C:comp-filter name="VTODO">');
    expect(report?.body).not.toContain('<C:comp-filter name="VEVENT">');
  });

  it('an event is still looked for as a VEVENT — the existing behaviour, unchanged', async () => {
    const { writer, calls } = recordingServer();
    await writer.findCalendarByNaturalKey('calendars/alice/personal/', 'event-1', 'VEVENT');
    expect(calls.find((c) => c.method === 'REPORT')?.body).toContain('<C:comp-filter name="VEVENT">');
  });

  it('a caller that does not know the component asks for all three — never fewer', async () => {
    // Strictly more likely to find what is there. RFC 4791 §9.7.1: sibling
    // comp-filters are a logical OR.
    const { writer, calls } = recordingServer();
    await writer.findCalendarByNaturalKey('calendars/alice/personal/', 'x');
    const body = calls.find((c) => c.method === 'REPORT')?.body ?? '';
    for (const component of ['VEVENT', 'VTODO', 'VJOURNAL']) {
      expect(body, component).toContain(`<C:comp-filter name="${component}">`);
    }
  });

  it('the write path passes the component it is about to PUT, read from the object itself', async () => {
    // The collection snapshot is the fast path and answers for the whole
    // collection; the per-item REPORT is the fallback for a target that cannot
    // be enumerated. This test is about the fallback, so the listing fails.
    const { writer, calls } = recordingServer({ listingFails: true });
    await writer.upsertCalendarEvent('calendars/alice/personal/', object('VTODO', 'buy-milk') as never);
    // The collection snapshot runs first and finds nothing; the per-item
    // fallback is the one that must name VTODO.
    const reports = calls.filter((c) => c.method === 'REPORT');
    expect(reports.some((r) => r.body.includes('<C:comp-filter name="VTODO">'))).toBe(true);
  });
});

describe('the collection listing covers every component', () => {
  it('the snapshot that decides "already there" asks for all three, not for events only', async () => {
    const { writer, calls } = recordingServer();
    await writer.upsertCalendarEvent('calendars/alice/personal/', object('VTODO', 'buy-milk') as never);
    const listing = calls.find((c) => c.method === 'REPORT' && c.body.includes('<C:comp-filter name="VTODO"/>'));
    expect(listing, 'the listing REPORT should filter on every component').toBeDefined();
    for (const component of ['VEVENT', 'VTODO', 'VJOURNAL']) {
      expect(listing?.body, component).toContain(`<C:comp-filter name="${component}"/>`);
      // Partial retrieval is kept: the UID under each component, never the
      // whole object — a mailbox-sized calendar is not downloaded to count it.
      expect(listing?.body, component).toContain(`<C:comp name="${component}">`);
    }
    expect(listing?.body).toContain('<C:prop name="UID"/>');
  });
});

describe('a created collection says what it holds', () => {
  it('MKCALENDAR carries the source collection’s declared component set', async () => {
    const { writer, calls } = recordingServer();
    await writer.ensureCalendar({
      path: '/dav/calendars/bob/tasks/',
      name: 'Tasks',
      components: ['VTODO'],
    });
    const mk = calls.find((c) => c.method === 'MKCALENDAR');
    expect(mk?.body).toContain('<C:supported-calendar-component-set><C:comp name="VTODO"/>');
  });

  it('a source that declared nothing creates a collection that declares nothing', async () => {
    // Narrowing it to whatever this pass happened to see would be a guess, and
    // an unlucky one: a calendar whose only object today is a task would become
    // a VTODO-only collection for ever.
    const { writer, calls } = recordingServer();
    await writer.ensureCalendar({ path: '/dav/calendars/bob/personal/', name: 'Personal' });
    expect(calls.find((c) => c.method === 'MKCALENDAR')?.body).not.toContain(
      'supported-calendar-component-set',
    );
  });
});

describe('a refusal names the component, not just a status', () => {
  it('writing a task into a VEVENT-only calendar says exactly that', async () => {
    const { writer } = recordingServer({
      putStatus: 403,
      componentSet:
        '<cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>',
    });
    const message = await writer
      .upsertCalendarEvent('calendars/alice/personal/', object('VTODO', 'buy-milk') as never)
      .then(() => 'written', (e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(message).toContain('accepts VEVENT');
    expect(message).toContain('this object is a VTODO');
    expect(message).toContain('RFC 4791');
    // The server's own words survive: a diagnosis never replaces the evidence.
    expect(message).toContain('refused');
  });

  it('a refusal the component does NOT explain is passed through unchanged', async () => {
    // A guess dressed as a diagnosis is worse than the raw refusal. Here the
    // collection accepts what was written, so the 403 is about something else
    // and must be reported as the server stated it.
    const { writer } = recordingServer({
      putStatus: 403,
      componentSet:
        '<cal:supported-calendar-component-set><cal:comp name="VEVENT"/><cal:comp name="VTODO"/>' +
        '</cal:supported-calendar-component-set>',
    });
    const message = await writer
      .upsertCalendarEvent('calendars/alice/personal/', object('VTODO', 'buy-milk') as never)
      .then(() => 'written', (e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(message).toContain('PUT failed');
    expect(message).toContain('403');
    expect(message).not.toContain('accepts');
  });

  it('a collection that declares nothing gets no invented explanation either', async () => {
    const { writer } = recordingServer({ putStatus: 403, componentSet: '' });
    const message = await writer
      .upsertCalendarEvent('calendars/alice/personal/', object('VTODO', 'buy-milk') as never)
      .then(() => 'written', (e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(message).toContain('PUT failed');
    expect(message).not.toContain('accepts');
  });
});
