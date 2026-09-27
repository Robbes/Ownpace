// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL RECORDED AS A COPY (workplan 0149 T1).
 *
 * All three DAV writers create with `If-None-Match: *`, so a server that
 * already holds something at the href answers 412 and writes nothing. Each
 * writer then returned the path it had tried, as if the write had happened:
 * the row was recorded with no status, which the ledger fills in as `copied`,
 * and the item counted as created.
 *
 * From then on the item the customer already had was treated as one Ownpace
 * wrote. A source change overwrote it, because only `adopted` rows are left
 * alone and a row with no version skips the ownership check. And *apply
 * deletions* would remove it, because `copied` is exactly what it removes.
 * The owner offers *apply deletions* to testers (0149 D1), so removal has to
 * fail closed first.
 *
 * Nothing in a 412 says whose the object is: it may have appeared since the
 * snapshot, a failed lookup may have hidden it, or our own PUT may have landed
 * behind a 5xx its retry never saw. So the writer asks, as the JMAP mail
 * writer does on `alreadyExists`, and adopts only what the server names:
 *
 *  - CalDAV and CardDAV ask who holds the UID. An href named is adopted; none
 *    named means the href holds something else, and the item fails as
 *    `target_refused`, recording nothing;
 *  - WebDAV's path is the natural key, so it adopts at the path, buffered or
 *    streamed, but only once asked what is there: a 412 answers for a
 *    DIRECTORY too, which is never adopted as a file.
 */

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  fileContentHash,
  statedFailureCategoryOf,
  type Ledger,
} from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { WebDAVTargetWriter } from './webdav-target-writer.ts';

// UUID family 0149a100-…, unused elsewhere in the repo.
const TENANT = asTenantId('0149a100-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('0149a100-e29b-41d4-a716-446655440002' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';
const CAL = '/calendars/alice/personal/';
const BOOK = '/addressbooks/users/alice/contacts/';
const UID = 'held-already@example.invalid';
/** Where the server says the object holding `UID` is: not the href we tried. */
const HELD = 'somewhere-else';

const EMPTY = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>';

/** A ledger that knows nothing, and keeps every row a writer records. */
function capturingLedger(records: Array<Record<string, unknown>>): Ledger {
  return {
    find: async () => undefined,
    recordIfAbsent: async (record: Record<string, unknown>) => {
      records.push(record);
      return undefined;
    },
  } as unknown as Ledger;
}

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

/**
 * A CalDAV or CardDAV collection whose listing finds nothing, so the PUT is
 * what discovers the object, and which refuses that PUT with 412 — carrying
 * an ETag, so a writer that lifted it would claim a version it never made.
 * Asked by UID (`text-match`, which the listing never sends), it names the
 * object at `HELD` unless `named` is false.
 */
function davCollection(dir: string, element: 'cal:calendar-data' | 'card:address-data', named = true) {
  const sent: Sent[] = [];
  const ext = element === 'cal:calendar-data' ? '.ics' : '.vcf';
  const data =
    element === 'cal:calendar-data'
      ? `BEGIN:VCALENDAR&#13;&#10;BEGIN:VEVENT&#13;&#10;UID:${UID}&#13;&#10;END:VEVENT&#13;&#10;END:VCALENDAR`
      : `BEGIN:VCARD&#13;&#10;VERSION:3.0&#13;&#10;UID:${UID}&#13;&#10;FN:n&#13;&#10;END:VCARD`;
  const found =
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" ' +
    'xmlns:card="urn:ietf:params:xml:ns:carddav">' +
    `<d:response><d:href>/remote.php/dav${dir}${HELD}${ext}</d:href><d:propstat><d:prop>` +
    `<${element}>${data}</${element}></d:prop></d:propstat></d:response></d:multistatus>`;
  const client = {
    async request(o: { method: string; url: string; body?: unknown }) {
      const body = String(o.body ?? '');
      sent.push({ method: o.method, url: o.url, body });
      if (o.method === 'PUT') return { status: 412, body: '', headers: { etag: '"theirs-1"' } };
      if (o.method === 'REPORT' && body.includes('text-match')) {
        return { status: 207, body: named ? found : EMPTY, headers: {} };
      }
      return { status: 207, body: EMPTY, headers: {} };
    },
  } as unknown as HttpClient;
  return { client, sent, heldRelative: `${dir}${HELD}${ext}` };
}

function calendarWriter(records: Array<Record<string, unknown>>, client: HttpClient) {
  return new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { domain: 'calendar', ledger: capturingLedger(records), tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
}

function contactWriter(records: Array<Record<string, unknown>>, client: HttpClient) {
  return new CardDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { ledger: capturingLedger(records), tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
}

const event = (recurrenceId?: string) =>
  ({
    icalendar: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${UID}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    ...(recurrenceId ? { item: { recurrenceId } } : {}),
  }) as never;

const card = () => ({ vcard: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${UID}\r\nFN:Someone\r\nEND:VCARD` }) as never;

describe('a CalDAV create refused with 412', () => {
  it('is adopted at the object the server names, not recorded as a copy', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { client, heldRelative } = davCollection(CAL, 'cal:calendar-data');

    const result = await calendarWriter(records, client).upsertCalendarEvent(CAL, event());

    expect(result.created).toBe(false);
    expect(result.adopted).toBe(true);
    expect(result.targetId).toBe(heldRelative);
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('adopted');
    expect(records[0]!.targetId).toBe(heldRelative);
    expect(records[0]!.targetVersion, 'a version the writer never made').toBeUndefined();
  });

  it('fails as target_refused, recording nothing, when no object carries the UID', async () => {
    // The href is held by something else. Adopting it would claim another
    // item's object as this one; a copy would be a lie.
    const records: Array<Record<string, unknown>> = [];
    const { client } = davCollection(CAL, 'cal:calendar-data', false);

    const thrown = await calendarWriter(records, client)
      .upsertCalendarEvent(CAL, event())
      .catch((e: unknown) => e);

    expect(String(thrown)).toMatch(/refused with 412.*No object in .* carries this item's UID/);
    expect(statedFailureCategoryOf(thrown)).toBe('target_refused');
    expect(records).toHaveLength(0);
  });

  it('never adopts a modified occurrence onto what holds its series', async () => {
    // The rule the UID refusal already follows: a series and its override
    // share one UID, and the object under it is not the override.
    const records: Array<Record<string, unknown>> = [];
    const { client } = davCollection(CAL, 'cal:calendar-data');

    const thrown = await calendarWriter(records, client)
      .upsertCalendarEvent(CAL, event('20260922T130000Z'))
      .catch((e: unknown) => e);

    expect(String(thrown)).toMatch(/refused with 412.*modified occurrence/);
    expect(statedFailureCategoryOf(thrown)).toBe('target_refused');
    expect(records).toHaveLength(0);
  });

  it('fails, recording nothing, when the question cannot be answered', async () => {
    // After T2 the lookup throws rather than guessing, and the 412 rests on it.
    const records: Array<Record<string, unknown>> = [];
    const client = {
      async request(o: { method: string; body?: unknown }) {
        if (o.method === 'PUT') return { status: 412, body: '', headers: {} };
        if (o.method === 'REPORT' && String(o.body ?? '').includes('text-match')) {
          return { status: 403, body: 'no', headers: {} };
        }
        return { status: 207, body: EMPTY, headers: {} };
      },
    } as unknown as HttpClient;

    await expect(calendarWriter(records, client).upsertCalendarEvent(CAL, event())).rejects.toThrow(
      /refusing to treat this as "not present"/,
    );
    expect(records).toHaveLength(0);
  });
});

describe('a CardDAV create refused with 412', () => {
  it('is adopted at the card the server names, not recorded as a copy', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { client, heldRelative } = davCollection(BOOK, 'card:address-data');

    const result = await contactWriter(records, client).upsertContact(BOOK, card());

    expect(result.created).toBe(false);
    expect(result.adopted).toBe(true);
    expect(result.targetId).toBe(heldRelative);
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('adopted');
    expect(records[0]!.targetVersion).toBeUndefined();
  });

  it('fails as target_refused, recording nothing, when no card carries the UID', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { client } = davCollection(BOOK, 'card:address-data', false);

    const thrown = await contactWriter(records, client)
      .upsertContact(BOOK, card())
      .catch((e: unknown) => e);

    expect(String(thrown)).toMatch(/refused with 412.*no card in .* carries this contact's UID/);
    expect(statedFailureCategoryOf(thrown)).toBe('target_refused');
    expect(records).toHaveLength(0);
  });
});

/**
 * A WebDAV root holding nothing the walk can see, which refuses every create
 * with 412, and whose answer about the path itself is `held`: a file, a
 * directory, or nothing at all.
 */
function webdavRoot(held: 'file' | 'directory' | 'nothing') {
  const sent: Sent[] = [];
  const response = (href: string, collection: boolean) =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
    `<d:resourcetype>${collection ? '<d:collection/>' : ''}</d:resourcetype>` +
    '</d:prop></d:propstat></d:response>';
  const client = {
    async request(o: { method: string; url: string; headers?: Record<string, string>; body?: unknown }) {
      sent.push({ method: o.method, url: o.url, body: typeof o.body === 'string' ? o.body : '' });
      const self = new URL(o.url).pathname;
      if (o.method === 'PROPFIND' && o.headers?.Depth === '1') {
        // The walk: the root lists only itself.
        return { status: 207, body: `<d:multistatus xmlns:d="DAV:">${response(self, true)}</d:multistatus>`, headers: {} };
      }
      if (o.method === 'PROPFIND') {
        if (held === 'nothing') return { status: 404, body: '', headers: {} };
        return {
          status: 207,
          body: `<d:multistatus xmlns:d="DAV:">${response(self, held === 'directory')}</d:multistatus>`,
          headers: {},
        };
      }
      if (o.method === 'PUT') return { status: 412, body: '', headers: { etag: '"theirs-1"' } };
      return { status: 201, body: '', headers: {} };
    },
  } as unknown as HttpClient;
  return { client, sent };
}

function fileWriter(records: Array<Record<string, unknown>>, client: HttpClient) {
  return new WebDAVTargetWriter(
    { url: `${BASE}/files/alice/`, username: 'alice', password: 'pw' },
    { ledger: capturingLedger(records), tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
}

const BYTES = new TextEncoder().encode('the bytes the source holds');
const itemAt = (path: string) => ({ path, name: path, isDirectory: false, size: BYTES.byteLength, modifiedAt: '', sourceRef: '' });
const buffered = (path = 'report.pdf') => ({ item: itemAt(path), content: BYTES }) as never;
const streamed = (path = 'report.pdf') =>
  ({
    item: itemAt(path),
    body: {
      sizeBytes: BYTES.byteLength,
      open: async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(BYTES);
            controller.close();
          },
        }),
    },
  }) as never;

describe('a WebDAV create refused with 412', () => {
  for (const [shape, raw] of [
    ['buffered', buffered],
    ['streamed', streamed],
  ] as const) {
    it(`is adopted at the path when a file is there (${shape})`, async () => {
      const records: Array<Record<string, unknown>> = [];
      const { client } = webdavRoot('file');

      const result = await fileWriter(records, client).upsertFile('', raw());

      expect(result.created).toBe(false);
      expect(result.adopted).toBe(true);
      expect(result.targetId).toBe('report.pdf');
      expect(records).toHaveLength(1);
      expect(records[0]!.status).toBe('adopted');
      expect(records[0]!.targetVersion).toBeUndefined();
      // The source's bytes, hashed: a streamed body is read again to say so.
      expect(records[0]!.contentHash).toBe(fileContentHash(BYTES));
    });
  }

  it('is never adopted as a file when a DIRECTORY is there', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { client } = webdavRoot('directory');

    await expect(fileWriter(records, client).upsertFile('', buffered())).rejects.toThrow(
      /already holds a DIRECTORY/,
    );
    expect(records).toHaveLength(0);
  });

  it('fails as target_refused, recording nothing, when nothing is there once asked', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { client } = webdavRoot('nothing');

    const thrown = await fileWriter(records, client)
      .upsertFile('', buffered())
      .catch((e: unknown) => e);

    expect(String(thrown)).toMatch(/refused with 412, and the target then answered that nothing is at that path/);
    expect(statedFailureCategoryOf(thrown)).toBe('target_refused');
    expect(records).toHaveLength(0);
  });

  it('keeps the snapshot current, so the same path is not written at again', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { client, sent } = webdavRoot('file');
    const writer = fileWriter(records, client);

    await writer.upsertFile('', buffered());
    await writer.upsertFile('', buffered());

    expect(sent.filter((s) => s.method === 'PUT')).toHaveLength(1);
  });
});
