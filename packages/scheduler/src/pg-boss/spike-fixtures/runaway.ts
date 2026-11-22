// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Passes for the per-run process test (workplan 0167, point 8): one that keeps
 * every page it reads in memory until the heap cap stops it, one that behaves,
 * and one that never ends. `runInChild` forks this module as the run's process.
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

serveRuns({ runaway, behaves: (p) => behaves(p as { items: number }), forever });
