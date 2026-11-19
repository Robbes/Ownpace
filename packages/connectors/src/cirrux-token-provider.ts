// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * CIRRUX'S ACCESS TOKENS, FROM A REFRESH TOKEN THAT ROTATES (workplan 0160 T5;
 * ADR-0052).
 *
 * Cirrux's access tokens last 15 minutes and its refresh tokens 30 days, and
 * *"every refresh returns a new refresh token and retires the old one, so
 * store the new one each time: using a retired one signs the user out"*
 * (`https://cirrux.co/help/api`). Every other provider here reads its stored
 * credential and never writes it, which is why Box has its client-credentials
 * grant (`box-token-provider.ts`). Cirrux documents no such grant for Drive,
 * so this provider WRITES THE SUCCESSOR BACK after every refresh, and that is
 * ADR-0052's whole subject.
 *
 * ## Three rules this file holds, and one it hands to the store
 *
 * 1. **Single-flight in a process.** One provider per writer, and every item a
 *    pass carries concurrently shares it: a refresh in flight is joined, never
 *    started twice, and the access token is kept in memory until a minute
 *    before it expires. Nothing but the refresh token is ever stored.
 * 2. **A token Cirrux may have spent is never presented again** (ADR-0052,
 *    decision 5). Each refresh's outcome is sorted three ways, by what Cirrux
 *    said: `rotated` (a successor came back), `spent` (the old token may be
 *    retired and no successor is in hand, or Cirrux answered `invalid_grant`),
 *    `kept` (Cirrux said nothing was done). The store removes a spent token in
 *    the same transaction.
 * 3. **The token is never logged and never in an error.** A refusal quotes
 *    Cirrux's `error` code and description, never the request.
 *
 * **Single-flight ACROSS processes is the store's** (`RotatingGrantStore`):
 * the refresh runs inside its lock, from reading the stored token to storing
 * the successor. The managed edition's is a row lock on the connection
 * (`packages/orchestration/src/cirrux-grant-store.ts`); the test double is in
 * `__testing__/cirrux-fake.ts`, with the same contract.
 */

import { parseRetryAfterMs, withFailureCategory, CIRRUX_TOKEN_ENDPOINT } from '@openmig/shared';

/** What one refresh produced, for the store to act on (ADR-0052, decision 5). */
export type RotationOutcome<T> =
  /** A readable successor came back: store it, then answer `value`. */
  | { readonly kind: 'rotated'; readonly refreshToken: string; readonly value: T }
  /** The stored token may be retired and no successor is in hand: remove it, then throw. */
  | { readonly kind: 'spent'; readonly error: Error }
  /** Cirrux said nothing was done: store nothing, throw. */
  | { readonly kind: 'kept'; readonly error: Error };

/**
 * Where a connection's Drive grant lives, and the lock its refreshes take.
 *
 * `rotate` hands `use` the refresh token stored AT THE MOMENT THE LOCK IS
 * HELD, never one read earlier, and acts on the outcome before releasing it:
 * a successor is stored by a compare-and-swap on what was read, a spent token
 * is removed the same way. Two calls for one connection never overlap. With no
 * grant stored it throws `cirruxDriveNotConnected()`'s error without calling
 * `use`.
 */
export interface RotatingGrantStore {
  rotate<T>(use: (refreshToken: string) => Promise<RotationOutcome<T>>): Promise<T>;
}

/** An access token, and when it stops working. */
export interface CirruxAccessToken {
  readonly accessToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface CirruxTokenProviderOptions {
  /** The deployment's public client (`CIRRUX_OAUTH_CLIENT_ID`); Cirrux issues no secret. */
  readonly clientId: string;
  readonly store: RotatingGrantStore;
  readonly tokenEndpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * How long one refresh may take. The store holds a lock for the length of
   * it, so it is bounded; past it the request may have reached Cirrux, and the
   * outcome is `spent`.
   */
  readonly timeoutMs?: number;
  /**
   * An access token already in hand: the consent's own, which the door that
   * just exchanged the code measures the Drive with. It is used until a minute
   * before it expires, so that measuring spends no refresh; it is never stored.
   */
  readonly initial?: CirruxAccessToken;
}

/** Refresh this long before the access token runs out, so no request carries one that dies in flight. */
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
/** Cirrux's access tokens last 15 minutes; an answer without `expires_in` is read as that. */
const DEFAULT_ACCESS_TOKEN_SECONDS = 15 * 60;
const DEFAULT_TIMEOUT_MS = 30_000;
/** How often a `429` from the token endpoint is waited out inside one refresh. */
const RATE_LIMIT_ATTEMPTS = 3;

/**
 * The refusal for an account with no Drive grant stored: the face is not
 * connected. `auth_expired`, because the remedy is the one the category names:
 * sign in again, here with *Connect Cirrux Drive* on the Accounts page.
 */
export function cirruxDriveNotConnected(): Error {
  return withFailureCategory(
    'auth_expired',
    new Error(
      'This Cirrux account has no Cirrux Drive connected, so no file can be written to it. On ' +
        'the Accounts page, press Connect Cirrux Drive on this account and sign in to Cirrux; ' +
        'the files carry on at the next pass.',
    ),
  );
}

export class CirruxTokenProvider {
  private readonly clientId: string;
  private readonly store: RotatingGrantStore;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private cached: CirruxAccessToken | null = null;
  private inFlight: Promise<CirruxAccessToken> | null = null;

  constructor(options: CirruxTokenProviderOptions) {
    if (!options.clientId.trim()) {
      throw new Error(
        'A Cirrux token provider needs the deployment’s Cirrux client ID (CIRRUX_OAUTH_CLIENT_ID), ' +
          'and none was given.',
      );
    }
    this.clientId = options.clientId.trim();
    this.store = options.store;
    this.endpoint = options.tokenEndpoint ?? CIRRUX_TOKEN_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cached = options.initial ?? null;
  }

  /** A working access token: the one in memory, or a fresh one from a refresh joined or started. */
  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - this.now() > REFRESH_BEFORE_EXPIRY_MS) {
      return this.cached.accessToken;
    }
    this.inFlight ??= this.store
      .rotate((refreshToken) => this.exchange(refreshToken))
      .then((answer) => {
        if (!answer.ok) throw answer.error;
        this.cached = answer.token;
        return answer.token;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return (await this.inFlight).accessToken;
  }

  /**
   * Cirrux refused this access token (a `401`): forget it, so the next call
   * refreshes. Only the token that was refused is forgotten, so an item that
   * was refused just after another refreshed does not throw the new one away.
   */
  invalidate(refused: string): void {
    if (this.cached?.accessToken === refused) this.cached = null;
  }

  /**
   * ONE REFRESH, inside the store's lock, sorted by what Cirrux said.
   *
   * Never throws: everything that can go wrong is an outcome, so the store
   * decides what to keep with the lock still held. The refresh token appears in
   * the request body and nowhere else.
   */
  private async exchange(
    refreshToken: string,
  ): Promise<RotationOutcome<{ ok: true; token: CirruxAccessToken } | { ok: false; error: Error }>> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.clientId,
          }).toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        return neverReached(err)
          ? { kind: 'kept', error: refusal('network', `Cirrux's token endpoint could not be reached (${describe(err)}). Nothing was spent; the next pass tries again.`) }
          : { kind: 'spent', error: lostAnswer(`the connection was lost after the request was sent (${describe(err)})`) };
      }

      if (response.status === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
        // Cirrux refused before doing anything, and asked for a pause: the
        // token is unspent, so the same one goes again after it.
        const header = response.headers.get('retry-after');
        await response.text().catch(() => undefined);
        await this.sleep(header ? parseRetryAfterMs(header) : 1000 * 2 ** attempt);
        continue;
      }

      const text = await response.text().catch(() => '');
      const said = cirruxError(text);

      if (response.status === 429) {
        return {
          kind: 'kept',
          error: refusal(
            'rate_limited',
            `Cirrux's token endpoint asked this deployment to slow down ${RATE_LIMIT_ATTEMPTS} times ` +
              '(429). Nothing was spent; the next pass tries again.',
          ),
        };
      }
      if (response.status >= 500) {
        return {
          kind: 'kept',
          error: refusal('network', `Cirrux's token endpoint answered ${response.status}${said.text}. Nothing was spent; the next pass tries again.`),
        };
      }
      if (!response.ok) {
        if (said.code === 'invalid_grant') {
          // Dead at Cirrux: withdrawn, unused for 30 days, or retired. Sent
          // again it would sign the person out, so the store removes it.
          return {
            kind: 'spent',
            error: refusal(
              'auth_expired',
              `Cirrux no longer accepts this account's Drive sign-in (${response.status}${said.text}): it ` +
                'was withdrawn, it went unused for 30 days, or it was already used. On the Accounts ' +
                'page, press Connect Cirrux Drive on this account and sign in again.',
            ),
          };
        }
        // Another refusal (`invalid_client`, `invalid_request`) is about the
        // request, not the token: nothing was spent.
        return {
          kind: 'kept',
          error: refusal(
            'auth_expired',
            `Cirrux refused this deployment's Drive refresh (${response.status}${said.text}). The sign-in ` +
              'was not used. If Cirrux names the client, the deployment’s CIRRUX_OAUTH_CLIENT_ID is ' +
              'not the client Cirrux registered for this address.',
          ),
        };
      }

      // 2xx: a successor is the one thing that must not be lost from here on.
      let parsed: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        return { kind: 'spent', error: lostAnswer('Cirrux answered with something that is not JSON') };
      }
      if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token.trim() === '') {
        return { kind: 'spent', error: lostAnswer('Cirrux answered without a new refresh token') };
      }
      const successor = parsed.refresh_token;
      if (typeof parsed.access_token !== 'string' || parsed.access_token === '') {
        // The successor is stored; only this pass goes without.
        return {
          kind: 'rotated',
          refreshToken: successor,
          value: {
            ok: false,
            error: refusal('unknown', 'Cirrux answered the refresh without an access token. The new sign-in is stored; the next pass tries again.'),
          },
        };
      }
      const seconds =
        typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in) && parsed.expires_in > 0
          ? parsed.expires_in
          : DEFAULT_ACCESS_TOKEN_SECONDS;
      return {
        kind: 'rotated',
        refreshToken: successor,
        value: { ok: true, token: { accessToken: parsed.access_token, expiresAt: this.now() + seconds * 1000 } },
      };
    }
  }
}

/** A refusal with its category, worded for the person who reads the failure. */
function refusal(category: Parameters<typeof withFailureCategory>[0], sentence: string): Error {
  return withFailureCategory(category, new Error(sentence));
}

/** The sentence for a refresh whose successor never arrived (ADR-0052, decision 5). */
function lostAnswer(what: string): Error {
  return refusal(
    'auth_expired',
    `Cirrux may have replaced this account's Drive sign-in, and the new one never arrived: ${what}. ` +
      'The old one is not sent again, because Cirrux signs a person out for a sign-in it already ' +
      'replaced. On the Accounts page, press Connect Cirrux Drive on this account and sign in again.',
  );
}

/** Cirrux's `error` and `error_description`, as a clause for a sentence, and the code alone. */
function cirruxError(body: string): { code: string | undefined; text: string } {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown };
    const code = typeof parsed.error === 'string' ? parsed.error : undefined;
    const description = typeof parsed.error_description === 'string' ? parsed.error_description : '';
    if (!code) return { code: undefined, text: '' };
    return { code, text: `: ${code}${description ? ` — ${description.slice(0, 200)}` : ''}` };
  } catch {
    return { code: undefined, text: '' };
  }
}

/**
 * Did this failure happen before a byte of the request left?
 *
 * A name that did not resolve and a connection refused or never opened are
 * the cases where Cirrux cannot have seen the token. Everything else (a reset,
 * a timeout, a socket closed mid-answer) may have reached it.
 */
function neverReached(err: unknown): boolean {
  const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'EHOSTUNREACH', 'ENETUNREACH']);
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && codes.has(code)) return true;
  }
  return false;
}

function describe(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 3; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof Error) parts.push(e.message);
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') parts.push(code);
  }
  return parts.join(': ') || String(err);
}
