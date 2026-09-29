// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NETWORK ERROR THE LIMITER RETRIES (found with workplan 0143 T10).
 *
 * `executeWithThrottling` asks a request again when the network, not the
 * provider, failed it. Its check lowercased the message and then looked for
 * `ECONN`, `ETIMEDOUT` and `EPIPE` in capitals, so none of them matched. And
 * undici throws `fetch failed`, with the code on its `cause`. So a connection
 * reset under a Graph or Google Tasks request failed the item at once, on
 * every face that retries through the limiter, and mail since T10.
 *
 * What this holds: each shape Node and undici throw for a network that did
 * not answer is asked again, and a provider's own refusal is still not.
 */

import { describe, it, expect } from 'vitest';
import { ThrottleLimiter } from './throttling.ts';

const FAST = { requestsPerSecond: 1000, maxConcurrent: 4, maxRetries: 3, baseBackoffMs: 1, maxBackoffMs: 2, jitterMs: 0 };

const ok = { status: 200, headers: {}, body: 'ok' };

/** A request that throws `first` once, then answers. */
function failingOnceWith(first: Error): { request: () => Promise<typeof ok>; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    request: async () => {
      calls += 1;
      if (calls === 1) throw first;
      return ok;
    },
  };
}

const withCode = (error: Error, code: string): Error => Object.assign(error, { code });

describe('a request the network failed is asked again', () => {
  it.each([
    ['a reset connection, as Node words it', new Error('read ECONNRESET')],
    ['a reset connection, by its code', withCode(new Error('socket closed'), 'ECONNRESET')],
    ['a connect that timed out', withCode(new Error('connect ETIMEDOUT 192.0.2.1:443'), 'ETIMEDOUT')],
    ['a broken pipe', withCode(new Error('write EPIPE'), 'EPIPE')],
    ['a name that did not resolve for now', withCode(new Error('getaddrinfo EAI_AGAIN graph.microsoft.com'), 'EAI_AGAIN')],
    [
      "undici's fetch failed, the code on its cause",
      new TypeError('fetch failed', { cause: withCode(new Error('other side closed'), 'UND_ERR_SOCKET') }),
    ],
    [
      "undici's connect timeout",
      new TypeError('fetch failed', { cause: withCode(new Error('Connect Timeout Error'), 'UND_ERR_CONNECT_TIMEOUT') }),
    ],
    ['a socket the server hung up', new Error('socket hang up')],
  ])('%s', async (_what, error) => {
    const limiter = new ThrottleLimiter(FAST);
    const { request, calls } = failingOnceWith(error);

    expect(await limiter.executeWithThrottling('t', 'p', request)).toBe(ok);
    expect(calls()).toBe(2);
    expect(limiter.getActiveRequests()).toBe(0);
  });
});

describe('an answer from the provider is not asked again', () => {
  it.each([
    ['a refusal in its own words', new Error('Graph refused: 403 Forbidden')],
    ['an error with a code that is not the network', withCode(new Error('not allowed'), 'ERR_INVALID_URL')],
    ['a fetch that failed for a reason that is not the network', new TypeError('fetch failed', { cause: new Error('bad port') })],
  ])('%s', async (_what, error) => {
    const limiter = new ThrottleLimiter(FAST);
    const { request, calls } = failingOnceWith(error);

    await expect(limiter.executeWithThrottling('t', 'p', request)).rejects.toBe(error);
    expect(calls()).toBe(1);
    expect(limiter.getActiveRequests()).toBe(0);
  });
});
