// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Authorization-code + PKCE against whatever issuer is configured (ADR-0042).
 *
 * **No library, and no provider's URL shapes.** Every endpoint is read from the
 * issuer's `/.well-known/openid-configuration`, exactly as the API reads
 * `jwks_uri` from it — which is what keeps ADR-0042's "the issuer is
 * REPLACEABLE" true on this side of the wire too. `no-issuer-lock-in.unit.test.ts`
 * scans `apps/web/src` as well as the API, so a hard-coded `/oauth/v2/authorize`
 * fails the build rather than quietly pinning the product to one vendor.
 *
 * The flow is written out rather than taken from a dependency because it is
 * ~120 lines of standard, and the alternative is a package in the browser bundle
 * on the path that authenticates people. Everything here is `crypto.subtle` and
 * `fetch`.
 *
 * WHY PKCE AND NO CLIENT SECRET: this is a single-page app. A confidential
 * client would mean shipping a secret to every visitor, which is not a secret —
 * so the code exchange is proven instead by a verifier only this tab ever held.
 * `setup-zitadel.sh` provisions the client as public for the same reason.
 */

type ViteEnv = {
  readonly VITE_OIDC_ISSUER?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
};

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
}

/**
 * The configuration a build carries, as a pure function of the environment.
 *
 * Separate from `oidcConfig()` because `import.meta.env` IS NOT SHARED BETWEEN
 * MODULES — vitest gives each one its own object, so a test that sets
 * `import.meta.env.VITE_OIDC_ISSUER` sets it on the test file and this module
 * never sees it. That is not a testing inconvenience to work around; it is the
 * reason every function below takes its config as an argument and only defaults
 * to the build's. `edition.ts` reaches the same conclusion from the other
 * direction (there the value is a `define` literal by run time).
 */
export function configFrom(source: ViteEnv): OidcConfig | null {
  const { VITE_OIDC_ISSUER: issuer, VITE_OIDC_CLIENT_ID: clientId } = source;
  if (!issuer || !clientId) return null;
  // `iss` is compared byte for byte, here and in the API — a trailing slash is
  // the difference between a match and a refusal.
  return { issuer: issuer.replace(/\/+$/, ''), clientId };
}

/** Configured at BUILD time, like every other VITE_ value — see managed.env.example. */
export function oidcConfig(): OidcConfig | null {
  return configFrom((import.meta as unknown as { env?: ViteEnv }).env ?? {});
}

/** The subset of the discovery document this app uses. */
export interface Endpoints {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly end_session_endpoint?: string;
}

const discovered = new Map<string, Promise<Endpoints>>();

/**
 * Ask the issuer where its endpoints are.
 *
 * Cached as a PROMISE so two simultaneous callers share one request rather than
 * racing — the same reason `JmapTargetWriter` holds its session that way. Keyed
 * by issuer rather than held in one slot, so the cache can never answer for an
 * issuer nobody asked about.
 */
export function discover(issuer: string): Promise<Endpoints> {
  const cached = discovered.get(issuer);
  if (cached) return cached;
  const pending = (async () => {
    const url = `${issuer}/.well-known/openid-configuration`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `The sign-in service did not answer at ${url} (${response.status}). ` +
          'VITE_OIDC_ISSUER must be the issuer URL the provider publishes.',
      );
    }
    const document = (await response.json()) as Partial<Endpoints> & { issuer?: string };
    if (document.issuer !== issuer) {
      // Same check the API makes, and for the same reason (OIDC Discovery §4.3):
      // a document that declares a different issuer is not this issuer, and
      // following its endpoints would send somebody's credentials elsewhere.
      throw new Error(
        `The sign-in service at ${url} declares a different issuer ` +
          `(${String(document.issuer)}). Refusing to send anyone there.`,
      );
    }
    if (!document.authorization_endpoint || !document.token_endpoint) {
      throw new Error(`The sign-in service at ${url} published no usable endpoints.`);
    }
    return document as Endpoints;
  })().catch((error: unknown) => {
    // Never cache a failure: a provider that was starting up must not poison
    // every later attempt in this tab.
    discovered.delete(issuer);
    throw error;
  });
  discovered.set(issuer, pending);
  return pending;
}

/** Reset the cached documents. Tests only. */
export function __resetDiscoveryForTests(): void {
  discovered.clear();
}

// ---------------------------------------------------------------------- PKCE --

const VERIFIER_KEY = 'oidc_code_verifier';
const STATE_KEY = 'oidc_state';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * The browser's own window, typed the way `services/api.ts` types it.
 *
 * The root `tsc` covers this file with the Node lib rather than DOM (a `lib` is
 * program-wide, so `test/ui` is a separate project for the same reason —
 * AGENTS.md). `api.ts` reaches for `location` through exactly this cast; one
 * idiom rather than two.
 */
const browser = globalThis as unknown as {
  location: { origin: string; assign: (url: string) => void };
};

/** Where the issuer sends the browser back. Registered by `setup-zitadel.sh`. */
export function redirectUri(): string {
  return `${browser.location.origin}/auth/callback`;
}

/**
 * Begin sign-in: mint a verifier, remember it, and leave for the issuer.
 *
 * The verifier and state live in `sessionStorage`, not `localStorage`, and that
 * is deliberate — they are good for one exchange in one tab, and a value that
 * outlives the flow is a value that can be replayed against a later one.
 *
 * `config` defaults to the build's, which is what every caller uses; it is an
 * argument at all so this flow can be exercised against a configuration without
 * a build (see `configFrom`).
 */
export async function beginSignIn(config: OidcConfig | null = oidcConfig()): Promise<void> {
  if (!config) throw new Error('Sign-in is not configured (VITE_OIDC_ISSUER / VITE_OIDC_CLIENT_ID).');

  const { authorization_endpoint } = await discover(config.issuer);
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });
  browser.location.assign(`${authorization_endpoint}?${params.toString()}`);
}

/**
 * Where to send the browser so the ISSUER'S session ends too, or null.
 *
 * ## The defect this exists for
 *
 * "Sign out" cleared `localStorage` and the store and sent the browser to
 * `/login`, which ends the APP's session and nothing else. The issuer's own
 * cookie survived, so pressing "Sign in" completed the whole
 * authorization-code round trip without a single prompt and put the same person
 * straight back in. The owner found it on 2026-09-01, one press after signing
 * out: *"pressing sign in then didn't ask me anything again, it just rolled
 * through, without any new signin, why not ask again?"*
 *
 * It reads like a cosmetic annoyance and it is not one. On a borrowed laptop or
 * a shared desk, "sign out" that leaves the issuer signed in means the next
 * person to press "Sign in" is in your account, having proved nothing. The word
 * on the button is a promise about the whole session, not about this tab's copy
 * of a token.
 *
 * ## What this builds
 *
 * RP-initiated logout (OIDC RP-Initiated Logout 1.0): the issuer publishes
 * `end_session_endpoint` in its discovery document, and a browser sent there
 * with `id_token_hint` ends the session and returns to
 * `post_logout_redirect_uri`.
 *
 * **`id_token_hint` is what makes it silent AND safe.** It names the session to
 * end, so the issuer neither asks "log out of what?" nor takes an unauthenticated
 * caller's word for which redirect is allowed. It is also why the app keeps the
 * ID token rather than the access token (see `completeSignIn` above) — the hint
 * has to be an ID token issued to this client.
 *
 * **The redirect must already be registered**, and it is: `setup-zitadel.sh`
 * writes `postLogoutRedirectUris: ["${WEB_URL}/login"]` when it provisions the
 * application, and reconciles it on every re-run. An unregistered value is
 * refused by the issuer rather than followed, which is the whole point of
 * registering it — so this sends exactly that URL and does not invent one from
 * wherever the browser happens to be.
 *
 * ## Null, and why the caller must handle it rather than this throwing
 *
 * Three ordinary cases answer null: a deployment with no issuer at all (the
 * paste-a-token door, which has no remote session to end), an issuer whose
 * discovery document publishes no `end_session_endpoint`, and a caller with no
 * ID token to hint with. None is an error and none should stop a sign-out: the
 * local half must still happen. The caller signs out locally either way and
 * only ADDS this leg when there is one — which also means an issuer that cannot
 * be reached leaves somebody signed out here rather than stuck.
 */
export async function signOutUrl(
  idToken: string | null | undefined,
  config: OidcConfig | null = oidcConfig(),
): Promise<string | null> {
  if (!config || !idToken) return null;

  let endpoints: Endpoints;
  try {
    endpoints = await discover(config.issuer);
  } catch {
    // An unreachable issuer must not trap somebody in a half-signed-out state.
    // The local half has already happened; this leg is the one we can lose.
    return null;
  }
  const endpoint = endpoints.end_session_endpoint;
  if (!endpoint) return null;

  const params = new URLSearchParams({
    id_token_hint: idToken,
    post_logout_redirect_uri: `${browser.location.origin}/login`,
    client_id: config.clientId,
  });
  return `${endpoint}?${params.toString()}`;
}

/**
 * Finish sign-in: check the state, exchange the code, return the ID token.
 *
 * **THE ID TOKEN, NOT THE ACCESS TOKEN, AND THAT IS NOT A SLIP.** The API needs
 * `email` — narrowed to `sub` + `email` and nothing else by ADR-0042, because
 * invitations are addressed to an email address and a first-time signer-in has
 * no database row to look one up in. Zitadel puts user info claims in the ID
 * token and NOT in the access token: with `idTokenUserinfoAssertion` on, the ID
 * token carries `email`, `email_verified`, `name` and the rest, and the JWT
 * access token carries `iss/sub/aud/exp/iat/nbf/client_id/jti` with the flag on
 * or off. Measured on a live instance, both ways.
 *
 * Sending the access token instead is what the code used to do, and the API
 * refused every request with "Missing required claims in token payload" — a
 * sign-in that completes and then cannot be used.
 *
 * It is a legitimate bearer here rather than a shortcut: the ID token's audience
 * is `[client id, PROJECT id]`, and `JWT_AUDIENCE` is that project id, so the
 * API validates issuer, audience, signature and expiry exactly as it would for
 * an access token. It is not a token borrowed from a different audience.
 *
 * **The state check is the CSRF defence** and comes first: without it, an
 * attacker can hand somebody a callback URL carrying a code from the attacker's
 * own session, and the victim ends up signed in as them. A mismatch is a
 * refusal, never a retry.
 *
 * The verifier is consumed either way — a failed exchange must not leave one
 * behind for a second attempt to reuse.
 */
export async function completeSignIn(
  search: string,
  config: OidcConfig | null = oidcConfig(),
): Promise<string> {
  if (!config) throw new Error('Sign-in is not configured.');

  const params = new URLSearchParams(search);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  // The issuer's own refusal, passed through rather than paraphrased: it says
  // things like `access_denied` that a person can act on.
  const error = params.get('error');
  if (error) {
    throw new Error(params.get('error_description') || error);
  }

  const state = params.get('state');
  if (!expectedState || state !== expectedState) {
    throw new Error(
      'This sign-in did not start in this browser tab. Start again from the sign-in page.',
    );
  }

  const code = params.get('code');
  if (!code) throw new Error('The sign-in service returned no authorization code.');
  if (!verifier) throw new Error('This tab has no sign-in in progress. Start again.');

  const { token_endpoint } = await discover(config.issuer);
  const response = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: config.clientId,
      code_verifier: verifier,
    }).toString(),
  });

  const body = (await response.json().catch(() => ({}))) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.id_token) {
    throw new Error(
      body.error_description || body.error || `The sign-in service refused the exchange (${response.status}).`,
    );
  }
  return body.id_token;
}
