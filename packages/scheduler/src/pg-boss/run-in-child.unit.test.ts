// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One pass, one process (workplan 0167, point 8, the half with no database),
 * and what crosses back from the run's process (T5's gaps E4 to E6): its
 * lines, prefixed, to the parent's output and nowhere else; its error's name;
 * and its death when the parent dies.
 */

import { describe, it, expect, onTestFinished } from 'vitest';
import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { ChildRunDied, RunOutOfMemory, runInChild, serveRuns } from './run-in-child.ts';
import { RunTimedOut, settlementFor } from './job-runner.ts';

const FIXTURE = new URL('./__testing__/forked-passes.ts', import.meta.url).href;
const PARENT = new URL('./__testing__/parent-of-a-run.ts', import.meta.url).pathname;

class Collected extends Writable {
  text = '';
  override _write(chunk: Buffer, _enc: BufferEncoding, done: () => void): void {
    this.text += chunk.toString();
    done();
  }
}

function collect(): { stdout: Collected; stderr: Collected } {
  return { stdout: new Collected(), stderr: new Collected() };
}

/** Running, and not a zombie: an orphan's reaper may be slow to collect it, which is not the run going on. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!existsSync(`/proc/${pid}/stat`)) return true;
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
}

describe('runInChild', () => {
  it('hands back what the run returns', async () => {
    await expect(runInChild(FIXTURE, { items: 7 }, { maxOldSpaceMb: 64, call: 'behaves', output: collect() })).resolves.toEqual({
      copied: 7,
    });
  });

  it('stops a run that outgrows its heap cap, alone, and says so', async () => {
    const output = collect();
    const err = await runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'runaway', output }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RunOutOfMemory);
    expect((err as ChildRunDied).verdict).toBe('out-of-memory');
    expect((err as ChildRunDied).message).toMatch(/heap/i);
    // V8's own words went to the output, not into the error.
    expect(output.stderr.text).toMatch(/FATAL ERROR/);
    expect((err as ChildRunDied).message).not.toMatch(/FATAL ERROR/);
    // This process is still here to read the answer: the run died alone.
    await expect(runInChild(FIXTURE, { items: 1 }, { maxOldSpaceMb: 64, call: 'behaves', output: collect() })).resolves.toEqual({
      copied: 1,
    });
  }, 60_000);

  it('knows a heap death after the run has said more than 16 kB on stderr, where V8 says it last', async () => {
    const output = collect();
    const err = await runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'warnsThenRunsAway', output }).then(
      () => null,
      (e: unknown) => e,
    );
    // Past the 16 kB head T5's verdict read, which is where this bug hid.
    expect(output.stderr.text.indexOf('FATAL ERROR')).toBeGreaterThan(16_000);
    expect(err).toBeInstanceOf(RunOutOfMemory);
    expect((err as ChildRunDied).verdict).toBe('out-of-memory');
  }, 60_000);

  it('kills the run outright when it is cancelled', async () => {
    const ac = new AbortController();
    const started = Date.now();
    const pending = runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'forever', signal: ac.signal });
    setTimeout(() => ac.abort(), 300);
    const err = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChildRunDied);
    expect((err as ChildRunDied).signal).toBe('SIGKILL');
    expect((err as ChildRunDied).verdict).toBe('killed');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('names a missing export rather than returning nothing', async () => {
    await expect(runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'nope' })).rejects.toThrow(
      /no run named "nope"/,
    );
  });

  it('hands the run what it is told about itself', async () => {
    const run = { queue: 'q-who', runId: '6f1c0c6e-6a0c-4b8e-9c55-0a5b1d1e2f30', attempt: 2 };
    await expect(runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'whoAmI', run, output: collect() })).resolves.toMatchObject({
      run,
    });
  });
});

describe("the run's lines reach the parent's output, prefixed, and only there (E4)", () => {
  const run = { queue: 'run-delta-sync', runId: '0b9e1d7a-2f43-4c1e-8d5b-7a9c3e2f1d00', attempt: 1 };

  it('forwards every line of both streams, each prefixed with the queue and the run id', async () => {
    const output = collect();
    await expect(runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'talks', run, output })).resolves.toBe('said');
    const prefix = `[${run.queue} ${run.runId}] `;
    expect(output.stdout.text).toBe(`${prefix}copied 3 of 7 in Inbox/Board minutes\n`);
    // A line written in two pieces is still one line, and the unterminated last one is not lost.
    expect(output.stderr.text).toBe(
      `${prefix}warn: the folder "Board minutes" answered 429\n` +
        `${prefix}error: second line\n` +
        `${prefix}last words, unterminated\n`,
    );
  });

  it('says a death in its own words, never the words the run wrote', async () => {
    const output = collect();
    const err = await runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'diesTalking', run, output }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChildRunDied);
    expect((err as ChildRunDied).verdict).toBe('exited');
    expect((err as ChildRunDied).code).toBe(3);
    expect((err as ChildRunDied).message).not.toMatch(/Salaries/);
    expect(output.stderr.text).toBe(`[${run.queue} ${run.runId}] FATAL in folder "Salaries 2026": could not read\n`);
  });
});

describe("an error's name survives the process boundary, and decides the retry (E6)", () => {
  const cases: Array<[name: string, settled: 'deadletter' | 'failed']> = [
    ['RunNotRetried', 'deadletter'],
    ['AbortTaskRunError', 'deadletter'],
    ['ZodError', 'deadletter'],
    ['Error', 'failed'],
    ['TypeError', 'failed'],
    ['ChildRunDied', 'failed'],
  ];
  for (const [name, settled] of cases) {
    it(`${name} comes back by name and is ${settled === 'deadletter' ? 'not retried' : 'retried'}`, async () => {
      const err = await runInChild(FIXTURE, { name, message: `thrown as ${name}` }, { maxOldSpaceMb: 64, call: 'throws' }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect({ name: (err as Error).name, message: (err as Error).message }).toEqual({ name, message: `thrown as ${name}` });
      expect(settlementFor(err)).toBe(settled);
    });
  }

  it('does not retry a run that reached its time limit or ran out of its heap, and retries one killed from outside', () => {
    // As Trigger.dev 4.8.8 settles them today: MAX_DURATION_EXCEEDED and out-of-memory are not retried.
    expect(settlementFor(new RunTimedOut('limit'))).toBe('deadletter');
    expect(settlementFor(new RunOutOfMemory(null, 'SIGABRT', 410))).toBe('deadletter');
    // A worker restart or a crash (point 2): the pass converges, so it is tried again.
    expect(settlementFor(new ChildRunDied(null, 'SIGKILL', 'killed', 410))).toBe('failed');
    expect(settlementFor(new ChildRunDied(1, null, 'exited', 410))).toBe('failed');
  });

  it('retries what is not an Error at all', () => {
    expect(settlementFor('RunNotRetried')).toBe('failed');
    expect(settlementFor({ name: 'RunNotRetried' })).toBe('failed');
  });
});

describe('serveRuns answers only in a process runInChild forked (review 7)', () => {
  it('does nothing in another process, even one with an IPC channel', () => {
    const before = [process.listenerCount('disconnect'), process.listenerCount('message')];
    const hadSend = typeof process.send === 'function';
    // A stand-in channel, so the check is the marker and not the missing channel.
    if (!hadSend) (process as { send?: unknown }).send = () => true;
    try {
      serveRuns({ run: () => 'served' });
    } finally {
      if (!hadSend) delete (process as { send?: unknown }).send;
    }
    expect([process.listenerCount('disconnect'), process.listenerCount('message')]).toEqual(before);
  });
});

describe("a run's process never outlives its parent (E5)", () => {
  it('exits when the worker that forked it is killed outright', async () => {
    const parent = fork(PARENT, [], { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
    // A failure below must not leave the stand-in worker, or its run, behind.
    onTestFinished(() => {
      parent.kill('SIGKILL');
      for (const m of said.matchAll(/pid (\d+)/g)) if (alive(Number(m[1]))) process.kill(Number(m[1]), 'SIGKILL');
    });
    let said = '';
    const pid = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no prefixed pid from the run in 10 s; it said: ${said}`)), 10_000);
      parent.stdout!.on('data', (chunk: Buffer) => {
        said += chunk.toString();
        const m = /^\[held-run\] pid (\d+)$/m.exec(said);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      });
    });
    expect(alive(pid)).toBe(true);
    parent.kill('SIGKILL');
    const deadline = Date.now() + 5_000;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const outlived = alive(pid);
    if (outlived) process.kill(pid, 'SIGKILL');
    expect(outlived).toBe(false);
  }, 30_000);
});
