// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Mappings that never chose a schedule must not all fire in the same minute
 * (workplan 0082 T3).
 *
 * The default cadence is wall-clock aligned, so every mapping on it became due
 * at :00, :15, :30 and :45 — together, across every tenant. The tick then did
 * all of its work in four minutes out of every sixty and nothing in the rest.
 * That is a thundering herd against the queue, the database, and whatever
 * provider quota those tenants share.
 *
 * Two properties matter and they pull against each other:
 *
 *  - **spread**, or the change does nothing;
 *  - **stability**, or it does something worse. `isSyncDue` measures from the
 *    last run against the cron's next firing, so a schedule that moved between
 *    ticks would make the CADENCE wander, not just the phase. A random offset
 *    would do exactly that, and it would look fine in a test that only checked
 *    for spread.
 */

import { describe, it, expect } from 'vitest';
import { Cron } from 'croner';
import { defaultScheduleFor, isSyncDue, DEFAULT_SYNC_SCHEDULE } from './sync-due.ts';

/** Realistic ids: the real input is a v4 UUID, not a counter. */
const ids = Array.from({ length: 400 }, (_, i) =>
  `7c${i.toString(16).padStart(6, '0')}-e29b-41d4-a716-${(i * 7919).toString(16).padStart(12, '0').slice(-12)}`,
);

/**
 * The minutes within an hour that a schedule fires on.
 *
 * Starts a millisecond BEFORE the hour, not on it: `nextRun` is strictly
 * after its argument, so starting at 00:00:00 exactly would skip the 00:00
 * firing and report an offset-0 mapping as firing first at :15.
 */
function firingMinutes(schedule: string): number[] {
  const cron = new Cron(schedule);
  const out: number[] = [];
  let at = new Date('2026-08-17T23:59:59.999Z');
  for (let i = 0; i < 8; i++) {
    const next = cron.nextRun(at);
    if (!next) break;
    out.push(next.getUTCMinutes());
    at = next;
  }
  return out;
}

describe('defaultScheduleFor', () => {
  it('is stable — the same mapping always gets the same schedule', () => {
    // The one that matters most. Anything derived from time or randomness
    // passes the spread test below and quietly breaks the cadence.
    for (const id of ids.slice(0, 20)) {
      expect(defaultScheduleFor(id)).toBe(defaultScheduleFor(id));
    }
  });

  it('spreads mappings across the whole period rather than onto the hour', () => {
    const offsets = new Set(
      ids.flatMap((id) => {
        const first = firingMinutes(defaultScheduleFor(id))[0];
        return first === undefined ? [] : [first];
      }),
    );
    // Fifteen slots exist; with 400 ids every one should be occupied. A hash
    // that clumped would still "spread" by a loose measure, so assert the full
    // set rather than "more than one".
    expect(offsets.size).toBe(15);
    expect(Math.min(...offsets)).toBe(0);
    expect(Math.max(...offsets)).toBe(14);
  });

  it('still fires four times an hour, like the default it replaces', () => {
    // Spreading must not change how OFTEN a mapping syncs — only when.
    for (const id of ids.slice(0, 50)) {
      const minutes = firingMinutes(defaultScheduleFor(id)).slice(0, 4);
      const gaps = minutes.slice(1).map((m, i) => (m - (minutes[i] ?? 0) + 60) % 60);
      expect(gaps.every((g) => g === 15)).toBe(true);
    }
  });

  it('leaves the documented default cadence alone', () => {
    // The constant is still what the UI and the docs say the default is; the
    // offset is a phase, not a new cadence.
    expect(DEFAULT_SYNC_SCHEDULE).toBe('*/15 * * * *');
    expect(firingMinutes(DEFAULT_SYNC_SCHEDULE)).toContain(0);
  });

  it('remains a schedule isSyncDue can evaluate', () => {
    // A generated cron that croner rejects would send every mapping down the
    // tick's loud-error fallback path — the thing the parity test exists to
    // keep shut.
    for (const id of ids.slice(0, 30)) {
      const schedule = defaultScheduleFor(id);
      expect(() =>
        isSyncDue(schedule, new Date('2026-08-18T00:00:00Z'), new Date('2026-08-18T01:00:00Z')),
      ).not.toThrow();
      expect(
        isSyncDue(schedule, new Date('2026-08-18T00:00:00Z'), new Date('2026-08-18T01:00:00Z')),
      ).toBe(true);
    }
  });
});
