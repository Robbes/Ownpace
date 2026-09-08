// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHY a migration that is not moving is not moving.
 *
 * Three things can stop a pass, and until now the customer could tell them
 * apart from none of them — a migration simply stopped producing numbers:
 *
 * 1. **This pass's own deadline** (`DeadlinePause`, workplan 0022 T2). It
 *    happens on EVERY pass of a large migration, by design: the pass ends
 *    itself before the runner's hard kill and the next one carries on from the
 *    same cursors. It is not represented here, deliberately — see below.
 * 2. **The day's download ceiling** (`BudgetPause`, workplan 0090 T4). It
 *    lasts hours, and to anybody watching it is indistinguishable from a
 *    migration that has died.
 * 3. **An operator hold** — we stopped starting passes on purpose, to update
 *    the platform. The customer cannot derive it, cannot wait it out
 *    predictably, and nothing else on their screen will ever explain it.
 *
 * Only 2 and 3 are here. The deadline is on the run log and stays there: a
 * banner that appears on every pass of every large migration is a banner
 * people learn to scroll past, and it would then be in the way on the day one
 * of the other two fires. That is a decision about ATTENTION, not about
 * honesty — the deadline is reported in full where an engineer looks, and
 * `a-pause-the-customer-cannot-act-on.unit.test.ts` holds this file to it.
 *
 * ## One shape, two positions
 *
 * A ceiling belongs to one domain's source, so it is stored on that domain's
 * status row and rendered on that row. A hold belongs to the platform, so it
 * is stored once and rendered once, above the strip. The SHAPE is shared so
 * both render through one component and read as one state with a reason
 * attached, rather than as two unrelated notions the reader has to reconcile.
 */

import type { BudgetPause } from './rate-budget.ts';

/**
 * A pause a customer can read, and — for one of the two — act on.
 *
 * A scheduled stop, never a failure: nothing threw, nothing is owed a retry,
 * the cursors are where the last pass left them, and copying continues by
 * itself. A screen that renders one of these in error colours is making a
 * claim the data does not support.
 */
export type PauseReason =
  | {
      /**
       * The source's own daily download limit is spent (0090 T1: Gmail
       * publishes 2 500 MB per account per day, and its reported penalty for
       * passing it is a ~24-hour lockout of the customer's LIVE mailbox).
       */
      readonly kind: 'daily-download-ceiling';
      /**
       * Whose limit — the endpoint host the meter is keyed by
       * (`imap.gmail.com`), never an address or a mailbox name.
       */
      readonly provider: string;
      /**
       * When the meter starts over — ISO — or null when the meter reported no
       * running window. Null is honest and rare: it means the pass stopped on
       * a ceiling whose window it could not read, and a screen must then say
       * "later today" rather than invent a time.
       */
      readonly windowResetsAt: string | null;
    }
  | {
      /** We are not starting passes at the moment, on purpose. */
      readonly kind: 'operator-hold';
      /** When the hold began — ISO. */
      readonly since: string;
      /**
       * The operator's own words, rendered VERBATIM (the prose boundary,
       * ADR-0024). Absent when they typed none, and the screen then shows its
       * own default sentence — a hold is never wordless.
       */
      readonly message?: string;
    };

/** The one conversion from the meter's report to the customer's sentence. */
export function budgetPauseToReason(pause: BudgetPause): PauseReason {
  return {
    kind: 'daily-download-ceiling',
    provider: pause.provider,
    // The spent/ceiling numbers stay on the run log. They are the evidence an
    // engineer needs and noise to everyone else, and the byte figures a
    // provider reports are not the ones a customer can check.
    windowResetsAt: pause.windowResetsAt,
  };
}

/**
 * Read a `paused_reason` column back through a guard rather than a cast.
 *
 * `jsonb` accepts whatever the writer put there, and a row written by an older
 * or newer build must not become a reason the UI has no sentence for — the
 * same rule `isFailureCategory` exists for.
 */
export function isPauseReason(value: unknown): value is PauseReason {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.kind === 'daily-download-ceiling') {
    return (
      typeof r.provider === 'string' &&
      (r.windowResetsAt === null || typeof r.windowResetsAt === 'string')
    );
  }
  if (r.kind === 'operator-hold') {
    return (
      typeof r.since === 'string' &&
      (r.message === undefined || typeof r.message === 'string')
    );
  }
  return false;
}
