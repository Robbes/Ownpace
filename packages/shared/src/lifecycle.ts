// Copyright 2026 The Ownpace authors (Apache-2.0)

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

/**
 * After cutover, the source is no longer the authority on what exists.
 *
 * Workplan 0117 **D4**, owner 2026-09-09: *"indeed, after cutover the source is
 * no longer the authority on what exists, so we will not delete in target based
 * on changes in the source."*
 *
 * ## Why this is a named function and not two comparisons
 *
 * It was two comparisons, in three places, and one of them was a hand-copied
 * duplicate of another including its message string. That is survivable while
 * the only thing the distinction does is refuse a second "Start" — and it stops
 * being survivable the moment anything RUNS in these states.
 *
 * Today nothing does: the appliance's tick schedules `active` and unschedules
 * everything else, so after cutover the product simply stops looking. 0117 §3c
 * calls that protection *"safe by accident"*, and §3a says what the accident is
 * protecting against — a pass that reads the source's bin after cutover, reads
 * a deletion the person made there deliberately, mirrors it onto the target,
 * and leaves the item existing nowhere. Every step behaving as designed.
 *
 * 0117 T1 (the continuous lane) is a mapping that keeps copying *after*
 * cutover, so it removes the accident. **The deletion detector must be absent
 * from that phase** — not gated per item, not filtered downstream (0117 §4D
 * rejects that: a gate strong enough to tell our deletion from the person's
 * needs T4's tombstones anyway, and a gate can be wrong once; absence cannot).
 *
 * **`continuous` is therefore IN this predicate, added with the state itself
 * on 2026-09-10 and never separately.** It is after cutover by definition —
 * entered from `cutover` or `done` — and this membership is the whole
 * mechanism by which the detector stays away from it. A `continuous` that is
 * not in here is a lane that runs with the detector present, which is §3a's
 * loop restored with no drain existing anywhere.
 *
 * This function exists so that rule has one place to live, and
 * `after-cutover-the-source-is-not-the-authority.unit.test.ts` exists so it
 * cannot quietly stop being true.
 */
export function isAfterCutover(status: string): boolean {
  return status === 'cutover' || status === 'done' || status === 'continuous';
}

/**
 * The states whose passes are SCHEDULED AND RUN. One authority, four gates.
 *
 * It was `status === 'active'`, four times, in code that cannot see each
 * other: the appliance's startup scan, the re-read `runMapping` does before
 * every pass, the `/mappings/{id}/run` route, and the managed tick's
 * `WHERE m.status = 'active'` in SQL. Four is survivable while there is one
 * running state. `continuous` is the second, and a lane missing from any one
 * of the four is a migration that runs on one edition and not the other, or
 * runs on a tick and stops the moment somebody presses Sync now.
 *
 * ## The intersection is the whole point
 *
 * `runsPasses` and `isAfterCutover` overlap in exactly one state, and that
 * state is `continuous`:
 *
 *   |            | before cutover      | after cutover          |
 *   |------------|---------------------|------------------------|
 *   | runs       | `active`            | **`continuous`**       |
 *   | does not   | `paused`            | `cutover`, `done`      |
 *
 * That cell is the only place in this product where a pass reads a source
 * that is no longer the authority on what exists — which is why D4's rule has
 * somewhere to attach. `sourceIsAuthorityOnExistence` on a pass is precisely
 * `!isAfterCutover(status)`, and the deletion detectors are assembled only
 * when it is true.
 *
 * Adding a state to this list therefore means answering two questions, not
 * one: does it run, and is the source still the authority while it does?
 * `a-lane-that-runs-with-the-detector-present.unit.test.ts` asks both.
 */
export function runsPasses(status: string): boolean {
  return status === 'active' || status === 'continuous';
}

/**
 * The same two, as a value, for the query that cannot call a function.
 *
 * `managed-sync-tick.ts` selects the mappings a tick considers in SQL, and SQL
 * cannot read `runsPasses`. It reads this instead, passed as a parameter —
 * the pattern that file already uses for every other list it needs, and for
 * the same stated reason: *"all passed in rather than written into the SQL so
 * each has ONE definition"*. A literal `'active'` left in that WHERE clause is
 * how the managed edition would keep the accident the appliance no longer has.
 */
export const PASS_RUNNING_STATES: readonly string[] = ['active', 'continuous'];

/**
 * The fact every pass carries about the phase it is running in.
 *
 * Spread onto each domain's dep object the way `PassClock` is, and for the
 * same reason: one docblock, one name, and a field a new sync path cannot
 * silently omit. `runDomainSync` documents what it does with it — in short,
 * `false` means the three deletion detectors are not assembled at all
 * (0117 D4 and §4D).
 *
 * The value is always `!isAfterCutover(mailbox_mapping.status)`, read from
 * the mapping's own row by whoever builds the deps. Nothing derives it from
 * a config file or a caller's opinion: the lifecycle is in the database, and
 * that is the only place that knows whether cutover has happened.
 */
export interface SourceAuthority {
  readonly sourceIsAuthorityOnExistence: boolean;
}

/** Read the pass's authority off a mapping's lifecycle. One expression, one place. */
export function sourceAuthorityFor(status: string): SourceAuthority {
  return { sourceIsAuthorityOnExistence: !isAfterCutover(status) };
}

export type StartTransition = { readonly activate: boolean } | { readonly conflict: string };

/** Decide what "Start migration" does for a mapping currently in `status`. */
export function startTransition(status: string): StartTransition {
  if (isAfterCutover(status)) {
    return { conflict: `Cannot start a mapping in '${status}' state` };
  }
  // Activate only if not already active (idempotent second click).
  return { activate: status !== 'active' };
}

/** Why a finish was refused — a STABLE discriminant beside the prose, so a
 *  UI can decide what to offer without matching sentence text (0038 T1: only
 *  the unresolved-failures refusal is one that `force` can satisfy, and the
 *  force affordance must never render on the others). */
export type FinishRefuseCode = 'paused' | 'unresolved_failures';

/** What "Finish migration" does for a mapping currently in `status`. */
export type FinishTransition =
  | { readonly finish: true }
  /** Already finished — say so without pretending work was done. */
  | { readonly finish: false; readonly alreadyDone: true }
  | { readonly refuse: string; readonly hint: string; readonly code: FinishRefuseCode };

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
    // Surface-neutral wording (0038 T7): the old hint said "remove it from
    // the config directory" — an appliance instruction served verbatim to
    // managed operators whose migrations live in no directory.
    return {
      refuse: "Cannot finish a migration that was never started (it is 'paused')",
      hint: 'Start it first — or remove the migration if it should not run at all.',
      code: 'paused',
    };
  }
  if (unresolvedFailures > 0 && !force) {
    // Surface-neutral wording (0038 T7): the old hint spoke curl ("GET
    // /failures", "re-send with ?force=true") beside a UI whose link and
    // button already do those things.
    return {
      refuse: `${unresolvedFailures} item(s) could not be migrated and are awaiting a decision`,
      hint:
        'Resolve them first — retry each item, or accept it to leave it behind; the failure ' +
        'queue lists every one. Finishing anyway leaves them unmigrated, knowingly.',
      code: 'unresolved_failures',
    };
  }
  return { finish: true };
}
