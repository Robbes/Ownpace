// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CalDAV Source Unit Tests
 * 
 * Tests for CalDAVSource implementation covering:
 * - PROPFIND parsing
 * - sync-collection REPORT parsing
 * - UID extraction from iCalendar
 * - Case-insensitive UID handling
 */

import { describe, it, expect, vi } from 'vitest';
import { CalDAVSource } from './caldav-source.ts';
import type { CalDAVSourceConfig, CalDAVSyncToken } from './caldav-source.types.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';

// Mock HTTP client for testing
function createMockHttpClient(response: HttpResponse): HttpClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  };
}

describe('CalDAVSource', () => {
  describe('PROPFIND parsing', () => {
    it('should parse calendar home set from PROPFIND response', async () => {
      const propfindResponse: HttpResponse = {
        status: 207,
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:response>
              <D:href>/dav/user/test/</D:href>
              <D:propstat>
                <D:prop>
                  <C:calendar-home-set>/dav/calendars/user/test/</C:calendar-home-set>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
        headers: {},
      };

      const mockClient = createMockHttpClient(propfindResponse);
      const config: CalDAVSourceConfig = {
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      };

      // Mock the listCollections to avoid actual HTTP call
      const source = new CalDAVSource(config, { httpClient: mockClient });

      // Access private method via type casting for testing
      const homeSet = (source as any).parseCalendarHomeSetResponse(propfindResponse.body);
      expect(homeSet).toBe('/dav/calendars/user/test/');
    });

    it('should parse calendar collections from PROPFIND response', async () => {
      const propfindResponse: HttpResponse = {
        status: 207,
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CR="urn:ietf:params:xml:ns:carddav">
            <D:response>
              <D:href>/dav/calendars/user/test/calendar/</D:href>
              <D:propstat>
                <D:prop>
                  <D:displayname>Personal</D:displayname>
                  <D:resourcetype><D:collection/><C:calendar-collection/></D:resourcetype>
                  <C:calendar-description>Personal calendar</C:calendar-description>
                  <C:calendar-timezone>Europe/Berlin</C:calendar-timezone>
                  <CR:color>#1f8aff</CR:color>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
            <D:response>
              <D:href>/dav/calendars/user/test/work/</D:href>
              <D:propstat>
                <D:prop>
                  <D:displayname>Work</D:displayname>
                  <D:resourcetype><D:collection/><C:calendar-collection/></D:resourcetype>
                  <C:calendar-description>Work calendar</C:calendar-description>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
        headers: {},
      };

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const collections = (source as any).parseCollectionsResponse(propfindResponse.body, '/dav/calendars/user/test/');
      
      expect(collections).toHaveLength(2);
      expect(collections[0]).toMatchObject({
        path: '/dav/calendars/user/test/calendar/',
        name: 'Personal',
        description: 'Personal calendar',
        timezone: 'Europe/Berlin',
        color: '#1f8aff',
      });
      expect(collections[1]).toMatchObject({
        path: '/dav/calendars/user/test/work/',
        name: 'Work',
        description: 'Work calendar',
      });
    });

    it('should handle empty PROPFIND response', async () => {
      const propfindResponse: HttpResponse = {
        status: 207,
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:">
          </D:multistatus>`,
        headers: {},
      };

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const collections = (source as any).parseCollectionsResponse(propfindResponse.body, '/home/');
      expect(collections).toHaveLength(0);
    });
  });

  describe('a task list is not a calendar (workplan 0113 T3a)', () => {
    // The owner, walking his own account: "i found 'Tasks', is that a Dav to?"
    // It is — and until this, it came back from `listFolders` as a calendar and
    // was counted as one. Both are calendar collections; only
    // `supported-calendar-component-set` tells them apart (RFC 4791 §5.2.3).

    const collection = (href: string, name: string, componentSet?: string) => `
      <D:response>
        <D:href>${href}</D:href>
        <D:propstat>
          <D:prop>
            <D:displayname>${name}</D:displayname>
            <D:resourcetype><D:collection/><C:calendar-collection/></D:resourcetype>
            ${componentSet ?? ''}
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`;

    const multistatus = (...responses: string[]) => `<?xml version="1.0" encoding="utf-8"?>
      <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
        ${responses.join('\n')}
      </D:multistatus>`;

    const source = () =>
      new CalDAVSource({ url: 'https://caldav.example.com/', username: 'test', password: 'pw' });

    it("a VTODO-only list is not returned by the calendar source — the owner's count stops including it", () => {
      const body = multistatus(
        collection(
          '/dav/calendars/user/test/personal/',
          'Personal',
          '<C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>',
        ),
        collection(
          '/dav/calendars/user/test/tasks/',
          'Tasks',
          '<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>',
        ),
      );
      const collections = (source() as never as {
        parseCollectionsResponse(b: string, h: string): ReadonlyArray<{ name?: string; components?: string[] }>;
      }).parseCollectionsResponse(body, '/dav/calendars/user/test/');

      expect(collections.map((c) => c.name)).toEqual(['Personal']);
      // The mixed collection keeps what it declared, as DATA: a person ticking
      // Calendar gets its events, and 0113 T3b reads the same field for VTODO.
      expect(collections[0]?.components).toEqual(['VEVENT', 'VTODO']);
    });

    it('a collection that declares NOTHING is still a calendar — RFC 4791 §5.2.3, and never a guess', () => {
      // "MAY contain any calendar component type." Reading silence as VTODO
      // would hide a real calendar from somebody who has one.
      const body = multistatus(collection('/dav/calendars/user/test/plain/', 'Plain'));
      const collections = (source() as never as {
        parseCollectionsResponse(b: string, h: string): ReadonlyArray<{ name?: string; components?: string[] }>;
      }).parseCollectionsResponse(body, '/dav/calendars/user/test/');

      expect(collections.map((c) => c.name)).toEqual(['Plain']);
      expect(collections[0]?.components).toBeUndefined();
    });

    it('a declared set this parse does not recognise reads as undeclared, and keeps the collection', () => {
      const body = multistatus(
        collection(
          '/dav/calendars/user/test/odd/',
          'Odd',
          '<C:supported-calendar-component-set><C:comp name="VFREEBUSY"/></C:supported-calendar-component-set>',
        ),
      );
      const collections = (source() as never as {
        parseCollectionsResponse(b: string, h: string): ReadonlyArray<{ name?: string; components?: string[] }>;
      }).parseCollectionsResponse(body, '/dav/calendars/user/test/');

      expect(collections.map((c) => c.name)).toEqual(['Odd']);
      expect(collections[0]?.components).toBeUndefined();
    });

    it('the component set is read from ITS OWN element, not from any comp element in the response', () => {
      // A `<comp name="VEVENT"/>` can appear elsewhere in a multistatus — in a
      // supported-report-set, or a server extension. Reading one of those as
      // this collection's declaration answers a question the server never
      // asked, and would put a task list back in the calendar count.
      const declared = CalDAVSource.parseComponentSet(
        '<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>' +
          '<C:some-other-thing><C:comp name="VEVENT"/></C:some-other-thing>',
      );
      expect(declared).toEqual(['VTODO']);
    });

    it('the PROPFIND actually asks for the property — a parse of something never requested finds nothing', async () => {
      const httpClient = {
        request: vi.fn(async (_options: HttpRequestOptions) => ({
          status: 207,
          headers: {},
          body: multistatus(collection('/dav/calendars/user/test/personal/', 'Personal')),
        })),
      };
      const s = new CalDAVSource(
        { url: 'https://caldav.example.com/dav/calendars/user/test/', username: 'test', password: 'pw' },
        { httpClient },
      );
      await s.listFolders();
      const bodies = httpClient.request.mock.calls.map(([o]) => String(o.body ?? ''));
      expect(bodies.some((b) => b.includes('supported-calendar-component-set'))).toBe(true);
    });
  });

  describe('an object is labelled what it is, not what the parser assumed (0113 T3b)', () => {
    // `sync-collection` (RFC 6578) is component-agnostic, so a MIXED collection
    // — Nextcloud's default calendar declares VEVENT,VTODO — hands this parser
    // its tasks along with its events. Every one of them used to come back
    // stamped `type: 'event'`. The bytes were always right (the raw iCalendar
    // is carried through and PUT verbatim); the label on the record lied.

    const wrap = (component: string, extra = '') => [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `BEGIN:${component}`,
      'UID:abc-123',
      'SUMMARY:Buy milk',
      extra,
      `END:${component}`,
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');

    const parse = (icalendar: string) => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        password: 'pw',
      });
      return (source as never as {
        parseCalendarObject(o: { href: string; icalendar: string; etag?: string }): {
          item: { type: string; uid: string };
        } | null;
      }).parseCalendarObject({ href: '/c/1.ics', icalendar });
    };

    it('a VTODO is a todo — the label the ledger stores stops saying event', () => {
      expect(parse(wrap('VTODO', 'STATUS:NEEDS-ACTION'))?.item.type).toBe('todo');
    });

    it('a VEVENT is still an event, and a VJOURNAL is a journal', () => {
      expect(parse(wrap('VEVENT'))?.item.type).toBe('event');
      expect(parse(wrap('VJOURNAL'))?.item.type).toBe('journal');
    });

    it('an object whose component this parse does not recognise travels exactly as it did before', () => {
      // 'event' was the label EVERY object carried until now, so an unusual one
      // keeps it rather than being re-routed on the strength of a parse that
      // did not understand it.
      expect(parse(wrap('VFREEBUSY'))?.item.type).toBe('event');
    });

    it('the component is read from a BEGIN line, not from the word appearing anywhere earlier', () => {
      // A calendar's own name is text a person typed, and it lands BEFORE the
      // component's BEGIN line. A search that just looks for the first
      // "VTODO" in the file relabels this event as a task.
      const icalendar = [
        'BEGIN:VCALENDAR',
        'X-WR-CALNAME:My VTODO list',
        'BEGIN:VEVENT',
        'UID:abc-123',
        'SUMMARY:Discuss the migration',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
      expect(parse(icalendar)?.item.type).toBe('event');
    });

    it('the raw iCalendar is untouched either way — the label changed, the bytes never did', () => {
      const icalendar = wrap('VTODO', 'PERCENT-COMPLETE:40');
      const parsed = parse(icalendar) as unknown as { icalendar: string } | null;
      expect(parsed?.icalendar).toBe(icalendar);
    });
  });

  describe('sync-collection REPORT parsing', () => {
    it('should parse sync-collection REPORT with sync-token', async () => {
      const reportResponse: HttpResponse = {
        status: 207,
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:sync-token>https://caldav.example.com/token/abc123</D:sync-token>
            <D:response>
              <D:href>/dav/calendars/user/test/calendar/event1.ics</D:href>
              <D:propstat>
                <D:prop>
                  <D:resourcetype/>
                  <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event1@example.com
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR
</C:calendar-data>
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
        headers: {},
      };

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const result = (source as any).parseSyncCollectionResponse(reportResponse.body);
      
      expect(result.syncToken).toBe('https://caldav.example.com/token/abc123');
      expect(result.objects).toHaveLength(1);
      expect(result.objects[0].href).toBe('/dav/calendars/user/test/calendar/event1.ics');
      expect(result.objects[0].icalendar).toContain('BEGIN:VCALENDAR');
      expect(result.objects[0].icalendar).toContain('UID:event1@example.com');
    });

    it('should parse sync-collection REPORT with multiple events', async () => {
      const reportResponse: HttpResponse = {
        status: 207,
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:sync-token>https://caldav.example.com/token/xyz789</D:sync-token>
            <D:response>
              <D:href>/dav/calendars/user/test/calendar/event1.ics</D:href>
              <D:propstat>
                <D:prop>
                  <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1@example.com
SUMMARY:Event 1
END:VEVENT
END:VCALENDAR
</C:calendar-data>
                </D:prop>
              </D:propstat>
            </D:response>
            <D:response>
              <D:href>/dav/calendars/user/test/calendar/event2.ics</D:href>
              <D:propstat>
                <D:prop>
                  <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event2@example.com
SUMMARY:Event 2
END:VEVENT
END:VCALENDAR
</C:calendar-data>
                </D:prop>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
        headers: {},
      };

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const result = (source as any).parseSyncCollectionResponse(reportResponse.body);
      
      expect(result.syncToken).toBe('https://caldav.example.com/token/xyz789');
      expect(result.objects).toHaveLength(2);
      expect(result.objects[0].icalendar).toContain('UID:event1@example.com');
      expect(result.objects[1].icalendar).toContain('UID:event2@example.com');
    });

    it('should handle sync-collection REPORT without sync-token (full sync)', async () => {
      const reportResponse: HttpResponse = {
        status: 207,
        body: `<?xml version="1.0" encoding="utf-8"?>
          <D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:response>
              <D:href>/dav/calendars/user/test/calendar/event1.ics</D:href>
              <D:propstat>
                <D:prop>
                  <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event1@example.com
SUMMARY:Test
END:VEVENT
END:VCALENDAR
</C:calendar-data>
                </D:prop>
              </D:propstat>
            </D:response>
          </D:multistatus>`,
        headers: {},
      };

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const result = (source as any).parseSyncCollectionResponse(reportResponse.body);
      
      expect(result.syncToken).toBeUndefined();
      expect(result.objects).toHaveLength(1);
    });
  });

  describe('UID extraction from iCalendar', () => {
    it('should extract UID from simple iCalendar', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event-123@example.com
DTSTART:20240101T100000Z
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const uid = (source as any).extractUidFromIcalendar(icalendar);
      expect(uid).toBe('test-event-123@example.com');
    });

    it('should extract UID with different formatting', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:  spaced-uid@example.com
SUMMARY:Test
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const uid = (source as any).extractUidFromIcalendar(icalendar);
      expect(uid).toBe('spaced-uid@example.com');
    });

    it('should extract UID with colon separator', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:colon-sep@example.com
DTSTART:20240101T100000Z
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const uid = (source as any).extractUidFromIcalendar(icalendar);
      expect(uid).toBe('colon-sep@example.com');
    });

    it('should return null for iCalendar without UID', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20240101T100000Z
SUMMARY:No UID Event
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const uid = (source as any).extractUidFromIcalendar(icalendar);
      expect(uid).toBeNull();
    });

    it('should handle UID with special characters', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:complex-uid_with.special+chars@example.com
SUMMARY:Test
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const uid = (source as any).extractUidFromIcalendar(icalendar);
      expect(uid).toBe('complex-uid_with.special+chars@example.com');
    });
  });

  describe('Case-insensitive UID handling', () => {
    it('should normalize UID to lowercase', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      expect((source as any).normalizeUid('UPPERCASE@EXAMPLE.COM')).toBe('uppercase@example.com');
      expect((source as any).normalizeUid('MiXeDcAsE@Example.Com')).toBe('mixedcase@example.com');
      expect((source as any).normalizeUid('lowercase@example.com')).toBe('lowercase@example.com');
    });

    it('should treat UIDs as case-insensitive for comparison', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const uid1 = (source as any).normalizeUid('EVENT@EXAMPLE.COM');
      const uid2 = (source as any).normalizeUid('event@example.com');
      const uid3 = (source as any).normalizeUid('Event@Example.Com');

      expect(uid1).toBe(uid2);
      expect(uid2).toBe(uid3);
      expect(uid1).toBe(uid3);
    });

    it('should handle UID in calendar object parsing with case normalization', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:MIXEDCASE@EXAMPLE.COM
SUMMARY:Test Event
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const event = (source as any).parseCalendarObject({
        href: '/calendar/event.ics',
        icalendar,
      });

      expect(event.item.uid).toBe('mixedcase@example.com');
    });
  });

  describe('Cursor encoding and decoding', () => {
    it('should encode and decode sync-token cursor', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const token = 'https://caldav.example.com/token/abc123';
      const encoded = (source as any).encodeSyncToken(token);
      const decoded: CalDAVSyncToken = (source as any).decodeSyncToken({ value: encoded });

      expect(decoded.token).toBe(token);
      expect(decoded.isSyncToken).toBe(true);
    });

    it('should encode and decode CTag cursor', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const collectionPath = '/dav/calendars/user/test/calendar/';
      const ctag = '"1234567890"';
      const encoded = (source as any).encodeCTag(ctag, collectionPath);
      const decoded: CalDAVSyncToken = (source as any).decodeSyncToken({ value: encoded });

      expect(decoded.token).toBe(ctag);
      expect(decoded.isSyncToken).toBe(false);
      expect(decoded.collectionPath).toBe(collectionPath);
    });

    it('should throw error for invalid cursor format', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      expect(() => (source as any).decodeSyncToken({ value: 'invalid-format' })).toThrow();
    });
  });

  describe('XML escaping', () => {
    it('should escape XML special characters', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const input = 'Test & <script> "quotes" \'apostrophe\'';
      const escaped = (source as any).escapeXml(input);

      expect(escaped).toBe('Test &amp; &lt;script&gt; &quot;quotes&quot; &apos;apostrophe&apos;');
    });
  });

  describe('XML entity decoding', () => {
    it('should decode XML entities in calendar data', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const encoded = 'Test &lt;description&gt; &amp; more';
      const decoded = (source as any).decodeXmlEntities(encoded);

      expect(decoded).toBe('Test <description> & more');
    });

    it('should decode numeric character references (&#13; / &#x0D;)', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      expect((source as any).decodeXmlEntities('a&#13;&#10;b')).toBe('a\r\nb');
      expect((source as any).decodeXmlEntities('a&#x0D;&#x0A;b')).toBe('a\r\nb');
    });
  });

  describe('Line unfolding', () => {
    it('should unfold iCalendar lines', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      // iCalendar lines can be folded with leading whitespace
      const folded = `BEGIN:VCALENDAR
DESCRIPTION:This is a long description that was
 folded to multiple lines
SUMMARY:Test
END:VCALENDAR`;

      const unfolded = (source as any).unfoldLines(folded);

      expect(unfolded).toBe('BEGIN:VCALENDAR\nDESCRIPTION:This is a long description that wasfolded to multiple lines\nSUMMARY:Test\nEND:VCALENDAR');

      expect((source as any).convertIcalDateToIso('20240101T120000Z')).toBe('2024-01-01T12:00:00Z');
      expect((source as any).convertIcalDateToIso('20240101T120000')).toBe('2024-01-01T12:00:00');
    });

    it('should convert iCalendar date (all-day) to ISO 8601', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      expect((source as any).convertIcalDateToIso('20240101')).toBe('2024-01-01T00:00:00Z');
    });
  });

  describe('Path normalization', () => {
    it('should normalize paths consistently', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      expect((source as any).normalizePath('/path/to/calendar')).toBe('/path/to/calendar/');
      expect((source as any).normalizePath('path/to/calendar/')).toBe('/path/to/calendar/');
      expect((source as any).normalizePath('path/to/calendar')).toBe('/path/to/calendar/');
    });

    it('should build URLs correctly', () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      expect((source as any).buildUrl('/calendar/')).toBe('https://caldav.example.com/calendar/');
      expect((source as any).buildUrl('calendar')).toBe('https://caldav.example.com/calendar/');
    });
  });

  describe('Calendar object parsing', () => {
    it('should parse complete calendar event', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:test-event@example.com
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
SUMMARY:Test Event
DESCRIPTION:Event description
LOCATION:Conference Room A
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const event = (source as any).parseCalendarObject({
        href: '/dav/calendars/user/test/calendar/event.ics',
        icalendar,
      });

      expect(event).toMatchObject({
        item: {
          uid: 'test-event@example.com',
          type: 'event',
          summary: 'Test Event',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T11:00:00Z',
          description: 'Event description',
          location: 'Conference Room A',
        },
      });
    });

    it('should handle all-day events', () => {
      const icalendar = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:allday-event@example.com
DTSTART;VALUE=DATE:20240101
SUMMARY:All Day Event
END:VEVENT
END:VCALENDAR`;

      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'test',
        passwordEnv: 'TEST_PASSWORD',
      });

      const event = (source as any).parseCalendarObject({
        href: '/dav/calendars/user/test/calendar/allday.ics',
        icalendar,
      });

      expect(event.item.uid).toBe('allday-event@example.com');
      expect(event.item.summary).toBe('All Day Event');
    });
  });

  describe('Authorization header', () => {
    it('should build correct authorization header', async () => {
      process.env.TEST_CALENDAR_PASSWORD = 'secret123';
      
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'testuser',
        passwordEnv: 'TEST_CALENDAR_PASSWORD',
      });

      const authHeader = await (source as any).authorizationHeader();
      const expected = `Basic ${Buffer.from('testuser:secret123').toString('base64')}`;
      
      expect(authHeader).toBe(expected);
    });

    it('should throw error when password env var not set', async () => {
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'testuser',
        passwordEnv: 'NONEXISTENT_PASSWORD_VAR',
      });

      await expect((source as any).authorizationHeader()).rejects.toThrow();
    });

    it('prefers a direct password over passwordEnv (managed path)', async () => {
      process.env.SHOULD_NOT_BE_USED = 'env-password';
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'testuser',
        password: 'direct-password',
        passwordEnv: 'SHOULD_NOT_BE_USED',
      });
      const header = await (source as any).authorizationHeader();
      expect(header).toBe(`Basic ${Buffer.from('testuser:direct-password').toString('base64')}`);
      delete process.env.SHOULD_NOT_BE_USED;
    });

    it('falls back to passwordEnv when no direct password (self-host path)', async () => {
      process.env.CALDAV_TEST_PW = 'env-password';
      const source = new CalDAVSource({
        url: 'https://caldav.example.com/',
        username: 'testuser',
        passwordEnv: 'CALDAV_TEST_PW',
      });
      const header = await (source as any).authorizationHeader();
      expect(header).toBe(`Basic ${Buffer.from('testuser:env-password').toString('base64')}`);
      delete process.env.CALDAV_TEST_PW;
    });

    it('sends Bearer, minted by the provider, when a tokenProvider is configured (workplan 0045)', async () => {
      // The Google door: CalDAV/CardDAV there take OAuth only, and the token
      // must be MINTED per request (cached until expiry) rather than pasted —
      // a static token dies mid-pass at the one-hour mark.
      const source = new CalDAVSource({
        url: 'https://apidata.googleusercontent.com/caldav/v2/owner@example.com/user/',
        username: 'owner@example.com',
        tokenProvider: {
          getToken: async () => ({ accessToken: 'at-1', tokenType: 'Bearer', expiresAt: 0 }),
          refresh: async () => ({ accessToken: 'at-2', tokenType: 'Bearer', expiresAt: 0 }),
          isTokenValid: () => true,
          getTokenStatus: () => ({ isValid: true, timeUntilExpiry: 3600 }),
        },
      });
      const header = await (source as any).authorizationHeader();
      expect(header).toBe('Bearer at-1');
    });
  });
});

describe('the throttle limiter (workplan 0050)', () => {
  it('takes a slot before every request and releases it after — the caps are enforced, not decorative', async () => {
    // The gap DomainConfig.throttleConfig documented since 0026 T1: the
    // mapping's limiter was merged and handed to the MAIL source only, and
    // the DAV connectors ran uncapped against servers (a default Nextcloud's
    // single-writer SQLite) that genuinely lock under concurrency.
    const order: string[] = [];
    const limiter = {
      waitForSlot: async (_tenant: string, host: string) => {
        order.push(`acquire:${host}`);
      },
      releaseSlot: () => {
        order.push('release');
      },
    };
    const httpClient = {
      request: async () => {
        order.push('request');
        return { status: 207, headers: {}, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>' };
      },
    };
    const source = new CalDAVSource(
      {
        url: 'https://cloud.example.net/remote.php/dav/',
        username: 'u',
        password: 'p',
        throttleLimiter: limiter as unknown as import('@openmig/shared').ThrottleLimiter,
      },
      { httpClient },
    );

    await (source as any).send({ method: 'PROPFIND', url: 'https://cloud.example.net/remote.php/dav/' });

    // Acquire, THEN the request, THEN release — keyed by host, so several
    // collections on one server share the caps.
    expect(order).toEqual(['acquire:cloud.example.net', 'request', 'release']);
  });

  it('releases the slot when the request THROWS — a failed call must not leak capacity', async () => {
    const order: string[] = [];
    const limiter = {
      waitForSlot: async () => {
        order.push('acquire');
      },
      releaseSlot: () => {
        order.push('release');
      },
    };
    const httpClient = {
      request: async () => {
        order.push('request');
        throw new Error('socket hang up');
      },
    };
    const source = new CalDAVSource(
      {
        url: 'https://cloud.example.net/remote.php/dav/',
        username: 'u',
        password: 'p',
        throttleLimiter: limiter as unknown as import('@openmig/shared').ThrottleLimiter,
      },
      { httpClient },
    );

    await expect(
      (source as any).send({ method: 'GET', url: 'https://cloud.example.net/x' }),
    ).rejects.toThrow('socket hang up');
    expect(order).toEqual(['acquire', 'request', 'release']);
  });

  it('without a limiter, send IS the http client — no behaviour change for existing mappings', async () => {
    const httpClient = { request: vi.fn(async () => ({ status: 200, headers: {}, body: '' })) };
    const source = new CalDAVSource(
      { url: 'https://caldav.example.com/', username: 'u', password: 'p' },
      { httpClient },
    );
    await (source as any).send({ method: 'GET', url: 'https://caldav.example.com/x' });
    expect(httpClient.request).toHaveBeenCalledTimes(1);
  });
});

describe("a refusal in Google's GData envelope reads as Google's sentence (2026-09-02)", () => {
  it('the owner sees which API, which project and the console page — not a wall of XML', async () => {
    const google403: HttpResponse = {
      status: 403,
      body:
        '<?xml version="1.0" encoding="UTF-8"?><errors xmlns="http://schemas.google.com/g/2005">' +
        '<error><domain>GData</domain><code>accessNotConfigured</code><internalReason>CalDAV API ' +
        'has not been used in project 123 before or it is disabled. Enable it by visiting ' +
        'https://console.developers.google.com/apis/api/caldav.googleapis.com/overview?project=123 ' +
        'then retry.</internalReason></error></errors>',
      headers: {},
    };
    const source = new CalDAVSource(
      { url: 'https://apidata.googleusercontent.com/caldav/v2', username: 'owner@example.com', password: 'x' },
      { httpClient: createMockHttpClient(google403) },
    );
    const failure = await source.listFolders().then(
      () => 'listed',
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(failure).toContain('PROPFIND failed with status 403');
    expect(failure).toContain('accessNotConfigured');
    expect(failure).toContain('caldav.googleapis.com/overview?project=123');
    expect(failure).not.toContain('<errors');
    expect(failure).not.toContain('</internalReason>');
  });
});
