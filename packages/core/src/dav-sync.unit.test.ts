// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one ordering promise `runCalendarSync` makes on top of the generic loop
 * (0105 T0): `recordTargetScheduling` runs BEFORE any sync work — before the
 * source is even listed, and therefore before any write could happen. The
 * point of the record is that the measurement provably preceded the first
 * calendar object; a record written after the fact would be a receipt for a
 * risk already taken.
 */

import { describe, it, expect } from 'vitest';
import { runCalendarSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import { asMappingId, asTenantId, type CalendarSource, type CalendarTargetWriter } from '@openmig/shared';

const TENANT = asTenantId('31111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('32222222-2222-4222-8222-222222222222');

describe('runCalendarSync and the scheduling record (0105 T0)', () => {
  it('awaits recordTargetScheduling before listing the source — so before any possible write', async () => {
    const calls: string[] = [];
    const source = {
      listFolders: async () => {
        calls.push('listFolders');
        return [];
      },
    } as unknown as CalendarSource;

    await runCalendarSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      // Never reached with zero folders; the type is satisfied, the object
      // deliberately empty so any call would throw and fail the test.
      target: {} as CalendarTargetWriter,
      ledger: new MemoryLedger(),
      recordTargetScheduling: async () => {
        calls.push('measured');
      },
    });

    expect(calls).toEqual(['measured', 'listFolders']);
  });

  it('runs exactly as before when no recorder is wired (every existing caller)', async () => {
    const source = {
      listFolders: async () => [],
    } as unknown as CalendarSource;
    const result = await runCalendarSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target: {} as CalendarTargetWriter,
      ledger: new MemoryLedger(),
    });
    expect(result.created).toBe(0);
    expect(result.scanned).toBe(0);
  });
});
