// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A FAILURE THAT IS A DECISION, NOT AN ERROR (found live 2026-09-11).
 *
 * Some items cannot be copied for a reason that will not change by trying
 * again: a Google Form has no bytes to download and the mapping's policy says
 * not to export one; a shortcut points at something else. The connector says
 * so by throwing, because per-item failure isolation is the right shape for
 * "this ONE item is not going" — but the sync loop could not tell that throw
 * from a network error, and treated it as one:
 *
 *   - it counted toward the consecutive-failure tripwire, so a folder holding
 *     25 Google Docs stopped the whole pass with "this is not an item-level
 *     problem" — when it was exactly that;
 *   - it was retried on every pass until `MAX_ITEM_ATTEMPTS`, so the failure
 *     queue said "5 tries" of a policy that answers the same way every time.
 *
 * An error carrying this marker is parked on first sight: recorded with its
 * reason, handed to a person, never retried automatically, and never counted
 * as evidence that the world is broken. It lives in `shared` because the
 * connector that throws it and the loop that reads it are in different
 * packages, and neither may import the other.
 */

/** The property a decision-class error carries. A symbol-free string so it survives structured clone. */
export const NEEDS_DECISION_MARKER = 'needsDecision' as const;

export interface NeedsDecision {
  readonly [NEEDS_DECISION_MARKER]: true;
}

/** Mark an error as a decision. Returns the same object, typed. */
export function markNeedsDecision<E extends Error>(error: E): E & NeedsDecision {
  Object.defineProperty(error, NEEDS_DECISION_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return error as E & NeedsDecision;
}

/** Whether a thrown value asks for a person rather than a retry. */
export function isDecisionError(error: unknown): error is Error & NeedsDecision {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>)[NEEDS_DECISION_MARKER] === true
  );
}
