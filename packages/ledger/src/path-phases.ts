// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EACH DATA TYPE'S PHASE, AS EVERY GATE READS IT (workplan 0128 T5, slice 1).
 *
 * The one place a gate learns, for one migration, whether it still runs at all
 * and in which phase each of its data types is: the managed pass between its
 * data types, the managed dependency builders, and the appliance's pass. The
 * rules they apply to the answer are in shared (`pathRunsNow`,
 * `pathSourceAuthority`).
 *
 * **Each data type's phase is its own path row's** (slice 2b), where the
 * migration's included path rows add up to its status (`rollUpPhases`). A data
 * type with no row falls back to the migration's phase, never to `ready`: for
 * a gate, "no row" must not mean "before its cutover", or a migration cut over
 * before the rows existed would get its deletion detectors back. And when the
 * rows do not add up to the status, the status is believed for every data type:
 * the rows were left behind by something that wrote the status alone, and the
 * status is the answer every gate gave before the rows existed.
 *
 * The cutover windows (`readCutoverWindows`) are asked when the migration or
 * one of its paths is in `cutover`: each data type's is its own cutover
 * ledger's, or the whole migration's where it has none (slice 4).
 *
 * A data type its owner stopped (0128 T4, `stopped_at`) is stopped whichever
 * phase is believed: it runs no pass, and its phase says the rest.
 */

import { and, eq } from 'drizzle-orm';
import { pathRunsNow, phasesOfThePaths, rollUpPhases, runsPassesNow, type PathPhaseOf, type PathRow } from '@openmig/shared';
import * as schemaPg from './schema-pg.ts';
import type { PgDatabase } from './db-types.ts';
import { NO_CUTOVER_WINDOWS, readCutoverWindows } from './cutover-grace.ts';

/**
 * The managed tick's twin of `anyRuns` for the one case the migration's own
 * status cannot see (0128 T5, slice 2b), as a SQL condition on `mailbox_mapping
 * m`: a migration in `cutover` whose rows add up to `cutover` (none before its
 * cutover, one in it) and keep a data type in the lane that its owner has not
 * stopped (0128 T4). Its cutover's window may be closed, and that data type
 * still runs. Every other case is the migration's own status, which the tick
 * already asks.
 *
 * Only included data types are paths, as in `readPathPhases`. A test runs the
 * tick's query and the reader on the same rows and holds them to one answer.
 */
export const A_PATH_KEPT_AFTER_A_CUTOVER_WHERE = `m.status = 'cutover'
                   AND EXISTS (SELECT 1 FROM path_lifecycle p
                                 JOIN scope_selection s
                                   ON s.mapping_id = p.mapping_id AND s.domain = p.domain AND s.included
                                WHERE p.mapping_id = m.id AND p.state = 'continuous' AND p.stopped_at IS NULL)
                   AND EXISTS (SELECT 1 FROM path_lifecycle p
                                 JOIN scope_selection s
                                   ON s.mapping_id = p.mapping_id AND s.domain = p.domain AND s.included
                                WHERE p.mapping_id = m.id AND p.state = 'cutover')
                   AND NOT EXISTS (SELECT 1 FROM path_lifecycle p
                                     JOIN scope_selection s
                                       ON s.mapping_id = p.mapping_id AND s.domain = p.domain AND s.included
                                    WHERE p.mapping_id = m.id AND p.state IN ('active', 'paused', 'ready'))`;

/** One migration, as a pass sees it: its own row's facts, and each data type's phase. */
export interface MigrationPhases {
  /** The migration's own lifecycle word, `mailbox_mapping.status`. */
  readonly status: string;
  /**
   * Whether any of its cutover ledgers still copies, the whole migration's or a
   * data type's own (slice 4): the managed tick's question. False unless the
   * migration or one of its paths is in `cutover`. Each data type's own window
   * is in `phaseOf`.
   */
  readonly stillCopies: boolean;
  /**
   * Whether any of its data types runs passes now: the gate the managed pass
   * stops by, and the appliance schedules by. Nothing runs while the migration
   * is held (`paused`). Otherwise the migration runs by its own status, or, where
   * its rows add up to that status, because one of its paths does: a data type
   * kept in the lane while another is past its cutover's grace period, and not
   * stopped by its owner (0128 T4). A running migration whose every data type
   * is stopped still answers true, and its pass moves past each one: its owner
   * cannot make one, since the last data type still copying cannot be stopped
   * (D5).
   */
  readonly anyRuns: boolean;
  /** When the person who granted access took it back (0108 T8 (c)), or null. */
  readonly grantWithdrawnAt: Date | null;
  /** Each data type's phase. */
  readonly phaseOf: PathPhaseOf;
}

/**
 * Read one migration's phases, inside the organisation's transaction. Null when
 * the migration no longer exists: no row is not a running row.
 */
export async function readPathPhases(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<MigrationPhases | null> {
  const [row] = await db
    .select({
      status: schemaPg.mailboxMapping.status,
      grantWithdrawnAt: schemaPg.mailboxMapping.grantWithdrawnAt,
    })
    .from(schemaPg.mailboxMapping)
    .where(eq(schemaPg.mailboxMapping.id, mappingId));
  if (row === undefined) return null;
  // Its paths: the included data types' own rows (a switched-off one is not a path).
  const rows = await db
    .select({
      domain: schemaPg.pathLifecycle.domain,
      state: schemaPg.pathLifecycle.state,
      stoppedAt: schemaPg.pathLifecycle.stoppedAt,
    })
    .from(schemaPg.pathLifecycle)
    .innerJoin(
      schemaPg.scopeSelection,
      and(
        eq(schemaPg.scopeSelection.mappingId, schemaPg.pathLifecycle.mappingId),
        eq(schemaPg.scopeSelection.domain, schemaPg.pathLifecycle.domain),
        eq(schemaPg.scopeSelection.included, true),
      ),
    )
    .where(eq(schemaPg.pathLifecycle.mappingId, mappingId));
  const paths: Record<string, PathRow> = Object.fromEntries(
    rows.map((r) => [r.domain, r.stoppedAt === null ? { state: r.state } : { state: r.state, stopped: true }]),
  );
  const states = Object.values(paths).map((p) => p.state);
  // Asked only of a cutover, since no other phase depends on it (0128 T2).
  const inCutover = row.status === 'cutover' || states.includes('cutover');
  const windows = inCutover ? await readCutoverWindows(db, tenantId, mappingId) : NO_CUTOVER_WINDOWS;
  const agreed = rollUpPhases(states) === row.status;
  const anyRuns =
    row.status !== 'paused' &&
    (runsPassesNow(row.status, row.status === 'cutover' && windows.any) ||
      (agreed &&
        Object.entries(paths).some(([domain, p]) =>
          pathRunsNow({ phase: p.state, stillCopies: p.state === 'cutover' && windows.of(domain), stopped: p.stopped }),
        )));
  return {
    status: row.status,
    stillCopies: windows.any,
    grantWithdrawnAt: row.grantWithdrawnAt,
    phaseOf: phasesOfThePaths(row.status, windows.of, paths),
    anyRuns,
  };
}
