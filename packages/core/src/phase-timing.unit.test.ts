// Copyright 2026 The Ownpace authors (Apache-2.0)

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
  return (await runMeasured(opts)).line;
}

/**
 * The same run, with what each phase ACTUALLY took beside the log line: the
 * stubs time themselves on the clock the instrument uses, so a late timer
 * lands in both.
 */
async function runMeasured(opts: {
  count: number;
  fetchMs: number;
  upsertMs: number;
  concurrency: number;
}): Promise<{ line: string; actual: { fetchMs: number; upsertMs: number } }> {
  const actual = { fetchMs: 0, upsertMs: 0 };
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
      const t0 = performance.now();
      await sleep(opts.fetchMs);
      actual.fetchMs += performance.now() - t0;
      return { raw: {}, sizeBytes: 1 };
    },
    upsert: async () => {
      const t0 = performance.now();
      await sleep(opts.upsertMs);
      actual.upsertMs += performance.now() - t0;
      return { targetId: 't', created: true };
    },
    naturalKey: (i: unknown) => (i as { id: string }).id,
    contentHash: () => 'h',
    ensureCollection: async () => 'coll',
  } as never);

  return { line: lines.find((l) => l.startsWith('[timing]')) ?? '', actual };
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
    // Writes are asked to cost 4x what reads cost.
    const FETCH_MS = 5;
    const UPSERT_MS = 20;
    const COUNT = 8;
    const { line, actual } = await runMeasured({
      count: COUNT,
      fetchMs: FETCH_MS,
      upsertMs: UPSERT_MS,
      concurrency: 2,
    });

    const fetchPer = Number(/source-fetch [\d.]+s \(([\d.]+)ms\/item\)/.exec(line)?.[1]);
    const writePer = Number(/target-write [\d.]+s \(([\d.]+)ms\/item\)/.exec(line)?.[1]);

    expect(fetchPer).toBeGreaterThan(0);
    expect(writePer).toBeGreaterThan(0);

    /**
     * AGAINST WHAT EACH PHASE ACTUALLY TOOK, not what it was asked to take —
     * the third form of this bar, and the reason for each is the reason for
     * the next.
     *
     *  1. `writePer > fetchPer * 2` — a ratio. Additive noise compresses a
     *     ratio, so it was a bar on how idle the machine was: green on every
     *     GitHub-hosted runner, red on the self-hosted arm64 box that builds
     *     `main` (ratio 1.86, from #1049's merge onward).
     *  2. `writePer - fetchPer > 7.5` — a difference, on 2026-09-21, because
     *     additive noise cancels in one. Measured then at 12.1 on that box.
     *  3. Red on `main` again on 2026-09-23 at 6.1, on the same box while it
     *     built images and ran a live preflight. The noise is not additive: a
     *     blocked event loop fires a 5 ms timer late by nearly the whole block
     *     and a 20 ms timer, due later, barely at all. The two requested
     *     durations converge, and no bar on them survives a busy enough host.
     *
     * The stubs now time themselves on the clock the instrument uses
     * (`performance.now()`, around the same awaits). A late timer lands in
     * both figures, so what is left between them is the instrument alone —
     * which is the property: the time is booked to the phase that spent it.
     * Swap the two phases and each figure lands on the OTHER phase's actual,
     * which the requested 5 ms against 20 ms keeps well apart.
     *
     * The tolerance covers the one-decimal rounding of the report and the
     * microtask between a stub returning and the instrument reading the
     * clock; the host's load is in both numbers and needs none.
     */
    const TOLERANCE_MS = 2;
    expect(Math.abs(fetchPer - actual.fetchMs / COUNT)).toBeLessThan(TOLERANCE_MS);
    expect(Math.abs(writePer - actual.upsertMs / COUNT)).toBeLessThan(TOLERANCE_MS);
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
