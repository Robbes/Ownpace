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

/** Guidance shown with the move queue. */
export type MoveGuidance = {
  readonly keep: string;
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
 * Nothing here has been acted on, and nothing will be: making the target follow
 * a move means deleting the copy from where it currently sits, which is the
 * delete half of a move and hard rule 2 forbids it outright.
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

export interface StatusReport {
  readonly status: 'ok';
  readonly mappings: ReadonlyArray<{
    readonly mappingId: string;
    readonly domains: readonly DomainStatusReport[];
  }>;
}

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
  'Nothing was written, copied or deleted on either side.';

export const MOVE_GUIDANCE: MoveGuidance = {
  keep:
    `POST /mappings/{mappingId}/moves/{naturalKeyHash}/keep — the target's layout ` +
    `is fine as it is; stop reporting this one. Reversible only in the sense that ` +
    `moving the item somewhere else again reopens it.`,
  byHand:
    'To make the target match, move the item there yourself in the target system, ' +
    'then keep. Applying a move automatically would have to delete the copy that ' +
    'is there now, which this tool never does on its own (hard rule 2).',
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
