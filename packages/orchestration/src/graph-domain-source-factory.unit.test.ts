// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The Graph domain factory (workplan 0054) — the seam that turned three
 * orphaned connectors into reachable sources. What these pin:
 *
 *  1. All three build from the same Entra registration with either flow —
 *     the mail factory's rules, applied uniformly.
 *  2. The mailbox+delegated refusal fires BEFORE any request, naming the fix
 *     — the same lesson buildGraphMailSourceFrom already paid for.
 *  3. Refusals name the environment variables the appliance operator sets.
 */

import { describe, it, expect } from 'vitest';
import {
  buildGraphCalendarSourceFrom,
  buildGraphContactsSourceFrom,
  buildGraphDriveSourceFrom,
} from './graph-domain-source-factory';

const ENDPOINT = { tenantId: 'contoso.example' };
const CLIENT_CREDS = { clientId: 'app-id', clientSecret: 'shh' };
const DELEGATED_CREDS = { clientId: 'app-id', refreshToken: 'rt' };

describe('all three build from the same registration, either flow', () => {
  it('constructs calendar, contacts and drive sources without touching the network', () => {
    expect(buildGraphCalendarSourceFrom(ENDPOINT, CLIENT_CREDS)).toBeDefined();
    expect(buildGraphContactsSourceFrom(ENDPOINT, DELEGATED_CREDS)).toBeDefined();
    expect(buildGraphDriveSourceFrom(ENDPOINT, CLIENT_CREDS)).toBeDefined();
  });

  it('a /users read (mailbox set) works under client-credentials', () => {
    expect(
      buildGraphDriveSourceFrom({ ...ENDPOINT, mailbox: 'shared@contoso.example' }, CLIENT_CREDS),
    ).toBeDefined();
  });
});

describe('refusals, before anything is attempted', () => {
  it('names OAUTH2_CLIENT_ID when the registration id is missing', () => {
    expect(() => buildGraphCalendarSourceFrom(ENDPOINT, {})).toThrow(/OAUTH2_CLIENT_ID/);
  });

  it('names both flows when neither secret nor refresh token is set', () => {
    expect(() => buildGraphDriveSourceFrom(ENDPOINT, { clientId: 'app-id' })).toThrow(
      /OAUTH2_CLIENT_SECRET.*OAUTH2_REFRESH_TOKEN/s,
    );
  });

  it("refuses mailbox + delegated flow with the fix named — Graph's 403 never says the cause", () => {
    expect(() =>
      buildGraphContactsSourceFrom(
        { ...ENDPOINT, mailbox: 'shared@contoso.example' },
        DELEGATED_CREDS,
      ),
    ).toThrow(/DELEGATED flow and can only read the signed-in user/);
  });
});
