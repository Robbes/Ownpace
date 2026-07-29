// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * When the SOURCE says an object is gone.
 *
 * Every other deletion signal in this product is an inference: an item stopped
 * appearing, so it has probably been deleted. That inference is weak on purpose —
 * a folder briefly missing from discovery, a throttled listing and a connector
 * having a bad ten minutes all look exactly like a deletion — so it takes
 * `DELETION_CONFIRMATIONS` consecutive complete scans before anyone is told, and
 * it can never be trusted enough to act on.
 *
 * RFC 6578 `sync-collection` is a different kind of statement. It answers an
 * incremental CalDAV/CardDAV poll with the objects that CHANGED and the ones that
 * were REMOVED, the latter as a `<response>` carrying just an href and a 404
 * status. There is nothing to infer and nothing to corroborate. Both DAV
 * connectors have been issuing that REPORT since they were written and throwing
 * this half of every answer away.
 *
 * The href is all that arrives — a removed object has no body, so no UID, so no
 * natural key — which is why the href is recorded on the ledger row at copy time
 * (migration 0025) and why `findBySourceRef` exists.
 *
 * The test that matters most is not the happy path. It is the one where the same
 * UID turns up in another collection during the same pass: a moved event is
 * reported as a removal from the old href and an arrival at a new one, and
 * reporting THAT as a deletion would tell an owner their data is gone while it is
 * sitting right there.
 */

import { describe, it, expect } from 'vitest';
import { runDomainSync } from './domain-sync';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory';
import { asTenantId, asMappingId, DELETION_CONFIRMATIONS, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('a1330000-e29b-41d4-a716-4466554402aa');
const MAPPING = asMappingId('a1330000-e29b-41d4-a716-4466554402bb');

/**
 * One source object, keyed by UID and addressed by href.
 *
 * The two being different is the whole reason this machinery exists. For calendar
 * and contacts the natural key comes from inside the body (`cal:<uid>`), and a
 * removal report has no body — so the href is the only bridge.
 */
interface Obj {
  readonly uid: string;
  readonly href: string;
  readonly body: string;
  readonly version?: string;
}

/**
 * A CalDAV-shaped source whose collections can be rearranged between passes and
 * which can report removals, wired to a target that records its own ledger rows.
 *
 * The fake writer records the row ITSELF, as all three real DAV writers do —
 * `recordIfAbsent` makes the first writer win, and that is the writer. A harness
 * where only the loop recorded would pass while `sourceRef` never reached a
 * single row in production, which is precisely how `collection`, `sourceVersion`
 * and `absentPasses` each managed to be silently inert for a release.
 */
function world() {
  const folders = new Map<string, Obj[]>();
  /** Removal reports the server will hand out on the next poll, per collection. */
  const removals = new Map<string, string[]>();
  /** Everything actually on the target. */
  const target = new Map<string, string>();

  const run = (ledger: MemoryLedger, cursors?: MemoryCursorStore) =>
    runDomainSync<unknown, unknown, Obj, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'calendar',
      source: {},
      target: {},
      ledger,
      ...(cursors ? { cursors } : {}),
      listFolders: async () => [...folders.keys()].map((path) => ({ path })),
      listSince: async (folder, cursor) => {
        const items = folders.get(folder.path) ?? [];
        // Same contract as MemorySource: the cursor is a "seen this many" offset,
        // and its absence means a full listing.
        const start = cursor ? Math.max(0, Number(cursor.value) || 0) : 0;
        const reported = removals.get(folder.path) ?? [];
        return {
          items: items.slice(start),
          nextCursor: { value: String(items.length) },
          // A real server reports a removal once, on the poll after the delete,
          // and then the sync token moves past it. Consumed here for the same
          // reason: a harness that repeated it forever would hide a bug where the
          // loop only ever works because the report keeps coming back.
          ...(reported.length > 0 ? { removed: [...reported] } : {}),
        };
      },
      fetchRaw: async (o) => ({ raw: o.body, sizeBytes: o.body.length }),
      upsert: async (collectionId, raw, o, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${o.uid}`;
        const existed = target.has(at);
        target.set(at, raw as string);
        if (options?.overwrite) return { targetId: at, created: false, updated: true };
        if (existed) return { targetId: at, created: false, adopted: true };
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
          // The line under test. Without the href on the row there is no way back
          // from "this href is gone" to "this item is gone".
          ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        });
        return { targetId: at, created: true };
      },
      naturalKey: (o) => o.uid,
      sourceVersion: (o) => o.version,
      sourceRef: (o) => o.href,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => `t/${folder.path}`,
    });

  /** The server deletes an object: it leaves the collection and is reported once. */
  const deleteFromSource = (collection: string, uid: string) => {
    const items = folders.get(collection) ?? [];
    const gone = items.find((o) => o.uid === uid);
    folders.set(
      collection,
      items.filter((o) => o.uid !== uid),
    );
    if (gone) removals.set(collection, [...(removals.get(collection) ?? []), gone.href]);
  };

  /** What the server will report next poll, then forget. */
  const clearReports = () => removals.clear();

  return { folders, removals, target, run, deleteFromSource, clearReports };
}

describe('the source reports an object as removed', () => {
  it('is a confirmed deletion on the FIRST pass, with nothing removed from the target', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);

    expect((await w.run(ledger)).created).toBe(1);
    w.clearReports();

    w.deleteFromSource('Work', 'uid-1');
    const second = await w.run(ledger);

    // ONE pass, not two. Waiting for a second would not make the server's own
    // 404 truer — it would only make the owner hear about it later.
    expect(second.deletions).toEqual([
      {
        domain: 'calendar',
        naturalKeyHash: 'uid-1',
        collection: 'Work',
        absentPasses: 0,
        confirmed: true,
        evidence: 'reported',
      },
    ]);
    // Hard rule 2 and §11.1: the copy stays until a person decides.
    expect(w.target.has('t/Work:uid-1')).toBe(true);
  });

  it('records it, so it outlives the pass that noticed', async () => {
    // A report that lives only in the pass result is one an operator who was not
    // watching the container output at that moment never receives.
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    await w.run(ledger);
    w.clearReports();

    w.deleteFromSource('Work', 'uid-1');
    await w.run(ledger);

    const queued = await ledger.listDeletions(TENANT, MAPPING);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.evidence).toBe('reported');
    expect(queued[0]!.confirmed).toBe(true);
    expect(queued[0]!.reportedAt).toBeDefined();
    // Zero, and it means nothing here: the source named the object, so nothing
    // had to go missing for us to know. `evidence` is the field to read.
    expect(queued[0]!.absentPasses).toBe(0);
  });

  it('can be closed at once, unlike an absence seen only once', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    await w.run(ledger);
    w.clearReports();
    w.deleteFromSource('Work', 'uid-1');
    await w.run(ledger);

    expect(await ledger.resolveDeletion(TENANT, MAPPING, 'uid-1', 'keep')).toBe(true);
    // Decided, so it stops being reported — a queue that cannot be emptied is one
    // people stop reading.
    const after = await w.run(ledger);
    expect(after.deletions).toEqual([]);
  });

  it('reports once however many times the server repeats itself', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    await w.run(ledger);
    w.clearReports();

    w.deleteFromSource('Work', 'uid-1');
    // A server may keep reporting a removal until its sync token moves past it.
    await w.run(ledger);
    const first = (await ledger.listDeletions(TENANT, MAPPING))[0]!;
    const secondPass = await w.run(ledger);

    // Still reported (it is still gone, and nobody has decided), still ONE entry,
    // and the report date is the one from when we learned.
    expect(secondPass.deletions).toHaveLength(1);
    const queued = await ledger.listDeletions(TENANT, MAPPING);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.reportedAt).toBe(first.reportedAt);
  });

  it('reports the same item once when two hrefs lead to one row', async () => {
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    await w.run(ledger);
    w.clearReports();

    // A collection listed twice, or a server echoing a removal in two places.
    w.folders.set('Work', []);
    w.removals.set('Work', ['/cal/work/1.ics', '/cal/work/1.ics']);
    expect((await w.run(ledger)).deletions).toHaveLength(1);
  });
});

describe('what a removal report must NOT be read as', () => {
  it('a UID that turned up in another collection is a MOVE, not a deletion', async () => {
    // THE test. A moved event is reported as a removal from the old href and an
    // arrival at a new one. Reading the first half alone tells an owner their
    // data is gone while it is sitting in the next calendar along — which is why
    // removals are resolved only after every folder has been listed.
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    // Listed AFTER Work, so a per-folder implementation would already have
    // reported the deletion before ever seeing the arrival.
    w.folders.set('Personal', []);
    await w.run(ledger);
    w.clearReports();

    w.deleteFromSource('Work', 'uid-1');
    w.folders.set('Personal', [
      { uid: 'uid-1', href: '/cal/personal/1.ics', body: 'V1', version: 'e1' },
    ]);

    const second = await w.run(ledger);
    expect(second.deletions).toEqual([]);
    expect(second.moved).toBe(1);
    expect(second.moves).toEqual([
      { domain: 'calendar', naturalKeyHash: 'uid-1', from: 'Work', to: 'Personal' },
    ]);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });

  it('an href we never copied is not our business', async () => {
    // An object created and deleted between two of our passes, or one that was
    // never in scope. There is nothing on the target to reconcile, and inventing
    // a queue entry for it would ask an owner about data they never migrated.
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    await w.run(ledger);
    w.clearReports();

    w.removals.set('Work', ['/cal/work/never-seen.ics']);
    expect((await w.run(ledger)).deletions).toEqual([]);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });

  it('an item that is not on the target is not a deletion of anything', async () => {
    // A `failed` row is not a copy (see `isOnTarget`). The source deleting the
    // original changes nothing on our side, and reporting it would put an item
    // in the deletions queue that is already in the failures queue.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'uid-9',
      contentHash: '',
      targetId: '',
      createdAt: new Date().toISOString(),
      status: 'failed',
      collection: 'Work',
      sourceRef: '/cal/work/9.ics',
    });

    const w = world();
    w.folders.set('Work', []);
    w.removals.set('Work', ['/cal/work/9.ics']);
    expect((await w.run(ledger)).deletions).toEqual([]);
  });

  it('a row with no recorded href is never matched by an empty one', async () => {
    // `sourceRef` absent means "not recorded" — every row written before 0025,
    // and every mail item. Matching a blank against those would attach a removal
    // report to whichever legacy row came first, i.e. to the wrong item.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'uid-legacy',
      contentHash: 'h',
      targetId: 't',
      createdAt: new Date().toISOString(),
      status: 'copied',
      collection: 'Work',
    });

    const w = world();
    w.folders.set('Work', []);
    w.removals.set('Work', ['']);
    expect((await w.run(ledger)).deletions).toEqual([]);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });
});

describe('the item comes back', () => {
  it('drops the report, because a UID really can be re-created', async () => {
    // A declined invitation re-sent, a contact restored from a phone. The source
    // said it was gone and now demonstrably has it, and a stale claim of deletion
    // is the most dangerous thing to leave on a row: it is the one piece of
    // evidence strong enough to ever act on.
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    await w.run(ledger);
    w.clearReports();

    w.deleteFromSource('Work', 'uid-1');
    expect((await w.run(ledger)).deletions).toHaveLength(1);
    w.clearReports();

    // Back, at a NEW href — which is what a re-creation looks like. The recorded
    // href is now stale, so a future removal report for this object will not
    // match and it falls back to absence-counting; that is a degradation to the
    // weaker signal, not a wrong answer.
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1b.ics', body: 'V1', version: 'e1' }]);
    const third = await w.run(ledger);

    expect(third.deletions).toEqual([]);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
    // And nothing was copied again: the natural key still matches the row.
    expect(third.created).toBe(0);
  });

  it('clears the report even for an item the pass reports as MOVED', async () => {
    // The clear has to happen before the branching, because `moved` returns
    // early. An item that went missing and then reappeared in another collection
    // is one event, not a deletion plus a move.
    const ledger = new MemoryLedger();
    const w = world();
    w.folders.set('Work', [{ uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' }]);
    w.folders.set('Personal', []);
    await w.run(ledger);
    w.clearReports();

    // Vanishes with no report at all — the absence-counting path — then comes
    // back somewhere else.
    w.folders.set('Work', []);
    await ledger.recordAbsent(TENANT, MAPPING, 'calendar', 'uid-1');
    await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', 'uid-1');
    expect(await ledger.listDeletions(TENANT, MAPPING)).toHaveLength(1);

    w.folders.set('Personal', [
      { uid: 'uid-1', href: '/cal/personal/1.ics', body: 'V1', version: 'e1' },
    ]);
    const third = await w.run(ledger);

    expect(third.moved).toBe(1);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });
});

describe('an incremental pass', () => {
  it('still believes a removal report when the key set is incomplete', async () => {
    // Absence-based detection is gated on a COMPLETE key set, and must be: a
    // cursor-limited listing returns what changed, so nearly everything the
    // ledger holds would look absent. A removal report needs nothing of the
    // kind — the server named the object. Gating this the same way would discard
    // the signal on every pass that has a cursor, which in production is all of
    // them but the first.
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const w = world();
    w.folders.set('Work', [
      { uid: 'uid-1', href: '/cal/work/1.ics', body: 'V1', version: 'e1' },
      { uid: 'uid-2', href: '/cal/work/2.ics', body: 'V2', version: 'e2' },
    ]);

    expect((await w.run(ledger, cursors)).created).toBe(2);
    w.clearReports();

    w.deleteFromSource('Work', 'uid-1');
    const second = await w.run(ledger, cursors);

    // The pass listed nothing (the cursor has seen everything) and still reports
    // the deletion, on the strength of the report alone.
    expect(second.scanned).toBe(0);
    expect(second.deletions).toHaveLength(1);
    expect(second.deletions[0]!.naturalKeyHash).toBe('uid-1');
    // uid-2 was not listed either, and nothing was said about it. Absence is not
    // evidence.
    expect(second.deletions.map((d) => d.naturalKeyHash)).not.toContain('uid-2');
  });
});

describe('the two kinds of evidence stay apart', () => {
  it('an inferred deletion still has to repeat, and says so', async () => {
    // The file domain, where there is no removal report at all: WebDAV has no
    // sync-collection. This is the contrast that makes `evidence` worth carrying
    // — same queue, same shape, a much weaker claim.
    const ledger = new MemoryLedger();
    const files = new Map<string, string[]>();
    files.set('/', ['a.txt', 'b.txt']);

    const runFiles = () =>
      runDomainSync<unknown, unknown, { path: string }, { path: string }>({
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        source: {},
        target: {},
        ledger,
        listFolders: async () => [{ path: '/' }],
        listSince: async (folder) => ({
          items: (files.get(folder.path) ?? []).map((path) => ({ path })),
          nextCursor: { value: '' },
        }),
        fetchRaw: async (f) => ({ raw: f.path, sizeBytes: f.path.length }),
        upsert: async (collectionId, raw, f): Promise<UpsertResult> => {
          const at = `${collectionId}:${f.path}`;
          await ledger.recordIfAbsent({
            tenantId: TENANT,
            mappingId: MAPPING,
            itemType: 'file',
            naturalKeyHash: f.path,
            contentHash: `h:${raw as string}`,
            targetId: at,
            createdAt: new Date().toISOString(),
            status: 'copied',
            collection: '/',
          });
          return { targetId: at, created: true };
        },
        naturalKey: (f) => f.path,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async (folder) => `t${folder.path}`,
      });

    await runFiles();
    files.set('/', ['b.txt']);

    // First absence: watched, not reported.
    const second = await runFiles();
    expect(second.drift).toBe(1);
    expect(second.deletions).toEqual([]);

    // Second consecutive absence: now it is worth saying out loud — and it is
    // labelled as the inference it is.
    const third = await runFiles();
    expect(third.deletions).toHaveLength(1);
    expect(third.deletions[0]).toMatchObject({
      naturalKeyHash: 'a.txt',
      evidence: 'inferred',
      confirmed: true,
      absentPasses: DELETION_CONFIRMATIONS,
    });
  });
});
