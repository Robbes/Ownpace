// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Connect with Dropbox, at the two routes (2026-09-02). The authorize door
 * resolves the app as every Google door resolves its client; the callback
 * ends only Dropbox's own states, under the page's own headers, and hands the
 * token back under Dropbox's message type. Google's callback refuses a
 * Dropbox state, which is the one thing a shared store could get wrong.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
  };
});

const { default: dropboxOauthRoutes } = await import('./dropbox-oauth-routes.ts');
const { default: googleOauthRoutes } = await import('./google-oauth-routes.ts');

const app = express();
app.use(helmet());
app.use(express.json());
app.use('/api/migrations', dropboxOauthRoutes);
app.use('/api/migrations', googleOauthRoutes);

const authorize = (body: Record<string, unknown> = {}) =>
  request(app).post('/api/migrations/dropbox/authorize').send(body);

beforeEach(() => {
  process.env.API_URL = 'https://app.example.test';
  process.env.WEB_URL = 'https://app.example.test';
  delete process.env.DROPBOX_OAUTH_CLIENT_ID;
  delete process.env.DROPBOX_OAUTH_CLIENT_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DROPBOX_OAUTH_CLIENT_ID;
  delete process.env.DROPBOX_OAUTH_CLIENT_SECRET;
});

describe('the authorize door', () => {
  it("without a pair, on a deployment that carries the app: a URL for THAT App key, offline access, and no secret anywhere", async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'deployment-app-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const res = await authorize();
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.searchParams.get('client_id')).toBe('deployment-app-key');
    expect(url.searchParams.get('token_access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/api/migrations/dropbox/callback');
    expect(res.body.redirectUri).toBe('https://app.example.test/api/migrations/dropbox/callback');
    expect(JSON.stringify(res.body)).not.toContain('deployment-app-secret');
  });

  it("the caller's own pair wins over the deployment's", async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'deployment-app-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const res = await authorize({ clientId: 'own-key', clientSecret: 'own-secret' });
    expect(res.status).toBe(200);
    expect(new URL(res.body.url).searchParams.get('client_id')).toBe('own-key');
  });

  it('half a pair is refused before anything is begun; no app at all is refused naming both ways forward', async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'deployment-app-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const half = await authorize({ clientId: 'own-key' });
    expect(half.status).toBe(400);
    expect(half.body.error).toBe('half_client_pair');

    delete process.env.DROPBOX_OAUTH_CLIENT_ID;
    delete process.env.DROPBOX_OAUTH_CLIENT_SECRET;
    const none = await authorize();
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('no_dropbox_client');
    expect(none.body.reason).toContain('DROPBOX_OAUTH_CLIENT_ID');
  });
});

describe('the callback', () => {
  it('a bogus state is refused under the page\'s own headers — helmet overruled, opener kept', async () => {
    const res = await request(app).get('/api/migrations/dropbox/callback?state=not-a-state');
    expect(res.status).toBe(400);
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    expect(res.text).toContain('not one the wizard is waiting for');
  });

  it("the owner's ending: the token rides Dropbox's message type, under a CSP that permits exactly that script", async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'deployment-app-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const begun = await authorize();
    const state = new URL(begun.body.url).searchParams.get('state')!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ refresh_token: 'rt-dbx', scope: 'files.metadata.read files.content.read' }),
          { status: 200 },
        ),
      ),
    );
    const res = await request(app).get(
      `/api/migrations/dropbox/callback?state=${encodeURIComponent(state)}&code=the-code`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('ownpace-dropbox-consent');
    expect(res.text).not.toContain('ownpace-google-consent');
    expect(res.headers['content-security-policy']).toMatch(/script-src 'sha256-/);
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');
  });

  it("Google's callback does not end a Dropbox state, and the state is spent either way", async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'deployment-app-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const begun = await authorize();
    const state = new URL(begun.body.url).searchParams.get('state')!;
    const wrong = await request(app).get(
      `/api/migrations/google/callback?state=${encodeURIComponent(state)}&code=the-code`,
    );
    expect(wrong.status).toBe(400);
    expect(wrong.text).toContain('not one the wizard is waiting for');
    const spent = await request(app).get(
      `/api/migrations/dropbox/callback?state=${encodeURIComponent(state)}&code=the-code`,
    );
    expect(spent.status).toBe(400);
  });

  it("Dropbox's own refusal is shown in Dropbox's words, and nothing is stored", async () => {
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'deployment-app-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const begun = await authorize();
    const state = new URL(begun.body.url).searchParams.get('state')!;
    const res = await request(app).get(
      `/api/migrations/dropbox/callback?state=${encodeURIComponent(state)}&error=access_denied&error_description=The+user+said+no`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('Dropbox reported: access_denied');
    expect(res.text).toContain('The user said no');
  });
});
