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
import {
  domainsToScopes,
  type GoogleGrantDomain,
} from '@openmig/orchestration/account-qualification';

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export type GoogleConsentSourceType =
  | 'gmail'
  | 'google-calendar'
  | 'google-contacts'
  | 'google-drive';

/** Which of the four faces each Google source type is. */
export const GOOGLE_SOURCE_DOMAIN: Readonly<
  Record<GoogleConsentSourceType, GoogleGrantDomain>
> = {
  gmail: 'mail',
  'google-calendar': 'calendar',
  'google-contacts': 'contact',
  'google-drive': 'file',
};

/**
 * One product, one scope — least privilege is structural here because the
 * SOURCE TYPE is the choice: nothing can widen a gmail consent into Drive.
 *
 * DERIVED, not written out (workplan 0106 T1b). Until 2026-08-27 these four
 * values were a literal table here and a second literal table in
 * `account-qualification.ts`, which reads the same four scopes back out of a
 * token response. Two copies of a scope list is the drift nobody notices:
 * they disagree only in the case where the product asks for one scope and
 * then judges the resulting grant against another, and the symptom is a
 * connection that consents successfully and qualifies as `no`.
 *
 * `domainsToScopes` is now the single authority, and it can only ever return
 * the narrow scope of each domain — see its own doc comment for why the ask
 * and the broader accepted scopes are separate fields rather than one list.
 */
export const GOOGLE_SOURCE_SCOPES: Readonly<Record<GoogleConsentSourceType, string>> = {
  gmail: domainsToScopes(['mail'])[0]!,
  'google-calendar': domainsToScopes(['calendar'])[0]!,
  'google-contacts': domainsToScopes(['contact'])[0]!,
  'google-drive': domainsToScopes(['file'])[0]!,
};

interface PendingConsent {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope: string;
  readonly redirectUri: string;
  readonly createdAt: number;
  /**
   * Present when the consent was begun by a LINK holder rather than by the
   * owner in the wizard (workplan 0108 T4). It is what the callback branches
   * on, and the branch decides who may see the token: in the owner's flow the
   * answer is the owner, and in this one it is **nobody**.
   *
   * Carried on the pending state rather than passed back through the redirect,
   * because everything in a redirect is the browser's to change. The state id
   * is signed and single-use; what it points at here is the server's own
   * record of which mapping this consent was started for.
   */
  readonly link?: {
    readonly linkId: string;
    readonly mappingId: string;
    readonly tenantId: string;
  };
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

/**
 * Google forbids a raw-IP redirect URI — except loopback, which it permits
 * over plain http (the browser is where the redirect lives; Google never
 * connects to it). An appliance browsed at a bare address therefore cannot
 * be an OAuth redirect target, and the honest place to say so is HERE,
 * with the two supported shapes named, rather than at Google's screen with
 * a bare invalid_request (workplan 0089 T6). Null = nothing stands in the
 * way.
 */
export function rawIpCallbackRefusal(redirectUri: string): string | null {
  let host: string;
  try {
    host = new URL(redirectUri).hostname;
  } catch {
    return `The callback address derived for this API is not a valid URL: ${redirectUri}.`;
  }
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const isLoopback = bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
  if (isLoopback) return null;
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
  const isV6 = bare.includes(':');
  if (!isV4 && !isV6) return null;
  return (
    `Google does not accept a raw IP address as an OAuth redirect URI, and this API's ` +
    `callback would be ${redirectUri}. Two supported ways out: forward a local port to this ` +
    `box and register http://localhost:<port>/api/migrations/google/callback (Google permits ` +
    `loopback over plain http — it only redirects the browser, which is where the forward ` +
    `lives), or give this box a hostname under a domain you own and register the callback ` +
    `under that name (a private address in public DNS is allowed; Google's objection is to ` +
    `the IP literal, not the network). Until then, the paste-a-token path keeps working.`
  );
}

/**
 * A callback this deployment cannot actually be reached at.
 *
 * ## The failure this exists for, and why the raw-IP refusal beside it missed
 *
 * `rawIpCallbackRefusal` returns null for loopback, correctly: Google permits a
 * loopback redirect over plain http, and on a laptop the whole flow works. What
 * it cannot see is the case where loopback is right for the SHAPE and wrong for
 * the DEPLOYMENT.
 *
 * On 2026-09-01 the owner pressed Connect with Google on a stack served at
 * `https://app.ota.ownpace.eu`, with `API_URL` still at the example's
 * `http://localhost:3001`. The consent asked Google to redirect to
 * `http://localhost:3001/api/migrations/google/callback`. Google answered
 * *"Toegang geblokkeerd: het verzoek van deze app is ongeldig — Fout 400:
 * redirect_uri_mismatch"*, and the correct address was never on screen — it
 * was in the route's own response, which the wizard discarded.
 *
 * Registering that loopback URI at Google would not have fixed it either. The
 * redirect is followed by the PERSON'S BROWSER, so it would send them to port
 * 3001 of whatever machine they are sitting at, which is not this deployment.
 *
 * ## What makes it checkable rather than a guess
 *
 * `WEB_URL` is the address the deployment is browsed at, and every managed
 * stack has one — `managed.yml` requires it and the sign-in flow is built from
 * it. If the app is served at a real name and the API's callback derives to
 * loopback, the two cannot both be right, and the disagreement is decidable
 * here rather than at Google's screen.
 *
 * Both loopback (a developer on a laptop) is fine and returns null. So is both
 * public. Only the split is refused, and the refusal names the exact string to
 * register — the thing the owner spent an evening not being told.
 */
export function unreachableCallbackRefusal(
  redirectUri: string,
  webUrl: string | undefined,
): string | null {
  const hostOf = (raw: string | undefined): string | null => {
    if (!raw) return null;
    try {
      const host = new URL(raw).hostname;
      return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    } catch {
      return null;
    }
  };
  const loopback = (host: string | null): boolean =>
    host !== null && (host === 'localhost' || host === '::1' || /^127\./.test(host));

  const callbackHost = hostOf(redirectUri);
  const webHost = hostOf(webUrl);
  // No WEB_URL to compare against is not a finding: an appliance or a bare
  // dev run has nothing to disagree with, and inventing a complaint from one
  // value is how a guard starts refusing correct configurations.
  if (webHost === null || !webUrl || !loopback(callbackHost) || loopback(webHost)) return null;
  const app = webUrl.replace(/\/+$/, '');

  return (
    `This deployment is served at ${app}, but the address it asked Google to redirect ` +
    `back to is ${redirectUri} — a loopback address, which is this API's default and not ` +
    "where anybody can reach it. Google answers that with `redirect_uri_mismatch`, and " +
    'registering the loopback address instead would not help: the redirect is followed by ' +
    "the person's own browser, so it would send them to their own machine.\n\n" +
    'Set `API_URL` in `deploy/compose/.env` to the address this API is reached at from ' +
    'outside — with the default `VITE_API_URL=/api` that is the same origin as the app ' +
    `(${app}) — then restart the API and register exactly:\n\n` +
    `  ${app}/api/migrations/google/callback\n\n` +
    "in your Google client's Authorised redirect URIs."
  );
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
    // INCREMENTAL CONSENT, and it is not optional once the ask is narrow
    // (workplan 0106 T1b). Google replaces a grant with exactly what the
    // latest consent asked for. So a person who has consented to mail and
    // then consents to calendar would, without this, be left with calendar
    // ONLY — their working mail connection silently losing its scope at the
    // moment they added a second domain. Asking narrowly is only safe
    // alongside asking additively; the two belong in one change.
    //
    // The resulting token may therefore carry MORE than this request named.
    // That is over-RECEIVING, which is fine and is reported: the 0106 T1a
    // re-measure reads what the grant actually carries. Over-ASKING is the
    // thing least privilege forbids, and `domainsToScopes` is what prevents
    // it.
    //
    // THIS REACHES THE GRANT-LINK FLOW TOO (0108 T4), which builds its URL
    // through this same function, and that is deliberate rather than
    // inherited. A migrator who has already consented to the owner's client
    // for one domain will, on a second link for another domain, hand back a
    // token carrying both — where without this the second link would strip
    // the first, stopping a migration that was running, silently, for a
    // reason nobody could see from either screen. The widening is bounded to
    // scopes that PERSON already granted to that SAME client, so it grants no
    // access that did not already exist; what it changes is that one stored
    // credential can now exercise it. That trade is worth making in the
    // direction of not breaking a live migration.
    include_granted_scopes: 'true',
    state: p.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${q.toString()}`;
}

export type ExchangeResult =
  | { readonly ok: true; readonly refreshToken: string; readonly grantedScopes: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/**
 * Which of the asked scopes the granted set does NOT satisfy. The broader
 * Drive scope satisfies the read-only ask (a superset grant is reported, never
 * refused — over-ASKING is what least privilege forbids, not over-receiving
 * what Google chose to enumerate).
 *
 * AN ASK IS ONE OR MORE SCOPES, space-separated — one per domain ticked
 * (0106 T1b) — and each is judged on its own. On 2026-09-02 the owner ticked
 * all four, Google granted all four, and the previous check called the whole
 * ask "missing": it looked for the space-joined string as if it were one
 * scope, which no grant can ever contain. A single-scope ask is the
 * one-element case of this, not a separate rule.
 */
export function unsatisfiedScopes(asked: string, granted: ReadonlyArray<string>): string[] {
  const satisfied = (scope: string): boolean =>
    granted.includes(scope) ||
    (scope === 'https://www.googleapis.com/auth/drive.readonly' &&
      granted.includes('https://www.googleapis.com/auth/drive'));
  return asked
    .split(/\s+/)
    .filter((scope) => scope.length > 0)
    .filter((scope) => !satisfied(scope));
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
  const missing = unsatisfiedScopes(p.askedScope, granted);
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Google granted less than was asked: the consent is missing ${missing.join(' ')}. ` +
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

/**
 * The page a LINK holder's consent ends on (workplan 0108 T4).
 *
 * A separate function from `consentResultPage`, and the difference is the
 * entire point of the task: **this one has no parameter that could hold a
 * token.** The owner's ending hands the refresh token to the wizard window,
 * because in that flow the owner is the person whose credential it is. In the
 * link flow the credential belongs to the person in front of this page and the
 * token is stored server-side — so the page cannot show it, cannot postMessage
 * it, and cannot be edited later to do either without someone first widening
 * this signature and explaining why.
 *
 * There is nothing to close and nothing to paste. Somebody has done a favour
 * for a colleague; the page says it landed and lets them go.
 */
export function grantResultPage(
  outcome: { readonly ok: true } | { readonly ok: false; readonly reason: string },
): string {
  if (!outcome.ok) {
    return (
      `<main style="${PAGE_STYLE}"><h1>That did not complete</h1>` +
      `<p>${esc(outcome.reason)}</p>` +
      '<p>Nothing was stored. If you were sent a link, ask the person who sent it for a ' +
      'fresh one — issuing another takes them a moment.</p></main>'
    );
  }
  return (
    `<main style="${PAGE_STYLE}"><h1>Thank you — that is done</h1>` +
    '<p>Your account is now connected, and the migration can read from it. You do not have ' +
    'to do anything else, and this link will not work again.</p>' +
    '<p>Access is <strong>read-only</strong>: nothing is ever deleted or changed at your ' +
    'end. You can withdraw it at any time from your Google account’s security settings, ' +
    'under the third-party apps that have access.</p></main>'
  );
}
