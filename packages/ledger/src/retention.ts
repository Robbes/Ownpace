// Copyright 2026 The Ownpace authors (Apache-2.0)

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
 * **`run` IS pruned, since 0121 T5 — and it was not, before.** This file used
 * to argue the opposite, in these words: *"one small row per pass is storage
 * rather than load … deleting a run row would also orphan the question its
 * events answered."* Two things retired that.
 *
 * The first is scale. A live deployment was found holding **4796 run rows for
 * a mapping with 3 items** — fifty days of a credential that could not be read,
 * retried on schedule. "One small row per pass" is only small while passes are
 * rare, and the thing that makes them frequent is the thing going wrong.
 *
 * The second is that the sentence had stopped being true. Until 0121 T3 the
 * historical body of `run` had NO reader — every consumer touches the newest 21
 * rows of a mapping, or the rows still `running`/`queued`. T3 gave it one, by
 * deriving billed compute from it, and then immediately took it away again by
 * FREEZING the derived quantities onto the invoice. `invoice-generation.ts`
 * writes the measured figures into the invoice metadata, so an issued bill does
 * not re-read the ledger and cannot change when the ledger is pruned. §4a of
 * that plan says so in as many words: *"with it, those rows are audit trail and
 * T5 is possible."*
 *
 * THAT FREEZE IS A PRECONDITION, NOT A BACKGROUND FACT, and this module cannot
 * check it: `invoice` is a managed-edition table and `packages/` must not
 * depend on managed (self-host has no invoices at all). So {@link pruneRuns}
 * takes `safeUpTo` and the CALLER proves it. The managed job passes the end of
 * the newest invoiced period; the appliance passes nothing, because it bills
 * nobody. A caller that knows of no safe point deletes nothing, which is the
 * right way round for a mistake to fall.
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

/**
 * How long run rows are kept. Two months (owner, 2026-09-08).
 *
 * Two months rather than one because a month-long billing period must be able
 * to close, be invoiced and be queried before its evidence goes; one month
 * would put the cutoff exactly where the invoice is being written.
 */
export const DEFAULT_RUN_RETENTION_DAYS = 60;

/**
 * How long run logs are kept — and it FOLLOWS the run window rather than
 * setting its own.
 *
 * This was 90 days while runs were kept for ever, which was coherent then and
 * is not now: `run_event.run_id` is `ON DELETE CASCADE`, so pruning a run takes
 * its events with it whatever this says. A 90-day log window beside a 60-day
 * run window would not keep logs for 90 days — it would keep them for 60 and
 * describe itself as keeping them for 90, which is the kind of number an
 * operator plans around and then finds out about.
 */
export const DEFAULT_RUN_EVENT_RETENTION_DAYS = DEFAULT_RUN_RETENTION_DAYS;

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
  return parseRetentionDays(raw, 'LEDGER_RETENTION_DAYS', DEFAULT_RUN_EVENT_RETENTION_DAYS);
}

/**
 * The same override for the RUN window, from `LEDGER_RUN_RETENTION_DAYS`.
 *
 * A separate variable rather than one shared number, because the two windows
 * answer different questions — how long a log is readable, and how long the
 * ledger remembers a pass happened — and an operator who shortens one has not
 * necessarily decided anything about the other.
 */
export function runRetentionDaysFromEnv(raw: string | undefined): number {
  return parseRetentionDays(raw, 'LEDGER_RUN_RETENTION_DAYS', DEFAULT_RUN_RETENTION_DAYS);
}

/**
 * One parser behind both, so the refusal cannot drift between them.
 *
 * Hard rule 5: a managed operator and an appliance owner setting `45` must get
 * the same 45 days, including the same refusal for `forty-five`. Two copies of
 * this wording is how that stops being true.
 */
function parseRetentionDays(raw: string | undefined, variable: string, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `${variable} must be a whole number of days, at least 1 — got ${JSON.stringify(raw)}. ` +
        `Leave it unset for the default of ${fallback} days.`,
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

/** What a caller must supply before any run row is deleted. */
export interface PruneRunsOptions extends PruneOptions {
  /**
   * How far back it is proved safe to forget — and it is REQUIRED, because the
   * two ways of having no date mean opposite things.
   *
   * A `Date` is the managed answer: the end of the newest invoiced period.
   * `invoice-generation.ts` freezes the measured quantities onto the invoice,
   * so an issued bill does not re-read the ledger and cannot change when the
   * ledger is pruned. Nothing at or after that instant is deleted, however old
   * the window says it is.
   *
   * `'nothing-is-billed'` is the appliance answer: it bills nobody, has no
   * invoice table to ask, and every run row older than the window is therefore
   * safe. This is not a bypass — it is a different, and true, statement about
   * the deployment.
   *
   * There is deliberately NO DEFAULT. Optional, the appliance would silently
   * inherit whichever behaviour the managed edition needed: either it prunes
   * nothing (and the machine that can least afford an ever-growing table — a
   * Pi on an SD card — is the one that never prunes), or it prunes everything
   * (and a managed deployment whose invoicing has stalled quietly deletes the
   * evidence for months nobody has billed). Both are one forgotten argument
   * away, so the argument cannot be forgotten.
   */
  readonly safeUpTo: Date | 'nothing-is-billed';

  /**
   * Restrict the prune to one tenant.
   *
   * NOT an optimisation — it is what makes `safeUpTo` mean anything on a
   * multi-tenant deployment. Invoicing is per tenant, so "the newest invoiced
   * period" is too: tenant A billed through July and tenant B through May do
   * not share a safe point, and the single global maximum would delete B's
   * June evidence. Taking the global MINIMUM instead is safe but useless — one
   * tenant signed up yesterday, with no invoice yet, would stop retention for
   * everybody.
   *
   * So the caller loops, and each tenant is pruned to its own proof. Omit it
   * only where there is nothing to prove — the appliance, which is one
   * deployment and bills nobody.
   */
  readonly tenantId?: string;
}

export interface PruneRunsResult extends PruneResult {
  /**
   * True when `safeUpTo` — not the window — decided the cutoff.
   *
   * Reported because the two cases look identical from the outside and mean
   * opposite things: a prune that deletes nothing because there is nothing old
   * enough is healthy, and a prune that deletes nothing because no period has
   * been invoiced for four months is a billing job that has stopped running.
   */
  readonly clampedBySafety: boolean;
}

/**
 * Delete finished runs older than the window, in bounded batches.
 *
 * Three things are never deleted, and each is a different kind of reason:
 *
 *  - **A run that has not finished.** `running` and `queued` rows are excluded
 *    on status, not on age. A pass older than the window that is still going is
 *    exactly the pass somebody is about to ask about — and 0022's tick reads
 *    those rows to decide whether a mapping is already in flight, so deleting
 *    one would let a second writer start against the same mapping.
 *  - **Anything at or after `safeUpTo`.** See the option.
 *  - **`item`, ever.** Not mentioned here because this function cannot touch
 *    it, but see the header: it is the idempotency ledger, and deleting a row
 *    tells the next pass to copy that item again.
 *
 * `run_event` needs no separate pass: `run_event.run_id` is `ON DELETE CASCADE`,
 * so a pruned run takes its log with it. `verification.run_id` is
 * `ON DELETE SET NULL`, so verification records survive and lose only the
 * pointer to a run that no longer exists — which is what that column choice was
 * for.
 */
export async function pruneRuns(
  db: PgDatabase,
  now: Date,
  options: PruneRunsOptions,
): Promise<PruneRunsResult> {
  const days = options.olderThanDays ?? DEFAULT_RUN_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_RETENTION_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  if (days < 1) throw new Error(`Retention window must be at least one day, got ${days}`);

  const byWindow = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // The window is a ceiling on what MAY go; the safety point is a floor under
  // what MUST stay. Whichever is earlier wins, and which one won is reported.
  const clampedBySafety =
    options.safeUpTo !== 'nothing-is-billed' && options.safeUpTo.getTime() < byWindow.getTime();
  const cutoff = clampedBySafety ? (options.safeUpTo as Date) : byWindow;

  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    // ctid for the same reason pruneRunEvents uses it: pick the victims with
    // one indexed read and delete exactly those, rather than a correlated
    // DELETE … USING that re-plans its subquery per row.
    const result = await db.execute(sql`
      DELETE FROM run
       WHERE ctid IN (
         SELECT r.ctid
           FROM run r
          WHERE r.created_at < ${cutoff}
            AND r.status NOT IN ('running', 'queued')
            ${options.tenantId ? sql`AND r.tenant_id = ${options.tenantId}` : sql``}
          LIMIT ${batchSize}
       )
    `);
    const rows = rowCount(result);
    deleted += rows;
    if (rows < batchSize) return { deleted, cutoff, moreRemaining: false, clampedBySafety };
  }
  return { deleted, cutoff, moreRemaining: true, clampedBySafety };
}
