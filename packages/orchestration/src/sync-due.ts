// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
 * due immediately.
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

export function isSyncDue(
  schedule: string | null,
  lastStartedAt: Date | null,
  now: Date
): boolean {
  if (lastStartedAt === null) return true;
  const next = new Cron(schedule ?? DEFAULT_SYNC_SCHEDULE).nextRun(lastStartedAt);
  return next !== null && next.getTime() <= now.getTime();
}
