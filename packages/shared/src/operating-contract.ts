// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The operating contract: the wire shapes for everything that happens AFTER a
 * migration starts (ADR-0026).
 *
 * `apps/selfhost` already serves all of this and has done since workplan 0010;
 * the shapes were built inline as `Record<string, unknown>`, so nothing
 * type-checked them and no UI could consume them without guessing. This file
 * extracts what that server already sends rather than designing a fresh API:
 * the self-host edition is the one with working operating semantics and an e2e
 * gate over them, so it is the honest source for the contract, and the managed
 * edition (which has none of these endpoints) implements it rather than the
 * other way round.
 *
 * Two consequences worth stating, because they are the point:
 *
 *  - The **prose lives here**, not in a route handler. `whatThisMeans` and
 *    `howToResolve` are the operating semantics — how an owner is told what a
 *    queue means and what their options are. If each edition wrote its own, the
 *    two would drift, and the drift would be in exactly the explanations that
 *    stop somebody destroying data by accident. One source, both editions, and
 *    the UI renders the same words the JSON carries instead of inventing its
 *    own.
 *  - Item rows are the LEDGER's types (`ItemFailure`, `ItemMove`,
 *    `ItemDeletion` in `ports.ts`), re-used verbatim. The queues are envelopes
 *    around them — grouping, status and guidance — and deliberately add no
 *    per-item field of their own, so there is nothing to keep in sync.
 *
 * §17 note carried over from the handlers: `naturalKeyHash` is the handle for
 * every action precisely so that a body which may be pasted into a ticket does
 * not carry a Message-ID or a file path. `ItemMove.from`/`to` and
 * `ItemDeletion.collection` ARE paths and are the documented exception — a
 * queue that cannot say where something went is not one anybody can act on.
 */

import {
  DELETION_CONFIRMATIONS,
  MAX_ITEM_ATTEMPTS,
  type ItemDeletion,
  type ItemFailure,
  type ItemMove,
  type MigrationStatus,
  type PassMetrics,
} from './ports';
import type { VerificationResult } from './verification-report';
import type { FinishRefuseCode } from './lifecycle';

/**
 * Where a mapping is in its life, as the operating surface reports it.
 *
 * A string union rather than the `string` the self-host lifecycle helpers pass
 * around, because the UI branches on it: `paused` hides the queues (nothing has
 * been copied yet, so nothing can have diverged) and `done` shows them as a
 * closed record rather than a to-do list.
 */
export type MappingLifecycle = 'paused' | 'active' | 'cutover' | 'done';

/**
 * The same four, as a value, for narrowing a string that came from the database.
 *
 * Kept beside the type so the two cannot drift, and matching
 * `mailbox_mapping_status_check` in the baseline migration — the constraint is
 * what actually enforces this, and a reader should be able to find both.
 */
export const MAPPING_LIFECYCLES: readonly MappingLifecycle[] = [
  'paused',
  'active',
  'cutover',
  'done',
];

/**
 * What every queue carries regardless of which one it is.
 *
 * `reportingClosed` is present only for a finished migration. A queue that
 * keeps nagging after the migration ended is one people learn to dismiss, but
 * deleting the history would throw away the record of what was outstanding when
 * it stopped — so the items stay and the framing changes.
 */
export interface QueueEnvelope {
  readonly migrationStatus: MappingLifecycle;
  readonly reportingClosed?: string;
}

/**
 * Guidance shown with a queue. One entry per thing a person can do.
 *
 * Declared as type ALIASES rather than interfaces on purpose: TypeScript gives
 * an alias of an all-string object an implicit index signature and an interface
 * none, so only the alias form is assignable to `Record<string, string>`. A UI
 * renders these by iterating them — it shows every option the server sent
 * rather than naming the ones it knows about, so an option added here appears
 * without the UI being changed, instead of being silently dropped.
 */
export type FailureGuidance = {
  readonly retry: string;
  readonly accept: string;
  readonly doNothing: string;
};

/**
 * Guidance shown with the move queue.
 *
 * `apply` is the destructive one and is OPTIONAL, because it exists only for
 * the moves that are relocations — see `mayOfferRelocationApply`. A queue with
 * no relocation in it must not advertise an action none of its rows can offer.
 */
export type MoveGuidance = {
  readonly keep: string;
  readonly apply?: string;
  readonly byHand: string;
  readonly doNothing: string;
};

/** Guidance shown with the deletion queue. `apply` is the destructive one. */
export type DeletionGuidance = {
  readonly keep: string;
  readonly apply: string;
  readonly byHand: string;
  readonly doNothing: string;
};

/**
 * Items that could not be migrated.
 *
 * Split rather than left for the reader to filter, because the two halves are
 * different situations: `retrying` is still being worked on by the tool and
 * wants nobody's attention; `needsDecision` has run out of attempts and will
 * never move again until a person says something.
 */
export interface FailuresQueue extends QueueEnvelope {
  readonly needsDecision: readonly ItemFailure[];
  readonly retrying: readonly ItemFailure[];
  readonly howToResolve: FailureGuidance;
}

/**
 * Items the source has relocated since we copied them.
 *
 * Nothing here has been acted on. Whether anything CAN be depends on the row:
 * a move that kept the item's natural key — every mail and calendar move — is
 * report-only, because making the target follow it would mean deleting the copy
 * where it sits, which hard rule 2 forbids. A RELOCATION, where the key changed
 * and the same bytes are already on the target under the new one, can be
 * applied (ADR-0030): removing the old copy there loses nothing.
 */
export interface MovesQueue extends QueueEnvelope {
  readonly open: readonly ItemMove[];
  readonly acknowledged: readonly ItemMove[];
  readonly whatThisMeans: string;
  readonly howToResolve: MoveGuidance;
}

/**
 * Items the source no longer has, which the target still holds.
 *
 * `watching` is the not-yet-confirmed tail: shown so the queue is not a black
 * box, never actionable. Only `confirmed` items may be decided about, and only
 * those with positive evidence may be applied — see `DeletionEvidence` and
 * ADR-0024.
 */
export interface DeletionsQueue extends QueueEnvelope {
  readonly confirmed: readonly ItemDeletion[];
  readonly watching: readonly ItemDeletion[];
  readonly acknowledged: readonly ItemDeletion[];
  readonly whatThisMeans: string;
  readonly howToResolve: DeletionGuidance;
}

/**
 * Every queue endpoint answers with one entry per configured mapping, keyed by
 * the operator's own mapping id.
 *
 * An object rather than an array because that is what ships today and the e2e
 * gates index into it by id; also because the id is the thing an operator knows
 * from their own config file, so a map reads more naturally than a find().
 */
export type ByMapping<T> = Readonly<Record<string, T>>;

export type FailuresResponse = ByMapping<FailuresQueue>;
export type MovesResponse = ByMapping<MovesQueue>;
export type DeletionsResponse = ByMapping<DeletionsQueue>;

/**
 * Per-domain progress for one mapping.
 *
 * `itemsRetrying` and `itemsNeedingDecision` are on the STATUS payload, not
 * only on `/failures`, because status is what anyone watching a migration
 * actually polls: a run with items stuck in the queue must not look identical
 * to one with none.
 */
export interface DomainStatusReport {
  readonly domain: MigrationStatus['domain'];
  readonly state: MigrationStatus['state'];
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly bytesTransferred: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
  /**
   * Where the last completed pass spent its time. Absent until a pass
   * completes; never invented as zeros, because zero durations read as
   * "instant" rather than "unknown".
   */
  readonly lastPass?: PassMetrics;
  readonly itemsRetrying: number;
  readonly itemsNeedingDecision: number;
}

/**
 * Build `DomainStatusReport` rows from ledger rows — the ONE place the
 * derivation lives (0033 T5).
 *
 * `MigrationStatus` rows carry the pass state; the two attention counts
 * (`itemsRetrying` / `itemsNeedingDecision`) come from the failure queue, and
 * `completedAt` is renamed to the report's `lastSyncedAt`. The selfhost
 * `/status` builder has done this since 0010; the managed
 * `GET /migrations/{id}` used to serve raw `MigrationStatus` rows instead —
 * so a UI reading `itemsRetrying` off the managed payload silently rendered
 * nothing (`undefined > 0`), an invisible edition split of exactly the kind
 * hard rule 5 forbids. Both editions now call this.
 */
export function buildDomainStatusReports(
  statuses: readonly MigrationStatus[],
  failures: readonly ItemFailure[],
): DomainStatusReport[] {
  return statuses.map((s) => {
    const mine = failures.filter((f) => f.domain === s.domain);
    return {
      domain: s.domain,
      state: s.state,
      itemsSynced: s.itemsSynced,
      itemsFailed: s.itemsFailed,
      bytesTransferred: s.bytesTransferred,
      itemsRetrying: mine.filter((f) => !f.needsDecision).length,
      itemsNeedingDecision: mine.filter((f) => f.needsDecision).length,
      ...(s.completedAt ? { lastSyncedAt: s.completedAt } : {}),
      ...(s.lastError ? { lastError: s.lastError } : {}),
      ...(s.lastPassMetrics ? { lastPass: s.lastPassMetrics } : {}),
    };
  });
}

/**
 * Whether the notification channel is on, and if not, why.
 *
 * On the status payload because the alternative is what shipped: a single
 * `log.info` line at boot (0030 T1 promised this would be "said honestly in the
 * UI"; it was said honestly in the logs). An owner who never opens a container
 * log — which is the owner 0030 describes, the one who "checks the UI weekly at
 * best" — has no way to tell "nothing needs my attention" from "the emails were
 * never switched on". Those two look identical from the outside and mean
 * opposite things.
 *
 * The reason travels VERBATIM. `readNotifierConfig` already distinguishes
 * nothing-set (the ordinary default) from half-set (somebody tried and missed a
 * variable, and it names which), and that distinction is the entire value of
 * showing this at all — hard rule 9.
 */
export interface NotificationChannelReport {
  readonly enabled: boolean;
  /**
   * Present only when disabled. The channel's own words, not a paraphrase: a
   * summarised reason is one an operator cannot act on.
   */
  readonly reason?: string;
}

export interface StatusReport {
  readonly status: 'ok';
  /**
   * Absent on payloads built before this field existed, and by callers that
   * have no channel to report — optional rather than defaulted to `false`,
   * because "notifications are off" and "nobody asked" are different claims and
   * only one of them should make an owner go looking for a setting.
   */
  readonly notifications?: NotificationChannelReport;
  readonly mappings: ReadonlyArray<{
    readonly mappingId: string;
    /**
     * Whether this migration is still running.
     *
     * On the status payload because `/status` is what anyone watching a
     * migration polls, and "is this thing still syncing?" is the first question
     * they have. Without it the per-domain states are ambiguous in the one case
     * that matters: a finished migration and a stalled one both show their last
     * completed pass and nothing since.
     */
    readonly migrationStatus: MappingLifecycle;
    readonly domains: readonly DomainStatusReport[];
  }>;
}

/**
 * What closing a §11.1 drift decision actually DID — the one decision surface
 * whose responses carried no effect sentence (0036 T2; the item queues'
 * `DecisionAccepted.effect` predates it). Rendered verbatim by the UI, like
 * all effect prose: it says what is now true, for the person who just
 * clicked.
 */
export const DECISION_EFFECTS = {
  resolved: 'Answer recorded — the migration acts on it from here on.',
  dismissed:
    'Closed without acting; the detector may raise it again if the situation persists.',
} as const;

/** The decisions an owner can make, across all three queues. */
export type OperatingAction = 'keep' | 'apply' | 'retry' | 'accept';

/**
 * A decision that was carried out.
 *
 * `effect` is written to be read verbatim by the person who just clicked, and
 * says what is now true rather than what the tool did — "the target keeps its
 * copy", not "acknowledgedAt was set".
 */
export interface DecisionAccepted {
  readonly status: 'ok';
  readonly action: OperatingAction;
  readonly naturalKeyHash: string;
  readonly effect: string;
  /**
   * For `apply` only: whether the target's own bin still holds the removed
   * item. The difference between a recoverable removal and a final one, so it
   * is reported rather than inferred from the target type.
   */
  readonly kind?: 'binned' | 'purged';
}

/**
 * A decision that was refused, or had nothing to act on.
 *
 * Both fields carry text meant for a person. `reason` comes from
 * `applyDeletion`'s refusal codes and explains a gate; `hint` explains an
 * absence — the two are different and a UI shows them differently.
 */
export interface DecisionRefused {
  readonly error: string;
  readonly reason?: string;
  readonly hint?: string;
}

export type DecisionOutcome = DecisionAccepted | DecisionRefused;

/** Narrowing helper, so consumers do not each invent their own `'status' in x`. */
export function decisionSucceeded(outcome: DecisionOutcome): outcome is DecisionAccepted {
  return (outcome as DecisionAccepted).status === 'ok';
}

/**
 * The §20 verification gate's answer, per mapping.
 *
 * **Running this costs something.** It counts and samples the TARGET, so it is
 * a request that goes out over the network for every enabled domain — not a
 * status read. A UI must therefore make it an explicit action rather than
 * something that happens because somebody opened a page, and must not poll it.
 */
export type VerifyResponse = ByMapping<VerificationResult>;

/**
 * A verification run's lifecycle, for the start + poll pair (workplan 0017 T0).
 *
 * The synchronous `GET /verify` above holds an HTTP request open for as long
 * as the scan takes — minutes, against every enabled domain's target. That
 * works on the appliance and is impossible for the managed edition, where
 * target I/O belongs to the worker and no request thread may hold connector
 * credentials for minutes. So both editions converge on this instead:
 * `POST /verify/start` begins the work, `GET /verify/report` says where it is,
 * and the report is one of exactly four states.
 *
 * `never-run` is a true statement, not a default to paper over: the appliance
 * holds its last report in memory, so a restart honestly forgets it (re-running
 * is cheap next to a migration); managed persists a row and remembers. The
 * asymmetry is deliberate and documented rather than hidden.
 *
 * `failed` means the run itself did not complete — the scan crashed, not "the
 * data did not match". A domain that could not be read is a NOT_VERIFIABLE
 * status inside a `done` report; conflating the two would let an infrastructure
 * error read as a clean bill of health, or a real mismatch read as a hiccup
 * (hard rule 9 either way).
 */
export type VerificationRunReport =
  | { readonly state: 'never-run' }
  | { readonly state: 'running'; readonly startedAt: string }
  | {
      readonly state: 'done';
      readonly startedAt: string;
      readonly finishedAt: string;
      readonly report: VerifyResponse;
    }
  | { readonly state: 'failed'; readonly startedAt: string; readonly error: string };

/**
 * What `POST /verify/start` answers.
 *
 * `started: false` is not an error — it means a run was already under way and
 * this request joined it, the same idempotent-action shape as `POST .../start`'s
 * `activated: false`. The report is included either way so a client can begin
 * polling from what it already has.
 */
export interface VerifyStartResponse {
  readonly started: boolean;
  readonly report: VerificationRunReport;
}

/**
 * One `apply` request's lifecycle in the managed edition (workplan 0017 T4).
 *
 * The route answers the LEDGER-side gates synchronously — a refusal is an
 * answer to the operator's question and comes back on the request they made,
 * as 403/404 with the same code and reason the appliance uses. What cannot be
 * answered from a request thread is the target's half: whether it can remove
 * at all, and whether the owner has edited our copy (checked at the moment of
 * removal, where the ETag is). Those land here, on the receipt the job owns.
 *
 * `none` is for the poll endpoint: nothing was ever queued for this item.
 * `refused` here is not a transport failure and not a crash — it is one of
 * the destructive path's own gates saying no, with the code a UI can switch
 * on and the sentence an operator reads verbatim. `failed` is the job itself
 * crashing, reason attached (hard rule 9). The appliance answers all of this
 * synchronously and never produces a receipt.
 */
export type ApplyReceipt =
  | { readonly state: 'none' }
  | { readonly state: 'queued'; readonly requestedAt: string }
  | {
      readonly state: 'applied';
      readonly requestedAt: string;
      readonly finishedAt: string;
      /** How final the removal was: `binned` targets may still hold a copy. */
      readonly kind: string;
    }
  | {
      readonly state: 'refused';
      readonly requestedAt: string;
      readonly finishedAt: string;
      /** The stable refusal code (`@openmig/core`'s `ApplyRefusal`). */
      readonly code: string;
      readonly reason: string;
    }
  | {
      readonly state: 'failed';
      readonly requestedAt: string;
      readonly finishedAt: string;
      readonly error: string;
    };

/**
 * What the managed `POST .../deletions/{hash}/apply` answers when the removal
 * is PERMITTED. (A refusal never gets this far — it is a 403/404 on the spot.)
 * `queued: false` means a receipt for this item was already open and this
 * request joined it — the idempotent-action shape again.
 */
export interface ApplyQueuedResponse {
  readonly queued: boolean;
  readonly receipt: ApplyReceipt;
}

/**
 * Gate 1 of the destructive path, readable in both editions (workplan 0019 T3).
 *
 * `GET .../apply-deletions` answers this in both editions so the same screen
 * renders the same fact. What differs is who OWNS the value, and `source` says
 * so honestly:
 *
 *  - `'mapping'` — the managed mapping row; an owner changes it via
 *    `PATCH .../apply-deletions` with `{ allowApplyDeletions: boolean }`.
 *  - `'config'` — the appliance's mapping config file. No API mutates it: the
 *    file IS the appliance's configuration surface, and a PATCH there answers
 *    405 naming the file instead of pretending.
 *
 * Off is the default in both editions, by migration and by config parsing: a
 * capability that destroys data is opted INTO, never out of.
 */
export interface ApplyDeletionsFlag {
  readonly allowApplyDeletions: boolean;
  readonly source: 'mapping' | 'config';
}

/**
 * The warning a UI puts IN FRONT of the switch that enables `apply` (0019 T3).
 *
 * Shared prose, like the queue guidance: the sentence somebody reads before
 * arming the only destructive capability must not drift between editions.
 */
export const APPLY_FLAG_WARNING =
  'Turning this on enables the only operation in this product that deletes ' +
  'anything: on your explicit per-item decision, the copy this migration wrote ' +
  'to the new system is removed, following a deletion the owner made on the old ' +
  'one. Every removal still has to pass every gate — positive evidence only ' +
  '(never an inferred absence), only items this tool wrote, never a copy ' +
  'somebody has since edited, and the mass-deletion breaker. While this is off, ' +
  'nothing can be removed however the endpoint is called.';

/**
 * The same warning in Dutch (ADR-0013, workplan 0024). It lives HERE, beside
 * its English source, for the same reason the English lives here at all
 * (ADR-0026): prose in front of the destructive path must have one source of
 * truth — a translation kept in a web-app dictionary would drift from the
 * sentence it translates without anything noticing. Update BOTH or neither.
 */
export const APPLY_FLAG_WARNING_NL =
  'Als u dit inschakelt, activeert u de enige bewerking in dit product die ' +
  'iets verwijdert: op uw uitdrukkelijke beslissing per item wordt de kopie ' +
  'die deze migratie naar het nieuwe systeem schreef verwijderd, volgend op ' +
  'een verwijdering die de eigenaar in het oude systeem deed. Elke ' +
  'verwijdering moet nog steeds elke controle doorstaan — uitsluitend ' +
  'positief bewijs (nooit een afgeleide afwezigheid), alleen items die dit ' +
  'programma zelf schreef, nooit een kopie die iemand sindsdien heeft ' +
  'bewerkt, en de massaverwijderings-stroomonderbreker. Zolang dit uit ' +
  'staat, kan er niets worden verwijderd, hoe het eindpunt ook wordt ' +
  'aangeroepen.';

/**
 * A migration that has been ended.
 *
 * Finishing stops the shadow sync: the mapping is no longer scheduled, so
 * copying stops and so does drift, deletion and move reporting. It changes
 * NOTHING on either side — it is a statement about what the tool does next, not
 * an action on anyone's data — which is why this is not a `DecisionOutcome`
 * even though it looks like one.
 */
export interface FinishAccepted {
  readonly status: 'ok';
  readonly action: 'finish';
  readonly mappingId?: string;
  /** True when the migration was already finished; nothing was done. */
  readonly alreadyDone?: boolean;
  /**
   * Items that could not be migrated and were knowingly left behind.
   *
   * Present only when the operator forced past the failure queue. On the record
   * deliberately: this is the number that says what the customer did not get.
   */
  readonly leftUnmigrated?: number;
  readonly effect: string;
  readonly ifYouNeedToResume?: string;
}

/**
 * A refusal to finish.
 *
 * The one thing that blocks finishing is UNRESOLVED FAILURES — items that could
 * not be copied and are no longer being retried. Finishing over them silently
 * converts "we are still working on this" into "this is what you got", which is
 * the quiet data loss §11.2's decision queue exists to prevent. The operator can
 * still proceed with `?force=true`, but has to say so.
 */
export interface FinishRefused {
  readonly error: string;
  readonly hint?: string;
  /** Stable machine discriminant (0038 T1) — 'unresolved_failures' is the
   *  only refusal `force` can satisfy; a UI must not offer force on others. */
  readonly code?: FinishRefuseCode;
}

export type FinishOutcome = FinishAccepted | FinishRefused;

export function finishSucceeded(outcome: FinishOutcome): outcome is FinishAccepted {
  return (outcome as FinishAccepted).status === 'ok';
}

/**
 * The sentence a finished migration shows above its queues.
 *
 * Shared so both editions close reporting with the same words — a mapping that
 * reads "still outstanding" in one edition and "kept as a record" in the other
 * would be describing the same rows two different ways.
 */
export const REPORTING_CLOSED =
  'This migration is finished, so nothing here is still being watched. ' +
  'Anything listed was outstanding when it ended and is kept as a record.';

export const FAILURE_GUIDANCE: FailureGuidance = {
  retry:
    `POST /mappings/{mappingId}/failures/{naturalKeyHash}/retry — the cause is ` +
    `fixed; try again on the next pass. Also clears this mapping's cursors so the ` +
    `item is certain to be listed again.`,
  accept:
    `POST /mappings/{mappingId}/failures/{naturalKeyHash}/accept — migrate ` +
    `without it. Permanent: the item stops being retried and stops counting as ` +
    `missing at the verification gate.`,
  doNothing:
    `Items under "retrying" need no action — they are attempted again on every ` +
    `pass until ${MAX_ITEM_ATTEMPTS} attempts, then move to "needsDecision".`,
};

export const MOVES_MEANING =
  'The item is on the target under "from". The source now lists it under "to". ' +
  'Nothing was written, copied or deleted on either side. Where `toNaturalKeyHash` ' +
  'is present the item was RELOCATED — a file moved or renamed, so its key changed ' +
  'and the same bytes have already been copied to the target under the new one; ' +
  'those are the rows an `apply` can finish.';

export const MOVE_GUIDANCE: MoveGuidance = {
  keep:
    `POST /mappings/{mappingId}/moves/{naturalKeyHash}/keep — the target's layout ` +
    `is fine as it is; stop reporting this one. Reversible only in the sense that ` +
    `moving the item somewhere else again reopens it.`,
  apply:
    `POST /mappings/{mappingId}/moves/{naturalKeyHash}/apply — APPLIANCE ONLY so far, and `
    + `RELOCATIONS ONLY, ` +
    `and it REMOVES the target's old copy. Allowed where the same operation on a ` +
    `deletion would not be, for one reason: the same bytes are already on the ` +
    `target under the key the source moved the item to, written by this migration, ` +
    `and that is re-checked at the moment of removal. Off unless the mapping sets ` +
    `allowApplyDeletions — the same switch, because it is the same capability — ` +
    `and refused for a copy somebody has edited on the target, for one this ` +
    `migration did not write, and while the mass-deletion breaker is up (ADR-0030). The `
    + `managed edition does not serve this route yet — its destructive path runs through a `
    + `queued job and a receipt — so there it is: remove the old copy in the target system `
    + `yourself, then keep.`,
  byHand:
    'To make the target match without using apply, move or delete the item there ' +
    'yourself in the target system, then keep. This tool never removes anything ' +
    'from a target without an explicit per-item decision (hard rule 2).',
  doNothing:
    'A move that is put back on the source disappears from this list by itself on ' +
    'the next pass.',
};

export const DELETIONS_MEANING =
  'The item is on the target and the owner has deleted it on the source. Nothing ' +
  'has been removed from either side. Read `evidence` to see how we know: ' +
  '"reported" means the source itself told us the object was gone; "trashed" means ' +
  "we found it sitting in the owner's Deleted Items; both are believed at once. " +
  `"inferred" means it stopped appearing in ${DELETION_CONFIRMATIONS} or more ` +
  'consecutive complete scans, which is a strong suspicion rather than a fact.';

export const DELETION_GUIDANCE: DeletionGuidance = {
  keep:
    `POST /mappings/{mappingId}/deletions/{naturalKeyHash}/keep — you are happy ` +
    `for the new system to keep its copy; stop reporting this one. This is the ` +
    `usual answer: the target becoming a fuller archive than the shrinking source ` +
    `is a feature, not a fault.`,
  apply:
    `POST /mappings/{mappingId}/deletions/{naturalKeyHash}/apply — remove the ` +
    `target's copy too, following the source. THE ONLY DESTRUCTIVE ACTION IN THIS ` +
    `PRODUCT: refused unless this mapping has \`allowApplyDeletions: true\` in its ` +
    `config, refused for "inferred" evidence (an absence is never enough, however ` +
    `many passes it repeats), refused for an item somebody has since edited on the ` +
    `target, and refused altogether while an unusual share of the domain looks ` +
    `pending deletion at once (the mass-deletion breaker). See the runbook before ` +
    `using this.`,
  byHand:
    'To remove it from the target yourself instead, delete it there, then keep. ' +
    'This tool never deletes on a target without the explicit apply action above ' +
    '(hard rule 2).',
  doNothing:
    'An item that reappears on the source drops off this list by itself: its ' +
    'count resets — a run of absences has to be consecutive to mean anything — and ' +
    'so does any report or bin sighting, because an item can be deleted and ' +
    'restored, or dragged back out of Deleted Items.',
};

/**
 * Whether this item may be put in front of an `apply` button at all.
 *
 * The evidence gate from ADR-0024, exported so the UI does not re-derive it and
 * get it subtly wrong. This is a NECESSARY condition and not a sufficient one:
 * `applyDeletion` on the server enforces the rest (mapping opt-in, an untouched
 * target copy, the mass-deletion breaker) and is the only thing that decides.
 * A UI using this to decide what to SHOW is correct; a UI using it to predict
 * that a click will succeed is not.
 */
export function mayOfferApply(deletion: ItemDeletion): boolean {
  return deletion.confirmed && deletion.evidence !== 'inferred';
}

/**
 * Whether this MOVE may be put in front of an `apply` button at all (ADR-0030).
 *
 * The relocation gate, exported for the same reason `mayOfferApply` is: so the
 * UI does not re-derive it and get it subtly wrong. A move with no
 * `toNaturalKeyHash` kept its natural key — every mail and calendar move, and
 * every file move recorded before migration 0009 — and there is no new copy to
 * point at, so nothing may be removed on its account.
 *
 * NECESSARY, not sufficient: `applyRelocation` on the server enforces the rest
 * (the mapping's opt-in, that the arrival is really on the target with matching
 * content, ownership, the ETag, the breaker) and is the only thing that decides.
 */
export function mayOfferRelocationApply(move: ItemMove): boolean {
  return move.toNaturalKeyHash !== undefined && move.acknowledgedAt === undefined;
}

// ---------------------------------------------------------------------------
// Run history (workplan 0026 T3 row 23 — the runs panel).
// ---------------------------------------------------------------------------

/**
 * One entry from a run's append-only event log, as the wire carries it.
 *
 * `message` is server prose and renders VERBATIM (the i18n prose boundary:
 * translate the frame, never the finding) — it is where "email sync failed:
 * JMAP target password/token not found …" lives, and rewording it is how an
 * operator ends up debugging a paraphrase.
 */
export interface RunEventReport {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly at: string;
}

/**
 * One run, as both editions serve it.
 *
 * The shape follows the managed API's original `toApiRun` — `status` collapses
 * the ledger's `queued`→`pending` and `succeeded`→`success` — and now carries
 * the run's events INLINE. That is a decision, not a convenience: the panel
 * exists because a pass whose email domain failed logged `pass complete
 * (0 created)` while the truth sat in run_event rows nobody could see
 * (2026-08-09). A separate per-run detail route was deliberately deleted with
 * it — events either arrive with the list or, history shows, they arrive
 * nowhere.
 */
export interface RunReport {
  readonly id: string;
  readonly mappingId: string | null;
  readonly type: 'full' | 'delta';
  readonly status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly itemsProcessed: number;
  readonly errors: number;
  readonly createdAt: string;
  readonly events: ReadonlyArray<RunEventReport>;
  /** True when the events shown are the newest N of more (0036 T3) — silent
   *  truncation reads as "covered everything". Absent when complete. */
  readonly eventsTruncated?: boolean;
}

/** `GET {mappingPath}/runs` — newest first, bounded by the server. */
export interface RunsResponse {
  readonly runs: ReadonlyArray<RunReport>;
  /** True when older runs exist beyond the listed ones (0036 T3). The reader
   *  computes it by over-fetching one — a client cannot distinguish "all 20"
   *  from "20 of 21" on its own, and labelling whenever length === cap would
   *  be the almost-honest this field exists to end. */
  readonly truncated?: boolean;
}
