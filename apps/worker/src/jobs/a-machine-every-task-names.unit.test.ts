// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MACHINE EVERY TASK NAMES (workplan 0143 T1 step 2).
 *
 * No task named a machine, and neither did `trigger.config.ts`, so every run
 * took the plane's default: `small-1x`, half a CPU and 512 MB, enforced on the
 * container (T1 step 1). Nobody had chosen it. The owner chose it on
 * 2026-09-28 (open question 7), and the caps in `managed.env.example` are
 * counted in its memory, so the choice is written where the plane reads it:
 * the default for every task, and again on the two tasks that copy or list.
 *
 * The SDK's types refuse a preset that does not exist, so what is held here
 * is that each is named, and named as chosen. Changing it changes what the
 * caps must be counted in, and this is where that is noticed.
 *
 * On the pg-boss runner (workplan 0167 T6) a run is a process of the worker's,
 * with V8's heap capped at what the machine gave it, which is the catalog's
 * `maxOldSpaceMb` on every queue. Its CPU is the worker container's to cap.
 * Trigger.dev, where `small-1x` was named in `trigger.config.ts` and on the
 * two tasks, went in alpha.18 (0167 T9); the budget stays `small-1x`'s.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CATALOG } from '@openmig/scheduler/pg-boss';

/** What V8 gets of the chosen machine's 512 MB, as the task that copies says where it names it. */
const ITS_HEAP_MB = 410;

const here = dirname(fileURLToPath(import.meta.url));

describe('the machine every task runs on', () => {
  it('is named again by the task that copies, in the words the budget is counted in', () => {
    expect(readFileSync(join(here, 'run-delta-sync.ts'), 'utf8')).toContain(`512 MB, of which V8 gets ${ITS_HEAP_MB}.`);
  });

  it('caps every queue of the pg-boss runner at the heap the machine gives a run (workplan 0167 T6)', () => {
    expect(JOB_CATALOG).toHaveLength(17);
    expect(JOB_CATALOG.filter((queue) => queue.maxOldSpaceMb !== ITS_HEAP_MB).map((queue) => queue.name)).toEqual([]);
  });
});
