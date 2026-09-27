// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE NO PASS CAN CARRY (workplan 0143 T4 (a), the alpha minimum).
 *
 * A managed pass runs an hour at most, and a file is copied in one go, so a
 * file too large to move in a pass was killed with the pass and started again
 * on the next one, every pass. A managed deployment now states the largest
 * file it copies (the owner's 10 GB, 2026-09-27), and the real `runFileSync`
 * over a fake source proves:
 *
 * - a listed file one byte over the limit is refused, and the source's `fetch`
 *   is never called: no download starts. It is parked for a person on first
 *   sight, as a `too_large` decision, with the sentence;
 * - one byte under is fetched and copied, and so is a file of exactly the
 *   limit;
 * - with no limit, which is the appliance's case, nothing is refused.
 *
 * It fails today: the loop fetches every file.
 */

import { describe, it, expect } from 'vitest';
import {
  asTenantId,
  asMappingId,
  type FileFolder,
  type FileItem,
  type FileSource,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';
import { fileTooLarge, sizeText } from './largest-file.ts';
import { MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';

const TENANT = asTenantId('0143cc92-8a3b-4e4c-9d5d-6e7f8a9b0c01');
const MAPPING = asMappingId('0143cc92-8a3b-4e4c-9d5d-6e7f8a9b0c02');
const GB = 1024 * 1024 * 1024;
const LIMIT = 10 * GB;

/** One folder of files, listed with the sizes given, and a record of every download. */
function fakeSource(files: Array<{ path: string; size: number }>) {
  const fetched: string[] = [];
  const source: FileSource = {
    listFolders: async (): Promise<FileFolder[]> => [{ path: '' }],
    listSince: async () => ({
      items: files.map(
        ({ path, size }): RawFileItem => ({
          item: { path, name: path, isDirectory: false, size, etag: `v-${path}` } as FileItem,
        }),
      ),
      nextCursor: { value: 'end' } as never,
    }),
    // The bytes a download would bring, however large the listing said: a
    // test must not allocate ten gigabytes to prove that none were read.
    fetch: async (item: FileItem): Promise<RawFileItem> => {
      fetched.push(item.path);
      return { item, content: new Uint8Array([1, 2, 3]) };
    },
  };
  return { source, fetched };
}

function memoryTarget() {
  const written: string[] = [];
  return {
    written,
    ensureDirectory: async (folder: FileFolder) => `t/${folder.path || 'root'}`,
    upsertFile: async (parentId: string, raw: RawFileItem): Promise<UpsertResult> => {
      written.push(raw.item.path);
      return { targetId: `${parentId}:${raw.item.path}`, created: true };
    },
    findFileByNaturalKey: async () => undefined,
  };
}

async function pass(files: Array<{ path: string; size: number }>, largestFileBytes?: number) {
  const { source, fetched } = fakeSource(files);
  const target = memoryTarget();
  const ledger = new MemoryLedger();
  const result = await runFileSync({
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target,
    ledger,
    cursors: new MemoryCursorStore(),
    sourceIsAuthorityOnExistence: true,
    ...(largestFileBytes !== undefined ? { largestFileBytes } : {}),
  });
  const failures = await ledger.listFailures(TENANT, MAPPING, 'file');
  return { result, fetched, written: target.written, failures };
}

describe('a file larger than the deployment copies', () => {
  it('is refused before a byte is read, and parked for a person with the sentence', async () => {
    const { result, fetched, written, failures } = await pass(
      [
        { path: 'Videos/wedding.mov', size: Math.round(12.4 * GB) },
        { path: 'Documents/letter.pdf', size: 20_000 },
      ],
      LIMIT,
    );

    // No download started for it, and every other file continues.
    expect(fetched).toEqual(['Documents/letter.pdf']);
    expect(written).toEqual(['Documents/letter.pdf']);
    expect(result.needsDecision).toBe(1);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      category: 'too_large',
      needsDecision: true,
      lastError:
        'Videos/wedding.mov is 12.4 GB. During the alpha this service copies files up to 10 GB, ' +
        'because a larger file can take longer than one pass may run. Nothing was copied and ' +
        'nothing was changed; every other file continues. Copy this one by hand.',
    });
  });

  it('is refused one byte over', async () => {
    const { fetched, failures } = await pass([{ path: 'Videos/long.mov', size: LIMIT + 1 }], LIMIT);
    expect(fetched).toEqual([]);
    expect(failures.map((f) => f.category)).toEqual(['too_large']);
  });

  it('is copied when it is one byte under, or exactly the limit: "up to 10 GB"', async () => {
    const { fetched, written, failures } = await pass(
      [
        { path: 'Videos/short.mov', size: LIMIT - 1 },
        { path: 'Videos/exact.mov', size: LIMIT },
      ],
      LIMIT,
    );
    expect(fetched).toEqual(['Videos/short.mov', 'Videos/exact.mov']);
    expect(written).toEqual(['Videos/short.mov', 'Videos/exact.mov']);
    expect(failures).toEqual([]);
  });

  it('is copied where no limit is set, as on the appliance', async () => {
    const { fetched, failures } = await pass([{ path: 'Videos/long.mov', size: 12 * GB }]);
    expect(fetched).toEqual(['Videos/long.mov']);
    expect(failures).toEqual([]);
  });
});

describe('the sentence', () => {
  it('names the size as a file manager does, and the limit as it was set', () => {
    expect(sizeText(12.4 * GB)).toBe('12.4 GB');
    expect(sizeText(512 * 1024 * 1024)).toBe('512.0 MB');
    expect(fileTooLarge('a.iso', 12.4 * GB, 2048 * 1024 * 1024).message).toMatch(
      /^a\.iso is 12\.4 GB\. During the alpha this service copies files up to 2 GB,/,
    );
    expect(fileTooLarge('a.iso', 3 * GB, 1500 * 1024 * 1024).message).toContain('up to 1500 MB,');
  });
});
