// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every request to a Moneybird administration (workplan 0111, slices 1 and 2
 * of §"The build, sliced").
 *
 * The tax-rate list, the workflow list and the adapter's contacts and invoices
 * all go through `moneybirdRequest`, so a request fails the same way
 * everywhere: never as an empty answer, which downstream would take for "the
 * administration has none", and never with the token in the sentence. The
 * token travels in the `Authorization` header and nowhere else.
 *
 * What comes back is one of three things, before anybody decides what it
 * means:
 *
 *  - **response**: Moneybird answered, with its status and its JSON (`parsed`
 *    says whether there was any; a 204 or an HTML error page has none). What a
 *    status means for a contact or an invoice is the caller's to say.
 *  - **slow_down**: Moneybird answered 429. Its limit is 150 requests per 5
 *    minutes per administration; `retryAfterSeconds` is its `Retry-After`,
 *    given as seconds or as a date. Its own outcome, so a task paces itself
 *    instead of reading a full queue as an outage.
 *  - **unreachable**: no answer at all, with the reason.
 *
 * `moneybirdRead` is the shape both lists need: a GET whose 2xx JSON is the
 * answer, every other status a sentence that names what to fix (the token for
 * 401 and 403, the administration for 404).
 *
 * `fetchImpl` has no default here, so the one use of Node's own `fetch` stays
 * in each public caller, where the fixed-host guard
 * (`scripts/a-client-that-reaches-a-tenant-host.unit.test.ts`) counts it.
 */

/** Where a request goes: the administration, and the token that may use it. */
export interface MoneybirdAccess {
  readonly administrationId: string;
  readonly apiToken: string;
}

export type MoneybirdMethod = 'GET' | 'POST' | 'PATCH';

/** A 429: Moneybird's limit reached; ask again after `retryAfterSeconds`, when it said. */
export interface SlowDown {
  readonly kind: 'slow_down';
  readonly reason: string;
  readonly retryAfterSeconds?: number;
}

export type MoneybirdResponse =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown; readonly parsed: boolean }
  | SlowDown
  | { readonly kind: 'unreachable'; readonly reason: string };

export type MoneybirdReadOutcome =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** Moneybird's API, every administration under it. */
export const MONEYBIRD_API = 'https://moneybird.com/api/v2';

/** Seconds from a `Retry-After` header: a number of seconds, or an HTTP date. */
export function retryAfterSecondsOf(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/** The sentence for a refused token, the same wherever a request was refused. */
export function tokenRefusal(status: number): string {
  return `Moneybird refused the token (HTTP ${status}) — check MONEYBIRD_API_TOKEN and the administration id.`;
}

/**
 * One request to `path` (after `/api/v2/{administration}`, starting with `/`,
 * query included): a 10-second limit, the token only in its header, JSON in
 * and out, no retry. Idempotency is what makes a caller's retry safe.
 */
export async function moneybirdRequest(
  access: MoneybirdAccess,
  method: MoneybirdMethod,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<MoneybirdResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`${MONEYBIRD_API}/${encodeURIComponent(access.administrationId)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${access.apiToken}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      kind: 'unreachable',
      reason: `Moneybird could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.status === 429) {
    const retryAfterSeconds = retryAfterSecondsOf(response.headers.get('Retry-After'), Date.now());
    return {
      kind: 'slow_down',
      reason:
        'Moneybird asks us to slow down (HTTP 429; at most 150 requests per 5 minutes per administration)' +
        (retryAfterSeconds === undefined ? '.' : ` — ask again in ${retryAfterSeconds} s.`),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  try {
    return { kind: 'response', status: response.status, body: await response.json(), parsed: true };
  } catch {
    return { kind: 'response', status: response.status, body: null, parsed: false };
  }
}

/**
 * GET `path` (after `/api/v2/{administration}/`, query included) and hand back
 * the JSON, or a sentence that names what to fix, or a 429 as it came.
 */
export async function moneybirdRead(
  access: MoneybirdAccess,
  path: string,
  fetchImpl: typeof fetch,
): Promise<MoneybirdReadOutcome> {
  const answer = await moneybirdRequest(access, 'GET', `/${path}`, undefined, fetchImpl);
  if (answer.kind === 'unreachable') return { kind: 'unavailable', reason: answer.reason };
  if (answer.kind === 'slow_down') return answer;
  if (answer.status === 401 || answer.status === 403) {
    return { kind: 'unavailable', reason: tokenRefusal(answer.status) };
  }
  if (answer.status === 404) {
    return {
      kind: 'unavailable',
      reason:
        'Moneybird knows no such administration for this token (HTTP 404) — check ' +
        'MONEYBIRD_ADMINISTRATION_ID: the long number after moneybird.com/ when the administration is open.',
    };
  }
  if (answer.status < 200 || answer.status > 299) {
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${answer.status}.` };
  }
  if (!answer.parsed) return { kind: 'unavailable', reason: 'Moneybird answered something that is not JSON.' };
  return { kind: 'ok', body: answer.body };
}
