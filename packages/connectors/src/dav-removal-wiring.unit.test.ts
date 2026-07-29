// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The removal reports reach `listSince`, in a form that matches what was
 * recorded.
 *
 * `parseRemovedHrefs` is tested on its own; this is about the two things a
 * correct parser cannot give you by itself:
 *
 * 1. The reports are actually SURFACED. Both sources issued the
 *    `sync-collection` REPORT and dropped this half of the answer for their
 *    entire existence, and a parser nobody calls is worth nothing.
 * 2. The hrefs are the SAME STRINGS as the ones recorded on the ledger rows —
 *    `RawCalendarEvent.item.sourcePath` for a live object. The match in
 *    `Ledger.findBySourceRef` is plain equality, so any normalising,
 *    unescaping or resolving applied to one path and not the other makes every
 *    lookup miss. A missed lookup reports nothing at all, which is silence,
 *    which is the one failure mode nobody notices.
 */

import { describe, it, expect, vi } from 'vitest';
import { CalDAVSource } from './caldav-source';
import { CarddavSource } from './carddav-source';
import type { HttpClient, HttpResponse } from './dav-http.types';

function client(response: HttpResponse): HttpClient {
  return { request: vi.fn().mockResolvedValue(response) };
}

/** A sync-collection answer: one live object, one the server says is gone. */
const CALDAV_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/calendars/alice/personal/live%20one.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-live"</d:getetag>
        <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:Live-Event
SUMMARY:Still here
END:VEVENT
END:VCALENDAR</cal:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/calendars/alice/personal/gone%20one.ics</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>http://example.com/ns/sync/9</d:sync-token>
</d:multistatus>`;

const CARDDAV_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav/addressbooks/alice/default/live.vcf</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-live"</d:getetag>
        <card:address-data>BEGIN:VCARD
VERSION:3.0
UID:live-card
FN:Still Here
END:VCARD</card:address-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/addressbooks/alice/default/gone.vcf</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>http://example.com/ns/sync/9</d:sync-token>
</d:multistatus>`;

describe('CalDAVSource.listSince', () => {
  it('surfaces the removed href alongside the live event', async () => {
    const source = new CalDAVSource(
      {
        url: 'https://dav.example.com/',
        username: 'alice',
        password: 'pw',
        calendarHomeSet: '/dav/calendars/alice/',
      },
      { httpClient: client({ status: 207, body: CALDAV_BODY, headers: {} }) },
    );

    const result = await source.listSince({
      name: 'Personal',
      path: '/dav/calendars/alice/personal/',
    });

    expect(result.items).toHaveLength(1);
    expect(result.removed).toEqual(['/dav/calendars/alice/personal/gone%20one.ics']);
  });

  it('gives the live object a sourcePath in the SAME form as the removal href', async () => {
    // Both are the verbatim text of a `<d:href>` from this body — percent-escaping
    // and all. Neither side decodes, and that is the point: `findBySourceRef` is a
    // plain equality test, so if one path unescaped `%20` and the other did not,
    // every removal report for a file with a space in its name would silently fail
    // to match. The escaped href here is what makes that observable.
    const source = new CalDAVSource(
      {
        url: 'https://dav.example.com/',
        username: 'alice',
        password: 'pw',
        calendarHomeSet: '/dav/calendars/alice/',
      },
      { httpClient: client({ status: 207, body: CALDAV_BODY, headers: {} }) },
    );

    const result = await source.listSince({
      name: 'Personal',
      path: '/dav/calendars/alice/personal/',
    });

    const live = result.items[0]!;
    expect(live.item.sourcePath).toBe('/dav/calendars/alice/personal/live%20one.ics');
    // Same directory, same escaping, same shape — the two paths differ only in
    // which object they name.
    const removed = result.removed![0]!;
    expect(removed.slice(0, removed.lastIndexOf('/'))).toBe(
      live.item.sourcePath!.slice(0, live.item.sourcePath!.lastIndexOf('/')),
    );
    expect(decodeURIComponent(removed)).not.toBe(removed);
  });

  it('omits the field when the server reported no removals', async () => {
    // Absent and `[]` are not the same claim. "The server reported none" and
    // "this poll cannot report removals" (a full listing, a server with no
    // sync-collection) must not be spelled identically.
    const body = CALDAV_BODY.replace(
      /<d:response>\s*<d:href>[^<]*gone[^<]*<\/d:href>[\s\S]*?<\/d:response>/,
      '',
    );
    const source = new CalDAVSource(
      {
        url: 'https://dav.example.com/',
        username: 'alice',
        password: 'pw',
        calendarHomeSet: '/dav/calendars/alice/',
      },
      { httpClient: client({ status: 207, body, headers: {} }) },
    );

    const result = await source.listSince({
      name: 'Personal',
      path: '/dav/calendars/alice/personal/',
    });

    expect(result.items).toHaveLength(1);
    expect(result.removed).toBeUndefined();
  });
});

describe('CarddavSource.listSince', () => {
  it('surfaces the removed href alongside the live card', async () => {
    const source = new CarddavSource(
      {
        url: 'https://dav.example.com/',
        username: 'alice',
        password: 'pw',
        addressBookHomeSet: '/dav/addressbooks/alice/',
      },
      { httpClient: client({ status: 207, body: CARDDAV_BODY, headers: {} }) },
    );

    const result = await source.listSince({
      name: 'Contacts',
      path: '/dav/addressbooks/alice/default/',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.item.sourcePath).toBe('/dav/addressbooks/alice/default/live.vcf');
    expect(result.removed).toEqual(['/dav/addressbooks/alice/default/gone.vcf']);
  });
});
