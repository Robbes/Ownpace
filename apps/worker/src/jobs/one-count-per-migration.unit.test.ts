// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE COUNT PER MIGRATION AT A TIME (2026-09-22).
 *
 * The API enqueues every preflight keyed by the migration
 * (`discoveryTriggerOptions`'s `concurrencyKey: mappingId`). A key only names
 * a partition; it is the queue's limit of ONE per key that makes a second
 * count of the same migration wait for the first instead of racing it.
 * Without it, every reload of the confirm screen ran another full count beside
 * the first — which is what the owner's first Microsoft preflight did. Until
 * alpha.18 that limit was Trigger.dev's queue (`concurrencyLimit: 1`); since
 * then it is the pg-boss queue's (workplan 0167 T9): `singleton`, serialised by
 * the migration's id.
 */

import { describe, it, expect } from 'vitest';
import { JOB_CATALOG } from '@openmig/scheduler/pg-boss';

describe('the discovery queue', () => {
  it('runs one count per migration', () => {
    expect(JOB_CATALOG.find((queue) => queue.name === 'run-discovery')).toMatchObject({
      policy: 'singleton',
      serializedBy: '<mappingId>',
    });
  });
});
