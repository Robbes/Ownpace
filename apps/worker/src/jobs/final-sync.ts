// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CUTOVER'S FINAL SYNC IS THE PASS THE SCHEDULER RUNS (workplan 0128 T1).
 *
 * The final sync before a cutover used to be `runShadowPass`: the mail
 * reconcile, and nothing else. On a migration carrying calendars, contacts,
 * files and tasks, whatever changed in those since the last scheduled pass was
 * not in it, and the gate then measured a target that was not current. On a
 * migration without mail it could not start at all: building the mail target
 * refuses a migration that has none, so preparation failed at its first step
 * with a sentence about email nobody had selected. It is the defect
 * `run-full-sync` was deleted for (see `resolveSyncJob` in the API), one task
 * over.
 *
 * Now the preparation triggers `run-delta-sync` itself and waits for it: the
 * same loop over the migration's own selection, the same run row and status
 * rows, and the same queue, so the final pass waits for a scheduled pass
 * already running on the migration instead of overlapping it. What the pass did
 * is read from its own report, here.
 *
 * A pass that did not finish a data type leaves the target behind the source:
 * stopped at its deadline or at the day's download budget, never reached
 * because the migration stopped running, or — since a running pass hears it
 * from inside a data type (2026-09-29) — stopped WHILE it copied it, because
 * the migration was paused, its permission withdrawn or its organisation
 * closed. The preparation names which and stops short of ready, rather than
 * verifying a target it knows is not current.
 *
 * A data type the pass moved past is not one of them. Its owner stopped it
 * (0128 T4), so it no longer follows the source and the gate skips it too (D6),
 * or it no longer runs passes and has nothing left to copy. The pass says which
 * (`passedOver`), and the preparation names it and goes on. Until 2026-09-26 it
 * read as "reported nothing", and a whole migration with a stopped data type
 * could not be prepared at all.
 *
 * The same holds for a data type its owner stopped WHILE the pass copied it:
 * the pass heard it from inside and stopped, and the gate skips that data type
 * as it skips one stopped before. It is passed over, with what it copied up to
 * the stop still counted, not named unfinished.
 */

import type { PassCounts } from '@openmig/core';
import type { PassStopReason } from '@openmig/shared';
import type { PassHalt, PassSkip } from './stopping-a-pass.ts';

/**
 * Why a data type's pass stopped before it had finished: its own deadline, the
 * day's download budget, or because it was told to while it copied
 * (`haltedBecause` says by what).
 */
export type PassStop = 'deadline' | 'budget' | 'halt';

/** One data type's part of a pass, as `run-delta-sync` reports it. */
export interface DomainOutcome extends PassCounts {
  readonly stopped?: PassStop;
  /** For `stopped: 'halt'`: what the pass was told, from inside this data type (2026-09-29). */
  readonly haltedBecause?: PassStopReason;
}

/** What `run-delta-sync` returns about the data types it ran. */
export interface DeltaSyncOutput {
  /** The data types the pass set out to run, in order. */
  readonly asked: readonly string[];
  /** What each data type it ran did. */
  readonly domains: Readonly<Record<string, DomainOutcome>>;
  /**
   * The data types it moved past while the migration still ran, and why: its
   * owner stopped it (0128 T4), or it no longer runs passes. Absent when it
   * moved past none.
   */
  readonly passedOver?: Readonly<Record<string, PassSkip>>;
  /** The data type the pass stopped before, because the migration stopped running. */
  readonly stoppedBefore?: string;
  /** Why it stopped there: paused or finished, the person took their grant back, or the organisation was closed. */
  readonly stoppedBecause?: PassHalt;
}

/** The final sync, as the preparation reports it. */
export interface FinalSyncReport {
  /** Every data type's counts, added up. */
  readonly total: PassCounts;
  readonly byDomain: Readonly<Record<string, PassCounts>>;
  /** One sentence per data type the pass did not finish; empty when it finished them all. */
  readonly notFinished: readonly string[];
  /**
   * One sentence per data type the pass moved past. Not unfinished: a data type
   * its owner stopped no longer follows the source, and the gate skips it too
   * (D6), and one that no longer runs passes has nothing left to copy.
   */
  readonly passedOver: readonly string[];
}

const STOPPED: Record<Exclude<PassStop, 'halt'>, string> = {
  deadline: "stopped at the pass's own deadline",
  budget: "stopped at the day's download budget",
};

/** What stopped a data type's pass while it copied, as the end of a sentence (see `notReachedBecause`). */
const HALTED: Record<PassHalt, string> = {
  organisation_closed: 'the organisation was closed',
  grant_withdrawn: 'the person being migrated withdrew their permission',
  no_longer_runs: 'the migration was paused or finished',
};

/** Whether a reason the pass heard is one that moves past a data type, rather than stopping the pass. */
function isSkip(reason: PassStopReason): reason is PassSkip {
  return reason === 'stopped_by_its_owner' || reason === 'data_type_no_longer_runs';
}

const PASSED_OVER: Record<PassSkip, string> = {
  stopped_by_its_owner: 'passed over, because you stopped it',
  data_type_no_longer_runs: 'passed over, because it no longer runs passes (past its own cutover, or ended)',
};

/** The pass's own report, read for the cutover: counts per data type, and what it left unfinished. */
export function finalSyncReport(output: DeltaSyncOutput): FinalSyncReport {
  const byDomain: Record<string, PassCounts> = {};
  const notFinished: string[] = [];
  const passedOver: string[] = [];
  const total = { created: 0, updated: 0, adopted: 0, skipped: 0 };
  for (const domain of output.asked) {
    const outcome = output.domains[domain];
    const skip = output.passedOver?.[domain];
    if (!outcome && skip !== undefined) {
      passedOver.push(`${domain}: ${PASSED_OVER[skip]}`);
      continue;
    }
    if (!outcome) {
      notFinished.push(
        output.stoppedBefore === undefined
          ? `${domain} reported nothing`
          : `${domain} was not reached, because ${HALTED[output.stoppedBecause ?? 'no_longer_runs']} while the pass ran`,
      );
      continue;
    }
    const counts = {
      created: outcome.created,
      updated: outcome.updated,
      adopted: outcome.adopted,
      skipped: outcome.skipped,
    };
    byDomain[domain] = counts;
    total.created += counts.created;
    total.updated += counts.updated;
    total.adopted += counts.adopted;
    total.skipped += counts.skipped;
    if (outcome.stopped === 'halt') {
      const reason = outcome.haltedBecause ?? 'no_longer_runs';
      // Its counts are in, above, either way: what it copied up to the stop is
      // on the target. Only the sentence differs (D6).
      if (isSkip(reason)) passedOver.push(`${domain}: ${PASSED_OVER[reason]} while the pass copied it`);
      else notFinished.push(`${domain} stopped while copying, because ${HALTED[reason]} while the pass ran`);
    } else if (outcome.stopped) {
      notFinished.push(`${domain} ${STOPPED[outcome.stopped]}`);
    }
  }
  return { total, byDomain, notFinished, passedOver };
}
