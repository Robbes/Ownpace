// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The operating contract (ADR-0026). Most of this file is types, which the
 * compiler checks; what needs a test is the one piece of BEHAVIOUR it exports —
 * `mayOfferApply`, the gate that decides whether a UI is allowed to put the
 * product's only destructive button in front of somebody.
 *
 * Tested here rather than left to the UI because the whole point of exporting
 * it is that each consumer must not re-derive it. A UI that got this wrong
 * would offer `apply` on an inferred deletion — the exact case ADR-0024 says
 * must never be actionable, because an absence has innocent explanations and
 * acting on one destroys a customer's data on the strength of a throttled
 * listing.
 */

import { describe, expect, it } from 'vitest';
import {
  DELETION_CONFIRMATIONS,
  MAPPING_LIFECYCLES,
  MAX_ITEM_ATTEMPTS,
  DELETION_GUIDANCE,
  DELETIONS_MEANING,
  FAILURE_GUIDANCE,
  decisionSucceeded,
  mayOfferApply,
  type DecisionOutcome,
  type ItemDeletion,
} from './index';

function deletion(over: Partial<ItemDeletion> = {}): ItemDeletion {
  return {
    domain: 'email',
    naturalKeyHash: 'a'.repeat(64),
    collection: 'INBOX',
    absentPasses: 0,
    confirmed: true,
    evidence: 'reported',
    ...over,
  };
}

describe('mayOfferApply', () => {
  it('offers apply for positive evidence that is confirmed', () => {
    expect(mayOfferApply(deletion({ evidence: 'reported' }))).toBe(true);
    expect(mayOfferApply(deletion({ evidence: 'trashed' }))).toBe(true);
  });

  it('never offers apply for inferred evidence, however many passes it repeats', () => {
    // The count is deliberately far past DELETION_CONFIRMATIONS: an inferred
    // deletion becomes CONFIRMED (worth telling somebody about) but never
    // becomes APPLICABLE. Those are two different thresholds and conflating
    // them is the mistake this test exists to catch.
    const stubborn = deletion({
      evidence: 'inferred',
      confirmed: true,
      absentPasses: DELETION_CONFIRMATIONS * 50,
    });
    expect(stubborn.confirmed).toBe(true);
    expect(mayOfferApply(stubborn)).toBe(false);
  });

  it('does not offer apply for an unconfirmed item even with positive evidence', () => {
    expect(mayOfferApply(deletion({ evidence: 'reported', confirmed: false }))).toBe(false);
  });
});

describe('decisionSucceeded', () => {
  it('narrows an accepted decision', () => {
    const outcome: DecisionOutcome = {
      status: 'ok',
      action: 'apply',
      naturalKeyHash: 'b'.repeat(64),
      effect: 'Removed from the target.',
      kind: 'binned',
    };
    expect(decisionSucceeded(outcome)).toBe(true);
    if (decisionSucceeded(outcome)) expect(outcome.kind).toBe('binned');
  });

  it('treats a refusal as a failure', () => {
    // A refusal carries no `status`, so anything checking truthiness of a field
    // that is absent must not read it as success.
    expect(decisionSucceeded({ error: 'not_enabled', reason: 'apply is off' })).toBe(false);
  });
});

describe('the shared prose', () => {
  it('states the constants it quotes, so the text cannot drift from the behaviour', () => {
    expect(FAILURE_GUIDANCE.doNothing).toContain(String(MAX_ITEM_ATTEMPTS));
    expect(DELETIONS_MEANING).toContain(String(DELETION_CONFIRMATIONS));
  });

  it('warns that apply is destructive wherever it is shown', () => {
    expect(DELETION_GUIDANCE.apply).toContain('THE ONLY DESTRUCTIVE ACTION');
  });
});

describe('MAPPING_LIFECYCLES', () => {
  it('matches the baseline migration CHECK constraint', () => {
    // mailbox_mapping_status_check in packages/ledger/migrations/0001_baseline.sql.
    expect([...MAPPING_LIFECYCLES].sort()).toEqual(['active', 'cutover', 'done', 'paused']);
  });
});
