// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS THAT CONVERGES (workplan 0168 §3.2, §3.3, T4; ADR-0055).
 *
 * The idempotency properties, extended with the address table, on the real
 * contact and calendar passes over the memory ledger and a target that keeps
 * every body it was given and answers `If-Match` as a DAV server does:
 *
 *  - a pass after a pass writes nothing;
 *  - a change to the table rewrites each affected item exactly once, and
 *    nothing else;
 *  - removing the row converges every copy back to the source's bytes;
 *  - an adopted copy, and one the person edited since, is left alone and
 *    counted;
 *  - a tombstone stays a tombstone;
 *  - past the data type's cutover a changed table waits for a person's press
 *    (D5), and goes through once pressed.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runCalendarSync, runContactSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  addressKey,
  addressTableDigest,
  applyAddressChanges,
  asMappingId,
  asTenantId,
  contactNaturalKeyHash,
  prepareAddressTable,
  type CalendarEvent,
  type CalendarSource,
  type CalendarTargetWriter,
  type ConfirmedAddressChange,
  type Contact,
  type ContactSource,
  type ContactTargetWriter,
  type UpsertOptions,
} from '@openmig/shared';

const TENANT = asTenantId('41111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('42222222-2222-4222-8222-222222222222');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const ANA = row('ana@old.example.org', 'ana@example.org');
const BEN = row('ben@old.example.org', 'ben@example.org');
const OWN = ['ana@old.example.org'];

function changes(rows: ConfirmedAddressChange[], pastCutoverApplies = false): AddressChangesForPass {
  return { table: prepareAddressTable(rows), ownKeys: OWN, ...(pastCutoverApplies ? { pastCutoverApplies } : {}) };
}

// --- Contacts ------------------------------------------------------------------

function card(uid: string, email: string): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${uid}\r\nEMAIL;TYPE=INTERNET:${email}\r\nNOTE:write to ${email}\r\nUID:${uid}\r\nEND:VCARD\r\n`;
}

const CARDS: Array<[string, string]> = [
  ['c-ana', 'ana@old.example.org'],
  ['c-ben', 'ben@old.example.org'],
  ['c-carla', 'carla@stays.example.org'],
];

function contactSource(cards = CARDS): ContactSource {
  return {
    listFolders: async () => [{ path: '/book/', name: 'Contacts' }],
    listSince: async () => ({
      items: cards.map(([uid, email]) => ({
        item: { uid, type: 'individual', name: uid, etag: `"${uid}-1"`, sourcePath: `/book/${uid}.vcf` } as unknown as Contact,
        vcard: card(uid, email),
      })),
      nextCursor: { value: '1' },
      removed: [],
    }),
  } as unknown as ContactSource;
}

/** A target that keeps what it is given, and refuses an overwrite whose If-Match is stale. */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  writes = 0;
  /** The person edits a copy in the new system: its ETag moves. */
  edit(uid: string): void {
    this.etags.set(uid, (this.etags.get(uid) ?? 0) + 100);
  }
  put(uid: string, body: string, options?: UpsertOptions) {
    const held = this.bodies.has(uid);
    if (options?.overwrite) {
      if (options.expectedTargetVersion !== undefined && options.expectedTargetVersion !== `"${this.etags.get(uid)}"`) {
        return { targetId: uid, created: false, conflicted: true };
      }
      this.writes += 1;
      this.bodies.set(uid, body);
      this.etags.set(uid, (this.etags.get(uid) ?? 0) + 1);
      return { targetId: uid, created: false, updated: true, targetVersion: `"${this.etags.get(uid)}"` };
    }
    if (held) return { targetId: uid, created: false, adopted: true };
    this.writes += 1;
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, targetVersion: '"1"' };
  }
}

function contactTarget(t: Target): ContactTargetWriter {
  return {
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_folder: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.vcard, options),
  } as unknown as ContactTargetWriter;
}

function contactPass(
  ledger: MemoryLedger,
  t: Target,
  addressChanges: AddressChangesForPass | undefined,
  { cutover = false, cards = CARDS }: { cutover?: boolean; cards?: Array<[string, string]> } = {},
) {
  return runContactSync({
    sourceIsAuthorityOnExistence: !cutover,
    stillTheAuthority: async () => !cutover,
    tenantId: TENANT,
    mappingId: MAPPING,
    source: contactSource(cards),
    target: contactTarget(t),
    ledger,
    ...(addressChanges ? { addressChanges } : {}),
  });
}

/** What the target should hold for each card under a table. */
function expected(rows: ConfirmedAddressChange[], cards = CARDS): Map<string, string> {
  return new Map(cards.map(([uid, email]) => [uid, applyAddressChanges('vcard', card(uid, email), rows).body]));
}

describe('contacts under the address table', () => {
  it('copies each card changed, records the digest, and a pass after a pass writes nothing', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    const first = await contactPass(ledger, t, changes([ANA, BEN]));
    expect(first.created).toBe(3);
    expect(first.addressChanged).toBe(2);
    expect(t.bodies).toEqual(expected([ANA, BEN]));
    // Per item (0168 S4): Ana's card records the digest of Ana's row alone.
    const ana = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ana'));
    const carla = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-carla'));
    expect(ana?.addressDigest).toBe(addressTableDigest([ANA]));
    expect(carla?.addressDigest ?? null).toBeNull();

    const writes = t.writes;
    const again = await contactPass(ledger, t, changes([ANA, BEN]));
    expect(t.writes).toBe(writes);
    expect(again.created + again.updated).toBe(0);
    expect(again.addressChanged).toBe(0);
  });

  it('rewrites each affected card exactly once when a row is added, and nothing else', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, changes([ANA]));
    const before = t.writes;
    const pass = await contactPass(ledger, t, changes([ANA, BEN]));
    // Per item (0168 S4): Ben's card gains his new address; Ana's names no
    // address of Ben's row, so its digest and its bytes stay; Carla's is
    // untouched.
    expect(pass.updated).toBe(1);
    expect(t.writes - before).toBe(1);
    expect(t.bodies).toEqual(expected([ANA, BEN]));
    const settled = t.writes;
    await contactPass(ledger, t, changes([ANA, BEN]));
    expect(t.writes).toBe(settled);
  });

  it('converges back to the source’s bytes when the last row is removed', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, changes([ANA, BEN]));
    await contactPass(ledger, t, changes([]));
    expect(t.bodies).toEqual(expected([]));
    for (const [uid, email] of CARDS) expect(t.bodies.get(uid)).toBe(card(uid, email));
    const ana = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ana'));
    expect(ana?.addressDigest ?? null).toBeNull();
    const settled = t.writes;
    await contactPass(ledger, t, changes([]));
    expect(t.writes).toBe(settled);
  });

  it('changes nothing at all for a pass without a table, or with an empty one, over copies made without one', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, undefined);
    const writes = t.writes;
    await contactPass(ledger, t, changes([]));
    await contactPass(ledger, t, undefined);
    expect(t.writes).toBe(writes);
    expect(t.bodies).toEqual(expected([]));
  });

  it('leaves a copy the person edited since alone, makes it adopted, and never says its source changed when only the table did', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, changes([ANA]));
    t.edit('c-ben');
    const pass = await contactPass(ledger, t, changes([ANA, BEN]));
    expect(pass.conflicted).toBe(1);
    expect(t.bodies.get('c-ben')).toBe(card('c-ben', 'ben@old.example.org'));
    const ben = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ben'));
    expect(ben?.status).toBe('adopted');
    // The review's N5: the source did not change, so it is not counted as a
    // change at the source on every pass after (it was, as changedButAdopted).
    const next = await contactPass(ledger, t, changes([ANA, BEN]));
    expect(next.changedButAdopted).toBe(0);
    expect(next.updated + next.created).toBe(0);
    expect(t.bodies.get('c-ben')).toBe(card('c-ben', 'ben@old.example.org'));
  });

  it('records no digest on a copy the target already held, and never rewrites it', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    t.bodies.set('c-ana', 'the person’s own card');
    t.etags.set('c-ana', 7);
    await contactPass(ledger, t, changes([ANA]));
    const ana = await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ana'));
    expect(ana?.status).toBe('adopted');
    expect(ana?.addressDigest ?? null).toBeNull();
    // Left alone, and not counted as changed at the source (N5): it did not change.
    const next = await contactPass(ledger, t, changes([ANA]));
    expect(next.changedButAdopted).toBe(0);
    expect(next.updated + next.created).toBe(0);
    expect(t.bodies.get('c-ana')).toBe('the person’s own card');
  });

  it('keeps a tombstone a tombstone', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, changes([]));
    const key = contactNaturalKeyHash('c-ben');
    const ben = (await ledger.find(TENANT, MAPPING, 'contact', key))!;
    await ledger.recordUpdate({ ...ben, status: 'tombstoned' });
    t.bodies.delete('c-ben');
    const pass = await contactPass(ledger, t, changes([BEN]));
    expect(pass.reappearedAfterRemoval).toBe(1);
    expect(t.bodies.has('c-ben')).toBe(false);
  });

  it('past the cutover, waits for a person’s press, then rewrites (D5)', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, changes([ANA]));
    const before = t.writes;
    const waiting = await contactPass(ledger, t, changes([ANA, BEN]), { cutover: true });
    // Only Ben's card waits: Ana's names no address of Ben's row (0168 S4).
    expect(waiting.addressChangesWaiting).toBe(1);
    expect(t.writes).toBe(before);
    expect(t.bodies.get('c-ben')).toBe(card('c-ben', 'ben@old.example.org'));
    const pressed = await contactPass(ledger, t, changes([ANA, BEN], true), { cutover: true });
    expect(pressed.updated).toBe(1);
    expect(t.bodies).toEqual(expected([ANA, BEN]));
    const settled = t.writes;
    const after = await contactPass(ledger, t, changes([ANA, BEN], true), { cutover: true });
    expect(t.writes).toBe(settled);
    expect(after.addressChangesWaiting).toBe(0);
  });

  it('touches no copy for a row added for somebody else, before the cutover or after it (0168 S4)', async () => {
    // Grandma's row is for her own migration: no card here names her old address.
    const GRANDMA = row('grandma@old.example.org', 'grandma@example.org');
    const ledger = new MemoryLedger();
    const t = new Target();
    await contactPass(ledger, t, changes([ANA, BEN]));
    const writes = t.writes;
    const before = await contactPass(ledger, t, changes([ANA, BEN, GRANDMA]));
    expect(before.updated + before.created).toBe(0);
    expect(t.writes).toBe(writes);
    const after = await contactPass(ledger, t, changes([ANA, BEN]), { cutover: true });
    expect(after.addressChangesWaiting).toBe(0);
    const again = await contactPass(ledger, t, changes([ANA, BEN, GRANDMA]), { cutover: true });
    expect(again.addressChangesWaiting).toBe(0);
    expect(t.writes).toBe(writes);
    expect(t.bodies).toEqual(expected([ANA, BEN]));
  });

  it('records the digest of the card it classified by, so a fetch that adds an address costs no rewrite on every pass (S8)', async () => {
    // A source whose fetch carries an old address its listing does not: what
    // `ContactSource.fetch` forbids, and the review's E3.
    const listing = contactSource();
    const source = {
      ...listing,
      listFolders: listing.listFolders,
      listSince: listing.listSince,
      fetch: async (listed: { item: Contact; vcard: string }) => ({
        item: listed.item,
        vcard: listed.vcard.replace('UID:', 'EMAIL:ben@old.example.org\r\nUID:'),
      }),
    } as unknown as ContactSource;
    const ledger = new MemoryLedger();
    const t = new Target();
    const pass = () =>
      runContactSync({
        sourceIsAuthorityOnExistence: true,
        stillTheAuthority: async () => true,
        tenantId: TENANT,
        mappingId: MAPPING,
        source,
        target: contactTarget(t),
        ledger,
        addressChanges: changes([BEN]),
      });
    const writes: number[] = [];
    for (let k = 0; k < 4; k += 1) {
      const p = await pass();
      writes.push(p.created + p.updated);
    }
    expect(writes).toEqual([3, 0, 0, 0]);
  });

  it('converges from any sequence of tables: after each change two passes leave exactly the table’s bytes, the second writing nothing', async () => {
    const rows = [ANA, BEN, row('carla@stays.example.org', 'carla@example.org')];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let run = 0; run < 25; run += 1) {
      const ledger = new MemoryLedger();
      const t = new Target();
      for (let step = 0; step < 6; step += 1) {
        const table = rows.filter(() => next() < 0.5);
        await contactPass(ledger, t, changes(table));
        const settled = t.writes;
        await contactPass(ledger, t, changes(table));
        expect(t.writes, `run ${run} step ${step}`).toBe(settled);
        expect(t.bodies, `run ${run} step ${step}`).toEqual(expected(table));
      }
    }
  });
});

// --- Calendars -----------------------------------------------------------------

function event(uid: string, organiser: string, guest: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `ORGANIZER;CN=Someone:mailto:${organiser}`,
    `ATTENDEE;CN=Guest:mailto:${guest}`,
    `SUMMARY:with ${guest}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

const EVENTS: Array<[string, string, string]> = [
  ['e-own', 'ana@old.example.org', 'ben@old.example.org'],
  ['e-outside', 'outside@other.example.org', 'ana@old.example.org'],
];

function calendarSource(): CalendarSource {
  return {
    listFolders: async () => [{ path: '/cal/', name: 'Calendar' }],
    listSince: async () => ({
      items: EVENTS.map(([uid, o, g]) => ({
        item: { uid, type: 'event', summary: uid, start: '2026-12-01T09:00:00Z', etag: `"${uid}-1"`, sourcePath: `/cal/${uid}.ics` } as unknown as CalendarEvent,
        icalendar: event(uid, o, g),
      })),
      nextCursor: { value: '1' },
      removed: [],
    }),
  } as unknown as CalendarSource;
}

function calendarTarget(t: Target): CalendarTargetWriter {
  return {
    ensureCalendar: async (folder: { path: string }) => folder.path,
    upsertCalendarEvent: async (_c: string, raw: { item: CalendarEvent; icalendar: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.icalendar, options),
  } as unknown as CalendarTargetWriter;
}

describe('events under the address table', () => {
  it('changes the family’s event, leaves the outside invitation, and a pass after a pass writes nothing', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    const pass = () =>
      runCalendarSync({
        sourceIsAuthorityOnExistence: true,
        stillTheAuthority: async () => true,
        tenantId: TENANT,
        mappingId: MAPPING,
        source: calendarSource(),
        target: calendarTarget(t),
        ledger,
        addressChanges: changes([ANA, BEN]),
      });
    const first = await pass();
    expect(first.addressChanged).toBe(1);
    expect(t.bodies.get('e-own')).toContain('ORGANIZER;CN=Someone:mailto:ana@example.org\r\n');
    expect(t.bodies.get('e-own')).toContain('ATTENDEE;CN=Guest:mailto:ben@example.org\r\n');
    expect(t.bodies.get('e-outside')).toBe(event('e-outside', 'outside@other.example.org', 'ana@old.example.org'));
    const writes = t.writes;
    await pass();
    expect(t.writes).toBe(writes);
  });
});
