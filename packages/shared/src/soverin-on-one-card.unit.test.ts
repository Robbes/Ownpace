// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * SOVERIN, PERSONAL AND SUITE, ON ONE CARD (workplan 0175 T1, T2's shape).
 *
 * The published servers a personal mailbox is pinned to, the record the Test
 * keeps of which kind of mailbox answered, and the one seam every DAV face
 * asks for its login. Suite's half waits for the maintainer's live test (T0):
 * nothing here writes the kind `suite`, but the seams already answer for it,
 * so T0's pull request is a rule and not a reshaping.
 */

import { describe, it, expect } from 'vitest';
import {
  DAV_LOGIN_APART_KINDS,
  SUITE_LOGIN_KEYS,
  davLoginOf,
  signsInToDavApart,
} from './provider-accounts.ts';
import {
  PROVIDER_ENDPOINTS,
  pinnedToPublished,
  pinsItsServer,
  publishedEndpoint,
  publishedServerHosts,
} from './provider-endpoints.ts';
import { davConfigOf, soverinRecordOf } from './soverin-record.ts';

const ARTICLE_26 =
  'https://soverin.zammad.com/help/en-gb/15-calendar-contacts/26-calendar-and-contacts-app-setup';
const ARTICLE_38 =
  'https://soverin.zammad.com/help/en-gb/12-email-apps-and-imap/38-imap-and-smtp-settings';

describe("Soverin's personal servers, pinned and cited (T1, §5.1)", () => {
  it('names caldav.soverin.net for calendars and contacts and imap.soverin.net:993 for mail, from articles 26 and 38', () => {
    const soverin = PROVIDER_ENDPOINTS.soverin;
    expect(soverin?.calendar).toEqual({ host: 'caldav.soverin.net' });
    expect(soverin?.contact).toEqual({ host: 'caldav.soverin.net' });
    expect(soverin?.email).toEqual({ host: 'imap.soverin.net', port: 993 });
    expect(soverin?.sources.map((s) => s.url)).toEqual([ARTICLE_26, ARTICLE_38]);
  });

  it('is asked at the door, so the table is no fallback for a row (doorAsks), only where a password is pinned', () => {
    expect(PROVIDER_ENDPOINTS.soverin?.doorAsks).toBe(true);
    expect(publishedEndpoint('soverin', 'calendar')).toBeUndefined();
    expect(pinsItsServer('soverin')).toBe(true);
    expect(publishedServerHosts('soverin')).toEqual(['imap.soverin.net', 'caldav.soverin.net']);
  });

  it("a grant link's password goes to Soverin's own servers, whatever host the row was typed with", () => {
    const pinned = pinnedToPublished('soverin', {
      host: 'dav.elsewhere.example',
      port: 8443,
      mailHost: 'imap.elsewhere.example',
      mailPort: 143,
      useSsl: false,
    });
    expect(pinned).toEqual({
      host: 'caldav.soverin.net',
      port: 443,
      mailHost: 'imap.soverin.net',
      mailPort: 993,
    });
  });
});

const MEASURED_AT = '2026-11-27T10:00:00.000Z';

describe('the record of which kind answered (T2, §5.4)', () => {
  it('reads a well-formed record off a qualification', () => {
    const record = soverinRecordOf({
      domains: {},
      soverin: {
        kind: 'personal',
        davRoot: 'https://caldav.soverin.net/',
        principal: '/principals/<mailbox>/',
        measuredAt: MEASURED_AT,
      },
    });
    expect(record).toEqual({
      kind: 'personal',
      davRoot: 'https://caldav.soverin.net/',
      principal: '/principals/<mailbox>/',
      measuredAt: MEASURED_AT,
    });
  });

  it('a row tested before T2 has no record, and neither has a malformed one: never guessed', () => {
    expect(soverinRecordOf(null)).toBeUndefined();
    expect(soverinRecordOf({ domains: {} })).toBeUndefined();
    expect(soverinRecordOf({ soverin: { kind: 'business', measuredAt: MEASURED_AT } })).toBeUndefined();
    expect(soverinRecordOf({ soverin: { kind: 'personal' } })).toBeUndefined();
    expect(soverinRecordOf({ soverin: 'personal' })).toBeUndefined();
  });

  it("the DAV writers go to the root that answered for a soverin row, and to the typed host for a row tested before", () => {
    const config = { host: 'caldav.soverin.net', port: 443, mailHost: 'imap.soverin.net', mailPort: 993 };
    const answered = {
      soverin: { kind: 'personal', davRoot: 'https://caldav.soverin.net/', measuredAt: MEASURED_AT },
    };
    expect(davConfigOf('soverin', config, answered)).toEqual({
      url: 'https://caldav.soverin.net/',
      mailHost: 'imap.soverin.net',
      mailPort: 993,
    });
    // Tested before T2: `config.host`, as it was tested with (D6 measures it at its next pass).
    expect(davConfigOf('soverin', config, { domains: {} })).toEqual(config);
    // Unknown names no server: the row as it was typed, never a guess.
    expect(
      davConfigOf('soverin', config, { soverin: { kind: 'unknown', reason: 'x', measuredAt: MEASURED_AT } }),
    ).toEqual(config);
    // Any other kind is untouched, whatever its record holds.
    expect(davConfigOf('nextcloud', config, answered)).toEqual(config);
  });
});

describe('the login a DAV face signs in with (T2, §5.3)', () => {
  const creds = {
    username: '<mailbox>',
    password: 'mailbox-password',
    suiteUsername: 'user-code',
    suitePassword: 'suite-app-password',
  };

  it('is per account, not per kind: only Soverin signs in to DAV apart, and only once Suite was found', () => {
    expect(DAV_LOGIN_APART_KINDS).toEqual(['soverin']);
    expect(SUITE_LOGIN_KEYS).toEqual(['suiteUsername', 'suitePassword']);
    expect(signsInToDavApart('soverin')).toBe(true);
    expect(signsInToDavApart('infomaniak')).toBe(false);
  });

  it('a personal mailbox signs in with the mailbox login', () => {
    const q = { soverin: { kind: 'personal', measuredAt: MEASURED_AT } };
    expect(davLoginOf('soverin', q, creds)).toEqual({ username: '<mailbox>', password: 'mailbox-password' });
  });

  it('a Suite mailbox signs in with the Suite login, never the mailbox password', () => {
    const q = { soverin: { kind: 'suite', measuredAt: MEASURED_AT } };
    expect(davLoginOf('soverin', q, creds)).toEqual({ username: 'user-code', password: 'suite-app-password' });
  });

  it('a Suite mailbox with no Suite login stored answers empty halves, which a seam refuses by name', () => {
    const q = { soverin: { kind: 'suite', measuredAt: MEASURED_AT } };
    expect(davLoginOf('soverin', q, { username: '<mailbox>', password: 'p' })).toEqual({
      username: '',
      password: '',
    });
  });

  it('an unknown kind, and a row with no record, sign in with the mailbox login, as every row did before', () => {
    const unknown = { soverin: { kind: 'unknown', reason: 'x', measuredAt: MEASURED_AT } };
    expect(davLoginOf('soverin', unknown, creds)).toEqual({ username: '<mailbox>', password: 'mailbox-password' });
    expect(davLoginOf('soverin', undefined, creds)).toEqual({ username: '<mailbox>', password: 'mailbox-password' });
  });

  it('every other kind signs in to DAV with its record’s own pair, whatever a qualification says', () => {
    const q = { soverin: { kind: 'suite', measuredAt: MEASURED_AT } };
    expect(davLoginOf('nextcloud', q, creds)).toEqual({ username: '<mailbox>', password: 'mailbox-password' });
  });
});
