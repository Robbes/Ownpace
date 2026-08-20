// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Throttling Unit Tests
 * 
 * Tests for:
 * - Token bucket behavior
 * - 429 handling with Retry-After
 * - Exponential backoff with jitter
 * - Concurrency limits
 * - Throttle event counting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ThrottleLimiter,
  type ThrottleConfig,
  DEFAULT_THROTTLE_CONFIG,
  createThrottleLimiterFromMapping,
} from './throttling.ts';

/** A config that only varies where a test says it does. */
const FAST: ThrottleConfig = {
  maxConcurrent: 10,
  requestsPerSecond: 10,
  maxRetries: 5,
  baseBackoffMs: 1000,
  maxBackoffMs: 60000,
  jitterMs: 500,
};

/**
 * Did this acquisition have to WAIT for a token?
 *
 * `waitForSlot` resolves when it gets one and otherwise sits in a `setTimeout`,
 * so under fake timers "still pending after the microtask queue drains" is
 * exactly "the bucket is empty". The slot is released either way so the
 * concurrency gate is not left holding a count, and a blocked call is drained
 * afterwards so it cannot leak a pending timer into the next assertion.
 *
 * Without this, every assertion available is "the call returned", which is true
 * of a limiter that does not limit anything.
 */
async function blocks(limiter: ThrottleLimiter, tenant: string, provider: string): Promise<boolean> {
  let done = false;
  const p = limiter.waitForSlot(tenant, provider).then(() => {
    done = true;
    limiter.releaseSlot();
  });
  // Several turns, because `waitForSlot` awaits before it reaches the bucket.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  if (done) return false;
  // Let the pending wait finish so it does not outlive this call.
  await vi.advanceTimersByTimeAsync(60_000);
  await p;
  return true;
}

describe('ThrottleLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Token Bucket', () => {
    it('should allow requests up to bucket capacity', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 10,
        maxRetries: 5,
        baseBackoffMs: 1000,
        maxBackoffMs: 60000,
        jitterMs: 500,
      });

      // Should be able to acquire tokens up to capacity immediately
      await limiter.waitForSlot('tenant1', 'graph.microsoft.com');
      limiter.releaseSlot();
      
      expect(limiter.getActiveRequests()).toBe(0);
    });

    it('should refill tokens over time', async () => {
      // Both of the tests in this pair contained NO `expect` at all until
      // 2026-08-07. They called `waitForSlot`, released, and ended — so they
      // passed if the bucket never refilled, if it had infinite capacity, or if
      // `waitForSlot` were a no-op. Neither could fail except by throwing.
      //
      // A FRESH LIMITER PER ASSERTION. `blocks()` has to let a pending wait
      // finish, which advances the clock and refills the bucket — so reusing
      // one limiter would leave each later assertion measuring a state the
      // previous one had already changed.
      const drained = async (perSecond: number) => {
        const l = new ThrottleLimiter({ ...FAST, requestsPerSecond: perSecond });
        // Capacity equals the refill rate, so this empties it exactly.
        for (let i = 0; i < perSecond; i++) {
          await l.waitForSlot('t', 'p');
          l.releaseSlot();
        }
        return l;
      };

      // Empty, and no time has passed: the next one must WAIT. Asserting the
      // wait is the whole point — a bucket that hands out tokens forever passes
      // every "should be able to acquire" assertion ever written.
      expect(await blocks(await drained(2), 't', 'p'), 'an empty bucket handed out a token').toBe(
        true,
      );

      // 500ms buys exactly one token at 2/s.
      const refilled = await drained(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(await blocks(refilled, 't', 'p'), 'no token after a full refill period').toBe(false);

      // …and 100ms buys 0.2 of one, which is not a token. Without this the
      // assertion above is satisfied by a bucket that refills instantly.
      const barely = await drained(2);
      await vi.advanceTimersByTimeAsync(100);
      expect(await blocks(barely, 't', 'p'), 'a fifth of a token was spent as a whole one').toBe(
        true,
      );
    });

    it('should create separate buckets per (tenant, provider)', async () => {
      // THE TEST THAT COULD NOT SEE ITS OWN SUBJECT. It used to acquire once for
      // tenant1, once for tenant2 and once for another provider, at 10 req/s —
      // three calls against a bucket holding ten tokens. Every one succeeded
      // whether the buckets were separate or a single global one, and on
      // 2026-08-07 that was confirmed by mutation: keying every bucket to the
      // literal 'GLOBAL' passed all 1920 tests.
      //
      // It matters. One global bucket means one tenant's migration spends the
      // rate budget of every other tenant on the managed edition, and the
      // separate limits Graph and a customer's own server need collapse into
      // one number.
      const limiter = new ThrottleLimiter({ ...FAST, requestsPerSecond: 1 });

      // One token per bucket. Spend tenant1's, on graph.
      await limiter.waitForSlot('tenant1', 'graph.microsoft.com');
      limiter.releaseSlot();

      // The two "not blocked" checks come FIRST, deliberately: `blocks()` has
      // to let a pending wait finish, and that advances the clock enough to
      // refill every bucket — so a `true` expectation placed before them would
      // hand them the token they are supposed to have had all along.
      expect(
        await blocks(limiter, 'tenant2', 'graph.microsoft.com'),
        'tenant2 is paying for tenant1 — the buckets are shared',
      ).toBe(false);

      expect(
        await blocks(limiter, 'tenant1', 'outlook.office365.com'),
        'one provider is spending another provider’s budget',
      ).toBe(false);

      // …and tenant1/graph, the one that really was spent, still has to wait.
      // Without this the two above are satisfied by a limiter with no buckets
      // at all.
      expect(
        await blocks(limiter, 'tenant1', 'graph.microsoft.com'),
        'the drained bucket handed out a token anyway',
      ).toBe(true);
    });
  });

  describe('Retry-After Header Handling', () => {
    it('should parse Retry-After as seconds', () => {
      const limiter = new ThrottleLimiter();
      const waitTime = limiter.parseRetryAfterHeader('30');
      expect(waitTime).toBe(30000); // 30 seconds in ms
    });

    it('should parse Retry-After as HTTP-date', () => {
      const limiter = new ThrottleLimiter();
      const futureDate = new Date(Date.now() + 60000).toUTCString();
      const waitTime = limiter.parseRetryAfterHeader(futureDate);
      
      // Should be approximately 60 seconds (with some tolerance for timing)
      expect(waitTime).toBeGreaterThanOrEqual(55000);
      expect(waitTime).toBeLessThanOrEqual(65000);
    });

    it('should default to 60 seconds on parse error', () => {
      const limiter = new ThrottleLimiter();
      const waitTime = limiter.parseRetryAfterHeader('invalid');
      expect(waitTime).toBe(60000);
    });

    it('should handle 429 response with Retry-After header', async () => {
      // Use real timers since the retry logic involves nested async operations
      vi.useRealTimers();

      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 10,  // Short backoff for faster tests
        maxBackoffMs: 100,
        jitterMs: 0,
      });

      let callCount = 0;
      const mockResponse = {
        status: 429,
        headers: { 'retry-after': '1' }, // 1 second
        body: 'Rate limited',
      };

      const result = await limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        if (callCount === 1) {
          return mockResponse;
        }
        return { status: 200, headers: {}, body: 'Success' };
      });

      expect(callCount).toBe(2);
      expect(result.status).toBe(200);
      const stats = limiter.getStats();
      expect(stats.throttleEvents).toBe(1);
      expect(stats.retryAttempts).toBe(1);
    });

    it('should handle 503 response with Retry-After header', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      let callCount = 0;
      const mockResponse = {
        status: 503,
        headers: { 'retry-after': '1' }, // 1 second
        body: 'Service unavailable',
      };

      const promise = limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        if (callCount === 1) {
          return mockResponse;
        }
        return { status: 200, headers: {}, body: 'Success' };
      });

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      expect(callCount).toBe(2);
    });
  });

  describe('Exponential Backoff with Jitter', () => {
    it('should calculate exponential backoff correctly', () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 4,
        requestsPerSecond: 10,
        maxRetries: 5,
        baseBackoffMs: 1000,
        maxBackoffMs: 60000,
        jitterMs: 0, // Disable jitter for predictable testing
      });

      // Formula: base * (2^attempt)
      expect(limiter.calculateBackoff(0)).toBe(1000);  // 1000 * 2^0 = 1000
      expect(limiter.calculateBackoff(1)).toBe(2000);  // 1000 * 2^1 = 2000
      expect(limiter.calculateBackoff(2)).toBe(4000);  // 1000 * 2^2 = 4000
      expect(limiter.calculateBackoff(3)).toBe(8000);  // 1000 * 2^3 = 8000
      expect(limiter.calculateBackoff(4)).toBe(16000); // 1000 * 2^4 = 16000
    });

    it('should cap backoff at maxBackoffMs', () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 4,
        requestsPerSecond: 10,
        maxRetries: 5,
        baseBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: 0,
      });

      // 1000 * 2^10 = 1024000, but should be capped at 30000
      expect(limiter.calculateBackoff(10)).toBe(30000);
    });

    it('should add jitter to backoff', () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 4,
        requestsPerSecond: 10,
        maxRetries: 5,
        baseBackoffMs: 1000,
        maxBackoffMs: 60000,
        jitterMs: 500,
      });

      // Backoff should be between base * 2^attempt and base * 2^attempt + jitter
      const backoff = limiter.calculateBackoff(0);
      expect(backoff).toBeGreaterThanOrEqual(1000);
      expect(backoff).toBeLessThanOrEqual(1500);
    });

    it('should retry with exponential backoff on transient errors', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      let callCount = 0;
      const mockError = new Error('Connection timeout');

      const promise = limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        if (callCount < 4) {
          throw mockError;
        }
        return { status: 200, headers: {}, body: 'Success' };
      });

      // Fast-forward through all retries
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(400);
      await promise;

      expect(callCount).toBe(4);
      const stats = limiter.getStats();
      expect(stats.retryAttempts).toBe(3);
    });

    it('should stop retrying after max retries exceeded', async () => {
      // Use real timers since the retry logic uses setTimeout directly
      vi.useRealTimers();

      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 2,
        baseBackoffMs: 10,  // Short backoff for faster tests
        maxBackoffMs: 100,
        jitterMs: 0,
      });

      let callCount = 0;
      const mockError = new Error('Connection timeout');

      const promise = limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        throw mockError;
      });

      await expect(promise).rejects.toThrow('Connection timeout');

      expect(callCount).toBe(3); // Initial + 2 retries
      const stats = limiter.getStats();
      expect(stats.exceededMaxRetries).toBe(1);
    });
  });

  describe('Concurrency Limits', () => {
    it('should limit concurrent requests', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 2,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      let activeCount = 0;
      let maxActive = 0;
      const results: number[] = [];

      const promises = Array.from({ length: 5 }, async (_, i) => {
        await limiter.waitForSlot('tenant1', 'graph.microsoft.com');
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 50));
        
        results.push(i);
        limiter.releaseSlot();
        activeCount--;
      });

      // Advance fake timers to complete all async operations
      await vi.runAllTimersAsync();
      await Promise.all(promises);

      expect(maxActive).toBeLessThanOrEqual(2);
      expect(results).toHaveLength(5);
    });

    it('should track active requests correctly', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 5,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      expect(limiter.getActiveRequests()).toBe(0);

      await limiter.waitForSlot('tenant1', 'graph.microsoft.com');
      expect(limiter.getActiveRequests()).toBe(1);

      limiter.releaseSlot();
      expect(limiter.getActiveRequests()).toBe(0);
    });
  });

  describe('Throttle Event Counting', () => {
    it('should count throttle events', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      let callCount = 0;
      const mockResponse = {
        status: 429,
        headers: { 'retry-after': '1' },
        body: 'Rate limited',
      };

      const promise = limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        if (callCount === 1) {
          return mockResponse;
        }
        return { status: 200, headers: {}, body: 'Success' };
      });

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      const stats = limiter.getStats();
      expect(stats.throttleEvents).toBe(1);
    });

    it('should track total wait time', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      let callCount = 0;
      const mockResponse = {
        status: 429,
        headers: { 'retry-after': '2' },
        body: 'Rate limited',
      };

      const promise = limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        if (callCount === 1) {
          return mockResponse;
        }
        return { status: 200, headers: {}, body: 'Success' };
      });

      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      const stats = limiter.getStats();
      expect(stats.totalWaitTimeMs).toBeGreaterThanOrEqual(2000);
    });

    it('should reset stats correctly', () => {
      const limiter = new ThrottleLimiter();
      
      // Simulate some stats
      limiter.handleRateLimited(429, '10');
      limiter.handleRateLimited(503, '5');
      
      const statsBefore = limiter.getStats();
      expect(statsBefore.throttleEvents).toBe(2);

      limiter.resetStats();
      
      const statsAfter = limiter.getStats();
      expect(statsAfter.throttleEvents).toBe(0);
      expect(statsAfter.retryAttempts).toBe(0);
      expect(statsAfter.totalWaitTimeMs).toBe(0);
      expect(statsAfter.exceededMaxRetries).toBe(0);
    });
  });

  describe('Configuration', () => {
    it('should use default configuration when not specified', () => {
      const limiter = new ThrottleLimiter();
      
      expect(limiter['config'].maxConcurrent).toBe(DEFAULT_THROTTLE_CONFIG.maxConcurrent);
      expect(limiter['config'].requestsPerSecond).toBe(DEFAULT_THROTTLE_CONFIG.requestsPerSecond);
      expect(limiter['config'].maxRetries).toBe(DEFAULT_THROTTLE_CONFIG.maxRetries);
    });

    it('should use custom configuration when provided', () => {
      const customConfig: Partial<ThrottleConfig> = {
        maxConcurrent: 8,
        requestsPerSecond: 20,
        maxRetries: 10,
        baseBackoffMs: 2000,
        maxBackoffMs: 120000,
        jitterMs: 1000,
      };

      const limiter = new ThrottleLimiter(customConfig);
      
      expect(limiter['config'].maxConcurrent).toBe(8);
      expect(limiter['config'].requestsPerSecond).toBe(20);
      expect(limiter['config'].maxRetries).toBe(10);
      expect(limiter['config'].baseBackoffMs).toBe(2000);
      expect(limiter['config'].maxBackoffMs).toBe(120000);
      expect(limiter['config'].jitterMs).toBe(1000);
    });

    it('should create limiter from config mapping', () => {
      const mapping = {
        'graph.microsoft.com': { maxConcurrent: 2, requestsPerSecond: 5 },
        'outlook.office365.com': { maxConcurrent: 3, requestsPerSecond: 8 },
      };

      const limiter = createThrottleLimiterFromMapping(mapping);
      
      // Should use the most restrictive settings
      expect(limiter['config'].maxConcurrent).toBe(2);
      expect(limiter['config'].requestsPerSecond).toBe(5);
    });

    it('should merge default config with mapping', () => {
      const mapping = {
        'graph.microsoft.com': { maxRetries: 10 },
      };

      const defaultConfig = { maxConcurrent: 8, requestsPerSecond: 20 };

      const limiter = createThrottleLimiterFromMapping(mapping, defaultConfig);
      
      expect(limiter['config'].maxRetries).toBe(10);
      expect(limiter['config'].maxConcurrent).toBe(8);
      expect(limiter['config'].requestsPerSecond).toBe(20);
    });
  });

  describe('Success Handling', () => {
    it('should return successful response immediately', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      const response = await limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"success": true}',
      }));

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json');
      expect(JSON.parse(response.body)).toEqual({ success: true });
    });

    it('should not count successful requests as throttle events', async () => {
      const limiter = new ThrottleLimiter();

      await limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => ({
        status: 200,
        headers: {},
        body: 'Success',
      }));

      const stats = limiter.getStats();
      expect(stats.throttleEvents).toBe(0);
      expect(stats.retryAttempts).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw on non-transient errors without retry', async () => {
      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 5,
        baseBackoffMs: 100,
        maxBackoffMs: 60000,
        jitterMs: 0,
      });

      const error = new Error('Invalid API key');
      
      await expect(
        limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
          throw error;
        })
      ).rejects.toThrow('Invalid API key');

      const stats = limiter.getStats();
      expect(stats.retryAttempts).toBe(0);
    });

    it('should retry on transient errors', async () => {
      // Use real timers for this test since it exercises the full retry loop
      // which has nested async operations that are hard to simulate with fake timers
      vi.useRealTimers();

      const limiter = new ThrottleLimiter({
        maxConcurrent: 10,
        requestsPerSecond: 100,
        maxRetries: 3,
        baseBackoffMs: 10,  // Use shorter backoff for faster tests
        maxBackoffMs: 100,
        jitterMs: 0,
      });

      let callCount = 0;

      // The error message must match the transient error patterns in isTransientError()
      // which checks for 'etimedout' (lowercase)
      const result = await limiter.executeWithThrottling('tenant1', 'graph.microsoft.com', async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Connection timeout - ETIMEDOUT');
        }
        return { status: 200, headers: {}, body: 'Success' };
      });

      expect(callCount).toBe(3);
      expect(result.status).toBe(200);
    });
  });
});
