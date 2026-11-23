// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS ON A SOURCE THAT LISTS ONLY WHAT CHANGED (workplan 0168 §3.3,
 * D5; ADR-0055 decision 6; the managed E2E, run 45088703249).
 *
 * The sources a family's contacts and calendars come from list incrementally:
 * a sync-collection token at a CardDAV or CalDAV server (Google's included),
 * a delta link at Graph. Past a collection's cursor they list only what the
 * SOURCE changed, so an item nobody touched there is never classified. Run
 * against a real Nextcloud, a row deleted after the copy therefore converged
 * nothing back: "rows still under a digest: 2". The fakes of
 * `a-new-address-that-converges` list everything on every pass and could not
 * see it.
 *
 * Here the source lists only what changed after its cursor, and refuses a
 * cursor that is not its own, so a tag leaking through to it would fail too:
 *
 *  - a row confirmed after the first pass reaches every copy already made;
 *  - the row deleted, every copy converges back to the source's bytes;
 *  - the pass after each reads incrementally again, and writes nothing;
 *  - past the cutover the change waits, and the pass after the press reads
 *    every item and rewrites the ones it reaches;
 *  - a migration whose organisation confirmed no row keeps its cursors exactly
 *    as before;
 *  - per collection: a collection that could not be read keeps its old cursor
 *    and is read from the beginning on the next pass, the others are not.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runCalendarSync, runContactSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import {
  addressKey,
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
  type SyncCursor,
  type UpsertOptions,
} from '@openmig/shared';

const TENANT = asTenantId('51111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('52222222-2222-4222-8222-222222222222');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const BEN = row('ben@old.example.org', 'ben@example.org');
const OWN = ['ana@old.example.org'];

function changes(rows: ConfirmedAddressChange[], pastCutoverApplies = false): AddressChangesForPass {
  return { table: prepareAddressTable(rows), ownKeys: OWN, ...(pastCutoverApplies ? { pastCutoverApplies } : {}) };
}

/**
 * A source that numbers every change it holds and, past a cursor, lists only
 * the changes after it. A cursor it did not hand out is refused, as a server
 * refuses a sync token it never issued.
 */
class Incremental<T> {
  private seq = 0;
  private readonly held = new Map<string, Map<string, { value: T; at: number }>>();
  /** What each listing was asked from, and which uids it answered. */
  readonly listings: Array<{ readonly folder: string; readonly cursor: string | undefined; readonly uids: string[] }> = [];
  /** Folders whose next listing throws, once. */
  readonly failNext = new Set<string>();

  put(folder: string, uid: string, value: T): void {
    this.seq += 1;
    const items = this.held.get(folder) ?? new Map<string, { value: T; at: number }>();
    items.set(uid, { value, at: this.seq });
    this.held.set(folder, items);
  }

  folders(): string[] {
    return [...this.held.keys()];
  }

  list(folder: string, cursor: SyncCursor | undefined): { uids: Array<[string, T]>; next: SyncCursor } {
    if (this.failNext.delete(folder)) throw new Error(`the source could not list ${folder} this time`);
    let since = 0;
    if (cursor !== undefined) {
      const m = /^seq-(\d+)$/.exec(cursor.value);
      if (!m) throw new Error(`a cursor this source never issued: ${cursor.value}`);
      since = Number(m[1]);
    }
    const listed = [...(this.held.get(folder) ?? new Map<string, { value: T; at: number }>())]
      .filter(([, v]) => v.at > since)
      .map(([uid, v]) => [uid, v.value] as [string, T]);
    this.listings.push({ folder, cursor: cursor?.value, uids: listed.map(([uid]) => uid) });
    return { uids: listed, next: { value: `seq-${this.seq}` } };
  }
}

/** A target that keeps what it is given, and refuses an overwrite whose If-Match is stale. */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  writes = 0;
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

// --- Contacts ------------------------------------------------------------------

function card(uid: string, email: string): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${uid}\r\nEMAIL;TYPE=INTERNET:${email}\r\nUID:${uid}\r\nEND:VCARD\r\n`;
}

function book(): Incremental<string> {
  const b = new Incremental<string>();
  b.put('/family/', 'c-ben', 'ben@old.example.org');
  b.put('/family/', 'c-carla', 'carla@stays.example.org');
  b.put('/work/', 'c-ben-work', 'ben@old.example.org');
  return b;
}

function contactSource(b: Incremental<string>): ContactSource {
  return {
    listFolders: async () => b.folders().map((path) => ({ path, name: path })),
    listSince: async (folder: { path: string }, cursor?: SyncCursor) => {
      const { uids, next } = b.list(folder.path, cursor);
      return {
        items: uids.map(([uid, email]) => ({
          item: { uid, type: 'individual', name: uid, etag: `"${uid}"`, sourcePath: `${folder.path}${uid}.vcf` } as unknown as Contact,
          vcard: card(uid, email),
        })),
        nextCursor: next,
        removed: [],
      };
    },
  } as unknown as ContactSource;
}

function contactTarget(t: Target): ContactTargetWriter {
  return {
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_folder: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.vcard, options),
  } as unknown as ContactTargetWriter;
}

function contactPass(
  b: Incremental<string>,
  ledger: MemoryLedger,
  cursors: MemoryCursorStore,
  t: Target,
  addressChanges: AddressChangesForPass,
  cutover = false,
) {
  return runContactSync({
    sourceIsAuthorityOnExistence: !cutover,
    stillTheAuthority: async () => !cutover,
    tenantId: TENANT,
    mappingId: MAPPING,
    source: contactSource(b),
    target: contactTarget(t),
    ledger,
    cursors,
    addressChanges,
  });
}

/** What the target should hold for each card the book has, under a table. */
function expected(rows: ConfirmedAddressChange[]): Map<string, string> {
  return new Map([
    ['c-ben', applyAddressChanges('vcard', card('c-ben', 'ben@old.example.org'), rows).body],
    ['c-carla', card('c-carla', 'carla@stays.example.org')],
    ['c-ben-work', applyAddressChanges('vcard', card('c-ben-work', 'ben@old.example.org'), rows).body],
  ]);
}

/** The listings of the last pass: which folders were read from the beginning, and what each answered. */
function lastPassListings(b: Incremental<string>, from: number) {
  return b.listings.slice(from);
}

describe('contacts, on a source that lists only what changed', () => {
  it('reaches every copy already made with a row confirmed after the first pass, then converges back when it is deleted', async () => {
    const b = book();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const t = new Target();

    await contactPass(b, ledger, cursors, t, changes([]));
    expect(t.bodies).toEqual(expected([]));
    // Nothing changed at the source: the pass after reads incrementally and lists nothing.
    let from = b.listings.length;
    await contactPass(b, ledger, cursors, t, changes([]));
    expect(lastPassListings(b, from).every((l) => l.cursor !== undefined && l.uids.length === 0)).toBe(true);

    // A row confirmed after the first pass: every collection is read from the
    // beginning once, and each copy of Ben's card gains his new address.
    from = b.listings.length;
    const confirmed = await contactPass(b, ledger, cursors, t, changes([BEN]));
    expect(lastPassListings(b, from).map((l) => l.cursor)).toEqual([undefined, undefined]);
    expect(confirmed.updated).toBe(2);
    expect(t.bodies).toEqual(expected([BEN]));

    // The pass after reads incrementally again, and writes nothing.
    const writes = t.writes;
    from = b.listings.length;
    await contactPass(b, ledger, cursors, t, changes([BEN]));
    expect(lastPassListings(b, from).every((l) => l.cursor !== undefined && l.uids.length === 0)).toBe(true);
    expect(t.writes).toBe(writes);

    // The row deleted: read from the beginning once more, and every copy goes
    // back to the source's bytes.
    from = b.listings.length;
    const deleted = await contactPass(b, ledger, cursors, t, changes([]));
    expect(lastPassListings(b, from).map((l) => l.cursor)).toEqual([undefined, undefined]);
    expect(deleted.updated).toBe(2);
    expect(t.bodies).toEqual(expected([]));
    for (const uid of ['c-ben', 'c-ben-work']) {
      expect((await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash(uid)))?.addressDigest ?? null).toBeNull();
    }
  });

  it('keeps every cursor exactly as it was for a migration whose organisation confirmed no row', async () => {
    const b = book();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const t = new Target();
    await contactPass(b, ledger, cursors, t, changes([]));
    // Stored as the source handed it, with nothing in front.
    const held = await cursors.get(TENANT, MAPPING, '/family/');
    expect(held?.value).toMatch(/^seq-\d+$/);
    // And a cursor stored before the address table existed is read as it is.
    await cursors.set(TENANT, MAPPING, '/family/', { value: 'seq-3' });
    const from = b.listings.length;
    await contactPass(b, ledger, cursors, t, changes([]));
    expect(lastPassListings(b, from).find((l) => l.folder === '/family/')?.cursor).toBe('seq-3');
  });

  it('past the cutover, waits for the press, and the pass after the press reads every item and rewrites', async () => {
    const b = book();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const t = new Target();
    await contactPass(b, ledger, cursors, t, changes([]));
    const writes = t.writes;

    const waiting = await contactPass(b, ledger, cursors, t, changes([BEN]), true);
    expect(waiting.addressChangesWaiting).toBe(2);
    expect(t.writes).toBe(writes);

    // The press: the tag moves with it, so the next pass reads from the
    // beginning, though neither the source nor the table changed since.
    let from = b.listings.length;
    const pressed = await contactPass(b, ledger, cursors, t, changes([BEN], true), true);
    expect(lastPassListings(b, from).map((l) => l.cursor)).toEqual([undefined, undefined]);
    expect(pressed.updated).toBe(2);
    expect(t.bodies).toEqual(expected([BEN]));

    from = b.listings.length;
    await contactPass(b, ledger, cursors, t, changes([BEN], true), true);
    expect(lastPassListings(b, from).every((l) => l.cursor !== undefined && l.uids.length === 0)).toBe(true);
  });

  it('reads again from the beginning only the collection a pass could not read, not the others', async () => {
    const b = book();
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const t = new Target();
    await contactPass(b, ledger, cursors, t, changes([]));

    // Under the new table the work folder cannot be listed this once: it keeps
    // the cursor it had, which was read under the empty table.
    b.failNext.add('/work/');
    await contactPass(b, ledger, cursors, t, changes([BEN]));
    expect(t.bodies.get('c-ben')).toBe(expected([BEN]).get('c-ben'));
    expect(t.bodies.get('c-ben-work')).toBe(card('c-ben-work', 'ben@old.example.org'));

    const from = b.listings.length;
    await contactPass(b, ledger, cursors, t, changes([BEN]));
    const listed = lastPassListings(b, from);
    expect(listed.find((l) => l.folder === '/family/')?.cursor).toBeDefined();
    expect(listed.find((l) => l.folder === '/work/')?.cursor).toBeUndefined();
    expect(t.bodies).toEqual(expected([BEN]));
  });
});

// --- Calendars -----------------------------------------------------------------

function event(uid: string, organiser: string, guest: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `ORGANIZER;CN=Ana:mailto:${organiser}`,
    `ATTENDEE;CN=Ben:mailto:${guest}`,
    'SUMMARY:Sunday lunch',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

describe('calendars, on a source that lists only what changed', () => {
  it('changes the family’s event when the row comes after the copy, and puts it back when the row goes', async () => {
    const cal = new Incremental<[string, string]>();
    cal.put('/cal/', 'e-lunch', ['ana@old.example.org', 'ben@old.example.org']);
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const t = new Target();
    const source: CalendarSource = {
      listFolders: async () => [{ path: '/cal/', name: 'Calendar' }],
      listSince: async (folder: { path: string }, cursor?: SyncCursor) => {
        const { uids, next } = cal.list(folder.path, cursor);
        return {
          items: uids.map(([uid, [o, g]]) => ({
            item: { uid, type: 'event', summary: uid, start: '2026-12-06T12:00:00Z', etag: `"${uid}"`, sourcePath: `/cal/${uid}.ics` } as unknown as CalendarEvent,
            icalendar: event(uid, o, g),
          })),
          nextCursor: next,
          removed: [],
        };
      },
    } as unknown as CalendarSource;
    const target = {
      ensureCalendar: async (folder: { path: string }) => folder.path,
      upsertCalendarEvent: async (_c: string, raw: { item: CalendarEvent; icalendar: string }, options?: UpsertOptions) =>
        t.put(raw.item.uid, raw.icalendar, options),
    } as unknown as CalendarTargetWriter;
    const pass = (rows: ConfirmedAddressChange[]) =>
      runCalendarSync({
        sourceIsAuthorityOnExistence: true,
        stillTheAuthority: async () => true,
        tenantId: TENANT,
        mappingId: MAPPING,
        source,
        target,
        ledger,
        cursors,
        addressChanges: changes(rows),
      });

    const source0 = event('e-lunch', 'ana@old.example.org', 'ben@old.example.org');
    await pass([]);
    expect(t.bodies.get('e-lunch')).toBe(source0);

    // Ana is the account's own address: her event's guests change with the row.
    await pass([BEN]);
    expect(t.bodies.get('e-lunch')).toContain('ATTENDEE;CN=Ben:mailto:ben@example.org\r\n');

    await pass([]);
    expect(t.bodies.get('e-lunch')).toBe(source0);
  });

  it('reads the calendar again when the account’s own addresses change, so its guests follow (0168, found on the way)', async () => {
    // Ana's event; the row for Ben is confirmed from the start. Whether Ben
    // changes depends on whether Ana is one of the account's own addresses
    // (D3), and the source lists nothing new when that changes.
    const cal = new Incremental<[string, string]>();
    cal.put('/cal/', 'e-lunch', ['ana@old.example.org', 'ben@old.example.org']);
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const t = new Target();
    const source: CalendarSource = {
      listFolders: async () => [{ path: '/cal/', name: 'Calendar' }],
      listSince: async (folder: { path: string }, cursor?: SyncCursor) => {
        const { uids, next } = cal.list(folder.path, cursor);
        return {
          items: uids.map(([uid, [o, g]]) => ({
            item: { uid, type: 'event', summary: uid, start: '2026-12-06T12:00:00Z', etag: `"${uid}"`, sourcePath: `/cal/${uid}.ics` } as unknown as CalendarEvent,
            icalendar: event(uid, o, g),
          })),
          nextCursor: next,
          removed: [],
        };
      },
    } as unknown as CalendarSource;
    const target = {
      ensureCalendar: async (folder: { path: string }) => folder.path,
      upsertCalendarEvent: async (_c: string, raw: { item: CalendarEvent; icalendar: string }, options?: UpsertOptions) =>
        t.put(raw.item.uid, raw.icalendar, options),
    } as unknown as CalendarTargetWriter;
    const pass = (ownKeys: string[]) =>
      runCalendarSync({
        sourceIsAuthorityOnExistence: true,
        stillTheAuthority: async () => true,
        tenantId: TENANT,
        mappingId: MAPPING,
        source,
        target,
        ledger,
        cursors,
        addressChanges: { table: prepareAddressTable([BEN]), ownKeys },
      });

    const source0 = event('e-lunch', 'ana@old.example.org', 'ben@old.example.org');
    await pass(['someone@example.org']);
    expect(t.bodies.get('e-lunch')).toBe(source0);

    // Ana's address becomes one of the account's own: read again, and Ben follows.
    let from = cal.listings.length;
    await pass(OWN);
    expect(cal.listings.slice(from).map((l) => l.cursor)).toEqual([undefined]);
    expect(t.bodies.get('e-lunch')).toContain('ATTENDEE;CN=Ben:mailto:ben@example.org\r\n');

    // The same own addresses in another order: read incrementally, nothing written.
    const writes = t.writes;
    from = cal.listings.length;
    await pass([...OWN].reverse());
    expect(cal.listings.slice(from).every((l) => l.cursor !== undefined && l.uids.length === 0)).toBe(true);
    expect(t.writes).toBe(writes);

    // And taken away again: read again, and the event goes back to the source's bytes.
    from = cal.listings.length;
    await pass(['someone@example.org']);
    expect(cal.listings.slice(from).map((l) => l.cursor)).toEqual([undefined]);
    expect(t.bodies.get('e-lunch')).toBe(source0);
  });
});

