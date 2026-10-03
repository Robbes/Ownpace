// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Due-ness for the managed sync tick (workplan 0022 T1).
 *
 * `mailbox_mapping.schedule` (a cron expression, per mapping) stays the single
 * source of truth for how often a mapping syncs — the tick evaluates it here
 * instead of registering per-mapping schedule rows with the trigger platform,
 * so mapping lifecycle changes (create/start/finish) never have external
 * schedule state to reconcile (0022 T0 decision).
 *
 * The rule: a mapping is due when the cron's next firing AFTER its last run
 * started is now in the past. "Last run started" (not finished) keeps a slow
 * pass from pulling the next one earlier, and a mapping that has never run is
 * due immediately. Until its first copy is finished, a mapping runs at the
 * floor instead, whatever its schedule (workplan 0156 T5, `isSyncDue`).
 *
 * Throws on an invalid cron expression — the caller decides what a broken
 * schedule means (the tick logs it loudly and falls back to the default so the
 * mapping keeps syncing while somebody fixes the value; silently skipping
 * would dead-stop a mapping and mask the error, hard rule 9).
 */

import { Cron } from 'croner';

/** Matches the old poller's default for mappings that omit a schedule. */
export const DEFAULT_SYNC_SCHEDULE = '*/15 * * * *';

/** How many minutes the default cadence spans, and so how far offsets spread. */
const DEFAULT_PERIOD_MINUTES = 15;

/**
 * The default schedule for one mapping, offset so they do not all fire together.
 *
 * The default cadence is wall-clock aligned, so EVERY mapping that never chose
 * a schedule becomes due at :00, :15, :30 and :45 — simultaneously, across
 * every tenant. The tick then triggers all of them in the same minute and nothing at
 * all for the fourteen after it. That is a thundering herd against the sync
 * queue, against Postgres, and against whatever provider quota the tenants
 * happen to share.
 *
 * The offset is derived from the mapping id, so it is **deterministic** — the
 * same mapping always lands in the same slot. A random offset would move a
 * mapping's schedule on every deploy, and `isSyncDue` measures from the last
 * run, so a wandering schedule would make the cadence itself wander.
 *
 * Only ever applied where the owner expressed no preference. An explicit
 * `schedule` on the mapping is a decision and is used exactly as written —
 * silently rewriting somebody's `0 2 * * *` to run at 2:07 would be a lie about
 * a value they can see in the UI.
 */
export function defaultScheduleFor(mappingId: string): string {
  const offset = offsetFor(mappingId);
  const minutes: number[] = [];
  for (let m = offset; m < 60; m += DEFAULT_PERIOD_MINUTES) minutes.push(m);
  return `${minutes.join(',')} * * * *`;
}

/**
 * A stable minute in [0, 15) for a mapping id — FNV-1a, for no reason beyond
 * being short, dependency-free and well spread over hex strings.
 *
 * Not a security boundary and not a hash of anything secret: the input is a
 * UUID that appears in the URL bar.
 */
function offsetFor(mappingId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < mappingId.length; i++) {
    hash ^= mappingId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % DEFAULT_PERIOD_MINUTES;
}

/**
 * WHAT THE TICK KNOWS BESIDE THE SCHEDULE (workplan 0156 T5).
 *
 * One fact today, read by the tick's own statement (`ACTIVE_MAPPINGS_SQL`'s
 * `first_copy_unfinished`, `apps/worker/src/jobs/managed-sync-tick.ts`), which
 * is where the rule for it is written down and tested against real rows.
 */
export interface DueFacts {
  /**
   * Some data type this migration copies has not yet completed a pass: its
   * `migration_status.completed_at` is empty. `markCompleted` is its one
   * writer and nothing clears it, so it is the "copied once" the stages read
   * (`completedOnce`, `stage.ts`: *copying* until it is set).
   */
  readonly firstCopyUnfinished: boolean;
}

/** A migration whose every data type has completed a pass: the schedule decides. */
const STEADY: DueFacts = { firstCopyUnfinished: false };

/**
 * Whether a migration is due a pass now.
 *
 * A FIRST COPY RUNS PASS AFTER PASS (workplan 0156 T5; the owner, 2026-10-03,
 * picking 0125 T8's (a)). The owner: *"the default frequency now seems to be 1
 * sync every 1 day; that might be reasonable for the free tier and after all
 * sync was done, like as a default sync of only the new additions/changes, but
 * not for the initial bulk."* A migration made with no schedule picked is
 * stored as daily at 02:00 (the wizard's default), and a managed pass stops
 * itself at 50 minutes (`PASS_SOFT_DEADLINE_MS`), so a large first copy on that
 * default copied for 50 minutes a day: a 100 GB mailbox took weeks to arrive,
 * waiting on a schedule meant for the trickle that comes after it. When 0125
 * T8 offered the three ways out on 2026-09-28 the owner chose (c), the schedule
 * editable on the migration page; this is (a), which he asked for now.
 *
 * So while `firstCopyUnfinished`, the migration is due at the floor whatever
 * its schedule says: `SCHEDULE_FLOOR_MINUTES` after its last pass STARTED. A
 * pass that ran its full 50 minutes is followed at the next tick after it
 * ends, and one that ended early waits out the rest of the quarter hour. Once
 * every data type has completed a pass the schedule applies exactly as before:
 * daily at 02:00 then means one pass a day for what is new or changed.
 *
 * What this does NOT decide, and so still holds: a pass already running skips
 * the migration in the tick (its `running` column), so two passes never run at
 * once; a migration failing for a cause nobody but a person can clear is held
 * back after this answers (`heldBackByFailures`, `failing-backoff.ts`); a
 * paused, closed, withdrawn or finished migration is never enumerated at all;
 * and the box's caps choose among the due ones (`withinCapacity`). This only
 * moves the schedule out of the way of a first copy, never any of those.
 *
 * The schedule is read FIRST, also while catching up, so one croner cannot
 * read still throws here and the tick still says so every minute (hard rule 9)
 * instead of the first copy hiding a value that will stop the migration the
 * day it finishes.
 */
export function isSyncDue(
  schedule: string | null,
  lastStartedAt: Date | null,
  now: Date,
  facts: DueFacts = STEADY,
): boolean {
  if (lastStartedAt === null) return true;
  const expression = schedule ?? DEFAULT_SYNC_SCHEDULE;
  // A stored schedule faster than the floor (one written before the doors
  // refused it, 0143 T2b) runs at the floor: the next pass waits the floor
  // after the last one started. So does every schedule while the first copy
  // is unfinished (0156 T5). Any other schedule is read as it was written.
  if (shortestGapMinutes(expression) < SCHEDULE_FLOOR_MINUTES || facts.firstCopyUnfinished) {
    return now.getTime() - lastStartedAt.getTime() >= SCHEDULE_FLOOR_MINUTES * MINUTE_MS;
  }
  const next = new Cron(expression).nextRun(lastStartedAt);
  return next !== null && next.getTime() <= now.getTime();
}

/**
 * THE SHORTEST A SCHEDULE MAY RUN PASSES APART, in minutes (workplan 0143 T2b):
 * 15, the fastest cadence the screens offer. A tester could type any cron
 * expression through the API, and `* * * * *` asked for a pass a minute, on a
 * machine sized for twenty organisations doing their first copies (0143 D1).
 * Both doors refuse a faster schedule (`refuseUnreadableSchedule` in the API's
 * migration routes), and `isSyncDue` runs one stored before that at the floor.
 * It is also the cadence of a first copy, whatever the schedule (0156 T5).
 * The appliance's cadence is its owner's call on its owner's machine, and its
 * scheduler does not read this.
 */
export const SCHEDULE_FLOOR_MINUTES = 15;

const MINUTE_MS = 60_000;

/** One answer per expression: the tick asks every mapping every minute. */
const shortestGaps = new Map<string, number>();

/**
 * The shortest gap between two runs of `expression`, in minutes, over eight
 * days from a fixed Monday in UTC, as croner reads it: what the tick would do
 * with it. Infinity when those days hold fewer than two runs, which no
 * floor counts in minutes can object to. Throws on an expression croner cannot
 * read, as `isSyncDue` does.
 */
export function shortestGapMinutes(expression: string): number {
  const known = shortestGaps.get(expression);
  if (known !== undefined) return known;
  const cron = new Cron(expression, { timezone: 'UTC' });
  const from = new Date(Date.UTC(2026, 0, 5));
  const until = from.getTime() + 8 * 24 * 60 * MINUTE_MS;
  let shortest = Number.POSITIVE_INFINITY;
  let previous = cron.nextRun(from);
  while (previous !== null && shortest > 1) {
    const next = cron.nextRun(previous);
    if (next === null || next.getTime() >= until) break;
    shortest = Math.min(shortest, (next.getTime() - previous.getTime()) / MINUTE_MS);
    previous = next;
  }
  shortestGaps.set(expression, shortest);
  return shortest;
}
