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

/**
 * The old poller's default for mappings that omit a schedule: what `isSyncDue`
 * reads for a null schedule, and, offset per mapping (`defaultScheduleFor`),
 * what the tick runs a stored schedule it cannot read on until somebody fixes
 * it. A migration with no schedule of its own no longer runs on it in the
 * managed tick: since workplan 0157 T7 that is the automatic cadence
 * (`automaticScheduleFor`).
 */
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
  return fnv1a(mappingId) % DEFAULT_PERIOD_MINUTES;
}

function fnv1a(mappingId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < mappingId.length; i++) {
    hash ^= mappingId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * THE AUTOMATIC CADENCE (workplan 0157 T7; the owner, 2026-10-05: *"sync slow
 * down once a migration is in step: yes"*).
 *
 * A migration with no schedule of its own, which is what *Start a migration*
 * makes, looks for changes every hour for 14 days, then every 6 hours, and once
 * a day from 30 days on. The days count from when the first copy finished, or
 * from the last time somebody opened the migration or pressed *Sync now*,
 * whichever is later: freshness matters while somebody is checking that new
 * mail arrives, and much less to somebody who keeps the sync for weeks without
 * looking (0157 §7, which reasons it out against the load: a thousand
 * migrations in step at hourly are 24,000 passes a day, most finding nothing).
 * While the first copy runs, `isSyncDue` runs it pass after pass anyway.
 *
 * A schedule somebody chose is never changed: this is only ever the cadence of
 * a migration that holds none. Each step is offset per migration, as the
 * 15-minute default is, so the hour's first minute does not start them all.
 * Stable for the same reason: the offset comes from the id, never the clock.
 */
export const AUTOMATIC_HOURLY_DAYS = 14;

/** From this many days in step, the automatic cadence looks once a day. */
export const AUTOMATIC_DAILY_AFTER_DAYS = 30;

/** How often the automatic cadence looks, at one moment. */
export type AutomaticStep = 'hourly' | 'six-hourly' | 'daily';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Which step the automatic cadence is on: `since` is when the first copy
 * finished or somebody last looked, whichever is later (`automaticSince`), and
 * null while there is neither, which looks every hour.
 */
export function automaticStep(since: Date | null, now: Date): AutomaticStep {
  if (since === null) return 'hourly';
  const days = (now.getTime() - since.getTime()) / DAY_MS;
  if (days < AUTOMATIC_HOURLY_DAYS) return 'hourly';
  if (days < AUTOMATIC_DAILY_AFTER_DAYS) return 'six-hourly';
  return 'daily';
}

/**
 * What the automatic cadence counts from: the later of when the first copy
 * finished and when somebody last opened the migration or pressed *Sync now*.
 * Null while the first copy is unfinished, or when neither has happened.
 */
export function automaticSince(
  firstCopyUnfinished: boolean,
  firstCopyDoneAt: Date | null,
  lookedAt: Date | null,
): Date | null {
  if (firstCopyUnfinished) return null;
  if (firstCopyDoneAt === null) return lookedAt;
  if (lookedAt === null) return firstCopyDoneAt;
  return lookedAt.getTime() > firstCopyDoneAt.getTime() ? lookedAt : firstCopyDoneAt;
}

/**
 * The automatic cadence as the cron the tick reads, for one migration now:
 * hourly at the migration's own minute, every 6 hours from its own hour, or
 * once a day at its own hour.
 */
export function automaticScheduleFor(mappingId: string, since: Date | null, now: Date): string {
  const hash = fnv1a(mappingId);
  const minute = hash % 60;
  switch (automaticStep(since, now)) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'six-hourly': {
      const first = Math.floor(hash / 60) % 6;
      return `${minute} ${[0, 6, 12, 18].map((h) => h + first).join(',')} * * *`;
    }
    case 'daily':
      return `${minute} ${Math.floor(hash / 360) % 24} * * *`;
  }
}

/**
 * WHAT THE TICK KNOWS BESIDE THE SCHEDULE (workplan 0156 T5, 0157 T2).
 *
 * Read by the tick (`apps/worker/src/jobs/managed-sync-tick.ts`): the first from
 * its own statement (`ACTIVE_MAPPINGS_SQL`'s `first_copy_unfinished`), which is
 * where the rule for it is written down and tested against real rows; the
 * second from the organisation's tier (`leastMinutesBetweenPasses` in
 * `@openmig/managed`'s `pace.ts`). Plain facts, so this module never learns
 * what a tier is (AGENTS.md hard rule 5).
 */
export interface DueFacts {
  /**
   * Some data type this migration copies has not yet completed a pass: its
   * `migration_status.completed_at` is empty. `markCompleted` is its one
   * writer and nothing clears it, so it is the "copied once" the stages read
   * (`completedOnce`, `stage.ts`: *copying* until it is set).
   */
  readonly firstCopyUnfinished: boolean;
  /**
   * The least minutes between two passes, from the last one's start, whatever
   * the schedule and also while the first copy is unfinished (workplan 0157 T2:
   * 1,440 on Free, one pass a day). Absent or 0: no floor beyond the
   * schedule's and `SCHEDULE_FLOOR_MINUTES`.
   */
  readonly leastMinutesBetweenPasses?: number;
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
 * A TIER'S PACE COMES FIRST (workplan 0157 T2). `leastMinutesBetweenPasses`
 * holds every pass back until that many minutes after the last one started,
 * the first copy's too: 1,440 on Free, so one pass a day. It can only make a
 * migration later, never sooner, and a migration that never ran is still due
 * at once.
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
  // Read first, so a schedule croner cannot read throws whatever the facts say.
  const shortest = shortestGapMinutes(expression);
  const sinceLast = now.getTime() - lastStartedAt.getTime();
  // A tier's own pace (0157 T2): nothing runs sooner than its floor after the
  // last pass started, the first copy's passes included. Only ever later than
  // the rules below would run it, never sooner.
  if (sinceLast < (facts.leastMinutesBetweenPasses ?? 0) * MINUTE_MS) return false;
  // A stored schedule faster than the floor (one written before the doors
  // refused it, 0143 T2b) runs at the floor: the next pass waits the floor
  // after the last one started. So does every schedule while the first copy
  // is unfinished (0156 T5). Any other schedule is read as it was written.
  if (shortest < SCHEDULE_FLOOR_MINUTES || facts.firstCopyUnfinished) {
    return sinceLast >= SCHEDULE_FLOOR_MINUTES * MINUTE_MS;
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
