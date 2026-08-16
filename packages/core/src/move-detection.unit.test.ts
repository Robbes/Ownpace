// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What happens when someone reorganises the SOURCE after the migration has
 * started — drags a file into another folder, files a message, moves an event
 * to a second calendar.
 *
 * Until this existed, the answer depended on how the domain is keyed, and both
 * answers were wrong in a way nobody could see:
 *
 *   - **Stable-key domains** (calendar, contacts, mail) key on a UID or a
 *     Message-ID, which survives the move. The ledger fast-path HIT, the loop
 *     counted a skip, and the item stayed in whatever target collection it was
 *     first copied into. Source and target diverged permanently and the pass
 *     reported a clean `skipped`.
 *
 *   - **The file domain** keys on the PATH (`file:<path>`), so a move changes
 *     the natural key. The fast-path MISSED, the loop copied the file again
 *     under its new path, and — since nothing is ever deleted from a target
 *     (hard rule 2) — the old copy stayed exactly where it was. One drag
 *     produced two files, and every later pass kept both.
 *
 * Neither is fixed by writing harder. §11.1 splits authority: the source owns
 * an item's CONTENT, the owner owns its TOPOLOGY and lifecycle. So the pass
 * detects the divergence, reports it, and touches nothing.
 *
 * The foundation under all of it is that a ledger row now records WHICH SOURCE
 * COLLECTION the item came from. The column has existed since migration 0001
 * and nothing ever wrote it, so every row carried `''` — the ledger could say
 * what had been migrated and never where it came from, which is precisely the
 * fact a move consists of.
 */

import { describe, it, expect } from 'vitest';
import { classifyKnownItem, runDomainSync } from './domain-sync';
import { applyRelocation } from './apply-deletion';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory';
import { asTenantId, asMappingId, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('7c220000-e29b-41d4-a716-4466554401aa');
const MAPPING = asMappingId('7c220000-e29b-41d4-a716-4466554401bb');

describe('classifyKnownItem: topology', () => {
  it('reports a move when the source lists the item in a different collection', () => {
    expect(
      classifyKnownItem(
        { status: 'copied', collection: 'Work', sourceVersion: 'etag-1' },
        'etag-1',
        'Personal',
      ),
    ).toBe('moved');
  });

  it('outranks the version rules: a move that also changed content is still a move', () => {
    // Rewriting would answer the CONTENT question (§11.1: the source is
    // authoritative) while silently ignoring the topology one, leaving the
    // rewritten bytes in the old collection and calling that success.
    expect(
      classifyKnownItem(
        { status: 'copied', collection: 'Work', sourceVersion: 'etag-1' },
        'etag-2',
        'Personal',
      ),
    ).toBe('moved');
  });

  it('does NOT read an unrecorded collection as a move', () => {
    // Every row written before this change carries `''` because nothing ever
    // populated the column. Treating that as "the empty-named folder" would
    // declare a whole migrated corpus moved on the first pass after upgrading
    // — thousands of warnings describing nothing that happened.
    expect(
      classifyKnownItem({ status: 'copied', collection: '', sourceVersion: 'e' }, 'e', 'Personal'),
    ).toBe('skip');
    expect(classifyKnownItem({ status: 'copied', sourceVersion: 'e' }, 'e', 'Personal')).toBe(
      'skip',
    );
  });

  it('does not read an empty CURRENT collection as a move either', () => {
    // The mirror of the case above, on the other operand.
    //
    // Found by mutation on 2026-08-07: deleting `collection !== ''` from the
    // move guard survived all 1733 unit tests, the only survivor of 14
    // mutations across this function. It survived for a defensible reason —
    // `runDomainSync` computes `folder.path ? folder.path : folder.name ? ... :
    // '/'`, so the one production call site can never pass `''` — which makes
    // this a guard rather than a live defect, and it is recorded that way.
    //
    // Pinned anyway because the function is EXPORTED and the two halves are
    // symmetric: an unknown collection is not evidence of a move whichever side
    // it is unknown on, and the next caller should not have to rediscover which
    // half was load-bearing.
    expect(
      classifyKnownItem({ status: 'copied', collection: 'Work', sourceVersion: 'e' }, 'e', ''),
    ).toBe('skip');
  });

  it('does not guess when the caller cannot say where the item is now', () => {
    // The parameter is optional so call sites written before move detection
    // keep their exact behaviour rather than acquiring a new one silently.
    expect(
      classifyKnownItem({ status: 'copied', collection: 'Work', sourceVersion: 'e' }, 'e'),
    ).toBe('skip');
  });

  it('keeps the failure states ahead of it', () => {
    // An item that failed in Work and now sits in Personal has never been
    // copied anywhere. Retrying it puts it on the target under the collection
    // it is actually in; calling it a move would park real data forever on the
    // strength of a folder name.
    expect(
      classifyKnownItem(
        { status: 'failed', attemptCount: 1, collection: 'Work', sourceVersion: 'e' },
        'e',
        'Personal',
      ),
    ).toBe('retry-failed');
    expect(
      classifyKnownItem({ status: 'left_behind', collection: 'Work', sourceVersion: 'e' }, 'e', 'P'),
    ).toBe('left-behind');
  });
});

/** One source item. `key` is the natural key — for files, that IS the path. */
interface Item {
  readonly key: string;
  readonly body: string;
  readonly version?: string;
}

/**
 * A source whose folders can be rearranged between passes, wired to a target
 * that records its own ledger rows.
 *
 * The fake writer records the row ITSELF, exactly as all three real DAV writers
 * do ("`recordIfAbsent` makes the first writer win, and that is this one").
 * That awkwardness is the point: a harness where only the loop records would
 * pass while the collection never reached a single row in production — the
 * same shape of bug that let `sourceVersion` be silently dropped for a whole
 * release.
 */
function world(domain: 'calendar' | 'file', opts?: { listKeys?: boolean }) {
  const folders = new Map<string, Item[]>();
  /** Everything actually on the target, keyed by where it landed. */
  const target = new Map<string, string>();
  /** How many times the source was asked to enumerate a collection. */
  let keyListings = 0;

  const run = (ledger: MemoryLedger, cursors?: MemoryCursorStore) =>
    runDomainSync<unknown, unknown, Item, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain,
      source: {},
      target: {},
      ledger,
      ...(cursors ? { cursors } : {}),
      listFolders: async () => [...folders.keys()].map((path) => ({ path })),
      listSince: async (folder, cursor) => {
        const items = folders.get(folder.path) ?? [];
        // Same contract as MemorySource: the cursor is a "seen this many"
        // offset, and its absence means a full listing.
        const start = cursor ? Math.max(0, Number(cursor.value) || 0) : 0;
        return { items: items.slice(start), nextCursor: { value: String(items.length) } };
      },
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
      upsert: async (collectionId, raw, i, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${i.key}`;
        const existed = target.has(at);
        target.set(at, raw as string);
        if (options?.overwrite) return { targetId: at, created: false, updated: true };
        if (existed) return { targetId: at, created: false, adopted: true };
        await ledger.recordIfAbsent({
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: domain,
          naturalKeyHash: i.key,
          contentHash: `h:${raw as string}`,
          targetId: at,
          createdAt: new Date().toISOString(),
          sizeBytes: (raw as string).length,
          status: 'copied',
          ...(options?.sourceVersion !== undefined ? { sourceVersion: options.sourceVersion } : {}),
          // The line under test. Without it the loop's own record is discarded
          // by `recordIfAbsent` and every row keeps the `''` it has carried
          // since 0001.
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
          // The real writers persist this too — same `recordIfAbsent` race.
          ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        });
        return { targetId: at, created: true };
      },
      sourceVersion: (i) => i.version,
      // The cheap whole-collection listing a real WebDAV source answers from
      // the PROPFIND it already makes. Without it the loop can only tell what
      // a cursor-limited pass listed, which is what changed — never what is
      // there.
      ...(opts?.listKeys
        ? {
            listCollectionKeys: async (folder: { path: string }) => {
              keyListings += 1;
              return (folders.get(folder.path) ?? []).map((i) => i.key);
            },
          }
        : {}),
      naturalKey: (i) => i.key,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => `t/${folder.path}`,
    });

  return { folders, target, run, keyListings: () => keyListings };
}

describe('a stable-key item moved between source collections', () => {
  it('is reported, and nothing on the target is written or removed', async () => {
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'BEGIN:VEVENT', version: 'etag-1' }]);
    w.folders.set('Personal', []);

    const first = await w.run(ledger);
    expect(first.created).toBe(1);
    expect(first.moved).toBe(0);
    expect([...w.target.keys()]).toEqual(['t/Work:uid-1']);

    // The owner drags the event into the other calendar. Same UID, same bytes.
    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'BEGIN:VEVENT', version: 'etag-1' }]);

    const second = await w.run(ledger);
    expect(second.moved).toBe(1);
    expect(second.moves).toEqual([
      { domain: 'calendar', naturalKeyHash: 'uid-1', from: 'Work', to: 'Personal' },
    ]);
    // Untouched: no second copy in Personal, and the original still in Work.
    // Writing it into Personal without removing the Work copy would duplicate;
    // removing the Work copy is the delete half of a move, which hard rule 2
    // forbids outright. So neither, and the operator is told.
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect([...w.target.keys()]).toEqual(['t/Work:uid-1']);
  });

  it('keeps reporting it while the divergence lasts', async () => {
    // The ledger row deliberately still points at the OLD collection, because
    // that is where the target copy actually is. Updating it would make the
    // divergence vanish from the report while the target stayed just as wrong.
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    expect((await w.run(ledger)).moved).toBe(1);
    expect((await w.run(ledger)).moved).toBe(1);
  });

  it('is written down, so it survives the pass that noticed it', async () => {
    // The report used to live only in the pass result: counted, logged, gone.
    // An operator who was not reading the container output at that moment never
    // learned, and there was no way to come back to it.
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);

    expect(await ledger.listMoves(TENANT, MAPPING)).toEqual([
      {
        domain: 'calendar',
        naturalKeyHash: 'uid-1',
        from: 'Work',
        to: 'Personal',
        // When the report was made (0013) — the queue's age column.
        recordedAt: expect.any(String),
      },
    ]);
  });

  it('stops reporting once the owner has decided, and stays in the record', async () => {
    // A queue nobody can quiet is one people stop reading — which is how a real
    // divergence goes unnoticed among a hundred already-decided ones.
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);
    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    expect((await w.run(ledger)).moved).toBe(1);

    expect(await ledger.resolveMove(TENANT, MAPPING, 'uid-1', 'keep')).toBe(true);

    const after = await w.run(ledger);
    expect(after.moved).toBe(0);
    expect(after.moves).toEqual([]);
    // Quiet, not forgotten: the decision is the audit trail (§11.2), and the
    // divergence itself is still real.
    const recorded = await ledger.listMoves(TENANT, MAPPING);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.acknowledgedAt).toBeDefined();
  });

  it('asks again when the same item moves somewhere NEW', async () => {
    // Agreeing to one arrangement is not agreeing to every later one.
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    w.folders.set('Personal', []);
    w.folders.set('Archive', []);
    await w.run(ledger);

    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);
    await ledger.resolveMove(TENANT, MAPPING, 'uid-1', 'keep');

    w.folders.set('Personal', []);
    w.folders.set('Archive', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    const third = await w.run(ledger);
    expect(third.moved).toBe(1);
    expect(third.moves[0]).toMatchObject({ from: 'Work', to: 'Archive' });
  });

  it('forgets the move when the item is put back', async () => {
    // An entry that outlived its cause has people acting on a layout that has
    // already been restored.
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    w.folders.set('Personal', []);
    await w.run(ledger);

    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    expect((await w.run(ledger)).moved).toBe(1);

    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    w.folders.set('Personal', []);
    const third = await w.run(ledger);
    expect(third.moved).toBe(0);
    expect(await ledger.listMoves(TENANT, MAPPING)).toEqual([]);
  });

  it('will not acknowledge a move that is not open', async () => {
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);
    // Never moved: there is nothing to decide about, and saying "done" would
    // report a decision that did not happen.
    expect(await ledger.resolveMove(TENANT, MAPPING, 'uid-1', 'keep')).toBe(false);

    w.folders.set('Work', []);
    w.folders.set('Personal', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);
    expect(await ledger.resolveMove(TENANT, MAPPING, 'uid-1', 'keep')).toBe(true);
    // Twice is not a second decision.
    expect(await ledger.resolveMove(TENANT, MAPPING, 'uid-1', 'keep')).toBe(false);
  });

  it('says nothing about an item that has not moved', async () => {
    const ledger = new MemoryLedger();
    const w = world('calendar');
    w.folders.set('Work', [{ key: 'uid-1', body: 'V', version: 'e1' }]);
    await w.run(ledger);
    const second = await w.run(ledger);
    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
  });
});

describe('a file moved between source folders', () => {
  it('is correlated by content across the whole scan and reported', async () => {
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF-BYTES', version: 'e1' }]);
    w.folders.set('b', []);

    const first = await w.run(ledger);
    expect(first.created).toBe(1);
    expect(first.moved).toBe(0);
    expect(first.drift).toBe(0);

    // The drag. The path is the natural key, so this is a brand-new item as
    // far as the ledger fast-path can tell.
    w.folders.set('a', []);
    w.folders.set('b', [{ key: 'b/report.pdf', body: 'PDF-BYTES', version: 'e1' }]);

    const second = await w.run(ledger);
    expect(second.moved).toBe(1);
    expect(second.moves).toEqual([
      {
        domain: 'file',
        naturalKeyHash: 'a/report.pdf',
        from: 'a',
        to: 'b',
        // The key it went to, which is what makes this a RELOCATION rather than
        // a move somebody can only acknowledge (ADR-0030).
        toNaturalKeyHash: 'b/report.pdf',
      },
    ]);
    // Honest about the cost of detecting it after the fact: the disappearance
    // is only knowable once every folder has been listed, and by then the copy
    // exists. The target really does hold both, which is why the operator is
    // told rather than left to find it months later.
    expect(second.created).toBe(1);
    expect([...w.target.keys()].sort()).toEqual(['t/a:a/report.pdf', 't/b:b/report.pdf']);
    expect(second.drift).toBe(0);
  });

  it('is written down and can be closed, on its own separate code path', async () => {
    // The file half is detected after the fact, against a different row from
    // the one the loop was looking at, so it persists and resolves through its
    // own code — worth proving rather than assuming from the calendar case.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF', version: 'e1' }]);
    w.folders.set('b', []);
    await w.run(ledger);

    w.folders.set('a', []);
    w.folders.set('b', [{ key: 'b/report.pdf', body: 'PDF', version: 'e1' }]);
    expect((await w.run(ledger)).moved).toBe(1);

    expect(await ledger.listMoves(TENANT, MAPPING, 'file')).toEqual([
      {
        domain: 'file',
        naturalKeyHash: 'a/report.pdf',
        from: 'a',
        to: 'b',
        toNaturalKeyHash: 'b/report.pdf',
        // When the report was made (0013) — the queue's age column.
        recordedAt: expect.any(String),
      },
    ]);

    expect(await ledger.resolveMove(TENANT, MAPPING, 'a/report.pdf', 'keep')).toBe(true);
    const third = await w.run(ledger);
    expect(third.moved).toBe(0);
    // And it must NOT quietly become drift instead — the disappearance is
    // explained, someone decided, and there is nothing left to report.
    expect(third.drift).toBe(0);
  });

  it('calls a disappearance with no matching arrival drift, not a move', async () => {
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/gone.txt', body: 'BYTES', version: 'e1' }]);
    w.folders.set('b', []);
    await w.run(ledger);

    // Deleted on the source. §11.1: deletions are NEVER auto-propagated, so
    // the target copy stays and the fact is reported instead.
    w.folders.set('a', []);

    const second = await w.run(ledger);
    expect(second.drift).toBe(1);
    expect(second.moved).toBe(0);
    expect([...w.target.keys()]).toEqual(['t/a:a/gone.txt']);
  });

  it('does not let one arrival explain several disappearances', async () => {
    // Three identical files removed and one added is one move and two
    // deletions. Matching the arrival against all three would report three
    // moves and no deletions — the opposite of what happened.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [
      { key: 'a/1.txt', body: 'SAME', version: 'e1' },
      { key: 'a/2.txt', body: 'SAME', version: 'e1' },
      { key: 'a/3.txt', body: 'SAME', version: 'e1' },
    ]);
    w.folders.set('b', []);
    await w.run(ledger);

    w.folders.set('a', []);
    w.folders.set('b', [{ key: 'b/1.txt', body: 'SAME', version: 'e1' }]);

    const second = await w.run(ledger);
    expect(second.moved).toBe(1);
    expect(second.drift).toBe(2);
  });

  it('sees a whole folder renamed, which the source no longer lists at all', async () => {
    // The case that made this read the ledger for the whole domain rather than
    // for the collections the pass happened to scan. A renamed folder is simply
    // absent from `listFolders`, so a per-collection query would never look at
    // its rows: every file under it would be re-copied under the new folder
    // while the report stayed empty — the largest reorganisation there is,
    // invisible.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('Q1', [
      { key: 'Q1/a.txt', body: 'AAA', version: 'e1' },
      { key: 'Q1/b.txt', body: 'BBB', version: 'e1' },
    ]);
    const first = await w.run(ledger);
    expect(first.created).toBe(2);

    // The owner renames Q1 to Quarter-1. Same files, same bytes, new paths —
    // and the old folder does not exist any more.
    w.folders.delete('Q1');
    w.folders.set('Quarter-1', [
      { key: 'Quarter-1/a.txt', body: 'AAA', version: 'e1' },
      { key: 'Quarter-1/b.txt', body: 'BBB', version: 'e1' },
    ]);

    const second = await w.run(ledger);
    expect(second.moved).toBe(2);
    expect(second.moves.map((m) => `${m.from}->${m.to}`)).toEqual([
      'Q1->Quarter-1',
      'Q1->Quarter-1',
    ]);
    expect(second.drift).toBe(0);
  });

  it('sees a RENAME IN PLACE as a relocation, not a deletion (ADR-0030)', async () => {
    // Until ADR-0030 the correlation required a DIFFERENT collection, so the
    // commonest reorganisation there is went undetected: same folder, new name
    // became an unexplained absence and — two clean scans later — a reported
    // DELETION of a file plainly still there under another name. That report
    // was not merely wrong, it was unusable: `apply` refuses `inferred`
    // evidence outright (ADR-0024 gate 3), so the owner's only action left the
    // target holding both copies forever.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF-BYTES', version: 'e1' }]);
    await w.run(ledger);

    // Same folder, same bytes, new name.
    w.folders.set('a', [{ key: 'a/summary.pdf', body: 'PDF-BYTES', version: 'e1' }]);

    const second = await w.run(ledger);
    expect(second.moved).toBe(1);
    expect(second.moves).toEqual([
      {
        domain: 'file',
        naturalKeyHash: 'a/report.pdf',
        // Both ends of the FOLDER are the same, which is exactly why the
        // collection could never describe this. The key is what changed.
        from: 'a',
        to: 'a',
        toNaturalKeyHash: 'a/summary.pdf',
      },
    ]);
    expect(second.drift, 'a rename is explained, so it is not drift').toBe(0);

    // And it stays explained. Nothing accumulates towards a phantom deletion,
    // however many passes run.
    const third = await w.run(ledger);
    expect(third.deletions).toEqual([]);
    expect(third.drift).toBe(0);

    // The target still holds both — detection changes nothing there. What is
    // new is that the owner now has something to press: the recorded arrival
    // key is what `applyRelocation` checks before removing the old copy.
    expect([...w.target.keys()].sort()).toEqual(['t/a:a/report.pdf', 't/a:a/summary.pdf']);
  });

  it('still reports a rename ONCE, and stops when the owner has decided', async () => {
    // The queue has to be emptiable, and the remembered-relocation path is a
    // second place that could reopen it. A rename re-reported every pass after
    // a `keep` would make this queue the thing people stop reading.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('a', [{ key: 'a/summary.pdf', body: 'PDF', version: 'e1' }]);
    expect((await w.run(ledger)).moved).toBe(1);

    expect(await ledger.resolveMove(TENANT, MAPPING, 'a/report.pdf', 'keep')).toBe(true);

    const third = await w.run(ledger);
    expect(third.moved).toBe(0);
    expect(third.drift, 'a decided rename must not degrade into drift').toBe(0);
  });

  it('stops reporting a relocation once it has been APPLIED', async () => {
    // The point of the whole feature, end to end: detect, apply, and the queue
    // is empty. A row that kept reporting after its copy was removed would put
    // an action in front of somebody that can only fail — and one that
    // degraded into DRIFT instead would start counting towards a deletion of
    // an item this product has already dealt with.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('a', [{ key: 'a/summary.pdf', body: 'PDF', version: 'e1' }]);
    expect((await w.run(ledger)).moved).toBe(1);

    const outcome = await applyRelocation(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger,
        target: {
          removeItem: async () => ({ kind: 'deleted' as const }),
          // The destructive path asks the target whether the RELOCATED copy is
          // really there before removing the old one (ADR-0030, amended); a
          // target that cannot answer is refused.
          hasItem: async () => true,
        },
        allowApplyDeletions: true,
      },
      'a/report.pdf',
    );
    expect(outcome).toEqual({ ok: true, kind: 'deleted' });

    const third = await w.run(ledger);
    expect(third.moved, 'the decision was carried out; there is nothing left to report').toBe(0);
    expect(third.drift, 'and it must not become drift either').toBe(0);
    expect(third.deletions).toEqual([]);

    // The entry does not vanish — it becomes HISTORY, which is what the
    // "already decided" half of the queue is for and what `keep` does too. The
    // row is the audit trail: this item existed, it was relocated, and its old
    // copy was removed on this date by this decision.
    const moves = await ledger.listMoves(TENANT, MAPPING, 'file');
    expect(moves).toHaveLength(1);
    expect(moves[0]?.acknowledgedAt, 'closed, so no screen offers it again').toBeDefined();
  });

  it('reopens the decision when the file is renamed AGAIN in the same folder', async () => {
    // The acknowledgement is per DESTINATION, and for a rename the destination
    // is the key: the folder never changes. Comparing folders alone would let a
    // decision about the first new name stand over a second nobody has seen.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/v1.txt', body: 'SAME', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('a', [{ key: 'a/v2.txt', body: 'SAME', version: 'e1' }]);
    await w.run(ledger);
    expect(await ledger.resolveMove(TENANT, MAPPING, 'a/v1.txt', 'keep')).toBe(true);

    // Renamed again. The original row's move now points somewhere else.
    w.folders.set('a', [{ key: 'a/v3.txt', body: 'SAME', version: 'e1' }]);
    const fourth = await w.run(ledger);

    expect(fourth.moves.map((m) => m.toNaturalKeyHash)).toContain('a/v3.txt');
  });

  it('does not report rows that never recorded a collection as vanished', async () => {
    // The first full scan after upgrading meets a ledger full of rows written
    // before the column was populated. They cannot say where they came from, so
    // they take no part in this — otherwise upgrading would report a healthy
    // migrated corpus as mass deletion.
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'file',
      naturalKeyHash: 'legacy/old.txt',
      contentHash: 'h:LEGACY',
      targetId: 't/legacy',
      createdAt: new Date().toISOString(),
      sizeBytes: 6,
      status: 'copied',
    });

    const w = world('file');
    w.folders.set('a', []);
    const pass = await w.run(ledger);
    expect(pass.drift).toBe(0);
    expect(pass.moved).toBe(0);
  });

  it('is found on an ORDINARY incremental pass when the source can list its keys', async () => {
    // The difference between a feature and a decoration. Production always
    // configures cursors, so gating detection on "no cursor" meant it could
    // fire on the very first pass and never again — for the one domain where
    // a move actually duplicates data.
    //
    // `listCollectionKeys` closes it: one extra listing per folder, paths only,
    // which a real WebDAV source answers from the PROPFIND it already makes.
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const w = world('file', { listKeys: true });
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF-BYTES', version: 'e1' }]);
    w.folders.set('b', []);
    await w.run(ledger, cursors);
    expect(w.keyListings()).toBeGreaterThan(0);

    w.folders.set('a', []);
    w.folders.set('b', [{ key: 'b/report.pdf', body: 'PDF-BYTES', version: 'e1' }]);

    const second = await w.run(ledger, cursors);
    expect(second.moved).toBe(1);
    expect(second.moves[0]).toMatchObject({ from: 'a', to: 'b' });
  });

  it('reports nothing when the key listing fails, rather than failing the pass', async () => {
    // This listing moves no data — it only decides whether a move can be told
    // from a deletion. Failing the whole migration because a diagnostic
    // PROPFIND hiccuped would trade a real copy for a report; reporting the
    // collection as vanished would be worse still.
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/x.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger, cursors);

    const broken = world('file', { listKeys: true });
    broken.folders.set('a', []);
    const result = await runDomainSync<unknown, unknown, Item, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      cursors,
      listFolders: async () => [{ path: 'a' }],
      listSince: async () => ({ items: [], nextCursor: { value: '0' } }),
      listCollectionKeys: async () => {
        throw new Error('PROPFIND 503');
      },
      fetchRaw: async () => ({ raw: '', sizeBytes: 0 }),
      upsert: async () => ({ targetId: 'x', created: true }),
      naturalKey: (i) => i.key,
      contentHash: () => 'h',
      ensureCollection: async () => 't/a',
    });

    expect(result.failed).toBe(0);
    expect(result.moved).toBe(0);
    expect(result.drift).toBe(0);
  });

  it('detects a move out of the ROOT collection, whose path is legitimately empty', async () => {
    // A WebDAV connection's own root reports `path: ''`, and '' is the value
    // the ledger reads as "collection never recorded". Left alone, every file
    // sitting directly in the user's file root — the commonest layout there is,
    // and the one the e2e seeds — was recorded as having no collection and
    // could never be reported as moved. The whole feature was inert for the
    // majority of files, and nothing said so.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('', [{ key: 'report.pdf', body: 'PDF', version: 'e1' }]);
    w.folders.set('archive', []);

    const first = await w.run(ledger);
    expect(first.created).toBe(1);
    const row = await ledger.find(TENANT, MAPPING, 'file', 'report.pdf');
    expect(row?.collection, 'the root needs a name of its own, not the empty string').toBe('/');

    w.folders.set('', []);
    w.folders.set('archive', [{ key: 'archive/report.pdf', body: 'PDF', version: 'e1' }]);

    const second = await w.run(ledger);
    expect(second.moved).toBe(1);
    expect(second.moves[0]).toMatchObject({ from: '/', to: 'archive' });
  });

  it('does not call one absence a deletion', async () => {
    // We never observe a deletion, only an absence — and absence has innocent
    // causes that all look identical: a folder briefly missing from discovery,
    // a throttled listing, a connector having a bad ten minutes. Believing the
    // first one is how a source with a bad afternoon becomes a queue full of
    // deletions somebody might act on.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/gone.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('a', []);
    const second = await w.run(ledger);
    expect(second.drift, 'the absence is observed').toBe(1);
    expect(second.deletions, 'but not yet reported to anyone').toEqual([]);

    // Twice in a row is the threshold.
    const third = await w.run(ledger);
    expect(third.deletions).toHaveLength(1);
    expect(third.deletions[0]).toMatchObject({
      domain: 'file',
      naturalKeyHash: 'a/gone.txt',
      collection: 'a',
      confirmed: true,
    });
  });

  it('resets the count when the item comes back, so the run must be CONSECUTIVE', async () => {
    // Without the reset a flaky collection accumulates its way to "confirmed
    // deleted" over a month of unrelated hiccups, none of them adjacent.
    const ledger = new MemoryLedger();
    const w = world('file');
    const file = { key: 'a/flaky.txt', body: 'BYTES', version: 'e1' };
    w.folders.set('a', [file]);
    await w.run(ledger);

    w.folders.set('a', []);
    await w.run(ledger);

    // It reappears — a listing hiccup, not a deletion.
    w.folders.set('a', [file]);
    await w.run(ledger);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);

    // Gone again: this is absence number one of a NEW run, not number two.
    w.folders.set('a', []);
    const after = await w.run(ledger);
    expect(after.deletions, 'the earlier absence must not count towards this run').toEqual([]);
  });

  it('stops reporting once the owner has decided, and stays in the record', async () => {
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/gone.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);
    w.folders.set('a', []);
    await w.run(ledger);
    await w.run(ledger);

    expect(await ledger.resolveDeletion(TENANT, MAPPING, 'a/gone.txt', 'keep')).toBe(true);

    const after = await w.run(ledger);
    expect(after.deletions).toEqual([]);
    // Quiet, not forgotten — §11.2 wants the decision on the record.
    const recorded = await ledger.listDeletions(TENANT, MAPPING);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.acknowledgedAt).toBeDefined();
  });

  it('will not let anyone decide about an absence that is only being watched', async () => {
    // Closing it early would retire the very check that makes the claim
    // trustworthy.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/gone.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);
    w.folders.set('a', []);
    await w.run(ledger);

    expect(await ledger.resolveDeletion(TENANT, MAPPING, 'a/gone.txt', 'keep')).toBe(false);
  });

  it('never reports a MOVED item as deleted', async () => {
    // The disappearance is explained. Reporting it in both queues would have
    // the owner deciding twice about one event, with the deletions queue
    // implying data loss that did not happen.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF', version: 'e1' }]);
    w.folders.set('b', []);
    await w.run(ledger);

    w.folders.set('a', []);
    w.folders.set('b', [{ key: 'b/report.pdf', body: 'PDF', version: 'e1' }]);
    const second = await w.run(ledger);
    const third = await w.run(ledger);

    expect(second.moved).toBe(1);
    expect(second.deletions).toEqual([]);
    expect(third.deletions, 'still a move on the pass after, not a deletion').toEqual([]);
    expect(await ledger.listDeletions(TENANT, MAPPING)).toEqual([]);
  });

  it('stays silent on a cursor-limited pass, which cannot tell absence from unlisted', async () => {
    // THE dangerous false positive. An incremental listing returns only what
    // changed, so nearly every key the ledger holds looks absent — a routine
    // pass over an untouched corpus would report the whole thing as moved or
    // deleted, and the operator would be handed a five-figure warning about
    // nothing.
    const ledger = new MemoryLedger();
    const cursors = new MemoryCursorStore();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'PDF-BYTES', version: 'e1' }]);
    w.folders.set('b', []);
    await w.run(ledger, cursors);

    // The cursor now says "one item seen in a", so the next listing of `a`
    // returns nothing at all — indistinguishable from the file being gone.
    const second = await w.run(ledger, cursors);
    expect(second.moved).toBe(0);
    expect(second.drift).toBe(0);
  });
});

describe('a removed copy takes no further part', () => {
  it('does not let an ALREADY-REMOVED row compete for arrivals', async () => {
    // `placedItems` keeps tombstoned rows on purpose — the mass-deletion
    // breaker's denominator needs them. Letting one compete here has it steal
    // the correlation that explains a LIVE rename, and re-open a destructive
    // queue entry for a decision somebody already carried out.
    const ledger = new MemoryLedger();
    const w = world('file');
    // DISTINCT bytes per file: identical content is refused by the apply's
    // ambiguity gate, and rightly — which one moved would be a guess.
    w.folders.set('a', [
      { key: 'a/one.txt', body: 'ONE', version: 'e1' },
      { key: 'a/two.txt', body: 'TWO', version: 'e1' },
    ]);
    await w.run(ledger);

    // `one` is renamed; the owner applies the relocation, so its row is
    // tombstoned and its copy is gone.
    w.folders.set('a', [
      { key: 'a/one-renamed.txt', body: 'ONE', version: 'e1' },
      { key: 'a/two.txt', body: 'TWO', version: 'e1' },
    ]);
    await w.run(ledger);
    await applyRelocation(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'file',
        ledger,
        target: {
          removeItem: async () => ({ kind: 'deleted' as const }),
          // The destructive path asks the target whether the RELOCATED copy is
          // really there before removing the old one (ADR-0030, amended); a
          // target that cannot answer is refused.
          hasItem: async () => true,
        },
        allowApplyDeletions: true,
      },
      'a/one.txt',
    );

    // Now `two` is renamed. The tombstoned row must not take that arrival.
    w.folders.set('a', [
      { key: 'a/one-renamed.txt', body: 'ONE', version: 'e1' },
      { key: 'a/two-renamed.txt', body: 'TWO', version: 'e1' },
    ]);
    const third = await w.run(ledger);

    expect(third.moves.map((m) => m.naturalKeyHash)).toEqual(['a/two.txt']);
    expect(third.moves[0]?.toNaturalKeyHash).toBe('a/two-renamed.txt');
  });

});

describe('an explained disappearance takes no further part either', () => {
  it('a row that already knows where it went does not claim a LATER arrival', async () => {
    // The same theft as above, from a row that is merely explained rather than
    // tombstoned — and this one needs no destructive decision to reach, only a
    // file renamed twice.
    //
    // `a/one.txt` -> `a/two.txt` -> `a/three.txt`. On the third pass BOTH old
    // rows are absent and both carry the same bytes, so both matched the single
    // arrival — and the ledger's order decided it. The row for `a/one.txt` won,
    // its recorded relocation was rewritten from `a/two.txt` to `a/three.txt`
    // (a destination nothing ever moved to), and the move that actually
    // happened was left with no explanation at all: drift, and two clean scans
    // later a reported DELETION of a file plainly still there under a third
    // name.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/one.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('a', [{ key: 'a/two.txt', body: 'BYTES', version: 'e1' }]);
    const second = await w.run(ledger);
    expect(second.moves.map((m) => m.toNaturalKeyHash)).toEqual(['a/two.txt']);

    // Renamed again. `a/two.txt` is the row whose disappearance this explains.
    w.folders.set('a', [{ key: 'a/three.txt', body: 'BYTES', version: 'e1' }]);
    const third = await w.run(ledger);

    expect(
      third.moves.map((m) => [m.naturalKeyHash, m.toNaturalKeyHash]),
      'each disappearance keeps its own explanation',
    ).toEqual([
      ['a/one.txt', 'a/two.txt'],
      ['a/two.txt', 'a/three.txt'],
    ]);
    expect(third.drift, 'nothing is left unexplained').toBe(0);

    // And the first row still points where the file really went.
    const first = await ledger.find(TENANT, MAPPING, 'file', 'a/one.txt');
    expect(first?.movedToNaturalKeyHash).toBe('a/two.txt');
  });

  it('does not silently re-open a move the owner already closed', async () => {
    // The second cost of the theft: `recordMove` clears the acknowledgement
    // when the destination key changes, correctly — consent to one arrangement
    // is not consent to another. So a row stealing a later arrival re-opened a
    // queue entry somebody had already dealt with, pointing at a destination
    // that had nothing to do with it.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/one.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);

    w.folders.set('a', [{ key: 'a/two.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);
    expect(await ledger.resolveMove(TENANT, MAPPING, 'a/one.txt', 'keep')).toBe(true);

    w.folders.set('a', [{ key: 'a/three.txt', body: 'BYTES', version: 'e1' }]);
    const third = await w.run(ledger);

    expect(
      third.moves.map((m) => m.naturalKeyHash),
      'the closed entry stays closed; only the new move is reported',
    ).toEqual(['a/two.txt']);
    const first = await ledger.find(TENANT, MAPPING, 'file', 'a/one.txt');
    expect(first?.moveAcknowledgedAt, 'the decision survives').toBeDefined();
    expect(first?.movedToNaturalKeyHash).toBe('a/two.txt');
  });
});

describe('the old path after an applied relocation', () => {
  it('migrates a NEW file that later occupies it', async () => {
    // The quiet, permanent loss the audit found. The file domain keys on the
    // PATH, so once a rename was applied the row for the old path was
    // tombstoned — and `classifyKnownItem` refuses to re-materialise a
    // tombstone, because it cannot tell a change of mind from an erasure
    // request. That reasoning is right for a DELETION and wrong here: nobody
    // asked for anything to be erased, the item simply moved.
    //
    // Undistinguished, ANY file later landing on that path — a different file,
    // with different content — matched the row and was never migrated, for the
    // lifetime of the mapping.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/report.pdf', body: 'ORIGINAL', version: 'e1' }]);
    await w.run(ledger);

    // Renamed, and the owner applies the relocation: a/report.pdf's copy goes.
    w.folders.set('a', [{ key: 'a/summary.pdf', body: 'ORIGINAL', version: 'e1' }]);
    await w.run(ledger);
    expect(
      await applyRelocation(
        {
          tenantId: TENANT,
          mappingId: MAPPING,
          domain: 'file',
          ledger,
          target: {
            removeItem: async () => ({ kind: 'deleted' as const }),
            hasItem: async () => true,
          },
          allowApplyDeletions: true,
        },
        'a/report.pdf',
      ),
    ).toMatchObject({ ok: true });

    // Months later, an unrelated file is created at the old path.
    w.folders.set('a', [
      { key: 'a/summary.pdf', body: 'ORIGINAL', version: 'e1' },
      { key: 'a/report.pdf', body: 'SOMETHING ENTIRELY ELSE', version: 'e2' },
    ]);
    const third = await w.run(ledger);

    expect(third.reappearedAfterRemoval ?? 0, 'this is not a reappearance').toBe(0);
    expect(w.target.get('t/a:a/report.pdf')).toBe('SOMETHING ENTIRELY ELSE');
  });

  it('still refuses to re-create a DELETION tombstone', async () => {
    // The other half, and the one that must not move: an applied deletion may
    // have been an erasure request, and restoring it would be a compliance
    // failure this code cannot rule out.
    const ledger = new MemoryLedger();
    const w = world('file');
    w.folders.set('a', [{ key: 'a/gone.txt', body: 'BYTES', version: 'e1' }]);
    await w.run(ledger);

    // Reported deleted by the source, then applied by the owner. Seeded through
    // the ledger's own method rather than by handing `recordUpdate` a row with
    // the field set: `deletion_reported_at` is not in that statement's SET
    // clause, so Postgres would ignore it and only the fake would appear to
    // work — the exact fake-vs-SQL divergence this file is meant to catch.
    expect(await ledger.recordReportedDeletion(TENANT, MAPPING, 'file', 'a/gone.txt')).toBe(true);
    expect(await ledger.applyDeletion(TENANT, MAPPING, 'file', 'a/gone.txt')).toBe(true);

    // The source lists it again.
    const second = await w.run(ledger);

    expect(second.reappearedAfterRemoval).toBe(1);
    expect(second.created).toBe(0);
  });
});

describe('the recording date (migration 0013): the queue can say how long a report has sat', () => {
  const seed = async (ledger: MemoryLedger, key: string) => {
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'file',
      naturalKeyHash: key,
      contentHash: `h:${key}`,
      targetId: `t:${key}`,
      createdAt: new Date().toISOString(),
      sizeBytes: 1,
      status: 'copied',
      collection: 'Docs',
    });
  };

  it('stamps on first recording, keeps the stamp when a pass re-observes, re-stamps on a NEW destination', async () => {
    // updated_at cannot serve as the age — every pass touches it — so the
    // recording date must survive re-observation, or the queue always reads
    // "just now" and ADR-0031's survived-a-pass gate never opens.
    const ledger = new MemoryLedger();
    await seed(ledger, 'file:a.txt');

    await ledger.recordMove(TENANT, MAPPING, 'file', 'file:a.txt', 'Archive');
    const first = (await ledger.listMoves(TENANT, MAPPING))[0]!;
    expect(first.recordedAt).toBeDefined();

    await ledger.recordMove(TENANT, MAPPING, 'file', 'file:a.txt', 'Archive');
    const second = (await ledger.listMoves(TENANT, MAPPING))[0]!;
    expect(second.recordedAt).toBe(first.recordedAt);

    // Somewhere new is a new report — the same condition that clears the
    // acknowledgement re-stamps the date.
    await ledger.recordMove(TENANT, MAPPING, 'file', 'file:a.txt', 'Elsewhere');
    const third = (await ledger.listMoves(TENANT, MAPPING))[0]!;
    expect(third.recordedAt! >= first.recordedAt!).toBe(true);
  });

  it('clears with the move: a NEXT move to the same place must read as fresh', async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, 'file:b.txt');
    await ledger.recordMove(TENANT, MAPPING, 'file', 'file:b.txt', 'Archive');
    await ledger.clearMove(TENANT, MAPPING, 'file', 'file:b.txt');

    expect(await ledger.listMoves(TENANT, MAPPING)).toEqual([]);
    const row = await ledger.find(TENANT, MAPPING, 'file', 'file:b.txt');
    expect(row?.movedRecordedAt).toBeUndefined();
  });
});
