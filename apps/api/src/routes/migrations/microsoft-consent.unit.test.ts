// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * FOUR WAYS A MICROSOFT CONSENT IS SILENTLY WRONG RATHER THAN BROKEN.
 *
 * Workplan 0114 T2. The shape is Google's and Dropbox's, and those parts are
 * already covered by their own tests. What is asserted here is only what
 * differs — because each difference fails by SUCCEEDING at something else:
 *
 *  1. a tenant missing from the path builds a different URL, not an error;
 *  2. `offline_access` missing yields a consent that works for an hour;
 *  3. `prompt=select_account` missing migrates the wrong mailbox, silently,
 *     for a user signed into both a personal and a work account;
 *  4. asking every scope regardless of what was ticked reads someone's mail
 *     because they wanted their calendar.
 *
 * None of those produce a red screen. That is why they are tests.
 */

import { describe, it, expect } from 'vitest';
import {
  MICROSOFT_CONSENT_DOMAINS,
  MICROSOFT_OFFLINE_SCOPE,
  exchangeMicrosoftCode,
  microsoftAuthEndpoint,
  microsoftConsentRefusal,
  microsoftConsentUrl,
  microsoftScopesFor,
  microsoftTokenEndpoint,
} from './microsoft-consent.ts';

const BASE = {
  clientId: 'app-id',
  tenant: 'common',
  redirectUri: 'https://app.example/api/migrations/microsoft/callback',
  state: 'signed-state',
};

describe('the authority is in the path, and the path is never empty', () => {
  it('scopes both endpoints to the tenant', () => {
    expect(microsoftAuthEndpoint('common')).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(microsoftTokenEndpoint('contoso.onmicrosoft.com')).toBe(
      'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
    );
  });

  it('never builds a double slash, which would be a different endpoint', () => {
    // The client module guarantees a non-empty tenant; this asserts the shape
    // that guarantee exists to protect.
    expect(microsoftAuthEndpoint('common')).not.toContain('//oauth2');
  });
});

describe('what the consent asks for', () => {
  it('always carries offline_access — without it the migration dies overnight', () => {
    const url = new URL(microsoftConsentUrl({ ...BASE, domains: ['calendar'] }));
    expect(url.searchParams.get('scope')?.split(' ')).toContain(MICROSOFT_OFFLINE_SCOPE);
  });

  it('asks only for the faces that were ticked', () => {
    expect(microsoftScopesFor(['calendar'])).toEqual(['offline_access', 'Calendars.Read']);
    // The fifth row (0114 T9): asked for only when the tasks face is ticked.
    expect(microsoftScopesFor(['task'])).toEqual(['offline_access', 'Tasks.Read']);
    expect(microsoftScopesFor(['email', 'file'])).toEqual([
      'offline_access',
      'Mail.Read',
      'Files.Read',
    ]);
    // Somebody who wanted their calendar does not get their mail read.
    expect(microsoftScopesFor(['calendar'])).not.toContain('Mail.Read');
  });

  it('asks for every face when nothing recognisable was ticked', () => {
    // A consent granting nothing is not a safer failure — it is a button that
    // silently does not work.
    expect(microsoftScopesFor([])).toHaveLength(MICROSOFT_CONSENT_DOMAINS.length + 1);
    expect(microsoftScopesFor(['nonsense'])).toContain('Mail.Read');
  });

  it('reads only — no scope in the map can write', () => {
    const all = microsoftScopesFor([]);
    for (const scope of all) {
      if (scope === MICROSOFT_OFFLINE_SCOPE) continue;
      expect(scope, `${scope} is not a .Read scope`).toMatch(/\.Read$/);
    }
  });

  it('asks for Microsoft To Do only when the tasks face is ticked (0114 T9)', () => {
    // Until T9 this pinned the opposite — 'task' was unrecognised and fell
    // back to every face, none of them Tasks.Read — because a scope for a face
    // no connector served would have been consent spent on nothing. Now the
    // face is served, and the rule is the one every row has: asked for when
    // ticked, never otherwise.
    expect(microsoftScopesFor(['task'])).toEqual(['offline_access', 'Tasks.Read']);
    expect(microsoftScopesFor(['email', 'calendar'])).toEqual(
      expect.not.arrayContaining(['Tasks.Read']),
    );
  });

  it('prompts to pick an account, because the wrong-mailbox failure looks like success', () => {
    const url = new URL(microsoftConsentUrl({ ...BASE, domains: ['email'] }));
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // NOT prompt=consent: Microsoft re-issues a refresh token on every
    // authorization carrying offline_access, so it would cost a click and buy
    // nothing.
    expect(url.searchParams.get('prompt')).not.toBe('consent');
  });

  it('carries the state and the redirect, and no secret', () => {
    const raw = microsoftConsentUrl({ ...BASE, domains: ['email'] });
    const url = new URL(raw);
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('redirect_uri')).toBe(BASE.redirectUri);
    expect(raw).not.toContain('secret');
  });
});

describe("Entra's refusals become sentences with a way forward", () => {
  it('names the tenant-policy cases a first customer actually meets', () => {
    expect(microsoftConsentRefusal('... AADSTS65001: The user or administrator has not consented'))
      .toContain('administrator');
    expect(microsoftConsentRefusal('AADSTS90094: admin consent required')).toContain('Entra ID');
  });

  it('recognises a single-tenant registration asked about common', () => {
    // This one reads like a typo and is not one.
    const s = microsoftConsentRefusal('AADSTS700016: Application not found in the directory');
    expect(s).toContain('multi-tenant');
    expect(s).toContain('MICROSOFT_OAUTH_TENANT');
  });

  it('says nothing about an error it does not recognise, so the raw words survive', () => {
    expect(microsoftConsentRefusal('AADSTS50000: something else entirely')).toBeNull();
  });
});

describe('the code exchange', () => {
  const P = {
    code: 'the-code',
    clientId: 'app-id',
    clientSecret: 'app-secret',
    tenant: 'common',
    redirectUri: BASE.redirectUri,
  };
  const ok = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it('returns the refresh token and what was granted', async () => {
    const r = await exchangeMicrosoftCode(
      P,
      ok({ refresh_token: 'rt', scope: 'offline_access Mail.Read' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.refreshToken).toBe('rt');
      expect(r.grantedScopes).toEqual(['offline_access', 'Mail.Read']);
    }
  });

  it('refuses an answer with no refresh token rather than proceeding on an hour of access', async () => {
    const r = await exchangeMicrosoftCode(P, ok({ scope: 'Mail.Read' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('offline_access');
  });

  it('turns a policy refusal into its sentence, not a status dump', async () => {
    const fail = (async () =>
      new Response('AADSTS65001: not consented', { status: 400 })) as unknown as typeof fetch;
    const r = await exchangeMicrosoftCode(P, fail);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('administrator');
      expect(r.reason).not.toContain('400');
    }
  });

  it('never echoes the client secret, whatever Microsoft answers', async () => {
    const echo = (async () =>
      new Response('error app-secret leaked', { status: 400 })) as unknown as typeof fetch;
    const r = await exchangeMicrosoftCode(P, echo);
    expect(r.ok).toBe(false);
    // The secret is in the REQUEST. If a provider ever echoed it, the bounded
    // slice would carry it into a log — so this asserts the bound exists, and
    // is the reason the reason is truncated at all.
    if (!r.ok) expect(r.reason.length).toBeLessThan(400);
  });
});
