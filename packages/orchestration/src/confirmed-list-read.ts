// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * D10's list, read from the ledger — once, for both editions (workplan 0117
 * T2).
 *
 * > ✅ D10 *"(a): a headline count, every row that is NOT verified, the total
 * > stated, and a full export."*
 *
 * The managed API had this inline when slice 8 shipped, because managed was the
 * only edition serving it. It is here now for the reason the fan-out is
 * (2026-09-11, owner option (b)): the appliance needs the same answer, and a
 * second copy of a per-domain walk is how this repository reported `tasks 0/4`
 * about a target the tasks were sitting on.
 *
 * **Everything edition-specific is the DRIVER**, which `withTenant` already
 * abstracts: managed hands over a pg `Pool`, the appliance its `LedgerDriver`
 * (PGlite included). Nothing else differs.
 *
 * ## Why it pages, and why it walks at all
 *
 * D7(a) authorised confirming EVERY item of a family file account, so this
 * reads the same rows a pass walks. One `SELECT` would load all of them into
 * the process serving the request; one `withTenant` around the whole walk would
 * hold a transaction open for it. So it pages on the store's own keyset, a
 * scope per page.
 *
 * And it walks rather than counting in SQL because **`verified` is derived**,
 * never stored — slice 1's rule, and the reason a stale word is not in the
 * database. Counting it in SQL would be a third place that decides what
 * "verified" means, which is what `countsAsVerified` exists to prevent. The
 * cost is real and stated on the contract: this is a page somebody opens, not
 * something to poll.
 */

import type { Pool } from 'pg';
import {
  ConfirmationStore,
  RunStore,
  withTenant,
  type LedgerDriver,
  type PgDatabase,
} from '@openmig/ledger';
import { and, desc, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import {
  budgetPauseToReason,
  confirmedListCsv,
  confirmedListOf,
  type BudgetPause,
  type ConfirmationPassState,
  type ConfirmedListQueue,
  type ConfirmedRowView,
  type MappingId,
  type MappingLifecycle,
  type PauseReason,
  type TenantId,
} from '@openmig/shared';

/** What every read here needs: a driver, and which mapping of which tenant. */
export interface ConfirmedListScope {
  /** A pg `Pool` (managed) or a `LedgerDriver` (the appliance, PGlite included). */
  readonly source: Pool | LedgerDriver;
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
}

/** One database page. The store's own keyset batch. */
const PAGE = 500;

/**
 * How many non-verified rows a JSON body carries before it says so.
 *
 * Bounded because the WORST case is the ordinary one: before any pass has run,
 * not a single row is verified, so an un-confirmed account of any size would
 * otherwise be serialised whole into one response. `truncated` says it happened
 * and the export carries the rest — never a quietly short list, which on this
 * document would read as an account with less in it than there is (§7c).
 */
export const CONFIRMED_ROWS_SHOWN = 1000;

/**
 * Walk every row of the mapping, one keyset page at a time.
 *
 * `visit` is called once per row in `id` order — the SAME order both consumers
 * see, which is why `rowsFor` sorts. A list and an export that ordered rows
 * differently would look like two different accounts to somebody reconciling
 * one against the other.
 *
 * **The cursor is checked to have advanced**, and that is not defensive
 * padding. A `rowsFor` that ignored `after` would hand back the same full page
 * for ever, and this loop's only exit is a short page: a request thread
 * spinning on a database, holding a connection per page, until something else
 * falls over. The store's own guard covers that; this is the second line,
 * because the failure here is a live outage rather than a wrong number, and its
 * check is exact rather than an arbitrary cap — ids strictly increase or the
 * read is not what it says it is.
 */
export async function walkConfirmedRows(
  scope: ConfirmedListScope,
  visit: (row: ConfirmedRowView) => void | Promise<void>,
): Promise<void> {
  let after: string | undefined;
  for (;;) {
    const page = await withTenant(scope.source, scope.tenantId, (db: PgDatabase) =>
      new ConfirmationStore(db).rowsFor({
        tenantId: scope.tenantId,
        mappingId: scope.mappingId,
        batch: PAGE,
        ...(after ? { after } : {}),
      }),
    );
    if (page.length === 0) return;
    const last = page[page.length - 1]!.itemId;
    if (after !== undefined && last <= after) {
      throw new Error(
        `confirmed list paging did not advance past ${after} — the keyset cursor is being ignored`,
      );
    }
    for (const row of page) {
      await visit({
        state: row.state,
        claim: row.claim,
        domain: row.domain,
        collection: row.collection,
        naturalKey: row.naturalKey,
        confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      });
    }
    after = last;
    if (page.length < PAGE) return;
  }
}

/**
 * Where the last confirmation pass got to, and why it stopped if it stopped
 * early.
 *
 * The run row is the pass's own (`kind: 'confirm'`), so this only reads. A
 * `succeeded` run carrying a `budgetPause` in its stats is NOT a failure —
 * 0090 T4's rule, that a scheduled stop is a stop and not an error — and it
 * becomes the sentence `budgetPauseToReason` already writes for the customer,
 * rather than a pile of bytes only an engineer can read.
 */
export async function latestConfirmationPass(
  scope: ConfirmedListScope,
): Promise<{ lastPass: ConfirmationPassState; pausedAt?: PauseReason }> {
  const rows = await withTenant(scope.source, scope.tenantId, (db: PgDatabase) =>
    db
      .select({
        status: schema.run.status,
        startedAt: schema.run.startedAt,
        finishedAt: schema.run.finishedAt,
        stats: schema.run.stats,
      })
      .from(schema.run)
      .where(
        and(
          eq(schema.run.tenantId, scope.tenantId),
          eq(schema.run.mappingId, scope.mappingId),
          eq(schema.run.kind, 'confirm'),
        ),
      )
      .orderBy(desc(schema.run.startedAt))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return { lastPass: { state: 'never-run' } };

  // `startedAt` is nullable in the schema (a queued row has none yet). A run
  // with no start time has not started, which is what `never-run` says — and is
  // a truer answer than inventing `new Date()` for it (hard rule 9).
  if (!row.startedAt) return { lastPass: { state: 'never-run' } };
  const startedAt = row.startedAt.toISOString();
  if (row.status === 'queued' || row.status === 'running') {
    return { lastPass: { state: 'running', startedAt } };
  }
  const finishedAt = (row.finishedAt ?? row.startedAt).toISOString();
  if (row.status !== 'succeeded') {
    return { lastPass: { state: 'failed', startedAt, finishedAt } };
  }

  const stats = (row.stats ?? {}) as { budgetPause?: unknown };
  const pause = stats.budgetPause;
  const reason = isBudgetPause(pause) ? budgetPauseToReason(pause) : undefined;
  return {
    lastPass: { state: 'done', startedAt, finishedAt },
    ...(reason ? { pausedAt: reason } : {}),
  };
}

/**
 * Is this jsonb value a `BudgetPause`?
 *
 * CHECKED, never cast — the same rule `isPauseReason` states for its own side
 * of the boundary. This is a column an older or newer build wrote, and a cast
 * would put `undefined` into a sentence a customer reads as the reason their
 * account is only part checked.
 */
function isBudgetPause(value: unknown): value is BudgetPause {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.provider === 'string' &&
    typeof v.ceilingBytes === 'number' &&
    typeof v.spentBytes === 'number' &&
    (v.windowResetsAt === null || typeof v.windowResetsAt === 'string')
  );
}

/**
 * One mapping's entry in the confirmed list.
 *
 * Counted over EVERY row, kept up to the bound, and neither number is computed
 * here: `confirmedListOf` is the shared shaper, so both editions carry the same
 * arithmetic. A count assembled at an edge is a second opinion about somebody's
 * data.
 */
export async function readConfirmedList(
  scope: ConfirmedListScope,
  lifecycle: MappingLifecycle,
): Promise<ConfirmedListQueue> {
  const list = confirmedListOf<ConfirmedRowView>({ limit: CONFIRMED_ROWS_SHOWN });
  await walkConfirmedRows(scope, (row) => list.add(row));
  const shaped = list.result();
  const pass = await latestConfirmationPass(scope);
  return {
    migrationStatus: lifecycle,
    verified: shaped.verified,
    total: shaped.total,
    rows: shaped.rows,
    ...(shaped.truncated ? { truncated: true } : {}),
    ...pass,
  };
}

/**
 * The full export — EVERY row, verified ones included — written out in chunks.
 *
 * The difference from the list is the point rather than a convenience. The
 * screen shows what is actionable; a person reconciling against the account
 * they are about to empty needs to search for one file and see the word
 * `verified` beside it, which the screen by design never shows them.
 *
 * `write` may return a promise, and this AWAITS it: on a real HTTP response
 * that is how backpressure is honoured, and ignoring it would pile a
 * family-sized account into memory unsent — the failure the paging exists to
 * avoid, with an extra step.
 */
export async function streamConfirmedListCsv(
  scope: ConfirmedListScope,
  write: (chunk: string) => void | Promise<void>,
): Promise<void> {
  // The header comes out of the same renderer as the rows, from an empty list,
  // so the columns and their order cannot drift from what fills them.
  await write(confirmedListCsv([]));
  let batch: ConfirmedRowView[] = [];
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const chunk = stripCsvHeader(confirmedListCsv(batch));
    batch = [];
    await write(chunk);
  };
  await walkConfirmedRows(scope, async (row) => {
    batch.push(row);
    if (batch.length >= PAGE) await flush();
  });
  await flush();
}

/** Drop the BOM and header line a fresh render carries, for a continuation. */
function stripCsvHeader(csv: string): string {
  const firstBreak = csv.indexOf('\r\n');
  return firstBreak === -1 ? '' : csv.slice(firstBreak + 2);
}

/**
 * Is a confirmation pass already under way for this mapping?
 *
 * Both editions join rather than stack, for the same reason: a second pass over
 * the same account would pay for every byte twice to answer a question already
 * being answered.
 */
export async function runningConfirmation(
  scope: ConfirmedListScope,
): Promise<{ runId: string } | undefined> {
  const rows = await withTenant(scope.source, scope.tenantId, (db: PgDatabase) =>
    db
      .select({ id: schema.run.id, startedAt: schema.run.startedAt })
      .from(schema.run)
      .where(
        and(
          eq(schema.run.tenantId, scope.tenantId),
          eq(schema.run.mappingId, scope.mappingId),
          eq(schema.run.kind, 'confirm'),
          eq(schema.run.status, 'running'),
        ),
      )
      .orderBy(desc(schema.run.startedAt))
      .limit(1),
  );
  const row = rows[0];
  return row ? { runId: row.id } : undefined;
}

/** Re-exported so a caller needs one import for the whole read. */
export { ConfirmationStore, RunStore };
