// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Google's JWT-bearer grant for a domain-wide-delegated service account
 * (ADR-0033, accepted; workplan 0053).
 *
 * The second way into Google, beside `GoogleTokenProvider`'s refresh-token
 * flow — never a replacement for it. A Workspace admin authorises the service
 * account's client id for an enumerated scope list, once, in the Admin
 * console; this provider then mints tokens impersonating ONE named user
 * (`sub`) per instance. The credential can impersonate anybody in the domain;
 * the instance never does — a mapping names one subject, and its provider is
 * built for exactly that subject (ADR-0033 §1).
 *
 * THE ASSERTION IS BUILT HERE, NOT FETCHED: an RS256-signed JWT
 * (iss = the service account's email, sub = the impersonated user, scope,
 * aud = the token endpoint, one-hour life) exchanged at the same endpoint the
 * refresh flow uses, with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.
 *
 * REFUSALS NAME THE DELEGATION, NOT THE SYMPTOM (ADR-0033 §3). Google answers
 * an unauthorised scope or an out-of-domain subject with a bare
 * `unauthorized_client` — a sentence that sends an operator to the OAuth
 * client screen, which is the wrong place. The hint below names the Admin
 * console authorisation as the thing to check, and says to revoke it again at
 * cutover, with Google's own words kept verbatim beside it (hard rule 9).
 */

import { createSign } from 'node:crypto';
import type { OAuth2Token, TokenProvider, TokenStatus } from '@openmig/shared';
import type { TokenFetch } from './google-token-provider.ts';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
/** Same buffer as the refresh flow: re-mint well before a pass can outlive the token. */
const REFRESH_BUFFER_MS = 300_000;

/** The two fields of Google's key file this flow actually uses. */
export interface ParsedServiceAccountKey {
  readonly clientEmail: string;
  readonly privateKey: string;
  /** The key file names its own token endpoint; honoured when present. */
  readonly tokenUri?: string;
}

/**
 * Parse the service-account key FILE as Google hands it out (the JSON from
 * "manage keys" → "add key"). Refusals name what is wrong with the paste,
 * because "invalid_grant" three steps later never will.
 */
export function parseServiceAccountKey(json: string): ParsedServiceAccountKey {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(
      'The service account key is not JSON. Paste the WHOLE key file Google generated ' +
        '(IAM → service account → keys → add key → JSON), not the key id or the client id.',
    );
  }
  if (parsed.type !== 'service_account') {
    throw new Error(
      `The pasted JSON is not a service account key (its "type" is ${JSON.stringify(
        parsed.type ?? 'absent',
      )}, expected "service_account"). An OAuth client file will not work here.`,
    );
  }
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : '';
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : '';
  const missing = [
    ...(clientEmail ? [] : ['client_email']),
    ...(privateKey ? [] : ['private_key']),
  ];
  if (missing.length > 0) {
    throw new Error(
      `The service account key is missing ${missing.join(' and ')} — it is not a complete ` +
        'key file. Generate a fresh JSON key and paste all of it.',
    );
  }
  return {
    clientEmail,
    privateKey,
    ...(typeof parsed.token_uri === 'string' ? { tokenUri: parsed.token_uri } : {}),
  };
}

export interface GoogleDwdOptions {
  readonly tokenEndpoint?: string;
  readonly fetchImpl?: TokenFetch;
  /** Test seam for the clock; production uses Date.now. */
  readonly now?: () => number;
}

const base64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url');

export class GoogleJwtBearerProvider implements TokenProvider {
  private readonly key: ParsedServiceAccountKey;
  private readonly endpoint: string;
  private readonly fetchImpl: TokenFetch;
  private readonly now: () => number;
  private cached: OAuth2Token | null = null;
  private inFlight: Promise<OAuth2Token> | null = null;

  private readonly subject: string;
  private readonly scope: string;
  constructor(
    serviceAccountKey: string,
    /** The ONE user this instance impersonates — a mapping's subject. */
    subject: string,
    scope: string,
    options: GoogleDwdOptions = {},
  ) {
    this.subject = subject;
    this.scope = scope;
    // Refused at construction, before any request: a key that cannot parse or
    // a missing subject would otherwise surface mid-pass as a mint failure.
    this.key = parseServiceAccountKey(serviceAccountKey);
    if (!subject) {
      throw new Error(
        'Domain-wide delegation impersonates a NAMED user, and none was given: the mapping ' +
          "must state the account it migrates (ADR-0033 — a mapping's blast radius is one " +
          'subject, however wide the credential).',
      );
    }
    if (!scope) {
      throw new Error('A DWD token is minted for an explicit scope; none was given.');
    }
    this.endpoint = options.tokenEndpoint ?? this.key.tokenUri ?? GOOGLE_TOKEN_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? defaultTokenFetch;
    this.now = options.now ?? Date.now;
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
    const timeUntilExpiry = this.cached.expiresAt - this.now();
    return {
      isValid: timeUntilExpiry > REFRESH_BUFFER_MS,
      timeUntilExpiry: Math.floor(timeUntilExpiry / 1000),
      tokenType: this.cached.tokenType,
      scope: this.cached.scope,
    };
  }

  /** The signed assertion. Separate so a test can decode what would be sent. */
  buildAssertion(): string {
    const iat = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.key.clientEmail,
        sub: this.subject,
        scope: this.scope,
        aud: this.endpoint,
        iat,
        exp: iat + 3600,
      }),
    );
    const signingInput = `${header}.${claims}`;
    let signature: Buffer;
    try {
      signature = createSign('RSA-SHA256').update(signingInput).sign(this.key.privateKey);
    } catch (err) {
      throw new Error(
        'The service account key\'s private_key could not sign the assertion — the key file ' +
          `is damaged (commonly: newlines mangled by a shell or an editor). ${
            err instanceof Error ? err.message : String(err)
          }`,
        { cause: err },
      );
    }
    return `${signingInput}.${signature.toString('base64url')}`;
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
      grant_type: JWT_BEARER_GRANT,
      assertion: this.buildAssertion(),
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
        `Google refused the delegated token request (${response.status}): ${shown}` +
          dwdHintFor(shown, this.key.clientEmail, this.subject, this.scope),
      );
    }

    let parsed: { access_token?: string; expires_in?: number; token_type?: string; scope?: string };
    try {
      parsed = JSON.parse(text) as typeof parsed;
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
      expiresAt: this.now() + (parsed.expires_in ?? 3600) * 1000,
      tokenType: parsed.token_type ?? 'Bearer',
      scope: parsed.scope ?? this.scope,
    };
  }

  private stillValid(token: OAuth2Token): boolean {
    return token.expiresAt - this.now() > REFRESH_BUFFER_MS;
  }
}

/**
 * Google's two stock refusals, translated to the place an operator can act
 * (ADR-0033 §3) — with Google's words already shown verbatim beside this.
 */
function dwdHintFor(body: string, clientEmail: string, subject: string, scope: string): string {
  if (body.includes('unauthorized_client')) {
    return (
      ` — "unauthorized_client" here means the Workspace Admin console has not authorised ` +
      `this service account for the requested scope: in Admin → Security → Access and data ` +
      `control → API controls → Domain-wide delegation, the client id of ${clientEmail} must ` +
      `list ${scope}. Authorise exactly the scopes the migration needs, and revoke the entry ` +
      'again at cutover (ADR-0033).'
    );
  }
  if (body.includes('invalid_grant')) {
    return (
      ` — "invalid_grant" here usually means the subject (${subject}) is not a user in the ` +
      "service account's Workspace domain, or the domain does not allow delegation to it. " +
      'The subject must be the migrated account\'s primary address.'
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
