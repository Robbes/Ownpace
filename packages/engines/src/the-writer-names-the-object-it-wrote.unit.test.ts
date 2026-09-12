// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The DAV writers record the item's own identifier, and the RIGHT one.
 *
 * `recordIfAbsent` makes the FIRST writer win, and for a DAV domain that can be
 * this class rather than the sync loop. So a field only the loop passes is a
 * field that lands on some rows and not others — which is why `collection` and
 * `sourceRef` are already carried here, each with a comment saying so.
 *
 * `naturalKey` — the plain text the confirmed list names a row by — is the
 * third, added 2026-09-12 when it turned out the column had held `''` on every
 * row since migration 0001.
 *
 * ## The one that is not just plumbing
 *
 * A calendar object's identifier is NOT always its UID. A recurring series and
 * each of its modified occurrences share one (RFC 5545), so `naturalKeyForCalendar`
 * keys an exception as `uid|recurrence-id` — and the text has to say the same,
 * or every exception in a series shows one identifier and the list cannot tell a
 * person which occurrence is missing.
 *
 * This writer already keeps its HASH honest through `ledgerKeyFor`, whose
 * docblock records what the drift cost last time: every task got two ledger
 * rows under two hashes, and the task domain reported exactly twice its corpus.
 * The text comes off the same object for the same reason.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger, type LedgerRecord } from '@openmig/shared';
import { CalDAVTargetWriter, type HttpClient } from './caldav-target-writer.ts';
import { CardDAVTargetWriter } from './carddav-target-writer.ts';

const TENANT = asTenantId('6b120000-e29b-41d4-a716-4466554462b1' as never);
const MAPPING = asMappingId('6b120000-e29b-41d4-a716-4466554462b2' as never);
const BASE = 'https://cloud.example.com/remote.php/dav';

const UID = 'EVT-ABC-123@dev.local';
const RECURRENCE = '20260912T090000Z';
const CARD_UID = 'b3f1c0de-1111-4222-8333-444455556666';

const VEVENT =
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${UID}\r\nSUMMARY:standup\r\nEND:VEVENT\r\nEND:VCALENDAR`;
const VCARD = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${CARD_UID}\r\nFN:Wieke\r\nEND:VCARD`;

/** An empty collection that accepts the PUT, and the ledger rows it produces. */
function harness() {
  const recorded: LedgerRecord[] = [];
  const ledger = {
    find: async () => undefined,
    recordIfAbsent: async (row: LedgerRecord) => {
      recorded.push(row);
      return row;
    },
  } as unknown as Ledger;

  const httpClient = {
    async request(o: { method: string }) {
      if (o.method === 'PUT') return { status: 201, body: '', headers: {} };
      return { status: 207, body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>', headers: {} };
    },
  } as unknown as HttpClient;

  return { recorded, ledger, httpClient };
}

describe('the CalDAV writer names the object it wrote', () => {
  it('an ordinary event: its UID', async () => {
    const { recorded, ledger, httpClient } = harness();
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger, tenantId: TENANT, mappingId: MAPPING, httpClient },
    );

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/personal/`, {
      item: { uid: UID, type: 'event', icalendar: VEVENT },
      icalendar: VEVENT,
    } as never);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.naturalKey).toBe(UID);
  });

  it('a MODIFIED OCCURRENCE: its UID and its RECURRENCE-ID, as the key has', async () => {
    const { recorded, ledger, httpClient } = harness();
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { domain: 'calendar', ledger, tenantId: TENANT, mappingId: MAPPING, httpClient },
    );

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/personal/`, {
      item: { uid: UID, recurrenceId: RECURRENCE, type: 'event', icalendar: VEVENT },
      icalendar: VEVENT,
    } as never);

    expect(
      recorded[0]!.naturalKey,
      'the writer named a modified occurrence by its bare UID. Every exception in a series ' +
        'then shows the SAME identifier on the confirmed list, which is the one document ' +
        'somebody empties their old account on the strength of',
    ).toBe(`${UID}|${RECURRENCE}`);
  });

  it('a task: the UID, with no `todo:` — that prefix belongs to the hash', async () => {
    const { recorded, ledger, httpClient } = harness();
    const writer = new CalDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { domain: 'task', ledger, tenantId: TENANT, mappingId: MAPPING, httpClient },
    );

    await writer.upsertCalendarEvent(`${BASE}/calendars/alice/e2e-tasks/`, {
      item: { uid: UID, type: 'todo', icalendar: VEVENT },
      icalendar: VEVENT,
    } as never);

    expect(recorded[0]!.itemType).toBe('task');
    expect(recorded[0]!.naturalKey).toBe(UID);
  });
});

describe('the CardDAV writer names the card it wrote', () => {
  it('by the vCard UID — the domain the live failure was in', async () => {
    const { recorded, ledger, httpClient } = harness();
    const writer = new CardDAVTargetWriter(
      { url: BASE, username: 'alice', password: 'pw' },
      { ledger, tenantId: TENANT, mappingId: MAPPING, httpClient },
    );

    await writer.upsertContact(`${BASE}/addressbooks/users/alice/contacts/`, {
      item: { uid: CARD_UID },
      vcard: VCARD,
    } as never);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.naturalKey).toBe(CARD_UID);
  });
});
