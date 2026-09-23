// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT EACH RELOAD STARTED (2026-09-22).
 *
 * The confirm screen enqueues a preflight when it opens, and when the count is
 * slow its message says *"reload to check again"*. `POST /:id/discover`
 * enqueued with nothing to tell one request from the next, so each reload
 * started ANOTHER full count, running beside the first against the same
 * provider. On the owner's first Microsoft run that meant one more walk of a
 * OneDrive per reload, and counts on screen re-stamped mid-flight by a count
 * that had just begun.
 *
 * The rule is two keys: the idempotency key says whether a request is the SAME
 * count (so it joins the one under way), and the concurrency key says two
 * counts of one migration never run at once. These pin both; the queue that
 * makes the second one mean anything is pinned beside the job
 * (`apps/worker/src/jobs/one-count-per-migration.unit.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_JOIN_WINDOW,
  discoveryTriggerOptions,
} from './job-resolution.ts';

const TENANT = 't-1';
const MAPPING = 'm-1';
const EDITED = new Date('2026-09-22T21:00:00Z');

describe('a reload asks for the same count', () => {
  it('and so carries the same idempotency key, which joins the run already started', () => {
    const first = discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: EDITED });
    const reload = discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: new Date(EDITED) });

    expect(reload.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.idempotencyKeyTTL).toBe(DISCOVERY_JOIN_WINDOW);
  });

  it('whatever order the same domains are asked in', () => {
    const a = discoveryTriggerOptions(TENANT, MAPPING, {
      updatedAt: EDITED,
      domains: ['file', 'calendar'],
    });
    const b = discoveryTriggerOptions(TENANT, MAPPING, {
      updatedAt: EDITED,
      domains: ['calendar', 'file'],
    });

    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });
});

describe('a different question is a different count', () => {
  it('once the migration has been changed since, because the answer may differ', () => {
    const before = discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: EDITED });
    const after = discoveryTriggerOptions(TENANT, MAPPING, {
      updatedAt: new Date(EDITED.getTime() + 1000),
    });

    expect(after.idempotencyKey).not.toBe(before.idempotencyKey);
  });

  it('for a narrower count somebody asked for on purpose', () => {
    const own = discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: EDITED });
    const narrower = discoveryTriggerOptions(TENANT, MAPPING, {
      updatedAt: EDITED,
      domains: ['file'],
    });

    expect(narrower.idempotencyKey).not.toBe(own.idempotencyKey);
  });

  it('for another migration', () => {
    const one = discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: EDITED });
    const other = discoveryTriggerOptions(TENANT, 'm-2', { updatedAt: EDITED });

    expect(other.idempotencyKey).not.toBe(one.idempotencyKey);
  });
});

describe('two counts of one migration never run at once', () => {
  it('because every count of it shares one concurrency key', () => {
    const own = discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: EDITED });
    const later = discoveryTriggerOptions(TENANT, MAPPING, {
      updatedAt: new Date(EDITED.getTime() + 60_000),
      domains: ['file'],
    });

    expect(own.concurrencyKey).toBe(MAPPING);
    expect(later.concurrencyKey).toBe(MAPPING);
  });

  it('while keeping the tags the dashboard filters by', () => {
    expect(discoveryTriggerOptions(TENANT, MAPPING, { updatedAt: EDITED }).tags).toEqual([
      `tenant:${TENANT}`,
      `mapping:${MAPPING}`,
    ]);
  });
});
