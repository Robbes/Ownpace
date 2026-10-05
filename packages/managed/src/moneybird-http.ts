// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One read from a Moneybird administration (workplan 0111, slice 1 of
 * §"The build, sliced"; slice 2 adds the writes).
 *
 * The tax-rate list and the workflow list are read the same way, and a read
 * that fails must fail the same way in both: never as an empty list, which
 * downstream would take for "the administration has none", and never with the
 * token in the sentence. So both go through this one function.
 *
 * Outcomes, as `vies.ts` and `moneybird-tax-rates.ts` already answer:
 *
 *  - **ok**: Moneybird answered 2xx with JSON. What the JSON means is the
 *    caller's to parse.
 *  - **unavailable**: anything else, with a reason a person can act on. A
 *    refused token (401, 403) names `MONEYBIRD_API_TOKEN`; an unknown
 *    administration (404) names `MONEYBIRD_ADMINISTRATION_ID`; a 429 says to
 *    slow down and carries Moneybird's `Retry-After` in seconds (its limit is
 *    150 requests per 5 minutes per administration).
 *
 * `fetchImpl` has no default here, so the one use of Node's own `fetch` stays
 * in each public caller, where the fixed-host guard
 * (`scripts/a-client-that-reaches-a-tenant-host.unit.test.ts`) counts it.
 */

/** Where a read goes: the administration, and the token that may read it. */
export interface MoneybirdAccess {
  readonly administrationId: string;
  readonly apiToken: string;
}

export type MoneybirdReadOutcome =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly retryAfterSeconds?: number };

const API = 'https://moneybird.com/api/v2';

/** Seconds from a `Retry-After` header: a number of seconds, or an HTTP date. */
function retryAfterSecondsOf(header: string | null, now: number): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * GET `path` (after `/api/v2/{administration}/`, query included) and parse the
 * JSON. One request, a 10-second limit, the token only in its header.
 */
export async function moneybirdRead(
  access: MoneybirdAccess,
  path: string,
  fetchImpl: typeof fetch,
): Promise<MoneybirdReadOutcome> {
  const url = `${API}/${encodeURIComponent(access.administrationId)}/${path}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${access.apiToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: `Moneybird could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      kind: 'unavailable',
      reason: `Moneybird refused the token (HTTP ${response.status}) — check MONEYBIRD_API_TOKEN and the administration id.`,
    };
  }
  if (response.status === 404) {
    return {
      kind: 'unavailable',
      reason:
        'Moneybird knows no such administration for this token (HTTP 404) — check ' +
        'MONEYBIRD_ADMINISTRATION_ID: the long number after moneybird.com/ when the administration is open.',
    };
  }
  if (response.status === 429) {
    const retryAfterSeconds = retryAfterSecondsOf(response.headers.get('Retry-After'), Date.now());
    return {
      kind: 'unavailable',
      reason:
        'Moneybird asks us to slow down (HTTP 429; at most 150 requests per 5 minutes per administration)' +
        (retryAfterSeconds === undefined ? '.' : ` — ask again in ${retryAfterSeconds} s.`),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (!response.ok) {
    return { kind: 'unavailable', reason: `Moneybird answered HTTP ${response.status}.` };
  }
  try {
    return { kind: 'ok', body: await response.json() };
  } catch {
    return { kind: 'unavailable', reason: 'Moneybird answered something that is not JSON.' };
  }
}
