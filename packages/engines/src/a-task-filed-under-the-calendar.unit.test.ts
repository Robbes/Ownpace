// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TASK FILED UNDER THE CALENDAR, TWICE.
 *
 * On the wire a task IS a calendar object (RFC 4791), so ONE class writes
 * both: `buildCalendarTarget` and `buildTaskTarget` return the same
 * `CalDAVTargetWriter`. In the LEDGER they are separate domains — separate
 * status rows, separate counts, separate bytes — and this writer used to
 * record `itemType: 'calendar'` for every object it touched, whichever pass
 * had built it.
 *
 * Nothing noticed for as long as the task domain never actually ran. On
 * 2026-09-04 it ran for the first time on the self-hosted stack, and the gate
 * reported:
 *
 *     calendar: itemsSynced 17, bytesTransferred 4913
 *     task:     itemsSynced  8, bytesTransferred 1952
 *
 * against a source holding **nine** events. The extra 8 were the 8 tasks,
 * filed here under `calendar` while the sync loop filed them again under
 * `task`. Three consequences, none of which throws:
 *
 *  - two ledger rows per task, so the ledger's own idea of the corpus is wrong;
 *  - the calendar domain's count and bytes carry the whole task corpus on top
 *    of their own — visible on the status screen, the completion report and
 *    the first-copy byte meter that derives a customer's tier;
 *  - the `find` fast path looked for a `todo:`-prefixed key in the `calendar`
 *    domain, where it can never be, so it missed every task on every pass and
 *    paid a target probe for each one.
 *
 * ## What is pinned
 *
 * The writer records under the domain it was BUILT for, not the one its class
 * is named after. Asserted on the ledger call, because that is where the
 * damage was: the bytes on the target were always right.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger, type LedgerRecord } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';

const TENANT = asTenantId('6b420000-e29b-41d4-a716-4466554461b1' as never);
const MAPPING = asMappingId('6b420000-e29b-41d4-a716-4466554461b2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

const VTODO =
  'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:todo-1@dev.local\r\nSUMMARY:buy milk\r\nEND:VTODO\r\nEND:VCALENDAR';
const VEVENT =
  'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-1@dev.local\r\nSUMMARY:standup\r\nEND:VEVENT\r\nEND:VCALENDAR';

/** An empty target that accepts the PUT, plus the ledger calls it makes. */
function writerFor(domain: 'calendar' | 'task') {
  const recorded: LedgerRecord[] = [];
  const lookedUpIn: string[] = [];

  const ledger = {
    find: async (_t: unknown, _m: unknown, itemType: string) => {
      lookedUpIn.push(itemType);
      return undefined;
    },
    recordIfAbsent: async (row: LedgerRecord) => {
      recorded.push(row);
      return row;
    },
  } as unknown as Ledger;

  const client = {
    async request(o: { method: string }) {
      // An empty collection: the enumeration answers nothing, the PUT lands.
      if (o.method === 'PUT') return { status: 201, body: '', headers: {} };
      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;

  const writer = new CalDAVTargetWriter(
    { url: BASE, username: 'alice', password: 'pw' },
    { domain, ledger, tenantId: TENANT, mappingId: MAPPING, httpClient: client },
  );
  return { writer, recorded, lookedUpIn };
}

describe('the writer files under the domain it was built for', () => {
  it('records a task as a TASK, not as a calendar event', async () => {
    const { writer, recorded } = writerFor('task');

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/e2e-tasks/`, {
      item: { uid: 'todo-1@dev.local', type: 'todo', icalendar: VTODO },
      icalendar: VTODO,
    } as never);

    expect(recorded).toHaveLength(1);
    expect(
      recorded[0]!.itemType,
      'a task written through the task target was recorded under `calendar`. The sync loop ' +
        'records the same item under `task`, so the ledger now holds TWO rows for it and the ' +
        "calendar domain's itemsSynced and bytesTransferred carry the whole task corpus on " +
        'top of their own',
    ).toBe('task');
  });

  it('still records a calendar event as a calendar event', async () => {
    // The control: a writer that answered 'task' for everything would pass the
    // assertion above and break the domain it was built to serve.
    const { writer, recorded } = writerFor('calendar');

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/personal/`, {
      item: { uid: 'event-1@dev.local', type: 'event', icalendar: VEVENT },
      icalendar: VEVENT,
    } as never);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.itemType).toBe('calendar');
  });

  it('looks the already-migrated fast path up in its own domain', async () => {
    // Not cosmetic. A task's natural key carries the `todo:` prefix
    // (`naturalKeyForTask`), so a lookup in `calendar` cannot match one — the
    // fast path missed every task on every pass and paid a target probe for
    // each. Asked BEFORE the write, which is why it is asserted separately
    // from the record above.
    const { writer, lookedUpIn } = writerFor('task');

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/e2e-tasks/`, {
      item: { uid: 'todo-1@dev.local', type: 'todo', icalendar: VTODO },
      icalendar: VTODO,
    } as never);

    expect(lookedUpIn).toContain('task');
    expect(
      lookedUpIn,
      'the fast path asked the calendar domain about a `todo:` key, which can never be there',
    ).not.toContain('calendar');
  });
});

describe('the two factories build two different filings', () => {
  // Read as TEXT: the factories live in @openmig/orchestration, which this
  // package must not import (it is downstream of nothing). What matters is
  // that the two call sites say DIFFERENT things — a copy-paste that left
  // `domain: 'calendar'` in both would restore the defect exactly, and every
  // test above would still pass.
  it('the task factory does not build a calendar filing', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const factories = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../orchestration/src/dav-factories.ts',
      ),
      'utf8',
    );

    const taskFactory = factories.slice(factories.indexOf('export function buildTaskTarget'));
    expect(
      taskFactory,
      'buildTaskTarget no longer names its own domain — a CalDAV writer that files tasks ' +
        'as calendar events is the 2026-09-04 double-count',
    ).toContain("domain: 'task'");

    const calendarFactory = factories.slice(
      factories.indexOf('export function buildCalendarTarget'),
      factories.indexOf('export function buildTaskTarget'),
    );
    expect(calendarFactory).toContain("domain: 'calendar'");
  });
});
