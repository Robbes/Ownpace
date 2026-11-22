// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TICK THAT NEVER SAID IT RAN (workplan 0142 T2).
 *
 * `managed-sync-tick` starts every scheduled pass. When it stopped running,
 * nothing said so, and the first to notice was a tester whose migration had
 * stopped moving. It now records a beat that `GET /api/ready/scheduler` reads.
 *
 * Where it beats is the whole point, and it is read from the task's body as
 * text, the way `a-drain-that-only-said-so` does, because the body needs a
 * runner to execute:
 *
 * - **on the hold's return**: a held tick ran, and the hold is shown to testers
 *   on its own;
 * - **after the enqueue phase** on the normal path;
 * - **never before the enumeration**: a beat written first would say "ran" for
 *   a tick that then threw reading the migrations.
 *
 * Since workplan 0167 T6 the tick beats as its runner too, at the same time as
 * the shared beat, and holds while the other runner's tick beats, writing its
 * own beat alone (`a-tick-that-holds-for-the-other-runner` holds the rule).
 *
 * It fails today: the tick records no beat.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments removed: this file's own prose names the very calls it guards. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const TICK = (() => {
  const whole = code(readFileSync(join(HERE, 'managed-sync-tick.ts'), 'utf8'));
  // The run, exported for either runner (workplan 0167 T6).
  const body = whole.indexOf("export const managedSyncTickRun = leavesAReference(\n  'managed-sync-tick',");
  expect(body, 'the scheduled task body is no longer recognisable').toBeGreaterThan(-1);
  return whole.slice(body);
})();

const BEAT = 'await recordTickBeat(';
const ENUMERATION = 'pool.query<TickRow>(ACTIVE_MAPPINGS_SQL';
const HOLD = 'if (hold) {';
const ENQUEUE = 'await mapWithConcurrency(toEnqueue';
/** The hold for the other runner's tick (workplan 0167 T6), asked before the operator's. */
const OTHER_RUNNER = "ANOTHER_RUNNER_BEAT_MS)) === 'up') {";

/** Every index at which `needle` occurs in `haystack`. */
function allIndexes(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

/** The return that closes the block opened at `from`: the first after it. */
function returnAfter(from: number): number {
  return TICK.indexOf('return summary;', from);
}

describe('the sync tick says it ran', () => {
  it('finds the places it checks, so the checks below are not vacuous', () => {
    for (const anchor of [ENUMERATION, HOLD, ENQUEUE, OTHER_RUNNER]) {
      expect(TICK.indexOf(anchor), `the tick no longer contains ${anchor}`).toBeGreaterThan(-1);
    }
  });

  it('beats on the hold’s return: a held tick ran, the shared beat and its runner’s own at one time', () => {
    const hold = TICK.indexOf(HOLD);
    const held = returnAfter(hold);
    const block = TICK.slice(hold, held);
    const beats = allIndexes(TICK, BEAT).filter((at) => at > hold && at < held);
    expect(beats, 'the hold returns without a beat, so a held tick reads as a stopped one').toHaveLength(2);
    expect(block).toContain('await recordTickBeat(drizzle(pool), heldAt);');
    expect(block).toContain('await recordTickBeat(drizzle(pool), heldAt, ownBeat);');
  });

  it('beats after the enqueue phase on the normal path, the shared beat and its runner’s own at one time', () => {
    const enqueue = TICK.indexOf(ENQUEUE);
    const done = returnAfter(enqueue);
    const block = TICK.slice(enqueue, done);
    const beats = allIndexes(TICK, BEAT).filter((at) => at > enqueue && at < done);
    expect(beats, 'the tick returns without a beat after enqueueing').toHaveLength(2);
    expect(block).toContain('await recordTickBeat(drizzle(pool), beatAt);');
    expect(block).toContain('await recordTickBeat(drizzle(pool), beatAt, ownBeat);');
  });

  it('never beats before the enumeration but in its two holds, or anywhere else', () => {
    const enumeration = TICK.indexOf(ENUMERATION);
    const hold = TICK.indexOf(HOLD);
    const otherRunner = TICK.indexOf(OTHER_RUNNER);
    const inside = (at: number, from: number) => at > from && at < returnAfter(from);
    for (const at of allIndexes(TICK, BEAT)) {
      // The beats before the enumeration are the two holds', each of which
      // returns without enumerating at all.
      if (at < enumeration) expect(inside(at, hold) || inside(at, otherRunner)).toBe(true);
    }
    // Two on each path that ran, one on the hold for the other runner.
    expect(allIndexes(TICK, BEAT)).toHaveLength(5);
  });
});
