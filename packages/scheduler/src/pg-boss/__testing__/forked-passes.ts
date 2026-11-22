// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Passes for the per-run process tests (workplan 0167, point 8): one that
 * keeps every page it reads in memory until the heap cap stops it, one that
 * behaves, and one that never ends; and, for what crosses back to the parent
 * (workplan 0167 T5's gaps E4 to E6), one that talks on both streams, one
 * that says something and dies, one that throws an error by a given name, and
 * one that hands back what it was told about its run. `runInChild` forks this
 * module as the run's process.
 */

import { serveRuns } from '../run-in-child.ts';

export function runaway(): number {
  const kept: string[][] = [];
  for (;;) kept.push(Array.from({ length: 100_000 }, (_, i) => `page ${i} of a folder that never ends`));
}

export function behaves(payload: { items: number }): { copied: number } {
  return { copied: payload.items };
}

export async function forever(): Promise<never> {
  return new Promise<never>(() => {
    setInterval(() => undefined, 1000);
  });
}

/** Lines on both streams, one of them written in two pieces, one with no newline at the end. */
export async function talks(): Promise<string> {
  process.stdout.write('copied 3 of 7 in Inbox/Board minutes\n');
  process.stderr.write('warn: the folder "Board min');
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stderr.write('utes" answered 429\nerror: second line\n');
  process.stderr.write('last words, unterminated');
  return 'said';
}

/** Says a tester's words on stderr, then dies without answering. */
export function diesTalking(): never {
  process.stderr.write('FATAL in folder "Salaries 2026": could not read\n');
  process.exit(3);
}

/** Throws an error by the name it is given, as `RunNotRetried`, `AbortTaskRunError` or `ZodError` would. */
export function throws(payload: { name: string; message: string }): never {
  const err = new Error(payload.message);
  err.name = payload.name;
  throw err;
}

/**
 * Warns at length on stderr, as a pass's `log.warn` does (about 40 kB), then runs away: V8's
 * verdict comes after it. A heap abort can drop the tail of what the run wrote, so the test asks
 * only that V8's line comes past the 16 kB the parent once kept.
 */
export async function warnsThenRunsAway(): Promise<number> {
  for (let i = 0; i < 400; i++) process.stderr.write(warning(i));
  // Out before the runaway, which holds the event loop until V8 gives up.
  await drained(process.stderr);
  return runaway();
}

/** One line of 100 bytes, numbered. */
function warning(i: number): string {
  return `warn: folder ${i} answered 429, waiting before the next page`.padEnd(99, '.') + '\n';
}

function drained(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => stream.write('', () => resolve()));
}

/** Its last words, 5,000 lines of 100 bytes (far past a pipe's buffer), then an answer: every line must reach the parent. */
export function saysAThousandLines(): string {
  for (let i = 0; i < 5000; i++) process.stderr.write(warning(i));
  return 'answered';
}

/** One line of 100,000 bytes and no newline, as a run that dumps a document might write. */
export function writesOneLongLine(): string {
  process.stderr.write('x'.repeat(100_000));
  return 'answered';
}

/** Says its pid, then never ends. */
export async function holds(): Promise<never> {
  process.stdout.write(`pid ${process.pid}\n`);
  return forever();
}

export function whoAmI(_payload: unknown, run: unknown): unknown {
  return { run, pid: process.pid };
}

serveRuns({
  runaway,
  behaves: (p) => behaves(p as { items: number }),
  forever,
  talks,
  diesTalking,
  throws: (p) => throws(p as { name: string; message: string }),
  whoAmI,
  holds,
  warnsThenRunsAway,
  saysAThousandLines,
  writesOneLongLine,
});
