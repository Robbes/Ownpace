// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A 500 is a BUG, not a refusal — and it must not answer with the bug
 * (workplan 0079).
 *
 * Eleven routes answered `{ error: 'list_failed', reason: String(error) }`.
 * Two things were wrong with that, and the create route's own comment had
 * already said both:
 *
 *  1. **It hands internals to a browser.** `String(error)` on a driver failure
 *     can carry a connection string, a query, a host. That is the reason the
 *     create route stopped doing it (workplan 0068), and eleven other places
 *     went on doing it.
 *  2. **It gives the person nothing to act on.** A stringified error is not a
 *     sentence anyone can use, and it does not connect the red box in front of
 *     them to the stack sitting in the log.
 *
 * The fix for both is the one 0068 T10c asked for and only ever applied to
 * create: a short reference shared by the log line and the response. The
 * message stays safe, and quoting the reference finds the detail. Reference
 * `e133a809` is how the create-route 500 was diagnosed at all — this is that,
 * everywhere.
 */

import type { Response } from 'express';
import { log, newReference, recordAppEvent } from '@openmig/shared';

/** How deep a chain of causes is followed before the rest is printed as it is. */
const MAX_DEPTH = 8;

/**
 * The error as the log may print it: everything it carries but a `body`.
 *
 * A body parser's error carries the raw request text as `body` (#1490's
 * review, workplan 0093): a stranger's address and note, printed with the
 * error. Those errors no longer reach here (`unreadable-body.ts`), and this
 * keeps any other error that carries a body, in its `cause` or among the
 * `errors` it gathers, from doing the same. Nothing that calls `serverFault`
 * hands it a body anybody reads in the log.
 *
 * The caller's error is not changed. An error with no body anywhere is
 * returned as it is, so it prints exactly as before. One with a body is
 * copied without it: same prototype, same fields, and its message and stack
 * read into the copy, so the line still names the error and where it began.
 */
export function loggableError(error: unknown, depth = 0): unknown {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH) return error;
  const replaced = new Map<PropertyKey, unknown>();
  const cause = Object.getOwnPropertyDescriptor(error, 'cause');
  if (cause && 'value' in cause) {
    const kept = loggableError(cause.value, depth + 1);
    if (kept !== cause.value) replaced.set('cause', kept);
  }
  const errors: unknown = Object.getOwnPropertyDescriptor(error, 'errors')?.value;
  if (Array.isArray(errors)) {
    const kept = errors.map((e: unknown) => loggableError(e, depth + 1));
    if (kept.some((e, i) => e !== errors[i])) replaced.set('errors', kept);
  }
  if (!Object.hasOwn(error, 'body') && replaced.size === 0) return error;
  const copy: PropertyDescriptorMap = {};
  for (const key of Reflect.ownKeys(error)) {
    if (key === 'body') continue;
    copy[key] = {
      value: replaced.has(key) ? replaced.get(key) : (error as Record<PropertyKey, unknown>)[key],
      enumerable: Object.getOwnPropertyDescriptor(error, key)?.enumerable ?? false,
      writable: true,
      configurable: true,
    };
  }
  return Object.create(Object.getPrototypeOf(error) as object | null, copy) as unknown;
}

/**
 * Log the fault with a reference and answer with a safe sentence carrying it.
 *
 * `doing` completes both "…failed" in the log and "Something went wrong …" in
 * the response, so it reads as a gerund: `'listing connections'`.
 */
export function serverFault(res: Response, code: string, doing: string, error: unknown): void {
  const ref = newReference();
  log.error(`[api] ${doing} failed [ref ${ref}]:`, loggableError(error));
  // And on the operator's log page (0129 T1), searchable by the same
  // reference: the code as the event, the organisation when the request had
  // one, and never the error's text. Not awaited: `recordAppEvent` never
  // throws, and the answer to the person must not wait on the log.
  const tenantId: unknown = res.locals?.tenantId;
  void recordAppEvent({
    level: 'error',
    event: `api.${code}`,
    reference: ref,
    ...(typeof tenantId === 'string' && tenantId ? { tenantId } : {}),
  });
  res.status(500).json({
    error: code,
    reason:
      `Something went wrong ${doing} — this is a fault on our side, not something ` +
      `your input caused. Reference ${ref}; quoting it finds the detail in the server log.`,
  });
}
