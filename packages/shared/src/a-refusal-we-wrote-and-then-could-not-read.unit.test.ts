// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL WE WROTE, AND THEN COULD NOT READ (workplan 0125 T4).
 *
 * Thirty of the owner's files sat `failed` on a live Google migration on
 * 2026-09-18, and all thirty read `last_error_category = 'unknown'` — whose
 * remedy is *"send it to us and we will look"*. The prose beside them was ours:
 * `NativeFileRefused` had branched on exactly why each file was not going and
 * written a paragraph about it. The classifier then read that paragraph back
 * and could not tell.
 *
 * `classifyFailure`'s defence of matching on text is sound and stays: the
 * signals it matches are protocol vocabulary somebody else specified, and the
 * worst case is `unknown`. None of that covers an error we built ourselves.
 *
 * So a category may be STATED at the throw, and this file holds the two halves
 * of that: it travels (the carrier), and it wins (the classifier).
 */

import { describe, it, expect } from 'vitest';
import { classifyFailure, FAILURE_CATEGORIES } from './failure-category.ts';
import { withFailureCategory, statedFailureCategoryOf } from './stated-failure-category.ts';
import { markNeedsDecision, isDecisionError } from './needs-decision.ts';

describe('a category stated at the throw', () => {
  it('reads back off the error that carries it', () => {
    const refused = withFailureCategory('policy_refused', new Error('no file to copy'));
    expect(statedFailureCategoryOf(refused)).toBe('policy_refused');
  });

  it('answers undefined for an error that states nothing, which is most of them', () => {
    // A real answer, not a guess: the message is then read exactly as it was
    // before any of this existed.
    expect(statedFailureCategoryOf(new Error('HTTP 403: forbidden'))).toBeUndefined();
    expect(statedFailureCategoryOf('a bare string')).toBeUndefined();
    expect(statedFailureCategoryOf(undefined)).toBeUndefined();
    expect(statedFailureCategoryOf(null)).toBeUndefined();
  });

  it('survives being wrapped, because errors get re-thrown with a cause', () => {
    // `PassAbortError` and every `sided()` wrapper put the original under
    // `cause`. A tag that stopped at the first hop would be lost exactly when a
    // failure travelled, which is when it matters.
    const inner = withFailureCategory('policy_refused', new Error('declined by policy'));
    const outer = new Error('the pass stopped', { cause: inner });
    expect(statedFailureCategoryOf(outer)).toBe('policy_refused');
  });

  it('keeps the FIRST statement, so nothing overwrites a first-hand answer', () => {
    // The thrower knows; a caller on the way up is a second opinion. The side
    // tag has the same rule for the same reason.
    const refused = withFailureCategory('policy_refused', new Error('declined'));
    withFailureCategory('target_refused', refused);
    expect(statedFailureCategoryOf(refused)).toBe('policy_refused');
  });

  it('is invisible to anything that walks the error, logs it, or serialises it', () => {
    // Non-enumerable and under a symbol, like the side tag: a category is for
    // the ledger, not for a response body or a log line.
    const refused = withFailureCategory('policy_refused', new Error('declined'));
    expect(Object.keys(refused)).toEqual([]);
    expect(JSON.stringify({ ...refused })).toBe('{}');
    expect(refused.message).toBe('declined');
    expect(refused instanceof Error).toBe(true);
  });

  it('sits beside the decision marker rather than replacing it', () => {
    // Two different questions: "does this need a person" and "what kind of
    // thing is it". `NativeFileRefused` answers both, and neither answer may
    // stand in for the other.
    const refused = withFailureCategory('policy_refused', markNeedsDecision(new Error('x')));
    expect(isDecisionError(refused)).toBe(true);
    expect(statedFailureCategoryOf(refused)).toBe('policy_refused');
  });

  it('refuses a value that is not one of the categories', () => {
    // A tag written by an older or newer build is as unrenderable on a screen
    // as a value read out of the table, so it is checked rather than trusted.
    const wrong = new Error('x');
    Object.defineProperty(wrong, Symbol.for('ownpace.statedFailureCategory'), {
      value: 'provider_error',
    });
    expect(statedFailureCategoryOf(wrong)).toBeUndefined();
  });

  it('never throws, for anything', () => {
    // It runs where a failure is already being recorded.
    const circular: { self?: unknown; cause?: unknown } = {};
    circular.cause = circular;
    expect(() => statedFailureCategoryOf(circular)).not.toThrow();
    expect(() => withFailureCategory('network', 7)).not.toThrow();
    expect(withFailureCategory('network', 7)).toBe(7);
  });
});

describe('the classifier prefers what it was told over what it can read', () => {
  it('takes the stated category over a message that matches a rule', () => {
    // The live case, minus the prose: the refusal's own sentence says
    // "configured with nativeFilePolicy" and nothing in it matches a rule, but
    // an adjacent one could — and a guess must never beat a first-hand answer.
    expect(classifyFailure('403 Forbidden', 'target', 'policy_refused')).toBe('policy_refused');
  });

  it('takes it over the SIDE too, which is the stronger of the two guesses', () => {
    // `side` is structural and beats every regex; a statement beats it in turn.
    // Both are recorded by this codebase, and the one recorded by the code that
    // constructed the error knows more than the one recorded by the closure
    // that let it through.
    expect(classifyFailure('403 Forbidden', 'source', 'target_refused')).toBe('target_refused');
  });

  it('ignores a stated value that is not a category, rather than writing it', () => {
    // Same rule as the reader's, at the other end: this function's contract is
    // that it answers with one of `FAILURE_CATEGORIES`, whatever it is handed.
    const answer = classifyFailure('403 Forbidden', 'target', 'nonsense' as never);
    expect(answer).toBe('target_refused');
    expect(FAILURE_CATEGORIES).toContain(answer);
  });

  it('changes nothing when nothing is stated', () => {
    // The whole of the old behaviour, unmoved. Every provider error in the
    // product takes this path.
    expect(classifyFailure('invalid_grant')).toBe('auth_expired');
    expect(classifyFailure('403 Forbidden', 'source')).toBe('source_refused');
    expect(classifyFailure('403 Forbidden', 'target')).toBe('target_refused');
    expect(classifyFailure('something nobody recognises')).toBe('unknown');
  });

  it('is the only route to policy_refused, and that is deliberate', () => {
    // Nothing a provider says can mean "this migration's own settings declined
    // it", because no provider was involved. There is no rule for it and there
    // must not be one: a regex over our own prose would be a second derivation
    // of something the throw site already knew, and the first thing it would do
    // is disagree with itself the next time the sentence was edited.
    for (const message of [
      'nativeFilePolicy="refuse"',
      'the mapping\'s export policy has no rendering',
      'set an export policy on the mapping',
      'the export is NOT byte-stable',
    ]) {
      expect(classifyFailure(message), message).not.toBe('policy_refused');
      expect(classifyFailure(message, 'source'), message).not.toBe('policy_refused');
    }
    expect(classifyFailure('anything at all', undefined, 'policy_refused')).toBe('policy_refused');
  });
});
