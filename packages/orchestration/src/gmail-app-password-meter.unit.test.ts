// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The app-password path is METERED, exactly like the OAuth one (0089 T7, 0090).
 *
 * Its own file because it mocks `mail-source-factory.ts` to see what the IMAP
 * layer was handed, and `vi.mock` hoists to the whole module — the rest of the
 * Gmail factory's tests want the real thing.
 *
 * ## Why this is worth a file
 *
 * 0090 exists because nothing in this repository counted bytes, while Gmail's
 * IMAP endpoint enforces a daily download ceiling whose penalty is a **24-hour
 * lockout of the customer's own live mail, during their migration**. 0090 T1
 * verified the ceiling is **2 500 MB/day and identical for app passwords and
 * XOAUTH2** — it belongs to the endpoint, not to the credential.
 *
 * So an app-password source that skipped the meter would be precisely the
 * second on-ramp onto an uncounted cap that 0089 T7 says must not ship: the
 * budget would be spent by one path and ignored by the other, and the first
 * anybody would know is a customer locked out of their mailbox.
 *
 * Dropping `byteMeter` from that one call is a one-word edit, invisible in
 * review, and every other test in the suite stays green when it happens. This
 * is the test that does not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SourceConnector } from '@openmig/shared';
import type { ImapByteMeter } from '@openmig/connectors';

const { buildImapSourceFromMock } = vi.hoisted(() => ({
  buildImapSourceFromMock: vi.fn(),
}));

vi.mock('./mail-source-factory.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail-source-factory.ts')>();
  return { ...actual, buildImapSourceFrom: buildImapSourceFromMock };
});

const { buildGmailSourceFrom } = await import('./gmail-source-factory.ts');

const METER: ImapByteMeter = { spend: () => {}, state: () => ({ spent: 0, limit: 1, over: false }) } as unknown as ImapByteMeter;

const OAUTH = {
  clientId: 'client-1.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-secret',
  refreshToken: '1//refresh',
};

/** What `buildImapSourceFrom` was called with, by argument position. */
const lastCall = () => {
  const call = buildImapSourceFromMock.mock.calls.at(-1)!;
  return {
    endpoint: call[0] as { host: string; port: number; tls: boolean; user: string },
    auth: call[1] as { authType: string; password?: string },
    throttle: call[2],
    byteMeter: call[3] as ImapByteMeter | undefined,
  };
};

beforeEach(() => {
  buildImapSourceFromMock.mockReset();
  buildImapSourceFromMock.mockReturnValue({} as SourceConnector);
});

describe('the daily download meter reaches BOTH credential shapes', () => {
  it('is passed on the OAuth path', () => {
    buildGmailSourceFrom('user@gmail.com', OAUTH, undefined, undefined, METER);
    expect(lastCall().byteMeter).toBe(METER);
    expect(lastCall().auth.authType).toBe('XOAUTH2');
  });

  it('is passed on the APP PASSWORD path', () => {
    // The one that would otherwise be the uncounted on-ramp.
    buildGmailSourceFrom('user@gmail.com', { appPassword: 'abcd efgh ijkl mnop' }, undefined, undefined, METER);
    expect(lastCall().byteMeter).toBe(METER);
    expect(lastCall().auth.authType).toBe('LOGIN');
  });

  it('sends both shapes to the SAME endpoint, which is why one ceiling covers both', () => {
    // The meter is chosen by HOST (`imapDownloadPlan`), so the endpoint being
    // identical is what makes "the ceiling belongs to the endpoint, not the
    // credential" true rather than merely asserted.
    buildGmailSourceFrom('user@gmail.com', OAUTH, undefined, undefined, METER);
    const viaOauth = lastCall().endpoint;
    buildGmailSourceFrom('user@gmail.com', { appPassword: 'abcd efgh' }, undefined, undefined, METER);
    const viaAppPassword = lastCall().endpoint;

    expect(viaAppPassword).toEqual(viaOauth);
    expect(viaOauth.host).toBe('imap.gmail.com');
    expect(viaOauth.port).toBe(993);
    expect(viaOauth.tls).toBe(true);
  });

  it('carries the app password as a PASSWORD and never as an access token', () => {
    buildGmailSourceFrom('user@gmail.com', { appPassword: 'abcd efgh ijkl mnop' }, undefined, undefined, METER);
    const { auth } = lastCall();
    expect(auth.password).toBe('abcd efgh ijkl mnop');
    expect((auth as { accessToken?: string }).accessToken).toBeUndefined();
    expect((auth as { tokenProvider?: unknown }).tokenProvider).toBeUndefined();
  });
});
