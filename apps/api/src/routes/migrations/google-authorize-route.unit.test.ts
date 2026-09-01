// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `POST /google/authorize` actually acts on the tick set (workplan 0106 T3b).
 *
 * `google-account-consent.unit.test.ts` proves the DECISION. This proves the
 * route carries it — the gap this repo keeps rediscovering, and has been
 * bitten by twice in the last month: a decision function fully green while the
 * route computed it and dropped it on the floor. A refusal that never reaches
 * a status code is not a refusal, and a narrowed scope that never reaches the
 * consent URL is a consent screen asking for something else.
 *
 * So everything below reads the URL the route ANSWERS WITH, and parses the
 * `scope` parameter out of it — which is the string Google will actually show
 * a person, and the only artefact that matters.
 *
 * `authenticate` is the one thing stubbed. The consent state, the URL builder
 * and the scope table are the product's.
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

const { default: googleOauthRoutes } = await import('./google-oauth-routes.ts');
const { GOOGLE_SOURCE_SCOPES } = await import('./google-consent.ts');
const { GOOGLE_SCOPES_ASKED_BY_DOMAIN } = await import(
  '@openmig/orchestration/account-qualification'
);

const app = express();
app.use(express.json());
app.use('/api/migrations', googleOauthRoutes);

const CLIENT = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'a-test-value' };

beforeEach(() => {
  // API_URL decides the callback, and a raw IP is refused before anything else
  // (0089 T6) — a hostname keeps these tests about the scope.
  process.env.API_URL = 'https://app.example.test';
});

const authorize = (body: Record<string, unknown>) =>
  request(app).post('/api/migrations/google/authorize').send({ ...CLIENT, ...body });

/** The scope Google will show, read out of the URL the route answered with. */
const scopeInUrl = (url: string): string[] =>
  (new URL(url).searchParams.get('scope') ?? '').split(' ').filter(Boolean);

describe('the ticks reach the consent URL', () => {
  it('asks for exactly the two ticked, in the URL and not only in the body', async () => {
    const res = await authorize({ domains: ['calendar', 'contact'] });
    expect(res.status).toBe(200);
    expect(scopeInUrl(res.body.url)).toEqual([
      GOOGLE_SCOPES_ASKED_BY_DOMAIN.calendar,
      GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact,
    ]);
    // The body's `scope` and the URL's must be the same string. They are two
    // reports of one decision, and a wizard shows the first while a person
    // approves the second.
    expect(res.body.scope).toBe(scopeInUrl(res.body.url).join(' '));
  });

  it('asks for one when one is ticked', async () => {
    const res = await authorize({ domains: ['contact'] });
    expect(res.status).toBe(200);
    expect(scopeInUrl(res.body.url)).toEqual([GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact]);
  });

  it('echoes what it asked for, so the wizard can show it', async () => {
    const res = await authorize({ domains: ['contact', 'calendar'] });
    expect(res.body.domains).toEqual(['calendar', 'contact']);
  });

  it('still asks incrementally, so adding a face does not drop the one already granted', async () => {
    // Google REPLACES a grant with what the latest consent asked for. Asking
    // narrowly is only safe alongside `include_granted_scopes`, and the
    // narrow ask is exactly what this task introduced — so the pairing is
    // asserted at the URL rather than trusted from a comment.
    const res = await authorize({ domains: ['calendar'] });
    expect(new URL(res.body.url).searchParams.get('include_granted_scopes')).toBe('true');
  });
});

describe('the refusals reach a status code', () => {
  it('refuses mail on the account kind, with the way through', async () => {
    const res = await authorize({ domains: ['calendar', 'email'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_on_this_account');
    expect(res.body.reason).toContain('gmail');
  });

  it('refuses rather than quietly asking for the calendar half', async () => {
    // The failure that would look like success: a 200 whose URL asks for one
    // scope when two were ticked. Somebody approves it and believes their
    // mail is connected.
    const res = await authorize({ domains: ['calendar', 'email'] });
    expect(res.status).not.toBe(200);
    expect(res.body.url).toBeUndefined();
  });

  it('refuses an empty tick set with a sentence rather than a default', async () => {
    const res = await authorize({ domains: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_domains_ticked');
  });

  it('refuses a domain this product does not migrate', async () => {
    const res = await authorize({ domains: ['tasks'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_domain');
  });
});

describe('the single-purpose ask is untouched', () => {
  it('still serves gmail, with its own one scope', async () => {
    // The account kind COHABITS with these; it does not replace them, and
    // `gmail`/`google-drive` are the only way to the restricted scopes at
    // all. A change to the schema that broke them would break the flow the
    // owner uses today.
    const res = await authorize({ sourceType: 'gmail' });
    expect(res.status).toBe(200);
    expect(scopeInUrl(res.body.url)).toEqual([GOOGLE_SOURCE_SCOPES.gmail]);
  });

  it('still serves google-drive', async () => {
    const res = await authorize({ sourceType: 'google-drive' });
    expect(res.status).toBe(200);
    expect(scopeInUrl(res.body.url)).toEqual([GOOGLE_SOURCE_SCOPES['google-drive']]);
  });

  it('says nothing about domains when the ask was by source type', async () => {
    const res = await authorize({ sourceType: 'google-contacts' });
    expect(res.body.domains).toBeUndefined();
  });

  it('still refuses a body that is neither shape', async () => {
    const res = await authorize({ sourceType: 'outlook' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });
});

/**
 * WHOSE CLIENT THE CONSENT RUNS AGAINST (ADR-0041, owner decision 2026-09-01 —
 * option B).
 *
 * Every Google connection demanded a client id and a client secret typed into
 * a wizard. They are the DEPLOYMENT'S — the same values on every connection on
 * the box, the owner's own registered application — and only the refresh token
 * is per-account. So a deployment may configure the pair once and the wizard
 * stops asking.
 *
 * The property that must not erode is the other direction: a caller who SENDS
 * a pair still wins. ADR-0041's point is that owning a client is a real
 * choice, and a deployment-wide default that quietly replaced somebody's own
 * would take it away — they would discover it when Google's consent screen
 * showed the wrong application name.
 */
describe('the client this consent runs against', () => {
  const CONFIGURED_ID = 'deployment.apps.googleusercontent.com';
  const before = {
    id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
  const configure = (id?: string, secret?: string) => {
    if (id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = id;
    if (secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = secret;
  };
  const bare = (body: Record<string, unknown>) =>
    request(app).post('/api/migrations/google/authorize').send(body);

  beforeEach(() => configure(undefined, undefined));
  afterEach(() => configure(before.id, before.secret));

  const clientIdInUrl = (url: string): string | null =>
    new URL(url).searchParams.get('client_id');

  it("uses the deployment's own when the caller sends none", async () => {
    configure(CONFIGURED_ID, 'deployment-secret');
    const res = await bare({ sourceType: 'gmail' });
    expect(res.status).toBe(200);
    expect(clientIdInUrl(res.body.url)).toBe(CONFIGURED_ID);
  });

  it("uses the CALLER'S where they sent one, because owning a client is a choice", async () => {
    configure(CONFIGURED_ID, 'deployment-secret');
    const res = await authorize({ sourceType: 'gmail' });
    expect(res.status).toBe(200);
    expect(clientIdInUrl(res.body.url)).toBe(CLIENT.clientId);
  });

  it('refuses when there is neither, and names BOTH ways forward', async () => {
    // Either is legitimate, and somebody meeting this cannot tell which their
    // deployment expects — so the refusal has to carry both.
    const res = await bare({ sourceType: 'gmail' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_google_client');
    expect(res.body.reason).toContain('clientId');
    expect(res.body.reason).toContain('GOOGLE_OAUTH_CLIENT_ID');
  });

  it('names the missing half of a HALF-configured deployment', async () => {
    // Somebody who set one of the two has plainly tried. Answering them with
    // the same sentence as somebody who set neither hides a typo behind a
    // feature that merely looks absent.
    configure(CONFIGURED_ID, undefined);
    const res = await bare({ sourceType: 'gmail' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
  });

  it('never puts the secret in the URL it answers with', async () => {
    // The consent URL is a redirect a browser follows and a log records. The
    // client secret belongs to the token exchange, which happens server-side.
    configure(CONFIGURED_ID, 'deployment-secret');
    const res = await bare({ sourceType: 'gmail' });
    expect(res.body.url).not.toContain('deployment-secret');
    expect(JSON.stringify(res.body)).not.toContain('deployment-secret');
  });

  it('refuses half a pair from the CALLER rather than mixing it with the deployment’s', async () => {
    // Half of one client and half of another cannot exchange a code, and the
    // failure would arrive at Google with nothing on this side to explain it.
    // `.min(1).optional()` also means a cleared field is a cleared field.
    configure(CONFIGURED_ID, 'deployment-secret');
    const res = await bare({ sourceType: 'gmail', clientId: CLIENT.clientId });
    expect(res.status).toBe(200);
    expect(clientIdInUrl(res.body.url), 'a lone clientId must not be half-used').toBe(
      CONFIGURED_ID,
    );
  });
});
