// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A JMAP account's free space, `Quota/get` (RFC 9425; workplan 0171 T9).
 *
 * One request, shared by the JMAP mail and file writers, so mail and files
 * written to the same account read the same number under the same pool and
 * are added together against it once (`spaceByPool`).
 */
import { capacityFromJmapQuotas, JMAP_QUOTA_CAPABILITY, type DestinationCapacity, type JmapQuota, withoutTrailing } from '@openmig/shared';
import { fetchWithRateLimitRetry } from './http-rate-limit.ts';

/** Whether a session keeps quotas for this account: listed on the session, or on the account. */
export function jmapQuotaAnnounced(
  session: {
    readonly capabilities?: Record<string, unknown>;
    readonly accounts?: Record<string, { readonly accountCapabilities?: Record<string, unknown> }>;
  },
  accountId: string,
): boolean {
  return (
    session.capabilities?.[JMAP_QUOTA_CAPABILITY] !== undefined ||
    session.accounts?.[accountId]?.accountCapabilities?.[JMAP_QUOTA_CAPABILITY] !== undefined
  );
}

/** The pool a JMAP account's quota covers: the server and the account id. */
export function jmapPool(baseUrl: string, accountId: string): string {
  return `jmap:${withoutTrailing(baseUrl, '/')}#${accountId}`;
}

/**
 * Ask `Quota/get` for the account's quotas and read them as room. A server
 * that does not announce quotas is `not_offered` without a request. A request
 * that fails THROWS (hard rule 9): the route says it was not answered, and a
 * failure is never read as room.
 */
export async function readJmapCapacity(opts: {
  readonly apiUrl: string;
  readonly authHeader: string;
  readonly accountId: string;
  readonly announced: boolean;
  readonly pool: string;
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<DestinationCapacity> {
  if (!opts.announced) return capacityFromJmapQuotas(false, undefined, opts.pool);
  const send = opts.fetchImpl ?? ((url: string, init: RequestInit) => fetchWithRateLimitRetry(url, init, 'jmap'));
  const response = await send(opts.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: opts.authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', JMAP_QUOTA_CAPABILITY],
      methodCalls: [['Quota/get', { accountId: opts.accountId, ids: null }, 'q']],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`JMAP Quota/get failed: HTTP ${response.status} - ${body.slice(0, 300)}`);
  }
  const result = (await response.json()) as {
    methodResponses?: Array<[string, { list?: unknown; type?: string; description?: string }, string]>;
  };
  const first = result.methodResponses?.[0];
  if (!first || first[0] !== 'Quota/get') {
    const why = first?.[0] === 'error' ? `${first[1].type ?? 'error'}${first[1].description ? ` - ${first[1].description}` : ''}` : 'no answer';
    throw new Error(`JMAP Quota/get failed: ${why}`);
  }
  const list = first[1].list;
  return capacityFromJmapQuotas(true, Array.isArray(list) ? (list as JmapQuota[]) : undefined, opts.pool);
}
