// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE COUNT PER MIGRATION AT A TIME (2026-09-22).
 *
 * The API enqueues every preflight with `concurrencyKey: mappingId`
 * (`discoveryTriggerOptions`). A concurrency key only names a partition of the
 * task's queue; it is the queue's limit of ONE that makes a second count of the
 * same migration wait for the first instead of racing it. Without the limit,
 * every reload of the confirm screen ran another full count beside the first —
 * which is what the owner's first Microsoft preflight did.
 */

import { describe, it, expect } from 'vitest';

// The job module opens its pool at import; no query is made here.
process.env.DATABASE_URL ??= 'postgres://discovery.test.invalid/none';

const { discoveryQueue } = await import('./run-discovery.ts');

describe('the discovery queue', () => {
  it('runs one count per concurrency key', () => {
    expect(discoveryQueue).toMatchObject({ name: 'run-discovery', concurrencyLimit: 1 });
  });
});
