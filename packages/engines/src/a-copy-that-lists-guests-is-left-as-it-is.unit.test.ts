// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY THAT STILL LISTS GUESTS IS LEFT AS IT IS, AT A TARGET THAT MAILS THEM
 * (workplan 0160, 2026-11-19).
 *
 * Cirrux mailed a guest a cancellation when they were taken off an event, and
 * when the event was deleted: a test of each that evening mailed one. From
 * #1947 the writer sent Cirrux no guests at all, so an event copied before
 * that still listed its guests there, and any rewrite (which takes them all
 * off) or delete of it would have mailed every one. So for such a target the
 * writer reads the copy first, and when it lists a guest neither PUTs nor
 * DELETEs.
 *
 * No kind is on `TARGETS_THAT_MAIL_GUESTS` since 2026-11-20 (ADR-0043):
 * Cirrux left it that day, as the last block below says. The path is kept for
 * the next kind seen mailing guests, and every case before the last two
 * blocks hands the writer its flag itself, so they hold it to its word while
 * the list is empty.
 *
 * The fake below keeps what it holds and answers GET, PUT and DELETE as a DAV
 * server does, `If-Match` included, so "nothing was sent" is what the server
 * saw, not what the writer said.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, mailsGuestsItself, type Ledger } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { removeDavResource } from './dav-remove.ts';

const TENANT = asTenantId('6d330000-e29b-41d4-a716-4466554471b1' as never);
const MAPPING = asMappingId('6d330000-e29b-41d4-a716-4466554471b2' as never);
const BASE = 'https://dav.example.org/dav';
const CALENDAR = '/calendars/home/default/';
const EVENT = `${CALENDAR}evt-1.ics`;

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
} as unknown as Ledger;

/** An event as Cirrux keeps one it was handed before the guests came out. */
const WITH_GUESTS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:evt-1',
  'SUMMARY:A meeting',
  'ORGANIZER;CN=Someone;SCHEDULE-AGENT=CLIENT:mailto:organiser@example.org',
  'ATTENDEE;CN=A Guest;SCHEDULE-AGENT=CLIENT:mailto:guest@example.org',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

/** The same event as the writer sends a target that mails guests, as it sent Cirrux from #1947 to 2026-11-20. */
const WITHOUT_GUESTS = WITH_GUESTS.replace(
  /^ORGANIZER.*\r\nATTENDEE.*\r\n/m,
  'COMMENT:Organised at the source by: Someone <organiser@example.org>\r\nCOMMENT:Invited at the source: A Guest <guest@example.org>\r\n',
);

/** The source's new version of it: the summary changed, the guest is still invited. */
const CHANGED_AT_SOURCE = WITH_GUESTS.replace('SUMMARY:A meeting', 'SUMMARY:A meeting, moved');

interface Call {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  status: number;
}

/**
 * A DAV target holding at most one object at `EVENT`, with a version.
 *
 * `onGet` runs after a GET is answered, to stand for somebody changing the
 * copy between the writer's read and its write.
 */
function target(held: { body: string; etag: string } | undefined, onGet?: () => void, getStatus?: number) {
  const calls: Call[] = [];
  let copy = held;
  const client: HttpClient = {
    async request(o) {
      const path = new URL(o.url).pathname.replace(/^\/dav/, '');
      const answer = (status: number, body = '', headers: Record<string, string> = {}) => {
        calls.push({ method: o.method, url: o.url, ...(o.headers ? { headers: o.headers } : {}), ...(o.body !== undefined ? { body: String(o.body) } : {}), status });
        return { status, body, headers };
      };
      const ifMatch = o.headers?.['If-Match'];
      const matches = ifMatch === undefined || (copy !== undefined && ifMatch === `"${copy.etag}"`);
      if (path === EVENT && o.method === 'GET') {
        if (getStatus !== undefined) return answer(getStatus);
        const r = copy ? answer(200, copy.body, { etag: `"${copy.etag}"` }) : answer(404);
        onGet?.();
        return r;
      }
      if (path === EVENT && o.method === 'HEAD') {
        return copy ? answer(200, '', { etag: `"${copy.etag}"` }) : answer(404);
      }
      if (path === EVENT && o.method === 'PUT') {
        if (!matches) return answer(412);
        copy = { body: String(o.body), etag: 'after-our-write' };
        return answer(204, '', { etag: '"after-our-write"' });
      }
      if (path === EVENT && o.method === 'DELETE') {
        if (!copy) return answer(404);
        if (!matches) return answer(412);
        copy = undefined;
        return answer(204);
      }
      return answer(207, '<d:multistatus xmlns:d="DAV:"></d:multistatus>');
    },
  };
  return {
    client,
    calls,
    held: () => copy,
    sent: (method: string) => calls.filter((c) => c.method === method),
    addGuest: () => {
      copy = { body: WITH_GUESTS, etag: 'after-a-guest-was-added' };
    },
  };
}

function writer(client: HttpClient, mailsGuests: boolean, domain: 'calendar' | 'task' = 'calendar') {
  return new CalDAVTargetWriter(
    { url: BASE, username: 'someone', password: 'pw', ...(mailsGuests ? { mailsGuests: true } : {}) },
    { domain, ledger: emptyLedger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
}

const rewrite = (w: CalDAVTargetWriter, icalendar = CHANGED_AT_SOURCE, expectedTargetVersion = 'v1') =>
  w.upsertCalendarEvent(
    CALENDAR,
    { item: { uid: 'evt-1', type: 'event', summary: 'A meeting, moved', start: '', etag: 'e2', sourcePath: '', icalendar }, icalendar },
    { overwrite: true, expectedTargetVersion },
  );

describe('a rewrite at a target that mails guests', () => {
  it('sends NOTHING when the copy there still lists a guest, and says so', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    const result = await rewrite(writer(t.client, true));

    expect(result).toEqual({ targetId: EVENT, created: false, keptForGuests: true });
    expect(t.sent('PUT'), 'a PUT here takes the guest off, and the guest is mailed').toHaveLength(0);
    expect(t.held()).toEqual({ body: WITH_GUESTS, etag: 'v1' });
    // Asked of the copy, once: the guests that would be mailed are the copy's.
    expect(t.sent('GET')).toHaveLength(1);
  });

  it('rewrites a copy that lists nobody, without guests and under If-Match, as before', async () => {
    const t = target({ body: WITHOUT_GUESTS, etag: 'v1' });

    const result = await rewrite(writer(t.client, true));

    expect(result).toMatchObject({ targetId: EVENT, created: false, updated: true });
    const [put] = t.sent('PUT');
    expect(put?.status).toBe(204);
    expect(put?.headers?.['If-Match']).toBe('"v1"');
    expect(put?.body).not.toMatch(/^(ATTENDEE|ORGANIZER)/m);
    expect(put?.body).toContain('SUMMARY:A meeting, moved');
  });

  it('goes on to the PUT when the copy is gone, which then finds nothing to match', async () => {
    // Nobody is left to mail. The If-Match decides, as it always has, and its
    // 412 on a copy that is not there is the copy gone, not an edit (0168).
    const t = target(undefined);

    const result = await rewrite(writer(t.client, true));

    expect(t.sent('PUT')).toHaveLength(1);
    expect(result).toMatchObject({ goneFromTarget: true });
  });

  it('writes nothing when the copy cannot be read, and throws rather than guessing', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' }, undefined, 403);

    await expect(rewrite(writer(t.client, true))).rejects.toThrow(/whether the copy there still lists guests is unknown.*Nothing was written/s);
    expect(t.sent('PUT')).toHaveLength(0);
  });

  it('writes nothing when the read answers with no calendar in it: an empty answer is not a copy without guests', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' }, undefined, 200);

    await expect(rewrite(writer(t.client, true))).rejects.toThrow(/answered with no calendar object.*Nothing was written/s);
    expect(t.sent('PUT')).toHaveLength(0);
  });

  it('does the same for a task', async () => {
    const todo = WITH_GUESTS.replace(/VEVENT/g, 'VTODO');
    const t = target({ body: todo, etag: 'v1' });

    const result = await rewrite(writer(t.client, true, 'task'), todo.replace('SUMMARY:A meeting', 'SUMMARY:Changed'));

    expect(result).toMatchObject({ keptForGuests: true });
    expect(t.sent('PUT')).toHaveLength(0);
  });

  it('costs a target that does not mail guests nothing: no read, the rewrite as before', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    const result = await rewrite(writer(t.client, false));

    expect(result).toMatchObject({ updated: true });
    expect(t.sent('GET')).toHaveLength(0);
    expect(t.sent('PUT')).toHaveLength(1);
  });

  it('reads nothing first on a first copy, which has no copy to read', async () => {
    const t = target(undefined);
    const w = writer(t.client, true);

    await w.upsertCalendarEvent(CALENDAR, { item: { uid: 'evt-1', type: 'event', summary: 'A meeting', start: '', etag: 'e1', sourcePath: '', icalendar: WITH_GUESTS }, icalendar: WITH_GUESTS });

    expect(t.sent('GET').filter((c) => c.url.endsWith('evt-1.ics'))).toHaveLength(0);
    expect(t.sent('PUT')[0]?.body).not.toMatch(/^ATTENDEE/m);
  });
});

describe('a removal at a target that mails guests', () => {
  it('removes NOTHING when the copy still lists a guest, and says so', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    const result = await writer(t.client, true).removeItem(EVENT, { expectedTargetVersion: 'v1' });

    expect(result).toEqual({ keptForGuests: true });
    expect(t.sent('DELETE'), 'a DELETE here mails each guest a cancellation').toHaveLength(0);
    expect(t.held()).toEqual({ body: WITH_GUESTS, etag: 'v1' });
  });

  it('removes a copy that lists nobody, under If-Match, as before', async () => {
    const t = target({ body: WITHOUT_GUESTS, etag: 'v1' });

    const result = await writer(t.client, true).removeItem(EVENT, { expectedTargetVersion: 'v1' });

    expect(result).toEqual({ kind: 'deleted' });
    const [del] = t.sent('DELETE');
    expect(del?.headers?.['If-Match']).toBe('"v1"');
    expect(del?.headers?.['Schedule-Reply']).toBe('F');
    expect(t.held()).toBeUndefined();
  });

  it('removes nothing when a guest is added between the read and the DELETE: the version moved', async () => {
    const t = target({ body: WITHOUT_GUESTS, etag: 'v1' });
    const late = target({ body: WITHOUT_GUESTS, etag: 'v1' }, () => late.addGuest());

    const result = await writer(late.client, true).removeItem(EVENT, { expectedTargetVersion: 'v1' });

    expect(result).toEqual({ conflicted: true });
    expect(late.sent('DELETE').map((c) => c.status)).toEqual([412]);
    expect(late.held()?.body).toBe(WITH_GUESTS);
    expect(t.sent('DELETE')).toHaveLength(0);
  });

  it('answers gone for a copy that is gone, without a DELETE', async () => {
    const t = target(undefined);

    expect(await writer(t.client, true).removeItem(EVENT, { expectedTargetVersion: 'v1' })).toEqual({ kind: 'deleted' });
    expect(t.sent('DELETE')).toHaveLength(0);
  });

  it('removes nothing when the copy cannot be read, and throws rather than guessing', async () => {
    const t = target({ body: WITHOUT_GUESTS, etag: 'v1' }, undefined, 403);

    await expect(writer(t.client, true).removeItem(EVENT, { expectedTargetVersion: 'v1' })).rejects.toThrow(
      /whether the copy lists guests is unknown.*Nothing was removed/s,
    );
    expect(t.sent('DELETE')).toHaveLength(0);
  });

  it('removes nothing when the read answers with no calendar in it', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' }, undefined, 200);

    await expect(writer(t.client, true).removeItem(EVENT, { expectedTargetVersion: 'v1' })).rejects.toThrow(
      /answered with no calendar object.*Nothing was removed/s,
    );
    expect(t.sent('DELETE')).toHaveLength(0);
  });

  it('asks nothing of a copy with no version: that refusal comes first and costs no request', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    expect(await writer(t.client, true).removeItem(EVENT)).toEqual({ unversioned: true });
    expect(t.calls).toHaveLength(0);
  });

  it('costs a target that does not mail guests nothing: no read, the DELETE as before', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    expect(await writer(t.client, false).removeItem(EVENT, { expectedTargetVersion: 'v1' })).toEqual({ kind: 'deleted' });
    expect(t.sent('GET')).toHaveLength(0);
    expect(t.sent('DELETE')).toHaveLength(1);
  });

  it('is the shared removal that decides, so no DAV writer can skip it once told', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    const result = await removeDavResource({
      url: `${BASE}${EVENT}`,
      authorization: 'Basic xyz',
      request: (o) => t.client.request(o),
      expectedTargetVersion: 'v1',
      keepIfItListsGuests: true,
    });

    expect(result).toEqual({ keptForGuests: true });
    expect(t.sent('DELETE')).toHaveLength(0);
  });
});

/**
 * AN INFOMANIAK TARGET IS WRITTEN AS A NEXTCLOUD ONE IS (workplan 0161;
 * ADR-0043, amended 2026-11-20). `infomaniak` was on
 * `TARGETS_THAT_MAIL_GUESTS`, untested, from the day its kind arrived until
 * that amendment took it off. A writer's flag is that list's answer for its
 * kind (`mailsGuestsItself`, which the factories hand over), so Infomaniak's
 * writers keep each guest and the organiser, marked `SCHEDULE-AGENT=CLIENT`,
 * read nothing first, and rewrite and remove a copy that lists guests as at
 * any target not on the list. Mail seen at Infomaniak (0161 T2) puts it back
 * on the list, and then these cases fail, as they should.
 */
describe('an Infomaniak target, written as a Nextcloud one is (workplan 0161, 2026-11-20)', () => {
  const mailsGuests = mailsGuestsItself('infomaniak');

  it('is not a target the writers treat as one that mails guests', () => {
    expect(mailsGuests).toBe(false);
  });

  it('gets a first copy with its guest and organiser, each marked SCHEDULE-AGENT=CLIENT', async () => {
    const t = target(undefined);
    const atSource = WITH_GUESTS.replace(/;SCHEDULE-AGENT=CLIENT/g, '');

    await writer(t.client, mailsGuests).upsertCalendarEvent(CALENDAR, {
      item: { uid: 'evt-1', type: 'event', summary: 'A meeting', start: '', etag: 'e1', sourcePath: '', icalendar: atSource },
      icalendar: atSource,
    });

    const body = t.sent('PUT')[0]?.body;
    expect(body).toContain('\r\nORGANIZER;SCHEDULE-AGENT=CLIENT;CN=Someone:mailto:organiser@example.org\r\n');
    expect(body).toContain('\r\nATTENDEE;SCHEDULE-AGENT=CLIENT;CN=A Guest:mailto:guest@example.org\r\n');
    expect(body).not.toContain('COMMENT:');
  });

  it('rewrites a copy that lists guests with its guests kept, and reads nothing first', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    const result = await rewrite(writer(t.client, mailsGuests));

    expect(result).toMatchObject({ targetId: EVENT, created: false, updated: true });
    expect(t.sent('GET')).toHaveLength(0);
    const [put] = t.sent('PUT');
    expect(put?.headers?.['If-Match']).toBe('"v1"');
    expect(put?.body).toContain('SUMMARY:A meeting, moved');
    expect(put?.body).toContain('\r\nATTENDEE;CN=A Guest;SCHEDULE-AGENT=CLIENT:mailto:guest@example.org\r\n');
  });

  it('removes a copy that lists guests, a task as an event, and reads nothing first', async () => {
    for (const domain of ['calendar', 'task'] as const) {
      const body = domain === 'task' ? WITH_GUESTS.replace(/VEVENT/g, 'VTODO') : WITH_GUESTS;
      const t = target({ body, etag: 'v1' });

      const result = await writer(t.client, mailsGuests, domain).removeItem(EVENT, { expectedTargetVersion: 'v1' });

      expect(result, domain).toEqual({ kind: 'deleted' });
      expect(t.sent('GET'), domain).toHaveLength(0);
      expect(t.sent('DELETE'), domain).toHaveLength(1);
      expect(t.held(), domain).toBeUndefined();
    }
  });
});

/**
 * A CIRRUX TARGET IS WRITTEN AS A NEXTCLOUD ONE IS, AGAIN (workplan 0160;
 * ADR-0043, amended 2026-11-20). `cirrux` was on `TARGETS_THAT_MAIL_GUESTS`
 * from 2026-11-19, on the evidence of the invitations it mailed, until that
 * amendment took it off, on Cirrux's word that its server now keeps to
 * `SCHEDULE-AGENT=CLIENT` and on the owner's test of it (0160 §4). Its writers
 * are told nothing, as Nextcloud's are: they keep each guest and the
 * organiser, marked, read nothing first, and rewrite and remove a copy that
 * lists guests as at any target not on the list. A copy written while it was
 * on the list names its guests in comments, and gets them back at its next
 * rewrite. Mail seen at Cirrux puts it back on the list, and then these cases
 * fail, as they should.
 */
describe('a Cirrux target, written as a Nextcloud one is again (workplan 0160, 2026-11-20)', () => {
  const mailsGuests = mailsGuestsItself('cirrux');

  it('is not a target the writers treat as one that mails guests', () => {
    expect(mailsGuests).toBe(false);
  });

  it('gets a first copy with its guest and organiser, each marked SCHEDULE-AGENT=CLIENT', async () => {
    const t = target(undefined);
    const atSource = WITH_GUESTS.replace(/;SCHEDULE-AGENT=CLIENT/g, '');

    await writer(t.client, mailsGuests).upsertCalendarEvent(CALENDAR, {
      item: { uid: 'evt-1', type: 'event', summary: 'A meeting', start: '', etag: 'e1', sourcePath: '', icalendar: atSource },
      icalendar: atSource,
    });

    const body = t.sent('PUT')[0]?.body;
    expect(body).toContain('\r\nORGANIZER;SCHEDULE-AGENT=CLIENT;CN=Someone:mailto:organiser@example.org\r\n');
    expect(body).toContain('\r\nATTENDEE;SCHEDULE-AGENT=CLIENT;CN=A Guest:mailto:guest@example.org\r\n');
    expect(body).not.toContain('COMMENT:');
  });

  it('rewrites a copy that lists guests with its guests kept, and reads nothing first', async () => {
    const t = target({ body: WITH_GUESTS, etag: 'v1' });

    const result = await rewrite(writer(t.client, mailsGuests));

    expect(result).toMatchObject({ targetId: EVENT, created: false, updated: true });
    expect(t.sent('GET')).toHaveLength(0);
    const [put] = t.sent('PUT');
    expect(put?.headers?.['If-Match']).toBe('"v1"');
    expect(put?.body).toContain('SUMMARY:A meeting, moved');
    expect(put?.body).toContain('\r\nATTENDEE;CN=A Guest;SCHEDULE-AGENT=CLIENT:mailto:guest@example.org\r\n');
  });

  it('gives a copy written while it was on the list its guests back at its next rewrite, the comments gone', async () => {
    const t = target({ body: WITHOUT_GUESTS, etag: 'v1' });

    const result = await rewrite(writer(t.client, mailsGuests));

    expect(result).toMatchObject({ targetId: EVENT, created: false, updated: true });
    const [put] = t.sent('PUT');
    expect(put?.headers?.['If-Match']).toBe('"v1"');
    expect(put?.body).toContain('\r\nORGANIZER;CN=Someone;SCHEDULE-AGENT=CLIENT:mailto:organiser@example.org\r\n');
    expect(put?.body).toContain('\r\nATTENDEE;CN=A Guest;SCHEDULE-AGENT=CLIENT:mailto:guest@example.org\r\n');
    expect(put?.body).not.toContain('COMMENT:');
  });

  it('removes a copy that lists guests, a task as an event, and reads nothing first', async () => {
    for (const domain of ['calendar', 'task'] as const) {
      const body = domain === 'task' ? WITH_GUESTS.replace(/VEVENT/g, 'VTODO') : WITH_GUESTS;
      const t = target({ body, etag: 'v1' });

      const result = await writer(t.client, mailsGuests, domain).removeItem(EVENT, { expectedTargetVersion: 'v1' });

      expect(result, domain).toEqual({ kind: 'deleted' });
      expect(t.sent('GET'), domain).toHaveLength(0);
      expect(t.sent('DELETE'), domain).toHaveLength(1);
      expect(t.held(), domain).toBeUndefined();
    }
  });
});
