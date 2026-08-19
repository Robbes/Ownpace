// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The phase-timing instrument, and specifically that its `overlap` number
 * means what the report says it means.
 *
 * Three rounds of reasoning from run logs produced two confident wrong answers
 * about where the file domain's 630 s goes. Both were measured and both were
 * dead. The logs only carry a total, so no amount of staring settles it.
 *
 * An instrument that is itself wrong would be worse than none — it would
 * produce a THIRD confident wrong answer. So these tests drive the real
 * `runDomainSync` with phases of known duration and check the arithmetic.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { asTenantId, asMappingId, setLogLevel, resetLogLevel, type Ledger } from '@openmig/shared';
import { runDomainSync } from './domain-sync.ts';

const TENANT = asTenantId('9a110000-e29b-41d4-a716-446655449901' as never);
const MAPPING = asMappingId('9a110000-e29b-41d4-a716-446655449902' as never);

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
  // An empty ledger has placed nothing. `runDomainSync` calls this on a full
  // file-domain scan to look for moves, and a stub without it fails the pass
  // with a TypeError that reads like a source error.
  placedItems: async () => [],
} as unknown as Ledger;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `count` items where the source fetch takes `fetchMs` and the target
 * write takes `upsertMs`, at the given concurrency, and return the log line.
 */
async function runWithTiming(opts: {
  count: number;
  fetchMs: number;
  upsertMs: number;
  concurrency: number;
}): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });

  const items = Array.from({ length: opts.count }, (_, i) => ({ id: `i${i}` }));

  await runDomainSync({
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file',
    source: {},
    target: {},
    ledger: emptyLedger,
    concurrency: opts.concurrency,
    listFolders: async () => [{ path: 'f' }],
    listSince: async () => ({ items, nextCursor: { value: 'c' } }),
    fetchRaw: async () => {
      await sleep(opts.fetchMs);
      return { raw: {}, sizeBytes: 1 };
    },
    upsert: async () => {
      await sleep(opts.upsertMs);
      return { targetId: 't', created: true };
    },
    naturalKey: (i: unknown) => (i as { id: string }).id,
    contentHash: () => 'h',
    ensureCollection: async () => 'coll',
  } as never);

  return lines.find((l) => l.startsWith('[timing]')) ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
  resetLogLevel();
});

describe('phase timing', () => {
  it('reports nothing at all unless explicitly enabled', async () => {
    // It must cost nothing and say nothing at the default level.
    setLogLevel('info');
    const line = await runWithTiming({ count: 4, fetchMs: 1, upsertMs: 1, concurrency: 2 });
    expect(line).toBe('');
  });

  it('attributes time to the phase that actually spent it', async () => {
    setLogLevel('debug');
    // Writes cost 4x what reads cost, so the report must say so.
    const line = await runWithTiming({ count: 8, fetchMs: 5, upsertMs: 20, concurrency: 2 });

    const fetchPer = Number(/source-fetch [\d.]+s \(([\d.]+)ms\/item\)/.exec(line)?.[1]);
    const writePer = Number(/target-write [\d.]+s \(([\d.]+)ms\/item\)/.exec(line)?.[1]);

    expect(fetchPer).toBeGreaterThan(0);
    expect(writePer).toBeGreaterThan(fetchPer * 2);
  });

  it('reports overlap near 1 when the pass is effectively serial', async () => {
    setLogLevel('debug');
    // concurrency 1: busy time and wall time are the same thing.
    const line = await runWithTiming({ count: 6, fetchMs: 10, upsertMs: 10, concurrency: 1 });

    const overlap = Number(/overlap ([\d.]+)x/.exec(line)?.[1]);
    expect(overlap).toBeGreaterThan(0.7);
    expect(overlap).toBeLessThan(1.3);
  });

  it('reports overlap near the concurrency when work really is in flight', async () => {
    setLogLevel('debug');
    // This is the load-bearing case. If a real run comes back near 1.0 with
    // concurrency 4, the pool is not delivering — and that reading is only
    // trustworthy because this test shows a healthy pool reads near 4.
    const line = await runWithTiming({ count: 16, fetchMs: 10, upsertMs: 10, concurrency: 4 });

    const overlap = Number(/overlap ([\d.]+)x/.exec(line)?.[1]);
    expect(overlap).toBeGreaterThan(2.5);
    expect(overlap).toBeLessThanOrEqual(4.5);
  });

  it('names the domain and the item count', async () => {
    setLogLevel('debug');
    const line = await runWithTiming({ count: 5, fetchMs: 1, upsertMs: 1, concurrency: 2 });

    expect(line).toContain('[timing] file:');
    expect(line).toContain('5 items');
  });
});
