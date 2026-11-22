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

/**
 * THE SYNC TICK'S BEAT ON EACH RUNNER (ADR-0054; workplan 0167 T6).
 *
 * While the jobs can run on Trigger.dev or on pg-boss, the tick on each writes
 * a beat of its own beside the shared one above, and starts no pass while the
 * other runner's tick has beaten within {@link ANOTHER_RUNNER_BEAT_MS}: two
 * runners at once would start two passes on one migration, each serialising
 * only its own. A tick that holds for the other runner writes its own beat and
 * not the shared one, so two left running start nothing, and the status page,
 * which reads the shared beat, says the tick stopped. Loud, not harmful.
 *
 * No migration: each name is one the table's CHECK admits (managed migration
 * 0030), and the system role may insert and update any row of the table
 * (0033).
 */
export const SYNC_TICK_BEAT_ON = {
  trigger: 'managed-sync-tick-trigger',
  'pg-boss': 'managed-sync-tick-pg-boss',
} as const;

/** A runner the sync tick can run on, by the name its beat is kept under. */
export type TickRunner = keyof typeof SYNC_TICK_BEAT_ON;

/** How recently the other runner's tick beat, for this one to hold: half a minute past its own minute. */
export const ANOTHER_RUNNER_BEAT_MS = 90_000;

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
 * `up` when `task` completed a run within `withinMs` of `now`
 * (`TICK_LATE_AFTER_MS` unless told), and `down` when its beat is older, or
 * there is none. A read that fails throws: the readiness route answers `down`
 * and logs why, and the sync tick, asking after the other runner's beat
 * (`ANOTHER_RUNNER_BEAT_MS`), fails rather than guess.
 */
export async function readTickBeat(
  db: PgDatabase,
  now: Date,
  task: string = SYNC_TICK_BEAT,
  withinMs: number = TICK_LATE_AFTER_MS,
): Promise<TickBeatState> {
  // The age is compared in the database, so the answer does not depend on how
  // a driver hands a timestamp back: node-postgres gives a Date, PGlite a string.
  const result = await db.execute(sql`
    SELECT beat_at > ${now.toISOString()}::timestamptz - (${withinMs}::int * interval '1 millisecond')
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
