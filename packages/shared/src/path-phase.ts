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
}

/** Each data type's phase, by data type. */
export type PathPhaseOf = (domain: string) => PathPhase;

/** Whether this data type's passes run now: `runsPassesNow`, asked of one data type. */
export function pathRunsNow(path: PathPhase): boolean {
  return runsPassesNow(path.phase, path.stillCopies);
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
