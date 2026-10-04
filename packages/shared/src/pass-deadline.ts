// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CLOCK A PASS STOPS ITSELF BY, so that nothing else has to stop it.
 *
 * A managed pass runs as a Trigger.dev task under `maxDuration` (see
 * `apps/worker/trigger.config.ts`). That ceiling is a KILL, not a request:
 * when it fires the task process ends where it stands, mid-item, and none of
 * the code that closes a run row gets to run. The mapping's `run` row then
 * sits at `running` for ever, and `managed-sync-tick` — which skips a mapping
 * that already has one — never enqueues that mapping again. Silently, and for
 * good (2026-09-08).
 *
 * A 100 GB first copy does not fit in an hour. It was never going to; the
 * ceiling is not the wrong number, it is the wrong MECHANISM for the job.
 * Raising it only moves the wall.
 *
 * So the pass carries its own, earlier deadline and stops CLEANLY at it —
 * between items, with its counters intact and its cursor untouched — exactly
 * as it already does at the day's byte ceiling (workplan 0090 T4). The next
 * scheduled pass continues from the same cursor, the ledger fast-path skips
 * what is already copied without re-fetching it, and a big migration crosses
 * many passes by design rather than by accident.
 *
 * `maxDuration` then means what a backstop should mean: nothing reached it
 * unless something is genuinely wrong.
 */

import type { PassStopReason } from './path-phase.ts';

/**
 * The task runner's hard kill, in milliseconds — `maxDuration: 3600` in
 * `apps/worker/trigger.config.ts`, written here in the unit the rest of this
 * file uses.
 *
 * Duplicated in the sense that the config states it in seconds and this states
 * it in milliseconds, which is a duplication a guard can hold together and a
 * comment cannot: `scripts/a-pass-that-outlives-its-runner.unit.test.ts` reads
 * both and fails the build if they disagree, or if the soft deadline below
 * ever reaches it. Imported into the config instead would be neater and is
 * deliberately not done — that file is loaded a second time inside the
 * build's indexer container, where a workspace import has already cost this
 * repository one aborted deploy.
 */
export const PASS_HARD_LIMIT_MS = 3_600_000;

/**
 * How long a pass may take before it stops taking new work: **50 minutes**.
 *
 * Ten minutes under the hard kill, and every minute of that margin is spent
 * on something:
 *
 *  - the item in flight when the deadline lands still finishes. A pass that
 *    abandoned a half-written item would be the destructive failure this
 *    product does not have — so the margin has to cover the slowest single
 *    item, and the slowest single item is a large file on a slow target;
 *  - the folder's cursor decision, the ledger writes, the domain's status
 *    row, and the run row all have to land after that;
 *  - and the runner itself is not instant to tear down.
 *
 * It is deliberately NOT derived as a fraction of the hard limit. A fraction
 * looks principled and answers the wrong question: what the margin must cover
 * is one item plus the closing writes, which does not scale with the ceiling.
 * If the ceiling doubled, the margin should not.
 *
 * A starting point rather than a measurement. Nobody here has yet watched a
 * real 100 GB copy against a slow target, and the honest thing to do with the
 * first such run is read what its slowest item cost and move this number to
 * fit — which is why it is one exported constant and not a scatter of
 * literals.
 */
export const PASS_SOFT_DEADLINE_MS = 50 * 60 * 1000;

/**
 * Set when a pass stopped because its own deadline arrived.
 *
 * A SCHEDULED PAUSE, not an error — the same contract `BudgetPause` carries,
 * and for the same reasons: nothing failed, no item is owed a retry, the
 * paused folder keeps its cursor, and the next pass continues. The two are
 * kept apart rather than merged because a reader has to be able to tell "we
 * ran out of the day's bytes" from "we ran out of this pass's minutes": the
 * first resolves when a window resets and the second on the next tick, and
 * telling somebody the wrong one wastes their afternoon.
 */
export interface DeadlinePause {
  /** ISO timestamp the pass was told to stop taking new work by. */
  readonly deadlineAt: string;
  /** Milliseconds of wall time the pass actually ran before it stopped. */
  readonly ranForMs: number;
  /**
   * Collections listed for this domain that the pass never reached. Absent
   * when the deadline landed inside the last one — which is not the same as
   * zero, and saying zero there would report a finished domain.
   */
  readonly collectionsNotReached?: number;
}

/**
 * HOW OFTEN A RUNNING PASS ASKS WHETHER IT HAS BEEN TOLD TO STOP: at most once
 * every **15 seconds** of its own clock (2026-09-29).
 *
 * The owner pressed Pause while a file pass was writing large files into a
 * Nextcloud target, and the writes went on for most of an hour: about two
 * thousand PUTs after the press. The pass re-read its migration between data
 * types only, on the reasoning that each data type's pass "already stops
 * itself at its own deadline", and that deadline is fifty minutes away. So a
 * pass is now handed the between-types question to ask from inside a data
 * type (`PassClock.whyItStops`), and this is how often it asks.
 *
 * What one asking costs, counted (review, 2026-09-29: the first count here
 * said "two or three statements" and "under one a second", which was wrong on
 * its own terms). On the managed stack it is `passStepBefore`: one
 * transaction holding three SELECTs (the organisation's status, the
 * migration's row, its data types' rows) and a fourth during a cutover (the
 * cutover's windows), inside BEGIN, set_config and COMMIT, with SET LOCAL ROLE
 * when the driver has a role: six to eight round trips. At six passes in
 * flight, each asking at most once in this interval, that is about 1.2 SELECTs
 * a second for the whole box (1.6 during a cutover), or 2.4 to 3.2 round
 * trips, beside passes that already talk to the ledger about every item they
 * list. On the appliance it is the same transaction without the organisation's
 * read, queued on its single connection. Asking per item instead would roughly
 * double a steady-state pass's ledger traffic for an answer that changes a few
 * times a year.
 *
 * What it buys: a pause is heard within this interval, and the items in
 * flight finish, because an item abandoned half-written would be the
 * destructive failure this product does not have. Until it is heard the pass
 * goes on starting items as before, so the items begun in the seconds between
 * the press and the next asking are copied in full too (review, 2026-09-29:
 * the sentences that said "starts nothing new" from the press were not true,
 * and now say this). A large file on a slow target can take longer than the
 * interval by itself; nothing here promises seconds for that one, only that
 * nothing new begins once the pass has heard.
 *
 * A starting point, like `PASS_SOFT_DEADLINE_MS`, and one constant for the
 * same reason: if a real box shows the asking in its ledger traffic, move it.
 */
export const PASS_REREAD_EVERY_MS = 15_000;

/**
 * Set when a pass stopped because it was TOLD to: its migration was paused or
 * finished, the person being migrated took their grant back, the organisation
 * was closed, or this data type was stopped by its owner or no longer runs.
 *
 * A stop somebody or the migration's own state asked for, not a clock and not
 * a meter, with the same contract `DeadlinePause` carries: nothing failed, no
 * item is owed a retry, the collection it stopped inside keeps its cursor, and
 * nothing it did not reach is concluded gone. Kept apart from the other two so
 * a reader can tell "you paused it" from "the pass's minutes ran out" and from
 * "the day's bytes are spent": the first comes back with a Resume (or a new
 * grant, or a reopen), and neither of the others does anything for it.
 */
export interface HaltPause {
  /** What the question answered. `HALT_IN_WORDS` says it as a sentence. */
  readonly reason: PassStopReason;
  /** ISO timestamp, on the pass's own clock, of the asking that heard it. */
  readonly noticedAt: string;
  /** Milliseconds of wall time the pass ran before it heard it. */
  readonly ranForMs: number;
  /**
   * Collections listed for this domain that the pass never reached. Absent
   * when the stop landed inside the last one, as with `DeadlinePause`: absent
   * is not zero, and zero would report a finished domain.
   */
  readonly collectionsNotReached?: number;
}

/**
 * Each answer, as the second half of a sentence that starts "because": the
 * loop's log line, the managed run log and the appliance's log all say it the
 * same way. Exhaustive by type, so a sixth reason cannot be added without
 * words. Never "deadline" and never "budget": those are the other two stops'.
 */
export const HALT_IN_WORDS: Readonly<Record<PassStopReason, string>> = {
  no_longer_runs: "the migration no longer runs passes (paused, finished, or past its cutover's grace period)",
  grant_withdrawn: 'the person being migrated withdrew their permission',
  organisation_closed: 'the organisation was closed',
  stopped_by_its_owner: 'its owner stopped this data type',
  data_type_no_longer_runs:
    'this data type no longer runs passes (its own cutover is past its grace period, or it has ended)',
};

/**
 * The absolute moment a pass starting now must stop taking new work.
 *
 * A function rather than an addition at each call site so that "when does
 * this pass stop" has one answer, and so the tests can ask it the same way
 * the job does.
 */
export function passDeadlineFrom(
  startedAtMs: number,
  budgetMs: number = PASS_SOFT_DEADLINE_MS,
): number {
  return startedAtMs + budgetMs;
}

/**
 * The clock fields a pass carries from its caller down into the sync loop.
 *
 * One declaration rather than the same two optional fields typed out on each
 * domain's deps: there are five sync entry points (mail, calendar, contact,
 * file, task) and this repository's most expensive recurring defect is a set
 * of parallel branches that agree by hand until somebody adds a sixth.
 */
export interface PassClock {
  /**
   * The moment this pass must stop taking new work (epoch ms), or absent for
   * a pass with no deadline at all — which is the appliance's real case: it
   * runs in its own long-lived process with nothing waiting to kill it.
   */
  readonly deadline?: number;
  /** The clock, injectable so the deadline's behaviour can be tested. */
  readonly now?: () => number;
  /**
   * The question `passStepBefore` answers between data types, asked from
   * inside one (2026-09-29): has this pass been told to stop, and why?
   * Resolves null while the pass may go on. The loop asks it at the gates it
   * asks its deadline at, at most once every `PASS_REREAD_EVERY_MS` of `now`,
   * and a yes stops it the way the deadline does (`HaltPause`). A rejection
   * fails the pass: a question that could not be answered is not a "go on"
   * (hard rule 9).
   *
   * Absent means nothing can tell this pass to stop, which is the standalone
   * CLI's case: it reads its migration once, from a file, and no Pause reaches
   * it. The loop then reads no clock for it and asks nothing.
   */
  readonly whyItStops?: () => Promise<PassStopReason | null>;
  /**
   * May a FIRST copy be made now? Asked before an item is copied for the
   * first time, with the first-copy bytes this pass has moved so far, and
   * never for an update to an item already copied (workplan 0109 T6,
   * ADR-0014's amendment of 2026-10-03).
   *
   * The managed edition answers it from the customer's data ceiling: at the
   * ceiling, new first copies wait for their yes to a move up or a top-up,
   * while updates and everything already copied carry on. A held item is
   * counted (`heldAtCeiling`), gets no ledger row and no failure, and its
   * collection keeps its cursor, so the yes lifts the hold where it stopped.
   * Absent, as on the appliance, which has no tiers: every first copy goes.
   * Here, beside the deadline, so every data type's runner forwards it
   * through `passClock` without being edited to.
   */
  readonly firstCopyAllowed?: (firstCopyBytesThisPass: number) => boolean;
}

/**
 * The clock fields to spread into `runDomainSync`, forwarded verbatim.
 *
 * A function rather than `deadline: deps.deadline, now: deps.now` at each of
 * the five call sites, because `exactOptionalPropertyTypes` makes the literal
 * form spell out two conditional spreads every time — and a call site that
 * forwards one of the two is a domain that ignores its deadline while
 * appearing to honour it. `a-domain-that-ignores-its-deadline.unit.test.ts`
 * fails the build on a `runDomainSync` call that does not go through here.
 *
 * And the question a pass is told to stop by (`whyItStops`, 2026-09-29), for
 * the same reason and through the same five calls: forwarded here, every
 * wrapper that forwards its deadline forwards the question with it, and none
 * had to be edited to do so.
 */
export function passClock(clock: PassClock): PassClock {
  return {
    ...(clock.deadline !== undefined ? { deadline: clock.deadline } : {}),
    ...(clock.now ? { now: clock.now } : {}),
    ...(clock.whyItStops ? { whyItStops: clock.whyItStops } : {}),
    ...(clock.firstCopyAllowed ? { firstCopyAllowed: clock.firstCopyAllowed } : {}),
  };
}

/**
 * EVERY DATA TYPE GETS A TURN (workplan 0143 T5, the owner's choice (c)).
 *
 * The pass handed every data type the same deadline, in the order the mapping
 * listed them. A first copy of a large mailbox then took the whole pass, and the
 * contacts, calendars and files behind it did not start until the mail's first
 * copy was done, which for a large Microsoft 365 mailbox is days.
 *
 * So the small, bounded ones go first, and each type is handed a fair share of
 * what is left rather than all of it. Contacts, calendars and tasks usually
 * finish in minutes; mail and files then share what remains, about half each.
 * A type that is not listed here goes last, in the order it came.
 */
export const PASS_ORDER = ['contact', 'calendar', 'task', 'email', 'file'] as const;

/** The data types of one pass, in the order it takes them. */
export function passOrder<D extends string>(domains: readonly D[]): D[] {
  const rank = (domain: string): number => {
    const at = (PASS_ORDER as readonly string[]).indexOf(domain);
    return at < 0 ? PASS_ORDER.length : at;
  };
  // A stable sort, so types of equal rank keep the order they came in.
  return [...domains].sort((a, b) => rank(a) - rank(b));
}

/**
 * The moment a data type starting at `now` must stop taking new work: its
 * share of the time left, `now + (passDeadline − now) ÷ typesLeft`, where
 * `typesLeft` counts this type and every one after it. The last type gets
 * whatever remains.
 *
 * Asked again before each type, so time a type does not use flows to the ones
 * after it. It is never later than the pass's own deadline, so the rule above
 * still holds: five data types each handed the whole budget would be five
 * times the budget, and the runner's kill does not care how the time was
 * divided.
 */
export function domainDeadline(passDeadline: number, now: number, typesLeft: number): number {
  if (!(typesLeft > 1) || now >= passDeadline) return passDeadline;
  return now + Math.floor((passDeadline - now) / typesLeft);
}
