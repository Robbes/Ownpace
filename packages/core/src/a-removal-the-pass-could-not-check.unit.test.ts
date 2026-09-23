// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REMOVAL THE PASS COULD NOT CHECK (workplan 0022 T2, after #1116).
 *
 * A calendar, an address book or a mailbox can say outright that an object was
 * REMOVED from one of its collections. That is the source's own word, so it is
 * recorded as a confirmed deletion (`evidence: 'reported'`), the kind a person
 * may apply. One thing is checked first: that the object did not turn up in
 * another collection during the same pass, because a moved event is reported
 * as a removal from its old calendar and an arrival in its new one. The check
 * reads what the pass saw, so it holds only for a pass that looked everywhere.
 *
 * A pass that stops early, at its own deadline or at the download budget, did
 * not look everywhere. When it stopped before the calendar an event had moved
 * into, the check found nothing, and the move was recorded as a deletion the
 * source had reported. Applied, that removed the only copy on the new system,
 * and when the event arrived in its new calendar on the next pass it was not
 * copied again: a deletion applied on purpose is never undone by a pass.
 *
 * So a pass that did not reach every collection resolves no removal report.
 * Each collection that reported one keeps its cursor, so the next pass reads
 * the same removals again, and the first pass that reaches every collection
 * resolves them: a move as a move, a deletion as a deletion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDomainSync } from './domain-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('0e210000-e29b-41d4-a716-4466554404aa');
const MAPPING = asMappingId('0e210000-e29b-41d4-a716-4466554404bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => resetLogLevel());

/** One source object, keyed by UID and addressed by href, as CalDAV does. */
interface Obj {
  readonly uid: string;
  readonly href: string;
  readonly body: string;
}

/**
 * A server that keeps a change log per collection, the way a sync token does.
 * A poll from a token returns what arrived and what was removed since it, and
 * a new token. Polled again from the old token, the same removals come back;
 * from the new one, they do not. That difference is the whole of what a held
 * cursor is for, so the fake has to have it.
 */
function world(
  ledger: MemoryLedger = new MemoryLedger(),
  setup: {
    readonly afterCutover?: boolean;
    /** The owner's bin, by natural key, when the source has one to read. */
    readonly bin?: ReadonlySet<string>;
  } = {},
) {
  let clock = 0;
  const collections = new Map<
    string,
    { items: Map<string, Obj & { readonly at: number }>; removed: Array<{ at: number; href: string }> }
  >();
  const collection = (path: string) => {
    let c = collections.get(path);
    if (!c) {
      c = { items: new Map(), removed: [] };
      collections.set(path, c);
    }
    return c;
  };
  const add = (path: string, obj: Obj) => {
    collection(path).items.set(obj.uid, { ...obj, at: ++clock });
  };
  const remove = (path: string, uid: string) => {
    const c = collection(path);
    const gone = c.items.get(uid);
    if (!gone) return;
    c.items.delete(uid);
    c.removed.push({ at: ++clock, href: gone.href });
  };
  /** Dragged to another calendar: a removal from one, an arrival in the other. */
  const move = (from: string, to: string, uid: string, href: string) => {
    const obj = collection(from).items.get(uid)!;
    remove(from, uid);
    add(to, { uid, href, body: obj.body });
  };

  const cursors = new MemoryCursorStore();
  const target = new Map<string, string>();

  const run = (opts: { readonly stopAfter?: string } = {}) => {
    let late = false;
    return runDomainSync<unknown, unknown, Obj, { path: string }>({
      sourceIsAuthorityOnExistence: !setup.afterCutover,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'calendar',
      source: {},
      target: {},
      ledger,
      cursors,
      concurrency: 1,
      listFolders: async () => [...collections.keys()].map((path) => ({ path })),
      listSince: async (folder, cursor) => {
        const since = cursor ? Number(cursor.value) : 0;
        const c = collection(folder.path);
        const answer = {
          items: [...c.items.values()].filter((o) => o.at > since),
          nextCursor: { value: String(clock) },
          removed: c.removed.filter((r) => r.at > since).map((r) => r.href),
        };
        // The deadline passes while this collection is read: the pass
        // finishes it and opens no other.
        if (folder.path === opts.stopAfter) late = true;
        return answer;
      },
      fetchRaw: async (o) => ({ raw: o.body, sizeBytes: o.body.length }),
      upsert: async (collectionId, raw, o, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${o.uid}`;
        const existed = target.has(at);
        target.set(at, raw as string);
        if (existed) return { targetId: at, created: false, adopted: true };
        // The writer records the row itself, as the real DAV writers do, with
        // the href a removal report will name.
        await ledger.recordIfAbsent({
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: 'calendar',
          naturalKeyHash: o.uid,
          contentHash: `h:${raw as string}`,
          targetId: at,
          createdAt: new Date().toISOString(),
          sizeBytes: (raw as string).length,
          status: 'copied',
          ...(options?.sourceVersion !== undefined ? { sourceVersion: options.sourceVersion } : {}),
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
          ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        });
        return { targetId: at, created: true };
      },
      naturalKey: (o) => o.uid,
      sourceVersion: () => 'e1',
      sourceRef: (o) => o.href,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => `t/${folder.path}`,
      ...(setup.bin ? { listDiscardedKeys: async () => ({ keys: [...setup.bin!], unnameable: 0 }) } : {}),
      deadline: 500,
      now: () => (late ? 999 : 0),
    });
  };
  const cursorOf = async (path: string) => (await cursors.get(TENANT, MAPPING, path))?.value;
  return { ledger, target, add, remove, move, collection, run, cursorOf, clock: () => clock };
}

/** An event in Work, a Personal calendar beside it, both copied. */
async function copied(ledger?: MemoryLedger) {
  const w = world(ledger);
  w.add('Work', { uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1' });
  w.collection('Personal');
  expect((await w.run()).created).toBe(1);
  return w;
}

const REPORTED_DELETION = {
  domain: 'calendar',
  naturalKeyHash: 'uid-1',
  collection: 'Work',
  absentPasses: 0,
  confirmed: true,
  evidence: 'reported',
};

describe('a removal reported on a pass that stopped early', () => {
  it('is not taken for a deletion while the calendar it may have moved to was not reached', async () => {
    const w = await copied();
    w.move('Work', 'Personal', 'uid-1', '/cal/personal/1.ics');

    const stopped = await w.run({ stopAfter: 'Work' });

    expect(stopped.deadlinePause).toBeDefined();
    expect(stopped.deletions).toEqual([]);
    expect(await w.ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
    expect((await w.ledger.find(TENANT, MAPPING, 'calendar', 'uid-1'))?.deletionReportedAt).toBeUndefined();
  });

  it('is read again by the next pass, which sees the move for what it is', async () => {
    const w = await copied();
    w.move('Work', 'Personal', 'uid-1', '/cal/personal/1.ics');
    await w.run({ stopAfter: 'Work' });

    const next = await w.run();

    expect(next.deadlinePause).toBeUndefined();
    expect(next.deletions).toEqual([]);
    expect(next.moves).toEqual([
      { domain: 'calendar', naturalKeyHash: 'uid-1', from: 'Work', to: 'Personal' },
    ]);
    expect(await w.ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });

  it('is still reported when it was a deletion: one pass later, not never', async () => {
    const w = await copied();
    w.remove('Work', 'uid-1');

    expect((await w.run({ stopAfter: 'Work' })).deletions).toEqual([]);
    const next = await w.run();

    expect(next.deletions).toEqual([REPORTED_DELETION]);
    const queued = await w.ledger.listDeletions(TENANT, MAPPING);
    expect(queued.map((d) => [d.naturalKeyHash, d.evidence, d.confirmed])).toEqual([
      ['uid-1', 'reported', true],
    ]);
  });

  it('holds back the cursor of the collection that reported it, and no other', async () => {
    const w = world();
    w.add('Home', { uid: 'uid-0', href: '/cal/home/0.ics', body: 'V0' });
    w.add('Work', { uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1' });
    w.collection('Personal');
    await w.run();
    const before = w.clock();
    expect(await w.cursorOf('Work')).toBe(String(before));
    const personalBefore = await w.cursorOf('Personal');

    w.add('Home', { uid: 'uid-2', href: '/cal/home/2.ics', body: 'V2' });
    w.move('Work', 'Personal', 'uid-1', '/cal/personal/1.ics');
    const stopped = await w.run({ stopAfter: 'Work' });

    // Home had only an arrival: copied, and its cursor moves on as always.
    expect(stopped.created).toBe(1);
    expect(await w.cursorOf('Home')).toBe(String(w.clock()));
    // Work reported a removal nobody could check: its cursor stays, so the
    // removal is handed out again.
    expect(await w.cursorOf('Work')).toBe(String(before));
    // Personal was never opened, so its cursor is where it was, as it always was.
    expect(await w.cursorOf('Personal')).toBe(personalBefore);
  });

  it('lets the cursor move past it once a pass has resolved it', async () => {
    const w = await copied();
    w.move('Work', 'Personal', 'uid-1', '/cal/personal/1.ics');
    await w.run({ stopAfter: 'Work' });
    await w.run();

    expect(await w.cursorOf('Work')).toBe(String(w.clock()));
    // Resolved, so the next pass is not handed it again.
    const after = await w.run();
    expect(after.deletions).toEqual([]);
    expect(after.moves).toEqual([]);
  });
});

describe('a removal on a pass that reached every collection', () => {
  it('is resolved on that pass, as before', async () => {
    const w = await copied();
    w.remove('Work', 'uid-1');

    const pass = await w.run();

    expect(pass.deletions).toEqual([REPORTED_DELETION]);
    expect(await w.cursorOf('Work')).toBe(String(w.clock()));
  });

  it('is not lost when resolving it fails: the cursor moves only after it is written down', async () => {
    // Before this, the cursor moved as soon as the collection was read, and a
    // failure while resolving lost the removal for good: the server does not
    // hand it out twice.
    class LedgerThatFailsOnce extends MemoryLedger {
      private failures = 1;
      override recordReportedDeletion(
        ...args: Parameters<MemoryLedger['recordReportedDeletion']>
      ): Promise<boolean> {
        if (this.failures > 0) {
          this.failures -= 1;
          return Promise.reject(new Error('the ledger is unavailable'));
        }
        return super.recordReportedDeletion(...args);
      }
    }
    const w = await copied(new LedgerThatFailsOnce());
    w.remove('Work', 'uid-1');

    await expect(w.run()).rejects.toThrow('the ledger is unavailable');
    const next = await w.run();

    expect(next.deletions).toEqual([REPORTED_DELETION]);
  });
});

describe('a removal after cutover', () => {
  it('holds no cursor back: the source no longer decides what exists, so nothing waits on it', async () => {
    // After cutover a removal report is not collected at all, so there is
    // nothing to resolve later, and holding the cursor would only make every
    // pass read the same removals for nothing.
    const w = world(new MemoryLedger(), { afterCutover: true });
    w.add('Work', { uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1' });
    w.collection('Personal');
    await w.run();
    w.remove('Work', 'uid-1');

    const stopped = await w.run({ stopAfter: 'Work' });

    expect(stopped.deletions).toEqual([]);
    expect(await w.cursorOf('Work')).toBe(String(w.clock()));
  });
});

describe("the owner's bin on a pass that stopped early", () => {
  // A mailbox read over IMAP reports no removals; what it has is a bin, read at
  // the end of the pass. An item in the bin is recorded as trashed, which a
  // person may apply, unless the pass saw it alive in a folder.

  /** A message copied from Work, then filed in Personal and thrown away from Work. */
  async function inTheBinAndAlive() {
    const bin = new Set<string>();
    const w = world(new MemoryLedger(), { bin });
    w.add('Work', { uid: 'uid-1', href: '/mail/work/1', body: 'V1' });
    w.collection('Personal');
    await w.run();
    w.add('Personal', { uid: 'uid-1', href: '/mail/personal/1', body: 'V1' });
    // Gone from Work with no removal report, as IMAP gives none.
    w.collection('Work').items.delete('uid-1');
    bin.add('uid-1');
    return { w, bin };
  }

  it('is not read: a message in it may be alive in a folder the pass did not reach', async () => {
    const { w } = await inTheBinAndAlive();

    const stopped = await w.run({ stopAfter: 'Work' });

    expect(stopped.deadlinePause).toBeDefined();
    expect(stopped.deletions).toEqual([]);
    expect(await w.ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });

  it('is read by the next pass that reaches every collection, which sees the message alive', async () => {
    const { w } = await inTheBinAndAlive();
    await w.run({ stopAfter: 'Work' });

    const next = await w.run();

    expect(next.deletions).toEqual([]);
    expect(await w.ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });

  it('still reports what is only in the bin, one pass later, not never', async () => {
    const bin = new Set<string>();
    const w = world(new MemoryLedger(), { bin });
    w.add('Work', { uid: 'uid-1', href: '/mail/work/1', body: 'V1' });
    w.collection('Personal');
    await w.run();
    w.collection('Work').items.delete('uid-1');
    bin.add('uid-1');

    expect((await w.run({ stopAfter: 'Work' })).deletions).toEqual([]);
    const next = await w.run();

    expect(next.deletions.map((d) => [d.naturalKeyHash, d.evidence, d.confirmed])).toEqual([
      ['uid-1', 'trashed', true],
    ]);
  });
});
