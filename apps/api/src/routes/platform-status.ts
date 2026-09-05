// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The platform status the customer sees, read from the page that already
 * publishes it (workplan 0110 T5, the last half).
 *
 * The support screen's second level owes the operator "the platform status
 * the customer sees" — the owner's answer 3 of 2026-08-27: platform-wide is
 * enough, and the customer's own checks stay out. The row said this surface
 * had no source. It has two, both built since: `/api/ready` (0094 T1), which
 * is this same process and so is CALLED rather than fetched; and the status
 * page (0094 T2), Gatus inside the stack, whose own JSON is what its public
 * page renders. Reading that JSON means the operator and the customer look at
 * the same facts — the reason this surface exists at all: *"people expect me
 * to be able to see what they see."*
 *
 * ## What leaves, and what does not
 *
 * Group, name, up or down, and when — the four things the public page shows.
 * Gatus's JSON also carries the probed HOSTNAME, every condition's text and
 * the error strings, and on this stack those name internal containers
 * (`ownpace-idp:3126`, the very thing `managed.env.example` warns is meant to
 * stay on the box). None of that is on the public page and none of it leaves
 * here: the fold builds a new object from the four fields, so a fifth cannot
 * slip through by spread. Pinned by a test that plants all three.
 *
 * ## Absence is an answer, and there are two of them
 *
 * `STATUS_URL` unset is `off`: the self-host edition has no status page and
 * must not read as "the status page is down". Set and not answering within
 * the deadline is `unreachable` — a distinct state, because on a stack that
 * has a page, a page that does not answer is itself news. Neither carries a
 * reason; the log does, which is 0094's own rule for `/api/ready`.
 */

import { log } from '@openmig/shared';
import type { Readiness } from './ready.ts';

export type EndpointState = 'up' | 'down' | 'unchecked';

export interface StatusPageEndpoint {
  readonly group: string;
  readonly name: string;
  readonly state: EndpointState;
  /** When the newest result was taken — ISO — or null when none has been. */
  readonly checkedAt: string | null;
}

export type StatusPage =
  | { readonly state: 'up'; readonly endpoints: StatusPageEndpoint[] }
  | { readonly state: 'off' }
  | { readonly state: 'unreachable' };

export interface PlatformStatus {
  readonly ready: Readiness;
  readonly statusPage: StatusPage;
}

/** How long the page gets. The screen is one fetch, and a slow page must not hold it. */
export const STATUS_PAGE_DEADLINE_MS = 3_000;

/** Gatus's own list. Its endpoint statuses live here, one entry per endpoint. */
export const STATUS_PAGE_ENDPOINTS_PATH = '/api/v1/endpoints/statuses';

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A timestamp's order key: the instant when it parses, else the text itself. */
const orderKey = (timestamp: string): number | string => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : parsed;
};

/**
 * The newest result decides, and ONLY the four fields come out.
 *
 * Order-independent on purpose: Gatus answers a page of results per endpoint
 * and which end is newest is a detail of its paging, so the timestamp is read
 * rather than the position. An endpoint with no result yet is `unchecked` —
 * a real state, not a `down`, because a page that has just started has
 * checked nothing and is not reporting an outage.
 */
export function foldStatusPage(json: unknown): StatusPageEndpoint[] {
  if (!Array.isArray(json)) {
    throw new Error('the status page did not answer with a list of endpoints');
  }
  return json.map((raw: unknown) => {
    const entry = (raw && typeof raw === 'object' ? raw : {}) as {
      name?: unknown;
      group?: unknown;
      results?: unknown;
    };
    const results = Array.isArray(entry.results) ? entry.results : [];
    let newest: { success: boolean; timestamp: string } | null = null;
    for (const result of results) {
      if (!result || typeof result !== 'object') continue;
      const timestamp = asString((result as { timestamp?: unknown }).timestamp);
      if (!timestamp) continue;
      if (!newest || orderKey(timestamp) > orderKey(newest.timestamp)) {
        newest = { success: (result as { success?: unknown }).success === true, timestamp };
      }
    }
    return {
      group: asString(entry.group),
      name: asString(entry.name),
      state: newest ? (newest.success ? 'up' : 'down') : 'unchecked',
      checkedAt: newest?.timestamp ?? null,
    };
  });
}

/**
 * Read the page, or say why there is nothing to read. Never throws: a status
 * page that cannot be read is one of the answers, not a failure of the screen
 * asking. `fetchImpl` is injectable so the deadline and the shapes can be
 * proved without a network.
 */
export async function readStatusPage(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
  deadlineMs: number = STATUS_PAGE_DEADLINE_MS,
): Promise<StatusPage> {
  if (!url) return { state: 'off' };
  const target = `${url.replace(/\/+$/, '')}${STATUS_PAGE_ENDPOINTS_PATH}`;
  try {
    const response = await fetchImpl(target, {
      signal: AbortSignal.timeout(deadlineMs),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`the status page answered ${response.status}`);
    return { state: 'up', endpoints: foldStatusPage(await response.json()) };
  } catch (error) {
    // The reason stays here, with the address: the response says `unreachable`
    // and no more, so an internal name cannot travel out through a screen.
    log.error(`[support] the status page at ${target} could not be read:`, error);
    return { state: 'unreachable' };
  }
}
