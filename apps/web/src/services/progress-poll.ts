// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW OFTEN THE LIVE STRIP ASKS AGAIN, from what it is currently showing.
 *
 * `pending` and `in_progress` are the two states where the numbers are still
 * moving, so they are the two that earn the fast rate. Everything else —
 * `completed`, `failed`, `skipped`, and a mapping with no domains yet — falls
 * back to the idle rate rather than to `false`: a migration STARTED from
 * another screen has to become visible here without a reload too, and that is
 * the same bug one step further out.
 *
 * Exported because both editions read it, and because a rule this small is
 * cheaper to assert directly than through two rendered components. Here
 * since 0154 T1 (b): a person's lines on Migrations and their page refresh
 * at the same rate as the migration's own strip.
 */
export const PROGRESS_POLL_ACTIVE_MS = 10_000;
export const PROGRESS_POLL_IDLE_MS = 30_000;

export function progressRefetchInterval(
  domains: ReadonlyArray<{ readonly state: string }> | undefined,
): number {
  return domains?.some((d) => d.state === 'pending' || d.state === 'in_progress')
    ? PROGRESS_POLL_ACTIVE_MS
    : PROGRESS_POLL_IDLE_MS;
}
