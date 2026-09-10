// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a row of the confirmed list is allowed to claim (workplan 0117 T2).
 *
 * T2 hands somebody a list they will **delete on the strength of**. Everything
 * in this file exists because that sentence is load-bearing: a row that
 * overstates its evidence by one word is a person emptying a folder they
 * should have kept.
 *
 * This module decides nothing about I/O and performs none. It is the
 * VOCABULARY — what kinds of claim exist, which one a given row may make, and
 * which rows may make none — and it is deliberately built before the
 * confirmation pass that will produce the rows, because the failure mode here
 * is not a pass that crashes. It is a pass that succeeds and says the wrong
 * word.
 *
 * In `@openmig/shared` under ADR-0026: both editions produce this list and they
 * must produce identical claims. A managed row and a self-host row that say
 * "verified" on different evidence would be the same defect wearing one word.
 */

import type { DiscoveryDomain } from './discovery.ts';
import type { LedgerRecord } from './ports.ts';

/**
 * The kinds of evidence that can ever stand behind a row.
 *
 * These are not confidence levels and must not be rendered as a scale. They
 * are different QUESTIONS, and a person deciding whether to delete needs to
 * know which one was answered.
 *
 * - **`byte-hash`** — our SHA-256 over the bytes, computed on both sides. The
 *   ledger's `contentHash` for files and mail is our own hash of the bytes we
 *   fetched (`fileContentHash`, `contentHash` in `hash.ts`), and the same
 *   function runs against the target (`contentHashFor`). Like compared with
 *   like: this is the strong claim, and only files and mail can make it.
 *
 * - **`fingerprint`** — a canonical fingerprint, not a hash of bytes. A
 *   CalDAV/CardDAV server re-serialises what it stores — refolding lines,
 *   reordering properties, adding its own PRODID/VERSION/X- properties — so a
 *   byte hash computed on the source can never equal one computed back off the
 *   target (`hash.ts:143`). The comparison is real and useful; it is simply
 *   not a claim about bytes, and saying "verified by hash" over a calendar row
 *   would be a lie of one word.
 *
 * - **`none`** — nothing comparable could be computed, or nothing was placed.
 *   A row with this claim may still be worth showing; it may never be shown as
 *   verified.
 */
export type ClaimKind = 'byte-hash' | 'fingerprint' | 'none';

/**
 * The strongest claim a domain can EVER make, before anything is read.
 *
 * A ceiling, not a result. The row's actual claim is the lesser of this and
 * what the target could produce, which is why `rowFor` takes both — but no
 * amount of agreement between two strings raises a calendar row to
 * `byte-hash`, because the strings are fingerprints and the person is being
 * told what was checked, not how confident we feel.
 *
 * Tasks are calendar objects on the wire (VTODO over CalDAV, workplan 0113),
 * so they inherit the calendar answer and for the same reason.
 */
export function claimCeilingFor(domain: DiscoveryDomain): ClaimKind {
  switch (domain) {
    case 'email':
    case 'file':
      return 'byte-hash';
    case 'calendar':
    case 'contact':
    case 'task':
      return 'fingerprint';
  }
}

/**
 * What one row of the list says happened to one item.
 *
 * Six states, and the split between the last three is the whole point of the
 * file: "we did not check" and "we checked and it is wrong" and "it was never
 * put there" are three different things, and a list that renders any two of
 * them the same way is a list somebody deletes the wrong folder on.
 */
export type RowState =
  /** Re-read from the target and it matched. `claim` says what "matched" means. */
  | 'verified'
  /** Re-read from the target and it did NOT match. */
  | 'differs'
  /** On the target, but nothing comparable could be computed. Not a failure. */
  | 'present'
  /**
   * On the target, and the copy is the customer's own — we did not write it.
   * See `rowFor` for why this can never be `verified`.
   */
  | 'yours'
  /** We placed it and the re-read cannot find it. The one that needs action. */
  | 'missing'
  /** It was never placed on the target, and the list must still show it. */
  | 'never-placed'
  /** We removed our copy, on a decision recorded at the time. */
  | 'removed'
  /**
   * We could not ask the target about this one (workplan 0117 T2 slice 2).
   *
   * **The state the machinery needed and slice 1 did not have.** Building the
   * pass found that `TargetAnswer` could say "not there" and "there" and had no
   * way to say "we could not tell" — so a timeout, a 500 or a dropped
   * connection had nowhere to go but `missing`, which reads as *we placed it
   * and it is gone*. That is the loudest row on the list, on the page somebody
   * deletes their originals from, produced by a network blip.
   *
   * `ports.ts` already states the rule for the other direction — *"treating an
   * outage as absence is how a removal gets authorised by a broken network"* —
   * and this is the same rule on the list's side of the product.
   */
  | 'unchecked';

/** One row, with its evidence named rather than implied. */
export interface ConfirmedRow {
  readonly state: RowState;
  readonly claim: ClaimKind;
}

/**
 * What the confirmation pass found when it re-read this item on the target.
 *
 * `unavailable` is a first-class answer, not an error: a JMAP contact target
 * implements no `contentHashFor` at all (`jmap-contact-target.ts:782`,
 * deliberately — a stored `ContactCard` carries no handle back to vCard bytes),
 * so those rows are honestly uncomparable and must say so rather than being
 * scored as mismatches.
 */
export type TargetAnswer =
  | { readonly onTarget: false }
  | { readonly onTarget: true; readonly comparison: 'match' | 'differ' | 'unavailable' }
  /**
   * The target could not be asked — it threw, timed out, or refused.
   *
   * Deliberately NOT `{ onTarget: false }`. The two are opposites in the only
   * way that matters here: one says *we looked and it is gone*, the other says
   * *we did not manage to look*. Collapsing them puts a network blip on the
   * list as a lost item, and a person acting on that list would keep an
   * original they could have deleted — or, on the next pass when it reads
   * clean, distrust the whole document.
   *
   * `unavailable` above is a different thing again and the distinction is
   * worth keeping straight: there, the item IS on the target and only the
   * comparison could not be made. Here, nothing is known.
   */
  | { readonly unreachable: true };

/**
 * Decide what one row may say. Exhaustive over the ledger's nine statuses.
 *
 * ## The three rules this encodes, and what each one costs if it is wrong
 *
 * **1. A row that was never placed can never read as verified — and must
 * still appear.** `pending`, `skipped`, `failed` and `left_behind` are rows in
 * the ledger and none of them is a copy (`isOnTarget` in `ports.ts` makes the
 * same distinction for §20). Omitting them silently would tell somebody their
 * library is smaller than it is, which is 0117 §7c's own warning; showing them
 * as confirmed would be worse. They appear, as `never-placed`, claiming
 * nothing.
 *
 * **2. An `adopted` row can never read as verified.** This one is a
 * correction to §7c, which says of adopted items: *"We never wrote these and
 * never hashed them."* Read out of `domain-sync.ts` on 2026-09-10, that is
 * wrong on both halves, and there are in fact TWO different rows wearing the
 * status:
 *
 * - **adopted at first sight** (`domain-sync.ts:1426`, `status: result.adopted
 *   ? 'adopted' : …`): the target already held an item under our natural key,
 *   so nothing was written — but the source item HAD been fetched and hashed,
 *   and `contentHash: ch` on that row is our SHA-256 of the SOURCE's bytes.
 * - **adopted by conflict** (`domain-sync.ts:1399`, `recordUpdate({
 *   ...rewriteOf!, status: 'adopted' })`): we wrote this item once, the
 *   customer has since edited our copy, and hard rule 2 leaves it alone. The
 *   row keeps the `contentHash` of what WE wrote, and the target has
 *   deliberately moved away from it.
 *
 * The ledger cannot tell the two apart after the fact — same status, same
 * columns. So comparing `contentHash` against a re-read answers a different
 * question for each, and for the second it is EXPECTED to differ. A list that
 * ran the naive comparison would report a customer's own edited file as
 * changed, in the one document where alarm is most expensive.
 *
 * Hence `yours`: on the target, and the bytes are the customer's. That is
 * true of both shapes, it is what the person actually needs to know before
 * deleting, and it claims nothing it cannot support.
 *
 * **3. The claim never exceeds the domain's ceiling.** A calendar row that
 * matched says `verified` with a `fingerprint` claim, never a `byte-hash` one.
 * Two strings agreeing does not make them bytes.
 */
export function rowFor(args: {
  readonly domain: DiscoveryDomain;
  readonly status: LedgerRecord['status'];
  readonly answer: TargetAnswer;
}): ConfirmedRow {
  const { domain, status, answer } = args;

  // BEFORE the status switch, and that order is the rule. A row we could not
  // ask about is unchecked whatever the ledger says it should be — including
  // the statuses below that answer without consulting the target at all.
  // Deciding "never-placed" from the ledger alone would be right, and would
  // also mean the list quietly mixed rows we checked with rows we did not, on
  // the one document where that distinction is the whole product.
  if ('unreachable' in answer) return { state: 'unchecked', claim: 'none' };

  switch (status) {
    // Rule 1 — rows that are not copies. `undefined` joins them: a row with no
    // status predates the column, and the generous reading `isOnTarget` gives
    // it ("do not report it missing") is not generous enough to put the word
    // "verified" on it for somebody about to delete.
    case undefined:
    case 'pending':
    case 'skipped':
    case 'failed':
    case 'left_behind':
      return { state: 'never-placed', claim: 'none' };

    // Rule 2 — the customer's own bytes, both shapes.
    case 'adopted':
      return { state: 'yours', claim: 'none' };

    // The one status this product creates by destroying something. The row is
    // kept deliberately as the record that it existed, was migrated and was
    // then removed — so it is neither missing nor a loss, and the list says
    // which.
    case 'tombstoned':
      return { state: 'removed', claim: 'none' };

    // We placed it. `deleted_source` belongs here too: the source no longer
    // has the item, which is exactly the situation this list is handed to
    // somebody in, and our copy's standing is unchanged by it.
    case 'copied':
    case 'updated':
    case 'deleted_source': {
      if (!answer.onTarget) return { state: 'missing', claim: 'none' };
      // Rule 3.
      const ceiling = claimCeilingFor(domain);
      switch (answer.comparison) {
        case 'match':
          return { state: 'verified', claim: ceiling };
        case 'differ':
          return { state: 'differs', claim: ceiling };
        case 'unavailable':
          return { state: 'present', claim: 'none' };
      }
    }
  }
}

/**
 * Does this status need the target to be READ before its row can be decided?
 *
 * D7 chose (a) — confirm every item by re-reading it — and this is the boundary
 * of "every". Four groups of status are decided by the ledger alone: nothing
 * was placed (`pending`, `skipped`, `failed`, `left_behind`, and a row with no
 * status), the bytes are the customer's (`adopted`), or we removed our own copy
 * on a recorded decision (`tombstoned`). Reading the target for those would
 * spend a request per item to learn nothing — on a pass whose cost is the whole
 * reason D7 was a decision.
 *
 * **The rule this has to keep, and the guard that keeps it:** wherever this
 * answers false, `rowFor` must produce the same row for every possible answer.
 * Otherwise the pass would be skipping a read that mattered, and the list would
 * say something it had not checked. That property is asserted rather than
 * trusted — see `a-list-somebody-deletes-on-the-strength-of.unit.test.ts` —
 * because the two switches live in one file today and a future edit to either
 * would break it silently.
 */
export function needsTargetRead(status: LedgerRecord['status']): boolean {
  switch (status) {
    case undefined:
    case 'pending':
    case 'skipped':
    case 'failed':
    case 'left_behind':
    case 'adopted':
    case 'tombstoned':
      return false;
    case 'copied':
    case 'updated':
    case 'deleted_source':
      return true;
  }
}

/**
 * May this row be counted in the headline "N items are in your new home,
 * verified"?
 *
 * One predicate, because the headline is the sentence somebody acts on and it
 * must not be assembled by whoever writes the template. Only `verified`
 * counts. `yours` and `present` are genuinely on the target and are
 * deliberately excluded: the headline says *verified*, and neither was.
 */
export function countsAsVerified(row: ConfirmedRow): boolean {
  return row.state === 'verified';
}

/**
 * Must this row be shown even though nothing about it is good news?
 *
 * Every row must be shown — the list is a complete account or it is
 * misleading. This predicate names the ones a template would be tempted to
 * filter out, so that temptation has a test against it.
 */
export function mustAppearDespiteNoClaim(row: ConfirmedRow): boolean {
  return (
    row.state === 'never-placed' ||
    row.state === 'missing' ||
    row.state === 'removed' ||
    // The one a template would filter out hardest, because it looks like an
    // absence of information rather than a fact. It is a fact: this item was
    // not checked, and somebody about to delete is owed it.
    row.state === 'unchecked'
  );
}
