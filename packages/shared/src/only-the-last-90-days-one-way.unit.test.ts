// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONLY THE LAST 90 DAYS, ONE WAY (workplan 0170 §5.3, the owner's D2), and NOT
 * SWITCHED OVER UNTIL BROADENED (D8, the owner: *"no, not before"*).
 *
 * Broadening, from the last 90 days to everything, is allowed at any time and
 * says what follows. Narrowing, from everything to the last 90 days, is
 * refused always, before and after a copy, and on the appliance's boot by the
 * same table. And a 90-day migration is refused the cutover and the lane, by
 * one rule every door asks.
 */

import { describe, it, expect } from 'vitest';
import {
  RECENT_ONLY_SNAPSHOT,
  compareRevision,
  mayRevise,
  refusalsFor,
  revisionSnapshotOf,
} from './config-revision.ts';
import {
  A_RECENT_ONLY_MIGRATION_IS_NOT_SWITCHED_OVER,
  A_RECENT_ONLY_MIGRATION_SWITCHES_OVER,
  recentOnlyIsSwitchedOver,
  updateTransition,
} from './lifecycle.ts';

const config = (recentOnly?: { days: number; anchor?: string }) => ({
  source: { type: 'gmail' },
  target: { type: 'jmap', user: 'a@example.org' },
  ...(recentOnly ? { recentOnly } : {}),
});

describe('broadening is allowed, at any time, and says what follows', () => {
  it('from the last 90 days to everything', () => {
    for (const copiedAnything of [true, false, undefined]) {
      const verdict = mayRevise('recentOnly', {
        recentOnly: 'broadening',
        ...(copiedAnything === undefined ? {} : { copiedAnything }),
      });
      expect(verdict).toEqual({
        allowed: true,
        consequence: 'The older items are copied next; what is already there stays.',
      });
    }
  });
});

describe('narrowing is refused, always', () => {
  it('before anything was copied and after, and when the caller cannot say which way', () => {
    for (const facts of [
      { recentOnly: 'narrowing' as const, copiedAnything: false },
      { recentOnly: 'narrowing' as const, copiedAnything: true },
      {},
    ]) {
      const verdict = mayRevise('recentOnly', facts);
      expect(verdict.allowed).toBe(false);
      expect(verdict.allowed ? '' : verdict.reason).toMatch(/start a new migration/i);
    }
    expect(refusalsFor(['recentOnly'], { recentOnly: 'narrowing' })).toHaveLength(1);
  });
});

describe('on the appliance, by the same table, from what the file says', () => {
  it('records the 90-day choice, and never its anchor, so writing the anchor is not a change', () => {
    expect(revisionSnapshotOf(config({ days: 90 })).recentOnly).toBe(RECENT_ONLY_SNAPSHOT);
    expect(revisionSnapshotOf(config({ days: 90, anchor: '2026-11-24T10:00:00.000Z' }))).toEqual(
      revisionSnapshotOf(config({ days: 90 })),
    );
    expect('recentOnly' in revisionSnapshotOf(config())).toBe(false);
  });

  it('allows the key taken out of the file, which broadens', () => {
    const verdict = compareRevision(revisionSnapshotOf(config({ days: 90 })), revisionSnapshotOf(config()));
    expect(verdict.changed).toEqual(['recentOnly']);
    expect(verdict.refusals).toEqual([]);
  });

  it('refuses the key added to a migration that had none, naming both values', () => {
    const verdict = compareRevision(revisionSnapshotOf(config()), revisionSnapshotOf(config({ days: 90 })));
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.refusals[0]).toMatchObject({ field: 'recentOnly', from: '(not set)', to: RECENT_ONLY_SNAPSHOT });
  });

  it('refuses nothing on a first record, a new 90-day migration among them', () => {
    expect(compareRevision(undefined, revisionSnapshotOf(config({ days: 90 }))).refusals).toEqual([]);
  });

  it('reads a snapshot stored before this field existed as a migration of everything', () => {
    const before = { 'source.type': 'gmail', 'target.type': 'jmap', 'target.account': 'a@example.org' };
    const now = revisionSnapshotOf(config());
    expect(compareRevision({ ...before, 'source.nativeFilePolicy': now['source.nativeFilePolicy']! }, now).changed).toEqual([]);
  });
});

describe('D8: a 90-day migration is not switched over until it is broadened', () => {
  it('is one rule, and it refuses', () => {
    expect(A_RECENT_ONLY_MIGRATION_SWITCHES_OVER).toBe(false);
    expect(recentOnlyIsSwitchedOver(true)).toBe(false);
    expect(recentOnlyIsSwitchedOver(false)).toBe(true);
  });

  it('refuses the cutover declared by an update, in both languages', () => {
    for (const from of ['active', 'paused']) {
      const t = updateTransition(from, 'cutover', undefined, true);
      expect(t).toMatchObject({
        code: 'recent_only',
        refuse: A_RECENT_ONLY_MIGRATION_IS_NOT_SWITCHED_OVER.en,
        refuseNl: A_RECENT_ONLY_MIGRATION_IS_NOT_SWITCHED_OVER.nl,
      });
    }
  });

  it('leaves a migration of everything, and pausing a 90-day one, as they were', () => {
    expect(updateTransition('active', 'cutover')).toEqual({ apply: true, from: 'active', to: 'cutover' });
    expect(updateTransition('active', 'cutover', undefined, false)).toEqual({ apply: true, from: 'active', to: 'cutover' });
    expect(updateTransition('active', 'paused', undefined, true)).toEqual({ apply: true, from: 'active', to: 'paused' });
  });

  it('names the press that comes first', () => {
    expect(A_RECENT_ONLY_MIGRATION_IS_NOT_SWITCHED_OVER.en).toMatch(/Copy everything/);
    expect(A_RECENT_ONLY_MIGRATION_IS_NOT_SWITCHED_OVER.nl).toMatch(/Alles kopiëren/);
  });
});
