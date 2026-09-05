// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which side a failure happened on, recorded where it happens (workplan 0094
 * T5, second slice).
 *
 * A migration signs in with two connections, and until now a failed pass
 * could not say which one failed: `last_error` is provider prose, and the
 * category (0110 T3) deliberately stops short of the side because `target_
 * refused` is not really about the target — the classifier files a source's
 * 403 there too. So the first slice put the same line on both connection
 * cards and said "Test tells which". This is the second: the pass KNOWS which
 * closure it was calling when the error came out, and says so.
 *
 * ## How it travels
 *
 * A non-enumerable property under a well-known symbol on the thrown object —
 * not a subclass, not a wrapper. The error keeps its class, its message and
 * its stack, `instanceof` still works, JSON and logs do not see the tag, and
 * a `PassAbortError` whose `cause` is the tagged error carries it too, which
 * is what lets the tripwire's abort say which side broke. A primitive thrown
 * (a string) is wrapped once, keeping its text, because a primitive cannot
 * carry a property.
 *
 * The first tag wins. Closures do not nest across sides, so the innermost
 * seam is the true one, and a caller re-tagging on the way up cannot turn a
 * source failure into a target one.
 */

import type { FailureSide } from '@openmig/shared';

/** `Symbol.for`, so two copies of this module still read each other's tags. */
const FAILURE_SIDE = Symbol.for('ownpace.failureSide');

/** How far along a `cause` chain the side is looked for. */
const CAUSE_DEPTH = 8;

const carries = (value: unknown): value is object =>
  value !== null && (typeof value === 'object' || typeof value === 'function');

/**
 * Tag a thrown value with the side it came from, and hand it back to be
 * rethrown. Never throws itself.
 */
export function withFailureSide(side: FailureSide, thrown: unknown): unknown {
  if (carries(thrown)) {
    if (!(FAILURE_SIDE in thrown)) {
      Object.defineProperty(thrown, FAILURE_SIDE, {
        value: side,
        enumerable: false,
        configurable: true,
      });
    }
    return thrown;
  }
  const wrapped = new Error(String(thrown), { cause: thrown });
  Object.defineProperty(wrapped, FAILURE_SIDE, { value: side, enumerable: false });
  return wrapped;
}

/**
 * The side a thrown value carries, on itself or along its `cause` chain —
 * `undefined` when none does, which is a real answer ("neither, or unknown")
 * and never a guess.
 */
export function failureSideOf(thrown: unknown): FailureSide | undefined {
  let current = thrown;
  for (let depth = 0; depth < CAUSE_DEPTH && carries(current); depth += 1) {
    const side = (current as Record<PropertyKey, unknown>)[FAILURE_SIDE];
    if (side === 'source' || side === 'target') return side;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The same function, with everything it throws or rejects tagged as `side`.
 * Synchronous throws and returned promises are both covered; a value that is
 * neither is passed through untouched.
 */
export function sided<A extends unknown[], R>(
  side: FailureSide,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    let result: R;
    try {
      result = fn(...args);
    } catch (thrown) {
      throw withFailureSide(side, thrown);
    }
    if (result instanceof Promise) {
      return result.catch((thrown: unknown) => {
        throw withFailureSide(side, thrown);
      }) as R;
    }
    return result;
  };
}
