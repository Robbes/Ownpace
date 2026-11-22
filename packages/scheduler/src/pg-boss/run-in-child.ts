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
 * The CPU half of `small-1x` is not something a process can set on itself:
 * that stays the worker container's `cpus:` (Compose) or `resources.limits`
 * (Kubernetes), the same cgroup mechanism Trigger.dev's runner containers use.
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class ChildRunDied extends Error {
  override name = 'ChildRunDied';
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  constructor(code: number | null, signal: NodeJS.Signals | null, detail: string) {
    super(`The run's process exited (code ${String(code)}, signal ${String(signal)}) before it answered.${detail}`);
    this.code = code;
    this.signal = signal;
  }
}

export interface RunInChildOptions {
  /** V8's old-space cap for the child, in MB. 512 matches `small-1x`. */
  readonly maxOldSpaceMb: number;
  /** Which of the entry's `serveRuns` handlers to call. Default `run`. */
  readonly call?: string;
  /** Aborting kills the child with SIGKILL. */
  readonly signal?: AbortSignal;
}

type RunFn = (payload: unknown) => unknown;

/**
 * Call this at the bottom of a module `runInChild` forks: it answers the one
 * order the parent sends, with the handler the order names, then exits. The
 * module is the process's entry, so nothing here imports a computed name.
 */
export function serveRuns(handlers: Readonly<Record<string, RunFn>>): void {
  if (typeof process.send !== 'function') return;
  process.once('message', (order: { call: string; payload: unknown }) => {
    void (async () => {
      try {
        const fn = handlers[order.call];
        if (typeof fn !== 'function') throw new Error(`This run process has no run named "${order.call}".`);
        const value: unknown = await fn(order.payload);
        process.send?.({ ok: true, value }, () => process.exit(0));
      } catch (err) {
        const error = err instanceof Error ? { name: err.name, message: err.message } : { name: 'NonError', message: String(err) };
        process.send?.({ ok: false, error }, () => process.exit(1));
      }
    })();
  });
}

/**
 * Fork `entryUrl` (a module ending in `serveRuns(...)`), hand it the payload,
 * and resolve with what the named run returns.
 */
export function runInChild(entryUrl: string, payload: unknown, opts: RunInChildOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(entryUrl), [], {
      execArgv: [`--max-old-space-size=${opts.maxOldSpaceMb}`],
      stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
      serialization: 'advanced',
    });
    // V8's own verdict ("FATAL ERROR: … heap limit …") comes first and the
    // native stack after it, so keep the start, and only so much of it.
    let stderrHead = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrHead.length < 16_000) stderrHead += chunk.toString();
    });
    let settled = false;
    const onAbort = (): void => {
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.signal?.aborted) onAbort();
    child.on('message', (msg: { ok: boolean; value?: unknown; error?: { name: string; message: string } }) => {
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      if (msg.ok) resolve(msg.value);
      else {
        const err = new Error(msg.error?.message ?? 'unknown failure in the run process');
        err.name = msg.error?.name ?? 'Error';
        reject(err);
      }
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.on('exit', (code, signal) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      const lines = stderrHead.split('\n').map((l) => l.trim()).filter(Boolean);
      const verdict = lines.find((l) => /FATAL ERROR/.test(l)) ?? lines[0];
      reject(new ChildRunDied(code, signal, verdict ? ` It said: ${verdict}` : ''));
    });
    child.send({ call: opts.call ?? 'run', payload });
  });
}
