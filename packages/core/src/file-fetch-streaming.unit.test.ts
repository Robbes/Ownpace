// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * When a file's bytes are read, and what happens when they cannot be.
 *
 * The WebDAV source downloaded every changed file's content inline in its
 * PROPFIND loop, before the sync loop had started. Two things followed, and
 * neither was visible in any test:
 *
 *   1. Downloads were SERIAL regardless of `concurrency`. Only the uploads ran
 *      in parallel, so the file domain paid full latency on half its work —
 *      633 of run #38's 939 seconds went to files.
 *   2. A whole folder's bytes were held in memory at once. 67 MB of e2e
 *      fixtures survives that; a real file migration does not, and it directly
 *      contradicts the documented promise that concurrency "bounds peak memory
 *      to ~concurrency bodies in flight".
 *
 * And the loop's `item.content ?? new Uint8Array(0)` meant a source that did
 * not inline content — the Graph drive source, which sets `content: undefined`
 * and says "use fetch()" — wrote EVERY FILE AS ZERO BYTES, recorded the hash
 * of the empty string, and reported it as created.
 *
 * These tests observe concurrency and peak residency directly, so a regression
 * to inline downloading fails here.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import type {
  FileSource,
  FileFolder,
  FileItem,
  RawFileItem,
  SyncCursor,
  FileTargetWriter,
  Ledger,
} from '@openmig/shared';
import { runFileSync } from './dav-sync.ts';

const TENANT = asTenantId('7f110000-e29b-41d4-a716-446655446601' as never);
const MAPPING = asMappingId('7f110000-e29b-41d4-a716-446655446602' as never);

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
  // Per-item isolation records failures rather than throwing them; a stub
  // without this made the loop fail with "recordFailure is not a function",
  // which looks like the item's own error and is not.
  // An empty ledger has placed nothing, so move detection has nothing to
  // correlate against. Present because `runDomainSync` really does call it on a
  // full file-domain scan — the same lesson as `recordFailure` just below: a
  // stub missing a method the loop uses fails the whole pass with a TypeError
  // that reads like the item's own error.
  placedItems: async () => [],
  recordFailure: async (r: unknown, error: string) => ({
    ...(r as Record<string, unknown>),
    attemptCount: 1,
    lastError: error,
  }),
} as unknown as Ledger;

const FOLDER: FileFolder = { path: 'docs', name: 'docs' };

function metadata(count: number): RawFileItem[] {
  return Array.from({ length: count }, (_, i) => ({
    item: {
      path: `docs/file-${i}.bin`,
      name: `file-${i}.bin`,
      isDirectory: false,
      size: 1024,
      modifiedAt: '2026-01-01T00:00:00Z',
      sourceRef: `/dav/docs/file-${i}.bin`,
    } as FileItem,
    // No content — exactly what a metadata-only listing returns.
  }));
}

/**
 * A source that reports how many fetches overlap and how many payloads are
 * alive at once. `release` is called when the target has consumed the bytes.
 */
function observableSource(count: number, fetchMs = 5) {
  const listed = metadata(count);
  let inFlight = 0;
  let maxInFlight = 0;
  let live = 0;
  let maxLive = 0;

  const source: FileSource = {
    async listFolders() {
      return [FOLDER];
    },
    async listSince() {
      return { items: listed, nextCursor: { value: 'c1' } as SyncCursor };
    },
    async fetch(item: FileItem) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, fetchMs));
      inFlight--;
      live++;
      maxLive = Math.max(maxLive, live);
      return { item, content: new Uint8Array(item.size) };
    },
  };

  const release = () => {
    live--;
  };

  return { source, release, stats: () => ({ maxInFlight, maxLive }) };
}

function recordingTarget(release: () => void) {
  const written: Array<{ path: string; bytes: number }> = [];
  const target: FileTargetWriter = {
    async ensureDirectory() {
      return 'docs';
    },
    async upsertFile(_parentId: string, raw: RawFileItem) {
      written.push({ path: raw.item.path, bytes: raw.content?.length ?? 0 });
      release();
      return { targetId: raw.item.path, created: true };
    },
  } as unknown as FileTargetWriter;
  return { target, written };
}

describe('file content fetching', () => {
  it('downloads files in parallel, up to the concurrency cap', async () => {
    const { source, release, stats } = observableSource(24);
    const { target } = recordingTarget(release);

    await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger: emptyLedger,
      concurrency: 4,
    } as never);

    // The load-bearing assertion. Inline downloading pinned this at 1 no
    // matter what `concurrency` said.
    expect(stats().maxInFlight).toBeGreaterThan(1);
    expect(stats().maxInFlight).toBeLessThanOrEqual(4);
  });

  it('never holds more than a few payloads at once', async () => {
    // 200 files listed, 4 in flight. Downloading during the listing made this
    // 200 — the whole folder resident before anything was written.
    const { source, release, stats } = observableSource(200, 1);
    const { target } = recordingTarget(release);

    await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger: emptyLedger,
      concurrency: 4,
    } as never);

    expect(stats().maxLive).toBeLessThanOrEqual(8);
  });

  it('writes the real bytes for a source that does not inline content', async () => {
    // The Graph drive source's shape. Every file here used to be written as
    // zero bytes and reported as created.
    const { source, release } = observableSource(5);
    const { target, written } = recordingTarget(release);

    await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger: emptyLedger,
      concurrency: 2,
    } as never);

    expect(written).toHaveLength(5);
    for (const w of written) {
      expect(w.bytes, `${w.path} was written empty`).toBe(1024);
    }
  });

  it('fails the item rather than writing an empty file', async () => {
    // A source that lists a file and then cannot produce its bytes is broken.
    // Substituting an empty file is not a recovery — it is data loss that
    // both halves of verification would agree was fine.
    const source: FileSource = {
      async listFolders() {
        return [FOLDER];
      },
      async listSince() {
        return { items: metadata(1), nextCursor: { value: 'c1' } as SyncCursor };
      },
      async fetch(item: FileItem) {
        return { item };
      },
    };
    const { target, written } = recordingTarget(() => {});

    // The item is FAILED, not substituted and not fatal.
    //
    // This used to assert that the whole pass rejected. Per-item isolation
    // changed the blast radius, not the guarantee: what must never happen is
    // an empty file being written and recorded as migrated, and that is what
    // is asserted below. The pass now carries on so one unreadable file cannot
    // hold up the other 1500, and the item is recorded with its verbatim error
    // for the operator's queue.
    const result = await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger: emptyLedger,
      concurrency: 1,
    } as never);

    expect(written, 'an empty file is data loss, not a recovery').toHaveLength(0);
    expect(result.failed).toBe(1);
    expect(result.created).toBe(0);
    expect(result.failures[0]!.lastError).toMatch(/no content for docs\/file-0\.bin/);
  });

  it('still honours a source that does inline content, without re-fetching', async () => {
    // Not every source needs a second round trip. One that already has the
    // bytes must not be made to fetch them again.
    let fetches = 0;
    const inlined = metadata(3).map((f) => ({ ...f, content: new Uint8Array(7) }));
    const source: FileSource = {
      async listFolders() {
        return [FOLDER];
      },
      async listSince() {
        return { items: inlined, nextCursor: { value: 'c1' } as SyncCursor };
      },
      async fetch(item: FileItem) {
        fetches++;
        return { item, content: new Uint8Array(0) };
      },
    };
    const { target, written } = recordingTarget(() => {});

    await runFileSync({
      tenantId: TENANT,
      mappingId: MAPPING,
      source,
      target,
      ledger: emptyLedger,
      concurrency: 2,
    } as never);

    expect(fetches).toBe(0);
    expect(written.map((w) => w.bytes)).toEqual([7, 7, 7]);
  });
});
