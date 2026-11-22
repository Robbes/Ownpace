// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A worker's stand-in for the test that a run's process never outlives its
 * parent (workplan 0167 T5, gap E5): it forks a run that says its pid and
 * never ends, and waits to be killed. The run's line reaches this process's
 * stdout prefixed with its label, which is how the test learns the pid.
 */

import { runInChild } from '../run-in-child.ts';

await runInChild(new URL('./forked-passes.ts', import.meta.url).href, null, {
  maxOldSpaceMb: 64,
  call: 'holds',
  label: 'held-run',
});
