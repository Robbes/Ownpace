// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The probe-qualified record (0106 T0) — what must hold: yes needs an
 * answer, NO also needs an answer (a refusal is never a no), everything
 * else is unknown WITH WORDS, and the scheduling verdict rides only a
 * calendar face that actually answered.
 */

import { describe, it, expect, vi } from 'vitest';
import { isQualifiableKind, qualifyAccount, qualifyGoogleGrant } from './account-qualification.ts';

const CREDS = { username: 'probe', password: 'pw' };
const DAV_CONFIG = { url: 'https://dav.example.net/dav/' };

/** One entry that is at once a calendar and an address book, carrying every
 *  home set a discovery hop could ask for — the all-purpose multistatus. */
const MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/things/probe/x/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal><d:href>/dav/principals/probe/</d:href></d:current-user-principal>
        <card:addressbook-home-set><d:href>/dav/addressbooks/probe/</d:href></card:addressbook-home-set>
        <cal:calendar-home-set><d:href>/dav/calendars/probe/</d:href></cal:calendar-home-set>
        <d:resourcetype><d:collection/><card:addressbook/><cal:calendar/></d:resourcetype>
        <d:displayname>x</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

type FetchInit = { method?: string; body?: string };

const davAnsweringFetch = (options?: { refuseCalendarFace?: boolean }) =>
  vi.fn(async (url: string, init?: FetchInit) => {
    if (init?.method === 'OPTIONS') {
      return new Response('', {
        status: 200,
        headers: { DAV: '1, 2, calendar-access, calendar-auto-schedule' },
      });
    }
    const asksCalendar =
      String(init?.body ?? '').includes('calendar-home-set') || url.includes('/calendars');
    if (options?.refuseCalendarFace && asksCalendar) {
      return new Response('unauthorized', { status: 401 });
    }
    return new Response(MULTISTATUS, {
      status: 207,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    });
  });

describe('the DAV family: three faces from one credential', () => {
  it('an account that answers everywhere is yes/yes/yes, mail unmeasured with words, scheduling folded in', async () => {
    vi.stubGlobal('fetch', davAnsweringFetch());
    try {
      const q = await qualifyAccount('caldav', DAV_CONFIG, CREDS);
      expect(q?.domains.calendar.answer).toBe('yes');
      expect(q?.domains.contact.answer).toBe('yes');
      expect(q?.domains.file.answer).toBe('yes');
      // Not askable is UNKNOWN with the remedy, never a quiet no.
      expect(q?.domains.mail.answer).toBe('unknown');
      expect(q?.domains.mail.detail).toContain('no mail server address');
      // The 0105 verdict rides the calendar face it belongs to.
      expect(q?.scheduling?.capability).toBe('auto-schedule');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('kind soverin is DAV-shaped here: the same three faces from the one app-password (0106 T4a)', async () => {
    vi.stubGlobal('fetch', davAnsweringFetch());
    try {
      const q = await qualifyAccount('soverin', DAV_CONFIG, CREDS);
      expect(q?.domains.calendar.answer).toBe('yes');
      expect(q?.domains.contact.answer).toBe('yes');
      expect(q?.domains.file.answer).toBe('yes');
      // No stored mail server: unmeasured, with the remedy ON the sentence.
      expect(q?.domains.mail.answer).toBe('unknown');
      expect(q?.domains.mail.detail).toContain('mailHost');
      expect(q?.scheduling?.capability).toBe('auto-schedule');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a soverin account that NAMES its mail server gets the mail face measured too (0106 T4b)', async () => {
    vi.stubGlobal('fetch', davAnsweringFetch());
    const asked: Array<Record<string, unknown>> = [];
    try {
      const q = await qualifyAccount(
        'soverin',
        { ...DAV_CONFIG, mailHost: 'imap.example.net', mailPort: 993 },
        CREDS,
        {
          imapListable: (cfg) => {
            asked.push(cfg);
            return { listFolders: async () => ['INBOX', 'Sent'] };
          },
        },
      );
      expect(q?.domains.mail).toEqual({ answer: 'yes', detail: '2 folders visible.' });
      // The face was asked at the STORED mail host, not the DAV endpoint.
      expect(asked[0]?.host).toBe('imap.example.net');
      // The DAV faces are unchanged beside it.
      expect(q?.domains.calendar.answer).toBe('yes');
      expect(q?.domains.contact.answer).toBe('yes');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a refused mail listing on a soverin account stays UNKNOWN — never a no', async () => {
    vi.stubGlobal('fetch', davAnsweringFetch());
    try {
      const q = await qualifyAccount(
        'soverin',
        { ...DAV_CONFIG, mailHost: 'imap.example.net' },
        CREDS,
        {
          imapListable: () => ({
            listFolders: async () => {
              throw new Error('LOGIN failed');
            },
          }),
        },
      );
      expect(q?.domains.mail.answer).toBe('unknown');
      expect(q?.domains.mail.detail).toContain('LOGIN failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a per-protocol app-password shows as UNKNOWN on the refused face — never as no (the Soverin scenario)', async () => {
    vi.stubGlobal('fetch', davAnsweringFetch({ refuseCalendarFace: true }));
    try {
      const q = await qualifyAccount('webdav', DAV_CONFIG, CREDS);
      // The refused face: a 401 may be scoping, not absence.
      expect(q?.domains.calendar.answer).toBe('unknown');
      expect(q?.domains.calendar.detail).toContain('Unmeasured');
      // The other faces still answered.
      expect(q?.domains.contact.answer).toBe('yes');
      expect(q?.domains.file.answer).toBe('yes');
      // No verdict about a calendar nobody reached.
      expect(q?.scheduling).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the IMAP face', () => {
  it('a listing that answers is yes with a count; the DAV faces say why they were not measured', async () => {
    const q = await qualifyAccount(
      'imap',
      { host: 'imap.example.net', port: 993 },
      CREDS,
      { imapListable: () => ({ listFolders: async () => ['INBOX', 'Sent', 'Archive'] }) },
    );
    expect(q?.domains.mail).toEqual({ answer: 'yes', detail: '3 folders visible.' });
    expect(q?.domains.calendar.answer).toBe('unknown');
    expect(q?.domains.calendar.detail).toContain('no DAV address');
  });

  it('a refused listing is UNKNOWN carrying the refusal, never no', async () => {
    const q = await qualifyAccount('imap', { host: 'imap.example.net' }, CREDS, {
      imapListable: () => ({
        listFolders: async () => {
          throw new Error('LOGIN failed');
        },
      }),
    });
    expect(q?.domains.mail.answer).toBe('unknown');
    expect(q?.domains.mail.detail).toContain('LOGIN failed');
  });
});

describe('the JMAP face: the one place an honest NO exists', () => {
  it('an answered session yields measured yes AND measured no from its capability list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {} } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    try {
      const q = await qualifyAccount('jmap', { baseUrl: 'https://mail.example.net' }, CREDS);
      expect(q?.domains.mail.answer).toBe('yes');
      // The session ANSWERED and left contacts out — that is a measured no.
      expect(q?.domains.contact.answer).toBe('no');
      expect(q?.domains.contact.detail).toContain('does not advertise');
      // A fact about US, stated as ours.
      expect(q?.domains.calendar.answer).toBe('no');
      expect(q?.domains.calendar.detail).toContain('not carried over JMAP by this product');
      // No capability announces files; unmeasured stays unmeasured.
      expect(q?.domains.file.answer).toBe('unknown');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a session that refuses leaves EVERY domain unknown — a 401 enumerates nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    try {
      const q = await qualifyAccount('jmap', { baseUrl: 'https://mail.example.net' }, CREDS);
      for (const domain of ['mail', 'calendar', 'contact', 'file'] as const) {
        expect(q?.domains[domain].answer).toBe('unknown');
      }
      expect(q?.domains.mail.detail).toContain('401');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the boundary', () => {
  it('covers exactly the Basic-auth account families; OAuth kinds are grant-qualified (T1), not probed', async () => {
    for (const kind of ['caldav', 'carddav', 'webdav', 'nextcloud', 'soverin', 'imap', 'jmap']) {
      expect(isQualifiableKind(kind), kind).toBe(true);
    }
    for (const kind of ['gmail', 'google_drive', 'google_calendar', 'o365', 'dropbox', 'box']) {
      expect(isQualifiableKind(kind), kind).toBe(false);
      expect(await qualifyAccount(kind, {}, CREDS)).toBeUndefined();
    }
  });
});

describe('the grant-qualified half: what a stored Google grant carries (0106 T1a)', () => {
  const GOOGLE_CREDS = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' };

  it('an answered exchange yields measured yes AND measured no, with the re-consent remedy', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) =>
      new Response(
        JSON.stringify({
          access_token: 'at',
          scope:
            'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/carddav',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const q = await qualifyGoogleGrant('google_calendar', GOOGLE_CREDS, 'https://stub/token');
      expect(q?.domains.calendar.answer).toBe('yes');
      expect(q?.domains.contact.answer).toBe('yes');
      // Absent from an enumeration that ARRIVED — a measured no, and the
      // remedy is the grant world's own: asking is granting.
      expect(q?.domains.mail.answer).toBe('no');
      expect(q?.domains.mail.detail).toContain('re-consent');
      expect(q?.domains.file.answer).toBe('no');
      // The exchange went to the given endpoint with the stored trio.
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://stub/token');
      const sent = String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
      expect(sent).toContain('grant_type=refresh_token');
      expect(sent).toContain('client_id=cid');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the broader drive scope also satisfies the file domain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ scope: 'https://www.googleapis.com/auth/drive' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    try {
      const q = await qualifyGoogleGrant('google_drive', GOOGLE_CREDS, 'https://stub/token');
      expect(q?.domains.file.answer).toBe('yes');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a refused exchange enumerates nothing: every domain unknown, carrying Google\'s words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );
    try {
      const q = await qualifyGoogleGrant('gmail', GOOGLE_CREDS, 'https://stub/token');
      for (const domain of ['mail', 'calendar', 'contact', 'file'] as const) {
        expect(q?.domains[domain].answer).toBe('unknown');
        expect(q?.domains[domain].detail).toContain('invalid_grant');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a service-account key is unknown-with-words and never exchanged — its scopes live in the admin console', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const q = await qualifyGoogleGrant(
        'google_drive',
        { serviceAccountKey: '{"type":"service_account"}' },
        'https://stub/token',
      );
      expect(q?.domains.file.answer).toBe('unknown');
      expect(q?.domains.file.detail).toContain('admin console');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('missing refresh token is unknown naming the gap; a non-Google kind is not this half\'s to answer', async () => {
    const q = await qualifyGoogleGrant('gmail', { clientId: 'cid' }, 'https://stub/token');
    expect(q?.domains.mail.answer).toBe('unknown');
    expect(q?.domains.mail.detail).toContain('refreshToken');
    expect(await qualifyGoogleGrant('imap', GOOGLE_CREDS, 'https://stub/token')).toBeUndefined();
  });
});
