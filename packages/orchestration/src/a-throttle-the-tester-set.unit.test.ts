// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A THROTTLE THE TESTER SET (workplan 0143 T2c): the pass's half.
 *
 * The managed doors took a `throttleConfig` from the organisation and stored
 * it, and a pass read it back as the rate and concurrency to ask its
 * providers with. Both spend a budget every organisation on the machine
 * shares. The doors now refuse it (the API's half is in create-coherence);
 * a row stored before that is held to the operator's defaults here:
 *
 *  1. a stored rate or concurrency above the defaults is read as the default;
 *  2. one below them is kept: lowering is always allowed;
 *  3. no stored throttle stays none, and the rest of a stored one is kept;
 *  4. the limiter a pass is built with reads it so, and so does the rate
 *     budget every pass of the organisation shares, which took the row's
 *     rate as it was.
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_THROTTLE_CONFIG } from '@openmig/shared';

/** The rate each shared budget is built with: the one every pass of the tenant spends. */
const budgetRates: number[] = [];
vi.mock('@openmig/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/ledger')>();
  class RecordedRateBudget extends actual.PgRateBudget {
    constructor(...args: ConstructorParameters<typeof actual.PgRateBudget>) {
      super(...args);
      budgetRates.push(args[1].requestsPerSecond);
    }
  }
  return { ...actual, PgRateBudget: RecordedRateBudget };
});

const { operatorsThrottle, tenantThrottleLimiter } = await import('./build-deps-from-mapping.ts');

describe('a throttle stored before the doors refused it', () => {
  it('is held to the defaults', () => {
    expect(operatorsThrottle({ requestsPerSecond: 50, maxConcurrent: 20 })).toEqual({
      requestsPerSecond: DEFAULT_THROTTLE_CONFIG.requestsPerSecond,
      maxConcurrent: DEFAULT_THROTTLE_CONFIG.maxConcurrent,
    });
  });

  it('keeps a lower value: lowering is always allowed', () => {
    expect(operatorsThrottle({ requestsPerSecond: 2, maxConcurrent: 1 })).toEqual({
      requestsPerSecond: 2,
      maxConcurrent: 1,
    });
  });

  it('keeps what it does not hold, and leaves none as none', () => {
    expect(operatorsThrottle({ downloadBytesPerDay: 1_000_000_000, maxRetries: 3 })).toEqual({
      downloadBytesPerDay: 1_000_000_000,
      maxRetries: 3,
      requestsPerSecond: DEFAULT_THROTTLE_CONFIG.requestsPerSecond,
      maxConcurrent: DEFAULT_THROTTLE_CONFIG.maxConcurrent,
    });
    expect(operatorsThrottle(null)).toBeNull();
    expect(operatorsThrottle(undefined)).toBeUndefined();
  });
});

describe('the limiter a pass is built with', () => {
  it('asks at the default rate and concurrency, whatever the row says above them', () => {
    // The shared budget only touches the database when a request spends it.
    budgetRates.length = 0;
    const limiter = tenantThrottleLimiter({} as never, '7a0771e0-0929-41d4-a716-446655440001', {
      requestsPerSecond: 50,
      maxConcurrent: 20,
    });
    expect(limiter.config.requestsPerSecond).toBe(DEFAULT_THROTTLE_CONFIG.requestsPerSecond);
    expect(limiter.config.maxConcurrent).toBe(DEFAULT_THROTTLE_CONFIG.maxConcurrent);
    // The limiter alone only ever lowered these. The budget every pass of the
    // organisation shares took the row's rate as it was: that is what T2c holds.
    expect(budgetRates).toEqual([DEFAULT_THROTTLE_CONFIG.requestsPerSecond]);
  });
});
