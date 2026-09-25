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
    expect(page).toContain('tell whoever runs it');
    expect(page).not.toContain('MICROSOFT_OAUTH_TENANT');
  });

  it('a registration the person typed in: the sentence that tells them what to change', async () => {
    process.env.MICROSOFT_OAUTH_CLIENT_ID = 'deployment-app-id';
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'deployment-app-secret';
    const page = await refusedWith700016({ clientId: 'own-app-id', clientSecret: 'own-secret' });
    expect(page).toContain('MICROSOFT_OAUTH_TENANT');
    expect(page).not.toContain('tell whoever runs it');
  });
});
