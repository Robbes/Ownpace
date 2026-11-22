// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE PASS, ONE PROCESS (ADR-0054; workplan 0167, point 8).
 *
 * Trigger.dev runs every task run in a container of its own, capped at
 * `small-1x` (half a CPU, 512 MB), so a pass that runs away takes only itself
 * down. A pg-boss worker runs its handlers in its own process, so a runaway
 * pass would take the worker, and every other run on it, with it.
 *
 * This forks one Node process per run instead, with V8's heap capped. A pass
 * that outgrows the cap dies alone; the worker sees the child's exit, fails
 * that run (to be retried), and carries on. A cancel kills the child outright.
 *
 * WHAT THE CHILD SAYS GOES TO THE CONTAINER'S OUTPUT, AND NOWHERE ELSE. Every
 * line the child writes to stdout or stderr is forwarded to the parent's own,
 * prefixed with `label` (the queue and the run id), because a job's
 * `log.error`/`log.warn` is the operator's only copy of those words
 * (`apps/worker/src/jobs/what-a-run-leaves.ts`). None of it is put into what
 * the run hands back: a child that dies is reported by a fixed sentence and a
 * `verdict`, read from its stderr line by line, never by the text itself. What
 * a run that fails on its own stores is the `{ name, message }` of the error it
 * threw, and the jobs' own wrapper already makes that a category and a
 * reference, without a tester's words.
 *
 * A CHILD NEVER OUTLIVES ITS PARENT. A worker killed outright leaves its run
 * `active` until the heartbeat lapses, and pg-boss then retries it; a child
 * still writing at that moment would be a second writer on one mapping. So the
 * child exits the moment its IPC channel to the parent closes, which the
 * kernel does when the parent dies, by any signal.
 *
 * The CPU half of `small-1x` is not something a process can set on itself:
 * that stays the worker container's `cpus:` (Compose) or `resources.limits`
 * (Kubernetes), the same cgroup mechanism Trigger.dev's runner containers use.
 */

import { fork } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/** How a run's process ended without answering. */
export type ChildDeath = 'out-of-memory' | 'killed' | 'exited';

export class ChildRunDied extends Error {
  override name = 'ChildRunDied';
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly verdict: ChildDeath;
  constructor(code: number | null, signal: NodeJS.Signals | null, verdict: ChildDeath, maxOldSpaceMb: number) {
    const how =
      verdict === 'out-of-memory'
        ? `ran out of its ${maxOldSpaceMb} MB heap`
        : verdict === 'killed'
          ? 'was killed'
          : 'exited';
    super(`The run's process ${how} (code ${String(code)}, signal ${String(signal)}) before it answered.`);
    this.code = code;
    this.signal = signal;
    this.verdict = verdict;
  }
}

/**
 * A run whose process ran out of its heap. Not retried: the retry meets the
 * same heap, and Trigger.dev, whose behaviour the managed jobs keep, does not
 * retry an out-of-memory run unless a task asks it to, and none does.
 */
export class RunOutOfMemory extends ChildRunDied {
  override name = 'RunOutOfMemory';
  constructor(code: number | null, signal: NodeJS.Signals | null, maxOldSpaceMb: number) {
    super(code, signal, 'out-of-memory', maxOldSpaceMb);
  }
}

/**
 * The argument `runInChild` forks with, and the one `serveRuns` waits for. A
 * process with an IPC channel that was not forked by `runInChild` (a test
 * runner's worker, say) is never served, nor killed when its channel closes.
 */
const RUN_IN_CHILD_MARKER = '--ownpace-run-in-child';

/**
 * V8's line when the heap is exhausted. Matched on every line, because V8
 * writes it as the process dies, after everything the run already said on the
 * same stream.
 */
const HEAP_DEATH = /^FATAL ERROR:.*heap/i;

/** What the forked run is told about itself, beside its payload. */
export interface ChildRunInfo {
  readonly queue: string;
  readonly runId: string;
  readonly attempt: number;
}

export interface RunInChildOptions {
  /** V8's old-space cap for the child, in MB. 410 is `small-1x`'s V8 share. */
  readonly maxOldSpaceMb: number;
  /** Which of the entry's `serveRuns` handlers to call. Default `run`. */
  readonly call?: string;
  /** Aborting kills the child with SIGKILL; the promise settles once it has exited. */
  readonly signal?: AbortSignal;
  /** Handed to the run as its second argument. */
  readonly run?: ChildRunInfo;
  /** Put before every line the child writes, as `[label] `. Default: the run's queue and id, when given. */
  readonly label?: string;
  /** Where the child's lines go. Default: this process's own stdout and stderr. */
  readonly output?: { readonly stdout: Writable; readonly stderr: Writable };
}

type RunFn = (payload: unknown, run: ChildRunInfo | undefined) => unknown;

interface Order {
  readonly call: string;
  readonly payload: unknown;
  readonly run?: ChildRunInfo;
}

type Answer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly name: string; readonly message: string } };

/**
 * Call this at the bottom of a module `runInChild` forks: it answers the one
 * order the parent sends, with the handler the order names, then exits. The
 * module is the process's entry, so nothing here imports a computed name.
 */
export function serveRuns(handlers: Readonly<Record<string, RunFn>>): void {
  if (typeof process.send !== 'function' || !process.argv.includes(RUN_IN_CHILD_MARKER)) return;
  // The parent is gone (killed, or crashed): so is the claim on this run.
  process.once('disconnect', () => process.kill(process.pid, 'SIGKILL'));
  process.once('message', (order: Order) => {
    void (async () => {
      let answer: Answer;
      try {
        const fn = handlers[order.call];
        if (typeof fn !== 'function') throw new Error(`This run process has no run named "${order.call}".`);
        answer = { ok: true, value: await fn(order.payload, order.run) };
      } catch (err) {
        // The name crosses the IPC so the parent can tell "do not retry" from a failure.
        const error =
          err instanceof Error ? { name: err.name, message: err.message } : { name: 'NonError', message: String(err) };
        answer = { ok: false, error };
      }
      process.send?.(answer, () => process.exit(answer.ok ? 0 : 1));
    })();
  });
}

function forwardLines(
  from: Readable | null,
  to: Writable,
  prefix: string,
  onLine: (line: string) => void = () => undefined,
): Promise<void> {
  if (!from) return Promise.resolve();
  const lines = createInterface({ input: from, crlfDelay: Infinity });
  lines.on('line', (line) => {
    to.write(`${prefix}${line}\n`);
    onLine(line);
  });
  return new Promise((resolve) => lines.once('close', resolve));
}

/**
 * Fork `entryUrl` (a module ending in `serveRuns(...)`), hand it the payload,
 * and resolve with what the named run returns. Settles only once the child has
 * exited and its output has been forwarded, so a caller that settles the run
 * next never does so beside a child still running.
 */
export function runInChild(entryUrl: string, payload: unknown, opts: RunInChildOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(entryUrl), [RUN_IN_CHILD_MARKER], {
      execArgv: [`--max-old-space-size=${opts.maxOldSpaceMb}`],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    const label = opts.label ?? (opts.run ? `${opts.run.queue} ${opts.run.runId}` : undefined);
    const prefix = label === undefined ? '' : `[${label}] `;
    const out = opts.output ?? { stdout: process.stdout, stderr: process.stderr };
    // V8's verdict ("FATAL ERROR: … heap limit …") is read from the lines as
    // they pass, for the verdict below, and never handed on.
    let heapDeath = false;
    const forwarded = Promise.all([
      forwardLines(child.stdout, out.stdout, prefix),
      forwardLines(child.stderr, out.stderr, prefix, (line) => {
        if (HEAP_DEATH.test(line)) heapDeath = true;
      }),
    ]);

    let answer: Answer | null = null;
    let spawnError: Error | null = null;
    const onAbort = (): void => {
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    child.on('message', (msg: Answer) => {
      answer ??= msg;
    });
    child.on('error', (err) => {
      spawnError ??= err;
    });
    child.on('close', (code, signal) => {
      opts.signal?.removeEventListener('abort', onAbort);
      void forwarded.then(() => {
        if (answer?.ok) return resolve(answer.value);
        if (answer) {
          const err = new Error(answer.error.message);
          err.name = answer.error.name;
          return reject(err);
        }
        if (spawnError) return reject(spawnError);
        if (heapDeath) return reject(new RunOutOfMemory(code, signal, opts.maxOldSpaceMb));
        reject(new ChildRunDied(code, signal, signal !== null ? 'killed' : 'exited', opts.maxOldSpaceMb));
      });
    });
    const order: Order = { call: opts.call ?? 'run', payload, ...(opts.run ? { run: opts.run } : {}) };
    child.send(order);
  });
}
