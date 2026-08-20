// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Stopping every pass before an erasure may start (workplan 0085 T8).
 *
 * ## What goes wrong if this is wrong, in both directions
 *
 * `item` IS the idempotency ledger. Purging it while a pass is still running
 * tells the next pass that nothing has been copied yet — and the next pass
 * copies it all again, **into the target of the customer who just asked to
 * leave**. So the purge must never run under a live pass. That is the rule the
 * existing skip already enforces, and nothing here weakens it.
 *
 * The other direction is the gap this closes. The skip is unconditional: a run
 * row that says `running` forever — because the worker died, or the process was
 * killed between its last write and its `finishRun` — blocks the purge on every
 * hourly attempt, for ever, with a warning nobody is reading. The customer was
 * given a date (0085 T5). The date passes. Nothing happens, and nothing says so
 * anywhere a person will look.
 *
 * ## Why "is it still running" is three answers, not two
 *
 * A row saying `running` is a claim by a process that may no longer exist. The
 * orchestrator is the only thing that actually knows, so each live row is one
 * of three cases and they are NOT interchangeable:
 *
 *   - **the orchestrator says it is finished** — the row is stale. Land it and
 *     carry on; there is nothing to wait for.
 *   - **the orchestrator says it is executing** — genuinely live. Ask it to
 *     stop, and wait. This is the case the whole safety rule exists for.
 *   - **we could not ask** — the orchestrator was unreachable, or the row
 *     predates handles being recorded at all.
 *
 * That third case is the one worth being careful about, and the careful answer
 * is asymmetric. **We do not purge on a guess.** Duplicating a leaving
 * customer's mail into their own mailbox is a data incident they experience;
 * an erasure running late is a promise we have broken, which is serious but
 * visible and recoverable. So an unreachable orchestrator blocks — and says it
 * needs attention, rather than logging at the same level as the ordinary case
 * and disappearing into the same noise.
 *
 * The one exception is a row with **no handle at all** that is older than the
 * staleness window. Nothing will ever resolve it: there is no handle to ask
 * about, and no process that would still be writing after that long. Those are
 * landed on age, which is also the only mechanism the appliance has — it runs
 * these passes in-process with no orchestrator to interrogate.
 *
 * Pure on purpose: no database, no network. The caller gathers the rows and
 * asks the orchestrator; this decides. That split is what makes the decision
 * testable at all, and it is a decision worth testing exhaustively.
 */

/** What the orchestrator says about a run we hold a handle for. */
export type OrchestratorVerdict =
  /** Still executing. */
  | 'live'
  /** Reached a terminal state — succeeded, failed or cancelled. */
  | 'finished'
  /** We could not ask, or there was no handle to ask about. */
  | 'unknown';

export interface QuiescingRun {
  readonly id: string;
  /** The orchestrator's own id for this run, when one was recorded. */
  readonly orchestratorRef?: string | null;
  /** Only rows the caller considers live are passed in. */
  readonly status: 'queued' | 'running';
  /** When it started, or was created if it never did. */
  readonly since: Date;
  /** What the orchestrator says now. `unknown` when it was not or could not be asked. */
  readonly verdict: OrchestratorVerdict;
}

export interface StaleRun {
  readonly id: string;
  /** Recorded on the landed row, so the next reader knows why it says cancelled. */
  readonly reason: string;
}

export interface QuiescePlan {
  /** Rows that cannot be live. Land them as `cancelled` with the reason given. */
  readonly landStale: readonly StaleRun[];
  /** Live runs to ask the orchestrator to stop. Safe to repeat — cancelling twice is a no-op. */
  readonly cancel: readonly string[];
  /** True only when nothing is left in flight once the stale rows are landed. */
  readonly mayPurge: boolean;
  /**
   * Why the purge may not proceed, one line per run. Empty when `mayPurge`.
   */
  readonly blockedBy: readonly string[];
  /**
   * Something a person has to look at: the orchestrator could not be asked, so
   * we are blocking without knowing. Distinguished from ordinary waiting
   * because ordinary waiting resolves itself and this does not.
   */
  readonly needsAttention: boolean;
}

/**
 * How long a run with no orchestrator handle may sit `running` before it is
 * treated as abandoned. Generous: a first full copy of a large mailbox is a
 * legitimately long thing, and this must never land one that is still working.
 *
 * It is only ever applied to a tenant that is already CLOSED and past its
 * erasure window, which is the reason a day is safe rather than reckless —
 * closing stops the scheduler picking the mapping up, so nothing new starts,
 * and anything from before the close has had the whole window to finish.
 */
export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function quiescePlan(
  runs: readonly QuiescingRun[],
  now: Date,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): QuiescePlan {
  const landStale: StaleRun[] = [];
  const cancel: string[] = [];
  const blockedBy: string[] = [];
  let needsAttention = false;

  for (const run of runs) {
    const ageMs = now.getTime() - run.since.getTime();

    if (run.verdict === 'finished') {
      // The row outlived the process that owned it. Nothing to wait for.
      landStale.push({
        id: run.id,
        reason:
          'landed by the erasure quiesce: the row still said ' +
          `${run.status}, and the orchestrator reports this run is no longer executing.`,
      });
      continue;
    }

    if (run.verdict === 'live') {
      cancel.push(run.id);
      blockedBy.push(`${run.id}: still executing; cancellation requested`);
      continue;
    }

    // verdict === 'unknown'
    if (!run.orchestratorRef && ageMs >= staleAfterMs) {
      // No handle was ever recorded and it has been far too long. Nothing will
      // ever resolve this row, and no process is still writing behind it.
      landStale.push({
        id: run.id,
        reason:
          'landed by the erasure quiesce: no orchestrator handle was recorded and the row has ' +
          `said ${run.status} for over ${Math.floor(staleAfterMs / 3_600_000)}h, which no live pass does.`,
      });
      continue;
    }

    // We hold a handle but could not ask, or there is no handle and it is not
    // yet old enough. Either way we do not know, so we do not purge.
    blockedBy.push(
      run.orchestratorRef
        ? `${run.id}: the orchestrator could not be asked about ${run.orchestratorRef}`
        : `${run.id}: no orchestrator handle, and only ${Math.floor(ageMs / 60_000)}m old`,
    );
    if (run.orchestratorRef) needsAttention = true;
  }

  return {
    landStale,
    cancel,
    mayPurge: blockedBy.length === 0,
    blockedBy,
    needsAttention,
  };
}
