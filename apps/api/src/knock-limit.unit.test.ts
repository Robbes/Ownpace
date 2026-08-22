// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The refusing rate limit in front of the one route anybody can reach.
 *
 * Time is injected, not slept: a test that waits out a real window is a test
 * nobody runs.
 */

import { describe, it, expect } from 'vitest';
import { createKnockLimiter, DEFAULT_KNOCK_LIMIT } from './knock-limit.ts';

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

  it('defaults to something a mistyped email survives', () => {
    // A person who gets their address wrong and submits again must not be told
    // to come back in an hour.
    expect(DEFAULT_KNOCK_LIMIT.max).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_KNOCK_LIMIT.windowMs).toBe(60 * 60 * 1000);
  });
});
