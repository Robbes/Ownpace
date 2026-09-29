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
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The preset the owner chose, and the caps are counted in (0143, open question 7). */
const CHOSEN = 'small-1x';

const here = dirname(fileURLToPath(import.meta.url));

/** The options of the task `id` defines, as written: from its id to its `run`. */
function optionsOf(file: string, id: string): string {
  const src = readFileSync(join(here, file), 'utf8');
  const start = src.indexOf(`id: '${id}',`);
  expect(start, `no task '${id}' in ${file}`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('run:', start));
}

describe('the machine every task runs on', () => {
  it('is named in the config, as the default', () => {
    // Read, not imported: the config sits beside `src`, where the runtime's
    // own guard (`runs-without-a-transpiler`) does not look for files.
    const src = readFileSync(join(here, '..', '..', 'trigger.config.ts'), 'utf8');
    const at = src.indexOf('export default defineConfig({');
    expect(at, 'the config is not defined where it was').toBeGreaterThan(-1);
    expect(src.slice(at)).toContain(`machine: '${CHOSEN}',`);
  });

  it('is named again by the task that copies', () => {
    expect(optionsOf('run-delta-sync.ts', 'run-delta-sync')).toContain(`machine: '${CHOSEN}',`);
  });

  it('is named again by the task that lists everything a migration holds', () => {
    expect(optionsOf('run-discovery.ts', 'run-discovery')).toContain(`machine: '${CHOSEN}',`);
  });
});
