// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One pass, one process (workplan 0167, point 8, the half with no database).
 */

import { describe, it, expect } from 'vitest';
import { ChildRunDied, runInChild } from './run-in-child.ts';

const FIXTURE = new URL('./spike-fixtures/runaway.ts', import.meta.url).href;

describe('runInChild', () => {
  it('hands back what the run returns', async () => {
    await expect(runInChild(FIXTURE, { items: 7 }, { maxOldSpaceMb: 64, call: 'behaves' })).resolves.toEqual({
      copied: 7,
    });
  });

  it('stops a run that outgrows its heap cap, alone, and says so', async () => {
    const err = await runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'runaway' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChildRunDied);
    expect((err as ChildRunDied).message).toMatch(/heap/i);
    // This process is still here to read the answer: the run died alone.
    await expect(runInChild(FIXTURE, { items: 1 }, { maxOldSpaceMb: 64, call: 'behaves' })).resolves.toEqual({
      copied: 1,
    });
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
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('names a missing export rather than returning nothing', async () => {
    await expect(runInChild(FIXTURE, null, { maxOldSpaceMb: 64, call: 'nope' })).rejects.toThrow(
      /no run named "nope"/,
    );
  });
});
