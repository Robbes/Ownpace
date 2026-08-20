// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The shared DAV write retry.
 *
 * Nextcloud's default SQLite is a single-writer database; under concurrent
 * writes it answers 500 "database is locked", transiently. Each DAV writer
 * carried its own copy of a retry for this — three identical copies, all
 * weaker than the seed script's, which was the only one ever measured against
 * the real failure (200/200 fixtures through 27 lock responses).
 *
 * These tests pin the behaviour that matters when the e2e's DAV domains stop
 * running one-item-at-a-time: transient means wait, everything else means stop.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestWithDavRetry, isTransientDavStatus } from './dav-retry.ts';

/** Real Nextcloud lock response, for the status that actually matters. */
const LOCKED = 500;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Replace the timer so backoff is instant but still observable. */
function captureWaits(): number[] {
  const waits: number[] = [];
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    waits.push(ms ?? 0);
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as never);
  return waits;
}

describe('isTransientDavStatus', () => {
  it('treats "busy" as transient and "no" as final', () => {
    // Busy: the server is asking us to come back.
    for (const s of [500, 502, 503, 423, 429]) expect(isTransientDavStatus(s)).toBe(true);
    // Final: retrying only delays the answer. 412 especially — that is a
    // create-only precondition working as intended, which the caller reads as
    // success, not something to repeat.
    for (const s of [200, 201, 204, 207, 401, 403, 412, 415]) expect(isTransientDavStatus(s)).toBe(false);
  });
});

describe('requestWithDavRetry', () => {
  it('rides out a lock and returns the eventual success', async () => {
    captureWaits();
    const statuses = [LOCKED, LOCKED, 201];
    let n = 0;
    const send = vi.fn(async () => ({ status: statuses[n++]! }));

    const res = await requestWithDavRetry(send);

    expect(res.status).toBe(201);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('backs off further each time, with jitter', async () => {
    const waits = captureWaits();
    const send = vi.fn(async () => ({ status: LOCKED }));

    await requestWithDavRetry(send);

    // 5 attempts => 4 waits, each longer than the last.
    expect(waits).toHaveLength(4);
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThan(waits[i - 1]!);
    // Jittered, so colliding writers do not resume in lockstep and collide again.
    expect(waits.some((w) => !Number.isInteger(w))).toBe(true);
  });

  it('gives up after the cap and hands the failure back', async () => {
    captureWaits();
    const send = vi.fn(async () => ({ status: LOCKED }));

    const res = await requestWithDavRetry(send);

    // Returned, not thrown: callers already inspect status and raise their own
    // domain-specific errors, and throwing here would take that away.
    expect(res.status).toBe(LOCKED);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('does not retry a status that will never change', async () => {
    const waits = captureWaits();
    const send = vi.fn(async () => ({ status: 403 }));

    const res = await requestWithDavRetry(send);

    expect(res.status).toBe(403);
    expect(send).toHaveBeenCalledTimes(1);
    expect(waits).toHaveLength(0);
  });

  it('returns a first-try success without waiting at all', async () => {
    const waits = captureWaits();
    const send = vi.fn(async () => ({ status: 201 }));

    await requestWithDavRetry(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(waits).toHaveLength(0);
  });
});
