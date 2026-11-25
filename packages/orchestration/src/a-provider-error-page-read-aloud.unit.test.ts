// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROVIDER'S ERROR PAGE, READ ALOUD (the managed test environment, alpha.20,
 * 2026-11-25).
 *
 * A Google account's Test on the Accounts page said, in red:
 *
 *     Contacts: The grant carries https://www.googleapis.com/auth/carddav, but
 *     the face did not answer: PROPFIND failed with status 502: <!DOCTYPE html>
 *     <html lang=en> … That's an error. The server encountered a temporary
 *     error … Please try again in 30 seconds.
 *
 * A temporary error at Google, classified as a refusal, printed as Google's
 * whole HTML page, in the product's internal words. Held here, for Google's
 * token exchange and its data types, Microsoft's, Dropbox's, and the Test's
 * headline: a provider's error is said by its status and a short plain reason
 * or its own recognised error words, never its body and never "face"; 5xx and
 * 429 are `temporary`, with *test again in a minute*; nothing is longer than
 * the cap.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_ANSWER_WORDS_CAP } from '@openmig/shared';
import { qualifyDropbox, qualifyGoogleGrant, type AccountQualification } from './account-qualification.ts';
import { qualifyMicrosoftAccount } from './microsoft-account-test.ts';
import { probeSourceConnection } from './probe-connection.ts';

/** Google's temporary error page, as it came. */
const GOOGLE_502_PAGE =
  '<!DOCTYPE html>\n<html lang=en>\n  <meta charset=utf-8>\n  <title>Error 502 (Server Error)!!1</title>\n' +
  '  <style>*{margin:0;padding:0}html,code{font:15px/22px arial,sans-serif}</style>\n' +
  "  <p><b>502.</b> <ins>That’s an error.</ins>\n  <p>The server encountered a temporary error and could not complete your request.<p>Please try again in 30 seconds.  <ins>That’s all we know.</ins>";

const GOOGLE_CREDS = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'placeholder-token' };
const ALL_SCOPES =
  'https://mail.google.com/ https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/carddav ' +
  'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/tasks.readonly';
const TEMPORARY_AT = (provider: string, status: number) =>
  `${provider} had a temporary error (${status}). Test again in a minute.`;

/** Every sentence a person reads off a record: no body, no internal words, not too long. */
function expectPlain(text: string | undefined): void {
  expect(text).toBeDefined();
  expect(text).not.toMatch(/<\s*[!?/a-z]|\{\s*"/i);
  expect(text).not.toMatch(/\bface\b|clientId|refreshToken/);
  expect(text!.length).toBeLessThanOrEqual(PROVIDER_ANSWER_WORDS_CAP + 60);
}

function everyFace(q: AccountQualification | undefined) {
  return Object.values(q!.domains);
}

const answering = (status: number, body: string, json?: unknown) =>
  vi.fn(async () => ({
    ok: status === 200,
    status,
    text: async () => body,
    json: async () => json,
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Google: a data type that answered with an error page', () => {
  const reachWith = (contactError: Error) => ({
    user: 'family@example.invalid',
    listable: (domain: string) =>
      domain === 'contact'
        ? {
            listFolders: async () => {
              throw contactError;
            },
          }
        : { listFolders: async () => [{}] },
  });

  it('a 502 is a temporary error at Google, said by its status, and the page is gone', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: ALL_SCOPES }));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
      tokenEndpoint: 'https://token.example.invalid',
      reach: reachWith(new Error(`PROPFIND failed with status 502: ${GOOGLE_502_PAGE}`)),
    });
    expect(q!.domains.contact).toEqual({
      answer: 'unknown',
      reason: 'temporary',
      detail: TEMPORARY_AT('Google', 502),
      plain: { kind: 'answered', provider: 'Google', status: 502 },
    });
    expectPlain(q!.domains.contact.detail);
    expect(q!.domains.calendar.answer).toBe('yes');
  });

  it('a 429 is temporary too', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: ALL_SCOPES }));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
      tokenEndpoint: 'https://token.example.invalid',
      reach: reachWith(new Error('Google Tasks: listing task lists (429): {"error":{"code":429}}')),
    });
    expect(q!.domains.contact).toMatchObject({ reason: 'temporary', detail: TEMPORARY_AT('Google', 429) });
  });

  it('a 4xx with an HTML page says the status and a plain reason, and is a refusal', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: ALL_SCOPES }));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
      tokenEndpoint: 'https://token.example.invalid',
      reach: reachWith(new Error('PROPFIND failed with status 403: <html><body>Forbidden</body></html>')),
    });
    expect(q!.domains.contact).toMatchObject({ reason: 'refused', detail: 'Google answered 403: access was refused.' });
  });
});

describe('Google: the token exchange', () => {
  it('a 503 page leaves every data type temporary, with no page in any of them', async () => {
    vi.stubGlobal('fetch', answering(503, GOOGLE_502_PAGE));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, { tokenEndpoint: 'https://token.example.invalid' });
    for (const face of everyFace(q)) {
      expect(face).toMatchObject({ answer: 'unknown', reason: 'temporary', detail: TEMPORARY_AT('Google', 503) });
      expectPlain(face.detail);
    }
  });

  it('a refused refresh says Google’s own error words, not the JSON', async () => {
    const body = JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    vi.stubGlobal('fetch', answering(400, body));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, { tokenEndpoint: 'https://token.example.invalid' });
    for (const face of everyFace(q)) {
      expect(face).toMatchObject({
        reason: 'refused',
        detail: 'Google answered 400: invalid_grant — Token has been expired or revoked.',
      });
      expectPlain(face.detail);
    }
  });

  it('a row with no sign-in says so in plain words', async () => {
    const q = await qualifyGoogleGrant('google', { clientId: 'cid' }, { tokenEndpoint: 'https://token.example.invalid' });
    for (const face of everyFace(q)) {
      expect(face.detail).toMatch(/^This account holds no sign-in from Google yet/);
      expectPlain(face.detail);
    }
  });
});

describe('Microsoft', () => {
  const PAIR = { clientId: 'app', clientSecret: 'placeholder', refreshToken: 'placeholder-token' };

  it('a 502 page at the token exchange is temporary, with no page', async () => {
    vi.stubGlobal('fetch', answering(502, '<!DOCTYPE html><html><body>Bad gateway</body></html>'));
    const q = await qualifyMicrosoftAccount('microsoft', {}, PAIR, { tokenEndpoint: 'https://token.example.invalid' });
    for (const face of everyFace(q)) {
      expect(face).toMatchObject({ reason: 'temporary', detail: TEMPORARY_AT('Microsoft', 502) });
      expectPlain(face.detail);
    }
  });

  it('a data type Graph answered 503 with a page is temporary, said plainly', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: 'https://graph.microsoft.com/Calendars.Read' }));
    const q = await qualifyMicrosoftAccount('microsoft', {}, PAIR, {
      tokenEndpoint: 'https://token.example.invalid',
      source: () => ({
        listFolders: async () => {
          throw new Error('listing calendars: 503 - <html><body>Service Unavailable</body></html>');
        },
      }),
    });
    expect(q!.domains.calendar).toMatchObject({ reason: 'temporary', detail: TEMPORARY_AT('Microsoft', 503) });
    expectPlain(q!.domains.calendar.detail);
  });
});

describe('Dropbox', () => {
  it('a 500 page when listing is temporary, said plainly', async () => {
    vi.stubGlobal('fetch', answering(500, '<html><body>Internal Server Error</body></html>'));
    const q = await qualifyDropbox('dropbox', {}, { clientId: 'k', clientSecret: 's', refreshToken: 'placeholder-token' });
    expect(q!.domains.file).toMatchObject({ answer: 'unknown', reason: 'temporary' });
    expect(q!.domains.file.detail).toMatch(/^Dropbox had a temporary error \(500\)\. Test again in a minute\.$/);
  });
});

describe('nothing answered at all (the managed test environment, the same evening)', () => {
  // A second Test of a Google account said *"Files: … the face did not
  // answer: fetch failed"*: undici's word for a request that got no answer,
  // read as a refusal. The network's code is on its cause.
  const fetchFailed = () =>
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    });
  const CUT_OFF = 'Google could not be reached just now (the connection was cut off). Test again in a minute.';

  it('a data type whose request got no answer is temporary, said plainly, never “fetch failed”', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: ALL_SCOPES }));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, {
      tokenEndpoint: 'https://token.example.invalid',
      reach: {
        user: 'family@example.invalid',
        listable: (domain: string) => ({
          listFolders: async () => {
            if (domain === 'file') throw fetchFailed();
            return [{}];
          },
        }),
      },
    });
    expect(q!.domains.file).toEqual({
      answer: 'unknown',
      reason: 'temporary',
      detail: CUT_OFF,
      plain: { kind: 'unreachable', provider: 'Google', cause: 'cut' },
    });
    expectPlain(q!.domains.file.detail);
    expect(q!.domains.file.detail).not.toMatch(/fetch failed/);
    expect(q!.domains.contact.answer).toBe('yes');
  });

  it('a token exchange that got no answer leaves every data type temporary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(fetchFailed())));
    const q = await qualifyGoogleGrant('google', GOOGLE_CREDS, { tokenEndpoint: 'https://token.example.invalid' });
    for (const face of everyFace(q)) {
      expect(face).toMatchObject({ answer: 'unknown', reason: 'temporary', detail: CUT_OFF });
      expectPlain(face.detail);
    }
  });

  it('Microsoft’s token exchange too, with no cause when undici gave none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const pair = { clientId: 'app', clientSecret: 'placeholder', refreshToken: 'placeholder-token' };
    const q = await qualifyMicrosoftAccount('microsoft', {}, pair, { tokenEndpoint: 'https://token.example.invalid' });
    for (const face of everyFace(q)) {
      expect(face).toMatchObject({
        reason: 'temporary',
        detail: 'Microsoft could not be reached just now. Test again in a minute.',
      });
    }
  });

  it('the Test’s headline is temporary, with no status', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: ALL_SCOPES }));
    const r = await probeSourceConnection('google', { user: 'family@example.invalid' }, GOOGLE_CREDS, {
      googleTokenEndpoint: 'https://token.example.invalid',
      googleFaceSource: () => ({
        listFolders: async () => {
          throw fetchFailed();
        },
      }),
    });
    expect(r).toMatchObject({
      ok: false,
      reason: CUT_OFF,
      outcome: { code: 'providerTemporary' },
      plain: { kind: 'unreachable', provider: 'Google', cause: 'cut' },
    });
    expect(r.ok === false && r.outcome).toEqual({ code: 'providerTemporary' });
  });
});

describe('the Test’s headline', () => {
  it('a Google 502 page is a temporary error at Google, with its status as data and no page', async () => {
    vi.stubGlobal('fetch', answering(200, '', { access_token: 'at', scope: ALL_SCOPES }));
    const r = await probeSourceConnection('google', { user: 'family@example.invalid' }, GOOGLE_CREDS, {
      googleTokenEndpoint: 'https://token.example.invalid',
      googleFaceSource: () => ({
        listFolders: async () => {
          throw new Error(`PROPFIND failed with status 502: ${GOOGLE_502_PAGE}`);
        },
      }),
    });
    expect(r).toMatchObject({
      ok: false,
      reason: TEMPORARY_AT('Google', 502),
      outcome: { code: 'providerTemporary', status: 502 },
      plain: { kind: 'answered', provider: 'Google', status: 502 },
    });
  });
});
