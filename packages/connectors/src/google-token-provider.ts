// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Google's OAuth2 refresh-token flow (workplan 0042 T5).
 *
 * WHY NOT `createTokenProvider`, which already exists. Because it is MSAL. Every
 * flow `MsalTokenProvider` implements builds an authority under
 * `login.microsoftonline.com` and hands the credentials there; `TokenProviderConfig`
 * carries a `tokenEndpoint` field that LOOKS like the seam which would redirect
 * it, and that field is never read. Reusing it for Google would post a Google
 * refresh token to Microsoft's token endpoint — a credential disclosure that
 * would present as a login failure.
 *
 * So this is a second implementation of the same PORT (`TokenProvider`), which is
 * what a port is for, rather than a second copy of one provider.
 *
 * SCOPE. `drive.readonly`, and the source is the only caller. A migration reads;
 * nothing in this product writes to a Google Drive, and a token that cannot write
 * is the cheapest possible guarantee of that. Widening it is a decision somebody
 * should have to make in this file.
 *
 * WHAT IT WILL NOT DO. Service accounts (the JWT-bearer grant, with or without
 * domain-wide delegation) are not implemented. A domain-wide-delegated service
 * account can read every user's Drive in the tenant from one credential, which is
 * the convenient way to run a Workspace migration and also the reason it is not
 * here yet: it needs the same explicit scoping decision `docs/o365-application-access.md`
 * records for the Microsoft equivalent. Until then a Drive migration uses a
 * delegated refresh token, which reads exactly one user's Drive — the one who
 * consented.
 */

import type { OAuth2Token, TokenProvider, TokenStatus } from '@openmig/shared';

/** Google's token endpoint. Overridable so a test never reaches Google. */
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Read-only Drive. See the file header: a migration reads. */
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Re-mint this long before expiry.
 *
 * Five minutes, the same buffer `MsalTokenProvider` uses. A pass can take longer
 * than a token lives, and a token that expires mid-folder fails an item that has
 * nothing wrong with it.
 */
const REFRESH_BUFFER_MS = 300_000;

/** The one seam to the world: a function, so a unit test can be a literal. */
export type TokenFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

/** A delegated Google credential: the three values the refresh grant needs. */
export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface GoogleTokenProviderOptions {
  readonly tokenEndpoint?: string;
  /** Defaults to {@link DRIVE_READONLY_SCOPE}. */
  readonly scope?: string;
  readonly fetchImpl?: TokenFetch;
}

/** Google's token response, reduced to the fields used. */
interface GoogleTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly token_type?: string;
  readonly scope?: string;
}

export class GoogleTokenProvider implements TokenProvider {
  private readonly endpoint: string;
  private readonly scope: string;
  private readonly fetchImpl: TokenFetch;
  private cached: OAuth2Token | null = null;
  /** Held for the duration of one mint, so concurrent callers share it. */
  private inFlight: Promise<OAuth2Token> | null = null;

  constructor(
    private readonly creds: GoogleOAuthCredentials,
    options: GoogleTokenProviderOptions = {},
  ) {
    // Refused HERE, before any request, rather than letting Google answer
    // `invalid_client` — which is the same error it returns for a client id
    // that was deleted, and an operator cannot tell those apart (rule 9).
    // Callers refuse first, in their own vocabulary (see drive-source-factory);
    // this is the guard for a third caller that has not been written yet.
    const missing = (['clientId', 'clientSecret', 'refreshToken'] as const).filter(
      (k) => !creds[k],
    );
    if (missing.length > 0) {
      throw new Error(
        `Google OAuth credentials are incomplete: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} empty. ` +
          'All three are required for the refresh-token grant.',
      );
    }
    this.endpoint = options.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT;
    this.scope = options.scope ?? DRIVE_READONLY_SCOPE;
    this.fetchImpl = options.fetchImpl ?? defaultTokenFetch;
  }

  async getToken(): Promise<OAuth2Token> {
    if (this.cached && this.stillValid(this.cached)) return this.cached;
    // Single-flight: a files pass runs items concurrently, and a token that
    // expires mid-pass would otherwise have every in-flight item post its own
    // refresh at once — N requests where one will do, and Google rate-limits
    // the token endpoint like everything else.
    if (this.inFlight) return this.inFlight;
    return this.mint();
  }

  /** Force a mint, ignoring the cache — what a 401 calls after a token is rejected. */
  async refresh(): Promise<OAuth2Token> {
    this.cached = null;
    // Deliberately joins an in-flight mint rather than starting a second one:
    // when several concurrent items each see a 401 they are all reacting to the
    // SAME dead token, and one replacement serves all of them.
    if (this.inFlight) return this.inFlight;
    return this.mint();
  }

  isTokenValid(): boolean {
    return this.cached !== null && this.stillValid(this.cached);
  }

  getTokenStatus(): TokenStatus {
    if (!this.cached) return { isValid: false, timeUntilExpiry: 0 };
    const timeUntilExpiry = this.cached.expiresAt - Date.now();
    return {
      isValid: timeUntilExpiry > REFRESH_BUFFER_MS,
      timeUntilExpiry: Math.floor(timeUntilExpiry / 1000),
      tokenType: this.cached.tokenType,
      scope: this.cached.scope,
    };
  }

  private mint(): Promise<OAuth2Token> {
    const pending = this.requestToken()
      .then((token) => {
        this.cached = token;
        return token;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = pending;
    return pending;
  }

  private async requestToken(): Promise<OAuth2Token> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      refresh_token: this.creds.refreshToken,
      scope: this.scope,
    }).toString();

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    // Read in FULL. An earlier version truncated here for the error path's
    // benefit and truncated the success path with it — a Google access token
    // runs to hundreds of characters and `ya29.` tokens are routinely longer
    // than any cap worth putting on an error message, so a real response would
    // have failed to parse while every fake in the suite fitted. Truncation
    // belongs at the point of building a message, not at the point of reading.
    const text = await safeText(response);
    if (!response.ok) {
      // Google's own words, verbatim (rule 9) — and NOT the request, which
      // carries the client secret and the refresh token. An error message ends
      // up in logs and in the failures queue an owner reads.
      const shown = text.slice(0, 500);
      throw new Error(
        `Google refused the token request (${response.status}): ${shown}${hintFor(shown)}`,
      );
    }

    let parsed: GoogleTokenResponse;
    try {
      parsed = JSON.parse(text) as GoogleTokenResponse;
    } catch {
      throw new Error(
        `Google's token endpoint answered ${response.status} with something that is not JSON: ${text}`,
      );
    }

    if (!parsed.access_token) {
      throw new Error(
        `Google's token endpoint answered ${response.status} with no access_token: ${text}`,
      );
    }

    return {
      accessToken: parsed.access_token,
      // `expires_in` is seconds from now. Absent (which Google does not do, but
      // a proxy might) is treated as an hour, Google's own default lifetime.
      expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
      tokenType: parsed.token_type ?? 'Bearer',
      // The scope GRANTED, which can be narrower than the scope asked for —
      // worth carrying, because a Drive read failing with 403 on a token that
      // minted fine is usually this.
      scope: parsed.scope ?? this.scope,
    };
  }

  private stillValid(token: OAuth2Token): boolean {
    return token.expiresAt - Date.now() > REFRESH_BUFFER_MS;
  }
}

/**
 * `invalid_grant` is the failure an operator will actually hit, and Google's
 * body says nothing about why. Naming the three real causes turns a dead end
 * into an action (rule 9).
 */
function hintFor(body: string): string {
  if (!body.includes('invalid_grant')) return '';
  return (
    ' — "invalid_grant" from Google means the refresh token is no longer usable: it was revoked ' +
    '(including by a password change), it expired after six months unused, or it was issued to a ' +
    'different client id than the one configured here. Re-consent to get a new one.'
  );
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no body)';
  }
}

const defaultTokenFetch: TokenFetch = (url, init) =>
  fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body });

/** Convenience mirror of `createTokenProvider`, for callers that build by config. */
export function createGoogleTokenProvider(
  creds: GoogleOAuthCredentials,
  options: GoogleTokenProviderOptions = {},
): TokenProvider {
  return new GoogleTokenProvider(creds, options);
}
