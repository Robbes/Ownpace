// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE WORKER'S LIMIT ON RUNS AT ONCE, AND THE LOOP THAT KEEPS TO IT (ADR-0054;
 * workplan 0167, the T9 row's alpha.17 part).
 *
 * Trigger.dev's plane admitted at most `MAX_PASSES_IN_FLIGHT` + 2 runs at
 * once on a stack until alpha.18: a run past that limit stayed QUEUED in its
 * own queue, was dequeued once a run ended, and neither failed nor spent an
 * attempt for having waited. The worker keeps the same limit, by the
 * same rule: a run past it is NOT FETCHED. It stays `created` in its pg-boss
 * queue, at the attempt it had, its time limit not yet counting (pg-boss counts
 * it from the fetch), and a stop leaves it there for the next worker.
 *
 * So the limit is counted before the fetch, never after it. A run that pg-boss
 * had already handed over cannot be handed back safely: `restore()` puts it
 * back at the same attempt, and the settlement pg-boss's own `work()` then
 * writes for the run it handed over is fenced on that attempt, so it could
 * land on whichever worker claimed the run next. That is why each queue is
 * worked by {@link workQueue}, on pg-boss's public `fetch`, `touch`,
 * `complete` and `fail`, and not by pg-boss's `work()`, whose loop fetches
 * whenever it is idle.
 *
 * - {@link RunSlots} is the count: one slot a run, taken before its fetch,
 *   given back by an empty fetch at once, and by a run once it has settled.
 *   A queue that finds every slot taken waits in line, and a slot given back
 *   goes to the first in line. A queue goes to the back of the line each time
 *   it asks again, so the queues take turns, and a queue with many runs
 *   waiting does not take every slot that frees: no kind of run is put ahead
 *   of another, as Trigger.dev put none ahead at its limit.
 * - {@link workQueue} is one queue's loop: at most `concurrency` of its runs
 *   at once, and each only with a slot.
 *
 * A CLAIM THAT LANDS AS THE STOP COMES (a fetch under way when the stop came)
 * was never started, so it goes back to its queue at the attempt it had. A
 * queue's policy can refuse it back: on a stately queue one run waits as
 * `created`, and that place may be taken. pg-boss's own give-back then leaves
 * the claim active and runs it (`#giveBack`, beside `fetch` in its manager),
 * and so does this loop: under its slot, and under its own attempt, which
 * every beat and settlement is fenced on.
 *
 * DATA AND TIMERS ONLY: it imports nothing, so it is held to its word without
 * a database (`run-slots.unit.test.ts`).
 */

/** A count of runs at once, shared by every queue a worker works. */
export class RunSlots {
  readonly limit: number;
  #inUse = 0;
  readonly #line: Array<(taken: boolean) => void> = [];

  /** `limit`: a whole number, at least 1, or `Infinity` for no limit. */
  constructor(limit: number) {
    if (limit !== Number.POSITIVE_INFINITY && (!Number.isInteger(limit) || limit < 1)) {
      throw new RangeError(`A worker's limit on runs at once must be a whole number, at least 1, and was given as ${String(limit)}.`);
    }
    this.limit = limit;
  }

  /** Slots taken now: runs going, and fetches under way. */
  get inUse(): number {
    return this.#inUse;
  }

  /** Queues waiting in line for a slot. */
  get waiting(): number {
    return this.#line.length;
  }

  /** A slot now, or false; never ahead of a queue already in line. */
  tryTake(): boolean {
    if (this.#line.length > 0 || this.#inUse >= this.limit) return false;
    this.#inUse += 1;
    return true;
  }

  /**
   * A slot, waiting in line for one if need be: true once taken, false when
   * `signal` aborts first (a stop), with nothing taken.
   */
  take(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (this.tryTake()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onAbort = (): void => {
        const at = this.#line.indexOf(handOver);
        if (at >= 0) this.#line.splice(at, 1);
        resolve(false);
      };
      const handOver = (taken: boolean): void => {
        signal.removeEventListener('abort', onAbort);
        resolve(taken);
      };
      this.#line.push(handOver);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Give a slot back: to the first queue in line, or to the count. */
  give(): void {
    if (this.#inUse <= 0) throw new Error('A run slot was given back that was never taken.');
    const next = this.#line.shift();
    // Handed over as it is: still taken, now by the queue first in line.
    if (next !== undefined) next(true);
    else this.#inUse -= 1;
  }
}

/** A run pg-boss handed this worker: what its fetch returns. */
export interface ClaimedRun<P> {
  readonly id: string;
  /** The attempt the claim holds (pg-boss's `retry_count`): every settle and beat is fenced on it. */
  readonly retryCount: number;
  readonly expireInSeconds: number;
  readonly heartbeatSeconds: number | null;
  readonly data: P;
}

/** How a run settles: pg-boss's three answers to a fetched run. */
export interface Settlement {
  readonly status: 'completed' | 'failed' | 'deadletter';
  readonly output: object;
}

/** What a queue's loop asks of pg-boss, said so a test can stand in for it. */
export interface QueueSource<P> {
  /** Claim the next run, or null when none may start. */
  fetch(): Promise<ClaimedRun<P> | null>;
  /** Beat for a claim: true while it holds, false once it is gone (a cancel, a lapse). */
  touch(run: ClaimedRun<P>): Promise<boolean>;
  /** Settle a claim, fenced on its attempt. */
  settle(run: ClaimedRun<P>, settlement: Settlement): Promise<void>;
  /**
   * Put back a claim that landed after a stop, at the attempt it had, before it started: true
   * once it is back in its queue, or no longer this worker's; false when its queue's policy
   * refuses it back, and the claim, still this worker's, is to be run.
   */
  giveBack(run: ClaimedRun<P>): Promise<boolean>;
}

export interface WorkQueueOptions<P> {
  readonly queue: string;
  readonly source: QueueSource<P>;
  readonly slots: RunSlots;
  /** At most this many of the queue's runs at once. */
  readonly concurrency: number;
  /** How long a queue found empty waits before it asks again. */
  readonly pollingIntervalMs: number;
  /** Aborted at a stop: nothing more is fetched. The runs going are not stopped by it. */
  readonly stop: AbortSignal;
  /** Runs one claim to its settlement. `signal` aborts when the claim is lost. */
  readonly run: (claimed: ClaimedRun<P>, signal: AbortSignal) => Promise<Settlement>;
  /** Told of a run that started, to be waited for at a stop. */
  readonly started: (settled: Promise<void>) => void;
  /** What failed in the loop itself (a fetch, a beat, a settle); the loop goes on. */
  readonly onError: (err: unknown) => void;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Work one queue until `stop` aborts: take a slot, then fetch; a queue found
 * empty gives its slot back at once and asks again after the polling interval;
 * a run keeps its slot until it has settled. A claim that lands as the stop
 * comes is given back, or run where its queue refuses it back. Resolves once
 * the loop has stopped fetching; the runs it started settle on their own, each
 * told to `started` before it resolves.
 */
export async function workQueue<P>(opts: WorkQueueOptions<P>): Promise<void> {
  const { source, slots, stop } = opts;
  let going = 0;
  // Woken when one of this queue's runs ends, or at the stop.
  let freed: (() => void) | null = null;
  const queueFreed = (): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        stop.removeEventListener('abort', done);
        freed = null;
        resolve();
      };
      freed = done;
      stop.addEventListener('abort', done, { once: true });
    });

  while (!stop.aborted) {
    if (going >= opts.concurrency) {
      await queueFreed();
      continue;
    }
    if (!(await slots.take(stop))) break;
    let claimed: ClaimedRun<P> | null;
    try {
      claimed = await source.fetch();
    } catch (err) {
      slots.give();
      opts.onError(err);
      await pause(opts.pollingIntervalMs, stop);
      continue;
    }
    if (claimed === null) {
      slots.give();
      await pause(opts.pollingIntervalMs, stop);
      continue;
    }
    if (stop.aborted) {
      // Claimed as the stop came: never started, so back to its queue at its attempt. Where its
      // queue's policy refuses it back, the claim is still this worker's, and it runs below, on
      // the slot it holds, as pg-boss runs a claim it cannot give back; the stop waits for it as
      // for the runs already going. A give-back that failed otherwise leaves the claim to
      // pg-boss's heartbeat sweep, as pg-boss leaves one whose give-back threw.
      let back = true;
      try {
        back = await source.giveBack(claimed);
      } catch (err) {
        opts.onError(err);
      }
      if (back) {
        slots.give();
        break;
      }
    }
    going += 1;
    const run = claimed;
    const settled = runOne(opts, run).finally(() => {
      going -= 1;
      slots.give();
      const wake: (() => void) | null = freed;
      wake?.();
    });
    opts.started(settled);
  }
}

/** One claim: beat for it, run it, settle it. Never rejects; a failure to settle is `onError`'s. */
async function runOne<P>(opts: WorkQueueOptions<P>, run: ClaimedRun<P>): Promise<void> {
  const claim = new AbortController();
  let beat: ReturnType<typeof setInterval> | null = null;
  if (run.heartbeatSeconds !== null && run.heartbeatSeconds > 0) {
    beat = setInterval(() => {
      if (claim.signal.aborted) return;
      opts.source.touch(run).then(
        (held) => {
          if (!held && !claim.signal.aborted) {
            claim.abort(new Error(`run ${run.id} on "${opts.queue}" is no longer active under this worker's claim`));
          }
        },
        // A beat that could not be written says nothing about the claim: nothing is aborted.
        opts.onError,
      );
    }, (run.heartbeatSeconds * 1000) / 2);
  }
  try {
    const settlement = await opts.run(run, claim.signal);
    await opts.source.settle(run, settlement);
  } catch (err) {
    // `run` settles every error of the run itself into a Settlement; what lands here is the settle's.
    opts.onError(err);
  } finally {
    if (beat !== null) clearInterval(beat);
  }
}
