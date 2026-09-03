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
import { runCalendarSync, runTaskSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asMappingId,
  asTenantId,
  naturalKeyForCalendar,
  naturalKeyForTask,
  type CalendarEvent,
  type CalendarSource,
  type CalendarTargetWriter,
} from '@openmig/shared';

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

/**
 * The task pass, and the collision its natural key exists to prevent
 * (workplan 0113, the seventh fan-out).
 *
 * `runTaskSync` did not exist until 2026-09-03: both dispatchers ended in a
 * bare `else` that ran `runFileSync`, so a selected task domain ran a file
 * pass and was marked completed. These tests run the real pass rather than
 * reading it, because the two things that make a task a task — the ledger
 * domain and the natural key — are runtime facts that no text guard can see.
 */
describe('runTaskSync files to-dos as tasks, not as calendar events', () => {
  /** One VTODO, shaped as the CalDAV source hands it over. */
  function todo(uid: string): CalendarEvent {
    return {
      uid,
      type: 'event',
      summary: 'buy milk',
      start: '2026-09-03T09:00:00Z',
      etag: '"1"',
      sourcePath: `/tasks/${uid}.ics`,
    } as unknown as CalendarEvent;
  }

  function sourceWith(item: CalendarEvent): CalendarSource {
    return {
      listFolders: async () => [{ path: '/tasks/', name: 'Tasks' }],
      listSince: async () => ({
        items: [{ item, icalendar: `BEGIN:VTODO\nUID:${item.uid}\nEND:VTODO` }],
        nextCursor: { value: '1' },
        removed: [],
      }),
    } as unknown as CalendarSource;
  }

  function targetSpy() {
    const written: string[] = [];
    const target = {
      ensureCalendar: async (folder: { path: string }) => folder.path,
      upsertCalendarEvent: async (calendarId: string, raw: { item: CalendarEvent }) => {
        written.push(`${calendarId}:${raw.item.uid}`);
        return { id: raw.item.uid, created: true };
      },
    } as unknown as CalendarTargetWriter;
    return { target, written };
  }

  it("records its items under the 'task' domain, so the §20 gate can find them", async () => {
    const ledger = new MemoryLedger();
    const { target } = targetSpy();
    const result = await runTaskSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: sourceWith(todo('abc-123')),
      target,
      ledger,
    });

    expect(result.created).toBe(1);
    // The row is findable as a TASK. Filing it under 'calendar' — which is
    // what reusing runCalendarSync would have done — leaves verifyTasks
    // finding nothing recorded, reporting SKIPPED, and a cutover passing.
    const asTask = await ledger.find(TENANT, MAPPING, 'task', naturalKeyForTask(todo('abc-123')));
    expect(asTask).toBeDefined();
    const asCalendar = await ledger.find(TENANT, MAPPING, 'calendar', naturalKeyForTask(todo('abc-123')));
    expect(asCalendar).toBeUndefined();
  });

  it('a to-do and an event sharing one UID do not collide', async () => {
    // The whole reason taskNaturalKeyHash carries a `todo:` prefix. RFC 5545
    // lets one account hold a VTODO and a VEVENT under the same UID in
    // different collections; keyed alike, the second would find the first's
    // row and be adopted rather than copied — silently missing from the
    // migration, inside a run reporting success.
    const SHARED = 'same-uid-for-both';
    const ledger = new MemoryLedger();

    await runTaskSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: sourceWith(todo(SHARED)),
      target: targetSpy().target,
      ledger,
    });
    const calendarResult = await runCalendarSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source: sourceWith(todo(SHARED)),
      target: targetSpy().target,
      ledger,
    });

    // The event was COPIED, not adopted as already-present.
    expect(calendarResult.created).toBe(1);
    // And the two rows are distinct keys under distinct domains.
    expect(naturalKeyForTask(todo(SHARED))).not.toBe(naturalKeyForCalendar(todo(SHARED)));
    expect(await ledger.find(TENANT, MAPPING, 'task', naturalKeyForTask(todo(SHARED)))).toBeDefined();
    expect(await ledger.find(TENANT, MAPPING, 'calendar', naturalKeyForCalendar(todo(SHARED)))).toBeDefined();
  });

  it('is idempotent — a second pass creates nothing', async () => {
    const ledger = new MemoryLedger();
    const first = await runTaskSync({
      tenantId: TENANT, mappingId: MAPPING,
      source: sourceWith(todo('idem-1')), target: targetSpy().target, ledger,
    });
    const second = await runTaskSync({
      tenantId: TENANT, mappingId: MAPPING,
      source: sourceWith(todo('idem-1')), target: targetSpy().target, ledger,
    });
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
  });

  it('measures the target before the first write, like the calendar pass (0105 T0)', async () => {
    const calls: string[] = [];
    const source = {
      listFolders: async () => {
        calls.push('listFolders');
        return [];
      },
    } as unknown as CalendarSource;
    await runTaskSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target: {} as CalendarTargetWriter,
      ledger: new MemoryLedger(),
      recordTargetScheduling: async () => {
        calls.push('measured');
      },
    });
    expect(calls).toEqual(['measured', 'listFolders']);
  });
});
