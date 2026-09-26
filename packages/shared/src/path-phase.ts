// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE DATA TYPE'S PHASE (workplan 0128 T5; the owner, 2026-09-24, D8: *"we
 * need to split up cutover, since someone might want to keep syncing some
 * kinds, like keeps files running, while email cutover/stops"*).
 *
 * A migration's data types will each have their own lifecycle: mail can be
 * cut over, copy through its grace period and stop, while files keep running
 * as an ordinary sync. So every gate that decides whether a pass runs, and
 * whether a source still decides what exists, asks about ONE DATA TYPE, never
 * about the migration alone. This is the value it asks with.
 *
 * ## Readers before writers
 *
 * This module and the reader that fills it (`readPathPhases`, ledger) land
 * before anything can give a data type a phase of its own. Until then every
 * data type's phase is the migration's (`phasesOfTheMigration`), so the
 * answers are the ones the gates gave before. The order is the safety: had a
 * data type been cut over while a gate still read the migration as `active`,
 * the deletion detectors would have come back for it (0117 D4).
 */

import { runsPassesNow, sourceAuthorityFor, type SourceAuthority } from './lifecycle.ts';

/** A data type's lifecycle for one pass, as the gates read it. */
export interface PathPhase {
  /** The lifecycle word: `active`, `paused`, `cutover`, `done` or `continuous`. */
  readonly phase: string;
  /**
   * For `cutover`: whether its grace period is still open (0128 T2), read by
   * the same SQL the managed tick schedules by. False in every other phase.
   */
  readonly stillCopies: boolean;
  /**
   * Whether its owner stopped it (0128 T4): it runs no pass, whatever its
   * phase, and its copies stay. Absent while it runs. A stop is not a phase:
   * it is kept beside one (`path_lifecycle.stopped_at`).
   */
  readonly stopped?: boolean;
}

/** One data type's own path row, as the reader reads it. */
export interface PathRow {
  /** Its phase, `path_lifecycle.state`. */
  readonly state: string;
  /** Whether its owner stopped it (`stopped_at` is set). */
  readonly stopped?: boolean;
}

/** Each data type's phase, by data type. */
export type PathPhaseOf = (domain: string) => PathPhase;

/**
 * Whether this data type's passes run now: `runsPassesNow`, asked of one data
 * type, and never for one its owner stopped.
 */
export function pathRunsNow(path: PathPhase): boolean {
  return path.stopped !== true && runsPassesNow(path.phase, path.stillCopies);
}

/** Whether this data type's source still decides what exists: `sourceAuthorityFor`, of one data type. */
export function pathSourceAuthority(path: PathPhase): SourceAuthority {
  return sourceAuthorityFor(path.phase);
}

/**
 * Every data type in the migration's own phase: the only answer there is
 * until a data type can be cut over on its own (0128 T5, slice 5).
 */
export function phasesOfTheMigration(status: string, stillCopies = false): PathPhaseOf {
  const path: PathPhase = { phase: status, stillCopies: status === 'cutover' && stillCopies };
  return () => path;
}

/**
 * The migration's status its paths' phases add up to (0128 T5's roll-up), or
 * undefined for a migration with no path rows.
 *
 * - **Before its cutover** while any path is (`active`, `paused`, or a `ready`
 *   row): `active` when one of them runs, `paused` when every one is held.
 * - **`cutover`** once every path is at or past its cutover and one is in it.
 * - **`continuous`** once every path has ended or is kept, with one kept.
 * - **`done`** when every path has ended.
 *
 * While every path moves with its migration, the roll-up of a migration's rows
 * is its own status. When it is not, the rows were left behind by something
 * that wrote the status alone (the appliance's operator, told to set it back
 * by hand to resume), and the status is believed (`phasesOfThePaths`).
 * The managed tick asks the one case of it the status cannot see in SQL
 * (`A_PATH_KEPT_AFTER_A_CUTOVER_WHERE`, ledger); a test holds the two to one
 * answer.
 */
export function rollUpPhases(phases: readonly string[]): string | undefined {
  if (phases.length === 0) return undefined;
  const beforeCutover = phases.filter((p) => p === 'active' || p === 'paused' || p === 'ready');
  if (beforeCutover.length > 0) return beforeCutover.includes('active') ? 'active' : 'paused';
  if (phases.includes('cutover')) return 'cutover';
  if (phases.includes('continuous')) return 'continuous';
  return 'done';
}

/**
 * Each data type's phase from its own path row, where the rows agree with the
 * migration's status (`rollUpPhases`); the migration's phase for a data type
 * with no row, and for every data type when they do not agree.
 *
 * A stop is its owner's, and is kept whichever phase is believed (0128 T4): a
 * status set by hand does not start a data type its owner stopped. A stop can
 * only take passes away, never a deletion detector.
 *
 * `stillCopiesOf` is each data type's cutover window, asked of it in
 * `cutover`, whichever phase is believed: its own cutover ledger's, or the
 * whole migration's where it has none (`readCutoverWindows`, ledger; slice 4).
 */
export function phasesOfThePaths(
  status: string,
  stillCopiesOf: (domain: string) => boolean,
  paths: Readonly<Record<string, PathRow>>,
): PathPhaseOf {
  const agreed = rollUpPhases(Object.values(paths).map((p) => p.state)) === status;
  return (domain) => {
    const own = paths[domain];
    const believed = own === undefined || !agreed ? status : own.state;
    const phase: PathPhase = { phase: believed, stillCopies: believed === 'cutover' && stillCopiesOf(domain) };
    return own?.stopped === true ? { ...phase, stopped: true } : phase;
  };
}
