// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A hold that only puts a notice on a screen is not a drain.
 *
 * Managed migration 0023 gives an operator a sentence to show customers while
 * the platform is updated. The sentence is worth nothing — worse than nothing
 * — if passes keep starting behind it: a customer would be told copying is
 * paused while their migration goes on being interrupted mid-flight by a
 * deploy. The notice and the stopping are one feature, and this holds the
 * stopping half.
 *
 * Four properties, in the order they would hurt:
 *
 *  1. The tick READS the hold. Without this line the feature is a banner.
 *  2. It reads it BEFORE enumerating and returns without enqueueing. A check
 *     after the enumeration would still start passes.
 *  3. It stops the ENQUEUE only. A drain lets running passes finish; killing
 *     them would lose the pass's work and leave the run row open, which is
 *     what workplan 0022 T2 spent a whole PR fixing.
 *  4. It says how many are still in flight. That number is the only way an
 *     operator knows the drain is done, and having to count it in SQL is how
 *     somebody deploys over a live pass.
 *
 * Read as text: this is a Trigger.dev scheduled task whose body needs a
 * database, a runner and a queue to execute, and what is asserted is the ORDER
 * of two statements, which no runtime call can observe.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments removed — this file's own prose names the very calls it guards. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * The TASK BODY, not the file.
 *
 * Found by breaking this guard: with the whole file as the haystack, deleting
 * the hold check outright still left `readOpenPause` in the import line, and
 * two of these assertions passed over a tick that had stopped honouring
 * anything. A guard that reads an import is a guard that reads a promise.
 */
const TICK = (() => {
  const whole = code(readFileSync(join(HERE, 'managed-sync-tick.ts'), 'utf8'));
  const body = whole.indexOf('run: async () => {');
  expect(body, 'the scheduled task body is no longer recognisable').toBeGreaterThan(-1);
  return whole.slice(body);
})();

describe('the sync tick honours an operator hold', () => {
  it('reads it at all', () => {
    expect(TICK, 'the tick no longer reads the open hold — the drain is a banner').toContain(
      'readOpenPause',
    );
  });

  it('reads it before it enumerates the mappings', () => {
    const hold = TICK.indexOf('readOpenPause');
    const enumerate = TICK.indexOf('ACTIVE_MAPPINGS_SQL, [STALE_RUN_AFTER_MS]');
    expect(hold, 'readOpenPause is gone').toBeGreaterThan(-1);
    expect(enumerate, 'the active-mappings query is no longer recognisable').toBeGreaterThan(-1);
    expect(
      hold,
      'the hold must be read BEFORE the mappings are enumerated, or passes still start',
    ).toBeLessThan(enumerate);
  });

  it('returns without enqueueing anything', () => {
    // The whole branch, from the check to its return. `runDeltaSync.trigger`
    // must not appear inside it.
    const start = TICK.indexOf('if (hold) {');
    expect(start, 'the hold branch is no longer recognisable').toBeGreaterThan(-1);
    const end = TICK.indexOf('ACTIVE_MAPPINGS_SQL, [STALE_RUN_AFTER_MS]', start);
    const branch = TICK.slice(start, end);
    expect(branch, 'the held tick must return before enqueueing').toContain('return summary;');
    expect(
      branch.includes('runDeltaSync.trigger'),
      'a held tick must enqueue nothing',
    ).toBe(false);
  });

  it('cancels nothing — a drain lets running passes finish', () => {
    const start = TICK.indexOf('if (hold) {');
    const end = TICK.indexOf('ACTIVE_MAPPINGS_SQL, [STALE_RUN_AFTER_MS]', start);
    const branch = TICK.slice(start, end);
    for (const kill of ['cancel', 'abort', "status = 'cancelled'", 'UPDATE run']) {
      expect(
        branch.includes(kill),
        `a hold must not ${kill} anything — passes in flight finish normally`,
      ).toBe(false);
    }
  });

  it('reports how many passes are still in flight', () => {
    const start = TICK.indexOf('if (hold) {');
    const end = TICK.indexOf('ACTIVE_MAPPINGS_SQL, [STALE_RUN_AFTER_MS]', start);
    const branch = TICK.slice(start, end);
    expect(branch, 'the drain must count what is still running').toContain(
      "FROM run\n          WHERE status = 'running'",
    );
    // ...and count it the way the enumeration does. A stale `running` row
    // from a killed pass never closes, so counting those would show a drain
    // that never reaches zero.
    expect(branch, 'the count must exclude stale run rows').toContain('STALE_RUN_AFTER_MS');
    expect(branch, 'and say the number, so nobody has to go and count it').toContain(
      'stillRunning',
    );
  });

  it('carries the operator’s own words into the log', () => {
    const start = TICK.indexOf('if (hold) {');
    const end = TICK.indexOf('ACTIVE_MAPPINGS_SQL, [STALE_RUN_AFTER_MS]', start);
    expect(TICK.slice(start, end)).toContain('hold.message');
  });
});
