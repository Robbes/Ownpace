// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHOSE REGISTRATION ENTRA COULD NOT FIND, decided where it is known
 * (workplan 0148 T2 (d)).
 *
 * `microsoftConsentRefusal` receives only Entra's text; the start route is
 * what decides whose application a consent uses (`resolveMicrosoftClient`),
 * and the flow it begins carries that client id to the callback. So the
 * callback is where "the service's registration" and "one you typed in" part
 * ways, and this is the case that shows the two routes agree end to end: the
 * sentence a tester sees on `ownpace-live` names no operator setting, and the
 * one a person with their own registration sees still does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
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

const { default: microsoftOauthRoutes } = await import('./microsoft-oauth-routes.ts');
const { log } = await import('@openmig/shared');

const app = express();
app.use(express.json());
app.use('/api/migrations', microsoftOauthRoutes);

const WATCHED = [
  'API_URL',
  'WEB_URL',
  'MICROSOFT_OAUTH_CLIENT_ID',
  'MICROSOFT_OAUTH_CLIENT_SECRET',
  'MICROSOFT_OAUTH_TENANT',
] as const;
const before = Object.fromEntries(WATCHED.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of WATCHED) delete process.env[k];
  process.env.API_URL = 'https://app.example.test';
  process.env.WEB_URL = 'https://app.example.test';
});
afterEach(() => {
  for (const k of WATCHED) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

/** Start a consent, then come back from Entra with AADSTS700016. */
async function refusedWith700016(pair: Record<string, string> = {}): Promise<string> {
  const started = await request(app)
    .post('/api/migrations/microsoft/authorize')
    .send({ domains: ['calendar'], ...pair });
  expect(started.status).toBe(200);
  const state = new URL(started.body.url as string).searchParams.get('state') ?? '';
  const back = await request(app).get('/api/migrations/microsoft/callback').query({
    state,
    error: 'unauthorized_client',
    error_description: 'AADSTS700016: Application with identifier was not found in the directory',
  });
  return back.text;
}

describe('the callback words AADSTS700016 by whose registration the consent used', () => {
  it("the service's own registration: no operator setting, and who to tell", async () => {
    process.env.MICROSOFT_OAUTH_CLIENT_ID = 'deployment-app-id';
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const page = await refusedWith700016();
    expect(page).toContain('This is on our side, not your account: please contact us');
    expect(page).not.toContain('MICROSOFT_OAUTH_TENANT');
  });

  it('a registration the person typed in: the sentence that tells them what to change', async () => {
    process.env.MICROSOFT_OAUTH_CLIENT_ID = 'deployment-app-id';
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const page = await refusedWith700016({ clientId: 'own-app-id', clientSecret: 'own-secret' });
    expect(page).toContain('MICROSOFT_OAUTH_TENANT');
    expect(page).not.toContain('please contact us');
  });
});

/**
 * A FAILED CODE EXCHANGE IN THE OWNER'S WORDS (the owner, 2026-10-16), as
 * Google's and Dropbox's have been since 2026-10-14. For an answer Entra gave
 * no sentence of ours, the page showed *"Microsoft refused the code exchange
 * (400): {body}"*. It now says what happened and what to do, in the language
 * the consent began in, and Microsoft's answer is in the server log only.
 */
describe("a failed code exchange, in the owner's words", () => {
  const RAW = JSON.stringify({
    error: 'invalid_grant',
    error_description: 'AADSTS70008: The provided authorization code or refresh token has expired.',
  });

  const failedExchange = async (locale: 'en' | 'nl', answer: Response) => {
    process.env.MICROSOFT_OAUTH_CLIENT_ID = 'deployment-app-id';
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const started = await request(app)
      .post('/api/migrations/microsoft/authorize')
      .send({ domains: ['email'], locale });
    const state = new URL(started.body.url as string).searchParams.get('state') ?? '';
    vi.stubGlobal('fetch', vi.fn(async () => answer));
    try {
      return await request(app).get('/api/migrations/microsoft/callback').query({ state, code: 'the-code' });
    } finally {
      vi.unstubAllGlobals();
    }
  };

  it("in English: a plain sentence on the page, Microsoft's answer only in the log", async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const res = await failedExchange('en', new Response(RAW, { status: 400 }));
    expect(res.status).toBe(400);
    expect(res.text).toContain('Microsoft turned down this sign-in, so nothing was stored.');
    expect(res.text).not.toMatch(/invalid_grant|AADSTS70008|code exchange|\(400\)/);
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('AADSTS70008');
    expect(logged).not.toContain('deployment-app-secret');
    warn.mockRestore();
  });

  it('in Dutch, for a consent begun in Dutch', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const res = await failedExchange('nl', new Response(RAW, { status: 400 }));
    expect(res.text).toContain('<html lang="nl">');
    expect(res.text).toContain('Microsoft heeft deze aanmelding geweigerd, dus er is niets opgeslagen.');
    expect(res.text).not.toMatch(/invalid_grant|AADSTS70008/);
    warn.mockRestore();
  });

  it('an answer that is not JSON, and one without lasting access: said plainly, logged in full', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const garbled = await failedExchange('en', new Response('<html>gateway</html>', { status: 200 }));
    expect(garbled.text).toContain("Microsoft's answer could not be read, so nothing was stored.");
    expect(garbled.text).not.toContain('gateway');
    const noLasting = await failedExchange('en', new Response(JSON.stringify({ scope: 'Mail.Read' }), { status: 200 }));
    expect(noLasting.text).toContain('Microsoft would not give lasting access to this account, so nothing was stored.');
    expect(noLasting.text).not.toMatch(/offline_access|refresh token/);
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('gateway');
    expect(logged).toContain('offline_access');
    warn.mockRestore();
  });

  it("a policy refusal Entra named keeps its own sentence", async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const res = await failedExchange('en', new Response('AADSTS65001: not consented', { status: 400 }));
    expect(res.text).toContain('administrator');
    warn.mockRestore();
  });
});

/**
 * A CONSENT NOBODY IS WAITING FOR (the owner, 2026-10-16). Said in English
 * only, and in the wizard's words. Nothing says which language the consent
 * began in, so the browser's own does, as the app's first choice does.
 */
describe('a consent nobody is waiting for', () => {
  it('is said plainly, in English by default', async () => {
    const res = await request(app).get('/api/migrations/microsoft/callback').query({ state: 'forged', code: 'x' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('This sign-in cannot be finished');
    expect(res.text).not.toContain('wizard is waiting for');
  });

  it("is said in Dutch to a browser that asks for Dutch", async () => {
    const res = await request(app)
      .get('/api/migrations/microsoft/callback')
      .set('Accept-Language', 'nl-NL,nl;q=0.9,en;q=0.8')
      .query({ state: 'forged', code: 'x' });
    expect(res.text).toContain('<html lang="nl">');
    expect(res.text).toContain('Deze aanmelding kan niet worden afgerond');
  });
});
