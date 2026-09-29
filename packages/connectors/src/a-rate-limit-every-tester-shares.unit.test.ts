// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE PROVIDERS LET EVERY TESTER DO TOGETHER (workplan 0143 T10).
 *
 * One Entra app and one Google project serve every organisation on a
 * deployment, so their quotas are shared. Two gaps let one tester's pass
 * spend more than its share, or give up on a limit that clears by itself:
 *
 *  1. Graph mail never took a slot from the organisation's shared rate
 *     budget, as the other Graph faces do. It only asked the limiter how long
 *     to wait after a 429, and then asked again without end.
 *  2. The DAV sources that read Google's calendars and contacts failed a 429
 *     on first sight, and read Google's 403 rate limit as a refusal.
 *
 * The Drive source's half of (2) is in `google-drive-source.unit.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RateBudget, TokenProvider } from '@openmig/shared';
import { ThrottleLimiter, classifyFailure } from '@openmig/shared';
import type { HttpClient, HttpResponse } from './dav-http.types.ts';
import { GraphMailSource } from './graph-mail-source.ts';
import { CalDAVSource } from './caldav-source.ts';
import { CarddavSource } from './carddav-source.ts';
import { RATE_LIMIT_FALLBACK_WAIT_MS, rateLimitWaitMs } from './rate-limit-once.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';

function tokenProvider(): TokenProvider {
  const token = { accessToken: 'tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  return {
    getToken: vi.fn().mockResolvedValue(token),
    refresh: vi.fn().mockResolvedValue(token),
    isTokenValid: vi.fn().mockReturnValue(true),
    getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
  } as unknown as TokenProvider;
}

function answer(status: number, body: unknown = {}, headers: Record<string, string> = {}): HttpResponse {
  return { status, body: typeof body === 'string' ? body : JSON.stringify(body), headers };
}

/** A client that answers each URL (without its query) from a queue; the last answer repeats. */
function scripted(routes: Record<string, HttpResponse | HttpResponse[]>): { client: HttpClient; seen: string[] } {
  const seen: string[] = [];
  const queues = new Map(Object.entries(routes).map(([url, a]) => [url, Array.isArray(a) ? [...a] : [a]]));
  const client: HttpClient = {
    async request(options) {
      seen.push(options.url);
      const queue = queues.get(options.url) ?? queues.get(options.url.split('?')[0]!);
      if (!queue) throw new Error(`no scripted answer for ${options.url}`);
      return queue.length > 1 ? queue.shift()! : queue[0]!;
    },
  };
  return { client, seen };
}

const STUCK = 'still asking';

// The clock is fake, so no case sleeps, and a wait that should not happen (a
// second, or an hour) is left pending rather than slept through: a regression
// fails at once, with a sentence, instead of hanging the file.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * How the work settled once everything else has run and the clock has moved
 * `advanceMs`, or `STUCK` when it is still waiting. The default moves it a
 * little, because a zero-delay timer set during a tick is run a millisecond
 * later: a few retries asked to come back at once take a few milliseconds.
 */
async function settled<T>(work: Promise<T>, advanceMs = 50): Promise<T | typeof STUCK> {
  let outcome: { readonly value: T } | { readonly error: unknown } | undefined;
  work.then(
    (value) => {
      outcome = { value };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );
  await vi.advanceTimersByTimeAsync(advanceMs);
  if (outcome === undefined) return STUCK;
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

/** A budget that counts what it is asked for, as `PgRateBudget` would spend it. */
function countingBudget(): RateBudget & { readonly taken: Array<readonly [string, string]> } {
  const taken: Array<readonly [string, string]> = [];
  return {
    taken,
    acquire: async (scope, provider) => {
      taken.push([scope, provider]);
    },
  };
}

function limiterOn(budget: RateBudget): ThrottleLimiter {
  return new ThrottleLimiter(
    { requestsPerSecond: 1000, maxConcurrent: 4, maxRetries: 2, baseBackoffMs: 1, maxBackoffMs: 2, jitterMs: 0 },
    budget,
  );
}

/** The six well-known lookups, and a root listing with one folder. */
function mailboxRoutes(): Record<string, HttpResponse | HttpResponse[]> {
  const routes: Record<string, HttpResponse | HttpResponse[]> = {};
  for (const name of ['inbox', 'sentitems', 'drafts', 'archive', 'junkemail', 'deleteditems']) {
    routes[`${GRAPH}/me/mailFolders/${name}`] = answer(200, { id: `id-${name}`, displayName: name });
  }
  routes[`${GRAPH}/me/mailFolders`] = answer(200, { value: [{ id: 'id-inbox', displayName: 'Inbox' }] });
  return routes;
}

describe('Graph mail spends against the shared budget', () => {
  it('takes a slot from the budget for every request, on Graph’s row', async () => {
    const budget = countingBudget();
    const { client, seen } = scripted(mailboxRoutes());
    const source = new GraphMailSource(tokenProvider(), 'common', { throttleLimiter: limiterOn(budget) }, { httpClient: client });

    expect(await settled(source.listFolders())).not.toBe(STUCK);
    expect(seen.length).toBeGreaterThan(0);
    expect(budget.taken).toHaveLength(seen.length);
    // The row the calendar, contacts and files faces spend against: one quota.
    expect(new Set(budget.taken.map(([, provider]) => provider))).toEqual(new Set(['graph.microsoft.com']));
  });

  it('spends a slot on each attempt at a throttled request', async () => {
    const budget = countingBudget();
    const routes = mailboxRoutes();
    routes[`${GRAPH}/me/mailFolders/inbox`] = [
      answer(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '0' }),
      answer(200, { id: 'id-inbox', displayName: 'Inbox' }),
    ];
    const { client, seen } = scripted(routes);
    const limiter = limiterOn(budget);
    const waitFor = vi.spyOn(limiter, 'handleRateLimited');
    const source = new GraphMailSource(tokenProvider(), 'common', { throttleLimiter: limiter }, { httpClient: client });

    const folders = await settled(source.listFolders());

    expect(folders).not.toBe(STUCK);
    expect(seen.filter((url) => url.endsWith('/mailFolders/inbox'))).toHaveLength(2);
    expect(budget.taken).toHaveLength(seen.length);
    // The wait is the one Graph asked for, not the limiter's own guess.
    expect(waitFor).toHaveBeenCalledWith(429, '0');
  });

  it('stops asking after the limiter’s retries, with words that read as a rate limit', async () => {
    const routes = mailboxRoutes();
    routes[`${GRAPH}/me/mailFolders/inbox`] = answer(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '0' });
    const { client, seen } = scripted(routes);
    const source = new GraphMailSource(
      tokenProvider(),
      'common',
      { throttleLimiter: limiterOn(countingBudget()) },
      { httpClient: client },
    );

    const outcome = await settled(source.listFolders().catch((error: Error) => error.message));

    // It asked without end before: a pass stood on one mailbox until its deadline.
    expect(outcome).toBe('Rate limited after 2 retries. Status: 429');
    expect(seen.filter((url) => url.endsWith('/mailFolders/inbox'))).toHaveLength(3);
    expect(classifyFailure(outcome, 'source')).toBe('rate_limited');
  });
});

const GOOGLE_CALDAV = 'https://apidata.googleusercontent.com/caldav/v2/owner%40example.com/user/';
const GOOGLE_CARDDAV = 'https://www.googleapis.com/carddav/v1/principals/owner%40example.com/';

/** Google's GData refusal, as its DAV endpoints answer. */
function gdata(code: string, reason: string, headers: Record<string, string> = {}): HttpResponse {
  return answer(
    403,
    '<?xml version="1.0" encoding="UTF-8"?><errors xmlns="http://schemas.google.com/g/2005">' +
      `<error><domain>GData</domain><code>${code}</code><internalReason>${reason}</internalReason></error></errors>`,
    headers,
  );
}

/** Asked to come back at once, so the test does not wait the default second. */
const NOW = { 'retry-after': '0' };

const NOT_ENABLED = gdata('accessNotConfigured', 'The API has not been used in project 123 before or it is disabled.');

const DAV_SOURCES = [
  {
    name: 'CalDAV',
    url: GOOGLE_CALDAV,
    list: (client: HttpClient) =>
      new CalDAVSource({ url: GOOGLE_CALDAV, username: 'owner@example.com', password: 'x' }, { httpClient: client }).listFolders(),
  },
  {
    name: 'CardDAV',
    url: GOOGLE_CARDDAV,
    list: (client: HttpClient) =>
      new CarddavSource({ url: GOOGLE_CARDDAV, username: 'owner@example.com', password: 'x' }, { httpClient: client }).listFolders(),
  },
] as const;

describe.each(DAV_SOURCES)('the $name source, reading Google', ({ list }) => {
  /**
   * The discovery's PROPFINDs answered from one queue (the last answer
   * repeats), and counted. Its `.well-known` probe goes first and finds
   * nothing, as it does at Google.
   */
  function queued(answers: HttpResponse[]): { client: HttpClient; seen: string[] } {
    const seen: string[] = [];
    const queue = [...answers];
    const client: HttpClient = {
      async request(options) {
        if (options.url.includes('/.well-known/')) return answer(404, '');
        seen.push(`${options.method} ${options.url}`);
        return queue.length > 1 ? queue.shift()! : queue[0]!;
      },
    };
    return { client, seen };
  }

  async function outcome(client: HttpClient): Promise<string> {
    const message = await settled(
      list(client).then(
        () => 'listed',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    );
    return String(message);
  }

  it('waits out a 429 and asks once more', async () => {
    const { client, seen } = queued([answer(429, '', { 'retry-after': '0' }), NOT_ENABLED]);

    // The second answer is the one reported: the 429 was not.
    expect(await outcome(client)).toContain('accessNotConfigured');
    expect(seen).toHaveLength(2);
  });

  it('reads Google’s 403 rate limit as one, and asks once more', async () => {
    const { client, seen } = queued([gdata('rateLimitExceeded', 'Rate limit exceeded', NOW), NOT_ENABLED]);

    expect(await outcome(client)).toContain('accessNotConfigured');
    expect(seen).toHaveLength(2);
  });

  it('reports a rate limit that holds as a rate limit, not a refusal to reconnect over', async () => {
    const { client, seen } = queued([gdata('userRateLimitExceeded', 'Queries per minute per user', NOW)]);

    const message = await outcome(client);

    expect(seen).toHaveLength(2);
    expect(message).toContain('userRateLimitExceeded');
    expect(classifyFailure(message, 'source')).toBe('rate_limited');
  });

  it('asks a refusal only once', async () => {
    const { client, seen } = queued([NOT_ENABLED]);

    expect(await outcome(client)).toContain('accessNotConfigured');
    expect(seen).toHaveLength(1);
  });

  it('does not sleep through a window longer than a minute', async () => {
    const { client, seen } = queued([answer(429, '', { 'retry-after': '3600' })]);

    const message = await outcome(client);

    expect(message).toContain('429');
    expect(seen).toHaveLength(1);
    expect(classifyFailure(message, 'source')).toBe('rate_limited');
  });
});

describe('how long a rate limit is waited out', () => {
  it('is what Retry-After asks, in seconds or as a date, up to a minute', () => {
    expect(rateLimitWaitMs('0')).toBe(0);
    expect(rateLimitWaitMs(' 5 ')).toBe(5_000);
    expect(rateLimitWaitMs('60')).toBe(60_000);
    const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
    expect(rateLimitWaitMs(inTenSeconds)).toBeGreaterThan(8_000);
    expect(rateLimitWaitMs(inTenSeconds)).toBeLessThanOrEqual(10_000);
  });

  it('is one second when the server does not say, or says nothing readable', () => {
    expect(rateLimitWaitMs(undefined)).toBe(RATE_LIMIT_FALLBACK_WAIT_MS);
    expect(rateLimitWaitMs(null)).toBe(RATE_LIMIT_FALLBACK_WAIT_MS);
    expect(rateLimitWaitMs('')).toBe(RATE_LIMIT_FALLBACK_WAIT_MS);
    expect(rateLimitWaitMs('soon')).toBe(RATE_LIMIT_FALLBACK_WAIT_MS);
    expect(RATE_LIMIT_FALLBACK_WAIT_MS).toBe(1_000);
  });

  it('is not taken when the server asks for longer than a minute', () => {
    expect(rateLimitWaitMs('61')).toBeUndefined();
    expect(rateLimitWaitMs(new Date(Date.now() + 3_600_000).toUTCString())).toBeUndefined();
  });
});
