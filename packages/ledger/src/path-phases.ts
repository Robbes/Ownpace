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
 * **Today every data type's phase is the migration's**, read from its row, with
 * the cutover's own window (`cutoverStillCopies`) asked only of a migration in
 * `cutover`. That is the answer every gate gave before, so nothing changes yet.
 * When a data type can have a phase of its own (`path_lifecycle`, slice 2), this
 * function is the one that learns to read it, and every gate follows at once.
 * A data type with no row of its own will then fall back to the migration's
 * phase, never to `ready`: for a gate, "no row" must not mean "before its
 * cutover", or a migration cut over before the rows existed would get its
 * deletion detectors back.
 */

import { eq } from 'drizzle-orm';
import { phasesOfTheMigration, type PathPhaseOf } from '@openmig/shared';
import * as schemaPg from './schema-pg.ts';
import type { PgDatabase } from './db-types.ts';
import { cutoverStillCopies } from './cutover-grace.ts';

/** One migration, as a pass sees it: its own row's facts, and each data type's phase. */
export interface MigrationPhases {
  /** The migration's own lifecycle word, `mailbox_mapping.status`. */
  readonly status: string;
  /** Whether its cutover's grace period is still open; false unless it is in `cutover`. */
  readonly stillCopies: boolean;
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
  // Asked only of a cutover, since no other phase depends on it (0128 T2).
  const stillCopies = row.status === 'cutover' && (await cutoverStillCopies(db, tenantId, mappingId));
  return {
    status: row.status,
    stillCopies,
    grantWithdrawnAt: row.grantWithdrawnAt,
    phaseOf: phasesOfTheMigration(row.status, stillCopies),
  };
}
