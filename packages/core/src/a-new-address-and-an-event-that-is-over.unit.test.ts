// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS AND AN EVENT THAT IS OVER (the owner, 2026-11-23; ADR-0055;
 * workplan 0168).
 *
 * *"Though perhapse we need not change past-events we migrate."* On the real
 * calendar pass, over the memory ledger and a target that keeps every body it
 * is given and answers `If-Match` as a DAV server does: an event that was over
 * at the migration's start (`AddressChangesForPass.migrationStart`) arrives as
 * the source has it, records no digest, and waits for nothing, before the
 * cutover or after it, whatever the table does; the event still to come
 * changes as before. And a copy written before 2026-11-23, when a past event
 * changed too, converges back to the source's bytes by the ordinary rewrite,
 * or waits for a person's press past the cutover, as any changed table does.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runCalendarSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  addressKey,
  addressTableDigest,
  asMappingId,
  asTenantId,
  naturalKeyForCalendar,
  prepareAddressTable,
  waitsForAnAddressChange,
  ADDRESS_DIGEST_OF_NO_CHANGE,
  type CalendarEvent,
  type CalendarSource,
  type CalendarTargetWriter,
  type ConfirmedAddressChange,
  type UpsertOptions,
} from '@openmig/shared';

const TENANT = asTenantId('43333333-3333-4333-8333-333333333333');
const MAPPING = asMappingId('44444444-4444-4444-8444-444444444444');
const START = new Date('2026-11-23T10:00:00Z');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const ANA = row('ana@old.example.org', 'ana@example.org');
const BEN = row('ben@old.example.org', 'ben@example.org');

/** The pass's table, under the migration's start; `start: null` for a pass that knew none, as before 2026-11-23. */
function changes(rows: ConfirmedAddressChange[], { start = START as Date | null, pastCutoverApplies = false } = {}): AddressChangesForPass {
  return {
    table: prepareAddressTable(rows),
    ownKeys: [],
    ...(pastCutoverApplies ? { pastCutoverApplies } : {}),
    ...(start !== null ? { migrationStart: start } : {}),
  };
}

/** Ana's event, with Ben as her guest, on the day given. */
function event(uid: string, day: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${day}T090000Z`,
    `DTEND:${day}T100000Z`,
    'ORGANIZER;CN=Ana:mailto:ana@old.example.org',
    'ATTENDEE;CN=Ben;DELEGATED-FROM="mailto:ana@old.example.org":mailto:ben@old.example.org',
    'SUMMARY:the family meets',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Last year's meeting, over at the start, and next month's, still to come. */
const EVENTS: Array<[string, string]> = [
  ['e-past', '20251124'],
  ['e-ahead', '20261221'],
];

function item(uid: string): CalendarEvent {
  return { uid, type: 'event', summary: uid, start: '2026-01-01T00:00:00Z', etag: `"${uid}-1"`, sourcePath: `/cal/${uid}.ics` } as unknown as CalendarEvent;
}

function calendarSource(): CalendarSource {
  return {
    listFolders: async () => [{ path: '/cal/', name: 'Calendar' }],
    listSince: async () => ({
      items: EVENTS.map(([uid, day]) => ({ item: item(uid), icalendar: event(uid, day) })),
      nextCursor: { value: '1' },
      removed: [],
    }),
  } as unknown as CalendarSource;
}

/** A target that keeps what it is given, and refuses an overwrite whose If-Match is stale. */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  writes = 0;
  put(uid: string, body: string, options?: UpsertOptions) {
    if (options?.overwrite) {
      if (options.expectedTargetVersion !== undefined && options.expectedTargetVersion !== `"${this.etags.get(uid)}"`) {
        return { targetId: uid, created: false, conflicted: true };
      }
      this.writes += 1;
      this.bodies.set(uid, body);
      this.etags.set(uid, (this.etags.get(uid) ?? 0) + 1);
      return { targetId: uid, created: false, updated: true, targetVersion: `"${this.etags.get(uid)}"` };
    }
    if (this.bodies.has(uid)) return { targetId: uid, created: false, adopted: true };
    this.writes += 1;
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, targetVersion: '"1"' };
  }
}

function pass(ledger: MemoryLedger, t: Target, addressChanges: AddressChangesForPass, { cutover = false } = {}) {
  return runCalendarSync({
    sourceIsAuthorityOnExistence: !cutover,
    stillTheAuthority: async () => !cutover,
    tenantId: TENANT,
    mappingId: MAPPING,
    source: calendarSource(),
    target: {
      ensureCalendar: async (folder: { path: string }) => folder.path,
      upsertCalendarEvent: async (_c: string, raw: { item: CalendarEvent; icalendar: string }, options?: UpsertOptions) =>
        t.put(raw.item.uid, raw.icalendar, options),
    } as unknown as CalendarTargetWriter,
    ledger,
    addressChanges,
  });
}

const rowOf = (ledger: MemoryLedger, uid: string) => ledger.find(TENANT, MAPPING, 'calendar', naturalKeyForCalendar(item(uid)));

describe('an event that was over at the migration’s start', () => {
  it('arrives as the source has it, records no digest and waits for nothing; the event to come changes', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    const first = await pass(ledger, t, changes([ANA, BEN]));
    expect(first.created).toBe(2);
    expect(first.addressChanged).toBe(1);
    expect(t.bodies.get('e-past')).toBe(event('e-past', '20251124'));
    expect(t.bodies.get('e-ahead')).toContain('\r\nORGANIZER;CN=Ana:mailto:ana@example.org\r\n');
    expect(t.bodies.get('e-ahead')).toContain('DELEGATED-FROM="mailto:ana@example.org":mailto:ben@example.org\r\n');

    const past = await rowOf(ledger, 'e-past');
    expect(past?.addressDigest ?? null).toBeNull();
    expect(past?.addressDigestDue ?? null).toBeNull();
    // What the confirmed list, verification and the report ask of a copy.
    expect(waitsForAnAddressChange(past?.addressDigest, past?.addressDigestDue)).toBe(false);
    expect((await rowOf(ledger, 'e-ahead'))?.addressDigest).toBe(addressTableDigest([ANA, BEN]));
    expect(await ledger.countAddressChanges(TENANT, MAPPING, 'calendar')).toEqual({ changed: 1, waiting: 0, unguarded: 0 });

    const writes = t.writes;
    const again = await pass(ledger, t, changes([ANA, BEN]));
    expect(t.writes).toBe(writes);
    expect(again.addressChanged).toBe(0);
  });

  it('is never reached by a row that comes or goes, before the cutover or after it', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await pass(ledger, t, changes([ANA]));
    // Ben's row comes: only the event to come is rewritten.
    const added = await pass(ledger, t, changes([ANA, BEN]));
    expect(added.updated).toBe(1);
    expect(t.bodies.get('e-past')).toBe(event('e-past', '20251124'));
    // Past the cutover, a table that changes again waits for a press, for the event to come alone.
    const waiting = await pass(ledger, t, changes([BEN]), { cutover: true });
    expect(waiting.addressChangesWaiting).toBe(1);
    const past = await rowOf(ledger, 'e-past');
    expect(past?.addressDigestDue ?? null).toBeNull();
    expect(waitsForAnAddressChange(past?.addressDigest, past?.addressDigestDue)).toBe(false);
    expect((await ledger.countAddressChanges(TENANT, MAPPING, 'calendar')).waiting).toBe(1);
    // Pressed: the event to come follows the table; the past event is still the source's.
    const pressed = await pass(ledger, t, changes([BEN], { pastCutoverApplies: true }), { cutover: true });
    expect(pressed.updated).toBe(1);
    expect(t.bodies.get('e-past')).toBe(event('e-past', '20251124'));
  });
});

describe('a copy of a past event written before 2026-11-23, when it changed too', () => {
  it('converges back to the source’s bytes on the next pass, once', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    // As alpha.17 wrote it: the table applied, no start known.
    await pass(ledger, t, changes([ANA, BEN], { start: null }));
    expect(t.bodies.get('e-past')).toContain('\r\nORGANIZER;CN=Ana:mailto:ana@example.org\r\n');
    expect((await rowOf(ledger, 'e-past'))?.addressDigest).toBe(addressTableDigest([ANA, BEN]));

    const next = await pass(ledger, t, changes([ANA, BEN]));
    expect(next.updated).toBe(1);
    expect(t.bodies.get('e-past')).toBe(event('e-past', '20251124'));
    expect((await rowOf(ledger, 'e-past'))?.addressDigest ?? null).toBeNull();
    const writes = t.writes;
    await pass(ledger, t, changes([ANA, BEN]));
    expect(t.writes).toBe(writes);
  });

  it('past the cutover, waits for a person’s press as any changed table does, then goes back', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await pass(ledger, t, changes([ANA, BEN], { start: null }));
    const waiting = await pass(ledger, t, changes([ANA, BEN]), { cutover: true });
    expect(waiting.addressChangesWaiting).toBe(1);
    expect((await rowOf(ledger, 'e-past'))?.addressDigestDue).toBe(ADDRESS_DIGEST_OF_NO_CHANGE);
    const pressed = await pass(ledger, t, changes([ANA, BEN], { pastCutoverApplies: true }), { cutover: true });
    expect(pressed.updated).toBe(1);
    expect(t.bodies.get('e-past')).toBe(event('e-past', '20251124'));
    const past = await rowOf(ledger, 'e-past');
    expect(waitsForAnAddressChange(past?.addressDigest, past?.addressDigestDue)).toBe(false);
  });
});
