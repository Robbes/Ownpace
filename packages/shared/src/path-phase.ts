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

/**
 * WHY A PASS STOPS, DECIDED HERE FOR BOTH EDITIONS (2026-09-29).
 *
 * The decision below lived in the managed worker (`stopping-a-pass.ts`) for as
 * long as only the managed pass asked it, and only between data types. A pause
 * pressed during a data type's pass then waited for that pass's own deadline,
 * up to fifty minutes, so the pass now asks the same question from inside
 * (`PassClock.whyItStops`), and the appliance asks it too. The appliance
 * cannot import the worker, and a second reading of the lifecycle written out
 * for it is exactly what `stopping-a-pass.ts` refuses: so the pure half moved
 * here, and the worker re-exports it unchanged. Reading the rows stays with
 * each edition's own reader.
 */

/**
 * One migration as the decision needs it: the three facts `readPathPhases`
 * (ledger) reads, typed by shape so this package stays free of the ledger.
 * Null when the migration no longer exists. Its `MigrationPhases` is one.
 */
export type PassPhases = {
  /** Whether any of its data types runs passes now (`MigrationPhases.anyRuns`). */
  readonly anyRuns: boolean;
  /** When the person who granted access took it back (0108 T8 (c)), or null. */
  readonly grantWithdrawnAt: Date | null;
  /** Each data type's phase. */
  readonly phaseOf: PathPhaseOf;
} | null;

/**
 * Why a pass stops before its next data type: the migration no longer runs
 * (paused, finished or gone), the person who granted it access took the grant
 * back (workplan 0108 T8 (c), ledger migration 0063), or the organisation was
 * closed (workplan 0085 T2; the owner's report of 2026-09-28).
 */
export type PassHalt = 'no_longer_runs' | 'grant_withdrawn' | 'organisation_closed';

/** Why a pass moved past one data type while the migration still ran. */
export type PassSkip = 'data_type_no_longer_runs' | 'stopped_by_its_owner';

/**
 * What a pass does before one data type (workplan 0128 T5): stop, when the
 * migration itself no longer runs, its grant was withdrawn, or its organisation
 * was closed (0085 T2); move on past this data type, when the migration still
 * runs and this data type does not (its own cutover past its grace period,
 * ended, or stopped by its owner, 0128 T4), so the next one still gets its
 * turn; and otherwise run it.
 */
export type PassStep =
  | { readonly run: true }
  | { readonly skip: PassSkip }
  | { readonly halt: PassHalt };

/**
 * Why a pass ALREADY COPYING one data type must stop taking new work: any
 * answer `PassStep` can give but "run". Inside a data type the two kinds end
 * the same way, and the loop does not need to tell them apart; its caller
 * does, and reads which one it was from the reason itself.
 */
export type PassStopReason = PassHalt | PassSkip;

/**
 * The migration's answer, from its phases: gone, or no longer running (paused,
 * finished, or a cutover past its grace period, 0128 T2), or its grant taken
 * back. Null when the pass may go on.
 */
export function haltFrom(phases: PassPhases): PassHalt | null {
  if (phases === null) return 'no_longer_runs';
  // No data type of it runs any more (0128 T5, slice 2b): the migration's own
  // answer, or a path kept in the lane while another is past its cutover.
  if (!phases.anyRuns) return 'no_longer_runs';
  return phases.grantWithdrawnAt ? 'grant_withdrawn' : null;
}

/**
 * The decision before one data type, from the phases already read.
 *
 * A data type's phase is its own path row's (slice 2b), its stop its owner's
 * (0128 T4), and its grace window its own cutover ledger's, or the whole
 * migration's where it has none (slice 4). So once mail is cut over on its own
 * (slice 5), a pass moves on past it when its window closes, and the files
 * after it keep their turn.
 */
export function stepFrom(phases: PassPhases, domain: string): PassStep {
  const halt = haltFrom(phases);
  if (halt) return { halt };
  const path = phases!.phaseOf(domain);
  // Its owner stopped it (0128 T4): said as such, not as an ending.
  if (path.stopped === true) return { skip: 'stopped_by_its_owner' };
  if (!pathRunsNow(path)) return { skip: 'data_type_no_longer_runs' };
  return { run: true };
}

/** A step, as the one answer a pass inside a data type needs: why it stops, or null to go on. */
export function stopReasonOf(step: PassStep): PassStopReason | null {
  if ('halt' in step) return step.halt;
  if ('skip' in step) return step.skip;
  return null;
}
