// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The pass that turns ledger rows into a list somebody deletes on the strength
 * of (workplan 0117 T2 slice 2, decision D7).
 *
 * Slice 1 built the VOCABULARY — `confirmed-list.ts`, what a row may claim —
 * before any machinery existed to produce one, because the failure mode here is
 * not a pass that crashes but a pass that succeeds and says the wrong word.
 * This is the machinery, and every row it produces goes through `rowFor`.
 * **Nothing in this file decides what a row says.** It decides only what to
 * ask the target and how to turn the target's behaviour into a `TargetAnswer`.
 *
 * ## D7, and what "confirm every item" costs
 *
 * The owner took (a) on 2026-09-10: *"confirm every item by re-reading it from
 * the target, for files and mail, offered as a job the person starts and we
 * report on rather than a wait before the list appears."* So this streams — an
 * async iterable, one row at a time, never a list in memory — because the
 * account it runs over is the reason (a) was a decision at all.
 *
 * `needsTargetRead` is the other half of that cost. Seven of the ten ledger
 * statuses are decided without touching the network, and skipping those reads
 * is safe for a reason the guard asserts rather than assumes: for those
 * statuses `rowFor` produces the same row whatever the target would have said.
 *
 * ## A target that will not answer is not a target that says no
 *
 * The one rule this file exists to hold. `isPresent` and `hashOnTarget` may
 * throw — a timeout, a 500, a dropped connection — and a throw becomes
 * `{ unreachable: true }`, which `rowFor` turns into `unchecked`. It must never
 * become `{ onTarget: false }`, which is `missing`: *we placed it and it is
 * gone*, the loudest row on the page somebody deletes their originals from.
 *
 * `ports.ts` states the same rule for the write side — *"treating an outage as
 * absence is how a removal gets authorised by a broken network"*. This is the
 * reading side of it, and the consequence is worse here, because on the write
 * side the product acts and on this side a person does.
 */

import {
  needsTargetRead,
  rowFor,
  type ConfirmedRow,
  type DiscoveryDomain,
  type LedgerRecord,
  type RowState,
  type TargetAnswer,
  countsAsVerified,
} from '@openmig/shared';

/** The ledger's half of one row — everything the pass needs and nothing more. */
export interface ConfirmableItem {
  readonly naturalKeyHash: string;
  readonly status: LedgerRecord['status'];
  /**
   * Our own hash of the bytes, as the ledger recorded them, or null.
   *
   * Null is ordinary rather than exceptional: a row written before the column
   * existed, or a domain whose `contentHash` function produces a fingerprint
   * the target cannot be asked to reproduce. A row with nothing to compare
   * against is `present`, never `differs` — see `answerFor`.
   */
  readonly contentHash: string | null;
}

/**
 * The target, as this pass needs it — two questions, both allowed to fail.
 *
 * Deliberately NOT `TargetReindexer`. That interface streams a whole account to
 * rebuild idempotency state; this asks about one item at a time and has to
 * survive one of them failing. An adapter over the real targets belongs with
 * the job (the next slice), not here, which is what keeps this file testable
 * without a server and its rules assertable exhaustively.
 */
export interface ConfirmationReader {
  /** Is it on the target? A throw means "we could not tell", never "no". */
  isPresent(item: ConfirmableItem): Promise<boolean>;
  /**
   * Our hash of what the target holds NOW, or undefined when the target cannot
   * produce one.
   *
   * Absent entirely for CalDAV and CardDAV, and permanently: those servers
   * re-serialise what they store, so a hash off the target could never equal
   * the one the ledger holds (`hash.ts:143`). Undefined and absent mean the
   * same thing to this pass — the comparison was not available — and neither
   * is a mismatch.
   */
  hashOnTarget?(item: ConfirmableItem): Promise<string | undefined>;
}

/**
 * One finished row, with the key that identifies it and the evidence behind it.
 *
 * Carries the whole `ConfirmedFinding` rather than the row alone. The row alone
 * is what this yielded first, and it made the pass impossible to connect to the
 * store built for it: the store records the ANSWER, and the answer had been
 * computed, used and dropped inside `confirmOne`.
 */
export interface ConfirmedItem extends ConfirmedFinding {
  readonly naturalKeyHash: string;
}

/**
 * Ask the target about one item, and turn what happens into a `TargetAnswer`.
 *
 * The whole of this file's judgement is here, and it is four lines of it:
 *
 * 1. A throw is `unreachable`. Not absence, not a mismatch.
 * 2. Not present is `onTarget: false`, and only when the target said so.
 * 3. Present with nothing to compare — no `hashOnTarget`, or it answered
 *    undefined, or the ledger holds no hash — is `unavailable`. Three different
 *    reasons for one honest answer: we did not check the bytes.
 * 4. Present with both hashes in hand is `match` or `differ`, and nothing else.
 */
async function answerFor(
  item: ConfirmableItem,
  reader: ConfirmationReader,
): Promise<TargetAnswer> {
  let present: boolean;
  try {
    present = await reader.isPresent(item);
  } catch {
    return { unreachable: true };
  }
  if (!present) return { onTarget: false };

  if (!reader.hashOnTarget || item.contentHash === null) {
    return { onTarget: true, comparison: 'unavailable' };
  }
  let onTarget: string | undefined;
  try {
    onTarget = await reader.hashOnTarget(item);
  } catch {
    // The item IS there — `isPresent` said so — and only the comparison broke.
    // Reporting `unreachable` would throw away a fact we have; reporting
    // `differ` would invent one we do not.
    return { onTarget: true, comparison: 'unavailable' };
  }
  if (onTarget === undefined) return { onTarget: true, comparison: 'unavailable' };
  return {
    onTarget: true,
    comparison: onTarget === item.contentHash ? 'match' : 'differ',
  };
}

/**
 * The row for one item. Reads the target only where the ledger cannot decide.
 *
 * `NOT_CONSULTED` is passed for the statuses `needsTargetRead` waives, and it
 * is not a claim: `rowFor` does not look at the answer for any of them, which
 * is the property the guard asserts. It is written as a named constant rather
 * than inlined so a reader meets the word "not consulted" instead of a literal
 * that looks like an assertion about the target.
 */
const NOT_CONSULTED: TargetAnswer = { onTarget: false };

/**
 * The evidence AND the claim, together.
 *
 * Both, because they are for different places and only one of them may be
 * stored. `answer` is what the target said and is what the ledger records
 * (migration 0045: evidence, never the derived word). `row` is what `rowFor`
 * makes of it and is what a person reads.
 *
 * `consulted` is the third thing, and it is not decoration: when
 * `needsTargetRead` waives a status, `answer` is `NOT_CONSULTED`, which is a
 * placeholder `rowFor` ignores — NOT something the target said. A recorder that
 * wrote it down would be claiming *we looked and it is not there* about an item
 * nobody asked about.
 */
export interface ConfirmedFinding {
  readonly answer: TargetAnswer;
  readonly row: ConfirmedRow;
  /** True only when the target was actually asked. */
  readonly consulted: boolean;
}

/** The row for one item, with the evidence that produced it. */
export async function confirmFinding(
  domain: DiscoveryDomain,
  item: ConfirmableItem,
  reader: ConfirmationReader,
): Promise<ConfirmedFinding> {
  const consulted = needsTargetRead(item.status);
  const answer = consulted ? await answerFor(item, reader) : NOT_CONSULTED;
  return { answer, row: rowFor({ domain, status: item.status, answer }), consulted };
}

export async function confirmOne(
  domain: DiscoveryDomain,
  item: ConfirmableItem,
  reader: ConfirmationReader,
): Promise<ConfirmedRow> {
  return (await confirmFinding(domain, item, reader)).row;
}

/**
 * Every row, streamed.
 *
 * An async iterable rather than an array, and that is D7's cost decision made
 * structural: a family file account is the case this pass was authorised for,
 * and a caller that wants to write each row as it lands must be able to.
 * Returning `ConfirmedItem[]` would work on a test fixture and fall over on the
 * account this exists to serve.
 */
export async function* confirmEach(
  domain: DiscoveryDomain,
  items: AsyncIterable<ConfirmableItem> | Iterable<ConfirmableItem>,
  reader: ConfirmationReader,
): AsyncIterable<ConfirmedItem> {
  for await (const item of items) {
    yield { naturalKeyHash: item.naturalKeyHash, ...(await confirmFinding(domain, item, reader)) };
  }
}

/** What a finished pass adds up to. Every state counted, none merged. */
export interface ConfirmationTally {
  readonly byState: Readonly<Record<RowState, number>>;
  /**
   * The headline number, and the ONLY thing that may be printed beside the
   * word "verified".
   *
   * Derived through `countsAsVerified` rather than by reading `byState`, so a
   * future state that ought to count — or ought to stop counting — changes in
   * one place. The headline is the sentence somebody acts on; it must not be
   * assembled by whoever writes the template.
   */
  readonly verified: number;
  /** Every row the pass produced, verified or not. */
  readonly total: number;
}

const EMPTY_TALLY: Readonly<Record<RowState, number>> = {
  verified: 0,
  differs: 0,
  present: 0,
  yours: 0,
  missing: 0,
  'never-placed': 0,
  removed: 0,
  unchecked: 0,
};

export function tally(rows: Iterable<ConfirmedRow>): ConfirmationTally {
  const byState: Record<RowState, number> = { ...EMPTY_TALLY };
  let verified = 0;
  let total = 0;
  for (const row of rows) {
    byState[row.state] += 1;
    total += 1;
    if (countsAsVerified(row)) verified += 1;
  }
  return { byState, verified, total };
}
