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

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  pathRunsNow,
  phasesOfThePaths,
  rollUpPhases,
  runsPassesNow,
  shareMayBeApplied,
  type PathPhaseOf,
  type PathRow,
  addressTableDigest,
  addressTablePressDigest,
  sourceStillDecides,
  ADDRESS_DIGEST_OF_NO_CHANGE,
  type AddressChangeWaitsFor,
} from '@openmig/shared';
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
  /**
   * The marker a test migration copies by (`mailbox_mapping.test_marker`,
   * migration 0070, workplan 0162), when it is one; absent for every other
   * migration. Read here, beside the status and the grant, because a pass
   * already reads this before each data type: the appliance's pass builds
   * each data type's source with it (`runAllDomains`), so its sources are
   * wrapped as the managed builders wrap theirs.
   */
  readonly testMarker?: string;
  /**
   * The confirmed address table a person last pressed *Apply the new
   * addresses here too* for on this migration (`mailbox_mapping.
   * address_changes_applied_digest`, migration 0073; ADR-0055, workplan 0168
   * D5). Past a data type's cutover a pass applies the table only while this
   * is its digest now. Absent when nobody pressed it.
   */
  readonly addressChangesApplied?: string;
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
      testMarker: schemaPg.mailboxMapping.testMarker,
      addressChangesApplied: schemaPg.mailboxMapping.addressChangesAppliedDigest,
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
    ...(row.testMarker !== null ? { testMarker: row.testMarker } : {}),
    ...(row.addressChangesApplied !== null ? { addressChangesApplied: row.addressChangesApplied } : {}),
  };
}

/**
 * The press digest a person last recorded for this migration (migration
 * 0073; ADR-0055, workplan 0168 D5), or undefined when nobody pressed it. Not
 * a phase: the managed builder asks this beside the one reader of the phases
 * (`readPathPhases`), which the appliance's pass already holds.
 */
export async function readAddressChangesApplied(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ digest: schemaPg.mailboxMapping.addressChangesAppliedDigest })
    .from(schemaPg.mailboxMapping)
    .where(and(eq(schemaPg.mailboxMapping.id, mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)));
  return row?.digest ?? undefined;
}

/**
 * A person pressed *Apply the new addresses here too* on one migration
 * (ADR-0055; workplan 0168 D5): record the confirmed table's digest it was
 * pressed for, by whom, inside the organisation's transaction. Past a data
 * type's cutover, the next pass rewrites copies whose table moved, and only
 * while the table stays as it was pressed for. False when the migration is
 * not this organisation's, or gone. Pressing again for the same table writes
 * the same digest, and only who and when move.
 */
export async function recordAddressChangesApplied(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  digest: string,
  appliedBy: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('An address table digest is 64 hex characters.');
  const rows = await db
    .update(schemaPg.mailboxMapping)
    .set({
      addressChangesAppliedDigest: digest,
      addressChangesAppliedBy: appliedBy,
      addressChangesAppliedAt: sql`now()`,
    })
    .where(and(eq(schemaPg.mailboxMapping.id, mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)))
    .returning({ id: schemaPg.mailboxMapping.id });
  return rows.length > 0;
}

/**
 * The sharing queue's cutover gate for one migration (ADR-0032 §5; 0128 T5,
 * slice 6): whether a share of this subject may be applied now, its own data
 * type at or past its cutover, read as every gate reads a data type's phase.
 * A migration that is gone applies nothing.
 */
export async function readShareGate(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<(subject: string) => boolean> {
  const phases = await readPathPhases(db, tenantId, mappingId);
  if (phases === null) return () => false;
  return (subject) => shareMayBeApplied(subject, phases.status, phases.phaseOf);
}

/** What a press of *Apply the new addresses here too* answers. */
export interface AddressChangesApplied {
  /** The press digest recorded (`addressTablePressDigest`), or, when `moved`, the table's now. */
  readonly digest: string;
  /** How many confirmed rows the table held when it was pressed. A count, never an address. */
  readonly rows: number;
  /**
   * The table is not the one the page showed (workplan 0168 S5 (d)): nothing
   * was recorded. Both doors answer 409 with `ADDRESS_TABLE_MOVED`.
   */
  readonly moved?: true;
}

/**
 * THE PRESS ITSELF (ADR-0055; workplan 0168 D5), the one door both editions
 * use: read the organisation's confirmed address table as it is now, and
 * record its press digest on the migration. Null when the migration is not
 * this organisation's. The next pass rewrites, past a data type's cutover,
 * the copies whose table moved and that the person has not edited since
 * (the `If-Match` rule); before the cutover the press changes nothing, since
 * the table applies there anyway.
 */
export async function applyNewAddressesHere(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
  appliedBy: string,
  /**
   * The press digest of the table the page SHOWED (workplan 0168 S5 (d)).
   * Given and not the table's now, nothing is recorded and the answer says
   * `moved`: a row added or changed since would otherwise be applied to live
   * data unseen. Both doors pass it; absent, the table as it is now is
   * recorded, as before.
   */
  shown?: string,
): Promise<AddressChangesApplied | null> {
  const rows = await confirmedRowsOf(db, tenantId);
  const digest = addressTablePressDigest(rows);
  if (shown !== undefined && shown !== digest) {
    // Not this organisation's migration is still a 404, never a 409.
    const [mine] = await db
      .select({ id: schemaPg.mailboxMapping.id })
      .from(schemaPg.mailboxMapping)
      .where(and(eq(schemaPg.mailboxMapping.id, mappingId), eq(schemaPg.mailboxMapping.tenantId, tenantId)));
    return mine ? { digest, rows: rows.length, moved: true } : null;
  }
  const recorded = await recordAddressChangesApplied(db, tenantId, mappingId, digest, appliedBy);
  return recorded ? { digest, rows: rows.length } : null;
}

/** One data type's copies carrying an address change, or waiting for one (ADR-0055), counted. */
export interface AddressChangesInDomain {
  readonly domain: 'contact' | 'calendar' | 'task';
  /** Carry a change, and the last pass that looked found them as the table says. */
  readonly changed: number;
  /** Wait for a change a pass found should reach them (`item.address_digest_due`): never a match. */
  readonly older: number;
  /** Of `older`, those with no version to guard the write, left as they are (S1). */
  readonly unguarded: number;
  /**
   * What the rest of `older` waits for: the next pass, or, past this data
   * type's cutover with no press for the table as it is, *Apply the new
   * addresses here too* (D5). Absent when none waits for either.
   */
  readonly waitsFor?: AddressChangeWaitsFor;
}

/** The organisation's confirmed rows, as a pass reads them, by old key. */
async function confirmedRowsOf(db: PgDatabase, tenantId: string) {
  return db
    .select({
      oldKey: schemaPg.addressChange.oldKey,
      oldAddress: schemaPg.addressChange.oldAddress,
      newAddress: schemaPg.addressChange.newAddress,
    })
    .from(schemaPg.addressChange)
    .where(and(eq(schemaPg.addressChange.tenantId, tenantId), eq(schemaPg.addressChange.state, 'confirmed')))
    .orderBy(schemaPg.addressChange.oldKey);
}

/**
 * WHAT A WAITING COPY WAITS FOR, per data type of one migration (ADR-0055;
 * workplan 0168 D5; the screens' review S4, S11): the next pass, or, past the
 * data type's cutover with no press for the confirmed table as it is, *Apply
 * the new addresses here too*. Read as a pass reads it: the data type's phase
 * (`sourceStillDecides`) and the press against the table's press digest. One
 * answer for the confirmed list, verification and the report, so none of
 * them says "the next pass" of a copy that waits for a person.
 */
export async function readAddressChangeWaitsFor(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<(domain: string) => AddressChangeWaitsFor> {
  const phases = await readPathPhases(db, tenantId, mappingId);
  if (phases === null) return () => 'pass';
  const pressCovers =
    phases.addressChangesApplied !== undefined &&
    phases.addressChangesApplied === addressTablePressDigest(await confirmedRowsOf(db, tenantId));
  return (domain) => (!pressCovers && !sourceStillDecides(phases, domain) ? 'press' : 'pass');
}

/** A copy that waits for a change, in SQL: `waitsForAnAddressChange` of its two columns. */
export const ADDRESS_CHANGE_DUE_SQL = sql`(${schemaPg.item.addressDigestDue} IS NOT NULL AND ${schemaPg.item.addressDigestDue} IS DISTINCT FROM coalesce(${schemaPg.item.addressDigest}, ${ADDRESS_DIGEST_OF_NO_CHANGE}))`;

/** A copy whose recorded version can guard a write, in SQL: `guardsAnAddressRewrite`. */
const GUARDED_SQL = sql`(${schemaPg.item.targetVersion} IS NOT NULL AND ${schemaPg.item.targetVersion} <> '' AND ${schemaPg.item.targetVersion} NOT LIKE 'W/%')`;

/**
 * The address table's part of one migration, for its completion report
 * (ADR-0055; workplan 0168 §6.3, S3): how many confirmed rows the
 * organisation's table holds, its digest, and per data type how many copies
 * we wrote carry a change, how many wait for one, and for what. Counts only,
 * never an address. A data type with none is left out.
 */
export async function readAddressChangesForReport(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<{ readonly rows: number; readonly digest: string | null; readonly byDomain: AddressChangesInDomain[] }> {
  const rows = await confirmedRowsOf(db, tenantId);
  const digest = addressTableDigest(rows);
  const counted = await db
    .select({
      domain: schemaPg.item.domain,
      changed: sql`count(*) FILTER (WHERE ${schemaPg.item.addressDigest} IS NOT NULL AND NOT ${ADDRESS_CHANGE_DUE_SQL})`.mapWith(Number),
      older: sql`count(*) FILTER (WHERE ${ADDRESS_CHANGE_DUE_SQL})`.mapWith(Number),
      unguarded: sql`count(*) FILTER (WHERE ${ADDRESS_CHANGE_DUE_SQL} AND NOT ${GUARDED_SQL})`.mapWith(Number),
    })
    .from(schemaPg.item)
    .where(
      and(
        eq(schemaPg.item.tenantId, tenantId),
        eq(schemaPg.item.mappingId, mappingId),
        or(isNotNull(schemaPg.item.addressDigest), isNotNull(schemaPg.item.addressDigestDue)),
        inArray(schemaPg.item.status, ['copied', 'updated', 'deleted_source']),
      ),
    )
    .groupBy(schemaPg.item.domain);
  const waitsFor = await readAddressChangeWaitsFor(db, tenantId, mappingId);
  const byDomain: AddressChangesInDomain[] = [];
  for (const domain of ['contact', 'calendar', 'task'] as const) {
    const mine = counted.find((c) => c.domain === domain);
    if (!mine || mine.changed + mine.older === 0) continue;
    byDomain.push({
      domain,
      changed: mine.changed,
      older: mine.older,
      unguarded: mine.unguarded,
      ...(mine.older > mine.unguarded ? { waitsFor: waitsFor(domain) } : {}),
    });
  }
  return { rows: rows.length, digest, byDomain };
}
