// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NO APPLY BUTTON AFTER CUTOVER (2026-10-05, the owner's choice).
 *
 * The servers refuse an apply after cutover (`after_cutover`, in core's four
 * removing functions). A button that is offered and then refused every time
 * invites somebody to find out how to make it work, and there is no answer to
 * that here; the Deletions screen already shows NO destructive option rather
 * than a disabled one for an inferred deletion, for the same reason. So the
 * two gates a screen asks before it shows an Apply button, `mayOfferApply`
 * and `mayOfferRelocationApply`, are handed which data types are past their
 * cutover, and say no for those.
 *
 * The owner, 2026-10-05, asked *"should pressing Apply on a deletion or move
 * that was queued before cutover be refused?"*: **"Refuse after cutover
 * (Recommended)"**. A rollback makes the old system decide again (ADR-0047),
 * and the button comes back.
 *
 * Which data types are past their cutover is read from the phases every gate
 * reads (`dataTypesPastCutover`, from the same reading `sourceStillDecides`
 * answers from), and both editions send it with each queue (`afterCutover`).
 */

import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_DOMAINS,
  dataTypesPastCutover,
  mayOfferApply,
  mayOfferRelocationApply,
  phasesOfTheMigration,
  rollbackTransition,
  type ItemDeletion,
  type ItemMove,
  type PathPhaseOf,
} from './index.ts';

const binned = (over: Partial<ItemDeletion> = {}): ItemDeletion => ({
  domain: 'calendar',
  naturalKeyHash: 'a'.repeat(64),
  collection: 'Personal',
  absentPasses: 0,
  confirmed: true,
  evidence: 'trashed',
  ...over,
});

const renamed = (over: Partial<ItemMove> = {}): ItemMove => ({
  domain: 'file',
  naturalKeyHash: 'b'.repeat(64),
  from: '/docs',
  to: '/docs',
  toNaturalKeyHash: 'c'.repeat(64),
  ...over,
});

const reading = (phaseOf: PathPhaseOf) => ({ anyRuns: true, grantWithdrawnAt: null, phaseOf });

describe('which data types are past their cutover', () => {
  it('is every data type in cutover, done or continuous, and none while the migration copies', () => {
    for (const status of ['cutover', 'done', 'continuous']) {
      expect(dataTypesPastCutover(reading(phasesOfTheMigration(status)))).toEqual([...DISCOVERY_DOMAINS]);
    }
    for (const status of ['active', 'paused']) {
      expect(dataTypesPastCutover(reading(phasesOfTheMigration(status)))).toEqual([]);
    }
  });

  it('is each data type by its own phase, when one is cut over on its own (0128 T5)', () => {
    const filesCutOver: PathPhaseOf = (domain) =>
      domain === 'file' ? { phase: 'cutover', stillCopies: true } : { phase: 'active', stillCopies: false };
    expect(dataTypesPastCutover(reading(filesCutOver))).toEqual(['file']);
  });

  it('is every data type for a migration that is gone: its old system decides nothing', () => {
    expect(dataTypesPastCutover(null)).toEqual([...DISCOVERY_DOMAINS]);
  });
});

describe('the Apply buttons, after cutover', () => {
  it('offers no Apply for a deletion of a data type past its cutover', () => {
    expect(mayOfferApply(binned(), ['calendar'])).toBe(false);
    expect(mayOfferApply(binned({ evidence: 'reported' }), ['calendar'])).toBe(false);
  });

  it('offers no Apply for a relocation of a data type past its cutover', () => {
    expect(mayOfferRelocationApply(renamed(), ['file'])).toBe(false);
  });

  it('still offers both for a data type that has not been cut over', () => {
    expect(mayOfferApply(binned(), ['file'])).toBe(true);
    expect(mayOfferRelocationApply(renamed(), ['calendar'])).toBe(true);
    expect(mayOfferApply(binned(), [])).toBe(true);
    expect(mayOfferRelocationApply(renamed(), [])).toBe(true);
  });

  it('offers them again after a rollback, which makes the old system decide again (ADR-0047)', () => {
    const before = dataTypesPastCutover(reading(phasesOfTheMigration('continuous')));
    expect(mayOfferApply(binned(), before)).toBe(false);
    expect(mayOfferRelocationApply(renamed(), before)).toBe(false);

    const rolledBack = rollbackTransition('continuous');
    const status = 'reactivate' in rolledBack && rolledBack.reactivate ? rolledBack.to : 'continuous';
    const after = dataTypesPastCutover(reading(phasesOfTheMigration(status)));
    expect(mayOfferApply(binned(), after)).toBe(true);
    expect(mayOfferRelocationApply(renamed(), after)).toBe(true);
  });

  it('keeps every gate it had: inferred evidence and a kept move are still never offered', () => {
    expect(mayOfferApply(binned({ evidence: 'inferred' }), [])).toBe(false);
    expect(mayOfferRelocationApply(renamed({ acknowledgedAt: new Date().toISOString() }), [])).toBe(false);
  });
});
