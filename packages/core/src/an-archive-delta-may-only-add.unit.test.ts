// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE DELTA MAY ONLY ADD.
 *
 * Workplan 0116 T6, §5 — proved through the REAL `runFileSync`, the real
 * Takeout reader and a real ledger, because the rule is a property of the
 * loop and not of any one source: a second import of the same archive writes
 * nothing; a later export in the series writes only what is new in it; and
 * an item the later export no longer mentions is NEVER counted absent, never
 * reported as a deletion, not even as a suspicion.
 *
 * Why the last one needs its own proof. The loop's absence-counting runs on
 * every cursor-less pass — the exact shape of an archive import, which has no
 * cursor worth keeping — and a source that merely declined `listKeys` would
 * still be counted on such a pass. `FileSource.snapshot` is what turns it
 * off, and the control case at the bottom shows the counting come back the
 * moment the flag is gone. Absence between two archives is weaker than this
 * product's weakest deletion class: deleted, deselected and truncated present
 * identically in an export whose scope the person chose.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveFileSource, createTakeoutArchiveReader } from '@openmig/connectors';
import {
  asTenantId,
  asMappingId,
  DELETION_CONFIRMATIONS,
  type FileFolder,
  type FileSource,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('31111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('32222222-2222-4222-8222-222222222222');

const X = Buffer.from('photo X, in an album and its year');
const Y = Buffer.from('photo Y, in its year only');
const Z = Buffer.from('photo Z, taken after the first export');

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A Takeout with the given files under `Takeout/Google Photos/<folder>/<name>`. */
async function takeout(files: Array<[folder: string, name: string, bytes: Buffer]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'archive-delta-'));
  made.push(root);
  for (const [folder, name, bytes] of files) {
    const dir = join(root, 'Takeout', 'Google Photos', folder);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
  }
  return root;
}

/** The first export: X filed in an album and its year, Y in its year only. */
const firstExport = () =>
  takeout([
    ['Holiday', 'X.jpg', X],
    ['Photos from 2019', 'X.jpg', X],
    ['Photos from 2021', 'Y.jpg', Y],
  ]);

/** The next export in the series: X still there, Y gone, Z new. */
const laterExport = () =>
  takeout([
    ['Holiday', 'X.jpg', X],
    ['Photos from 2019', 'X.jpg', X],
    ['Photos from 2022', 'Z.jpg', Z],
  ]);

const archiveAt = (path: string): ArchiveFileSource =>
  new ArchiveFileSource(createTakeoutArchiveReader(), { provider: 'google-takeout', path });

/** The minimum honest FileTargetWriter: stores bytes, adopts on re-write. */
function memoryTarget() {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (
      parentId: string,
      raw: RawFileItem,
      options?: { overwrite?: boolean },
    ): Promise<UpsertResult> => {
      const at = `${parentId}:${raw.item.path}`;
      const existed = stored.has(at);
      stored.set(at, raw.content ?? new Uint8Array());
      if (options?.overwrite) return { targetId: at, created: false, updated: true };
      if (existed) return { targetId: at, created: false, adopted: true };
      return { targetId: at, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
}

/** No cursor store, on purpose: every pass is the cursor-less kind. */
function deps(source: FileSource, target: ReturnType<typeof memoryTarget>, ledger: MemoryLedger) {
  return { tenantId: TENANT, mappingId: MAPPING, source, target, ledger, concurrency: 2 };
}

const paths = (target: ReturnType<typeof memoryTarget>) =>
  [...target.stored.keys()].map((k) => k.slice(k.indexOf(':') + 1)).sort();

describe('a second import writes nothing', () => {
  it('creates every placement and the manifest once, and skips all of them the second time', async () => {
    const root = await firstExport();
    const ledger = new MemoryLedger();
    const target = memoryTarget();

    const first = await runFileSync(deps(archiveAt(root), target, ledger));
    // X under its album (not under its year as well), Y under its year, and
    // the manifest at the root: three items, three creates.
    expect(first.created).toBe(3);
    expect(first.failed).toBe(0);
    expect(paths(target).filter((p) => !p.startsWith('export-archive-manifest-'))).toEqual([
      'Holiday/X.jpg',
      'Photos from 2021/Y.jpg',
    ]);

    // A fresh source over the SAME archive — a new pass, a new walk, the same
    // ledger. The ledger's fast-path knows every path and hash: nothing fetched,
    // nothing written.
    const second = await runFileSync(deps(archiveAt(root), target, ledger));
    expect(second.created, 'a second import of the same archive wrote something').toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(3);
  });
});

describe('a later export in the series writes only what is new, and removes nothing', () => {
  it('adds Z and the new manifest, keeps Y, and reports no deletion in DELETION_CONFIRMATIONS passes', async () => {
    const ledger = new MemoryLedger();
    const target = memoryTarget();
    await runFileSync(deps(archiveAt(await firstExport()), target, ledger));

    const later = await laterExport();
    const results = [];
    for (let pass = 0; pass <= DELETION_CONFIRMATIONS; pass += 1) {
      results.push(await runFileSync(deps(archiveAt(later), target, ledger)));
    }
    // The first pass over the later export: Z's placement and its manifest.
    // X is known by path and hash; the earlier manifest is simply not listed.
    expect(results[0]!.created).toBe(2);
    for (const r of results.slice(1)) expect(r.created).toBe(0);

    // The rule. Y and the first manifest are absent from every one of these
    // passes, more of them than the loop needs to call an absence a deletion
    // on a live account — and here it counts nothing and reports nothing.
    for (const [i, r] of results.entries()) {
      expect(r.drift, `pass ${i + 1} counted an absence as drift`).toBe(0);
      expect(r.deletions, `pass ${i + 1} reported a deletion`).toEqual([]);
    }
    expect(await ledger.listDeletions(TENANT, MAPPING, 'file')).toEqual([]);
    expect(paths(target)).toContain('Photos from 2021/Y.jpg');
    expect(paths(target)).toContain('Photos from 2022/Z.jpg');
  });

  it('the control: the same passes with the snapshot flag stripped DO count the absence', async () => {
    // What the rule stands on. Strip `snapshot` and offer the loop the exact
    // same listings: a cursor-less pass counts what it does not see, so Y
    // and the earlier manifest become drift on the very first pass over the
    // later export. This is the shape an ordinary file source has and an
    // archive must not.
    const ledger = new MemoryLedger();
    const target = memoryTarget();
    await runFileSync(deps(archiveAt(await firstExport()), target, ledger));
    const real = archiveAt(await laterExport());
    const unflagged: FileSource = {
      listFolders: () => real.listFolders(),
      listSince: (folder, cursor) => real.listSince(folder, cursor),
      fetch: (item) => real.fetch(item),
    };
    const counted = await runFileSync(deps(unflagged, target, ledger));
    expect(counted.drift, 'without the flag the loop should have counted Y absent').toBeGreaterThan(0);
  });
});
