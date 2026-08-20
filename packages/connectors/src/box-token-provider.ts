// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Box's Client Credentials Grant (workplan 0056) — and WHY it is not the
 * refresh-token flow the Google and Dropbox providers use:
 *
 * **Box rotates refresh tokens on every use.** Each refresh answers a NEW
 * refresh token and invalidates the one just spent. This product's stored
 * credentials are written once, encrypted, and never written back by a pass
 * (the same posture everywhere: connectors read credentials, they do not
 * mutate them) — so a stored Box refresh token would authenticate exactly one
 * pass and break the second, presenting as a credential failure the operator
 * did nothing to cause. The honest fix is not to store a value the provider
 * consumes.
 *
 * Box's supported server flow is the **Client Credentials Grant**: client id
 * + secret, `box_subject_type=user` and `box_subject_id` naming WHOSE content
 * the token reads — one subject per mapping, exactly the shape the M365
 * client-credentials flow and Google DWD (ADR-0033) already have. The app
 * must be authorized once by a Box admin (Admin Console → Apps → Custom Apps
 * Manager); the refusal below names that console, because Box's own error
 * does not.
 */

import type { OAuth2Token, TokenProvider, TokenStatus } from '@openmig/shared';
import type { TokenFetch } from './google-token-provider.ts';

const BOX_TOKEN_ENDPOINT = 'https://api.box.com/oauth2/token';
/** Same buffer as the other providers: re-mint well before a pass can outlive the token. */
const REFRESH_BUFFER_MS = 300_000;

export interface BoxCcgCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The NUMERIC Box user id whose content the token reads — one subject per mapping. */
  readonly subjectUserId: string;
}

export interface BoxTokenProviderOptions {
  readonly tokenEndpoint?: string;
  readonly fetchImpl?: TokenFetch;
}

export class BoxTokenProvider implements TokenProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: TokenFetch;
  private cached: OAuth2Token | null = null;
  private inFlight: Promise<OAuth2Token> | null = null;

  private readonly creds: BoxCcgCredentials;
  constructor(
    creds: BoxCcgCredentials,
    options: BoxTokenProviderOptions = {},
  ) {
    this.creds = creds;
    const missing = (['clientId', 'clientSecret', 'subjectUserId'] as const).filter(
      (k) => !creds[k],
    );
    if (missing.length > 0) {
      throw new Error(
        `Box credentials are incomplete: ${missing.join(', ')} ${
          missing.length === 1 ? 'is' : 'are'
        } empty. The Client Credentials Grant needs all three — the subject user id is which ` +
          "account's files the token reads, and a token without a subject reads nobody's.",
      );
    }
    this.endpoint = options.tokenEndpoint ?? BOX_TOKEN_ENDPOINT;
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
      grant_type: 'client_credentials',
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      box_subject_type: 'user',
      box_subject_id: this.creds.subjectUserId,
    }).toString();

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const text = await safeText(response);
    if (!response.ok) {
      const shown = text.slice(0, 500);
      throw new Error(`Box refused the token request (${response.status}): ${shown}${hintFor(shown)}`);
    }

    let parsed: { access_token?: string; expires_in?: number; token_type?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new Error(
        `Box's token endpoint answered ${response.status} with something that is not JSON: ${text}`,
      );
    }
    if (!parsed.access_token) {
      throw new Error(`Box's token endpoint answered ${response.status} with no access_token: ${text}`);
    }
    return {
      accessToken: parsed.access_token,
      // Box CCG tokens run about an hour; absent is treated as one.
      expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
      tokenType: parsed.token_type ?? 'Bearer',
    };
  }

  private stillValid(token: OAuth2Token): boolean {
    return token.expiresAt - Date.now() > REFRESH_BUFFER_MS;
  }
}

/**
 * The refusals an operator will actually hit, with the causes Box's own
 * errors do not name (rule 9 — the actionable words ride the error).
 */
function hintFor(body: string): string {
  if (body.includes('unauthorized_client')) {
    return (
      ' — "unauthorized_client" from Box usually means the app is NOT AUTHORIZED for this ' +
      'enterprise: a Box admin must approve it once in the Admin Console (Apps → Custom Apps ' +
      'Manager → Add app by Client ID), and re-approve it after its scopes change. It can also ' +
      'mean the app was created without "App + Enterprise Access" / user token generation, ' +
      'which the Client Credentials Grant needs. docs/box-setup.md walks through both.'
    );
  }
  if (body.includes('invalid_client')) {
    return ' — "invalid_client" from Box means the client id or client secret is wrong for this app.';
  }
  if (body.includes('invalid_grant')) {
    return (
      ' — check box_subject_id: it must be the NUMERIC Box user id of the account being ' +
      'migrated (Admin Console → Users & Groups shows it), not an email address.'
    );
  }
  return '';
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
