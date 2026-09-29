// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RETRY GIVES ITS SLOT BACK (workplan 0143 T10).
 *
 * `executeWithThrottling` took a new concurrency slot for every attempt and
 * gave back only the last one. Each 429, 503 or transient error it retried
 * cost the limiter a slot for good, and after `maxConcurrent` of them the next
 * request waited for a slot nothing would free: the pass stood still until its
 * deadline stopped it. Graph mail joins this limiter in the same change, so
 * the leak would have reached mail too.
 *
 * Each case races the limiter against a short timer, so the old code fails
 * with a sentence rather than by hanging.
 */

import { describe, it, expect } from 'vitest';
import type { RateBudget } from './rate-budget.ts';
import { ThrottleLimiter } from './throttling.ts';

const FAST = { requestsPerSecond: 1000, maxRetries: 3, baseBackoffMs: 1, maxBackoffMs: 2, jitterMs: 0 };

const ok = { status: 200, headers: {}, body: 'ok' };
const slowDown = { status: 429, headers: { 'retry-after': '0' }, body: 'slow down' };

const STUCK = 'still waiting for a slot';

/** The answer, or `STUCK` when the limiter has not answered within half a second. */
function within<T>(work: Promise<T>): Promise<T | typeof STUCK> {
  return Promise.race([work, new Promise<typeof STUCK>((resolve) => setTimeout(() => resolve(STUCK), 500))]);
}

/** A request that is throttled once and then answered. */
function throttledOnce(): () => Promise<typeof ok | typeof slowDown> {
  let calls = 0;
  return async () => (++calls === 1 ? slowDown : ok);
}

describe('a retried request', () => {
  it('holds no slot once a 429 is waited out and answered', async () => {
    const limiter = new ThrottleLimiter({ ...FAST, maxConcurrent: 4 });

    expect(await within(limiter.executeWithThrottling('t', 'p', throttledOnce()))).toBe(ok);
    expect(limiter.getActiveRequests()).toBe(0);
  });

  it('holds no slot once a transient error is retried and answered', async () => {
    const limiter = new ThrottleLimiter({ ...FAST, maxConcurrent: 4 });
    let calls = 0;

    const answer = await within(
      limiter.executeWithThrottling('t', 'p', async () => {
        if (++calls === 1) throw new Error('network error');
        return ok;
      }),
    );

    expect(answer).toBe(ok);
    expect(limiter.getActiveRequests()).toBe(0);
  });

  it('holds no slot when it gives up', async () => {
    const limiter = new ThrottleLimiter({ ...FAST, maxConcurrent: 4 });

    const outcome = await within(
      limiter.executeWithThrottling('t', 'p', async () => slowDown).catch((error: Error) => error.message),
    );

    expect(outcome).toBe('Rate limited after 3 retries. Status: 429');
    expect(limiter.getActiveRequests()).toBe(0);
  });

  it('lets every later request through a single slot, after throttled ones', async () => {
    const limiter = new ThrottleLimiter({ ...FAST, maxConcurrent: 1 });

    for (let i = 0; i < 3; i++) {
      expect(await within(limiter.executeWithThrottling('t', 'p', throttledOnce()))).toBe(ok);
    }
    expect(await within(limiter.executeWithThrottling('t', 'p', async () => ok))).toBe(ok);
  });

  it('gives no slot back twice when the shared budget refuses', async () => {
    const budget: RateBudget = {
      acquire: async () => {
        throw new Error('invalid input syntax for type uuid');
      },
    };
    const limiter = new ThrottleLimiter({ ...FAST, maxConcurrent: 2 }, budget);

    await expect(limiter.executeWithThrottling('t', 'p', async () => ok)).rejects.toThrow(/uuid/);
    // Below zero, the cap would have been raised by one for every refusal.
    expect(limiter.getActiveRequests()).toBe(0);
  });
});
