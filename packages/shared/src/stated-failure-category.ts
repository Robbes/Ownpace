// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ERROR THAT KNOWS ITS OWN CATEGORY SAYS SO (workplan 0125 T4).
 *
 * `classifyFailure` is a regex over message text, and its own module explains
 * why that is acceptable: the signals it matches are protocol vocabulary that
 * somebody else specified — `invalid_grant`, 401, 429 — and the worst case is
 * `unknown`, which is a real answer.
 *
 * That argument covers other people's errors. It does not cover OURS.
 * `NativeFileRefused` is built by this codebase, in a constructor that has
 * already branched on exactly why the file is not going; it then throws prose
 * for a classifier to guess at, and the classifier guesses `unknown` — whose
 * remedy is *"send it to us and we will look"* for a refusal we wrote
 * ourselves, one line earlier, with the reason in hand. Thirty of the owner's
 * files read that way on 2026-09-18.
 *
 * ## The same move migration 0048 made
 *
 * 0048 faced this shape once already: a source refusal and a target one read
 * identically, *"so matching harder could not have found this"*, and the fix
 * was to carry what the throw site knew (`failed_side`) rather than to write a
 * better regex. This is that again, one field along — and deliberately in the
 * same mechanism, so there is one way to tell a classifier something rather
 * than two.
 *
 * ## What this is NOT
 *
 * Not a way around `classifyFailure`. A stated category is only ever set by
 * code in this repository, at a `throw` that constructed the error itself; a
 * category inferred from a provider's message belongs in `RULES`, where the
 * evidence for it can be read. Nothing parses a stated category out of prose,
 * and nothing accepts one from a provider, a request body or a database row —
 * a value read back out of the table goes through `isFailureCategory`, which
 * is a different check for a different job.
 *
 * ## How it travels
 *
 * A non-enumerable property under a well-known symbol on the thrown object,
 * exactly as `failure-side.ts` carries the side: the error keeps its class,
 * its message and its stack, `instanceof` still works, and JSON, logs and
 * anything walking its own keys do not see the tag. A wrapper whose `cause` is
 * the tagged error carries it too, which is what lets an error survive being
 * re-thrown on its way up.
 *
 * It lives in `shared` for `needs-decision.ts`'s reason, verbatim: the
 * connector that throws it and the loop that reads it are in different
 * packages, and neither may import the other.
 */

import { isFailureCategory, type FailureCategory } from './failure-category.ts';

/** `Symbol.for`, so two copies of this module still read each other's tags. */
const STATED_CATEGORY = Symbol.for('ownpace.statedFailureCategory');

/** How far along a `cause` chain the category is looked for. */
const CAUSE_DEPTH = 8;

const carries = (value: unknown): value is object =>
  value !== null && (typeof value === 'object' || typeof value === 'function');

/**
 * State the category on a thrown value and hand it back. Never throws itself.
 *
 * THE FIRST TAG WINS, like the side's. An error is tagged by the code that
 * built it and knows what it is; a caller re-tagging it on the way up would be
 * a second opinion overwriting a first-hand one, which is the wrong direction
 * for a value whose whole purpose is to beat a guess.
 */
export function withFailureCategory<T>(category: FailureCategory, thrown: T): T {
  if (!carries(thrown)) return thrown;
  if (STATED_CATEGORY in thrown) return thrown;
  Object.defineProperty(thrown, STATED_CATEGORY, {
    value: category,
    enumerable: false,
    configurable: true,
  });
  return thrown;
}

/**
 * The category a thrown value states, on itself or along its `cause` chain —
 * `undefined` when none does.
 *
 * `undefined` is a real answer and never a guess: it means nothing here named
 * its own category, so `classifyFailure` should read the message as it always
 * has. Every other value is checked against the vocabulary rather than
 * trusted, because a tag written by an older or newer build of this code is
 * exactly as unrenderable on a screen as one read out of the database.
 */
export function statedFailureCategoryOf(thrown: unknown): FailureCategory | undefined {
  let current: unknown = thrown;
  for (let depth = 0; depth < CAUSE_DEPTH && carries(current); depth += 1) {
    const stated = (current as Record<PropertyKey, unknown>)[STATED_CATEGORY];
    if (isFailureCategory(stated)) return stated;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
