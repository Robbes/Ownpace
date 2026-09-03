// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The probe-qualified record (0106 T0) — what must hold: yes needs an
 * answer, NO also needs an answer (a refusal is never a no), everything
 * else is unknown WITH WORDS, and the scheduling verdict rides only a
 * calendar face that actually answered.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isDropboxKind,
  isQualifiableKind,
  qualifyDropbox,
  qualifyAccount,
  qualifyGoogleGrant,
  qualificationReportLines,
  volumeSentence,
} from './account-qualification.ts';

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
      // The count rides as DATA beside the sentence (2026-09-02), in the unit
      // a screen words — the one multistatus entry is a calendar and an
      // address book at once.
      expect(q?.domains.calendar).toMatchObject({ count: 1, unit: 'calendar' });
      expect(q?.domains.contact).toMatchObject({ count: 1, unit: 'addressBook' });
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
      expect(q?.domains.mail).toMatchObject({ answer: 'yes', detail: '2 folders visible.' });
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
    expect(q?.domains.mail).toMatchObject({ answer: 'yes', detail: '3 folders visible.' });
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

describe('the Dropbox account: one face, two answers (2026-09-02)', () => {
  const dropboxFetch = (options: { refuseListing?: boolean; refuseUsage?: boolean } = {}) =>
    vi.fn(async (url: string, init?: { body?: string }) => {
      const answer = (payload: unknown, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      });
      if (url.includes('/oauth2/token')) {
        return answer({ access_token: 'at', token_type: 'bearer', expires_in: 14400 });
      }
      if (url.endsWith('/files/list_folder')) {
        if (options.refuseListing) return answer({ error_summary: 'invalid_access_token/' }, 401);
        return answer({
          entries: [
            { '.tag': 'folder', id: 'id:1', name: 'Docs', path_display: '/Docs' },
            { '.tag': 'folder', id: 'id:2', name: 'Photos', path_display: '/Photos' },
            { '.tag': 'file', id: 'id:3', name: 'x.txt', path_display: '/x.txt', size: 1 },
          ],
          cursor: 'c',
          has_more: false,
        });
      }
      if (url.endsWith('/users/get_space_usage')) {
        if (options.refuseUsage) return answer({ error_summary: 'missing_scope/account_info.read' }, 401);
        return answer({ used: 48_000_000, allocation: { '.tag': 'individual', allocated: 2e12 } });
      }
      throw new Error(`the qualifier asked ${url}${init?.body ? ` with ${init.body}` : ''}`);
    });
  const DROPBOX_CREDS = { clientId: 'app-key', clientSecret: 'app-secret', refreshToken: 'refresh' };

  it('files: yes with the top-level count AND the bytes in use; the other three faces a measured no', async () => {
    vi.stubGlobal('fetch', dropboxFetch());
    try {
      const q = await qualifyDropbox('dropbox', { rootPath: '' }, DROPBOX_CREDS);
      expect(q).toBeDefined();
      expect(q!.domains.file).toMatchObject({
        answer: 'yes',
        count: 3,
        unit: 'folder',
        volume: { bytes: 48_000_000 },
      });
      expect(q!.domains.file.detail).toBe('3 folders at the top level.');
      for (const face of ['mail', 'calendar', 'contact'] as const) {
        expect(q!.domains[face].answer, face).toBe('no');
        expect(q!.domains[face].detail).toContain('A Dropbox carries files only');
      }
      // No scheduling verdict: nothing here writes calendar objects.
      expect(q!.scheduling).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a refused listing is UNKNOWN carrying the refusal — never a no, and never a crash', async () => {
    vi.stubGlobal('fetch', dropboxFetch({ refuseListing: true }));
    try {
      const q = await qualifyDropbox('dropbox', {}, DROPBOX_CREDS);
      expect(q!.domains.file.answer).toBe('unknown');
      expect(q!.domains.file.detail).toContain('Unmeasured');
      expect(q!.domains.file.detail).toContain('401');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a listing that answers while the usage is refused keeps the yes, and says the measure failed', async () => {
    vi.stubGlobal('fetch', dropboxFetch({ refuseUsage: true }));
    try {
      const q = await qualifyDropbox('dropbox', {}, DROPBOX_CREDS);
      expect(q!.domains.file.answer).toBe('yes');
      expect(q!.domains.file.count).toBe(3);
      expect(q!.domains.file.volume?.bytes).toBeUndefined();
      expect(q!.domains.file.volume?.failed).toContain('space usage');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the deployment's own Dropbox app where the row stores no pair (ADR-0041)", async () => {
    vi.stubEnv('DROPBOX_OAUTH_CLIENT_ID', 'deployment-app-key');
    vi.stubEnv('DROPBOX_OAUTH_CLIENT_SECRET', 'deployment-app-secret');
    const fetchMock = dropboxFetch();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const q = await qualifyDropbox('dropbox', {}, { refreshToken: 'refresh' });
      expect(q!.domains.file.answer).toBe('yes');
      const exchange = fetchMock.mock.calls.find(([url]) => String(url).includes('/oauth2/token'));
      expect(String(exchange![1]?.body)).toContain('client_id=deployment-app-key');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('answers nothing for any other kind — the Google and Basic-auth halves keep theirs', async () => {
    expect(await qualifyDropbox('gmail', {}, DROPBOX_CREDS)).toBeUndefined();
    expect(await qualifyDropbox('box', {}, DROPBOX_CREDS)).toBeUndefined();
    expect(isDropboxKind('dropbox')).toBe(true);
    expect(isDropboxKind('google_drive')).toBe(false);
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
      const q = await qualifyGoogleGrant('google_calendar', GOOGLE_CREDS, { tokenEndpoint: 'https://stub/token' });
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
      const q = await qualifyGoogleGrant('google_drive', GOOGLE_CREDS, { tokenEndpoint: 'https://stub/token' });
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
      const q = await qualifyGoogleGrant('gmail', GOOGLE_CREDS, { tokenEndpoint: 'https://stub/token' });
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
        { tokenEndpoint: 'https://stub/token' },
      );
      expect(q?.domains.file.answer).toBe('unknown');
      expect(q?.domains.file.detail).toContain('admin console');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('missing refresh token is unknown naming the gap; a non-Google kind is not this half\'s to answer', async () => {
    const q = await qualifyGoogleGrant('gmail', { clientId: 'cid' }, { tokenEndpoint: 'https://stub/token' });
    expect(q?.domains.mail.answer).toBe('unknown');
    expect(q?.domains.mail.detail).toContain('refreshToken');
    expect(await qualifyGoogleGrant('imap', GOOGLE_CREDS, { tokenEndpoint: 'https://stub/token' })).toBeUndefined();
  });
});

describe('the grant, REACHED: each carried face is asked as a pass would ask it (owner 2026-09-02)', () => {
  // The owner's first Google account connection tested "5 calendars visible"
  // and said nothing about the three other faces it had just been granted:
  // the grant half read the scopes and stopped. A face whose API was off in
  // the client's project passed Test and would have failed at the first
  // migration.
  const GOOGLE_CREDS = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' };
  const CAL = 'https://www.googleapis.com/auth/calendar';
  const CARD = 'https://www.googleapis.com/auth/carddav';
  const MAIL = 'https://mail.google.com/';
  const DRIVE = 'https://www.googleapis.com/auth/drive.readonly';
  const grantOf = (scope: string) =>
    vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'at', scope }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  const listing = (n: number) => ({ listFolders: async () => Array.from({ length: n }, (_, i) => i) });

  it('counts ride each carried face in the unit a screen words; a face the grant does not carry is never asked', async () => {
    vi.stubGlobal('fetch', grantOf(`${CAL} ${CARD}`));
    const asked: string[] = [];
    const listable = vi.fn(
      (domain: string, _user: string, _creds: unknown, _config: unknown) => {
        asked.push(domain);
        return domain === 'calendar' ? listing(5) : listing(2);
      },
    );
    try {
      const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
        tokenEndpoint: 'https://stub/token',
        reach: { user: 'owner@example.com', listable },
      });
      expect(q?.domains.calendar).toMatchObject({ answer: 'yes', count: 5, unit: 'calendar' });
      expect(q?.domains.calendar.detail).toContain('5 calendars visible');
      expect(q?.domains.contact).toMatchObject({ answer: 'yes', count: 2, unit: 'addressBook' });
      expect(q?.domains.contact.detail).toContain('2 address books visible');
      // Not carried: a measured no as before, and the face was never asked.
      expect(q?.domains.mail.answer).toBe('no');
      expect(q?.domains.file.answer).toBe('no');
      expect(asked.sort()).toEqual(['calendar', 'contact']);
      // The reach starts from the account address and the stored trio.
      expect(listable.mock.calls[0]?.[1]).toBe('owner@example.com');
      expect(listable.mock.calls[0]?.[2]).toMatchObject({ clientId: 'cid', refreshToken: 'rt' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a carried face that refuses is UNKNOWN with the refusal's words — never a no, never a yes on the strength of the scope", async () => {
    vi.stubGlobal('fetch', grantOf(`${CAL} ${CARD}`));
    const listable = (domain: string) =>
      domain === 'calendar'
        ? {
            listFolders: async () => {
              throw new Error(
                'PROPFIND failed with status 403: accessNotConfigured — CalDAV API has not ' +
                  'been used in project 123 before or it is disabled. Enable it by visiting ' +
                  'https://console.developers.google.com/apis/api/caldav.googleapis.com/overview?project=123 then retry.',
              );
            },
          }
        : listing(1);
    try {
      const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
        tokenEndpoint: 'https://stub/token',
        reach: { user: 'owner@example.com', listable },
      });
      expect(q?.domains.calendar.answer).toBe('unknown');
      expect(q?.domains.calendar.detail).toContain('accessNotConfigured');
      expect(q?.domains.calendar.detail).toContain('caldav.googleapis.com');
      expect(q?.domains.calendar.detail).toContain(CAL);
      expect(q?.domains.calendar.count).toBeUndefined();
      // The neighbour that answered is unaffected.
      expect(q?.domains.contact).toMatchObject({ answer: 'yes', count: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('mail and files count folders; all four faces are reached when all four are carried', async () => {
    vi.stubGlobal('fetch', grantOf(`${MAIL} ${CAL} ${CARD} ${DRIVE}`));
    const listable = (domain: string) =>
      ({ mail: listing(14), calendar: listing(5), contact: listing(2), file: listing(3) })[domain]!;
    try {
      const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
        tokenEndpoint: 'https://stub/token',
        reach: { user: 'owner@example.com', listable },
      });
      expect(q?.domains.mail).toMatchObject({ answer: 'yes', count: 14, unit: 'folder' });
      expect(q?.domains.file).toMatchObject({ answer: 'yes', count: 3, unit: 'folder' });
      expect(q?.domains.calendar).toMatchObject({ answer: 'yes', count: 5, unit: 'calendar' });
      expect(q?.domains.contact).toMatchObject({ answer: 'yes', count: 2, unit: 'addressBook' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without a reach the grant is read as before: yes on the scope, and no count to word', async () => {
    vi.stubGlobal('fetch', grantOf(CAL));
    try {
      const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, { tokenEndpoint: 'https://stub/token' });
      expect(q?.domains.calendar).toMatchObject({ answer: 'yes', detail: `The grant carries ${CAL}.` });
      expect(q?.domains.calendar.count).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the reach MEASURES each face it reached (owner 2026-09-02: GB in Drive, contacts, GB of mail)', () => {
  const GOOGLE_CREDS = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' };
  const ALL =
    'https://mail.google.com/ https://www.googleapis.com/auth/calendar ' +
    'https://www.googleapis.com/auth/carddav https://www.googleapis.com/auth/drive.readonly';
  const grantOf = (scope: string) =>
    vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'at', scope }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  const folders = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}` }));

  it('mail: messages and bytes with the estimate flag; contacts: cards over every address book; files: Drive usage — calendar claims nothing', async () => {
    vi.stubGlobal('fetch', grantOf(ALL));
    const listSince = vi.fn(async () => ({ items: [1, 2, 3], nextCursor: { value: '' } }));
    const sources: Record<string, unknown> = {
      mail: {
        listFolders: async () => folders(29),
        measureMailbox: async () => ({ folders: 29, messages: 12400, bytes: 3_400_000_000, estimated: true }),
      },
      calendar: { listFolders: async () => folders(5) },
      contact: { listFolders: async () => folders(2), listSince },
      file: {
        listFolders: async () => folders(6),
        storageUsage: async () => ({ bytes: 1_900_000_000, trashBytes: 0, nativeFilesExcluded: true }),
      },
    };
    try {
      const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
        tokenEndpoint: 'https://stub/token',
        reach: { user: 'owner@example.com', listable: (domain: string) => sources[domain] as never },
      });
      expect(q?.domains.mail).toMatchObject({
        answer: 'yes',
        count: 29,
        volume: { items: 12400, bytes: 3_400_000_000, estimated: true },
      });
      expect(q?.domains.contact).toMatchObject({ answer: 'yes', count: 2, volume: { items: 6 } });
      expect(listSince).toHaveBeenCalledTimes(2);
      expect(q?.domains.file).toMatchObject({
        answer: 'yes',
        count: 6,
        volume: { bytes: 1_900_000_000, nativeFilesExcluded: true },
      });
      expect(q?.domains.calendar).toMatchObject({ answer: 'yes', count: 5 });
      expect(q?.domains.calendar.volume).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a measure that fails does not take the yes away — the listing is the evidence, and the failure is said in the sentence', async () => {
    vi.stubGlobal('fetch', grantOf('https://mail.google.com/'));
    const source = {
      listFolders: async () => folders(3),
      measureMailbox: async () => {
        throw new Error('FETCH timed out');
      },
    };
    try {
      const q = await qualifyGoogleGrant('gmail', GOOGLE_CREDS, {
        tokenEndpoint: 'https://stub/token',
        reach: { user: 'owner@example.com', listable: () => source as never },
      });
      expect(q?.domains.mail).toMatchObject({ answer: 'yes', count: 3 });
      // The failure is DATA beside the yes, for a screen to show on a phone.
      expect(q?.domains.mail.volume).toEqual({ failed: 'FETCH timed out' });
      expect(q?.domains.mail.detail).not.toContain('not measured');
      expect(
        qualificationReportLines(q!)[0],
      ).toContain('Measured: not measured — FETCH timed out.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a source that offers no measure is listed and not measured — no volume is claimed', async () => {
    vi.stubGlobal('fetch', grantOf('https://www.googleapis.com/auth/drive.readonly'));
    try {
      const q = await qualifyGoogleGrant('google_drive', GOOGLE_CREDS, {
        tokenEndpoint: 'https://stub/token',
        reach: { user: '', listable: () => ({ listFolders: async () => folders(1) }) },
      });
      expect(q?.domains.file).toMatchObject({ answer: 'yes', count: 1 });
      expect(q?.domains.file.volume).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the appliance's report lines carry the volume in English, ≈ only when estimated", () => {
    expect(volumeSentence('mail', { items: 12400, bytes: 3_400_000_000, estimated: true })).toBe(
      '12400 messages, ≈ 3.2 GB',
    );
    expect(volumeSentence('contact', { items: 1 })).toBe('1 card');
    expect(volumeSentence('file', { bytes: 1_900_000_000, nativeFilesExcluded: true })).toBe(
      '1.8 GB, Docs, Sheets and Slides not counted',
    );
    const lines = qualificationReportLines({
      domains: {
        mail: { answer: 'yes', detail: 'x', volume: { items: 2, bytes: 2048 } },
        calendar: { answer: 'yes', detail: 'x' },
        contact: { answer: 'no', detail: 'x' },
        file: { answer: 'unknown', detail: 'x' },
      },
    });
    expect(lines[0]).toBe('Email ✓: x Measured: 2 messages, 2.0 KB.');
    expect(lines[1]).toBe('Calendar ✓: x');
  });
});
