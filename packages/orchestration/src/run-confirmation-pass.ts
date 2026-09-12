// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Run a confirmation pass — once, for both editions (workplan 0117 T2).
 *
 * `runConfirmationPass` (`@openmig/core`) decides; this is everything around
 * it: the readers over the real target, the ledger adapter that records what
 * was found, the run row, and the release. The managed worker had all of it
 * inline when slice 7 shipped, because managed was the only edition that could
 * start a pass.
 *
 * It is here now for the reason the fan-out is (2026-09-11, owner option (b)):
 * the appliance runs the same pass, and a second copy of this wiring is how
 * one edition quietly stops being the product.
 *
 * **Everything edition-specific is two arguments** — the ledger `source` (a pg
 * `Pool` for managed, a `LedgerDriver` for the appliance, PGlite included) and
 * the `OpenTarget` that builds one domain's target. Both already exist.
 *
 * ## The tenant scope, and why a long pass cannot hold one
 *
 * `withTenant` is a TRANSACTION — BEGIN, `SET LOCAL ROLE`, `SET LOCAL` tenant,
 * COMMIT — so it takes a connection for as long as its callback runs. A pass
 * over a family-sized account runs for many minutes, and one transaction held
 * open that long blocks vacuum, bloats the table and is what an
 * `idle_in_transaction_session_timeout` exists to kill. So:
 *
 *   - **reads page.** One scope per page of 500 rows, which is the store's own
 *     keyset batch. Between pages the connection is back in the pool.
 *   - **writes batch.** Findings buffer and flush in one scope per batch, which
 *     turns one transaction per item into one per five hundred.
 *
 * Batching has to answer to the pass's rule 3 — *what was confirmed before a
 * failure stays confirmed* — so the flush is in a `finally`, not only at the
 * end of a happy path. Fifty thousand items read before the network dropped are
 * fifty thousand real answers, and a buffer that only flushed on success would
 * throw the last batch of them away.
 */

import type { Pool } from 'pg';
import {
  ConfirmationStore,
  RunStore,
  withTenant,
  type LedgerDriver,
  type PgDatabase,
} from '@openmig/ledger';
import {
  runConfirmationPass,
  type ConfirmationRecorder,
  type ConfirmationRunLog,
  type ConfirmableRowRef,
  type ConfirmedFinding,
  type TargetBudget,
} from '@openmig/core';
import { log, type DiscoveryDomain, type MappingId, type TenantId } from '@openmig/shared';

import { buildConfirmationReaders } from './build-confirmation-readers.ts';
import type { OpenTarget } from './target-fan-out.ts';

/** One page of rows, and one page of writes. The store's own keyset batch. */
const BATCH = 500;

/**
 * The ledger side of the pass, with a tenant scope per unit of work.
 *
 * `flush()` is exposed rather than left to a destructor: the caller calls it in
 * a `finally`, so a pass that dies keeps what it had already found (rule 3).
 */
export function confirmationRecorder(
  source: Pool | LedgerDriver,
  tenantId: TenantId,
): ConfirmationRecorder & { flush(): Promise<void> } {
  let pending: Array<{
    runId: string;
    finding: { itemId: string; answer: ConfirmedFinding['answer'] };
  }> = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    // Taken before the await so a concurrent `record` cannot land in the batch
    // being written and then be dropped by the reset below.
    const batch = pending;
    pending = [];
    await withTenant(source, tenantId, async (db: PgDatabase) => {
      const store = new ConfirmationStore(db);
      for (const { runId, finding } of batch) {
        await store.record({ tenantId, runId, finding });
      }
    });
  };

  return {
    async *itemsToConfirm(args: {
      tenantId: TenantId;
      mappingId: MappingId;
      domain: DiscoveryDomain;
    }): AsyncIterable<ConfirmableRowRef> {
      // The store pages internally; this re-pages OUTSIDE the scope so the
      // connection is released between pages. `after` is the same keyset
      // cursor, kept here because the scope does not survive the page.
      let after: string | undefined;
      for (;;) {
        const page: ConfirmableRowRef[] = await withTenant(
          source,
          tenantId,
          async (db: PgDatabase) => {
            const rows: ConfirmableRowRef[] = [];
            for await (const row of new ConfirmationStore(db).itemsToConfirm({
              ...args,
              batch: BATCH,
              ...(after ? { after } : {}),
            })) {
              rows.push(row);
              if (rows.length >= BATCH) break;
            }
            return rows;
          },
        );
        if (page.length === 0) return;
        for (const row of page) yield row;
        after = page[page.length - 1]!.itemId;
        if (page.length < BATCH) return;
      }
    },

    async record(args) {
      pending.push({ runId: args.runId, finding: args.finding });
      if (pending.length >= BATCH) await flush();
    },

    flush,
  };
}

/** The run row, opened and closed in its own short scopes. */
export function confirmationRunLog(
  source: Pool | LedgerDriver,
  tenantId: TenantId,
): ConfirmationRunLog {
  return {
    startRun: (input) =>
      withTenant(source, tenantId, (db: PgDatabase) => new RunStore(db).startRun(input)),
    finishRun: (runId, outcome, stats) =>
      withTenant(source, tenantId, (db: PgDatabase) =>
        new RunStore(db).finishRun(runId, outcome, stats),
      ),
  };
}

/**
 * Build the readers, run the pass, record what it found, release everything.
 *
 * The whole of a confirmation, minus the two things an edition owns: where the
 * ledger lives and how a target is opened.
 */
export async function runConfirmationOver(args: {
  source: Pool | LedgerDriver;
  tenantId: TenantId;
  mappingId: MappingId;
  open: OpenTarget;
  /** Domains to confirm. Absent means every domain that can be read. */
  wanted?: readonly DiscoveryDomain[];
  /** The tenant's budget for the target's provider, when one is known (D9). */
  budget?: TargetBudget;
  trigger?: 'manual' | 'schedule' | 'event';
}): Promise<{
  runId: string;
  tally: { verified: number; total: number };
  recorded: number;
  paused: boolean;
}> {
  const readers = await buildConfirmationReaders({
    open: args.open,
    ...(args.wanted ? { wanted: args.wanted } : {}),
    ...(args.budget ? { budget: args.budget } : {}),
  });

  const ledger = confirmationRecorder(args.source, args.tenantId);
  try {
    const result = await runConfirmationPass({
      tenantId: args.tenantId,
      mappingId: args.mappingId,
      domains: readers.domains,
      readerFor: readers.readerFor,
      ledger,
      runs: confirmationRunLog(args.source, args.tenantId),
      trigger: args.trigger ?? 'manual',
      ...(readers.meter ? { meter: readers.meter } : {}),
    });
    return {
      runId: result.runId,
      tally: result.tally,
      recorded: result.recorded,
      paused: result.budgetPause !== undefined,
    };
  } finally {
    // Rule 3: whatever was confirmed before a failure stays confirmed. The
    // flush is here rather than after the pass so a throw keeps the last
    // partial batch, and `close()` is here so a throw does not strand one
    // connection per domain.
    await ledger.flush().catch((err: unknown) => {
      log.error(
        `[confirm] ${args.mappingId}: could not write the last batch of findings: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await readers.close().catch(() => {});
  }
}
