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

import { CONTAINER_FINGERPRINT_VERSION } from './fingerprint-scheme.ts';
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
 * - **`container-parts`** — a hash over the PARTS of a zip container rather than
 *   over the file's bytes — ADR-0046, workplan 0042 T7 (c). A Google Doc has
 *   no bytes of its own; migrating one means asking Drive to export a
 *   rendering, and a rendering comes back in a rebuilt container every time.
 *   Member names and the sha256 of each member's uncompressed bytes are
 *   compared; the zip's own stamps, member order and
 *   compression settings are not. It is a real comparison of real content — it
 *   is simply not a claim about the file's bytes, and a reader deciding whether
 *   to delete an original must not have to guess which of the two a green row
 *   means.
 *
 * - **`none`** — nothing comparable could be computed, or nothing was placed.
 *   A row with this claim may still be worth showing; it may never be shown as
 *   verified.
 */
export type ClaimKind = 'byte-hash' | 'fingerprint' | 'container-parts' | 'none';

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
 * What was ACTUALLY compared for one row — the ceiling, narrowed by the scheme
 * that produced the row's stored hash (0042 T7 (c), ADR-0046 rule 5).
 *
 * THE DOMAIN IS NOT ENOUGH, and that is the whole reason this exists beside
 * `claimCeilingFor`. Two rows in the `file` domain can have been compared by
 * two different questions: an ordinary file the customer stored is compared by
 * its bytes, and a rendering this product asked Drive to export is compared by
 * its container's parts. The ceiling knows the domain and cannot tell them
 * apart.
 *
 * THE STORED HASH CAN, because it carries its own scheme on its front — the
 * same tag rule (d) built, and the reason that rule had to land first. A
 * `zip1:` value was produced structurally and nothing else was; there is no
 * column to consult and none is needed.
 *
 * IT ONLY EVER NARROWS. A calendar row's `cal1:` fingerprint does not become
 * `container-parts` because it happens to be tagged, and a bare hash never
 * rises above its domain's ceiling. Anything unrecognised is left alone rather
 * than guessed at: a tag this build does not know is a row an older or newer
 * build wrote, and `answerFor` has already refused to compare it at all.
 */
export function claimFor(domain: DiscoveryDomain, contentHash: string | null): ClaimKind {
  const ceiling = claimCeilingFor(domain);
  if (ceiling !== 'byte-hash') return ceiling;
  return contentHash !== null && contentHash.startsWith(`${CONTAINER_FINGERPRINT_VERSION}:`)
    ? 'container-parts'
    : ceiling;
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

/**
 * Every state, with a count of nought — the shape a sweep starts from, and the
 * one place the list of states is written down.
 *
 * Annotated rather than inferred, so a ninth `RowState` is a compile error in
 * this literal. `ROW_STATES` below reads its keys, so a state cannot be known
 * to one and not the other: a breakdown that silently omitted a state would
 * subtract items from an account somebody is about to empty.
 */
const NO_ROWS_YET: Readonly<Record<RowState, number>> = {
  verified: 0,
  differs: 0,
  present: 0,
  yours: 0,
  missing: 0,
  'never-placed': 0,
  removed: 0,
  unchecked: 0,
};

/**
 * All eight states, in the union's own order — for a caller that must sweep
 * them (a breakdown line, a legend, a test that walks every one).
 */
export const ROW_STATES = Object.keys(NO_ROWS_YET) as ReadonlyArray<RowState>;

/** A fresh tally, one per list. */
function noRowsYet(): Record<RowState, number> {
  return { ...NO_ROWS_YET };
}

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
  /**
   * The ledger's stored hash for this item, which says WHICH QUESTION was
   * answered — see `claimFor`.
   *
   * Required rather than optional, and that is deliberate. An optional
   * parameter would let a call site forget it and quietly report `byte-hash`
   * over a row compared by its container's parts, which is the one sentence
   * 0042 T7 (c) exists to stop the list from saying. There are two callers;
   * both hold the value; the compiler names any third.
   */
  readonly contentHash: string | null;
}): ConfirmedRow {
  const { domain, status, answer, contentHash } = args;

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
    case 'superseded':
      // `superseded` is a failure under a name the document no longer has
      // (0042 T8 (b)): never placed, and the same document has its own row
      // under its current name.
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
      // Rule 3, narrowed by the row's own scheme: the ceiling says what the
      // DOMAIN could ever claim, `claimFor` says what this row's hash actually
      // answered. `differs` carries it too — "these differ" means nothing until
      // a reader knows what was compared, and that is as true of a
      // disagreement as of a match.
      const claim = claimFor(domain, contentHash);
      switch (answer.comparison) {
        case 'match':
          return { state: 'verified', claim };
        case 'differ':
          return { state: 'differs', claim };
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
    case 'superseded':
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

/**
 * THE LIST, AS A PERSON READS IT (workplan 0117 T2, decision D10).
 *
 * > ✅ *"(a): a headline count, every row that is NOT verified, the total
 * > stated, and a full export."*
 *
 * Three numbers and a set of rows, and the shape is the decision rather than a
 * rendering choice. §7c names what it is protecting against: *"a list of a
 * hundred thousand verified files is unusable"*, and silently trimming it
 * "tells somebody their library is smaller than it is".
 *
 * So **nothing is omitted from the ACCOUNT** — `total` says how many items
 * there are, whatever the screen shows — and what is on screen is the part
 * somebody can act on. A verified row needs no action; every other row is
 * either a question or a warning, and those are the ones that must be read
 * before anybody deletes an original.
 *
 * `verified` is derived through `countsAsVerified`, never by reading states
 * here: the headline is the sentence somebody acts on, and it must not be
 * assembled twice.
 */
export interface ConfirmedList<Row extends ConfirmedRow = ConfirmedRow> {
  /** The headline. Only `verified` counts — `yours` and `present` do not. */
  readonly verified: number;
  /**
   * Every item in the account, including the ones not shown.
   *
   * Stated so the screen can say *"N of M"*: a person reading forty rows out of
   * a hundred thousand has to be able to tell that the other 99,960 were
   * verified and not merely dropped.
   */
  readonly total: number;
  /**
   * Every row that is NOT verified — questions and warnings, nothing else.
   *
   * `mustAppearDespiteNoClaim` names the four a template would be tempted to
   * filter out; this is wider than that on purpose, because `differs` and
   * `present` are also things a person may want to look at before deleting.
   * The rule is simple enough to hold in one head: if it is not verified, it is
   * on the screen.
   */
  readonly rows: readonly Row[];
  /**
   * True when `rows` is the first N of more, because a `limit` was set.
   *
   * Stated rather than implied: 0036 T3 already learned this on the runs list —
   * *"silent truncation reads as 'covered everything'"* — and here the quiet
   * version would be §7c's own failure, a list that tells somebody their
   * library is smaller than it is.
   */
  readonly truncated?: boolean;
  /**
   * HOW MANY ITEMS ARE IN EACH STATE — the account, whole (owner, 2026-09-17).
   *
   * THE DEFECT THIS EXISTS TO FIX. The owner's first real migration ran against
   * a target that already held a previous test run's calendars, so roughly six
   * thousand of his 7,480 items came back `adopted` — his own copy was already
   * there and we never wrote those bytes. `adopted` is `yours`, `yours` is
   * deliberately not `verified` (see `rowFor`), and the headline counts
   * `verified` alone. So the page told him:
   *
   *     0 of 7,480 items are in your new home, verified by hash
   *     Checking since 10:10 PM — 6,300 of 7,480 checked so far
   *
   * Every number there was right and the document was misleading. Six thousand
   * items WERE in his new home; nothing on the page said so, and the only
   * other number visible was progress, which read as a second, contradictory
   * claim. His words: *"this seems double."*
   *
   * The headline must not widen — it is the sentence somebody empties a folder
   * on, and `verified` is the only thing re-read and matched. So the rest of
   * the account gets counted instead of implied. Counted HERE rather than from
   * `rows`, because `rows` is bounded: a screen tallying what it was sent would
   * describe the first two hundred rows as if they were the account.
   */
  readonly byState: Readonly<Record<RowState, number>>;
}

/**
 * Shape rows into D10's list — ONE ROW AT A TIME.
 *
 * The accumulator rather than the array is the product shape, because the read
 * that feeds it is keyset-paged: D7(a) authorised confirming every item of a
 * family file account, so the rows arrive five hundred at a time and no caller
 * holds them all. Handing each page to a whole-array shaper and adding up the
 * answers would put the arithmetic back in the caller — three counters and a
 * cap, re-derived per edition, which is exactly the "assembled by whoever
 * writes the template" this module exists to prevent.
 *
 * `limit` bounds the rows KEPT, never the rows COUNTED. `verified` and `total`
 * are the whole account whatever the screen shows; that is the difference
 * between a bounded list and a misleading one.
 *
 * Generic over the row so a caller's identifying fields travel through
 * untouched — the same reason `ConfirmedItem` is generic, and the same defect
 * avoided: a shaper that flattened to `ConfirmedRow` would hand a screen rows
 * it cannot link to anything.
 */
export function confirmedListOf<Row extends ConfirmedRow>(options?: {
  /** Keep at most this many non-verified rows. Absent means keep every one. */
  readonly limit?: number;
}): {
  add(row: Row): void;
  result(): ConfirmedList<Row>;
} {
  const limit = options?.limit;
  const rows: Row[] = [];
  const byState = noRowsYet();
  let verified = 0;
  let total = 0;
  let dropped = 0;
  return {
    add(row) {
      total += 1;
      // Tallied before the early return below, so the breakdown covers the
      // verified rows the screen never receives as well as the ones it does.
      byState[row.state] += 1;
      if (countsAsVerified(row)) {
        verified += 1;
        return;
      }
      if (limit === undefined || rows.length < limit) rows.push(row);
      else dropped += 1;
    },
    result: () => ({
      verified,
      total,
      rows,
      byState,
      ...(dropped > 0 ? { truncated: true } : {}),
    }),
  };
}

/**
 * The same shaping for a caller that already holds every row.
 *
 * The appliance's list is small enough to read whole, and so is every test; this
 * is that case, expressed through the accumulator rather than beside it so there
 * is one definition of what the list is.
 */
export function confirmedList<Row extends ConfirmedRow>(
  rows: readonly Row[],
  options?: { readonly limit?: number },
): ConfirmedList<Row> {
  const list = confirmedListOf<Row>(options);
  for (const row of rows) list.add(row);
  return list.result();
}

/**
 * One row as it goes over the wire, and into the export.
 *
 * The identifying fields are the LIST's, not the ledger's: a `Date` becomes an
 * ISO-8601 string once, at the edge, and the JSON body and the CSV are then
 * rendered from the SAME objects. Two shapes — one for the screen, one for the
 * file — is how an export quietly stops agreeing with the page it was
 * downloaded from, and this is a document somebody reconciles against their old
 * account.
 *
 * **`naturalKey` is here on purpose, and it is §17's documented exception.**
 * The operating contract's rule is that `naturalKeyHash` is the handle for
 * every ACTION, so a body that may be pasted into a support ticket carries no
 * Message-ID and no file path. `ItemMove.from`/`to` and
 * `ItemDeletion.collection` are already named as exceptions there, for the
 * reason that applies twice over here: a list that cannot say WHICH item is
 * missing is not a list anybody can act on, and this is the one somebody
 * deletes their originals on the strength of. The privacy answer is that the
 * list is served to the owner's own session only — never to a 0122 view link,
 * which sees counts and states and no keys at all.
 */
export interface ConfirmedRowView extends ConfirmedRow {
  readonly domain: DiscoveryDomain;
  /** Where it sits on the target — a folder path, a calendar name. */
  readonly collection: string;
  /** The item's own identifier: a Message-ID, a file path, a UID. */
  readonly naturalKey: string;
  /**
   * The name a PERSON calls it: an event's SUMMARY, a contact's FN.
   *
   * Absent for a file, whose `naturalKey` IS its name; absent for mail, whose
   * Subject this codebase cannot decode yet; and absent on every row written
   * before 2026-09-17. A reader falls back to `naturalKey`, which is exactly
   * what this list showed before the name existed — so an old row loses
   * nothing and a new one gains the half a UID could never give.
   *
   * Under the SAME §17 exception argued above, and for the stronger version of
   * the same reason: a UID is at least an identifier somebody could paste into
   * a search box, and `926caf98adce563` was what the owner was shown when two
   * of his contacts failed. *"I can not find these contacts, or atleast i do no
   * know how."*
   */
  readonly displayName?: string;
  /** When the target was asked, ISO-8601. `null` = never — the row is `unchecked`. */
  readonly confirmedAt: string | null;
}

/**
 * THE FULL EXPORT (D10) — every row, verified ones included.
 *
 * The screen shows what is actionable; this is the complete account, and the
 * difference is the whole reason D10 asked for both. A person reconciling
 * against the account they are about to empty needs to be able to search it for
 * one file and see the word `verified` next to it — which the screen, by
 * design, does not show them.
 *
 * ## Three details that are not formatting
 *
 * **A leading `=`, `+`, `-` or `@` is quoted out of being a formula.** Mail
 * subjects, file names and calendar summaries are written by whoever sent them,
 * and a spreadsheet evaluates a cell that starts with one of those — including
 * `=cmd|…` and `=HYPERLINK(…)`. So those fields get a leading apostrophe. It is
 * visible in the cell, and that is the trade, taken deliberately: an apostrophe
 * in front of a handful of `-----Original Message-----` subjects is cheaper
 * than shipping somebody a document that runs code when they open it. Do not
 * "clean this up".
 *
 * **A BOM.** Excel reads a CSV without one as the local codepage, so every
 * `ë`, `ï` and `é` arrives as mojibake — which, for a Dutch product, is most
 * names rather than an edge case.
 *
 * **CRLF, and RFC 4180 quoting.** A subject containing a comma, a quote or a
 * newline is ordinary mail; a file that splits a row on one is a file that
 * silently changes the count somebody is reconciling.
 */
export function confirmedListCsv(rows: readonly ConfirmedRowView[]): string {
  // `name` BESIDE `item`, not instead of it. The screen may fall back from one
  // to the other because it has one column; a file being reconciled offline has
  // room for both, and the person doing the reconciling needs the identifier to
  // search their old account with AND the name to recognise. Dropping either
  // would make this document worse than the screen it is exported from.
  const header = ['domain', 'collection', 'item', 'name', 'state', 'claim', 'checked_at'];
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.domain,
        r.collection,
        r.naturalKey,
        // A SUMMARY and an FN are written by whoever wrote them, so this field
        // goes through `csvField` like every other — see the formula note
        // above, which named calendar summaries before one could reach here.
        r.displayName ?? '',
        r.state,
        r.claim,
        r.confirmedAt ?? '',
      ]
        .map(csvField)
        .join(','),
    );
  }
  // Written as an escape, never as a literal: an invisible U+FEFF in source is
  // one a formatter, a linter's no-irregular-whitespace rule or a careless
  // paste removes without anybody seeing it go.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** The characters a spreadsheet reads as "this cell is code, run it". */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** One field: de-fanged first, then quoted per RFC 4180. */
function csvField(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  // `replace(/…/g)` rather than `replaceAll`: this module is consumed by the
  // web app, whose lib target predates it.
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * How a `TargetAnswer` is written down (migration 0045).
 *
 * Five strings, one per distinguishable answer, and the `item.confirmed_answer`
 * CHECK constraint holds exactly these. The codec lives here rather than in the
 * ledger because it is vocabulary, not storage: what the target said is one of
 * these five things whatever database is underneath, and both editions must
 * write the same word for the same observation (ADR-0026).
 *
 * What is stored is the ANSWER, never the derived `ConfirmedRow`. The reason is
 * in the migration's own comment and it is this plan's own history: slice 1
 * shipped seven row states, slice 2 found an eighth, and a row that had frozen
 * slice 1's word would still be claiming the wrong thing today.
 */
export type StoredAnswer = 'match' | 'differs' | 'uncomparable' | 'absent' | 'unreachable';

/** All five, for a caller that must sweep them. */
export const STORED_ANSWERS: readonly StoredAnswer[] = [
  'match',
  'differs',
  'uncomparable',
  'absent',
  'unreachable',
];

/**
 * Write an answer down.
 *
 * Exhaustive over `TargetAnswer` via the `never` arm, so a sixth kind of answer
 * — the sort slice 2 added when it found `unreachable` missing — cannot be
 * introduced without this function refusing to compile. That is the point: an
 * answer with no way to be stored would otherwise be silently written as one of
 * the others, and every one of the others is a claim about somebody's data.
 */
export function storedAnswerFor(answer: TargetAnswer): StoredAnswer {
  if ('unreachable' in answer) return 'unreachable';
  if (!answer.onTarget) return 'absent';
  switch (answer.comparison) {
    case 'match':
      return 'match';
    case 'differ':
      return 'differs';
    case 'unavailable':
      return 'uncomparable';
    default: {
      const exhaustive: never = answer.comparison;
      throw new Error(`unhandled comparison: ${String(exhaustive)}`);
    }
  }
}

/**
 * Read an answer back.
 *
 * A total `Record`, so a value added to `StoredAnswer` is a compile error here
 * rather than a runtime `undefined` that `rowFor` would then read as an absence.
 */
const ANSWER_FROM_STORED: Readonly<Record<StoredAnswer, TargetAnswer>> = {
  match: { onTarget: true, comparison: 'match' },
  differs: { onTarget: true, comparison: 'differ' },
  uncomparable: { onTarget: true, comparison: 'unavailable' },
  absent: { onTarget: false },
  unreachable: { unreachable: true },
};

/**
 * Turn a stored string back into an answer, or throw.
 *
 * Throws rather than coerces (hard rule 9). A value the database holds and this
 * vocabulary does not know is a schema that has moved without the code: reading
 * it as "absent" would put *we placed it and it is gone* on somebody's list on
 * the strength of a string nobody recognised.
 */
export function answerFromStored(stored: string): TargetAnswer {
  const answer = (ANSWER_FROM_STORED as Record<string, TargetAnswer | undefined>)[stored];
  if (!answer) throw new Error(`unknown stored confirmation answer: ${stored}`);
  return answer;
}
