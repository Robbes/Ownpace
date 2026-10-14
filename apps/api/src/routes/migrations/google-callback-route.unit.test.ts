// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `GET /google/callback` answers under its own headers, and they WIN over
 * helmet's (2026-09-02).
 *
 * `google-consent.unit.test.ts` proves what the headers say. This proves they
 * reach the wire with the API's global middleware in front of the route, in
 * the order `index.ts` mounts them — because that order is the whole bug: the
 * page was always right, and helmet, mounted first, had already decided what
 * it would be served under. A header the route sets AFTER helmet replaces the
 * default; a header it forgot would let the default through, and this file
 * would go red.
 *
 * The control at the end matters as much as the assertions: every OTHER
 * response keeps the defaults. The override is per response, not a loosening
 * of the API.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  };
});

const { default: googleOauthRoutes } = await import('./google-oauth-routes.ts');
const { consentFlows } = await import('./consent-flows.ts');
const { EXCHANGE_FOR_THE_OWNER, GOOGLE_SOURCE_SCOPES } = await import('./google-consent.ts');
const { EXCHANGE_FOR_THE_LINK_HOLDER, log } = await import('@openmig/shared');

// helmet FIRST, as `index.ts` has it — the test is about what survives it.
const app = express();
app.use(helmet());
app.use(express.json());
app.use('/api/migrations', googleOauthRoutes);
app.get('/api/anything-else', (_req, res) => void res.json({ ok: true }));

const SCOPE = GOOGLE_SOURCE_SCOPES['google-contacts'];
const REDIRECT = 'https://app.example.test/api/migrations/google/callback';

const directive = (csp: string | undefined, name: string) =>
  (csp ?? '')
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));

beforeEach(() => {
  process.env.WEB_URL = 'https://app.example.test';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the callback page, with helmet in front of it', () => {
  it('a refused ending: helmet is overruled — opener kept, no script permitted, and the page is HTML', async () => {
    const res = await request(app).get('/api/migrations/google/callback?state=not-a-state');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(directive(res.headers['content-security-policy'], 'script-src')).toBe("script-src 'none'");
    expect(res.headers['content-security-policy']).not.toContain("'self'");
  });

  it("the owner's ending: the hand-back script is permitted by the hash of the script actually sent", async () => {
    const state = consentFlows.begin({
      clientId: 'cid',
      clientSecret: 'a-test-value',
      scope: SCOPE,
      redirectUri: REDIRECT,
    });
    // Google's token endpoint, answered locally: the exchange reads the
    // global fetch at call time, and nothing here reaches the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ refresh_token: 'rt-route', scope: SCOPE }), { status: 200 }),
      ),
    );

    const res = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(state)}&code=the-code`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('postMessage');

    const script = /<script>([\s\S]*?)<\/script>/.exec(res.text)?.[1];
    expect(script).toBeTruthy();
    const hash = createHash('sha256').update(script!, 'utf8').digest('base64');
    expect(directive(res.headers['content-security-policy'], 'script-src')).toBe(
      `script-src 'sha256-${hash}'`,
    );
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');
  });

  it('every other response keeps the defaults — the override is this page\'s, not the API\'s', async () => {
    const res = await request(app).get('/api/anything-else');
    expect(res.status).toBe(200);
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(directive(res.headers['content-security-policy'], 'script-src')).toBe("script-src 'self'");
  });
});

/**
 * THE OWNER'S ENDING KEEPS THE OWNER'S WORDS (2026-09-23).
 *
 * A grant link's refusals are worded for the person on the link now. The
 * owner's consent shares this callback and holds the client, so its
 * sentences name what to check, and nothing about a link it does not have.
 */
describe("the owner's refusals, beside a grant link's", () => {
  const begin = () =>
    consentFlows.begin({ clientId: 'cid', clientSecret: 'a-test-value', scope: SCOPE, redirectUri: REDIRECT });

  it("Google's own error is passed on as the owner reads it", async () => {
    const res = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(begin())}&error=access_denied`,
    );
    expect(res.text).toContain('Google reported: access_denied. Nothing was granted and nothing was stored.');
    expect(res.text).not.toMatch(/your link|Permission was not given/);
  });

  it('no code is said in the owner’s words', async () => {
    const res = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(begin())}`,
    );
    expect(res.text).toContain('Google sent no authorization code back.');
    expect(res.text).not.toMatch(/your link|sent nothing back/);
  });

  /**
   * IN THE OWNER'S WORDS, AND GOOGLE'S IN THE LOG (the owner, 2026-10-14). A
   * tester read *"Google refused the code exchange (HTTP 400): {…}. Check that
   * the Client ID and client secret belong to the same OAuth client…"* here,
   * Google's raw answer included. The page now says the owner's sentence for
   * the code, in the language the consent began in; Google's answer, which
   * never carries the secret, goes to the server log.
   */
  const refusedAtGoogle = (body: object, status: number) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it('a refused exchange: what the owner can check, and Google’s answer only in the log', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    refusedAtGoogle({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, 401);
    const res = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(begin())}&code=the-code`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain(EXCHANGE_FOR_THE_OWNER.refused.en);
    expect(res.text).toContain('If you filled in your own oauth-app, check that its Client ID and client secret');
    expect(res.text).toContain('please contact us');
    // Google's raw answer is not on the page…
    expect(res.text).not.toMatch(/invalid_client|was not found|HTTP 401|code exchange/);
    expect(res.text).not.toMatch(/your link/);
    // …and is in the log, with the code, and without the secret.
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('(refused)');
    expect(logged).toContain('invalid_client');
    expect(logged).not.toContain('a-test-value');
    warn.mockRestore();
  });

  it('an expired code, in Dutch for a consent begun in Dutch: the link holder’s own sentence', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    refusedAtGoogle({ error: 'invalid_grant', error_description: 'Bad Request' }, 400);
    const state = consentFlows.begin({
      clientId: 'cid',
      clientSecret: 'a-test-value',
      scope: SCOPE,
      redirectUri: REDIRECT,
      locale: 'nl',
    });
    const res = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(state)}&code=the-code`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain('<html lang="nl">');
    // The twin the link holder reads, word for word: true of the owner too.
    expect(EXCHANGE_FOR_THE_OWNER.code_rejected).toBe(EXCHANGE_FOR_THE_LINK_HOLDER.code_rejected);
    expect(res.text).toContain('Google accepteerde de aanmelding niet toen die terugkwam.');
    expect(res.text).not.toMatch(/invalid_grant|Bad Request|Google did not accept/);
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('invalid_grant');
    warn.mockRestore();
  });

  it('a permission left unticked: press the button again, never "open your link"', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ refresh_token: 'rt', scope: '' }), { status: 200 })),
    );
    const res = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(begin())}&code=the-code`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain('Press Connect with Google again and leave every one of them ticked.');
    expect(res.text).not.toMatch(/googleapis\.com|Granted:|Asking is granting|your link/);
    vi.restoreAllMocks();
  });
});

describe('the owner’s sentences for a failed exchange', () => {
  it('have both halves for every code, different, and the Dutch with "u"', () => {
    for (const [code, said] of Object.entries(EXCHANGE_FOR_THE_OWNER)) {
      expect(said.en, code).not.toBe('');
      expect(said.nl, code).not.toBe(said.en);
      expect(said.nl, code).not.toMatch(/\b(je|jij|jouw)\b/i);
      // Nothing the owner cannot act on: no variable, no document, no
      // "whoever runs", no protocol word.
      for (const half of [said.en, said.nl]) {
        expect(half, code).not.toMatch(/[A-Z]{2,}_[A-Z_]+|docs\/|whoever runs|access_type|prompt=consent|refresh token|OAuth client/);
      }
    }
  });
});
