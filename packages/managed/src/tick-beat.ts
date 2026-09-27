// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TICK THAT SAYS IT RAN (workplan 0142 T2).
 *
 * `managed-sync-tick` starts every scheduled sync pass, once a minute. When it
 * stopped running, nothing said so. The status page's rows read the API and
 * the database, and both stayed up while no migration moved. The first to
 * notice was a tester.
 *
 * So the tick records a beat at the end of every run it completes, and
 * `GET /api/ready/scheduler` reads how old it is. A beat older than
 * `TICK_LATE_AFTER_MS` is `down`, and so is no beat at all.
 *
 * - **A beat that could not be written costs the beat, never the tick's
 *   work.** `recordTickBeat` never throws, the rule `recordAppEvent` follows.
 * - **A beat is written at the END of a run.** One written first would say
 *   "ran" for a tick that then threw on its enumeration.
 * - **Five minutes is structural**: five missed runs of a one-minute cron. It
 *   is not a guess about traffic.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger';
import { log } from '@openmig/shared';

/** The sync tick's own row: its task id. */
export const SYNC_TICK_BEAT = 'managed-sync-tick';

/** Five missed runs of a one-minute cron. */
export const TICK_LATE_AFTER_MS = 5 * 60_000;

/** What a beat says: the tick ran lately, or it did not. */
export type TickBeatState = 'up' | 'down';

/**
 * Record that `task` completed a run at `now`. Answers whether the beat was
 * written, and never throws: a failed write is logged, and the caller's work
 * stands.
 */
export async function recordTickBeat(
  db: PgDatabase,
  now: Date,
  task: string = SYNC_TICK_BEAT,
): Promise<boolean> {
  try {
    await db.execute(sql`
      INSERT INTO sync_tick_beat (task, beat_at)
      VALUES (${task}, ${now.toISOString()}::timestamptz)
      ON CONFLICT (task) DO UPDATE SET beat_at = EXCLUDED.beat_at
    `);
    return true;
  } catch (error) {
    log.warn(
      `[tick-beat] ${task}: the beat could not be written, and the run's work stands: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * `up` when `task` completed a run within `TICK_LATE_AFTER_MS` of `now`, and
 * `down` when its beat is older, or there is none. A read that fails throws:
 * the caller answers `down` and logs why.
 */
export async function readTickBeat(
  db: PgDatabase,
  now: Date,
  task: string = SYNC_TICK_BEAT,
): Promise<TickBeatState> {
  // The age is compared in the database, so the answer does not depend on how
  // a driver hands a timestamp back: node-postgres gives a Date, PGlite a string.
  const result = await db.execute(sql`
    SELECT beat_at > ${now.toISOString()}::timestamptz - (${TICK_LATE_AFTER_MS}::int * interval '1 millisecond')
           AS fresh
      FROM sync_tick_beat
     WHERE task = ${task}
  `);
  const row = resultRows<{ fresh: unknown }>(result)[0];
  return row?.fresh === true ? 'up' : 'down';
}

/**
 * node-postgres answers `{ rows }`, and PGlite's drizzle adapter can answer a
 * bare array: the twin of `platform-pause.ts`'s helper.
 */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
