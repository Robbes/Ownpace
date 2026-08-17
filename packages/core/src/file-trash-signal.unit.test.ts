// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The file domain, through `runFileSync`, when the owner deletes a file.
 *
 * The parser and the two sources are tested where they live; this is about the
 * thing neither can prove on its own — that the paths the bin reports hash to the
 * SAME natural keys the ledger holds. A path that differs by a leading slash, a
 * `rootPath` prefix or an escaping choice produces no error at all: the lookup just
 * misses, nothing is reported, and the feature is silently inert. Four columns in
 * this schema have already spent a release in exactly that state.
 *
 * It also pins the interaction between the two file signals. A deleted file is
 * found twice on the same pass by design — sitting in the bin (positive evidence,
 * believed at once) and missing from the collection listing (absence-counting,
 * believed after it repeats) — and the queue must show one item, not two.
 */

import { describe, it, expect } from 'vitest';
import { runFileSync } from './dav-sync';
import { MemoryLedger } from './__testing__/memory';
import {
  asTenantId,
  asMappingId,
  fileNaturalKeyHash,
  DELETION_CONFIRMATIONS,
  type FileFolder,
  type FileItem,
  type FileSource,
  type FileTargetWriter,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('c9660000-e29b-41d4-a716-4466554404aa');
const MAPPING = asMappingId('c9660000-e29b-41d4-a716-4466554404bb');

/**
 * A file source whose files can be deleted into a bin, wired to a target that
 * records its own ledger rows — as all three real writers do, `recordIfAbsent`
 * making the first writer win.
 */
function drive() {
  /** Live files: root-relative path -> content. */
  const files = new Map<string, string>([
    ['Documents/report.pdf', 'PDF-A'],
    ['notes.txt', 'NOTES'],
  ]);
  /** The bin: root-relative ORIGINAL paths of deleted files. */
  const bin: string[] = [];
  /** Bin entries the source could not name — see `TrashListing`. */
  const unnameable = { count: 0 };
  const target = new Map<string, string>();

  const source: FileSource = {
    listFolders: async () => [{ path: '/', name: 'root' } as FileFolder],
    listSince: async () => ({
      items: [...files.entries()].map(
        ([path, content]) =>
          ({
            item: {
              path,
              isDirectory: false,
              size: content.length,
              modifiedAt: '2026-07-01T00:00:00Z',
              etag: `etag-${content}`,
              // The server's own handle, distinct from the path — which is what a
              // real WebDAV source records.
              sourceRef: `/remote.php/dav/files/alice/${path}`,
            },
            content: undefined,
          }) as RawFileItem,
      ),
      nextCursor: { value: 'c' },
    }),
    fetch: async (item: FileItem) => ({
      item,
      content: new TextEncoder().encode(files.get(item.path) ?? ''),
    }),
    listKeys: async () => [...files.keys()],
    listTrashedPaths: async () => ({
      paths: [...bin],
      unnameable: unnameable.count,
      ...(unnameable.count > 0 ? { reason: 'the bin gave no original location' } : {}),
    }),
  };

  const writer: FileTargetWriter = {
    ensureDirectory: async (folder) => `t${folder.path}`,
    findFileByNaturalKey: async () => undefined,
    upsertFile: async (parentId, raw): Promise<UpsertResult> => {
      const at = `${parentId}:${raw.item.path}`;
      const existed = target.has(at);
      target.set(at, new TextDecoder().decode(raw.content ?? new Uint8Array()));
      return existed ? { targetId: at, created: false, adopted: true } : { targetId: at, created: true };
    },
  };

  /** What the owner pressing delete does: out of the listing, into the bin. */
  const remove = (path: string) => {
    files.delete(path);
    bin.push(path);
  };

  const run = (ledger: MemoryLedger) =>
    runFileSync({ tenantId: TENANT, mappingId: MAPPING, source, target: writer, ledger });

  return { files, bin, target, remove, run, unnameable };
}

describe('a file the owner moved to the bin', () => {
  it('is reported as trashed on the first pass, and not removed from the target', async () => {
    const ledger = new MemoryLedger();
    const d = drive();

    expect((await d.run(ledger)).created).toBe(2);
    d.remove('Documents/report.pdf');

    const second = await d.run(ledger);
    expect(second.deletions).toEqual([
      {
        domain: 'file',
        naturalKeyHash: fileNaturalKeyHash('Documents/report.pdf'),
        collection: '/',
        absentPasses: 0,
        confirmed: true,
        evidence: 'trashed',
      },
    ]);
    // Believed at once, where absence alone would still be being watched.
    expect(second.deletions[0]!.confirmed).toBe(true);
    // Nothing removed: the target still holds both files.
    expect(d.target.size).toBe(2);
  });

  it('is ONE queue entry, not one per signal', async () => {
    // The same file is in the bin AND missing from the listing, so both detectors
    // fire. Both facts are recorded on the row; the report must not read as two
    // separate problems.
    const ledger = new MemoryLedger();
    const d = drive();
    await d.run(ledger);
    d.remove('notes.txt');

    // Pass 2: trashed (at once) and absent once (not yet confirmed).
    const second = await d.run(ledger);
    expect(second.deletions).toHaveLength(1);
    expect(second.deletions[0]!.evidence).toBe('trashed');

    // Pass 3: absence has now repeated, so the inferred detector would report it
    // too. Still one entry, and still the stronger evidence.
    const third = await d.run(ledger);
    expect(third.deletions).toHaveLength(1);
    expect(third.deletions[0]!.evidence).toBe('trashed');
    expect(third.deletions[0]!.absentPasses).toBeGreaterThanOrEqual(DELETION_CONFIRMATIONS);

    const queued = await ledger.listDeletions(TENANT, MAPPING, 'file');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.evidence).toBe('trashed');
  });

  it('drops the claim when the file is restored from the bin', async () => {
    const ledger = new MemoryLedger();
    const d = drive();
    await d.run(ledger);

    d.remove('notes.txt');
    expect((await d.run(ledger)).deletions).toHaveLength(1);

    // Put back: out of the bin, into the listing again.
    d.bin.length = 0;
    d.files.set('notes.txt', 'NOTES');

    const third = await d.run(ledger);
    expect(third.deletions).toEqual([]);
    expect(await ledger.listDeletions(TENANT, MAPPING, 'file')).toEqual([]);
    // And not copied a second time — the path is the natural key, and it is the
    // same path.
    expect(third.created).toBe(0);
  });

  it('says nothing about files in the bin that were never migrated', async () => {
    // Most of a real bin is this: things thrown away before the migration started.
    const ledger = new MemoryLedger();
    const d = drive();
    d.bin.push('Old/whatever.txt');

    const first = await d.run(ledger);
    expect(first.created).toBe(2);
    expect(first.deletions).toEqual([]);
  });
});

describe('a source with no bin to read', () => {
  it('falls back to absence-counting rather than reporting nothing', async () => {
    // A plain WebDAV server has no trashbin — RFC 4918 has no such concept. The
    // weaker signal is still a signal, and it is the honest one to use here.
    const ledger = new MemoryLedger();
    const files = new Map<string, string>([['a.txt', 'A']]);
    const source: FileSource = {
      listFolders: async () => [{ path: '/', name: 'root' } as FileFolder],
      listSince: async () => ({
        items: [...files.entries()].map(
          ([path, content]) =>
            ({
              item: {
                path,
                isDirectory: false,
                size: content.length,
                modifiedAt: '2026-07-01T00:00:00Z',
                sourceRef: path,
              },
              content: undefined,
            }) as RawFileItem,
        ),
        nextCursor: { value: 'c' },
      }),
      fetch: async (item: FileItem) => ({
        item,
        content: new TextEncoder().encode(files.get(item.path) ?? ''),
      }),
      listKeys: async () => [...files.keys()],
      // No listTrashedPaths at all.
    };
    const target = new Map<string, string>();
    const writer: FileTargetWriter = {
      ensureDirectory: async () => 't/',
      findFileByNaturalKey: async () => undefined,
      upsertFile: async (parentId, raw) => {
        target.set(`${parentId}:${raw.item.path}`, 'x');
        return { targetId: `${parentId}:${raw.item.path}`, created: true };
      },
    };
    const run = () =>
      runFileSync({ tenantId: TENANT, mappingId: MAPPING, source, target: writer, ledger });

    await run();
    files.delete('a.txt');

    // Watched, not reported.
    expect((await run()).deletions).toEqual([]);
    // Then confirmed, and labelled as the inference it is.
    const third = await run();
    expect(third.deletions).toHaveLength(1);
    expect(third.deletions[0]).toMatchObject({ evidence: 'inferred', confirmed: true });
  });
});


describe('bin entries the source could not NAME (TrashListing.unnameable)', () => {
  it('are carried to the result so the missing apply action has an explanation', async () => {
    const ledger = new MemoryLedger();
    const d = drive();
    await d.run(ledger);

    // The owner deleted something the source cannot place — a Drive ancestor
    // permanently deleted, a Box item with no path_collection. The deletion is
    // still caught by absence-counting, but only as `inferred`, which gate 3
    // will not apply. Nothing else would tell anyone why.
    d.files.delete('notes.txt');
    d.unnameable.count = 1;

    const result = await d.run(ledger);

    expect(result.unplaceableDiscards).toEqual({
      count: 1,
      reason: 'the bin gave no original location',
    });
  });

  it('is absent when every bin entry could be placed — not a zero to read past', async () => {
    const ledger = new MemoryLedger();
    const d = drive();
    await d.run(ledger);
    d.remove('notes.txt');

    const result = await d.run(ledger);

    expect(result.unplaceableDiscards).toBeUndefined();
    // ...and the placeable one still lands as positive evidence.
    expect(result.deletions?.[0]?.evidence).toBe('trashed');
  });
});
