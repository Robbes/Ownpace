// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FACT THE SCREEN COULD NOT SEE.
 *
 * `GOOGLE_ACCOUNT_SCOPE_CLASS` landed on 2026-09-01 and the consent route
 * honoured it the same afternoon. The wizard did not, and could not: it read
 * `PROVIDER_ACCOUNT_DOMAINS` — a constant compiled into the browser bundle
 * long before anybody set the variable — so a deployment that had declared the
 * restricted scopes got a screen offering two ticks and a server willing to
 * ask for four. The only way to use what had been declared was to POST the
 * domains by hand, which is not a feature.
 *
 * This route is the fix, and what it must never become is the OTHER half of
 * the same defect: an answer that ignores the declaration, or one cached at
 * import so the operator's restart changes nothing. Both are asserted below by
 * moving the variable between requests on ONE running app.
 *
 * NO NETWORK, NO DATABASE, NO AUTH. The route holds none of them, which is the
 * design — it names no customer, no connection and no address, and is public
 * for the same reason `/api/scope-manifest` is.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import providerAccountRoutes from './provider-accounts.ts';
import { PROVIDER_ACCOUNT_DOMAINS, PROVIDER_ACCOUNT_KINDS } from '@openmig/shared';

const app = express();
app.use('/api/provider-accounts', providerAccountRoutes);

const WATCHED = [
  'GOOGLE_ACCOUNT_SCOPE_CLASS',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
] as const;
const before = Object.fromEntries(WATCHED.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of WATCHED) delete process.env[k];
});
afterEach(() => {
  for (const k of WATCHED) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

describe('GET /api/provider-accounts', () => {
  it('answers for every account kind, from the table rather than a list here', async () => {
    // Built from `PROVIDER_ACCOUNT_KINDS` so a kind arriving in shared arrives
    // here — the alternative is a second list that quietly stops matching.
    const res = await request(app).get('/api/provider-accounts');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...PROVIDER_ACCOUNT_KINDS].sort());
  });

  it('is the narrow answer when nothing is declared', async () => {
    const res = await request(app).get('/api/provider-accounts');
    expect(res.body.google.domains).toEqual(PROVIDER_ACCOUNT_DOMAINS.google);
    expect(res.body.google.domains).not.toContain('email');
    expect(res.body.google.domains).not.toContain('file');
  });

  it('follows the declaration, on the SAME app the last case asked', async () => {
    // The cached-at-import failure, made impossible to pass by accident: one
    // express app, two requests, the variable moved in between. An answer
    // frozen when the module loaded would give the same list twice, and an
    // operator who set the variable and restarted the API would still be
    // looking at a two-tick wizard with no idea why.
    const narrow = await request(app).get('/api/provider-accounts');
    process.env.GOOGLE_ACCOUNT_SCOPE_CLASS = 'restricted';
    const wide = await request(app).get('/api/provider-accounts');

    expect(narrow.body.google.domains).toEqual(['calendar', 'contact']);
    expect(wide.body.google.domains).toEqual(['email', 'calendar', 'contact', 'file']);
  });

  it('defaults narrow for a value nobody recognises', async () => {
    // A typo must not widen anything. Unset, mistyped and never-heard-of all
    // mean "sensitive only" — the answer that cannot over-ask.
    for (const typo of ['Restricted', 'restrictd', 'true', '']) {
      process.env.GOOGLE_ACCOUNT_SCOPE_CLASS = typo;
      const res = await request(app).get('/api/provider-accounts');
      expect(res.body.google.domains, `'${typo}' widened the ceiling`).toEqual(['calendar', 'contact']);
    }
  });

  it('leaves the other providers alone', async () => {
    // The declaration is about Google's scope tiers and nothing else. A
    // setting that quietly widened `soverin` would be inventing a face nobody
    // has measured (0105's never-guess rule).
    process.env.GOOGLE_ACCOUNT_SCOPE_CLASS = 'restricted';
    const res = await request(app).get('/api/provider-accounts');
    expect(res.body.soverin.domains).toEqual(PROVIDER_ACCOUNT_DOMAINS.soverin);
  });

  it('needs no token, like the scope manifest beside it', async () => {
    // Asserted rather than assumed: the wizard is authenticated, but this is
    // also read while deciding whether to offer a door at all, and a 401 here
    // would be a capability nobody could discover.
    const res = await request(app).get('/api/provider-accounts').set('Authorization', '');
    expect(res.status).toBe(200);
  });
});

describe('the client fact beside the domains (ADR-0041, owner decision 2026-09-01)', () => {
  it('says each connection brings its own client when the deployment has none', async () => {
    const res = await request(app).get('/api/provider-accounts');
    expect(res.body.google.client).toBe('connection');
    // Soverin has no OAuth client to speak of; a `'connection'` there would
    // be a claim about a thing that does not exist.
    expect(res.body.soverin).not.toHaveProperty('client');
  });

  it('says the deployment carries it once both halves are set — on the SAME app', async () => {
    // The same cached-at-import failure the domains case guards against: an
    // operator sets the pair, restarts, and the wizard must stop asking.
    const none = await request(app).get('/api/provider-accounts');
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'not-a-real-secret';
    const set = await request(app).get('/api/provider-accounts');
    expect(none.body.google.client).toBe('connection');
    expect(set.body.google.client).toBe('deployment');
  });

  it('treats half a pair as no client', async () => {
    // A screen told 'deployment' drops two required fields; told so on the
    // strength of a typo, it sends people to a token endpoint that will
    // refuse them hours later. Same rule as `googleDeploymentClient`.
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid.apps.googleusercontent.com';
    const idOnly = await request(app).get('/api/provider-accounts');
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'not-a-real-secret';
    const secretOnly = await request(app).get('/api/provider-accounts');
    expect(idOnly.body.google.client).toBe('connection');
    expect(secretOnly.body.google.client).toBe('connection');
  });

  it('never carries either value', async () => {
    // Unauthenticated, so this is the whole point: the fact travels, the
    // secret does not, and neither does the id.
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'SENTINEL-CLIENT-ID.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'SENTINEL-CLIENT-SECRET';
    const res = await request(app).get('/api/provider-accounts');
    expect(res.body.google.client).toBe('deployment');
    expect(JSON.stringify(res.body)).not.toContain('SENTINEL');
  });
});
