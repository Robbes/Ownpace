// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The mapping half of a rollback, decided once (ADR-0047).
 *
 * For a month the product had two rollbacks: a CLI that wrote the cutover
 * ledger and left `mailbox_mapping` alone, and a job nobody called that set it
 * back to `active`. The owner's definition — *a setback: back to syncing, with
 * the original source live again* — makes the mapping half load-bearing, so
 * the decision lives in `shared` beside `startTransition` and
 * `finishTransition`, where both editions read it, and this file pins every
 * row of its table against the lifecycle list rather than a hand-typed subset.
 */

import { describe, it, expect } from 'vitest';
import { MAPPING_LIFECYCLES } from './operating-contract.ts';
import { isAfterCutover, rollbackTransition, runsPasses } from './lifecycle.ts';

describe('rollbackTransition', () => {
  it('answers every lifecycle the database can hold, and nothing else silently', () => {
    // No state may fall through to the default: that branch is for a value the
    // CHECK constraint should have refused, and a real lifecycle landing there
    // would be reported as "not a lifecycle this product knows".
    for (const status of MAPPING_LIFECYCLES) {
      const t = rollbackTransition(status);
      if ('refuse' in t) {
        expect(t.refuse, status).not.toContain('not a mapping lifecycle');
      }
    }
    expect(rollbackTransition('ready')).toMatchObject({ refuse: expect.stringContaining("'ready'") });
  });

  it("puts a mapping stopped for the cutover back to 'active'", () => {
    expect(rollbackTransition('cutover')).toEqual({ reactivate: true, from: 'cutover', to: 'active' });
  });

  it("ends the continuous lane too: 'active' is the state where the source is the authority again", () => {
    // `continuous` runs passes but is after cutover, so the deletion detector
    // is absent (0117 D4). A rollback makes the source authoritative again,
    // which is exactly what `active` and only `active` claims among the
    // states that run — so the transition has to land there, not stay put.
    const t = rollbackTransition('continuous');
    expect(t).toEqual({ reactivate: true, from: 'continuous', to: 'active' });
    if ('reactivate' in t && t.reactivate) {
      expect(runsPasses(t.to)).toBe(true);
      expect(isAfterCutover(t.to)).toBe(false);
    }
  });

  it("leaves an 'active' mapping alone and says why — a cutover from before ADR-0048 never stopped it", () => {
    const t = rollbackTransition('active');
    expect(t).toMatchObject({ reactivate: false, from: 'active' });
    if ('reason' in t) expect(t.reason).toContain('already syncing');
  });

  it("leaves a 'paused' mapping paused: a rollback does not start what somebody stopped", () => {
    const t = rollbackTransition('paused');
    expect(t).toMatchObject({ reactivate: false, from: 'paused' });
    if ('reason' in t) expect(t.reason).toContain('paused');
  });

  it("refuses a 'done' mapping, with the way out named — finishing is not undone by a rollback", () => {
    const t = rollbackTransition('done');
    expect('refuse' in t).toBe(true);
    if ('refuse' in t) {
      expect(t.refuse).toContain('finished');
      expect(t.hint).toContain('Nothing was changed');
      expect(t.hint).toContain('MX');
    }
  });

  it('never reactivates to anything but active, and never into an after-cutover state', () => {
    for (const status of MAPPING_LIFECYCLES) {
      const t = rollbackTransition(status);
      if ('reactivate' in t && t.reactivate) {
        expect(t.to).toBe('active');
        expect(isAfterCutover(t.to)).toBe(false);
      }
    }
  });
});
