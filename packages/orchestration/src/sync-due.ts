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

export function isSyncDue(
  schedule: string | null,
  lastStartedAt: Date | null,
  now: Date
): boolean {
  if (lastStartedAt === null) return true;
  const next = new Cron(schedule ?? DEFAULT_SYNC_SCHEDULE).nextRun(lastStartedAt);
  return next !== null && next.getTime() <= now.getTime();
}
