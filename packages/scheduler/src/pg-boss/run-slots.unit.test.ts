// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORKER'S LIMIT ON RUNS AT ONCE, WITHOUT A DATABASE (ADR-0054; workplan
 * 0167, the T9 row's alpha.17 part).
 *
 * `workQueue` over a stand-in for pg-boss that keeps its runs in memory, as
 * pg-boss keeps them in its table: `created` until fetched, `active` while
 * claimed, then settled. Held here: with the limit's runs going, no queue
 * fetches the next; when one ends, the next starts; nothing the limit holds
 * back fails, spends an attempt or is settled; the queues take turns at a
 * freed slot; and a stop fetches nothing more, lets the runs going
 * settle, and leaves the rest in their queues. The same on a real Postgres:
 * `apps/worker/src/runner/worker.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { RunSlots, workQueue, type ClaimedRun, type QueueSource, type Settlement } from './run-slots.ts';

interface Row {
  readonly id: string;
  state: 'created' | 'active' | 'completed' | 'failed';
  retryCount: number;
}

/** pg-boss, in memory: one table of runs per queue, and what was asked of it. */
class Store {
  readonly rows = new Map<string, Row[]>();
  readonly settled: Array<{ queue: string; id: string; settlement: Settlement }> = [];
  fetches = 0;

  add(queue: string, n: number): void {
    const rows = this.rows.get(queue) ?? [];
    for (let i = 0; i < n; i += 1) rows.push({ id: `${queue}#${rows.length + 1}`, state: 'created', retryCount: 0 });
    this.rows.set(queue, rows);
  }

  source(queue: string): QueueSource<null> {
    return {
      fetch: () => {
        this.fetches += 1;
        const row = (this.rows.get(queue) ?? []).find((r) => r.state === 'created');
        if (row === undefined) return Promise.resolve(null);
        row.state = 'active';
        const run: ClaimedRun<null> = { id: row.id, retryCount: row.retryCount, expireInSeconds: 3600, heartbeatSeconds: null, data: null };
        return Promise.resolve(run);
      },
      touch: () => Promise.resolve(true),
      settle: (run, settlement) => {
        const row = this.rows.get(queue)!.find((r) => r.id === run.id)!;
        row.state = settlement.status === 'completed' ? 'completed' : 'failed';
        this.settled.push({ queue, id: run.id, settlement });
        return Promise.resolve();
      },
      giveBack: (run) => {
        this.rows.get(queue)!.find((r) => r.id === run.id)!.state = 'created';
        return Promise.resolve();
      },
    };
  }

  count(state: Row['state']): number {
    return [...this.rows.values()].flat().filter((r) => r.state === state).length;
  }
}

/** Runs that hold until the test lets them end, in the order they started. */
class Gate {
  readonly started: string[] = [];
  readonly #release = new Map<string, () => void>();

  run = (claimed: ClaimedRun<null>): Promise<Settlement> => {
    this.started.push(claimed.id);
    return new Promise((resolve) => {
      this.#release.set(claimed.id, () => resolve({ status: 'completed', output: { value: null } }));
    });
  };

  end(id: string): void {
    const release = this.#release.get(id);
    if (release === undefined) throw new Error(`${id} is not going`);
    this.#release.delete(id);
    release();
  }

  get going(): string[] {
    return [...this.#release.keys()];
  }
}

const tick = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick();
  }
}

/** Every queue worked as the worker works the catalog: each its own concurrency, one limit for all. */
function work(store: Store, gate: Gate, queues: Record<string, number>, limit: number) {
  const slots = new RunSlots(limit);
  const stop = new AbortController();
  const going = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const loops = Object.entries(queues).map(([queue, concurrency]) =>
    workQueue<null>({
      queue,
      source: store.source(queue),
      slots,
      concurrency,
      pollingIntervalMs: 20,
      stop: stop.signal,
      run: gate.run,
      started: (p) => {
        going.add(p);
        void p.finally(() => going.delete(p));
      },
      onError: (err) => errors.push(err),
    }),
  );
  return { slots, stop, going, errors, loops };
}

describe('RunSlots: one count for every queue', () => {
  it('takes up to its limit, and refuses a limit that is not a whole number of at least 1', () => {
    const slots = new RunSlots(2);
    expect([slots.tryTake(), slots.tryTake(), slots.tryTake()]).toEqual([true, true, false]);
    expect(slots.inUse).toBe(2);
    slots.give();
    expect(slots.inUse).toBe(1);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => new RunSlots(bad)).toThrow(RangeError);
    expect(new RunSlots(Number.POSITIVE_INFINITY).tryTake()).toBe(true);
    expect(() => new RunSlots(1).give()).toThrow(/never taken/);
  });

  it('hands a freed slot to the first in line, never to one that comes later, and lets a stop leave the line', async () => {
    const slots = new RunSlots(1);
    expect(slots.tryTake()).toBe(true);
    const order: string[] = [];
    const stopB = new AbortController();
    const a = slots.take(new AbortController().signal).then((t) => order.push(`a:${t}`));
    const b = slots.take(stopB.signal).then((t) => order.push(`b:${t}`));
    const c = slots.take(new AbortController().signal).then((t) => order.push(`c:${t}`));
    expect(slots.waiting).toBe(3);
    // Nobody jumps the line, however it asks.
    expect(slots.tryTake()).toBe(false);
    stopB.abort();
    await b;
    expect(slots.waiting).toBe(2);
    slots.give();
    await a;
    expect(slots.inUse).toBe(1);
    slots.give();
    await c;
    expect(order).toEqual(['b:false', 'a:true', 'c:true']);
    slots.give();
    expect(slots.inUse).toBe(0);
  });
});

describe('workQueue: at the limit, the next run waits in its queue', () => {
  // MAX_PASSES_IN_FLIGHT 3: the limit is 5, the passes' queue 4, every other queue 1.
  const QUEUES = { 'managed-sync-tick': 1, 'run-delta-sync': 4, 'run-discovery': 1, 'run-verification': 1, 'run-cutover': 1 };

  it('with the limit going, nothing more is fetched; when one ends the next starts; none fails or spends an attempt', async () => {
    const store = new Store();
    const gate = new Gate();
    for (const q of Object.keys(QUEUES)) store.add(q, 3);
    const w = work(store, gate, QUEUES, 5);

    await until('five runs to start', () => gate.going.length === 5);
    await tick(100);
    expect(gate.going).toHaveLength(5);
    expect(w.slots.inUse).toBe(5);
    expect(store.count('active')).toBe(5);
    expect(store.count('created')).toBe(15 - 5);
    // Waiting, the other queues ask pg-boss nothing: their fetches stop at the limit.
    const fetchesAtTheLimit = store.fetches;
    await tick(100);
    expect(store.fetches).toBe(fetchesAtTheLimit);

    gate.end(gate.going[0]!);
    await until('a sixth run to start', () => gate.started.length === 6);
    expect(gate.going).toHaveLength(5);

    // Let every run end as it comes, to the last.
    while (store.count('completed') < 15) {
      for (const id of gate.going) gate.end(id);
      await tick();
      expect(gate.going.length).toBeLessThanOrEqual(5);
    }
    expect(store.settled.map((s) => s.settlement.status)).toEqual(Array(15).fill('completed'));
    expect([...store.rows.values()].flat().every((r) => r.retryCount === 0)).toBe(true);
    expect(store.count('failed')).toBe(0);
    expect(w.errors).toEqual([]);
    w.stop.abort();
    await Promise.all(w.loops);
  });

  it('never runs more than the limit, nor more of a queue than its own concurrency, under churn', async () => {
    const store = new Store();
    const most = { total: 0, passes: 0 };
    const going = new Map<string, number>();
    let passes = 0;
    const run = async (claimed: ClaimedRun<null>): Promise<Settlement> => {
      const isPass = claimed.id.startsWith('run-delta-sync');
      going.set(claimed.id, 1);
      if (isPass) passes += 1;
      most.total = Math.max(most.total, going.size);
      most.passes = Math.max(most.passes, passes);
      await tick(Math.floor(Math.random() * 10));
      going.delete(claimed.id);
      if (isPass) passes -= 1;
      return { status: 'completed', output: {} };
    };
    for (const q of Object.keys(QUEUES)) store.add(q, 20);
    const slots = new RunSlots(5);
    const stop = new AbortController();
    const loops = Object.entries(QUEUES).map(([queue, concurrency]) =>
      workQueue<null>({ queue, source: store.source(queue), slots, concurrency, pollingIntervalMs: 5, stop: stop.signal, run, started: () => {}, onError: (e) => { throw e; } }),
    );
    await until('every run to complete', () => store.count('completed') === 100, 10_000);
    expect(most.total).toBe(5);
    expect(most.passes).toBeLessThanOrEqual(4);
    stop.abort();
    await Promise.all(loops);
    expect(slots.inUse).toBe(0);
  });

  it('the queues take turns: a queue with many runs waiting does not take every slot that frees', async () => {
    const store = new Store();
    const gate = new Gate();
    store.add('run-delta-sync', 5);
    const w = work(store, gate, { 'run-delta-sync': 4, 'run-cutover': 1 }, 2);
    await until('two passes to start', () => gate.going.length === 2);
    // The passes' queue is in line already, for its third; the cutover joins behind it.
    store.add('run-cutover', 1);
    await tick(60);
    gate.end('run-delta-sync#1');
    await until('one more run to start', () => gate.started.length === 3);
    expect(gate.started[2]).toBe('run-delta-sync#3');
    // The passes' queue asked, and went to the back of the line: the next slot is the cutover's.
    gate.end('run-delta-sync#2');
    await until('the next run to start', () => gate.started.length === 4);
    expect(gate.started[3]).toBe('run-cutover#1');
    while (store.count('completed') < 6) {
      for (const id of gate.going) gate.end(id);
      await tick();
    }
    w.stop.abort();
    await Promise.all(w.loops);
  });

  it('a stop fetches nothing more, lets the runs going settle, and leaves the waiting runs in their queues, unclaimed', async () => {
    const store = new Store();
    const gate = new Gate();
    for (const q of Object.keys(QUEUES)) store.add(q, 2);
    const w = work(store, gate, QUEUES, 5);
    await until('five runs to start', () => gate.going.length === 5);

    w.stop.abort();
    // Every loop stops at once, with runs still going: it waits for nothing of theirs.
    await Promise.all(w.loops);
    const fetches = store.fetches;
    for (const id of gate.going) gate.end(id);
    await Promise.all([...w.going]);
    await tick(60);
    expect(store.fetches).toBe(fetches);
    expect(store.count('completed')).toBe(5);
    expect(store.count('created')).toBe(10 - 5);
    expect(store.count('failed')).toBe(0);
    expect(w.slots.inUse).toBe(0);
    expect(w.slots.waiting).toBe(0);
  });

  it('a run claimed as the stop came is given back to its queue, at its attempt, and never started', async () => {
    const store = new Store();
    store.add('run-discovery', 1);
    const stop = new AbortController();
    const base = store.source('run-discovery');
    const source: QueueSource<null> = {
      ...base,
      fetch: async () => {
        const run = await base.fetch();
        stop.abort();
        return run;
      },
    };
    const started: string[] = [];
    await workQueue<null>({
      queue: 'run-discovery',
      source,
      slots: new RunSlots(5),
      concurrency: 1,
      pollingIntervalMs: 5,
      stop: stop.signal,
      run: (c) => {
        started.push(c.id);
        return Promise.resolve({ status: 'completed', output: {} });
      },
      started: () => {},
      onError: (e) => {
        throw e;
      },
    });
    expect(started).toEqual([]);
    expect(store.rows.get('run-discovery')).toEqual([{ id: 'run-discovery#1', state: 'created', retryCount: 0 }]);
  });

  it('a fetch that fails gives its slot back and is said; the loop goes on', async () => {
    const store = new Store();
    store.add('run-discovery', 1);
    const base = store.source('run-discovery');
    let failOnce = true;
    const source: QueueSource<null> = {
      ...base,
      fetch: () => {
        if (failOnce) {
          failOnce = false;
          return Promise.reject(new Error('connection reset'));
        }
        return base.fetch();
      },
    };
    const slots = new RunSlots(1);
    const stop = new AbortController();
    const errors: unknown[] = [];
    const loop = workQueue<null>({
      queue: 'run-discovery',
      source,
      slots,
      concurrency: 1,
      pollingIntervalMs: 5,
      stop: stop.signal,
      run: () => Promise.resolve({ status: 'completed', output: {} }),
      started: () => {},
      onError: (e) => errors.push(e),
    });
    await until('the run to complete', () => store.count('completed') === 1);
    stop.abort();
    await loop;
    expect(errors).toEqual([new Error('connection reset')]);
    expect(slots.inUse).toBe(0);
  });
});
