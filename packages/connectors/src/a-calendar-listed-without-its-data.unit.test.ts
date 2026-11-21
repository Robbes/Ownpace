// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CALENDAR LISTED WITHOUT ITS DATA (workplan 0164 T2).
 *
 * Google answered `sync-collection` (RFC 6578) with a 207 that named every
 * member by its href and ETag, the removed ones with a 404, in pages, and
 * carried no calendar data (0164 T1, measured on 2026-11-21). The source
 * read that as "nothing", listed the calendar whole with `calendar-query` on
 * every pass (6,212 events skipped a pass, 0164 §1) and reported no removal:
 * an event deleted at Google never reached *Deleted on the old system*.
 *
 * What is held here, against `GoogleLikeCalDav`, a fake that answers as
 * Google did:
 *
 * - a member listed without its data is read with `calendar-multiget`
 *   (RFC 4791 §7.9), a batch at a time, and handed on under the href
 *   `sync-collection` named it by, which is the href a later 404 names;
 * - a truncated answer (a 507 for the calendar) is followed with its token
 *   to the last page, and only the last page's token is handed on;
 * - the removals in a reading with no token are carried up, as a reading
 *   with a token's are, and a 404 inside a propstat is not one of them;
 * - with the token, a pass reads what changed and nothing more;
 * - a refused token is dropped and the calendar read whole again, once;
 * - any other refusal of the first page keeps the token after a 5xx or a
 *   rate limit, and drops it after anything else;
 * - a page that gives no token keeps the token it was sent;
 * - a multiget that falls short leaves nothing out: the calendar is listed
 *   whole, as before, with the removals and the token kept;
 * - a server that sends its data, as Nextcloud does, is read from its one
 *   answer, with no multiget. What changed for every server, its own
 *   included, is held here too: the REPORT T1 sent (`sync-level` 1), a
 *   refused token read again with none, and the token kept after a 5xx or
 *   a rate limit and dropped after any other refusal.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '@openmig/shared';
import type { CalendarFolder, SyncCursor } from '@openmig/shared';
import { CalDAVSource, MOST_SYNC_PAGES, MULTIGET_HREFS_PER_REQUEST } from './caldav-source.ts';
import type { HttpClient, HttpRequestOptions, HttpResponse } from './dav-http.types.ts';
import { FAKE_CALDAV_URL, FAKE_HOME, GoogleLikeCalDav, type MemberShape } from './__testing__/google-like-caldav.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function sourceOn(client: HttpClient): CalDAVSource {
  const source = new CalDAVSource(
    { url: FAKE_CALDAV_URL, username: 'owner@example.com', password: 'app-password' },
    { httpClient: client },
  );
  // The home is known, so each test reads `listSince` alone.
  (source as unknown as { calendarHomeSet: string }).calendarHomeSet = FAKE_HOME;
  return source;
}

/** A Google-like calendar of `count` events, `e1` … `eN`. */
function calendarOf(count: number, pageSize = 250): { google: GoogleLikeCalDav; folder: CalendarFolder } {
  const google = new GoogleLikeCalDav();
  google.pageSize = pageSize;
  const path = google.addCalendar('family', 'Family');
  for (let i = 1; i <= count; i += 1) google.add(path, `e${i}`);
  return { google, folder: { name: 'Family', path } };
}

const uids = (items: ReadonlyArray<{ item: { uid: string } }>): string[] => items.map((e) => e.item.uid).sort();
const tokenOf = (cursor: SyncCursor): string => cursor.value.replace(/^sync-token:/, '');
/** The sync token a request sent, `undefined` for a reading with none. */
const tokenSent = (options: HttpRequestOptions): string | undefined =>
  /<D:sync-token>([^<]*)<\/D:sync-token>/.exec(String(options.body))?.[1];

describe('a first reading whose members carry no data', () => {
  it('reads every member with calendar-multiget, a batch at a time, and lists nothing whole', async () => {
    const { google, folder } = calendarOf(120, 50);

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(result.items, 'the members were read as nothing, as before').toHaveLength(120);
    expect(google.askedOf('calendar-query'), 'the calendar was listed whole').toHaveLength(0);
    const batches = google.askedOf('calendar-multiget').map((a) => a.hrefs);
    expect(batches).toEqual([50, 50, 20]);
    expect(Math.max(...batches.map(Number))).toBeLessThanOrEqual(MULTIGET_HREFS_PER_REQUEST);
    expect(result.removed).toBeUndefined();
    expect(result.nextCursor.value).toBe('sync-token:tok:family:120');
  });

  it("hands each event on under the href sync-collection named it by, with the multiget's ETag", async () => {
    const { google, folder } = calendarOf(3);

    const result = await sourceOn(google.client).listSince(folder, undefined);

    const e2 = result.items.find((e) => e.item.uid === 'e2');
    expect(e2?.item.sourcePath).toBe(google.hrefOf(folder.path!, 'e2'));
    expect(e2?.item.etag).toMatch(/^"\d+"$/);
    expect(e2?.icalendar).toContain('UID:e2');
    expect(e2?.item.summary).toBe('Event e2');
  });

  it.each<MemberShape>(['calendar-data-404', 'calendar-data-404-first', 'etag-only', 'status-200'])(
    'reads a member whose data is left out as %s',
    async (shape) => {
      const { google, folder } = calendarOf(4);
      google.shape = shape;

      const result = await sourceOn(google.client).listSince(folder, undefined);

      expect(uids(result.items)).toEqual(['e1', 'e2', 'e3', 'e4']);
      expect(google.askedOf('calendar-query')).toHaveLength(0);
    },
  );

  it.each<MemberShape>(['calendar-data-404', 'calendar-data-404-first'])(
    'reads a 404 inside a propstat as a member that is there, not as a removal (%s)',
    async (shape) => {
      // Google's member says "calendar-data: 404" inside its propstat: no value
      // for that property. The member itself is there, whichever propstat comes first.
      const { google, folder } = calendarOf(2);
      google.shape = shape;

      const result = await sourceOn(google.client).listSince(folder, undefined);

      expect(result.removed, 'a property with no value was read as a deleted event').toBeUndefined();
      expect(result.items).toHaveLength(2);
      expect(google.askedOf('calendar-multiget').map((a) => a.hrefs)).toEqual([2]);
    },
  );

  it('matches a multiget that spells its hrefs another way, and hands on the href sync-collection gave', async () => {
    // The 404 that later names a removed event comes from sync-collection, and
    // the ledger matches the two as plain strings: the multiget's spelling,
    // here an absolute URL with its escapes undone, is only for matching.
    const { google, folder } = calendarOf(3);
    google.multigetSpelling = 'absolute';

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('calendar-query'), 'a respelled answer was read as a short one').toHaveLength(0);
    expect(result.items.map((e) => e.item.sourcePath).sort()).toEqual(
      ['e1', 'e2', 'e3'].map((uid) => google.hrefOf(folder.path!, uid)),
    );
  });

  it("carries up the removals a reading with no token lists, as Google's does", async () => {
    // T1: 3, 5 and 7 such 404s in three calendars' first readings.
    const { google, folder } = calendarOf(5);
    const before = [google.rememberRemoval(folder.path!, 'old1'), google.rememberRemoval(folder.path!, 'old2')];
    const since = google.remove(folder.path!, 'e3');

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect([...(result.removed ?? [])].sort()).toEqual([...before, since].sort());
    expect(uids(result.items)).toEqual(['e1', 'e2', 'e4', 'e5']);
  });

  it('follows a truncated answer to its last page, and hands on that page\'s token alone', async () => {
    // T1: 15 pages for 3,627 members. The removals sit on the last page.
    const { google, folder } = calendarOf(10, 4);
    const gone = google.rememberRemoval(folder.path!, 'old');

    const result = await sourceOn(google.client).listSince(folder, undefined);

    const tokens = google.askedOf('sync-collection').map((a) => a.token);
    expect(tokens, 'pages are asked for in turn, each with the token the one before gave').toEqual([
      '',
      'page:1:4',
      'page:2:8',
    ]);
    expect(result.nextCursor.value, 'a page token handed on as the reading\'s own').toBe('sync-token:tok:family:10');
    expect(result.items).toHaveLength(10);
    expect(result.removed).toEqual([gone]);
  });
});

describe('the next pass, with the token', () => {
  it('reads what changed and nothing more: the whole listing on every pass ends', async () => {
    const { google, folder } = calendarOf(300);
    const source = sourceOn(google.client);
    const first = await source.listSince(folder, undefined);
    google.asked.length = 0;

    google.change(folder.path!, 'e7', 'Moved a week');
    const gone = google.remove(folder.path!, 'e9');
    const second = await source.listSince(folder, first.nextCursor);

    expect(second.items.map((e) => e.item.uid), 'more than what changed was read').toEqual(['e7']);
    expect(second.items[0]?.item.summary).toBe('Moved a week');
    expect(second.removed).toEqual([gone]);
    expect(google.askedOf('sync-collection').map((a) => a.token)).toEqual([tokenOf(first.nextCursor)]);
    expect(google.askedOf('calendar-multiget').map((a) => a.hrefs)).toEqual([1]);
    expect(google.askedOf('calendar-query'), 'the calendar was listed whole again').toHaveLength(0);
    expect(second.nextCursor.value).toBe('sync-token:tok:family:302');
  });

  it('reads nothing when nothing changed, and keeps going from the new token', async () => {
    const { google, folder } = calendarOf(30);
    const source = sourceOn(google.client);
    const first = await source.listSince(folder, undefined);
    google.asked.length = 0;

    const second = await source.listSince(folder, first.nextCursor);

    expect(second.items).toHaveLength(0);
    expect(second.removed).toBeUndefined();
    expect(google.askedOf('calendar-multiget')).toHaveLength(0);
    expect(google.askedOf('calendar-query')).toHaveLength(0);
    expect(second.nextCursor.value).toBe(first.nextCursor.value);
  });
});

describe('pages that do not end', () => {
  it('are not taken as progress when a page gives back the token it was sent', async () => {
    const { google, folder } = calendarOf(6, 2);
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});
    // A server stuck on its second page: from there on it answers with the
    // token it was sent, so asking again would only get the same page.
    const stuck: HttpClient = {
      request: async (options) => {
        const answer = await google.client.request(options);
        const sent = /<D:sync-token>([^<]*)<\/D:sync-token>/.exec(String(options.body))?.[1];
        return sent === undefined
          ? answer
          : { ...answer, body: answer.body.replace(/<D:sync-token>[^<]*<\/D:sync-token>/, `<D:sync-token>${sent}</D:sync-token>`) };
      },
    };

    const result = await sourceOn(stuck).listSince(folder, undefined);

    expect(google.askedOf('calendar-query'), 'a reading cut short was handed on as whole').toHaveLength(1);
    expect(result.items).toHaveLength(6);
    expect(warned.mock.calls.flat().join(' ')).toContain('gave back the token it was sent');
  });

  it(`stop at ${MOST_SYNC_PAGES} pages, and the calendar is listed whole`, async () => {
    const { google, folder } = calendarOf(MOST_SYNC_PAGES + 5, 1);
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('sync-collection')).toHaveLength(MOST_SYNC_PAGES);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.items).toHaveLength(MOST_SYNC_PAGES + 5);
    // The last page's token, from which the rest follows.
    expect(result.nextCursor.value).toBe(`sync-token:page:${MOST_SYNC_PAGES}:${MOST_SYNC_PAGES}`);
  });

  it('list the calendar whole when a later page is refused, keeping the removals the pages before it reported', async () => {
    const { google, folder } = calendarOf(6, 4);
    let laterPagesFail = false;
    const client: HttpClient = {
      request: async (options) =>
        laterPagesFail && String(options.body).includes('page:')
          ? { status: 503, headers: {}, body: 'unavailable' }
          : google.client.request(options),
    };
    const source = sourceOn(client);
    const first = await source.listSince(folder, undefined);
    // The removal comes first in what changed, so it is on the page that answers.
    const gone = google.remove(folder.path!, 'e1');
    for (let i = 7; i <= 12; i += 1) google.add(folder.path!, `e${i}`);
    laterPagesFail = true;
    google.asked.length = 0;
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await source.listSince(folder, first.nextCursor);

    expect(result.removed).toEqual([gone]);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(uids(result.items)).toHaveLength(11);
    // The token of the page that answered, from which the rest follows.
    expect(result.nextCursor.value).toMatch(/^sync-token:page:\d+:4$/);
  });
});

describe('a refused token (RFC 6578 §3.2)', () => {
  it('is dropped, and the calendar is read whole again, once, which the log says', async () => {
    const { google, folder } = calendarOf(8);
    const source = sourceOn(google.client);
    const first = await source.listSince(folder, undefined);
    google.refusedTokens.add(tokenOf(first.nextCursor));
    google.asked.length = 0;
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const again = await source.listSince(folder, first.nextCursor);

    expect(google.askedOf('sync-collection').map((a) => a.token)).toEqual([tokenOf(first.nextCursor), '']);
    expect(again.items, 'the calendar was not read again').toHaveLength(8);
    expect(google.askedOf('calendar-query')).toHaveLength(0);
    expect(again.nextCursor.value).toBe('sync-token:tok:family:8');
    expect(warned.mock.calls.flat().join(' ')).toContain('refused this read');
  });

  it('is not asked about a third time when the reading with no token is refused too', async () => {
    const { google, folder } = calendarOf(3);
    google.refusedTokens.add('tok:family:3');
    google.refusedTokens.add('');
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, { value: 'sync-token:tok:family:3' });

    expect(google.askedOf('sync-collection')).toHaveLength(2);
    expect(google.askedOf('calendar-query'), 'the calendar-query fallback, as before').toHaveLength(1);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor.value).toBe('');
  });

  it('is told apart from another 403: one that names no valid-sync-token lists the calendar, and drops the token', async () => {
    const { google, folder } = calendarOf(2);
    let syncCollections = 0;
    const forbidden: HttpClient = {
      request: async (options) => {
        if (!String(options.body).includes('sync-collection')) return google.client.request(options);
        syncCollections += 1;
        return { status: 403, headers: {}, body: '<D:error xmlns:D="DAV:"><D:need-privileges/></D:error>' };
      },
    };
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(forbidden).listSince(folder, { value: 'sync-token:tok:family:2' });

    expect(syncCollections, 'a 403 for another reason was read as a refused token').toBe(1);
    expect(result.items).toHaveLength(2);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    // It may be the token's, unnamed: the next pass reads with none (second review of #2019).
    expect(result.nextCursor.value).toBe('');
  });

  it('is told apart from a 500, which lists the calendar whole and keeps the token it was sent', async () => {
    const { google, folder } = calendarOf(3);
    const source = sourceOn(google.client);
    const first = await source.listSince(folder, undefined);
    google.add(folder.path!, 'e4');
    let failNext = true;
    const flaky: HttpClient = {
      request: async (options) => {
        if (failNext && String(options.body).includes('sync-collection')) {
          failNext = false;
          return { status: 500, headers: {}, body: 'backend error' };
        }
        return google.client.request(options);
      },
    };
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const during = await sourceOn(flaky).listSince(folder, first.nextCursor);
    google.asked.length = 0;
    const after = await source.listSince(folder, during.nextCursor);

    expect(uids(during.items)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(during.nextCursor.value, 'a 500 dropped the token, and the next pass read with none').toBe(first.nextCursor.value);
    expect(google.askedOf('sync-collection').map((a) => a.token)).toEqual([tokenOf(first.nextCursor)]);
    expect(uids(after.items)).toEqual(['e4']);
  });

  it('is a 409 as much as a 403', async () => {
    const { google, folder } = calendarOf(4);
    google.refusedWith = 409;
    google.refusedTokens.add('tok:family:4');
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, { value: 'sync-token:tok:family:4' });

    expect(google.askedOf('sync-collection').map((a) => a.token)).toEqual(['tok:family:4', '']);
    expect(google.askedOf('calendar-query'), 'a 409 refusal was not read as a refused token').toHaveLength(0);
    expect(result.items).toHaveLength(4);
  });

  it('is not what a reading that sent no token is refused for: it is not asked again', async () => {
    const { google, folder } = calendarOf(2);
    google.refusedTokens.add('');
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('sync-collection'), 'a reading with no token was asked again with none').toHaveLength(1);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.items).toHaveLength(2);
  });
});

/**
 * WHAT A REFUSAL OF THE FIRST PAGE DOES TO THE TOKEN IT WAS SENT (second
 * review of #2019). A 5xx or a rate limit is the server's trouble for the
 * moment, and keeps it. Anything else drops it: a stale token refused
 * without `DAV:valid-sync-token`, with a 410, say, as Google's REST APIs
 * answer one, would otherwise be refused on every pass, and no removal
 * reported from that calendar again.
 */
describe('a refusal of the first page, and the token it was sent', () => {
  it('drops a stale token refused with a 410, so the next reading asks with none and goes on from its own', async () => {
    const { google, folder } = calendarOf(5);
    const stale = new Set<string>();
    const client: HttpClient = {
      request: (options) => {
        const sent = tokenSent(options);
        return String(options.body).includes('sync-collection') && sent !== undefined && stale.has(sent)
          ? Promise.resolve<HttpResponse>({ status: 410, headers: {}, body: 'Gone' })
          : google.client.request(options);
      },
    };
    const source = sourceOn(client);
    const first = await source.listSince(folder, undefined);
    stale.add(tokenOf(first.nextCursor));
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const refused = await source.listSince(folder, first.nextCursor);
    google.asked.length = 0;
    const next = await source.listSince(folder, refused.nextCursor);

    expect(refused.items).toHaveLength(5);
    expect(refused.nextCursor.value, 'a stale token was kept, to be refused on every pass').toBe('');
    expect(warned.mock.calls.flat().join(' ')).toContain('dropping the sync token');
    expect(google.askedOf('sync-collection').map((a) => a.token)).toEqual(['']);
    expect(next.nextCursor.value).toBe('sync-token:tok:family:5');
  });

  it.each<[string, HttpResponse]>([
    ['a 429', { status: 429, headers: { 'retry-after': '0' }, body: 'slow down' }],
    [
      "Google's 403 rate limit",
      {
        status: 403,
        headers: { 'retry-after': '0' },
        body:
          '<?xml version="1.0" encoding="UTF-8"?><errors xmlns="http://schemas.google.com/g/2005">' +
          '<error><domain>GData</domain><code>rateLimitExceeded</code><internalReason>Rate limit exceeded</internalReason></error></errors>',
      },
    ],
  ])('keeps the token after %s, as after a 5xx', async (_what, refusal) => {
    const { google, folder } = calendarOf(3);
    const limited: HttpClient = {
      request: (options) =>
        String(options.body).includes('sync-collection') ? Promise.resolve(refusal) : google.client.request(options),
    };
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(limited).listSince(folder, { value: 'sync-token:tok:family:3' });

    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor.value, 'a rate limit dropped the token').toBe('sync-token:tok:family:3');
  });
});

/**
 * A PAGE THAT GIVES NO TOKEN KEEPS THE ONE IT WAS SENT (second review of
 * #2019). RFC 6578 has every answer carry a token; one that leaves it out
 * has said nothing past the token it was asked with. Dropped, the next pass
 * would read the calendar whole with no token.
 */
describe('a page that gives no token', () => {
  /** The server, with the sync token left out of the sync-collection answers `drop` picks. */
  const leavingOutTheToken = (google: GoogleLikeCalDav, drop: (body: string) => boolean): HttpClient => ({
    request: async (options) => {
      const answer = await google.client.request(options);
      if (!String(options.body).includes('sync-collection') || !drop(answer.body)) return answer;
      return { ...answer, body: answer.body.replace(/<D:sync-token>[^<]*<\/D:sync-token>/, '') };
    },
  });

  it('keeps the token it was sent when it is truncated, and the next reading goes on from there', async () => {
    const { google, folder } = calendarOf(6, 2);
    const first = await sourceOn(google.client).listSince(folder, undefined);
    for (let i = 7; i <= 12; i += 1) google.add(folder.path!, `e${i}`);
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const cut = await sourceOn(leavingOutTheToken(google, (body) => body.includes('HTTP/1.1 507'))).listSince(
      folder,
      first.nextCursor,
    );
    google.asked.length = 0;
    const next = await sourceOn(google.client).listSince(folder, cut.nextCursor);

    expect(cut.items, 'the reading cut short was not listed whole').toHaveLength(12);
    expect(cut.nextCursor.value, 'the token was dropped, and the next pass read the calendar with none').toBe(
      first.nextCursor.value,
    );
    expect(google.askedOf('sync-collection')[0]?.token).toBe(tokenOf(first.nextCursor));
    expect(uids(next.items)).toEqual(['e10', 'e11', 'e12', 'e7', 'e8', 'e9']);
    expect(next.nextCursor.value).toBe('sync-token:tok:family:12');
  });

  it('keeps the token it was sent when it is the last page, so the next reading names what this one did, and more', async () => {
    const { google, folder } = calendarOf(3);
    const first = await sourceOn(google.client).listSince(folder, undefined);
    google.add(folder.path!, 'e4');

    const read = await sourceOn(leavingOutTheToken(google, () => true)).listSince(folder, first.nextCursor);
    google.add(folder.path!, 'e5');
    google.asked.length = 0;
    const next = await sourceOn(google.client).listSince(folder, read.nextCursor);

    expect(uids(read.items)).toEqual(['e4']);
    expect(read.nextCursor.value, 'the token was dropped, and the next pass read the calendar with none').toBe(
      first.nextCursor.value,
    );
    expect(google.askedOf('sync-collection').map((a) => a.token)).toEqual([tokenOf(first.nextCursor)]);
    expect(uids(next.items)).toEqual(['e4', 'e5']);
  });
});

describe('a calendar-multiget that falls short', () => {
  it('loses none of the other batches: the calendar is listed whole, and the removals and token are kept', async () => {
    const { google, folder } = calendarOf(120, 250);
    const gone = google.rememberRemoval(folder.path!, 'old');
    google.onMultiget = (index) =>
      index === 1 ? { status: 500, headers: {}, body: 'backend error' } : undefined;
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(uids(result.items), 'the members of the failing batch, or those around it, were lost').toHaveLength(120);
    expect(google.askedOf('calendar-multiget'), 'it went on asking after a batch failed').toHaveLength(2);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.removed).toEqual([gone]);
    expect(result.nextCursor.value, 'the token was dropped although the listing covered it').toBe(
      'sync-token:tok:family:120',
    );
    expect(warned.mock.calls.flat().join(' ')).toContain('answered 500');
  });

  it('treats a member left out of the answer as not read', async () => {
    const { google, folder } = calendarOf(5);
    google.multigetLeavesOut.add(google.hrefOf(folder.path!, 'e4'));
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(uids(result.items)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('treats a member answered with another status as not read', async () => {
    const { google, folder } = calendarOf(2);
    google.onMultiget = (_index, hrefs) => ({
      status: 207,
      headers: {},
      body:
        '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
        hrefs.map((h) => `<D:response><D:href>${h}</D:href><D:status>HTTP/1.1 403 Forbidden</D:status></D:response>`).join('') +
        '</D:multistatus>',
    });
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.items).toHaveLength(2);
  });

  it('treats a multiget that got no answer at all as not read', async () => {
    const { google, folder } = calendarOf(3);
    const cut: HttpClient = {
      request: async (options) => {
        if (String(options.body).includes('calendar-multiget')) throw new Error('socket hang up');
        return google.client.request(options);
      },
    };
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(cut).listSince(folder, undefined);

    expect(result.items).toHaveLength(3);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(warned.mock.calls.flat().join(' ')).toContain('socket hang up');
  });

  it('loses none of the members a multiget answers 404 for while they are there', async () => {
    // Review of #2019: a multiget that cannot find what sync-collection just
    // named (an href it spells another way, a server's own fault). Passed over,
    // those members were never copied, and the token retired them for good.
    const { google, folder } = calendarOf(6);
    google.onMultiget = (_index, hrefs) => ({
      status: 207,
      headers: {},
      body:
        '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
        hrefs.map((h) => `<D:response><D:href>${h}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`).join('') +
        '</D:multistatus>',
    });
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(uids(result.items), 'members that are there were taken as gone').toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.nextCursor.value).toBe('sync-token:tok:family:6');
  });

  it('takes a member gone between the listing and the multiget as not read, and the next reading reports it', async () => {
    const { google, folder } = calendarOf(4);
    const source = sourceOn(google.client);
    let removedHref = '';
    google.onMultiget = (index) => {
      // Deleted at Google between the listing and the multiget.
      if (index === 0) removedHref = google.remove(folder.path!, 'e2');
      return undefined;
    };
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const first = await source.listSince(folder, undefined);
    google.onMultiget = undefined;
    const second = await source.listSince(folder, first.nextCursor);

    // Listed whole for that pass, which names what is there and not what went.
    expect(uids(first.items)).toEqual(['e1', 'e3', 'e4']);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(second.removed, 'the removal was lost').toEqual([removedHref]);
  });

  it('throws when the whole listing fails too, so the pass keeps the token where it was', async () => {
    const { google, folder } = calendarOf(3);
    google.onMultiget = () => ({ status: 500, headers: {}, body: 'backend error' });
    const failing: HttpClient = {
      request: async (options) =>
        String(options.body).includes('calendar-query')
          ? { status: 500, headers: {}, body: 'backend error' }
          : google.client.request(options),
    };
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    await expect(sourceOn(failing).listSince(folder, undefined)).rejects.toThrow(/calendar-query REPORT failed with status 500/);
  });
});

describe('what is not a member to read', () => {
  it('the calendar itself, and a collection listed among its members', async () => {
    const { google, folder } = calendarOf(2);
    const extra: HttpClient = {
      request: async (options) => {
        const answer = await google.client.request(options);
        if (!String(options.body).includes('sync-collection')) return answer;
        const more =
          `<D:response><D:href>${folder.path}</D:href><D:propstat><D:prop><D:getetag>"c"</D:getetag></D:prop>` +
          '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>' +
          `<D:response><D:href>${folder.path}attachments/</D:href><D:propstat><D:prop>` +
          '<D:resourcetype><D:collection/></D:resourcetype></D:prop>' +
          '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
        return { ...answer, body: answer.body.replace('</D:multistatus>', `${more}</D:multistatus>`) };
      },
    };

    const result = await sourceOn(extra).listSince(folder, undefined);

    expect(google.askedOf('calendar-multiget').map((a) => a.hrefs)).toEqual([2]);
    expect(result.items).toHaveLength(2);
  });

  it('a first reading that lists nothing but the calendar itself has answered nothing, and is checked', async () => {
    // #926's rule for a first reading of nothing: it is a claim, so the
    // calendar is listed to see. The calendar's own href is not a member.
    const google = new GoogleLikeCalDav();
    const path = google.addCalendar('family', 'Family');
    const onlyItself: HttpClient = {
      request: async (options) => {
        const answer = await google.client.request(options);
        if (!String(options.body).includes('sync-collection')) return answer;
        const itself =
          `<D:response><D:href>${path}</D:href><D:propstat><D:prop><D:getetag>"c"</D:getetag></D:prop>` +
          '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
        return { ...answer, body: answer.body.replace('</D:multistatus>', `${itself}</D:multistatus>`) };
      },
    };
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(onlyItself).listSince({ name: 'Family', path }, undefined);

    expect(google.askedOf('calendar-query'), 'a first reading of nothing was taken on trust').toHaveLength(1);
    expect(google.askedOf('calendar-multiget')).toHaveLength(0);
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor.value).toBe('');
  });

  it('asks the multiget with Depth 1, which RFC 4791 §7.9 has a server ignore', async () => {
    const { google, folder } = calendarOf(1);
    await sourceOn(google.client).listSince(folder, undefined);
    expect(google.askedOf('calendar-multiget').map((a) => a.depth)).toEqual(['1']);
  });
});

describe('the REPORT T1 measured (review of #2019)', () => {
  it('names the token, then sync-level 1, then the properties, as T1 asked Google', async () => {
    const asked: string[] = [];
    const { google, folder } = calendarOf(1);
    const recording: HttpClient = {
      request: (options) => {
        asked.push(String(options.body));
        return google.client.request(options);
      },
    };

    await sourceOn(recording).listSince(folder, undefined);

    const report = asked.find((b) => b.includes('sync-collection')) ?? '';
    const at = (needle: string): number => report.indexOf(needle);
    expect(at('<D:sync-level>1</D:sync-level>'), 'no sync-level, which T1 sent').toBeGreaterThan(-1);
    expect(at('<D:sync-token/>')).toBeLessThan(at('<D:sync-level>'));
    expect(at('<D:sync-level>')).toBeLessThan(at('<D:prop>'));
    expect(report).toContain('<C:calendar-data/>');
    expect(google.askedOf('sync-collection').map((a) => a.level)).toEqual(['1']);
  });

  it('is asked again without sync-level when a server refuses it with 400, and every page goes without it', async () => {
    const { google, folder } = calendarOf(9, 4);
    google.refusesSyncLevel = 400;
    const warned = vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('sync-collection').map((a) => a.level ?? 'none')).toEqual(['1', 'none', 'none', 'none']);
    expect(result.items).toHaveLength(9);
    expect(google.askedOf('calendar-query')).toHaveLength(0);
    expect(warned.mock.calls.flat().join(' ')).toContain('without sync-level');
  });

  it('is not asked again without sync-level for another refusal', async () => {
    const { google, folder } = calendarOf(2);
    google.refusesSyncLevel = 500;
    vi.spyOn(log, 'warn').mockImplementation(() => {});

    const result = await sourceOn(google.client).listSince(folder, undefined);

    expect(google.askedOf('sync-collection')).toHaveLength(1);
    expect(google.askedOf('calendar-query')).toHaveLength(1);
    expect(result.items).toHaveLength(2);
  });

  it("hears a refused token behind a 400 to sync-level: the retry's answer stands (second review of #2019)", async () => {
    const { google, folder } = calendarOf(5);
    google.refusesSyncLevel = 400;
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    const source = sourceOn(google.client);
    const first = await source.listSince(folder, undefined);
    google.refusedTokens.add(tokenOf(first.nextCursor));
    google.asked.length = 0;

    const again = await source.listSince(folder, first.nextCursor);

    expect(google.askedOf('sync-collection').map((a) => `${a.token || '(none)'} ${a.level ?? 'without'}`)).toEqual([
      'tok:family:5 1',
      'tok:family:5 without',
      '(none) 1',
      '(none) without',
    ]);
    expect(google.askedOf('calendar-query'), 'the refused token was not heard, and the calendar listed whole').toHaveLength(0);
    expect(again.items).toHaveLength(5);
    expect(again.nextCursor.value).toBe('sync-token:tok:family:5');
  });
});

describe('what goes back to the server as it came (review of #2019)', () => {
  it('a sync token holding an & is sent back as the server gave it', async () => {
    const token = 'https://calendar.example.com/sync/family?since=7&amp;page=1';
    const asked: string[] = [];
    const client: HttpClient = {
      request: (options) => {
        asked.push(String(options.body));
        return Promise.resolve<HttpResponse>({
          status: 207,
          headers: {},
          body: `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:sync-token>${token}</D:sync-token></D:multistatus>`,
        });
      },
    };
    const source = sourceOn(client);

    const first = await source.listSince({ name: 'Family', path: '/caldav/v2/family%40example.com/events/' }, {
      value: 'sync-token:https://calendar.example.com/sync/family?since=6',
    });
    await source.listSince({ name: 'Family', path: '/caldav/v2/family%40example.com/events/' }, first.nextCursor);

    expect(first.nextCursor.value).toBe('sync-token:https://calendar.example.com/sync/family?since=7&page=1');
    expect(asked[1], 'the token went back changed').toContain(`<D:sync-token>${token}</D:sync-token>`);
  });

  it('an event whose href holds an & is asked for with it escaped once, and found', async () => {
    const google = new GoogleLikeCalDav();
    const path = google.addCalendar('family', 'Family');
    google.add(path, 'tea&cake');
    google.add(path, 'e2');

    const result = await sourceOn(google.client).listSince({ name: 'Family', path }, undefined);

    expect(google.askedOf('calendar-query'), 'the multiget asked for an href no event has').toHaveLength(0);
    expect(uids(result.items)).toEqual(['e2', 'tea&cake']);
    // Handed on in the multistatus's own spelling, as a later 404 will name it.
    expect(result.items.map((e) => e.item.sourcePath)).toContain(`${path}tea&amp;cake.ics`);
  });
});

describe('a member is read once (review of #2019)', () => {
  /** A client that adds to each sync-collection answer a copy of one member, written without its data. */
  const repeating = (google: GoogleLikeCalDav, href: string): HttpClient => ({
    request: async (options) => {
      const answer = await google.client.request(options);
      if (!String(options.body).includes('sync-collection')) return answer;
      const again =
        `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:getetag>"again"</D:getetag></D:prop>` +
        '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
      return { ...answer, body: answer.body.replace('</D:multistatus>', `${again}</D:multistatus>`) };
    },
  });

  it('when it is named twice without its data', async () => {
    const { google, folder } = calendarOf(3);

    const result = await sourceOn(repeating(google, google.hrefOf(folder.path!, 'e2'))).listSince(folder, undefined);

    expect(google.askedOf('calendar-multiget').map((a) => a.hrefs), 'a member named twice was asked for twice').toEqual([3]);
    expect(result.items).toHaveLength(3);
  });

  it('when it came with its data and is named again without it', async () => {
    const { google, folder } = calendarOf(3);
    const e2 = google.hrefOf(folder.path!, 'e2');
    google.sendsDataFor.add(e2);

    const result = await sourceOn(repeating(google, e2)).listSince(folder, undefined);

    expect(google.askedOf('calendar-multiget').map((a) => a.hrefs), 'a member read already was asked for again').toEqual([2]);
    expect(uids(result.items)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('what the log says (review of #2019)', () => {
  it('names counts and statuses, never a calendar\'s path, which at Google holds an address', async () => {
    const { google, folder } = calendarOf(30, 10);
    google.onMultiget = (index) => (index === 0 ? { status: 500, headers: {}, body: 'backend error' } : undefined);
    google.refusedTokens.add('tok:family:30');
    const lines: unknown[] = [];
    vi.spyOn(log, 'warn').mockImplementation((...args) => lines.push(...args));
    vi.spyOn(log, 'info').mockImplementation((...args) => lines.push(...args));
    const source = sourceOn(google.client);

    const first = await source.listSince(folder, undefined);
    google.onMultiget = undefined;
    await source.listSince(folder, first.nextCursor);

    expect(lines.length, 'nothing was logged to look at').toBeGreaterThan(2);
    expect(lines.filter((l) => String(l).includes('example.com')), 'a calendar path in the log').toEqual([]);
  });

  it('names no path either when the report is refused, or a calendar answers nothing', async () => {
    const google = new GoogleLikeCalDav();
    const empty = google.addCalendar('empty', 'Empty');
    const full = google.addCalendar('full', 'Full');
    google.add(full, 'e1');
    const refusing: HttpClient = {
      request: async (options) =>
        new URL(options.url).pathname === full && String(options.body).includes('sync-collection')
          ? { status: 501, headers: {}, body: 'not implemented' }
          : google.client.request(options),
    };
    const lines: unknown[] = [];
    vi.spyOn(log, 'warn').mockImplementation((...args) => lines.push(...args));
    vi.spyOn(log, 'info').mockImplementation((...args) => lines.push(...args));
    const source = sourceOn(refusing);

    await source.listSince({ name: 'Empty', path: empty }, undefined);
    await source.listSince({ name: 'Full', path: full }, { value: 'sync-token:tok:full:1' });

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.filter((l) => String(l).includes('example.com')), 'a calendar path in the log').toEqual([]);
  });
});

/**
 * A SERVER THAT SENDS ITS DATA is read from its one REPORT: no multiget, the
 * objects and removals it carried. Nextcloud, Infomaniak and Cirrux calendars
 * answer this way, and the Nextcloud suites hold them too. Not exactly as
 * before: the REPORT carries `sync-level` 1 now, and a refusal is followed
 * differently, both held above.
 */
describe('a server that sends its data with each member', () => {
  const BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/calendars/alice/personal/one.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-one"</d:getetag>
        <cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:One
SUMMARY:Still here
END:VEVENT
END:VCALENDAR</cal:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/calendars/alice/personal/gone.ics</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>
  <d:sync-token>http://example.com/ns/sync/9</d:sync-token>
</d:multistatus>`;

  it('is read in one REPORT, with no multiget and no listing', async () => {
    const asked: string[] = [];
    const client: HttpClient = {
      request: (options) => {
        asked.push(String(options.body));
        return Promise.resolve<HttpResponse>({ status: 207, headers: {}, body: BODY });
      },
    };
    const source = new CalDAVSource(
      { url: 'https://dav.example.com/', username: 'alice', password: 'pw' },
      { httpClient: client },
    );
    (source as unknown as { calendarHomeSet: string }).calendarHomeSet = '/dav/calendars/alice/';

    const result = await source.listSince({ name: 'Personal', path: '/dav/calendars/alice/personal/' }, {
      value: 'sync-token:http://example.com/ns/sync/8',
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('sync-collection');
    expect(result.items.map((e) => e.item.sourcePath)).toEqual(['/dav/calendars/alice/personal/one.ics']);
    expect(result.removed).toEqual(['/dav/calendars/alice/personal/gone.ics']);
    expect(result.nextCursor.value).toBe('sync-token:http://example.com/ns/sync/9');
  });
});
