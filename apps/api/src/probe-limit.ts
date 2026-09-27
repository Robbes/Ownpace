// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LIMIT ON TESTS, PER MEMBER (workplan 0136 T3).
 *
 * Five doors connect to an address somebody typed (0136 §1): the Test door,
 * the add, test and rotate doors of `/api/connections`, and the permission
 * report. Each is behind `authenticate` and nothing else, so any member of any
 * organisation could call them as fast as a script can, and every call is a
 * connection from inside our network to an address of their choosing. The
 * answer no longer reads the remote aloud (`probe-answer.ts`), but a status, a
 * category and how long it took still tell a scanner something.
 *
 * So one refusing limit, shared by the five doors, per member. A person
 * pressing Test by hand never meets it; a script trying names and ports does.
 * It is `createKnockLimiter`, the limiter the problem report uses, with that
 * limiter's caveat: the counters live in this process, so with several API
 * replicas the limit is that many times this. The managed API runs one.
 *
 * A door counts a request only when it is about to connect: a request refused
 * for its shape, or for an archive on this machine, has connected to nothing.
 */

import type { Response } from 'express';
import { createKnockLimiter, type KnockLimitConfig, type KnockLimiter } from './knock-limit.ts';

/** Sixty tests an hour, per member, across the five doors. */
export const PROBE_TEST_LIMIT: KnockLimitConfig = { windowMs: 60 * 60 * 1000, max: 60 };

let limiter: KnockLimiter = createKnockLimiter(PROBE_TEST_LIMIT);

/** A fresh window, for tests: their cases must not share one. */
export function resetProbeTestLimit(config: KnockLimitConfig = PROBE_TEST_LIMIT): void {
  limiter = createKnockLimiter(config);
}

/**
 * Count one test for this member, or answer 429 with when to try again.
 * `true` when the request was refused, and the door must stop there.
 */
export function refusedOverTestLimit(
  who: { readonly tenantId?: string; readonly userId?: string },
  res: Response,
): boolean {
  const key = `${who.tenantId ?? ''}:${who.userId ?? ''}`;
  if (limiter.take(key)) return false;
  res.set('Retry-After', String(limiter.retryAfterSeconds(key)));
  res.status(429).json({
    error: 'too_many_tests',
    reason: 'You have tested a lot of connections in the last hour. Wait a little, then test again.',
  });
  return true;
}
