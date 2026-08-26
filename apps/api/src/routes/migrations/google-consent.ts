// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The authorization-code flow, against the customer's own client
 * (workplan 0089 T1).
 *
 * Ownpace has only ever CONSUMED a refresh token; the manual sent operators
 * to Google's OAuth Playground to mint one by hand. Nothing forced that:
 * this module runs the round-trip itself, with no change to custody — same
 * client id, same secret, same token, three fewer manual steps and no
 * developer tool.
 *
 * Constraints, all load-bearing (the workplan's own list):
 *
 *  - **`state` is a signature, not a nonce in a map.** The callback is a
 *    public endpoint; anything that trusts an unauthenticated parameter is
 *    a hijack. Here `state` is an unguessable id PLUS an HMAC over it with
 *    a process-lifetime key, single-use (taken from the store exactly once)
 *    and expiring (ten minutes). A restart forgets in-flight consents —
 *    the person clicks the button again; nothing durable is lost.
 *  - **The `clientSecret` is never in a URL, a redirect or a log.** It
 *    travels in the authenticated authorize POST, waits in process memory
 *    keyed by the state, and leaves only in the token-exchange POST body.
 *    Nothing here logs it, and nothing writes it anywhere at rest — the
 *    stored credential remains the one the CREATE path encrypts, exactly
 *    as a pasted token's (ADR-0037: one credential store, no special case).
 *  - **`access_type=offline` and `prompt=consent` cannot be forgotten** —
 *    without them Google answers with an access token that dies in an hour
 *    and no refresh token; they are written once, here, and pinned.
 *  - **The granted scope is reported, not assumed.** Google may grant less
 *    than asked; the exchange refuses with the difference NAMED rather
 *    than handing over a token that fails later at a confusing place.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export type GoogleConsentSourceType =
  | 'gmail'
  | 'google-calendar'
  | 'google-contacts'
  | 'google-drive';

/**
 * One product, one scope — least privilege is structural here because the
 * SOURCE TYPE is the choice: nothing can widen a gmail consent into Drive.
 * The values are the product's own factory scopes (the same vocabulary the
 * 0106 qualification reads back out of a token response), Drive read-only
 * because every source in this product is read-only.
 */
export const GOOGLE_SOURCE_SCOPES: Readonly<Record<GoogleConsentSourceType, string>> = {
  gmail: 'https://mail.google.com/',
  'google-calendar': 'https://www.googleapis.com/auth/calendar',
  'google-contacts': 'https://www.googleapis.com/auth/carddav',
  'google-drive': 'https://www.googleapis.com/auth/drive.readonly',
};

interface PendingConsent {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope: string;
  readonly redirectUri: string;
  readonly createdAt: number;
}

export const CONSENT_STATE_TTL_MS = 10 * 60_000;

/**
 * The in-flight consents, in process memory and nowhere else. `begin`
 * stores one and returns the signed state; `take` verifies and REMOVES it
 * — a second take of the same state finds nothing, which is the single-use
 * rule enforced by shape rather than by a flag somebody could forget.
 */
export class ConsentFlowStore {
  private readonly key = randomBytes(32);
  private readonly pending = new Map<string, PendingConsent>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  begin(consent: Omit<PendingConsent, 'createdAt'>): string {
    this.sweep();
    const id = randomUUID();
    this.pending.set(id, { ...consent, createdAt: this.now() });
    return `${id}.${this.sign(id)}`;
  }

  take(state: string): PendingConsent | undefined {
    const dot = state.indexOf('.');
    if (dot <= 0) return undefined;
    const id = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = this.sign(id);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
    const found = this.pending.get(id);
    this.pending.delete(id);
    if (!found) return undefined;
    if (this.now() - found.createdAt > CONSENT_STATE_TTL_MS) return undefined;
    return found;
  }

  private sign(id: string): string {
    return createHmac('sha256', this.key).update(id).digest('base64url');
  }

  private sweep(): void {
    for (const [id, p] of this.pending) {
      if (this.now() - p.createdAt > CONSENT_STATE_TTL_MS) this.pending.delete(id);
    }
  }
}

/** Google's consent URL, with the two parameters that must never be forgotten. */
export function consentUrl(p: {
  clientId: string;
  scope: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: p.scope,
    // Without offline access Google returns an access token only, which
    // expires in an hour and cannot be renewed; without prompt=consent a
    // repeat consent may come back without a refresh token at all.
    access_type: 'offline',
    prompt: 'consent',
    state: p.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`;
}

export type ExchangeResult =
  | { readonly ok: true; readonly refreshToken: string; readonly grantedScopes: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/** Does the granted set satisfy the asked scope? The broader Drive scope
 *  satisfies the read-only ask (a superset grant is reported, never refused
 *  — over-ASKING is what least privilege forbids, not over-receiving what
 *  Google chose to enumerate). */
function grantSatisfies(asked: string, granted: ReadonlyArray<string>): boolean {
  if (granted.includes(asked)) return true;
  return (
    asked === 'https://www.googleapis.com/auth/drive.readonly' &&
    granted.includes('https://www.googleapis.com/auth/drive')
  );
}

/**
 * Exchange the authorization code for tokens. The secret appears in the
 * POST body and nowhere else; the answer's `scope` field is the grant
 * ENUMERATED, so a narrower grant refuses with the difference named.
 */
export async function exchangeCode(
  p: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    askedScope: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  let res: Response;
  try {
    res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: p.code,
        client_id: p.clientId,
        client_secret: p.clientSecret,
        redirect_uri: p.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Google's token endpoint could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    // Google's error body is safe to quote (it never echoes the secret);
    // its `error` field is the actionable part.
    const body = await res.text().catch(() => '(no body)');
    return {
      ok: false,
      reason:
        `Google refused the code exchange (HTTP ${res.status}): ${body.slice(0, 300)}. ` +
        'Check that the Client ID and client secret belong to the same OAuth client the ' +
        'consent screen used, and that this exact redirect URI is registered on it.',
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    scope?: string;
  };
  const granted = (json.scope ?? '').split(' ').filter((s) => s.length > 0);
  if (!grantSatisfies(p.askedScope, granted)) {
    return {
      ok: false,
      reason:
        `Google granted less than was asked: the consent is missing ${p.askedScope}. ` +
        `Granted: ${granted.length > 0 ? granted.join(', ') : '(nothing enumerated)'}. ` +
        'Asking is granting — run Connect with Google again and leave every requested ' +
        'permission ticked, rather than storing a token that would fail later.',
    };
  }
  if (!json.refresh_token) {
    return {
      ok: false,
      reason:
        'Google answered without a refresh token. access_type=offline and prompt=consent ' +
        'were both sent, so this usually means a Workspace policy blocks offline access ' +
        'for this account — ask the administrator, or mint the token under an account ' +
        'the policy permits.',
    };
  }
  return { ok: true, refreshToken: json.refresh_token, grantedScopes: granted };
}

/** HTML-escape for text nodes. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A JS string literal that cannot break out of its <script> block. */
function jsString(value: unknown): string {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c');
}

const PAGE_STYLE =
  'font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; line-height: 1.5;';

/**
 * The page the callback renders. On success it hands the token to the
 * window that opened the popup — via postMessage to the WEB origin and
 * ONLY that origin (never `*`: the token must not be readable by whatever
 * else might have opened this URL). Without a configured web origin the
 * page degrades to showing the token for the person to paste — their own
 * token, in their own browser, exactly what the Playground used to show.
 */
export function consentResultPage(p: {
  webOrigin?: string;
  outcome:
    | { readonly ok: true; readonly refreshToken: string; readonly grantedScopes: ReadonlyArray<string> }
    | { readonly ok: false; readonly reason: string };
}): string {
  if (!p.outcome.ok) {
    return (
      `<main style="${PAGE_STYLE}"><h1>Consent did not complete</h1>` +
      `<p>${esc(p.outcome.reason)}</p>` +
      '<p>You can close this window and try again from the wizard.</p></main>'
    );
  }
  const payload = {
    type: 'ownpace-google-consent',
    refreshToken: p.outcome.refreshToken,
    grantedScopes: p.outcome.grantedScopes,
  };
  if (p.webOrigin) {
    return (
      `<main style="${PAGE_STYLE}"><h1>Consent received</h1>` +
      '<p>Handing the result back to the wizard… you can close this window.</p></main>' +
      '<script>' +
      `const payload = JSON.parse(${jsString(payload)});` +
      `const target = JSON.parse(${jsString(p.webOrigin)});` +
      'if (window.opener) { window.opener.postMessage(payload, target); window.close(); }' +
      '</script>'
    );
  }
  return (
    `<main style="${PAGE_STYLE}"><h1>Consent received</h1>` +
    '<p>No web address is configured for this API, so the token could not be handed back ' +
    'automatically. Copy the refresh token below into the wizard’s Refresh token field:</p>' +
    `<p><code>${esc(p.outcome.refreshToken)}</code></p></main>`
  );
}
