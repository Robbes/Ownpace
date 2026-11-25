// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PASSWORD SENT BY FETCH, IN A BODY (workplan 0174 §5.3, §5.6, §7.3, T4).
 *
 * The person's password goes from the page to `PUT /api/grant/:link/password`
 * as a JSON body, by `fetch`: never a form the browser submits (the page's
 * policy has `form-action 'none'`), never a query string, and with no cookie
 * or referrer beside it. This pins the call itself, what the page reads from
 * each answer of the route, and that a person's link with a password card and
 * a destination parses (a release before T4 refused every password kind).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { grantApi, passwordAnswerOf } from './grant-service.ts';

/** A placeholder, plainly not anybody's password. */
const SENTINEL = 'placeholder-sentinel-0174';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the call (0174 §5.3)', () => {
  it('is a PUT by fetch, JSON in the body, the link in the path and nothing in the query', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ connected: true, faces: ['email'] }), { status: 200 }));
    });
    const got = await grantApi.putPassword('p.abc.def', 'ref-1', { password: SENTINEL }, 'nl');
    expect(got).toEqual({ kind: 'connected', faces: ['email'] });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('/api/grant/p.abc.def/password');
    expect(url).not.toContain('?');
    expect(url).not.toContain(SENTINEL);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(JSON.parse(init.body as string)).toEqual({ ref: 'ref-1', values: { password: SENTINEL }, locale: 'nl' });
  });

  it('answers no_answer when the request itself fails, and says nothing of what was sent', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const got = await grantApi.putPassword('p.abc.def', 'ref-1', { password: SENTINEL }, 'en');
    expect(got).toEqual({ kind: 'no_answer' });
    expect(JSON.stringify(got)).not.toContain(SENTINEL);
  });

  it('reads a refusal whose body is no JSON by its status', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>locked</html>', { status: 423 })));
    expect(await grantApi.putPassword('p.abc.def', 'ref-1', { password: SENTINEL }, 'en')).toEqual({ kind: 'locked' });
  });
});

describe('what the page reads from each answer (0174 §5.3, §5.7)', () => {
  it.each([
    ['connected', 200, { connected: true, faces: ['email', 'calendar'] }, { kind: 'connected', faces: ['email', 'calendar'] }],
    [
      'connected, with the progress page the route minted (§5.3 step 8)',
      200,
      { connected: true, faces: ['email'], linkSpent: true, progressUrl: 'https://app.example.test/progress/p.abc.def' },
      { kind: 'connected', faces: ['email'], progressUrl: 'https://app.example.test/progress/p.abc.def' },
    ],
    [
      'connected, and no progress page the page would follow anywhere but http(s)',
      200,
      { connected: true, faces: ['email'], linkSpent: false, progressUrl: 'javascript:alert(1)' },
      { kind: 'connected', faces: ['email'] },
    ],
    ['already connected, nothing tried', 409, { error: 'already_connected' }, { kind: 'connected', faces: [] }],
    ['refused, three left', 422, { error: 'refused_login', tries: { left: 3, locked: false } }, { kind: 'refused_login', left: 3 }],
    ['refused, the fifth', 422, { error: 'refused_login', tries: { left: 0, locked: true } }, { kind: 'locked' }],
    ['unreachable', 422, { error: 'unreachable', tries: { left: 5, locked: false } }, { kind: 'unreachable' }],
    ['a face refused', 422, { error: 'face_missing', faces: ['email', 'nonsense'] }, { kind: 'face_missing', faces: ['email'] }],
    ['locked', 423, { error: 'locked' }, { kind: 'locked' }],
    [
      'revoked, with the sentence for the link',
      401,
      { error: 'link_refused', message: 'This link no longer works.', messageNl: 'Deze link werkt niet meer.' },
      { kind: 'refusal', sentence: { en: 'This link no longer works.', nl: 'Deze link werkt niet meer.' } },
    ],
    [
      'revoked while the test ran (`link_spent`)',
      401,
      { error: 'link_spent', reason: 'This link can no longer be used.', reasonNl: 'Deze link kan niet meer worden gebruikt.' },
      { kind: 'refusal', sentence: { en: 'This link can no longer be used.', nl: 'Deze link kan niet meer worden gebruikt.' } },
    ],
    [
      'a server named by a number (T3’s sentence)',
      409,
      { error: 'server_not_a_name', reason: 'This link names its server by a number.', reasonNl: 'Deze link noemt de server met een nummer.' },
      { kind: 'refusal', sentence: { en: 'This link names its server by a number.', nl: 'Deze link noemt de server met een nummer.' } },
    ],
    ['a body the route could not read (400)', 400, { error: 'values_not_the_fields' }, { kind: 'refusal', sentence: null }],
    ['a body too large (413)', 413, { error: 'body_too_large' }, { kind: 'refusal', sentence: null }],
    ['not JSON (415)', 415, { error: 'json_only' }, { kind: 'refusal', sentence: null }],
    // The route answers exactly §5.3's bodies; the names T4 once tolerated are not read.
    ['no `category` for `error`', 422, { category: 'refused_login', tries: { left: 2, locked: false } }, { kind: 'refusal', sentence: null }],
  ] as const)('%s', (_, status, body, expected) => {
    expect(passwordAnswerOf(status, body)).toEqual(expected);
  });
});

describe('a person’s link with a password card and a destination parses (0174 §4.1)', () => {
  it('keeps the role, the way, the server with D3’s fields, the fields and the tries', async () => {
    const body = {
      kind: 'person',
      organisation: 'Acme Families',
      checkedCompany: null,
      askedBy: 'owner@example.org',
      organisationPhone: null,
      accounts: [
        {
          ref: 'r1',
          role: 'source',
          way: 'password',
          provider: 'apple',
          account: 'anna@icloud.example',
          server: { hosts: ['imap.mail.me.com'], published: true },
          fields: [
            { key: 'username', who: 'owner', labelKey: 'account.sourceUsername', secret: false, value: 'anna@icloud.example' },
            { key: 'password', who: 'person', labelKey: 'account.appleAppPassword', secret: true, revealable: true },
          ],
          tries: { left: 5, locked: false },
          granted: false,
          again: false,
          domains: ['email'],
          scope: null,
          readOnlyAtProvider: false,
          notReady: null,
          migrations: [{ domains: ['email'], to: { provider: 'soverin', host: null, account: null }, from: { provider: 'apple', account: 'anna@icloud.example' }, granted: false }],
        },
        {
          ref: 'r2',
          role: 'target',
          way: 'password',
          provider: 'soverin',
          account: 'anna@soverin.example',
          server: { hosts: ['mail.example.net'], published: false, domains: ['example.net'], notTheAddressMail: ['mail.example.net'] },
          fields: [{ key: 'password', who: 'person', labelKey: 'account.targetPassword', secret: true }],
          tries: null,
          granted: false,
          again: false,
          domains: ['email'],
          scope: null,
          readOnlyAtProvider: false,
          notReady: null,
          migrations: [{ domains: ['email'], to: { provider: 'soverin', host: null, account: null }, from: { provider: 'apple', account: 'anna@icloud.example' }, granted: false }],
        },
      ],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      addressChanges: [],
    };
    const { linkClient } = await import('./link-client.ts');
    const get = vi.spyOn(linkClient, 'get').mockResolvedValue({ data: body });
    const subject = await grantApi.read('p.abc.def');
    get.mockRestore();
    expect('kind' in subject && subject.kind).toBe('person');
    const accounts = (subject as { accounts: Array<Record<string, unknown>> }).accounts;
    expect(accounts.map((a) => [a.role, a.way, a.provider])).toEqual([
      ['source', 'password', 'apple'],
      ['target', 'password', 'soverin'],
    ]);
    expect(accounts[1]!.server).toEqual({ hosts: ['mail.example.net'], published: false, domains: ['example.net'], notTheAddressMail: ['mail.example.net'] });
    expect((accounts[0]!.fields as unknown[]).length).toBe(2);
  });
});
