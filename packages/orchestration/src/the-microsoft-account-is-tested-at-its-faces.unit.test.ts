// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MICROSOFT ACCOUNT IS TESTED AT ITS FACES, AND THE GRANT DECIDES WHICH.
 *
 * Workplan 0114 T10. The consent asks for exactly the faces a person ticked,
 * and nothing on the stored row says which — so the Test reads the grant from
 * Microsoft (a `.default` exchange, the response's own `scope` field), probes
 * the FIRST face it carries in calendar-first order, and qualifies every face
 * against what was granted: a face the consent did not include is a measured
 * no with the remedy, a carried face is reached with the same builder a pass
 * uses, a refused one stays unknown in Graph's words.
 *
 * Seams, not sockets: the token exchange is a stubbed `fetch`, the faces are
 * plain objects handed in through the `source` seam — the same shape the
 * Google reach tests use — so what is measured here is the decision.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MICROSOFT_CONSENT_DOMAINS, graphScopesGranted, microsoftTokenEndpoint } from '@openmig/shared';
import {
  MICROSOFT_FACE_UNIT,
  isMicrosoftGrantKind,
  microsoftFaceSource,
  microsoftFacesInProbeOrder,
  qualifyMicrosoftAccount,
  readMicrosoftGrant,
} from './microsoft-account-test.ts';
import { probeSourceConnection } from './probe-connection.ts';

const ROW = { user: 'someone@contoso.example' };
const PAIR = { clientId: 'entra-app-id', clientSecret: 'entra-secret', refreshToken: 'the-refresh-token' };
const TOKEN_ENDPOINT = 'http://token.test/oauth2/v2.0/token';

/** A token endpoint that answers every exchange with the given grant. */
function tokenFetch(scope: string, status = 200) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const impl = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: new URLSearchParams(init?.body ?? '') });
    return {
      ok: status === 200,
      status,
      text: async () => (status === 200 ? '' : '{"error":"invalid_grant","error_description":"AADSTS70000: expired"}'),
      json: async () => ({ token_type: 'Bearer', access_token: 'at', expires_in: 3600, scope }),
    };
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

/** Plain faces: each answers the listing (and a measure) the real source would. */
function faces(overrides: Partial<Record<string, unknown>> = {}) {
  return (face: string) => {
    if (face in overrides) return overrides[face];
    switch (face) {
      case 'email':
        return {
          listFolders: async () => [{ path: 'Inbox' }, { path: 'Sent' }, { path: 'Archive' }],
          countMessages: async () => ({ messages: 1234 }),
        };
      case 'calendar':
        return { listFolders: async () => [{ path: 'Calendar' }, { path: 'Birthdays' }] };
      case 'contact':
        return {
          listFolders: async () => [{ path: 'Contacts' }],
          listSince: async () => ({ items: [{}, {}, {}], nextCursor: '' }),
        };
      case 'file':
        return {
          listTopLevelFolders: async () => ({ folders: [{ path: '/Documents' }, { path: '/Photos' }], truncated: false }),
          storageUsage: async () => ({ bytes: 5_000_000_000 }),
        };
      case 'task':
        return { listFolders: async () => [{ path: 'Tasks' }] };
      default:
        throw new Error(`no fake for face ${face}`);
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('reading the grant', () => {
  it('normalises the scope field: bare or with the Graph resource in front, either way one name', () => {
    const granted = graphScopesGranted('Mail.Read  https://graph.microsoft.com/Files.Read openid\nprofile');
    expect([...granted]).toEqual(['Mail.Read', 'Files.Read', 'openid', 'profile']);
    expect(graphScopesGranted('').size).toBe(0);
  });

  it('asks the tenant’s endpoint for .default with the stored pair and the refresh token', async () => {
    const calls = tokenFetch('Mail.Read Files.Read');
    const read = await readMicrosoftGrant({ ...PAIR, tenantId: 'contoso.onmicrosoft.com' });
    expect(read).toEqual({ ok: true, granted: new Set(['Mail.Read', 'Files.Read']) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(microsoftTokenEndpoint('contoso.onmicrosoft.com'));
    const body = calls[0]!.body;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
    expect(body.get('client_id')).toBe('entra-app-id');
    expect(body.get('client_secret')).toBe('entra-secret');
    expect(body.get('refresh_token')).toBe('the-refresh-token');
  });

  it('a row without a client id is unreadable WITHOUT an exchange, and names the deployment’s application', async () => {
    const calls = tokenFetch('Mail.Read');
    const read = await readMicrosoftGrant({ refreshToken: 'x' });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toMatch(/clientId is not set/);
      expect(read.reason).toContain('MICROSOFT_OAUTH_CLIENT_ID');
      expect(read.refusal?.fields).toEqual(['clientId']);
    }
    expect(calls).toHaveLength(0);
  });

  it('a row whose token was never stored says so, with the way back — in both languages', async () => {
    // The first live Test (2026-09-06): the deployment's pair filled in, no
    // token, because the record had dropped it. The old sentence blamed a
    // "clientId/refreshToken pair", which sent the reader to a registration
    // that was fine.
    const calls = tokenFetch('Mail.Read');
    const read = await readMicrosoftGrant({ clientId: 'entra-app-id', clientSecret: 'entra-secret' });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toMatch(/refreshToken is not set/);
      expect(read.reason).toContain('Connect with Microsoft');
      expect(read.refusal?.fields).toEqual(['refreshToken']);
      expect(read.refusal?.nl).toContain('Verbinden met Microsoft');
    }
    expect(calls).toHaveLength(0);
  });

  it('a refused exchange carries the status and Microsoft’s words', async () => {
    tokenFetch('', 400);
    const read = await readMicrosoftGrant(PAIR, { tokenEndpoint: TOKEN_ENDPOINT });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toMatch(/answered 400.*AADSTS70000/);
  });
});

describe('the headline probe picks the first face the grant carries', () => {
  it('the calendar when it is carried — the account-kind rule', async () => {
    tokenFetch('Mail.Read Calendars.Read Files.Read');
    const asked: string[] = [];
    const result = await probeSourceConnection('microsoft', ROW, PAIR, {
      microsoftTokenEndpoint: TOKEN_ENDPOINT,
      microsoftFaceSource: (face) => {
        asked.push(face);
        return faces()(face);
      },
    });
    expect(asked).toEqual(['calendar']);
    expect(result.ok).toBe(true);
    expect(result.outcome).toEqual({ code: 'connected', count: 2, unit: 'calendar' });
  });

  it('mail when the consent carried mail and files only — never a calendar refusal for a working grant', async () => {
    tokenFetch('Mail.Read Files.Read');
    const asked: string[] = [];
    const result = await probeSourceConnection('microsoft', ROW, PAIR, {
      microsoftTokenEndpoint: TOKEN_ENDPOINT,
      microsoftFaceSource: (face) => {
        asked.push(face);
        return faces()(face);
      },
    });
    expect(asked).toEqual(['email']);
    expect(result.ok).toBe(true);
    expect(result.outcome).toEqual({ code: 'connected', count: 3, unit: 'folder' });
  });

  it('the file face answers bounded: a cut-short top level is a floor', async () => {
    tokenFetch('Files.Read');
    const result = await probeSourceConnection('microsoft', ROW, PAIR, {
      microsoftTokenEndpoint: TOKEN_ENDPOINT,
      microsoftFaceSource: faces({
        file: { listTopLevelFolders: async () => ({ folders: [{}, {}, {}], truncated: true }) },
      }),
    });
    expect(result.outcome).toEqual({ code: 'connected', count: 3, unit: 'folder', floor: true });
    if (result.ok) expect(result.detail).toMatch(/At least 3 folders/);
  });

  it("a face that refuses is the provider's refusal, in its words", async () => {
    tokenFetch('Calendars.Read');
    const result = await probeSourceConnection('microsoft', ROW, PAIR, {
      microsoftTokenEndpoint: TOKEN_ENDPOINT,
      microsoftFaceSource: () => ({
        listFolders: async () => {
          throw new Error('Graph calendars: 403 ErrorAccessDenied — Access is denied');
        },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.outcome.code).toBe('providerRefused');
    if (!result.ok) expect(result.reason).toContain('ErrorAccessDenied');
  });

  it('with no credentials at all it is OUR refusal, in the stored vocabulary — and never the gap sentence', async () => {
    tokenFetch('Calendars.Read');
    const result = await probeSourceConnection('microsoft', ROW, {});
    expect(result.ok).toBe(false);
    expect(result.outcome.code).not.toBe('noProbe');
    expect(result.outcome.code).toBe('credentialsRefused');
  });

  it('an unreadable grant never builds a face: a missing token is said as a missing token', async () => {
    // What the first live Test did instead (2026-09-06): fell back to the
    // calendar with the deployment's pair and no token, built the source on
    // the application flow, and answered MSAL's `missing_tenant_id_error`.
    tokenFetch('Calendars.Read');
    const build = vi.fn(() => {
      throw new Error('a face was built from a grant that could not be read');
    });
    const result = await probeSourceConnection(
      'microsoft',
      ROW,
      { clientId: 'entra-app-id', clientSecret: 'entra-secret' },
      { microsoftFaceSource: build },
    );
    expect(build).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.outcome.code).toBe('credentialsRefused');
    if (!result.ok) expect(result.reason).toMatch(/refreshToken is not set.*Connect with Microsoft/);
  });

  it('a refused exchange is Microsoft’s refusal, and still no face is built', async () => {
    tokenFetch('', 400);
    const build = vi.fn(() => {
      throw new Error('a face was built from a grant that could not be read');
    });
    const result = await probeSourceConnection('microsoft', ROW, PAIR, {
      microsoftFaceSource: build,
      microsoftTokenEndpoint: TOKEN_ENDPOINT,
    });
    expect(build).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.outcome.code).toBe('providerRefused');
    if (!result.ok) expect(result.reason).toMatch(/answered 400.*AADSTS70000/);
  });

  it('tries the faces calendar-first, then every other face the kind claims', () => {
    const order = microsoftFacesInProbeOrder();
    expect(order[0]).toBe('calendar');
    expect([...order].sort()).toEqual(['calendar', 'contact', 'email', 'file', 'task']);
    for (const face of order) expect(MICROSOFT_FACE_UNIT[face]).toBeDefined();
  });
});

describe('the qualification: every face, against the grant', () => {
  it('carried faces answer yes with their count and measure; the rest are a measured no with the remedy', async () => {
    tokenFetch('Mail.Read Files.Read Contacts.Read');
    const q = await qualifyMicrosoftAccount('microsoft', ROW, PAIR, {
      tokenEndpoint: TOKEN_ENDPOINT,
      source: faces(),
    });
    expect(q).toBeDefined();
    const d = q!.domains;
    expect(d.mail).toMatchObject({ answer: 'yes', count: 3, unit: 'folder', volume: { items: 1234 } });
    expect(d.file).toMatchObject({ answer: 'yes', count: 2, unit: 'folder', volume: { bytes: 5_000_000_000 } });
    expect(d.contact).toMatchObject({ answer: 'yes', count: 1, unit: 'addressBook', volume: { items: 3 } });
    expect(d.calendar.answer).toBe('no');
    expect(d.calendar.detail).toMatch(/did not include Calendars\.Read/);
    expect(d.calendar.detail).toMatch(/connect the account again with calendars ticked/);
    expect(d.task.answer).toBe('no');
    expect(d.task.detail).toMatch(/Tasks\.Read/);
  });

  it('a carried face that refuses is unknown, with the words — never a no', async () => {
    tokenFetch('Calendars.Read Tasks.Read');
    const q = await qualifyMicrosoftAccount('microsoft', ROW, PAIR, {
      tokenEndpoint: TOKEN_ENDPOINT,
      source: faces({
        calendar: {
          listFolders: async () => {
            throw new Error('403 ErrorAccessDenied');
          },
        },
      }),
    });
    expect(q!.domains.calendar.answer).toBe('unknown');
    expect(q!.domains.calendar.detail).toMatch(/carries Calendars\.Read, but the face did not answer: 403 ErrorAccessDenied/);
    expect(q!.domains.task).toMatchObject({ answer: 'yes', count: 1, unit: 'taskList' });
  });

  it('a failed measure does not take the yes away — it says so beside it', async () => {
    tokenFetch('Files.Read');
    const q = await qualifyMicrosoftAccount('microsoft', ROW, PAIR, {
      tokenEndpoint: TOKEN_ENDPOINT,
      source: faces({
        file: {
          listTopLevelFolders: async () => ({ folders: [{}], truncated: false }),
          storageUsage: async () => {
            throw new Error('quota unavailable');
          },
        },
      }),
    });
    expect(q!.domains.file).toMatchObject({ answer: 'yes', count: 1, volume: { failed: 'quota unavailable' } });
  });

  it('an unreadable grant leaves every face unknown, in the exchange’s words', async () => {
    tokenFetch('', 400);
    const q = await qualifyMicrosoftAccount('microsoft', ROW, PAIR, { tokenEndpoint: TOKEN_ENDPOINT, source: faces() });
    for (const face of ['mail', 'calendar', 'contact', 'file', 'task'] as const) {
      expect(q!.domains[face].answer).toBe('unknown');
      expect(q!.domains[face].detail).toMatch(/Unmeasured — the token exchange answered 400/);
    }
  });

  it('fills the deployment’s own registration for a row that took the grant button', async () => {
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_ID', 'deployment-app');
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_SECRET', 'deployment-secret');
    const calls = tokenFetch('Mail.Read');
    await qualifyMicrosoftAccount('microsoft', ROW, { refreshToken: 'rt' }, { tokenEndpoint: TOKEN_ENDPOINT, source: faces() });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.get('client_id')).toBe('deployment-app');
    expect(calls[0]!.body.get('client_secret')).toBe('deployment-secret');
  });

  it('answers only for the microsoft kind', async () => {
    expect(isMicrosoftGrantKind('microsoft')).toBe(true);
    expect(isMicrosoftGrantKind('google')).toBe(false);
    expect(await qualifyMicrosoftAccount('google', ROW, PAIR)).toBeUndefined();
  });
});

describe('the default face sources are the seams a pass builds through', () => {
  it('constructs all five faces from a stored pair without reaching the network', () => {
    // The consent's own list, not a retyped one: a sixth face would arrive
    // here by itself, and `a-domain-union-typed-out-by-hand` refuses the copy.
    expect(MICROSOFT_CONSENT_DOMAINS).toHaveLength(5);
    for (const face of MICROSOFT_CONSENT_DOMAINS) {
      const source = microsoftFaceSource(face, ROW, PAIR);
      expect(source, face).toBeTruthy();
      const listing = face === 'file' ? 'listTopLevelFolders' : 'listFolders';
      expect(typeof (source as Record<string, unknown>)[listing], `${face} answers ${listing}`).toBe('function');
    }
  });
});
