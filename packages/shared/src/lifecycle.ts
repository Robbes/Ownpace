// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Mapping lifecycle decisions: what "Start migration" and "Finish migration" do
 * for a mapping in a given state.
 *
 * Pure functions, and in `@openmig/shared` under ADR-0026 because BOTH editions
 * make these decisions and they must make them identically. The refusal rules
 * are the operating semantics — most importantly that finishing is blocked by
 * unresolved failures — and an edition that quietly allowed what the other
 * refused would be a different product wearing the same UI.
 *
 * They decide; they do not act. Applying the decision (updating
 * `mailbox_mapping.status`, unscheduling) belongs to whichever edition is
 * asking, because that part genuinely differs: self-host unschedules an
 * in-process croner job, managed lets its poller notice the row is no longer
 * `active`.
 */

export type StartTransition = { readonly activate: boolean } | { readonly conflict: string };

/** Decide what "Start migration" does for a mapping currently in `status`. */
export function startTransition(status: string): StartTransition {
  if (status === 'cutover' || status === 'done') {
    return { conflict: `Cannot start a mapping in '${status}' state` };
  }
  // Activate only if not already active (idempotent second click).
  return { activate: status !== 'active' };
}

/** What "Finish migration" does for a mapping currently in `status`. */
export type FinishTransition =
  | { readonly finish: true }
  /** Already finished — say so without pretending work was done. */
  | { readonly finish: false; readonly alreadyDone: true }
  | { readonly refuse: string; readonly hint: string };

/**
 * Decide whether a migration may be marked finished.
 *
 * FINISHING IS THE END OF THE SHADOW SYNC. The mapping stops being scheduled,
 * so the source is no longer watched: no more copying, and no more drift,
 * deletion or move reporting. Everything already on the target stays exactly as
 * it is — this changes what the tool DOES NEXT, never what it has written.
 *
 * The one thing that blocks it is UNRESOLVED FAILURES. Those are items that
 * could not be copied and that the tool has stopped retrying; finishing over
 * them silently converts "we are still working on this" into "this is what you
 * got", which is precisely the kind of quiet data loss §11.2's decision queue
 * exists to prevent. The operator can still finish — `force` — but has to say
 * so, and the count is in the refusal so the decision is an informed one.
 *
 * Confirmed deletions and moves deliberately do NOT block. Neither is data
 * missing from the target: a deletion means the source no longer has something
 * the target still does, a move means the owner reorganised the source. The
 * safe default for both is already "the target keeps its copy", which is what
 * finishing leaves in place.
 */
export function finishTransition(
  status: string,
  unresolvedFailures: number,
  force = false,
): FinishTransition {
  if (status === 'done') return { finish: false, alreadyDone: true };
  if (status === 'paused') {
    return {
      refuse: "Cannot finish a mapping that was never started (it is 'paused')",
      hint: 'Start it first, or simply remove it from the config directory.',
    };
  }
  if (unresolvedFailures > 0 && !force) {
    return {
      refuse: `${unresolvedFailures} item(s) could not be migrated and are awaiting a decision`,
      hint:
        'Resolve them at GET /failures (retry, or accept to leave them behind), or re-send with ' +
        '?force=true to finish anyway and knowingly leave them unmigrated.',
    };
  }
  return { finish: true };
}
