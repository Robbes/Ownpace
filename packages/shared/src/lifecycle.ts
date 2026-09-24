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

import { MAPPING_LIFECYCLES } from './operating-contract.ts';

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
 * (`cutover` runs for a while: see `runsPassesNow`, which asks the time.)
 *
 * That cell, and a cutover's grace period (`runsPassesNow`, 0128 T2), are
 * the only places in this product where a pass reads a source that is no
 * longer the authority on what exists — which is why D4's rule has somewhere
 * to attach. `sourceIsAuthorityOnExistence` on a pass is precisely
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
 * Whether a migration's passes run NOW (workplan 0128 T2; the owner,
 * 2026-09-24, D1 (a): "bounded by the grace period, and slotless").
 *
 * `runsPasses`, plus one state for a while: `cutover`, from execute until the
 * cutover's grace period ends. The grace period is the cutover's own promise,
 * "both systems active", and the window in which mail still reaches the old
 * server while the MX record propagates. A pass then runs under the
 * after-cutover rules it always had in that state (`sourceAuthorityFor`): it
 * copies what is new or changed and mirrors no deletion. `cutover` holds no
 * slot (`holdsASlot`), so the grace period adds no path to anyone's bill;
 * what it copies joins the data meter, as every first copy does. When the
 * window closes,
 * passes stop, and nothing is ended for the owner: finishing, or keeping it
 * copying in the continuous lane, is still theirs to choose.
 *
 * Only a migration that was copying when execute ran: execute moves a paused
 * one to `cutover` too (ADR-0048), and what the operator stopped stays stopped
 * (`CutoverWindow.copiesThroughGrace`).
 *
 * The status alone cannot say it, because the answer depends on the time. So
 * every gate asks with the cutover's own window: `cutoverStillCopiesAt` here,
 * `CUTOVER_STILL_COPIES_WHERE` in SQL (`@openmig/ledger`), which
 * `a-grace-period-that-copies.unit.test.ts` holds in step.
 */
export function runsPassesNow(status: string, cutoverStillCopies: boolean): boolean {
  return runsPasses(status) || (status === 'cutover' && cutoverStillCopies);
}

/** A cutover's timing, as its ledger row holds it (`cutover_state`). */
export interface CutoverWindow {
  /** The cutover's own state: `CUTOVER_IN_PROGRESS`, `GRACE_PERIOD`, and the rest. */
  readonly state: string;
  /**
   * Whether the migration was copying when execute ran (ledger migration
   * 0064). Execute moves a paused migration to `cutover` too (ADR-0048), and
   * one the operator had stopped does not start copying because of a cutover.
   */
  readonly copiesThroughGrace: boolean;
  /** When the row last changed state: execute's start, while it is in progress. */
  readonly enteredAt: Date;
  /** When the grace period started; null before it has. */
  readonly graceStartedAt: Date | null;
  readonly graceHours: number;
}

/**
 * Until when a cutover's migration keeps copying: the grace period's end, and
 * while execute is still in progress, as long again from its start, so a
 * cutover whose execute never finished cannot copy for ever. Null in every
 * other state: completed, rolled back, failed, or not yet executed; and for a
 * migration that was not copying when execute ran.
 */
export function cutoverCopiesUntil(window: CutoverWindow): Date | null {
  if (!window.copiesThroughGrace) return null;
  const hours = window.graceHours * 3_600_000;
  if (window.state === 'GRACE_PERIOD') {
    return window.graceStartedAt ? new Date(window.graceStartedAt.getTime() + hours) : null;
  }
  if (window.state === 'CUTOVER_IN_PROGRESS') return new Date(window.enteredAt.getTime() + hours);
  return null;
}

/** Whether a cutover's migration copies now. `CUTOVER_STILL_COPIES_WHERE` says the same in SQL. */
export function cutoverStillCopiesAt(window: CutoverWindow | undefined, now: Date = new Date()): boolean {
  const until = window ? cutoverCopiesUntil(window) : null;
  return until !== null && now.getTime() < until.getTime();
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
 * The value is always `!isAfterCutover(phase)`, where the phase is the data
 * type's own (`readPathPhases`, ledger; workplan 0128 T5), read from the
 * database by whoever builds the deps. Until a data type can have a phase of
 * its own, it is the migration's `mailbox_mapping.status`. Nothing derives it
 * from a config file or a caller's opinion: the lifecycle is in the database,
 * and that is the only place that knows whether cutover has happened.
 */
export interface SourceAuthority {
  readonly sourceIsAuthorityOnExistence: boolean;
}

/** Read the pass's authority off a mapping's lifecycle. One expression, one place. */
export function sourceAuthorityFor(status: string): SourceAuthority {
  return { sourceIsAuthorityOnExistence: !isAfterCutover(status) };
}

/**
 * What a ROLLBACK does to the mapping — the setback's mapping half.
 *
 * ADR-0047, owner 2026-08-23: *"A rollback is a setback. It puts the migration
 * back to syncing, with the original source live again, and that is all of
 * it."* The cutover ledger's half is the state machine in `@openmig/core`;
 * THIS is the other half, and it is here for the reason `startTransition` and
 * `finishTransition` are: both editions must answer it identically, and for a
 * while neither answered it at all — the reachable rollback wrote the ledger
 * and left the mapping where it was, so an operator who rolled back had a
 * migration marked rolled back and a sync that never resumed.
 *
 * The table, read with `isAfterCutover` and `runsPasses` beside it:
 *
 *   | from         | to       | why                                                   |
 *   |--------------|----------|-------------------------------------------------------|
 *   | `cutover`    | `active` | stopped for the cutover; the cutover is over          |
 *   | `continuous` | `active` | still copying, but with the source NOT the authority  |
 *   |              |          | (no deletion mirroring, 0117 D4). After a rollback the|
 *   |              |          | source IS the authority again, and `active` is the    |
 *   |              |          | state that says so — the lane's detector-less phase   |
 *   |              |          | ends with the cutover it belonged to                  |
 *   | `active`     | —        | never stopped: a cutover executed before ADR-0048     |
 *   |              |          | (when `execute` left the mapping alone), or one the   |
 *   |              |          | person never declared on the Finish page              |
 *   | `paused`     | —        | an operator stopped it; a rollback ends the cutover,  |
 *   |              |          | it does not start what somebody stopped               |
 *   | `done`       | REFUSE   | finishing is the end of the shadow sync, and it is    |
 *   |              |          | terminal for the same reason `startTransition`        |
 *   |              |          | refuses it. A rollback that quietly un-finished would  |
 *   |              |          | be a second rule for leaving `done`                   |
 *
 * A refusal means NOTHING is written — not the ledger either. Half a rollback
 * is the defect this function exists to end.
 */
export type RollbackTransition =
  | { readonly reactivate: true; readonly from: string; readonly to: 'active' }
  | { readonly reactivate: false; readonly from: string; readonly reason: string }
  | { readonly refuse: string; readonly hint: string };

/** Decide what a rollback does to a mapping currently in `status`. */
export function rollbackTransition(status: string): RollbackTransition {
  switch (status) {
    case 'cutover':
    case 'continuous':
      return { reactivate: true, from: status, to: 'active' };
    case 'active':
      return {
        reactivate: false,
        from: status,
        reason: 'it is already syncing — the cutover never stopped it',
      };
    case 'paused':
      return {
        reactivate: false,
        from: status,
        reason:
          'an operator paused it; a rollback ends the cutover, it does not start what ' +
          'somebody stopped. Start it when you are ready.',
      };
    case 'done':
      return {
        refuse: "This migration was finished ('done'); a rollback does not undo a finish.",
        hint:
          "Nothing was changed. 'done' is terminal for the lifecycle — the same reason Start " +
          'refuses it. If the source must be live again, revert the MX record by hand; ' +
          "resuming the copy into this target would need the lifecycle to allow leaving 'done', " +
          'which it does not today.',
      };
    default:
      // Hard rule 9: a state this product does not know is not "one of the
      // ones that stays put". The CHECK constraint should make this
      // unreachable; if it is reached, say so rather than guess.
      return {
        refuse: `'${status}' is not a mapping lifecycle this product knows.`,
        hint: 'Nothing was changed. The database CHECK constraint should make this unreachable.',
      };
  }
}

/**
 * What a CUTOVER does to the mapping — the mapping half of `execute`, and of
 * `complete` (ADR-0048).
 *
 * The cutover ledger (`@openmig/core`'s state machine) records that mail is
 * being moved: APPROVED → CUTOVER_IN_PROGRESS while the operator points the MX
 * record at the target, GRACE_PERIOD once it has propagated, COMPLETED when the
 * window is closed. The MAPPING's lifecycle is what the appliance's tick and
 * the managed poller read to decide whether a pass runs, and what every pass
 * reads to decide whether the source is still the authority on what exists
 * (0117 D4). Until 2026-09-19 the CLI moved the ledger and never the mapping,
 * so a CLI-driven cutover left the mapping `active`: passes kept running with
 * the deletion detectors present, reading a source that had just stopped
 * being the authority — §3a's loop, with a ledger beside it saying the cutover
 * was in progress. And a rollback, which puts a `cutover` mapping back to
 * `active`, found nothing to put back.
 *
 * The table, read with `isAfterCutover` and `runsPasses` beside it:
 *
 *   | from         | to        | why                                                  |
 *   |--------------|-----------|------------------------------------------------------|
 *   | `active`     | `cutover` | the source is no longer the authority. THE row this  |
 *   |              |           | function exists for. At execute the copying goes on  |
 *   |              |           | until the grace period ends (0128 T2), then stops    |
 *   | `paused`     | `cutover` | somebody stopped it before the cutover; after the    |
 *   |              |           | cutover the phase has moved on, and `paused` would   |
 *   |              |           | let Start put it back to `active` — a pass with the  |
 *   |              |           | detectors present, after cutover. The confirmation   |
 *   |              |           | says the copy is not running, and it stays stopped   |
 *   |              |           | through the grace period; the operator decides (a    |
 *   |              |           | rollback afterwards resumes it)                      |
 *   | `cutover`    | —         | already stopped for a cutover (the Finish page's     |
 *   |              |           | declaration, or a re-run of this) — converge         |
 *   | `continuous` | —         | keeps copying after cutover BY DESIGN (0117 T1),     |
 *   |              |           | with the detectors absent; the source is already not |
 *   |              |           | the authority, and nothing here changes that         |
 *   | `done`       | —         | finished; the shadow sync has ended and nothing runs.|
 *   |              |           | Left alone with a WARNING: a rollback is refused for |
 *   |              |           | a finished migration, so reverting this cutover      |
 *   |              |           | later means a manual MX change                       |
 *
 * `complete` applies the same table: in the normal flow the mapping is already
 * `cutover` and the row converges, and a cutover executed before ADR-0048 —
 * ledger in GRACE_PERIOD, mapping still `active` — is stopped on the way to
 * COMPLETED rather than left running behind a terminal ledger.
 *
 * Only an unknown status refuses. A refusal means NOTHING is written — not the
 * ledger either.
 */
export type CutoverTransition =
  | { readonly stop: true; readonly from: string; readonly to: 'cutover' }
  | { readonly stop: false; readonly from: string; readonly reason: string; readonly warning?: string }
  | { readonly refuse: string; readonly hint: string };

/** Decide what a cutover (`execute`, and `complete`) does to a mapping currently in `status`. */
export function cutoverTransition(status: string): CutoverTransition {
  switch (status) {
    case 'active':
    case 'paused':
      return { stop: true, from: status, to: 'cutover' };
    case 'cutover':
      return { stop: false, from: status, reason: 'it is already stopped for a cutover' };
    case 'continuous':
      return {
        stop: false,
        from: status,
        reason:
          'it keeps copying after cutover by design (the continuous lane), with deletions at ' +
          'the source no longer mirrored — the source is already not the authority',
      };
    case 'done':
      return {
        stop: false,
        from: status,
        reason: 'it was finished; the shadow sync has ended and nothing runs',
        warning:
          "A rollback is refused for a finished ('done') migration. If this cutover has to be " +
          'reverted later, that means a manual MX change, not the rollback command.',
      };
    default:
      // Hard rule 9, as in `rollbackTransition`: an unknown status is not
      // "one of the ones that stays put".
      return {
        refuse: `'${status}' is not a mapping lifecycle this product knows.`,
        hint: 'Nothing was changed. The database CHECK constraint should make this unreachable.',
      };
  }
}

/**
 * Whether the migration a cutover's `execute` moves keeps being copied until
 * the grace period ends (workplan 0128 T2): when it was `active`. Execute
 * moves a paused one to `cutover` too, and what the operator stopped stays
 * stopped. `enterCutover` records the answer on the ledger row
 * (`copies_through_grace`), and the CLI says it before the operator approves.
 */
export function keepsCopyingThroughGrace(decision: CutoverTransition): boolean {
  return 'stop' in decision && decision.stop && decision.from === 'active';
}

/**
 * What a STATUS UPDATE may do — the `PUT /api/migrations/:id` door, asked
 * (ADR-0049).
 *
 * The route admitted every status its schema named and asked nobody: `cutover`
 * → `active` went through, and so did `done` → `paused` and `active` →
 * `continuous`, while `/start`, `/finish`, the appliance, the rollback and the
 * cutover each refuse exactly those. Two doors to one state, one guarded, is
 * the shape every lifecycle defect in this repository has had, and this table
 * closes the second door with the rules the first ones already hold:
 *
 *   - AFTER CUTOVER STAYS AFTER CUTOVER. `cutover`, `done` and `continuous` do
 *     not go back to `active` or `paused` by an update: the source is no
 *     longer the authority on what exists (0117 D4), and the only thing that
 *     makes it the authority again is a rollback (ADR-0047), which is recorded
 *     as one. `startTransition` refuses the same states.
 *   - `done` IS TERMINAL, with one exit: the continuous lane (0117 T1), which
 *     is entered from `done` or `cutover` and nowhere else.
 *   - A TRANSITION WITH ITS OWN DOOR IS REFUSED HERE AND SENT THERE. Starting
 *     is `/start` (it refuses a grant still being waited on and runs the first
 *     pass); finishing is `/finish` (it refuses over unresolved failures unless
 *     forced). An update that reached the same state would skip both rules.
 *   - THE LANE IS AFTER CUTOVER BY DEFINITION. `continuous` from `active` or
 *     `paused` would run with the deletion detectors absent while the source
 *     still IS the authority — declare the cutover first.
 *
 * The table, FROM down and TO across (· = nothing to do, same state):
 *
 *   |              | active   | paused   | cutover  | done     | continuous |
 *   |--------------|----------|----------|----------|----------|------------|
 *   | `active`     | ·        | pause    | declare  | own door | not yet    |
 *   | `paused`     | own door | ·        | declare  | own door | not yet    |
 *   | `cutover`    | after    | after    | ·        | own door | enter      |
 *   | `done`       | finished | finished | finished | ·        | enter      |
 *   | `continuous` | after    | after    | stop     | own door | ·          |
 *
 * Six moves, five no-ops, fourteen refusals — each refusal with a stable code
 * a screen can branch on, and a hint naming the door that does what was asked.
 * A refusal means NOTHING is written.
 */
export type UpdateRefuseCode = 'own_door' | 'after_cutover' | 'finished' | 'before_cutover' | 'unknown';

export type UpdateTransition =
  | { readonly apply: true; readonly from: string; readonly to: string }
  /** Restating the status a mapping already has: a request, not a transition. */
  | { readonly apply: false; readonly from: string; readonly alreadySo: true }
  | { readonly refuse: string; readonly hint: string; readonly code: UpdateRefuseCode };

/** Decide what a status update from `from` to `to` may do. */
export function updateTransition(from: string, to: string): UpdateTransition {
  const known = (s: string): boolean => (MAPPING_LIFECYCLES as readonly string[]).includes(s);
  if (!known(from) || !known(to)) {
    // Hard rule 9, as in the other decisions: a state this product does not
    // know is not one that "goes through".
    const which = known(from) ? to : from;
    return {
      refuse: `'${which}' is not a mapping lifecycle this product knows.`,
      hint: 'Nothing was changed. The schema and the database CHECK constraint should make this unreachable.',
      code: 'unknown',
    };
  }
  if (from === to) return { apply: false, from, alreadySo: true };

  if (from === 'done' && to !== 'continuous') {
    return {
      refuse: "This migration was finished ('done'), and 'done' is terminal.",
      hint:
        "The one thing that follows a finish is the continuous lane ('continuous'), which keeps " +
        'copying after cutover and deletes nothing. Nothing was changed.',
      code: 'finished',
    };
  }
  if (isAfterCutover(from) && !isAfterCutover(to)) {
    return {
      refuse:
        `This migration is after its cutover ('${from}'); the source is no longer the authority ` +
        'on what exists, and a status update does not bring it back before the cutover.',
      hint: "Only a rollback does that, recorded as one: the operator CLI's 'rollback'. Nothing was changed.",
      code: 'after_cutover',
    };
  }
  if (to === 'active') {
    return {
      refuse: "Starting is its own door, not a status update.",
      hint:
        'Use Start (POST /api/migrations/{id}/start): it also refuses a grant still being waited on ' +
        'and runs the first pass, which a status update would skip. Nothing was changed.',
      code: 'own_door',
    };
  }
  if (to === 'done') {
    return {
      refuse: 'Finishing is its own door, not a status update.',
      hint:
        'Use Finish (POST /api/migrations/{id}/finish): it refuses over unresolved failures unless ' +
        'you force it, which a status update would skip. Nothing was changed.',
      code: 'own_door',
    };
  }
  if (to === 'continuous' && !isAfterCutover(from)) {
    return {
      refuse:
        `The continuous lane is entered after a cutover — from 'cutover' or 'done' — and this ` +
        `migration is '${from}'.`,
      hint:
        'In the lane the source is no longer the authority and deletions there are not mirrored; ' +
        "that is not yet true of a migration still syncing. Declare the cutover first (status " +
        "'cutover'), or finish. Nothing was changed.",
      code: 'before_cutover',
    };
  }
  return { apply: true, from, to };
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
