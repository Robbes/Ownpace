// Copyright 2026 OpenHands Agent (Apache-2.0)
// MSAL-based OAuth2 Token Provider with expiry-aware caching and single-flight refresh.
// Supports client-credentials flow (client secret or certificate) and refresh-token flow (delegated).

import type {
  TokenProvider,
  TokenProviderConfig,
  OAuth2Token,
  TokenStatus,
} from "@openmig/shared";

/**
 * MSAL-based TokenProvider implementation.
 * 
 * Features:
 * - Expiry-aware caching (refresh 5 minutes before expiry)
 * - Single-flight refresh (concurrent callers share one refresh via Promise locking)
 * - Supports client-credentials flow (client secret or certificate)
 * - Supports refresh-token flow (delegated)
 * - No secret material ever logged
 */
/**
 * Entra's refusal, in its own words. The token endpoint answers a refused
 * exchange as JSON with `error` (invalid_grant, invalid_client, …) and
 * `error_description`, whose first sentence carries the AADSTS code; anything
 * else comes back as the head of the body. The request is never echoed.
 */
function entraRefusal(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    const code = typeof parsed.error === "string" ? parsed.error : "";
    const description = typeof parsed.error_description === "string" ? parsed.error_description : "";
    if (code || description) return [code, description].filter((s) => s.length > 0).join(": ");
  } catch {
    // not JSON — fall through to the raw head
  }
  return text.slice(0, 500);
}

export class MsalTokenProvider implements TokenProvider {
  private readonly config: TokenProviderConfig;
  private cachedToken: OAuth2Token | null = null;
  private refreshPromise: Promise<OAuth2Token> | null = null;
  private readonly refreshBufferSeconds = 300; // 5 minutes before expiry

  constructor(config: TokenProviderConfig) {
    this.config = config;
  }

  /**
   * Get the current access token, refreshing if necessary.
   * Returns a token that is guaranteed to be valid (not expired) at the time of return.
   * Concurrent callers will share a single refresh request (single-flight).
   */
  async getToken(): Promise<OAuth2Token> {
    // Check if we have a valid cached token
    if (this.cachedToken && this.isTokenValidInternal(this.cachedToken)) {
      // Token is still valid, return it
      return this.cachedToken;
    }

    // Token is expired or about to expire, need to refresh
    // Use single-flight pattern: if a refresh is already in progress, join it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = this.refreshInternal();
    try {
      const token = await this.refreshPromise;
      this.cachedToken = token;
      return token;
    } catch (error) {
      // Clear cached token on error
      this.cachedToken = null;
      throw error;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Force refresh the access token.
   * Returns the new token and updates the cache.
   */
  async refresh(): Promise<OAuth2Token> {
    // Clear any cached token to force a refresh
    this.cachedToken = null;
    return this.getToken();
  }

  /**
   * Check if the current cached token is valid (not expired and not about to expire).
   */
  isTokenValid(): boolean {
    if (!this.cachedToken) {
      return false;
    }
    return this.isTokenValidInternal(this.cachedToken);
  }

  /**
   * Get detailed token status.
   */
  getTokenStatus(): TokenStatus {
    if (!this.cachedToken) {
      return {
        isValid: false,
        timeUntilExpiry: 0,
      };
    }

    const now = Date.now();
    const expiresAt = this.cachedToken.expiresAt;
    const timeUntilExpiry = expiresAt - now;

    return {
      isValid: timeUntilExpiry > this.refreshBufferSeconds * 1000,
      timeUntilExpiry: Math.floor(timeUntilExpiry / 1000),
      tokenType: this.cachedToken.tokenType,
      scope: this.cachedToken.scope,
    };
  }

  /**
   * Internal refresh logic with single-flight pattern.
   */
  private async refreshInternal(): Promise<OAuth2Token> {
    try {
      let token: OAuth2Token;

      // THE DELEGATED FLOW WINS WHEN THERE IS A REFRESH TOKEN (2026-09-06).
      //
      // This asked "is there a client secret?" first, which was right for the
      // two shapes it was written for — an app registration with a secret
      // (application permissions) or a refresh token from a public client
      // (delegated, no secret) — and wrong for the third shape the Connect
      // with Microsoft button produces: a CONFIDENTIAL client's secret AND
      // the refresh token its consent minted. That shape took the
      // client-credentials branch, asked for delegated scopes under
      // `/common`, and MSAL refused it before the request was sent
      // (`missing_tenant_id_error`). A refresh token is the person's grant;
      // where one is present it is the flow, and the secret rides along as
      // the confidential client's proof (below).
      if (this.config.refreshToken || (this.config.username && this.config.password)) {
        token = await this.acquireTokenWithRefreshToken();
      } else if (this.config.clientSecret || this.config.clientCertificateKey) {
        token = await this.acquireTokenWithClientCredentials();
      } else {
        throw new Error(
          "TokenProvider requires either client credentials (secret/certificate) or user credentials (refresh token or username/password)"
        );
      }

      // Cache the token
      this.cachedToken = token;
      return token;
    } catch (error) {
      // Clear cached token on error
      this.cachedToken = null;
      throw error;
    }
  }

  /**
   * Acquire token using client-credentials flow.
   */
  private async acquireTokenWithClientCredentials(): Promise<OAuth2Token> {
    // Dynamically import MSAL to avoid hard dependency
    const msalNode = await import("@azure/msal-node");

    // Build MSAL configuration
    const authority = this.config.tenantId
      ? `https://login.microsoftonline.com/${this.config.tenantId}`
      : "https://login.microsoftonline.com/common";

    const msalConfig = {
      auth: {
        clientId: this.config.clientId,
        authority,
        clientSecret: this.config.clientSecret,
        ...(this.config.clientCertificateKey && this.config.clientCertificateThumbprint
          ? {
              clientCertificate: {
                thumbprintSha256: this.config.clientCertificateThumbprint,
                privateKey: this.config.clientCertificateKey,
              },
            }
          : {}),
      },
    };

    const confidentialClientApp = new msalNode.ConfidentialClientApplication(msalConfig);

    const tokenResponse = await confidentialClientApp.acquireTokenByClientCredential({
      scopes: this.config.scope.split(" "),
    });

    if (!tokenResponse) {
      throw new Error("MSAL client credentials flow returned no token");
    }

    return this.mapMsalTokenResponse(tokenResponse);
  }

  /**
   * Acquire token using refresh-token flow.
   */
  /**
   * THE DELEGATED FLOW IS ONE POST, NOT MSAL (2026-09-06, the second live Test).
   *
   * MSAL's refresh path adds `openid profile offline_access` to every request,
   * and this method used to report its refusal as nothing at all: the error
   * was caught, the code fell through to a username/password branch that had
   * no username, and what came out was "Failed to acquire token with refresh
   * token or username/password" — on every face, minutes after the grant read
   * had exchanged the SAME refresh token successfully with a plain POST to the
   * same endpoint. So this is that POST: the tenant's token endpoint,
   * `grant_type=refresh_token`, the client secret where the registration has
   * one (a confidential client redeems with it), and exactly the scopes the
   * source asked for — nothing MSAL would add on its own. Entra's refusal
   * reaches the caller VERBATIM, `error` and `error_description` both, which
   * is where the AADSTS code that names the consent, the tenant or the
   * registration lives. The Google provider has answered this way since 0089.
   *
   * Username/password (ROPC) stays on MSAL's public client: it is the one
   * delegated shape with no refresh token, and nothing here offers it a secret.
   */
  private async acquireTokenWithRefreshToken(): Promise<OAuth2Token> {
    if (this.config.refreshToken) {
      return this.redeemRefreshToken(this.config.refreshToken);
    }

    // Dynamically import MSAL to avoid hard dependency
    const msalNode = await import("@azure/msal-node");
    const authority = this.config.tenantId
      ? `https://login.microsoftonline.com/${this.config.tenantId}`
      : "https://login.microsoftonline.com/common";
    const publicClientApp = new msalNode.PublicClientApplication({
      auth: { clientId: this.config.clientId, authority },
    });

    if (this.config.username && this.config.password) {
      const tokenResponse = await publicClientApp.acquireTokenByUsernamePassword({
        scopes: this.config.scope.split(" "),
        username: this.config.username,
        password: this.config.password,
      });

      if (tokenResponse) {
        return this.mapMsalTokenResponse(tokenResponse);
      }
    }

    throw new Error("Failed to acquire token with refresh token or username/password");
  }

  private async redeemRefreshToken(refreshToken: string): Promise<OAuth2Token> {
    const endpoint = this.config.tokenEndpoint;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      refresh_token: refreshToken,
      scope: this.config.scope,
      ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}),
    }).toString();

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new Error(
        `The token endpoint at ${endpoint} could not be reached: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(
        `Microsoft refused the refresh-token exchange (${response.status}): ${entraRefusal(text)}`,
      );
    }

    let parsed: {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
      refresh_token?: string;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `Microsoft's token endpoint answered ${response.status} with something that is not JSON: ${text.slice(0, 500)}`,
      );
    }
    if (!parsed.access_token) {
      throw new Error(
        `Microsoft's token endpoint answered ${response.status} with no access_token: ${text.slice(0, 500)}`,
      );
    }
    return {
      accessToken: parsed.access_token,
      expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
      tokenType: parsed.token_type ?? "Bearer",
      refreshToken: parsed.refresh_token,
      scope: parsed.scope ?? this.config.scope,
    };
  }

  /**
   * Map MSAL token response to our OAuth2Token interface.
   */
  private mapMsalTokenResponse(response: {
    accessToken: string;
    idToken?: string | null;
    refreshToken?: string;
    expiresOn?: Date | null;
    tokenType?: string;
    scope?: string;
  }): OAuth2Token {
    const expiresAt = response.expiresOn
      ? response.expiresOn.getTime()
      : Date.now() + 3600000; // Default to 1 hour if not provided

    return {
      accessToken: response.accessToken,
      expiresAt,
      tokenType: response.tokenType || "Bearer",
      refreshToken: response.refreshToken,
      scope: response.scope || this.config.scope,
    };
  }

  /**
   * Check if a token is valid (not expired and not about to expire).
   */
  private isTokenValidInternal(token: OAuth2Token): boolean {
    if (!token.expiresAt) {
      return false;
    }
    const now = Date.now();
    const expiresAt = token.expiresAt;
    const timeUntilExpiry = expiresAt - now;
    
    // Consider token expired if it expires within the refresh buffer
    return timeUntilExpiry > this.refreshBufferSeconds * 1000;
  }
}

/**
 * Create a TokenProvider instance from configuration.
 */
export function createTokenProvider(config: TokenProviderConfig): TokenProvider {
  return new MsalTokenProvider(config);
}
