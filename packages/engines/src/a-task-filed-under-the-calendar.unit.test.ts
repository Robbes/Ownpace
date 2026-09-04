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
 * ## And the same defect one field over
 *
 * Telling the writer its domain fixed the filing and moved the double count
 * rather than removing it: the next run reported `task: itemsSynced 16` for
 * eight tasks. Both rows were now under `task`, under two different HASHES —
 * the loop's `naturalKeyForTask` (`todo:`) and this writer's hard-coded
 * `calendarNaturalKeyHash` (`cal:`). `recordIfAbsent` collapses a duplicate
 * only when the key matches, and it did not.
 *
 * So the domain and the key are pinned together below. They are one decision:
 * whichever of the two the writer gets wrong, the result is two ledger rows
 * for one object and a domain reporting twice what it moved.
 *
 * ## And the READ side, which had it backwards
 *
 * With the ledger finally right, verification then declared all eight tasks
 * lost: `tasks: targetCount 0, missingOnTarget 8`, on a target that provably
 * held `restart-resume-seed-tasks/dav-seed-task-1..8@dev.local.ics` in a
 * collection whose `supported-calendar-component-set` says VTODO.
 *
 * `listEventsIn`'s `calendar-query` named VEVENT, VTODO and VJOURNAL as
 * SIBLING comp-filters, on the reading that this asks for any of them. RFC
 * 4791 §9.7.1 makes a comp-filter's children a conjunction, so it asks for a
 * VCALENDAR containing all three — which is no object anybody has. Sabre's PDO
 * backend is more forgiving and indexes on the FIRST child, which was VEVENT:
 * so the query worked for four domains and one whole workplan, and could never
 * have worked for the fifth.
 *
 * The reindexer now asks for the one component its domain owns. That is also
 * the right answer for the other half of verification — a calendar reindexer
 * that listed VTODOs would report every task as "extra on target" — and no
 * domain owns VJOURNAL at all.
 *
 * ## What is pinned
 *
 * The writer records under the domain it was BUILT for, not the one its class
 * is named after. Asserted on the ledger call, because that is where the
 * damage was: the bytes on the target were always right.
 */

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  calendarNaturalKeyHash,
  taskNaturalKeyHash,
  type Ledger,
  type LedgerRecord,
} from '@openmig/shared';
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
  const lookedUpHashes: string[] = [];

  const ledger = {
    find: async (_t: unknown, _m: unknown, itemType: string, hash: string) => {
      lookedUpIn.push(itemType);
      lookedUpHashes.push(hash);
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
  return { writer, recorded, lookedUpIn, lookedUpHashes };
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

describe('the writer keys under its own domain, not the calendar one', () => {
  const UID = 'todo-1@dev.local';

  it('hashes a task with the todo: prefix the sync loop uses', async () => {
    const { writer, recorded } = writerFor('task');

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/e2e-tasks/`, {
      item: { uid: UID, type: 'todo', icalendar: VTODO },
      icalendar: VTODO,
    } as never);

    expect(
      recorded[0]!.naturalKeyHash,
      'the writer hashed a task under `cal:`. The sync loop hashes it under `todo:`, and ' +
        '`recordIfAbsent` only collapses a duplicate when the key matches — so the task gets ' +
        'TWO rows and its domain reports twice the corpus it moved',
    ).toBe(taskNaturalKeyHash(UID));
    expect(recorded[0]!.naturalKeyHash).not.toBe(calendarNaturalKeyHash(UID));
  });

  it('still hashes a calendar event with the cal: prefix', async () => {
    // The control, and the compatibility guarantee: every calendar row ever
    // written carries this hash, so a writer that started keying events any
    // other way would orphan the whole ledger and re-copy every event.
    const { writer, recorded } = writerFor('calendar');

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/personal/`, {
      item: { uid: 'event-1@dev.local', type: 'event', icalendar: VEVENT },
      icalendar: VEVENT,
    } as never);

    expect(recorded[0]!.naturalKeyHash).toBe(calendarNaturalKeyHash('event-1@dev.local'));
  });

  it('asks the fast path for the key it is about to write', async () => {
    // The two must agree, or the writer looks up one key and records another —
    // which is a probe that can never hit and a row that never adopts.
    const { writer, recorded, lookedUpHashes } = writerFor('task');

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/e2e-tasks/`, {
      item: { uid: UID, type: 'todo', icalendar: VTODO },
      icalendar: VTODO,
    } as never);

    expect(lookedUpHashes).toContain(recorded[0]!.naturalKeyHash);
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

describe('the reindexer asks the target for the component its domain owns', () => {
  /** A stub that records the REPORT bodies and answers an empty multistatus. */
  function reportsFrom(domain: 'calendar' | 'task') {
    const bodies: string[] = [];
    const client = {
      async request(o: { method: string; body?: unknown }) {
        if (o.method === 'REPORT') bodies.push(String(o.body ?? ''));
        if (o.method === 'PROPFIND') {
          // One calendar collection, so listEntries has somewhere to look.
          return {
            status: 207,
            body:
              '<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">' +
              '<d:response><d:href>/remote.php/dav/calendars/alice/only/</d:href>' +
              '<d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>' +
              '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
            headers: {},
          };
        }
        return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
      },
    } as unknown as HttpClient;

    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      {
        domain,
        ledger: { find: async () => undefined, recordIfAbsent: async () => undefined } as unknown as Ledger,
        tenantId: TENANT,
        mappingId: MAPPING,
        httpClient: client,
      },
    );
    return { writer, bodies };
  }

  const drain = async (writer: CalDAVTargetWriter) => {
    for await (const _ of writer.listEntries()) void _;
  };

  it('a task reindexer asks for VTODO, and for nothing else', async () => {
    const { writer, bodies } = reportsFrom('task');
    await drain(writer);

    expect(bodies.length).toBeGreaterThan(0);
    const body = bodies.join('');
    expect(
      body,
      'the task reindexer did not ask the target for VTODO, so every migrated task reads as ' +
        'missing on target and the verification gate refuses a cutover that copied everything',
    ).toContain('<C:comp-filter name="VTODO"/>');
    expect(
      body,
      'the filter names more than one component. RFC 4791 §9.7.1 makes a comp-filter\'s ' +
        'children a CONJUNCTION, and Sabre indexes on the first — either way the second ' +
        'component is never returned',
    ).not.toContain('<C:comp-filter name="VEVENT"/>');
  });

  it('a calendar reindexer asks for VEVENT, and for nothing else', async () => {
    // The control, and the reason this is scoped rather than unioned: a
    // calendar reindexer that also listed VTODOs would report every task the
    // task domain migrated as an extra item on the target.
    const { writer, bodies } = reportsFrom('calendar');
    await drain(writer);

    const body = bodies.join('');
    expect(body).toContain('<C:comp-filter name="VEVENT"/>');
    expect(body).not.toContain('<C:comp-filter name="VTODO"/>');
    expect(body).not.toContain('<C:comp-filter name="VJOURNAL"/>');
  });

  it('asks for exactly one component per query', async () => {
    // The shape of the defect, stated directly: more than one comp-filter under
    // VCALENDAR is the bug, whichever components they name.
    for (const domain of ['calendar', 'task'] as const) {
      const { writer, bodies } = reportsFrom(domain);
      await drain(writer);
      for (const body of bodies) {
        expect(
          (body.match(/<C:comp-filter name="V[A-Z]+"\/>/g) ?? []).length,
          `the ${domain} reindexer sent ${body.split('comp-filter name="V').length - 1} component ` +
            'filters in one query; siblings are ANDed, so at most one of them can ever match',
        ).toBe(1);
      }
    }
  });
});
