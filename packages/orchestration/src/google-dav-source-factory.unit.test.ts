// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The Google Calendar/Contacts sources' construction (workplan 0045).
 *
 * The DAV connectors' own tests prove Bearer minting and the protocol walk;
 * what is pinned here is what is GOOGLE'S OWN: the per-product scope each
 * token provider is built with (the mistake waiting to happen with four
 * Google sources sharing one OAuth client), the fixed principal URLs, and the
 * build-time refusals in each edition's vocabulary.
 */

import { describe, it, expect } from 'vitest';
import { CalDAVSource, CarddavSource } from '@openmig/connectors';
import type { TokenProvider } from '@openmig/shared';
import {
  ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES,
  ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES,
  GOOGLE_CALDAV_SCOPE,
  GOOGLE_CARDDAV_SCOPE,
  STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
  buildGoogleCalendarDavSourceFrom,
  buildGoogleContactsDavSourceFrom,
  googleCalDavPrincipalUrl,
  googleCardDavPrincipalUrl,
} from './google-dav-source-factory';

const CREDS = {
  clientId: 'client-1.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  refreshToken: '1//refresh',
};

const fakeProvider: TokenProvider = {
  getToken: async () => ({ accessToken: 'at', tokenType: 'Bearer', expiresAt: 0 }),
  refresh: async () => ({ accessToken: 'at2', tokenType: 'Bearer', expiresAt: 0 }),
  isTokenValid: () => true,
  getTokenStatus: () => ({ isValid: true, timeUntilExpiry: 3600 }),
};

describe('refusing before anything is attempted', () => {
  it('calendar names EVERY missing env credential — including its OWN token variable', () => {
    expect(() =>
      buildGoogleCalendarDavSourceFrom('user@example.com', {}, ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES),
    ).toThrow(/GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*GOOGLE_CALENDAR_REFRESH_TOKEN/s);
  });

  it('contacts names ITS token variable, not the calendar one', () => {
    // Four Google sources share one OAuth client; the refresh tokens carry
    // per-product consents and must never be interchangeable in the config.
    expect(() =>
      buildGoogleContactsDavSourceFrom('user@example.com', {}, ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES),
    ).toThrow(/GOOGLE_CONTACTS_REFRESH_TOKEN/);
  });

  it('names the STORED field for the managed edition, not an env var it never reads', () => {
    const failure = (() => {
      try {
        buildGoogleCalendarDavSourceFrom(
          'user@example.com',
          { clientId: 'id', clientSecret: 'secret' },
          STORED_GOOGLE_DAV_CREDENTIAL_NAMES,
        );
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(failure?.message).toContain('refreshToken');
    expect(failure?.message).not.toContain('GOOGLE_CALENDAR_REFRESH_TOKEN');
    expect(failure?.message).toContain("connection's stored credentials");
  });

  it('names the scope the consent must carry', () => {
    expect(() => buildGoogleCalendarDavSourceFrom('u@x.com', {})).toThrow(
      /googleapis\.com\/auth\/calendar/,
    );
    expect(() => buildGoogleContactsDavSourceFrom('u@x.com', {})).toThrow(
      /googleapis\.com\/auth\/carddav/,
    );
  });

  it('refuses a missing account address: the principal URL is derived from it', () => {
    expect(() => buildGoogleCalendarDavSourceFrom('', CREDS)).toThrow(/user/);
    expect(() => buildGoogleContactsDavSourceFrom('', CREDS)).toThrow(/user/);
  });
});

describe('the token provider is built for the RIGHT product', () => {
  it('calendar gets the CalDAV scope, contacts the CardDAV scope, each with the credentials as found', () => {
    const seen: Array<{ scope: string; clientId?: string }> = [];
    const capture = (c: { clientId: string }, scope: string) => {
      seen.push({ scope, clientId: c.clientId });
      return fakeProvider;
    };

    buildGoogleCalendarDavSourceFrom('u@x.com', CREDS, ENV_GOOGLE_CALENDAR_CREDENTIAL_NAMES, capture);
    buildGoogleContactsDavSourceFrom('u@x.com', CREDS, ENV_GOOGLE_CONTACTS_CREDENTIAL_NAMES, capture);

    expect(seen).toEqual([
      { scope: GOOGLE_CALDAV_SCOPE, clientId: CREDS.clientId },
      { scope: GOOGLE_CARDDAV_SCOPE, clientId: CREDS.clientId },
    ]);
  });
});

describe('the fixed endpoints', () => {
  it("derives Google's documented principal URLs, with the address encoded", () => {
    expect(googleCalDavPrincipalUrl('owner@example.com')).toBe(
      'https://apidata.googleusercontent.com/caldav/v2/owner%40example.com/user/',
    );
    expect(googleCardDavPrincipalUrl('owner@example.com')).toBe(
      'https://www.googleapis.com/carddav/v1/principals/owner%40example.com/',
    );
  });

  it('builds the ORDINARY connectors — the whole point of the workplan', () => {
    expect(
      buildGoogleCalendarDavSourceFrom('u@x.com', CREDS, undefined, () => fakeProvider),
    ).toBeInstanceOf(CalDAVSource);
    expect(
      buildGoogleContactsDavSourceFrom('u@x.com', CREDS, undefined, () => fakeProvider),
    ).toBeInstanceOf(CarddavSource);
  });
});
