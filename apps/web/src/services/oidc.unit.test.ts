// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Authorization-code + PKCE in the browser (ADR-0042).
 *
 * Two things here are security properties rather than behaviour, and they are
 * what most of this file is about:
 *
 *  - **The state check.** Without it, somebody can hand a victim a callback URL
 *    carrying a code from the ATTACKER'S session, and the victim ends up signed
 *    in as them — seeing, and acting on, an account that is not theirs. It is a
 *    refusal, never a retry.
 *  - **The issuer of the discovery document must be the issuer we asked for.**
 *    Same rule the API applies to `jwks_uri` (OIDC Discovery §4.3): a document
 *    that names somebody else is not this issuer, and following its endpoints
 *    would send a person's credentials there.
 *
 * The rest pins that the flow is standard — S256, a public client, and no
 * provider's URL shapes anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  beginSignIn,
  completeSignIn,
  configFrom,
  discover,
  oidcConfig,
  redirectUri,
  __resetDiscoveryForTests,
} from './oidc.ts';

const ISSUER = 'https://id.example.test';
const CLIENT = 'client-123';

/**
 * The configuration under test, passed in rather than stubbed.
 *
 * `import.meta.env` IS NOT SHARED BETWEEN MODULES — vitest hands each file its
 * own object, so setting `import.meta.env.VITE_OIDC_ISSUER` here sets it on
 * THIS file and `oidc.ts` goes on seeing `{BASE_URL, DEV, MODE, PROD, SSR}`.
 * (An earlier draft of this file did exactly that, and twelve cases failed with
 * "Sign-in is not configured".) So the flow takes its config as an argument and
 * the environment read is one pure function, `configFrom`, tested directly.
 */
const CONFIG = { issuer: ISSUER, clientId: CLIENT };

/** A discovery document, with endpoints that share no shape with the issuer. */
const DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/somewhere/authorize`,
  token_endpoint: `${ISSUER}/elsewhere/token`,
};

let assigned: string[] = [];

function stubFetch(document: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json: async () => document })),
  );
}

beforeEach(() => {
  __resetDiscoveryForTests();
  sessionStorage.clear();
  assigned = [];
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      origin: 'https://app.example.test',
      search: '',
      assign: (url: string) => assigned.push(url),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetDiscoveryForTests();
});

describe('configuration', () => {
  it('is absent until both values are set, so the UI can offer the fallback', () => {
    expect(configFrom({ VITE_OIDC_CLIENT_ID: CLIENT })).toBeNull();
    expect(configFrom({ VITE_OIDC_ISSUER: ISSUER })).toBeNull();
    expect(configFrom({})).toBeNull();
    expect(configFrom({ VITE_OIDC_ISSUER: ISSUER, VITE_OIDC_CLIENT_ID: CLIENT })).toEqual(CONFIG);
  });

  it('trims a trailing slash, because `iss` is compared byte for byte', () => {
    expect(
      configFrom({ VITE_OIDC_ISSUER: `${ISSUER}/`, VITE_OIDC_CLIENT_ID: CLIENT })?.issuer,
    ).toBe(ISSUER);
  });

  it('is absent in this build, so the paste-box fallback is what renders here', () => {
    // No VITE_OIDC_* is set when the suite runs, which is the same state a
    // deployment is in before `setup-zitadel.sh` has run — and the reason
    // `Login.tsx` keeps the fallback rather than rendering an empty screen.
    expect(oidcConfig()).toBeNull();
  });

  it('REFUSES to start a flow when nothing is configured', async () => {
    await expect(beginSignIn(null)).rejects.toThrow(/not configured/);
    await expect(completeSignIn('?code=abc&state=s', null)).rejects.toThrow(/not configured/);
  });

  it('sends the browser back to the path the setup script registers', () => {
    expect(redirectUri()).toBe('https://app.example.test/auth/callback');
  });
});

describe('discovery', () => {
  it('asks the standard path and uses whatever endpoints come back', async () => {
    stubFetch(DOCUMENT);
    const endpoints = await discover(ISSUER);
    expect(endpoints.authorization_endpoint).toBe(DOCUMENT.authorization_endpoint);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe(
      `${ISSUER}/.well-known/openid-configuration`,
    );
  });

  it('REFUSES a document that declares a different issuer', async () => {
    stubFetch({ ...DOCUMENT, issuer: 'https://evil.example' });
    await expect(discover(ISSUER)).rejects.toThrow(/declares a different issuer/);
  });

  it('does not cache a failure — a provider still starting must not poison the tab', async () => {
    stubFetch({}, false, 503);
    await expect(discover(ISSUER)).rejects.toThrow();

    stubFetch(DOCUMENT);
    await expect(discover(ISSUER)).resolves.toMatchObject({ issuer: ISSUER });
  });

  it('caches success, so two callers share one request', async () => {
    stubFetch(DOCUMENT);
    await Promise.all([discover(ISSUER), discover(ISSUER)]);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});

describe('beginSignIn', () => {
  it('leaves for the issuer with S256 and a public client', async () => {
    stubFetch(DOCUMENT);
    await beginSignIn(CONFIG);

    expect(assigned).toHaveLength(1);
    const url = new URL(assigned[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(DOCUMENT.authorization_endpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe(CLIENT);
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/auth/callback');
    // A public client sends no secret. Shipping one to every visitor is not a
    // secret, which is the whole reason PKCE is here.
    expect(url.searchParams.get('client_secret')).toBeNull();
  });

  it('sends a CHALLENGE, never the verifier itself', async () => {
    stubFetch(DOCUMENT);
    await beginSignIn(CONFIG);

    const verifier = sessionStorage.getItem('oidc_code_verifier')!;
    const challenge = new URL(assigned[0]!).searchParams.get('code_challenge')!;
    expect(verifier).toBeTruthy();
    // The point of PKCE: what travels is the hash, so intercepting the redirect
    // does not give anybody what is needed to redeem the code.
    expect(challenge).not.toBe(verifier);
    expect(challenge).not.toContain(verifier);
  });

  it('keeps the verifier in sessionStorage, not localStorage', () => {
    // It is good for one exchange in one tab. A value that outlives the flow is
    // a value that can be replayed against a later one.
    stubFetch(DOCUMENT);
    return beginSignIn(CONFIG).then(() => {
      expect(sessionStorage.getItem('oidc_code_verifier')).toBeTruthy();
      expect(localStorage.getItem('oidc_code_verifier')).toBeNull();
    });
  });

  it('mints a different verifier every time', async () => {
    stubFetch(DOCUMENT);
    await beginSignIn(CONFIG);
    const first = sessionStorage.getItem('oidc_code_verifier');
    __resetDiscoveryForTests();
    stubFetch(DOCUMENT);
    await beginSignIn(CONFIG);
    expect(sessionStorage.getItem('oidc_code_verifier')).not.toBe(first);
  });
});

describe('completeSignIn', () => {
  const startFlow = async () => {
    stubFetch(DOCUMENT);
    await beginSignIn(CONFIG);
    return sessionStorage.getItem('oidc_state')!;
  };

  it('exchanges the code with the verifier and returns the ID token', async () => {
    const state = await startFlow();
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'the-access-token', id_token: 'the-id-token' }),
        };
      }),
    );

    expect(await completeSignIn(`?code=abc&state=${state}`, CONFIG)).toBe('the-id-token');

    const [url, init] = calls[0]!;
    expect(url).toBe(DOCUMENT.token_endpoint);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('client_secret')).toBeNull();
  });

  it('does NOT return the access token, which carries no email address', async () => {
    // The API requires `sub` and `email` (ADR-0042): invitations are addressed
    // to an email address, and somebody signing in for the first time has no
    // row anywhere to look one up in. Zitadel puts user info claims in the ID
    // token and NOT in the access token — measured against a live instance with
    // `idTokenUserinfoAssertion` both off and on:
    //
    //   access token  iss sub aud exp iat nbf client_id jti      (both ways)
    //   ID token      ... + email email_verified name ...        (flag ON)
    //
    // Returning the access token is a sign-in that completes and then has every
    // single request refused for "Missing required claims in token payload".
    const state = await startFlow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'the-access-token' }),
      })),
    );

    await expect(completeSignIn(`?code=abc&state=${state}`, CONFIG)).rejects.toThrow(
      /refused the exchange/,
    );
  });

  it('REFUSES a state that does not match — this is the CSRF defence', async () => {
    await startFlow();
    await expect(completeSignIn('?code=abc&state=somebody-elses', CONFIG)).rejects.toThrow(
      /did not start in this browser tab/,
    );
  });

  it('refuses when there is no flow in progress at all', async () => {
    sessionStorage.clear();
    await expect(completeSignIn('?code=abc&state=anything', CONFIG)).rejects.toThrow(
      /did not start in this browser tab/,
    );
  });

  it('consumes the verifier even when the exchange fails', async () => {
    // A failed attempt must not leave one behind for a second try to reuse.
    const state = await startFlow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })),
    );

    await expect(completeSignIn(`?code=abc&state=${state}`, CONFIG)).rejects.toThrow(/invalid_grant/);
    expect(sessionStorage.getItem('oidc_code_verifier')).toBeNull();
    expect(sessionStorage.getItem('oidc_state')).toBeNull();
  });

  it("passes the issuer's own refusal through, rather than paraphrasing it", async () => {
    await startFlow();
    await expect(
      completeSignIn('?error=access_denied&error_description=You+said+no', CONFIG),
    ).rejects.toThrow(/You said no/);
  });

  it('refuses a callback carrying a state but no code', async () => {
    const state = await startFlow();
    await expect(completeSignIn(`?state=${state}`, CONFIG)).rejects.toThrow(/no authorization code/);
  });
});
