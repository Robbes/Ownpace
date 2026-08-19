// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Ledger retention — the only table that grows without bound and without
 * purpose (workplan 0082 T2).
 *
 * ## What is pruned, and what deliberately is not
 *
 * **`run_event` is pruned.** It is one row per log line of one pass, it exists
 * so an operator can read what a run did, and `listRunsWithEvents` shows the
 * newest twenty runs with twenty-five events each. Nothing reads a log line
 * from six months ago; it is the highest-volume table in the schema and the
 * least consulted.
 *
 * **`run` is NOT pruned.** It is the answer to "when did this last work",
 * which somebody asks about a migration that has gone quiet, and one small row
 * per pass is storage rather than load — especially now that 0023's indexes
 * mean the sync tick no longer reads the history at all. Deleting a run row
 * would also orphan the question its events answered.
 *
 * **`item` is NEVER pruned, and this is not a tuning decision.** It IS the
 * idempotency ledger: create-if-absent asks it whether an item was already
 * copied. Deleting a row does not free space, it tells the next pass to copy
 * that item again — duplicating it in the target, which is the one outcome the
 * whole product exists to prevent (hard rule 2's neighbour). There is no
 * window under which this becomes safe.
 *
 * **`audit_log` is NOT pruned, and that is an owner decision rather than a
 * default.** §17 lists audit logging as a GDPR obligation, and the retention
 * period for it is a compliance question with a legal answer, not an
 * engineering one. Guessing a window here would quietly destroy records
 * somebody may be required to hold. It is named here so the omission reads as
 * a decision rather than an oversight.
 *
 * ## Why batched
 *
 * The first run on a database that has never been pruned deletes everything
 * older than the window in one go. Unbounded, that is a single transaction
 * holding row locks across a table the running syncs are still writing to. The
 * loop keeps each statement small and commits between batches, so the work is
 * interruptible and never blocks a pass for long. A pruner that causes an
 * incident is worse than no pruner.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from './db-types.ts';

/** How long run logs are kept. Generous: the UI only ever shows the newest few. */
export const DEFAULT_RUN_EVENT_RETENTION_DAYS = 90;

/** Rows removed per statement. Small enough that no single delete holds locks long. */
export const DEFAULT_RETENTION_BATCH = 5_000;

/** A ceiling on batches per invocation, so one call cannot run unboundedly long. */
export const DEFAULT_MAX_BATCHES = 200;

/**
 * The operator's override, in days, from `LEDGER_RETENTION_DAYS`.
 *
 * Lives here rather than beside either caller because both editions read the
 * same variable and hard rule 5 says they must not disagree about what it
 * means — a managed operator and an appliance owner setting `45` must get the
 * same 45 days, including the same refusal for `forty-five`.
 *
 * An unparseable or out-of-range value is refused loudly rather than silently
 * replaced by the default: somebody who set `LEDGER_RETENTION_DAYS=thirty` has
 * a belief about how long their logs are kept, and quietly keeping ninety days
 * instead is the kind of helpfulness that gets found out during an audit.
 */
export function retentionDaysFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_RUN_EVENT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `LEDGER_RETENTION_DAYS must be a whole number of days, at least 1 — got ${JSON.stringify(raw)}. ` +
        `Leave it unset for the default of ${DEFAULT_RUN_EVENT_RETENTION_DAYS} days.`,
    );
  }
  return n;
}

export interface PruneOptions {
  /** Keep events at least this old. Defaults to {@link DEFAULT_RUN_EVENT_RETENTION_DAYS}. */
  readonly olderThanDays?: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

export interface PruneResult {
  readonly deleted: number;
  readonly cutoff: Date;
  /**
   * True when the batch ceiling stopped the pass with rows still eligible.
   *
   * Reported rather than silently tolerated: a pruner that never finishes and
   * never says so looks exactly like a pruner that has nothing left to do
   * (hard rule 9). The next scheduled pass picks up where this one stopped.
   */
  readonly moreRemaining: boolean;
}

/**
 * Delete run logs older than the window, in bounded batches.
 *
 * Events belonging to a run that has not finished are kept regardless of age —
 * a pass that has been running for longer than the retention window is
 * unusual, and its log is the thing somebody is about to want.
 */
export async function pruneRunEvents(
  db: PgDatabase,
  now: Date,
  options: PruneOptions = {},
): Promise<PruneResult> {
  const days = options.olderThanDays ?? DEFAULT_RUN_EVENT_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_RETENTION_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  if (days < 1) throw new Error(`Retention window must be at least one day, got ${days}`);

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  let deleted = 0;
  let moreRemaining = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    // ctid, not a join in the DELETE: pick the victims with one indexed read
    // and delete exactly those. A correlated DELETE … USING re-plans the
    // subquery per row and is where a prune of this shape usually goes wrong.
    const result = await db.execute(sql`
      DELETE FROM run_event
       WHERE ctid IN (
         SELECT e.ctid
           FROM run_event e
           JOIN run r ON r.id = e.run_id
          WHERE e.at < ${cutoff}
            AND r.status NOT IN ('running', 'queued')
          LIMIT ${batchSize}
       )
    `);
    const rows = rowCount(result);
    deleted += rows;
    if (rows < batchSize) return { deleted, cutoff, moreRemaining: false };
    moreRemaining = true;
  }
  return { deleted, cutoff, moreRemaining };
}

/**
 * How many rows the driver said it changed.
 *
 * Both backends answer `rowCount` — node-postgres by definition, and PGlite's
 * drizzle result carries `rowCount` alongside its own `affectedRows`. This was
 * written with a fallback to `affectedRows` on the assumption that PGlite
 * offered only the latter; a mutation test declined to fail without it, and
 * probing the actual result showed both keys present. The fallback was dead
 * code under a confident and false comment, which is worse than no fallback.
 *
 * The narrowing stays, because `execute` is typed loosely enough that a driver
 * returning neither would otherwise yield `NaN` here and spin the batch loop.
 */
function rowCount(result: unknown): number {
  const count = (result as { rowCount?: unknown } | null)?.rowCount;
  return typeof count === 'number' ? count : 0;
}
