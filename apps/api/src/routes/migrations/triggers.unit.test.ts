// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Unit tests for the sync/cutover job-resolution helpers (the pure core of the
 * real Trigger.dev wiring that replaced the placeholder mock endpoints).
 */

import { describe, it, expect } from 'vitest';
import { resolveSyncJob, resolveCutoverJob } from './job-resolution.ts';

const TENANT = '00000000-0000-4000-8000-000000000001';
const MAPPING = '11111111-1111-4111-8111-111111111111';

describe('resolveSyncJob', () => {
  it('defaults to the incremental delta task with an id-only payload', () => {
    expect(resolveSyncJob(TENANT, MAPPING, {})).toEqual({
      taskId: 'run-delta-sync',
      payload: { tenantId: TENANT, mappingId: MAPPING },
    });
  });

  it("asks the one task for a full scan when type is 'full'", () => {
    // There is no second task any more. `run-full-sync` existed because a full
    // pass passes no cursor store — and because it called runShadowPass rather
    // than looping the mapping's domains, it synced MAIL AND NOTHING ELSE, on
    // a mapping that might carry four other domains.
    expect(resolveSyncJob(TENANT, MAPPING, { type: 'full' })).toEqual({
      taskId: 'run-delta-sync',
      payload: { tenantId: TENANT, mappingId: MAPPING, forceFullScan: true },
    });
  });

  it('asks for a full scan when forceFullScan is set even without type', () => {
    expect(resolveSyncJob(TENANT, MAPPING, { forceFullScan: true })).toEqual({
      taskId: 'run-delta-sync',
      payload: { tenantId: TENANT, mappingId: MAPPING, forceFullScan: true },
    });
  });

  it('carries a LIST through, so one domain can be redone alone', () => {
    // "The tasks came out wrong, do those again" — without re-reading a
    // mailbox that was already right, against a source with a daily byte
    // ceiling (workplan 0090) that the re-read would spend for nothing.
    expect(resolveSyncJob(TENANT, MAPPING, { forceFullScan: ['task'] })).toEqual({
      taskId: 'run-delta-sync',
      payload: { tenantId: TENANT, mappingId: MAPPING, forceFullScan: ['task'] },
    });
  });

  it("omits the option entirely for an explicit type 'delta'", () => {
    // Absent means absent: an explicit `false` would read as a choice somebody
    // made, and the job's schema marks the field optional rather than nullable.
    expect(resolveSyncJob(TENANT, MAPPING, { type: 'delta', forceFullScan: false })).toEqual({
      taskId: 'run-delta-sync',
      payload: { tenantId: TENANT, mappingId: MAPPING },
    });
  });
});

describe('resolveCutoverJob', () => {
  it('maps to the cutover task with defaulted options', () => {
    expect(resolveCutoverJob(TENANT, MAPPING, {})).toEqual({
      taskId: 'run-cutover',
      payload: {
        tenantId: TENANT,
        mappingId: MAPPING,
        options: { skipFinalSync: false, skipVerification: false },
      },
    });
  });

  it('passes through the provided options', () => {
    const { payload } = resolveCutoverJob(TENANT, MAPPING, {
      skipFinalSync: true,
      skipVerification: true,
    });
    expect(payload.options).toEqual({ skipFinalSync: true, skipVerification: true });
  });

  it('carries no grace-period setting — the task never starts one', () => {
    // The task prepares and verifies, then stops at READY_FOR_CUTOVER. It used
    // to accept gracePeriodHours and schedule a `run-grace-period-end` task that
    // does not exist in this repo.
    const { payload } = resolveCutoverJob(TENANT, MAPPING, {});
    expect(payload.options).not.toHaveProperty('gracePeriodHours');
  });
});
