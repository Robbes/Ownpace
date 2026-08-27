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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
