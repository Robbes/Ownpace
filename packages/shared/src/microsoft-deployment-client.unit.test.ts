// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE THIRD PROVIDER TO GET A GRANT BUTTON, AND THE FIRST WITH AN AUTHORITY.
 *
 * Workplan 0114 T1. Google and Dropbox each carry a client id and a secret and
 * nothing else. Microsoft needs to be told WHICH directory to authenticate
 * against, and that third value is where this module can go wrong in a way the
 * other two cannot:
 *
 *  - an empty authority builds `login.microsoftonline.com//oauth2/...`, a
 *    different URL and not a better error;
 *  - a single-tenant registration authenticating against `common` fails at
 *    Entra with a message about the application not being found in the
 *    directory, which reads like a typo and is not one — so a caller's own
 *    `tenantId` must survive alongside their own pair.
 *
 * Everything else is the Google/Dropbox contract, asserted again because it is
 * a contract and not a coincidence: both or neither, the connection's own pair
 * wins, a half pair is refused where the deployment could complete it wrongly,
 * and no sentence ever prints a value.
 */

import { describe, it, expect } from 'vitest';
import {
  MICROSOFT_DEFAULT_TENANT,
  halfMicrosoftClientPairProblem,
  microsoftDeploymentClient,
  microsoftDeploymentClientProblem,
  microsoftTenant,
  resolveMicrosoftClient,
  withDeploymentMicrosoftClient,
} from './microsoft-deployment-client.ts';

const PAIR = {
  MICROSOFT_OAUTH_CLIENT_ID: 'deployment-app-id',
  MICROSOFT_OAUTH_CLIENT_SECRET: 'deployment-secret',
};

describe('the Entra application a deployment configured', () => {
  it('is the pair when both are set, null when neither', () => {
    expect(microsoftDeploymentClient(PAIR)).toEqual({
      clientId: 'deployment-app-id',
      clientSecret: 'deployment-secret',
      tenant: MICROSOFT_DEFAULT_TENANT,
    });
    expect(microsoftDeploymentClient({})).toBeNull();
  });

  it('half a pair is null, and the problem names the missing half without printing a value', () => {
    const halfId = { MICROSOFT_OAUTH_CLIENT_ID: 'deployment-app-id' };
    expect(microsoftDeploymentClient(halfId)).toBeNull();

    const problem = microsoftDeploymentClientProblem(halfId);
    expect(problem).toContain('MICROSOFT_OAUTH_CLIENT_SECRET');
    expect(problem).not.toContain('deployment-app-id');

    expect(microsoftDeploymentClientProblem({})).toBeNull();
    expect(microsoftDeploymentClientProblem(PAIR)).toBeNull();
  });
});

describe('the authority, which Google and Dropbox do not have', () => {
  it('defaults to common — the multi-tenant answer a shared deployment needs', () => {
    expect(microsoftTenant({})).toBe('common');
    expect(microsoftDeploymentClient(PAIR)?.tenant).toBe('common');
  });

  it('is never empty, so no URL is built with an empty path segment', () => {
    // The failure this prevents is not an error message — it is a request to
    // `login.microsoftonline.com//oauth2/v2.0/authorize`, which is a different
    // endpoint rather than a refusal.
    expect(microsoftTenant({ MICROSOFT_OAUTH_TENANT: '   ' })).toBe('common');
    expect(microsoftTenant({ MICROSOFT_OAUTH_TENANT: '' })).toBe('common');
  });

  it('honours a deployment that deliberately runs single-tenant', () => {
    expect(microsoftTenant({ MICROSOFT_OAUTH_TENANT: 'contoso.onmicrosoft.com' })).toBe(
      'contoso.onmicrosoft.com',
    );
  });
});

describe('filling it in, and refusing to', () => {
  it('fills a Microsoft connection that carries none, and never a non-Microsoft one', () => {
    expect(withDeploymentMicrosoftClient(true, {}, PAIR)).toEqual({
      clientId: 'deployment-app-id',
      clientSecret: 'deployment-secret',
      tenantId: 'common',
    });
    // `clientId` and `clientSecret` are shared key names: a Google row must
    // never be handed Microsoft's application.
    expect(withDeploymentMicrosoftClient(false, {}, PAIR)).toEqual({});
  });

  it("never overrides the connection's own pair or its own directory", () => {
    const own = { clientId: 'own-id', clientSecret: 'own-secret', tenantId: 'own-tenant' };
    expect(withDeploymentMicrosoftClient(true, own, PAIR)).toEqual(own);
  });

  it('half a pair is refused where the deployment could complete it wrongly, and only there', () => {
    const half = { clientId: 'own-id' };
    expect(halfMicrosoftClientPairProblem(half, PAIR)).toContain('clientSecret');
    // No deployment application: there is nothing to complete it wrongly WITH,
    // so this is not the half-pair failure and must not be reported as one.
    expect(halfMicrosoftClientPairProblem(half, {})).toBeNull();
    expect(halfMicrosoftClientPairProblem({ clientId: 'a', clientSecret: 'b' }, PAIR)).toBeNull();
  });
});

describe('the application a request may use', () => {
  it("the caller's whole pair, else the deployment's, else a refusal naming both ways forward", () => {
    expect(resolveMicrosoftClient({ clientId: 'own-id', clientSecret: 'own-secret' }, {})).toEqual({
      ok: true,
      clientId: 'own-id',
      clientSecret: 'own-secret',
      tenant: 'common',
    });

    expect(resolveMicrosoftClient({}, PAIR)).toEqual({
      ok: true,
      clientId: 'deployment-app-id',
      clientSecret: 'deployment-secret',
      tenant: 'common',
    });

    const none = resolveMicrosoftClient({}, {});
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.error).toBe('no_microsoft_client');
      expect(none.reason).toContain('MICROSOFT_OAUTH_CLIENT_ID');
      expect(none.reason).toContain('clientId');
    }
  });

  it("keeps the caller's own directory beside their own pair", () => {
    // A single-tenant registration sent against `common` fails at Entra with a
    // message about the application not being found in the directory — which
    // reads like a typo. Their tenant travels with their pair.
    const r = resolveMicrosoftClient(
      { clientId: 'own-id', clientSecret: 'own-secret', tenantId: 'contoso.onmicrosoft.com' },
      PAIR,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tenant).toBe('contoso.onmicrosoft.com');
  });

  it('refuses half a pair before anything else', () => {
    const r = resolveMicrosoftClient({ clientId: 'own-id' }, PAIR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('half_client_pair');
  });

  it('a half-configured deployment answers with its own sentence, not as one that configured nothing', () => {
    const r = resolveMicrosoftClient({}, { MICROSOFT_OAUTH_CLIENT_ID: 'only-id' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('no_microsoft_client');
      expect(r.reason).toContain('MICROSOFT_OAUTH_CLIENT_SECRET');
      expect(r.reason).not.toContain('only-id');
    }
  });
});
