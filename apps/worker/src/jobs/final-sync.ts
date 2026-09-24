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
 * stopped at its deadline or at the day's download budget, or never reached
 * because the migration stopped running. The preparation names which and stops
 * short of ready, rather than verifying a target it knows is not current.
 */

import type { PassCounts } from '@openmig/core';
import type { PassHalt } from './stopping-a-pass.ts';

/** Why a data type's pass stopped before it had finished. */
export type PassStop = 'deadline' | 'budget';

/** One data type's part of a pass, as `run-delta-sync` reports it. */
export interface DomainOutcome extends PassCounts {
  readonly stopped?: PassStop;
}

/** What `run-delta-sync` returns about the data types it ran. */
export interface DeltaSyncOutput {
  /** The data types the pass set out to run, in order. */
  readonly asked: readonly string[];
  /** What each data type it ran did. */
  readonly domains: Readonly<Record<string, DomainOutcome>>;
  /** The data type the pass stopped before, because the migration stopped running. */
  readonly stoppedBefore?: string;
  /** Why it stopped there: paused or finished, or the person took their grant back. */
  readonly stoppedBecause?: PassHalt;
}

/** The final sync, as the preparation reports it. */
export interface FinalSyncReport {
  /** Every data type's counts, added up. */
  readonly total: PassCounts;
  readonly byDomain: Readonly<Record<string, PassCounts>>;
  /** One sentence per data type the pass did not finish; empty when it finished them all. */
  readonly notFinished: readonly string[];
}

const STOPPED: Record<PassStop, string> = {
  deadline: "stopped at the pass's own deadline",
  budget: "stopped at the day's download budget",
};

/** The pass's own report, read for the cutover: counts per data type, and what it left unfinished. */
export function finalSyncReport(output: DeltaSyncOutput): FinalSyncReport {
  const byDomain: Record<string, PassCounts> = {};
  const notFinished: string[] = [];
  const total = { created: 0, updated: 0, adopted: 0, skipped: 0 };
  for (const domain of output.asked) {
    const outcome = output.domains[domain];
    if (!outcome) {
      notFinished.push(
        output.stoppedBefore === undefined
          ? `${domain} reported nothing`
          : output.stoppedBecause === 'grant_withdrawn'
            ? `${domain} was not reached, because the person being migrated withdrew their permission while the pass ran`
            : `${domain} was not reached, because the migration was paused or finished while the pass ran`,
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
    if (outcome.stopped) notFinished.push(`${domain} ${STOPPED[outcome.stopped]}`);
  }
  return { total, byDomain, notFinished };
}
