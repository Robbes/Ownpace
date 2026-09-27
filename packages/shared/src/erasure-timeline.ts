// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Erasure is not finished when the row is deleted (workplan 0085 T5).
 *
 * ## The gap
 *
 * `purgeTenant` deletes from the live database. Last night's backup still has
 * every row it deleted, and will keep having them until that backup rolls out
 * of its retention window. So there is a period — days, not minutes — during
 * which we have told a customer their data is gone and it is recoverable by us.
 *
 * Saying "deleted" on the day of the purge would be **false**, and it is the
 * kind of false that a supervisory authority asks about. So the promise is
 * made in two parts, which is also how a person actually thinks about it:
 *
 *   1. **the live service** — gone on the day the window the customer chose
 *      runs out, and gone for good: they cannot see it, we do not serve it,
 *      nothing syncs;
 *   2. **the backups** — gone once every backup taken before the purge has
 *      aged out, which is a further `BACKUP_RETENTION_DAYS`.
 *
 * ## Why the window is configuration and not a constant
 *
 * The number belongs to whoever runs the deployment and their backup schedule,
 * not to this repository. A self-hoster with monthly tapes has a very
 * different one, and a hardcoded 7 would make them promise something untrue
 * on our authority.
 *
 * **7 days is the owner's number for when backups exist** (owner, 2026-08-18).
 * Nothing in this repository backs up the managed application database yet,
 * and `ownpace-live`, the stack testers use, takes no backups during the alpha
 * and sets 0 (workplan 0134). On a stack without backups a blank value names
 * backups that do not exist, so the API warns about a blank value at start-up
 * in production, and refuses to start with one when the alpha setting is on
 * (`describeBackupRetentionProblem` in `apps/api/src/config-guards.ts`).
 *
 * ## What this does NOT claim
 *
 * It does not claim the backups are *scrubbed*. Nobody surgically edits a
 * backup — that is how you corrupt the thing you keep backups for. It claims
 * they **expire**, which is what actually happens, and it dates the expiry
 * from the purge rather than from the request, because a backup taken the hour
 * before the purge is the last one that can contain anything.
 *
 * Bilingual, adjacent, per `docs/i18n-prose-boundary.md` class 4 — this is
 * prose we author, shown to a customer at the moment they ask us to forget
 * them, and `apps/selfhost` needs it as much as the console does.
 */

import type { RefusalLocale } from './credential-refusals.ts';

/**
 * The backup retention window used when `BACKUP_RETENTION_DAYS` is blank, in
 * days: the owner's number for a deployment that takes backups (owner
 * decision, 2026-08-18). It assumes backups exist. A deployment with a
 * different schedule sets its own number, and one with no backups sets 0, as
 * `ownpace-live` does during the alpha (workplan 0134).
 *
 * It stays 7 and not 0 (0134 §3): a deployment that takes backups and is left
 * on 0 would call an erasure complete while a backup still holds the data,
 * and that is the worse of the two mistakes.
 */
export const DEFAULT_BACKUP_RETENTION_DAYS = 7;

/**
 * Whether a raw `BACKUP_RETENTION_DAYS` is blank, so the window falls back to
 * the default. The reader below and the API's start-up check both ask this,
 * so they cannot disagree about which values nobody stated (workplan 0134 T1).
 */
export function backupRetentionIsBlank(raw: string | undefined): boolean {
  return raw === undefined || raw === '';
}

/**
 * Read the window from the environment, refusing anything that is not a whole
 * number of days.
 *
 * Zero is allowed and means something real — a deployment that takes no
 * backups at all — so it is not lumped in with the garbage. Everything else
 * that is not a non-negative integer is refused **by name**, because the
 * failure mode of a silently-defaulted value here is a date printed to a
 * customer that nobody can honour.
 */
export function backupRetentionDaysFromEnv(raw: string | undefined): number {
  if (backupRetentionIsBlank(raw)) return DEFAULT_BACKUP_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `BACKUP_RETENTION_DAYS must be a whole number of days, zero or more — got ${JSON.stringify(raw)}. ` +
        `Set it to 0 if nothing backs up this deployment's database, or to the number of days its ` +
        `backups are kept (workplan 0134). Blank reads as ${DEFAULT_BACKUP_RETENTION_DAYS} days, ` +
        `which assumes backups exist.`,
    );
  }
  return n;
}

/** The two dates a closing customer is owed. */
export interface ErasureTimeline {
  /** When the live service stops holding it — the window the customer chose. */
  readonly purgeAfter: Date;
  /** When the last backup that could contain it has aged out. */
  readonly backupsExpireAt: Date;
  /** The window the customer chose, in days. */
  readonly windowDays: number;
  /** This deployment's backup retention, in days. */
  readonly backupRetentionDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Both dates, from the moment of closing.
 *
 * A pure function of its inputs — no clock, no environment — so the dates a
 * customer was shown can be recomputed from the record years later, which is
 * the only version of this that is any use in an argument.
 */
export function erasureTimeline(args: {
  readonly closedAt: Date;
  readonly windowDays: number;
  readonly backupRetentionDays: number;
}): ErasureTimeline {
  const { closedAt, windowDays, backupRetentionDays } = args;
  if (!Number.isInteger(windowDays) || windowDays < 0) {
    throw new Error(`windowDays must be a whole number of days, zero or more — got ${windowDays}`);
  }
  if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 0) {
    throw new Error(
      `backupRetentionDays must be a whole number of days, zero or more — got ${backupRetentionDays}`,
    );
  }
  const purgeAfter = new Date(closedAt.getTime() + windowDays * DAY_MS);
  return {
    purgeAfter,
    // From the PURGE, not from the close: a backup taken the hour before the
    // purge is the last one that can contain anything, and it has the full
    // retention window still to run.
    backupsExpireAt: new Date(purgeAfter.getTime() + backupRetentionDays * DAY_MS),
    windowDays,
    backupRetentionDays,
  };
}

/** ISO calendar date (UTC) — the same string in both languages. */
function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * What we tell the customer, in their language.
 *
 * **The dates are not translated and not localised.** Per the prose boundary,
 * the frame is translated and the finding is not — and `2026-09-03` is a
 * finding. It also happens to be the one format that cannot be read as a
 * different day in another country, which matters more here than elsewhere:
 * this sentence is a commitment with a date in it.
 *
 * The zero-backup case gets its own sentence rather than a second date equal
 * to the first, because "and from our backups by the same day" reads as an
 * evasion even when it is true.
 */
export function erasureTimelineText(t: ErasureTimeline, locale: RefusalLocale): string {
  const purge = day(t.purgeAfter);
  const backups = day(t.backupsExpireAt);

  if (t.backupRetentionDays === 0) {
    return locale === 'nl'
      ? `Wij verwijderen uw gegevens op ${purge} uit de actieve dienst. Deze omgeving bewaart geen back-ups, dus daarmee is de verwijdering voltooid.`
      : `We remove your data from the live service on ${purge}. This deployment keeps no backups, so that completes the erasure.`;
  }

  return locale === 'nl'
    ? `Wij verwijderen uw gegevens op ${purge} uit de actieve dienst. Back-ups die deze gegevens nog bevatten, verlopen daarna binnen ${t.backupRetentionDays} dagen; de verwijdering is dus uiterlijk op ${backups} voltooid. Wij bewerken back-ups niet met terugwerkende kracht — ze verlopen.`
    : `We remove your data from the live service on ${purge}. Backups that still contain it expire within a further ${t.backupRetentionDays} days, so the erasure completes by ${backups}. We do not edit backups retrospectively — they expire.`;
}
