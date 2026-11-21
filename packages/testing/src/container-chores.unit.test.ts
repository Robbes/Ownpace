// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The integration tier's two set-up chores let go only the failure each is
 * for (workplan 0006 §K): a log write that fails is said once and not thrown,
 * a container already gone is let go and any other removal failure is thrown.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { appendToTestLog, removeContainerOrGone } from './container-chores.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('appendToTestLog', () => {
  it('writes the text to the file it names', () => {
    const writes: Array<[string, string]> = [];
    appendToTestLog('/logs/a.log', 'a line\n', ((p: string, t: string) => writes.push([p, t])) as never);
    expect(writes).toEqual([['/logs/a.log', 'a line\n']]);
  });

  it('says a write that failed, once per file, and throws nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const full = (() => {
      throw new Error('ENOSPC: no space left on device');
    }) as never;
    for (let i = 0; i < 3; i++) expect(() => appendToTestLog('/logs/full.log', 'x\n', full)).not.toThrow();
    appendToTestLog('/logs/other.log', 'x\n', full);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      '[TestLogs] Could not write /logs/full.log, so it stops short here: ENOSPC: no space left on device',
      '[TestLogs] Could not write /logs/other.log, so it stops short here: ENOSPC: no space left on device',
    ]);
  });
});

describe('removeContainerOrGone', () => {
  const failing = (stderr: string) => async () => {
    throw Object.assign(new Error('Command failed: docker rm -f c0ffee'), { stderr });
  };

  it('asks docker to remove the container by force', async () => {
    const asked: Array<[string, string[]]> = [];
    await removeContainerOrGone('c0ffee', async (file, args) => asked.push([file, args]));
    expect(asked).toEqual([['docker', ['rm', '-f', 'c0ffee']]]);
  });

  it('lets a container already gone go: that is what was wanted', async () => {
    await expect(removeContainerOrGone('c0ffee', failing('Error response from daemon: No such container: c0ffee\n'))).resolves.toBeUndefined();
  });

  it('throws any other failure, with what docker said', async () => {
    await expect(
      removeContainerOrGone('c0ffee', failing('Cannot connect to the Docker daemon. Is the docker daemon running?\n')),
    ).rejects.toThrow(/docker rm -f c0ffee failed, and the container may still hold the Stalwart data volume: Cannot connect to the Docker daemon/);
  });
});
