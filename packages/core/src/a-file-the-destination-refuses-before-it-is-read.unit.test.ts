// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FILE THE DESTINATION REFUSES, BEFORE IT IS READ, AND A STREAMED FILE'S
 * OWN HASH (workplan 0160 T5).
 *
 * Two small changes to the file loop, both for Cirrux Drive and neither only
 * for it, proven over the real `runFileSync`:
 *
 * 1. **A writer may refuse a file from its listing** (`refuseBeforeRead`):
 *    Cirrux Drive takes 2 GiB a file, and this version sends 100 MB at most.
 *    A file over either is the destination's limit, not the deployment's, and
 *    fetching it first would spend a download on a refusal already known. The
 *    source's `fetch` is never called for it, and the writer's sentence and
 *    category are the item's failure.
 * 2. **A writer that hashed what it sent says so** (`UpsertResult.contentHash`).
 *    The loop hashes `raw.content` before the write, and a file a source hands
 *    over as a stream has none: that hash is of nothing. Recorded on the row,
 *    it tells §20 every streamed file is empty, and move detection that every
 *    streamed file is the same one. The loop now records the writer's.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  asMappingId,
  asTenantId,
  fileNaturalKeyHash,
  markNeedsDecision,
  withFailureCategory,
  type FileFolder,
  type FileItem,
  type FileSource,
  type RawFileItem,
  type UpsertResult,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('01600000-0000-4000-8000-000000000001');
const MAPPING = asMappingId('01600000-0000-4000-8000-000000000002');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const STREAMED = new TextEncoder().encode('a streamed file, never held');

function source(files: Array<{ path: string; size: number; streamed?: boolean }>) {
  const fetched: string[] = [];
  const s: FileSource = {
    listFolders: async (): Promise<FileFolder[]> => [{ path: '' }],
    listSince: async () => ({
      items: files.map(({ path, size }): RawFileItem => ({
        item: { path, name: path, isDirectory: false, size, etag: `v-${path}`, modifiedAt: '2026-01-01T00:00:00Z', sourceRef: path } as FileItem,
      })),
      nextCursor: { value: 'end' } as never,
    }),
    fetch: async (item: FileItem): Promise<RawFileItem> => {
      fetched.push(item.path);
      const spec = files.find((f) => f.path === item.path)!;
      if (spec.streamed) {
        return {
          item,
          body: {
            sizeBytes: STREAMED.byteLength,
            open: async () =>
              new ReadableStream<Uint8Array>({
                start(c) {
                  c.enqueue(STREAMED);
                  c.close();
                },
              }),
          },
        };
      }
      return { item, content: new Uint8Array([1, 2, 3]) };
    },
  };
  return { source: s, fetched };
}

/** A writer with a limit of its own, and one that hashes what it streams. */
function target(limit: number) {
  const written: string[] = [];
  return {
    written,
    ensureDirectory: async () => '',
    findFileByNaturalKey: async () => undefined,
    refuseBeforeRead: (item: FileItem) =>
      item.size > limit
        ? withFailureCategory('too_large', markNeedsDecision(new Error(`${item.path} is over the destination's limit.`)))
        : undefined,
    upsertFile: async (_parent: string, raw: RawFileItem): Promise<UpsertResult> => {
      written.push(raw.item.path);
      if (!raw.body) return { targetId: raw.item.path, created: true };
      const reader = (await raw.body.open()).getReader();
      const hash = createHash('sha256');
      for (let r = await reader.read(); !r.done; r = await reader.read()) hash.update(r.value);
      return { targetId: raw.item.path, created: true, contentHash: hash.digest('hex') };
    },
  };
}

async function pass(files: Array<{ path: string; size: number; streamed?: boolean }>, limit = 1000) {
  const s = source(files);
  const t = target(limit);
  const ledger = new MemoryLedger();
  await runFileSync({
    tenantId: TENANT,
    mappingId: MAPPING,
    source: s.source,
    target: t,
    ledger,
    cursors: new MemoryCursorStore(),
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
  });
  return { fetched: s.fetched, written: t.written, ledger };
}

describe('a file the destination refuses is refused before a byte is read', () => {
  it('never fetches it, records the writer’s sentence and category, and copies the rest', async () => {
    const { fetched, written, ledger } = await pass([
      { path: 'movie.mp4', size: 5000 },
      { path: 'note.txt', size: 3 },
    ]);
    expect(fetched).toEqual(['note.txt']);
    expect(written).toEqual(['note.txt']);
    const failures = await ledger.listFailures(TENANT, MAPPING, 'file');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      category: 'too_large',
      needsDecision: true,
      lastError: "movie.mp4 is over the destination's limit.",
    });
  });
});

describe('a streamed file’s row keeps the hash of what was sent', () => {
  it('records the writer’s hash, not the hash of nothing', async () => {
    const { ledger } = await pass([{ path: 'big.bin', size: STREAMED.byteLength, streamed: true }]);
    const row = await ledger.find(TENANT, MAPPING, 'file', fileNaturalKeyHash('big.bin'));
    expect(row?.contentHash).toBe(sha(STREAMED));
    expect(row?.contentHash).not.toBe(sha(new Uint8Array(0)));
  });

  it('and a buffered file’s row is the loop’s own hash, as before', async () => {
    const { ledger } = await pass([{ path: 'small.bin', size: 3 }]);
    const row = await ledger.find(TENANT, MAPPING, 'file', fileNaturalKeyHash('small.bin'));
    expect(row?.contentHash).toBe(sha(new Uint8Array([1, 2, 3])));
  });
});
