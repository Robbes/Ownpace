// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PER-ITEM "IS THIS ALREADY ON THE TARGET?" — CREATE OR UPDATE, DECIDED
 * BY THE ONE REQUEST NOBODY WAS WATCHING.
 *
 * `keysIn` answers this for a whole collection in a single REPORT, and it is
 * what runs on a healthy target. These two per-item queries run only where
 * that listing FAILED — which is exactly the moment their own wrongness stops
 * being invisible, and exactly why nothing tested them. Neither writer had a
 * test for its fallback at all.
 *
 * What the owner saw, on 2026-09-07, was the CardDAV listing failing first:
 *
 *     Contacts — not measured: addressbook-query REPORT failed with status
 *     400: Request contains an invalid argument.
 *
 * Both defective paths ran, and both answered "not on the target" for every
 * item, for four separate reasons. Each one alone is enough:
 *
 *   1. The CardDAV filter nested `comp-filter name="VADDRESSBOOK"` /
 *      `name="VCARD"` — CalDAV grammar (RFC 4791), copied from the writer
 *      beside it. RFC 6352 §10.5 has only `prop-filter`.
 *   2. Neither sent a `Depth` header. RFC 6352 §8.6 makes it a MUST and
 *      RFC 3253 §3.6 defaults REPORT to 0, so the query asked the COLLECTION
 *      about itself and never reached an item. They were the only REPORTs in
 *      either writer without one.
 *   3. The CardDAV text-match had no `match-type`, which §10.5.4 defaults to
 *      `contains` — a substring search deciding create-vs-update.
 *   4. And the answer was read out of the href with `href.includes(uid)`
 *      against a regex matching only the literal `D:href` — so a lowercase
 *      prefix found nothing, and a UID that was a PREFIX of another card's
 *      found the wrong card.
 *
 * (1)–(3) are properties of the request and are asserted here on what the
 * writer actually sends. (4) is `findHrefByUid`, tested in
 * `dav-multistatus.unit.test.ts`; what these tests add is that both writers
 * now go through it.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter } from './caldav-target-writer.ts';
import { CardDAVTargetWriter, type HttpClient } from './carddav-target-writer.ts';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461a1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461a2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

const emptyLedger = { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger;

interface Sent {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

/**
 * A server that records what it was asked and answers with `body`.
 *
 * Deliberately NOT a server that interprets the filter: a stub that honoured
 * the query would be asserting my reading of the RFC against itself. The
 * request is checked as a request, and the response is fed in as a fixture.
 */
function recording(response: { status: number; body: string }) {
  const sent: Sent[] = [];
  const client: HttpClient = {
    async request(o) {
      sent.push({
        method: o.method,
        url: o.url,
        body: String(o.body ?? ''),
        headers: (o.headers ?? {}) as Record<string, string>,
      });
      return { ...response, headers: {} };
    },
  };
  return { client, sent };
}

/** A 207 naming one card at a path that does NOT embed its UID. */
const oneCard = (uid: string, href = '/remote.php/dav/addressbooks/users/rob/contacts/e7c1a9.vcf'): string =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">` +
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop><card:address-data>` +
  `BEGIN:VCARD\nVERSION:3.0\nUID:${uid}\nFN:Jan\nEND:VCARD` +
  `</card:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

/** A 207 naming one event, likewise. */
const oneEvent = (uid: string, href = '/remote.php/dav/calendars/rob/personal/9f31.ics'): string =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">` +
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop><cal:calendar-data>` +
  `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${uid}\nEND:VEVENT\nEND:VCALENDAR` +
  `</cal:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`;

const carddav = (response: { status: number; body: string }) => {
  const { client, sent } = recording(response);
  return {
    sent,
    writer: new CardDAVTargetWriter(
      { url: BASE, username: 'rob', password: 'pw' },
      { ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    ),
  };
};

const caldav = (response: { status: number; body: string }) => {
  const { client, sent } = recording(response);
  return {
    sent,
    writer: new CalDAVTargetWriter(
      { url: BASE, username: 'rob', password: 'pw' },
      { domain: 'calendar', ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
    ),
  };
};

describe('the CardDAV per-item existence check sends a request RFC 6352 defines', () => {
  it('carries a filter — without one Google answers 400 and the item is never adopted', async () => {
    const { writer, sent } = carddav({ status: 207, body: oneCard('abc') });
    await writer.findContactByNaturalKey('contacts', 'abc');
    expect(sent[0]!.body).toMatch(/<C:filter[\s>]/);
  });

  it('filters on the UID property directly, with no comp-filter', async () => {
    const { writer, sent } = carddav({ status: 207, body: oneCard('abc') });
    await writer.findContactByNaturalKey('contacts', 'abc');
    expect(sent[0]!.body).toContain('<C:prop-filter name="UID">');
    expect(sent[0]!.body, 'VADDRESSBOOK/VCARD nesting is RFC 4791, not RFC 6352').not.toContain(
      'comp-filter',
    );
  });

  it('asks for an exact match, not the §10.5.4 substring default', async () => {
    const { writer, sent } = carddav({ status: 207, body: oneCard('abc') });
    await writer.findContactByNaturalKey('contacts', 'abc');
    expect(sent[0]!.body).toContain('match-type="equals"');
  });

  it('sends Depth, which §8.6 makes a MUST', async () => {
    // Without it the REPORT is Depth: 0 (RFC 3253 §3.6) and never leaves the
    // address book resource — so the answer is "not there" for everything in
    // it, on a server that accepted the body perfectly.
    const { writer, sent } = carddav({ status: 207, body: oneCard('abc') });
    await writer.findContactByNaturalKey('contacts', 'abc');
    expect(sent[0]!.headers.Depth).toBe('1');
  });

  it('escapes a UID that would otherwise break the body', async () => {
    const { writer, sent } = carddav({ status: 207, body: oneCard('x') });
    await writer.findContactByNaturalKey('contacts', 'a&b<c');
    expect(sent[0]!.body).toContain('a&amp;b&lt;c');
  });
});

describe('the CardDAV check answers from the card, not from the path', () => {
  it('finds a card the server named nothing like its UID', async () => {
    // Google's hrefs are opaque. The old check could only work where the
    // server happened to write the UID into the path.
    const { writer } = carddav({ status: 207, body: oneCard('34222-232@example.com') });
    expect(await writer.findContactByNaturalKey('contacts', '34222-232@example.com')).toBe(
      '/remote.php/dav/addressbooks/users/rob/contacts/e7c1a9.vcf',
    );
  });

  it('refuses a card whose UID merely contains the one asked for', async () => {
    // The server's match is case-insensitive `equals`, but a server that
    // ignored match-type would answer with 12345 for a query about 1234. The
    // old code then adopted it, and the next update PUT over someone else.
    // The href DELIBERATELY embeds the UID here — that is the shape SabreDAV
    // writes and the shape the old `href.includes(uid)` check answered from.
    const { writer } = carddav({ status: 207, body: oneCard('12345', '/dav/contacts/12345.vcf') });
    expect(await writer.findContactByNaturalKey('contacts', '1234')).toBeUndefined();
  });

  it('says "not there" when the server refuses, rather than guessing', async () => {
    const { writer } = carddav({ status: 400, body: 'Request contains an invalid argument.' });
    expect(await writer.findContactByNaturalKey('contacts', 'abc')).toBeUndefined();
  });
});

describe('the CalDAV per-item existence check carries the same Depth, and reads the same way', () => {
  it('sends Depth: 1, like every other REPORT in that writer', async () => {
    const { writer, sent } = caldav({ status: 207, body: oneEvent('e1') });
    await writer.findCalendarByNaturalKey('personal', 'e1');
    expect(sent[0]!.headers.Depth).toBe('1');
  });

  it('keeps its comp-filter — that IS the CalDAV grammar (RFC 4791 §9.7.1)', async () => {
    // The CardDAV fix must not be applied here by symmetry. A VCALENDAR is a
    // container of components; a vCard is not.
    const { writer, sent } = caldav({ status: 207, body: oneEvent('e1') });
    await writer.findCalendarByNaturalKey('personal', 'e1');
    expect(sent[0]!.body).toContain('<C:comp-filter name="VCALENDAR">');
  });

  it('finds an event the server named nothing like its UID', async () => {
    const { writer } = caldav({ status: 207, body: oneEvent('34222-232@example.com') });
    expect(await writer.findCalendarByNaturalKey('personal', '34222-232@example.com')).toBe(
      '/remote.php/dav/calendars/rob/personal/9f31.ics',
    );
  });

  it('refuses an event whose UID merely contains the one asked for', async () => {
    // CalDAV's text-match has NO equality option (RFC 4791 §9.7.5 defines
    // collation and negate-condition only), so the server's answer is always
    // a substring match and this narrowing is the whole correctness.
    const { writer } = caldav({ status: 207, body: oneEvent('12345', '/dav/personal/12345.ics') });
    expect(await writer.findCalendarByNaturalKey('personal', '1234')).toBeUndefined();
  });
});
