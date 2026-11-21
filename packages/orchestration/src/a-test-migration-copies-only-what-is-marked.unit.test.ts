// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST MIGRATION COPIES ONLY WHAT IS MARKED, through the real passes
 * (workplan 0162 T2; the owner's decisions of 2026-11-20, §2).
 *
 * Each data type runs here as a pass runs it: its source wrapped by the same
 * function the builders call (`markedOnlyMail`, `markedOnlyCalendar`, …), and
 * handed to the real `runShadowPass`, `runCalendarSync`, `runTaskSync`,
 * `runContactSync` or `runFileSync`, over memory stores. Each case is asked
 * of every data type:
 *
 *  - a marked item is copied and an unmarked one is not, the marker in any
 *    case;
 *  - a collection holding only unmarked items keeps its cursor, so it is not
 *    listed whole again on every pass;
 *  - only the collections that hold a marked item are made on the target;
 *  - an item renamed into the marker is copied on the next pass, and one
 *    renamed out of it keeps its last copy, with nothing reported deleted
 *    (§2 (f)); mail, whose subject never changes, is asked about a reply;
 *  - a removal the source reports passes through unfiltered: one of an item
 *    never copied changes nothing, and one of a marked copy is reported;
 *  - the same account WITHOUT a marker copies everything and makes every
 *    collection the first time a pass sees it, as it always did.
 *
 * And events, tasks and contacts, whose key survives a move to another
 * collection: one whose marker was taken out and which then moved is reported
 * removed by the collection it left and listed, set aside, by the one it is
 * in. It is not a deletion, and its copy stays where it was last copied
 * (§2 (f)); the same account without a marker reports the move it always did.
 * And events: a recurring series with a moved occurrence goes by its master.
 * A file renamed out of the marker through the real Drive source is
 * `a-file-renamed-out-of-the-marker`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runCalendarSync,
  runContactSync,
  runFileSync,
  runShadowPass,
  runTaskSync,
} from '@openmig/core';
import {
  asMappingId,
  asTenantId,
  resetLogLevel,
  setLogLevel,
  type CalendarSource,
  type CalendarTargetWriter,
  type ContactSource,
  type ContactTargetWriter,
  type FileSource,
  type FileTargetWriter,
  type ItemDeletion,
  type MailFolder,
  type MailItem,
  type RawCalendarEvent,
  type RawContact,
  type SourceConnector,
  type SyncCursor,
  type UpsertResult,
} from '@openmig/shared';
import { MemoryCursorStore, MemoryLedger, MemoryTarget } from '../../core/src/__testing__/memory.ts';
import { markedOnlyCalendar, markedOnlyContacts, markedOnlyFiles, markedOnlyMail } from './marked-only.ts';

const TENANT = asTenantId('01620000-e29b-41d4-a716-4466554402a1');
const MAPPING = asMappingId('01620000-e29b-41d4-a716-4466554402a2');
const MARKER = '[Ownpace-test]';

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** One item of the account a test makes. `title` is the item's own title. */
interface Rec {
  readonly id: string;
  collection: string;
  title: string;
  version: number;
  changedAt: number;
  /** A moved occurrence of this series, with its own SUMMARY (events only). */
  override?: string;
}

/**
 * A real account in miniature: collections, the items in them, and a clock
 * every change moves, which is what a listing with a cursor answers from (the
 * items changed since). A removal is reported once, by the collection it left,
 * as a DAV `sync-collection` reports it.
 */
class Account {
  tick = 0;
  readonly collections = new Set<string>();
  readonly recs = new Map<string, Rec>();
  private readonly removals = new Map<string, string[]>();

  collection(path: string): void {
    this.collections.add(path);
  }
  add(collection: string, id: string, title: string, override?: string): void {
    this.collections.add(collection);
    this.recs.set(id, { id, collection, title, version: 1, changedAt: ++this.tick, ...(override ? { override } : {}) });
  }
  retitle(id: string, title: string): void {
    const rec = this.recs.get(id)!;
    rec.title = title;
    rec.version += 1;
    rec.changedAt = ++this.tick;
  }
  remove(id: string, ref: string): void {
    const rec = this.recs.get(id)!;
    this.recs.delete(id);
    this.tick += 1;
    this.removals.set(rec.collection, [...(this.removals.get(rec.collection) ?? []), ref]);
  }
  /**
   * The item moves to another collection, unchanged: the one it left reports
   * its old handle removed (`ref`, as it was there), and the one it is in now
   * lists it as changed.
   */
  move(id: string, to: string, ref: string): void {
    const rec = this.recs.get(id)!;
    this.removals.set(rec.collection, [...(this.removals.get(rec.collection) ?? []), ref]);
    this.collections.add(to);
    rec.collection = to;
    rec.changedAt = ++this.tick;
  }
  /** What a listing of `collection` returns: everything, or what changed since the cursor. */
  since(collection: string, cursor?: SyncCursor): Rec[] {
    const after = cursor ? Number(cursor.value) : -1;
    return [...this.recs.values()].filter((r) => r.collection === collection && r.changedAt > after);
  }
  takeRemovals(collection: string): { removed?: string[] } {
    const removed = this.removals.get(collection);
    this.removals.delete(collection);
    return removed ? { removed } : {};
  }
  cursor(): SyncCursor {
    return { value: String(this.tick) };
  }
}

/** What every data type's world answers, so each case can be asked of all five. */
interface World {
  readonly account: Account;
  /** The data type its ledger rows are recorded under. */
  readonly domain: ItemDeletion['domain'];
  readonly ledger: MemoryLedger;
  readonly cursors: MemoryCursorStore;
  /** The title a renamed item gets in this data type, given the old one. */
  readonly renames: boolean;
  /** The source's own handle for an item, which a removal names. */
  ref(rec: { id: string; collection: string; title: string }): string;
  pass(): Promise<{ created: number; moved?: number; deletions?: ReadonlyArray<ItemDeletion> }>;
  /** Titles on the target, by the item's id, sorted. */
  copied(): string[];
  /** Collections the target was asked to make, in order. */
  made(): string[];
}

// ---------------------------------------------------------------------------
// The five worlds
// ---------------------------------------------------------------------------

const ics = (rec: Rec, component: 'VEVENT' | 'VTODO'): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//example.test//EN',
    `BEGIN:${component}`,
    `UID:${rec.id}`,
    `SUMMARY:${rec.title}`,
    'DTSTART:20261120T100000Z',
    ...(rec.override ? ['RRULE:FREQ=WEEKLY'] : []),
    `END:${component}`,
    ...(rec.override
      ? [`BEGIN:${component}`, `UID:${rec.id}`, 'RECURRENCE-ID:20261127T100000Z', `SUMMARY:${rec.override}`, 'DTSTART:20261127T110000Z', `END:${component}`]
      : []),
    'END:VCALENDAR',
  ].join('\r\n');

const summaryOf = (text: string): string => /^SUMMARY:(.*)$/m.exec(text)?.[1]?.trim() ?? '';

function calendarWorld(marker: string | null, component: 'VEVENT' | 'VTODO'): World {
  const account = new Account();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const made: string[] = [];
  const stored = new Map<string, string>();
  const ref = (rec: { id: string; collection: string }) => `/cal/${rec.collection}/${rec.id}.ics`;
  const source: CalendarSource = {
    listFolders: async () => [...account.collections].map((path) => ({ path, name: path })),
    listSince: async (folder, cursor) => {
      const items: RawCalendarEvent[] = account.since(folder.path, cursor).map((rec) => {
        const icalendar = ics(rec, component);
        return {
          item: {
            uid: rec.id,
            type: component === 'VTODO' ? 'todo' : 'event',
            summary: rec.title,
            start: '2026-11-20T10:00:00Z',
            etag: `"${rec.version}"`,
            sourcePath: ref(rec),
            icalendar,
          },
          icalendar,
        };
      });
      return { items, nextCursor: account.cursor(), ...account.takeRemovals(folder.path) };
    },
  };
  const target: CalendarTargetWriter = {
    ensureCalendar: async (folder) => {
      made.push(folder.path);
      return `t:${folder.path}`;
    },
    upsertCalendarEvent: async (calendarId, raw, options): Promise<UpsertResult> => {
      const key = raw.item.uid;
      const existed = stored.has(key);
      stored.set(key, summaryOf(raw.icalendar));
      if (options?.overwrite) return { targetId: `${calendarId}/${key}`, created: false, updated: true };
      return existed ? { targetId: `${calendarId}/${key}`, created: false, adopted: true } : { targetId: `${calendarId}/${key}`, created: true };
    },
    findCalendarByNaturalKey: async () => undefined,
  };
  const wrapped = markedOnlyCalendar(source, marker);
  const deps = { tenantId: TENANT, mappingId: MAPPING, source: wrapped, target, ledger, cursors, sourceIsAuthorityOnExistence: true, stillTheAuthority: async () => true };
  return {
    account,
    domain: component === 'VTODO' ? 'task' : 'calendar',
    ledger,
    cursors,
    renames: true,
    ref,
    pass: () => (component === 'VTODO' ? runTaskSync(deps) : runCalendarSync(deps)),
    copied: () => [...stored.values()].sort(),
    made: () => made,
  };
}

function contactWorld(marker: string | null): World {
  const account = new Account();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const made: string[] = [];
  const stored = new Map<string, string>();
  const ref = (rec: { id: string; collection: string }) => `/ab/${rec.collection}/${rec.id}.vcf`;
  const source: ContactSource = {
    listFolders: async () => [...account.collections].map((path) => ({ path, name: path })),
    listSince: async (folder, cursor) => {
      const items: RawContact[] = account.since(folder.path, cursor).map((rec) => {
        const vcard = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${rec.id}\r\nFN:${rec.title}\r\nEND:VCARD`;
        return {
          item: { uid: rec.id, type: 'person', name: rec.title, etag: `"${rec.version}"`, sourcePath: ref(rec), vcard, version: '3.0' },
          vcard,
        };
      });
      return { items, nextCursor: account.cursor(), ...account.takeRemovals(folder.path) };
    },
  };
  const target: ContactTargetWriter = {
    ensureContactFolder: async (folder) => {
      made.push(folder.path);
      return `t:${folder.path}`;
    },
    upsertContact: async (folderId, raw, options): Promise<UpsertResult> => {
      const key = raw.item.uid;
      const existed = stored.has(key);
      stored.set(key, /^FN:(.*)$/m.exec(raw.vcard)?.[1]?.trim() ?? '');
      if (options?.overwrite) return { targetId: `${folderId}/${key}`, created: false, updated: true };
      return existed ? { targetId: `${folderId}/${key}`, created: false, adopted: true } : { targetId: `${folderId}/${key}`, created: true };
    },
    findContactByNaturalKey: async () => undefined,
  };
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: markedOnlyContacts(source, marker),
    target,
    ledger,
    cursors,
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  };
  return { account, domain: 'contact', ledger, cursors, renames: true, ref, pass: () => runContactSync(deps), copied: () => [...stored.values()].sort(), made: () => made };
}

function fileWorld(marker: string | null): World {
  const account = new Account();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const made: string[] = [];
  const stored = new Map<string, string>();
  const pathOf = (rec: { collection: string; title: string }) => `${rec.collection}/${rec.title}`;
  // The id a delta names a deleted file by, which a rename does not change.
  const ref = (rec: { id: string }) => `drive-id:${rec.id}`;
  const source: FileSource = {
    listFolders: async () => [...account.collections].map((path) => ({ path, name: path })),
    listSince: async (folder, cursor) => ({
      items: account.since(folder.path, cursor).map((rec) => ({
        item: {
          path: pathOf(rec),
          name: rec.title,
          isDirectory: false,
          size: rec.id.length,
          modifiedAt: '2026-11-20T10:00:00Z',
          etag: `v${rec.version}`,
          sourceRef: ref(rec),
        },
      })),
      nextCursor: account.cursor(),
      ...account.takeRemovals(folder.path),
    }),
    // Every path the folder holds, as a real source answers it.
    listKeys: async (folder) => [...account.recs.values()].filter((r) => r.collection === folder.path).map(pathOf),
    fetch: async (item) => ({ item, content: new TextEncoder().encode(`bytes of ${item.sourceRef}`) }),
  };
  const target: FileTargetWriter = {
    ensureDirectory: async (folder) => {
      made.push(folder.path);
      return `t:${folder.path}`;
    },
    upsertFile: async (parentId, raw, options): Promise<UpsertResult> => {
      const key = raw.item.path;
      const existed = stored.has(key);
      stored.set(key, raw.item.name ?? key);
      if (options?.overwrite) return { targetId: `${parentId}/${key}`, created: false, updated: true };
      return existed ? { targetId: `${parentId}/${key}`, created: false, adopted: true } : { targetId: `${parentId}/${key}`, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: markedOnlyFiles(source, marker),
    target,
    ledger,
    cursors,
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  };
  return { account, domain: 'file', ledger, cursors, renames: true, ref, pass: () => runFileSync(deps), copied: () => [...stored.values()].sort(), made: () => made };
}

/**
 * Mail: a message's subject never changes, so a listing is append-only and a
 * cursor is how many it has seen. A removal is Graph's delta `@removed`, by
 * the message's own handle.
 */
function mailWorld(marker: string | null): World {
  const account = new Account();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const target = new MemoryTarget();
  const folderOf = (path: string): MailFolder => ({ path, specialUse: path === 'INBOX' ? 'inbox' : 'normal' });
  const ref = (rec: { id: string; collection: string }) => `${rec.collection}:${rec.id}`;
  const source: SourceConnector = {
    listFolders: async () => [...account.collections].map(folderOf),
    listSince: async (folder, cursor) => {
      const all = [...account.recs.values()].filter((r) => r.collection === folder.path);
      const seen = cursor ? Number(cursor.value) : 0;
      const items: MailItem[] = all.slice(seen).map((rec) => ({
        messageId: `<${rec.id}@example.test>`,
        folder,
        keywords: [],
        receivedAt: '2026-11-20T10:00:00.000Z',
        sourceRef: ref(rec),
        subject: rec.title,
      }));
      return { items, nextCursor: { value: String(all.length) }, ...account.takeRemovals(folder.path) };
    },
    fetch: async (item) => ({
      item,
      rfc822: new TextEncoder().encode(`Message-ID: ${item.messageId}\r\nSubject: ${item.subject ?? ''}\r\n\r\nHello.\r\n`),
    }),
  };
  const titles = new Map<string, string>();
  const deps = {
    tenantId: TENANT,
    mappingId: MAPPING,
    source: markedOnlyMail(source, marker),
    target,
    ledger,
    cursors,
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  };
  return {
    account,
    domain: 'email',
    ledger,
    cursors,
    renames: false,
    ref,
    pass: async () => {
      const before = target.size();
      const result = await runShadowPass(deps);
      // The target keys by Message-ID; remember which titles reached it.
      for (const entry of await (async () => {
        const out: string[] = [];
        for await (const e of target.listEntries()) out.push(e.naturalKey);
        return out;
      })()) {
        const id = entry.replace(/^<|@example\.test>$/g, '');
        const rec = account.recs.get(id);
        if (rec && !titles.has(id)) titles.set(id, rec.title);
      }
      expect(target.size()).toBeGreaterThanOrEqual(before);
      return result;
    },
    copied: () => [...titles.values()].sort(),
    made: () => target.mailboxNames(),
  };
}

const WORLDS: ReadonlyArray<readonly [string, (marker: string | null) => World]> = [
  ['mail', mailWorld],
  ['events', (m) => calendarWorld(m, 'VEVENT')],
  ['tasks', (m) => calendarWorld(m, 'VTODO')],
  ['contacts', contactWorld],
  ['files', fileWorld],
];

// ---------------------------------------------------------------------------

describe.each(WORLDS)('%s, in a test migration', (_name, make) => {
  it('copies the marked items, the marker in any case, and not the unmarked one', async () => {
    const w = make(MARKER);
    w.account.add('Work', 'a', '[Ownpace-test] Plan');
    w.account.add('Work', 'b', 'Re: [OWNPACE-TEST] Plan');
    w.account.add('Work', 'c', 'Private plan');

    const r = await w.pass();

    expect(r.created).toBe(2);
    expect(w.copied()).toEqual(['Re: [OWNPACE-TEST] Plan', '[Ownpace-test] Plan']);
    // Nothing unmarked reaches the ledger either (§2 (d)).
    expect(w.ledger.size()).toBe(2);
  });

  it('keeps the cursor of a collection that holds only unmarked items', async () => {
    const w = make(MARKER);
    w.account.add('Private', 'p1', 'Taxes');
    w.account.add('Private', 'p2', 'Holiday');

    const r = await w.pass();

    // The marker emptied this read, and the read still counts as one.
    expect(r.created).toBe(0);
    expect(w.ledger.size()).toBe(0);
    expect(await w.cursors.get(TENANT, MAPPING, 'Private')).toBeDefined();
  });

  it('makes only the collections that hold a marked item, when that item is written', async () => {
    const w = make(MARKER);
    w.account.add('Work', 'a', '[Ownpace-test] Plan');
    w.account.add('Private', 'p', 'Taxes');
    w.account.collection('Empty');

    await w.pass();
    await w.pass();

    expect(w.made()).toEqual(['Work']);
  });

  it('copies an item when the marker is added, and keeps the last copy, reporting no deletion, when it is taken out', async () => {
    const w = make(MARKER);
    w.account.add('Work', 'a', 'Plan');
    w.account.add('Work', 'z', '[Ownpace-test] Kept');
    await w.pass();
    expect(w.copied()).toEqual(['[Ownpace-test] Kept']);

    if (w.renames) {
      w.account.retitle('a', '[Ownpace-test] Plan');
      const added = await w.pass();
      expect(added.created).toBe(1);
      expect(w.copied()).toEqual(['[Ownpace-test] Kept', '[Ownpace-test] Plan']);

      w.account.retitle('a', 'Plan, done');
      for (let n = 0; n < 4; n += 1) {
        const r = await w.pass();
        expect(r.created, `pass ${n}`).toBe(0);
        expect(r.deletions ?? [], `pass ${n}`).toEqual([]);
      }
      // The last copy stands, and the ledger still holds it as copied.
      expect(w.copied()).toEqual(['[Ownpace-test] Kept', '[Ownpace-test] Plan']);
    } else {
      // A subject never changes; what arrives is a reply, which carries it.
      w.account.add('Work', 'r', 'Re: [Ownpace-test] Kept');
      const reply = await w.pass();
      expect(reply.created).toBe(1);
      expect(w.copied()).toEqual(['Re: [Ownpace-test] Kept', '[Ownpace-test] Kept']);
    }
  });

  it('passes a removal through: one of an item never copied changes nothing, one of a marked copy is reported', async () => {
    const w = make(MARKER);
    w.account.add('Work', 'a', '[Ownpace-test] Plan');
    w.account.add('Work', 'b', 'Private plan');
    await w.pass();

    const marked = w.account.recs.get('a')!;
    const plain = w.account.recs.get('b')!;
    w.account.remove('b', w.ref(plain));
    const quiet = await w.pass();
    expect(quiet.deletions ?? []).toEqual([]);

    w.account.remove('a', w.ref(marked));
    const reported = await w.pass();
    expect((reported.deletions ?? []).map((d) => d.evidence)).toEqual(['reported']);
  });
});

describe.each(WORLDS)('%s, in a migration that is not a test', (_name, make) => {
  it('copies everything and makes every collection the first time a pass sees it, as it always did', async () => {
    const w = make(null);
    w.account.add('Work', 'a', '[Ownpace-test] Plan');
    w.account.add('Private', 'p', 'Taxes');
    w.account.collection('Empty');

    const r = await w.pass();

    expect(r.created).toBe(2);
    expect(w.copied()).toEqual(['Taxes', '[Ownpace-test] Plan']);
    expect([...w.made()].sort()).toEqual(['Empty', 'Private', 'Work']);
  });
});

/**
 * The data types whose key survives a move to another collection, and whose
 * removal report names the address the move changes.
 */
const KEYED_ACROSS_COLLECTIONS = WORLDS.filter(([name]) => ['events', 'tasks', 'contacts'].includes(name));

describe.each(KEYED_ACROSS_COLLECTIONS)('%s: an item whose marker is taken out, and which then moves to another collection', (_name, make) => {
  /** Copied with the marker, the marker taken out of its title, then moved to another collection. */
  async function markedThenTakenOutThenMoved(w: World) {
    w.account.add('Work', 'a', '[Ownpace-test] Plan');
    expect((await w.pass()).created).toBe(1);

    w.account.retitle('a', 'Plan');
    const takenOut = await w.pass();
    expect(takenOut.deletions ?? []).toEqual([]);

    w.account.move('a', 'Home', w.ref(w.account.recs.get('a')!));
    return w.pass();
  }

  it('in a test migration, is not reported deleted, and its copy stays where it was last copied', async () => {
    const w = make(MARKER);

    const r = await markedThenTakenOutThenMoved(w);

    // Still at the source, so no deletion: the old collection's removal names
    // an item this pass listed, set aside (§2 (f)).
    expect((r.deletions ?? []).map((d) => d.evidence)).toEqual([]);
    // And no move either: the test does not copy it any more, so nothing is
    // recorded about where it went, and its copy keeps the last marked title.
    expect(r.moved ?? 0).toBe(0);
    expect(w.copied()).toEqual(['[Ownpace-test] Plan']);
    expect(w.made()).toEqual(['Work']);
    // The row still names the address it was copied from, where its copy is.
    const row = (await w.ledger.findBySourceRef(TENANT, MAPPING, w.domain, w.ref({ id: 'a', collection: 'Work', title: '' })))!;
    expect(row.status).toBe('copied');
    expect(row.collection).toBe('Work');
    expect(row.deletionReportedAt).toBeUndefined();
    expect(row.movedToCollection).toBeUndefined();
  });

  it('in a migration that is not a test, is the move it always was, and not a deletion', async () => {
    const w = make(null);

    const r = await markedThenTakenOutThenMoved(w);

    expect((r.deletions ?? []).map((d) => d.evidence)).toEqual([]);
    expect(r.moved).toBe(1);
  });

  it('in a test migration, is reported once it is deleted at the source instead of moved', async () => {
    const w = make(MARKER);
    w.account.add('Work', 'a', '[Ownpace-test] Plan');
    await w.pass();
    w.account.retitle('a', 'Plan');
    await w.pass();

    // A real deletion still reaches the queue, marker or not (§2 (f)); the
    // copy keeps the last marked title, as the taking out left it.
    w.account.remove('a', w.ref(w.account.recs.get('a')!));
    const r = await w.pass();

    expect((r.deletions ?? []).map((d) => d.evidence)).toEqual(['reported']);
    expect(w.copied()).toEqual(['[Ownpace-test] Plan']);
  });
});

describe('a recurring event with a moved occurrence goes by its master’s SUMMARY (§2 (a))', () => {
  it('is copied whole when the master is marked, whatever the moved occurrence is called', async () => {
    const w = calendarWorld(MARKER, 'VEVENT');
    w.account.add('Work', 'weekly', '[Ownpace-test] Standup', 'Standup, moved to eleven');
    w.account.add('Work', 'other', 'Standup', '[Ownpace-test] only this one is marked');

    const r = await w.pass();

    expect(r.created).toBe(1);
    expect(w.copied()).toEqual(['[Ownpace-test] Standup']);
  });
});
