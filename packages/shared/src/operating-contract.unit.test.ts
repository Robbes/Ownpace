// Copyright 2026 The Ownpace authors (Apache-2.0)

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
  MOVE_GUIDANCE,
  DELETIONS_MEANING,
  FAILURE_GUIDANCE,
  decisionSucceeded,
  earlierExportsQueue,
  mayOfferApply,
  type DecisionOutcome,
  type EarlierExport,
  type ItemDeletion,
} from './index.ts';

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

describe('earlierExportsQueue (0042 T8 (b))', () => {
  const earlier = (naturalKeyHash: string, acknowledgedAt?: string): EarlierExport => ({
    domain: 'file',
    naturalKeyHash,
    collection: 'Reports',
    exportedAs: `${naturalKeyHash}-now`,
    ...(acknowledgedAt ? { acknowledgedAt } : {}),
  });

  it('splits them the one way both editions do: waiting for the owner, and kept', () => {
    const open = earlier('open');
    const kept = earlier('kept', '2026-09-23T12:00:00Z');
    expect(earlierExportsQueue([open, kept])).toEqual({ waiting: [open], kept: [kept] });
    expect(earlierExportsQueue([])).toEqual({ waiting: [], kept: [] });
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

  it('never sends a managed customer to do by hand what the Apply beside it does', () => {
    // Managed has served the move apply route since 2026-08-16 (0042 T2) and
    // the Moves screen offers the button in both editions. The guidance under
    // it still said the route was the appliance's, and to remove the old copy
    // in the target system instead.
    expect(MOVE_GUIDANCE.apply).not.toMatch(/appliance only|does not serve/i);
    expect(MOVE_GUIDANCE.apply).toContain('REMOVES');
  });

  it('says what Apply does, and nothing about which edition has it', () => {
    // The owner, 2026-09-23: "Why would a user care? They just want to use the
    // move function or check what it is." Both editions have it, so naming
    // them tells the reader nothing about the button in front of them.
    for (const text of Object.values(MOVE_GUIDANCE)) {
      expect(text).not.toMatch(/edition|appliance|managed/i);
    }
    // What it does instead: how the result reads, every way it can end.
    expect(MOVE_GUIDANCE.apply).toMatch(/removed, refused with the reason, or failed with the error/);
  });
});

describe('MAPPING_LIFECYCLES', () => {
  it('matches the migration chain CHECK constraint', () => {
    // mailbox_mapping_status_check — four states in
    // packages/ledger/migrations/0001_baseline.sql, widened to five by
    // 0044_a_lane_that_does_not_end.sql (workplan 0117 T1).
    expect([...MAPPING_LIFECYCLES].sort()).toEqual([
      'active',
      'continuous',
      'cutover',
      'done',
      'paused',
    ]);
  });
});
