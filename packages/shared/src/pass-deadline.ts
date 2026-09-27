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
 */
export function passClock(clock: PassClock): PassClock {
  return {
    ...(clock.deadline !== undefined ? { deadline: clock.deadline } : {}),
    ...(clock.now ? { now: clock.now } : {}),
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
