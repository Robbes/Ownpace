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
const { GOOGLE_SOURCE_SCOPES } = await import('./google-consent.ts');

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
