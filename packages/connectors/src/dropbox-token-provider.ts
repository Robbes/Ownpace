// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Dropbox's OAuth2 refresh-token flow (workplan 0055).
 *
 * A third implementation of the `TokenProvider` PORT, for the same reason the
 * Google one is not MSAL: each provider's endpoint, parameter names and
 * failure vocabulary are its own, and a "generic" provider that posted a
 * Dropbox refresh token to the wrong token endpoint would be a credential
 * disclosure presenting as a login failure.
 *
 * Dropbox names the client credentials "app key" and "app secret" (its App
 * Console's words); the wire parameters are still `client_id`/`client_secret`.
 * Refusals use Dropbox's names, because that is what the operator is reading
 * when they go looking.
 *
 * No scope parameter: a Dropbox refresh token carries the permissions the app
 * was created with (`files.metadata.read` + `files.content.read` are what a
 * migration needs — the setup doc says to create the app read-only).
 */

import type { OAuth2Token, TokenProvider, TokenStatus } from '@openmig/shared';
import type { TokenFetch } from './google-token-provider.ts';

const DROPBOX_TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';
/** Same buffer as the other providers: re-mint well before a pass can outlive the token. */
const REFRESH_BUFFER_MS = 300_000;

export interface DropboxOAuthCredentials {
  /** The App Console's "App key" — `client_id` on the wire. */
  readonly appKey: string;
  /** The App Console's "App secret" — `client_secret` on the wire. */
  readonly appSecret: string;
  readonly refreshToken: string;
}

export interface DropboxTokenProviderOptions {
  readonly tokenEndpoint?: string;
  readonly fetchImpl?: TokenFetch;
}

export class DropboxTokenProvider implements TokenProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: TokenFetch;
  private cached: OAuth2Token | null = null;
  private inFlight: Promise<OAuth2Token> | null = null;

  private readonly creds: DropboxOAuthCredentials;
  constructor(
    creds: DropboxOAuthCredentials,
    options: DropboxTokenProviderOptions = {},
  ) {
    this.creds = creds;
    const missing = (['appKey', 'appSecret', 'refreshToken'] as const).filter((k) => !creds[k]);
    if (missing.length > 0) {
      throw new Error(
        `Dropbox OAuth credentials are incomplete: ${missing.join(', ')} ${
          missing.length === 1 ? 'is' : 'are'
        } empty. All three are required for the refresh-token grant.`,
      );
    }
    this.endpoint = options.tokenEndpoint ?? DROPBOX_TOKEN_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? defaultTokenFetch;
  }

  async getToken(): Promise<OAuth2Token> {
    if (this.cached && this.stillValid(this.cached)) return this.cached;
    if (this.inFlight) return this.inFlight;
    return this.mint();
  }

  async refresh(): Promise<OAuth2Token> {
    this.cached = null;
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
      refresh_token: this.creds.refreshToken,
      client_id: this.creds.appKey,
      client_secret: this.creds.appSecret,
    }).toString();

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const text = await safeText(response);
    if (!response.ok) {
      const shown = text.slice(0, 500);
      throw new Error(
        `Dropbox refused the token request (${response.status}): ${shown}${hintFor(shown)}`,
      );
    }

    let parsed: { access_token?: string; expires_in?: number; token_type?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(
        `Dropbox's token endpoint answered ${response.status} with something that is not JSON: ${text}`,
      );
    }
    if (!parsed.access_token) {
      throw new Error(
        `Dropbox's token endpoint answered ${response.status} with no access_token: ${text}`,
      );
    }
    return {
      accessToken: parsed.access_token,
      // Dropbox short-lived tokens run ~4 hours; absent is treated as one.
      expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
      tokenType: parsed.token_type ?? 'Bearer',
    };
  }

  private stillValid(token: OAuth2Token): boolean {
    return token.expiresAt - Date.now() > REFRESH_BUFFER_MS;
  }
}

/** The refusal an operator will actually hit, with its real causes named (rule 9). */
function hintFor(body: string): string {
  if (!body.includes('invalid_grant')) return '';
  return (
    ' — "invalid_grant" from Dropbox means the refresh token is no longer usable: it was ' +
    'revoked (the app was unlinked from the account), or it was issued by a DIFFERENT app ' +
    'key than the one configured here. Re-run the consent flow for this app to get a new one.'
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
