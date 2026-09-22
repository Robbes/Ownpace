// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A UID the collection already held is not a failure.
 *
 * Both writers create with `If-None-Match: *`, and both read the resulting 412
 * correctly: *"not an error — the caller's snapshot was merely stale, and the
 * resource is exactly what we would have written."* That precondition is
 * atomic against the HREF.
 *
 * RFC 4791 §5.3.2's uniqueness rule is not on the href. It is on the UID, and
 * the href is ours to choose — we name it after the source's own handle. So
 * when one UID reaches us under a SECOND source handle, that path is free, the
 * precondition does not fire, and the server refuses the body:
 *
 *     PUT failed for …/<id>.ics with status 400:
 *     Sabre\DAV\Exception\BadRequest — Calendar object with uid already
 *     exists in this calendar collection.
 *
 * Which was thrown. Four of the owner's events landed `failed` that way in one
 * run, with `last_error_category` reading `unknown` — whose published remedy is
 * *"send it to us and we will look"* for a refusal that says in plain words
 * what is wrong. A later pass then found each object through the by-UID check
 * and adopted it, so the operator's report of that run named four failures
 * that the ledger no longer agreed were failures.
 *
 * Two things have to hold at once here, and they pull in opposite directions:
 *
 *  - the refusal must be RECOGNISED, so the item is recorded rather than
 *    failed; and
 *  - it must never be recognised on the writer's own say-so. The server names
 *    the href or nothing is recorded, because a refusal is a claim about the
 *    collection and not a handle to the object.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, statedFailureCategoryOf, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';
import { refusalSaysUidAlreadyPresent } from './dav-uid-conflict.ts';

const TENANT = asTenantId('7c530000-e29b-41d4-a716-4466554471a1' as never);
const MAPPING = asMappingId('7c530000-e29b-41d4-a716-4466554471a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';
const CAL = '/calendars/alice/personal/';
const BOOK = '/addressbooks/users/alice/contacts/';

/** One UID, two source handles — the second is the one that collides. */
const UID = 'shared-identity@example.invalid';
const FIRST_HANDLE = 'first-handle@example.invalid';

const SABRE_UID_TAKEN =
  '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
  '<s:exception>Sabre\\DAV\\Exception\\BadRequest</s:exception>' +
  '<s:message>Calendar object with uid already exists in this calendar collection.</s:message></d:error>';

const CARD_UID_TAKEN =
  '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
  `<s:message>Card with uid ${UID} already exists in this addressbook</s:message></d:error>`;

const COMPONENT_SET =
  '<cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>';

function capturingLedger(records: Array<Record<string, unknown>>): Ledger {
  return {
    find: async () => undefined,
    recordIfAbsent: async (record: Record<string, unknown>) => {
      records.push(record);
      return undefined;
    },
  } as unknown as Ledger;
}

/**
 * A collection that refuses the write and, when ASKED by UID, names where the
 * object really is. `foundByUid: false` is the server that refuses and then
 * says it holds nothing — the case the writer must not paper over.
 */
function collidingServer(options: {
  readonly dir: string;
  readonly dataElement: 'cal:calendar-data' | 'card:address-data';
  readonly refusal: string;
  readonly status?: number;
  readonly foundByUid?: boolean;
  readonly heldAt?: string;
}) {
  const heldHref = `/remote.php/dav${options.dir}${options.heldAt ?? FIRST_HANDLE}${
    options.dataElement === 'cal:calendar-data' ? '.ics' : '.vcf'
  }`;
  const payload =
    options.dataElement === 'cal:calendar-data'
      ? `BEGIN:VCALENDAR&#13;&#10;BEGIN:VEVENT&#13;&#10;UID:${UID}&#13;&#10;END:VEVENT&#13;&#10;END:VCALENDAR`
      : `BEGIN:VCARD&#13;&#10;VERSION:3.0&#13;&#10;UID:${UID}&#13;&#10;FN:n&#13;&#10;END:VCARD`;
  const found =
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" ' +
    'xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:card="urn:ietf:params:xml:ns:carddav">' +
    `<d:response><d:href>${heldHref}</d:href><d:propstat><d:prop>` +
    `<${options.dataElement}>${payload}</${options.dataElement}>` +
    '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
  const empty = '<d:multistatus xmlns:d="DAV:"></d:multistatus>';

  const calls: Array<{ method: string; url: string; body: string }> = [];
  const client = {
    async request(o: { method: string; url: string; body?: unknown }) {
      const body = String(o.body ?? '');
      calls.push({ method: o.method, url: o.url, body });
      if (o.method === 'PUT') {
        return { status: options.status ?? 400, body: options.refusal, headers: {} };
      }
      if (o.method === 'PROPFIND') {
        // `calendarExists` sends no body; `collectionComponents` does.
        return o.body === undefined
          ? { status: 404, body: '', headers: {} }
          : {
              status: 207,
              headers: {},
              body:
                '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" ' +
                `xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${options.dir}</d:href>` +
                `<d:propstat><d:prop>${COMPONENT_SET}</d:prop></d:propstat></d:response></d:multistatus>`,
            };
      }
      if (o.method === 'REPORT') {
        // `text-match` is what the by-UID question has and the collection
        // listing does not — in BOTH protocols. `prop-filter` is not: CardDAV's
        // match-all listing is built from `<prop-filter name="UID"/>`, so
        // keying on it answered the LISTING as well, the up-front check found
        // the card, and the PUT never ran. That test passed with the whole fix
        // reverted; the mutation run is what said so.
        //
        // Only the by-UID question is answered here, so the up-front check
        // misses and the PUT is what discovers the collision — which is the
        // entire scenario under test.
        const asksByUid = body.includes('text-match');
        const answers = asksByUid && (options.foundByUid ?? true);
        return { status: 207, body: answers ? found : empty, headers: {} };
      }
      return { status: 207, body: empty, headers: {} };
    },
  } as unknown as HttpClient;
  return { client, calls, heldRelative: heldHref.replace('/remote.php/dav', '') };
}

const event = (recurrenceId?: string) =>
  ({
    icalendar: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${UID}\r\nSUMMARY:s\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    ...(recurrenceId ? { item: { recurrenceId } } : {}),
  }) as never;

function calendar(
  records: Array<Record<string, unknown>>,
  options: Parameters<typeof collidingServer>[0],
) {
  const { client, calls, heldRelative } = collidingServer(options);
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
  return { writer, calls, heldRelative };
}

const calOptions = { dir: CAL, dataElement: 'cal:calendar-data', refusal: SABRE_UID_TAKEN } as const;

describe('a create refused because the UID is already held', () => {
  it('is recorded against the object, not thrown as a failure', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { writer, heldRelative } = calendar(records, calOptions);

    const result = await writer.upsertCalendarEvent(CAL, event());

    expect(result.created).toBe(false);
    expect(result.adopted).toBe(true);
    // The href the SERVER named, not the one we tried to write. Those differ
    // by construction here: we would have PUT `shared-identity…ics`.
    expect(result.targetId).toBe(heldRelative);
    expect(records[0]?.status).toBe('adopted');
    expect(records[0]?.targetId).toBe(heldRelative);
    expect(String(records[0]?.targetId)).not.toContain(UID);
  });

  it('is still thrown when the server then says it holds nothing', async () => {
    // A refusal is a claim about the COLLECTION. Recording an item against a
    // path nobody named is how the last defect in this file worked.
    const records: Array<Record<string, unknown>> = [];
    const { writer } = calendar(records, { ...calOptions, foundByUid: false });

    await expect(writer.upsertCalendarEvent(CAL, event())).rejects.toThrow(/already exists/i);
    expect(records, 'nothing may be recorded for an item that did not land').toHaveLength(0);
  });

  it('never adopts a modified occurrence onto its own series', async () => {
    // A series and its override share one iCalendar UID — that sharing is what
    // makes them one event (RFC 5545 §3.8.4.4) — but they are two ledger items,
    // because `naturalKeyForCalendar` appends RECURRENCE-ID. The object already
    // under this UID is the SERIES. Adopting the override onto it would report
    // the override migrated with nothing of it on the target, and a later
    // rewrite would replace the series with the override alone.
    const records: Array<Record<string, unknown>> = [];
    const { writer } = calendar(records, calOptions);

    await expect(
      writer.upsertCalendarEvent(CAL, event('20260922T130000Z')),
    ).rejects.toThrow(/already exists/i);
    expect(records).toHaveLength(0);
  });

  it('states target_refused on what it does throw, so no row reads unknown', async () => {
    const { writer } = calendar([], { ...calOptions, foundByUid: false });

    const thrown = await writer.upsertCalendarEvent(CAL, event()).catch((e: unknown) => e);
    expect(statedFailureCategoryOf(thrown)).toBe('target_refused');
  });

  it('leaves an unrelated refusal alone', async () => {
    // A 403 for something else must not be read as a UID collision and quietly
    // adopted onto whatever the by-UID question happens to return.
    const records: Array<Record<string, unknown>> = [];
    const { writer } = calendar(records, {
      ...calOptions,
      status: 403,
      refusal: '<s:message>Access denied to this calendar</s:message>',
    });

    await expect(writer.upsertCalendarEvent(CAL, event())).rejects.toThrow(/Access denied/i);
    expect(records).toHaveLength(0);
  });
});

function contacts(
  records: Array<Record<string, unknown>>,
  options: Partial<Parameters<typeof collidingServer>[0]> = {},
) {
  const { client, calls, heldRelative } = collidingServer({
    dir: BOOK,
    dataElement: 'card:address-data',
    refusal: CARD_UID_TAKEN,
    ...options,
  });
  const writer = new CardDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { ledger: capturingLedger(records), tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, calls, heldRelative };
}

const card = () =>
  ({ vcard: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${UID}\r\nFN:Someone\r\nEND:VCARD` }) as never;

describe('the same refusal on a vCard', () => {
  it('is recorded against the card the book already holds', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { writer, heldRelative } = contacts(records);

    const result = await writer.upsertContact(BOOK, card());

    expect(result.adopted).toBe(true);
    expect(result.targetId).toBe(heldRelative);
    expect(records[0]?.status).toBe('adopted');
  });

  it('is still thrown when the book then says it holds nothing', async () => {
    const records: Array<Record<string, unknown>> = [];
    const { writer } = contacts(records, { foundByUid: false });

    await expect(writer.upsertContact(BOOK, card())).rejects.toThrow(/already exists/i);
    expect(records).toHaveLength(0);
  });

  it('states target_refused on what it does throw', async () => {
    // The CalDAV writer's sibling assertion. Without it, dropping the stated
    // category from THIS writer changed no test — the mutation run is what
    // said so, and an untested statement is one a later edit removes for free.
    const { writer } = contacts([], { foundByUid: false });

    const thrown = await writer.upsertContact(BOOK, card()).catch((e: unknown) => e);
    expect(statedFailureCategoryOf(thrown)).toBe('target_refused');
  });
});

describe('what the detector will and will not call a UID collision', () => {
  it('reads the sentence a live Nextcloud sent', () => {
    expect(refusalSaysUidAlreadyPresent(SABRE_UID_TAKEN)).toBe(true);
    expect(refusalSaysUidAlreadyPresent(CARD_UID_TAKEN)).toBe(true);
  });

  it('does not read "already exists" about an HREF as one', () => {
    // That is the 412 case, and both writers already handle it by returning
    // the path they were writing to. Reading it here would adopt this item
    // onto whatever object the by-UID question returned.
    expect(refusalSaysUidAlreadyPresent('<s:message>File already exists</s:message>')).toBe(false);
  });
});
