// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DIAGNOSTIC THAT LIES IS WORSE THAN NO DIAGNOSTIC.
 *
 * `dav-target-probe.mjs` exists to tell four causes of a zero apart — nothing
 * written, a filter that matches nothing, a partial retrieval the server did
 * not satisfy, an unreadable UID — and each one leads somewhere different. A
 * probe that miscounts sends whoever runs it to the wrong fix, having felt
 * certain on the way.
 *
 * The first draft of its counters matched `</d:response>` as well as
 * `<d:response>` and doubled every figure. It was caught by running it against
 * these bodies before the probe was ever pointed at a server, and that is why
 * they are a test rather than a scratch file.
 *
 * The bodies below are SabreDAV-shaped (Nextcloud's DAV implementation): the
 * `d:` prefix for the DAV namespace, per-propstat status codes, and the
 * 404-propstat-with-an-empty-element shape a server uses to say "I will not
 * satisfy that part of your prop request" — which is the case the probe is
 * really for.
 */

import { describe, it, expect } from 'vitest';
import { measure, propfindResources } from './dav-target-probe.mjs';

const CALENDAR_WITH_DATA = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/remote.php/dav/calendars/u/personal/a.ics</d:href>
    <d:propstat><d:prop><d:getetag>"1"</d:getetag>
      <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-1
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/personal/b.ics</d:href>
    <d:propstat><d:prop>
      <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-2
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>`;

/** 207, well-formed, and empty: the filter matched nothing. */
const MATCHED_NOTHING = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`;

/** The resource is listed; the requested calendar-data is refused, and empty. */
const PARTIAL_REFUSED = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/remote.php/dav/calendars/u/personal/a.ics</d:href>
    <d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    <d:propstat><d:prop><cal:calendar-data/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
  </d:response>
</d:multistatus>`;

/** The same refusal, spelled with a space before the slash. */
const PARTIAL_REFUSED_SPACED = PARTIAL_REFUSED.replace('<cal:calendar-data/>', '<cal:calendar-data />');

const PROPFIND = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/remote.php/dav/calendars/u/personal/</d:href></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/personal/a.ics</d:href></d:response>
  <d:response><d:href>/remote.php/dav/calendars/u/personal/b.ics</d:href></d:response>
</d:multistatus>`;

describe('the probe counts what it says it counts', () => {
  it('counts each response once, not once per opening and closing tag', () => {
    // The original defect. Two events came back as four, and every verdict
    // downstream would have been computed from a doubled number.
    expect(measure(CALENDAR_WITH_DATA, 'calendar-data')).toEqual({
      responses: 2,
      withData: 2,
      uids: 2,
    });
  });

  it('reads an accepted-but-unmatched filter as zero responses', () => {
    expect(measure(MATCHED_NOTHING, 'calendar-data').responses).toBe(0);
  });

  it('does not count an EMPTY element as a payload — the quiet case', () => {
    // This is the whole point of the probe. The element is present, so
    // "is calendar-data in the body?" answers yes; the reindexer still skips
    // the item, because what it reads out of it is undefined.
    for (const body of [PARTIAL_REFUSED, PARTIAL_REFUSED_SPACED]) {
      const m = measure(body, 'calendar-data');
      expect(m.responses).toBe(1);
      expect(m.withData).toBe(0);
    }
  });

  it('counts contacts through the same shape', () => {
    const vcf = CALENDAR_WITH_DATA
      .replace(/calendar-data/g, 'address-data')
      .replace(/urn:ietf:params:xml:ns:caldav/, 'urn:ietf:params:xml:ns:carddav');
    expect(measure(vcf, 'address-data').withData).toBe(2);
  });

  it('excludes the collection itself from the ground-truth count', () => {
    // A Depth:1 PROPFIND returns the collection alongside its members. Counting
    // it would turn an empty collection into "1 resource" and hide cause (1).
    expect(propfindResources(PROPFIND, '.ics')).toBe(2);
  });
});
