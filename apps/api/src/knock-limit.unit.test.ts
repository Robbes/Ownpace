// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The refusing rate limit in front of the one route anybody can reach.
 *
 * Time is injected, not slept: a test that waits out a real window is a test
 * nobody runs.
 */

import { describe, it, expect } from 'vitest';
import { createKnockLimiter, knockLimitFromEnv, DEFAULT_KNOCK_LIMIT } from './knock-limit.ts';

describe('createKnockLimiter', () => {
  it('allows up to max in a window, then refuses', () => {
    const limiter = createKnockLimiter({ windowMs: 1000, max: 3 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 100)).toBe(true);
    expect(limiter.take('a', 200)).toBe(true);
    expect(limiter.take('a', 300)).toBe(false);
  });

  it('counts each caller separately', () => {
    // The bug that makes a limiter useless: one busy caller locking everyone
    // else out of a public form.
    const limiter = createKnockLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 1)).toBe(false);
    expect(limiter.take('b', 2)).toBe(true);
  });

  it('opens a fresh window once the old one has passed', () => {
    const limiter = createKnockLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 999)).toBe(false);
    expect(limiter.take('a', 1000)).toBe(true);
  });

  it('says how long to wait, and says nothing to a caller with no window', () => {
    const limiter = createKnockLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.retryAfterSeconds('a', 0)).toBe(0);
    limiter.take('a', 0);
    expect(limiter.retryAfterSeconds('a', 0)).toBe(60);
    expect(limiter.retryAfterSeconds('a', 59_500)).toBe(1);
    // Never zero while the window is open — a `Retry-After: 0` invites an
    // immediate retry that will be refused again.
    expect(limiter.retryAfterSeconds('a', 59_999)).toBe(1);
    expect(limiter.retryAfterSeconds('a', 60_000)).toBe(0);
  });

  it('does not hold a caller for ever once they stop', () => {
    // The map is swept lazily; what matters is that an expired window is not
    // consulted, whether or not it has been deleted yet.
    const limiter = createKnockLimiter({ windowMs: 10, max: 1 });
    for (let i = 0; i < 100; i++) expect(limiter.take(`caller-${i}`, i * 100)).toBe(true);
    expect(limiter.take('caller-0', 100_000)).toBe(true);
  });

  it('defaults to a number that can survive being a SERVICE-WIDE cap', () => {
    // The key is `req.ip`, which is the ingress's address unless TRUST_PROXY is
    // set — so on a normal deployment this one bucket is the whole service. At
    // the original 5, the sixth person to ask for an account in an hour was
    // refused, and nothing would have said so. Its own integration test found
    // it: the suite's sixth request 429'd.
    //
    // The floor here is not a style preference. Anything under a couple of
    // dozen an hour cannot serve a launch day through one bucket.
    expect(DEFAULT_KNOCK_LIMIT.max).toBeGreaterThanOrEqual(30);
    expect(DEFAULT_KNOCK_LIMIT.windowMs).toBe(60 * 60 * 1000);
  });
});

describe('knockLimitFromEnv', () => {
  it('uses the default when nothing is configured', () => {
    expect(knockLimitFromEnv({})).toEqual(DEFAULT_KNOCK_LIMIT);
    expect(knockLimitFromEnv({ ACCESS_REQUEST_MAX_PER_HOUR: '' })).toEqual(DEFAULT_KNOCK_LIMIT);
    expect(knockLimitFromEnv({ ACCESS_REQUEST_MAX_PER_HOUR: '   ' })).toEqual(DEFAULT_KNOCK_LIMIT);
  });

  it('takes a configured number', () => {
    expect(knockLimitFromEnv({ ACCESS_REQUEST_MAX_PER_HOUR: '250' })).toEqual({
      windowMs: 60 * 60 * 1000,
      max: 250,
    });
  });

  it('refuses a value somebody clearly meant to set, rather than falling back', () => {
    // Hard rule 9. A typo'd limit that silently becomes the default is a
    // configuration that lies — the operator reads their own value in .env and
    // the service is running on another one.
    for (const bad of ['0', '-1', 'lots', '1.5', 'NaN']) {
      expect(
        () => knockLimitFromEnv({ ACCESS_REQUEST_MAX_PER_HOUR: bad }),
        `${bad} should have been refused`,
      ).toThrow(/positive integer/);
    }
  });

  it('says in its refusal that the cap is usually service-wide', () => {
    // The sentence an operator reads while choosing a number is the only place
    // that fact reaches them at the moment it matters.
    expect(() => knockLimitFromEnv({ ACCESS_REQUEST_MAX_PER_HOUR: 'x' })).toThrow(/TRUST_PROXY/);
  });
});
