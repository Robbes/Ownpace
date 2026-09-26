// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SHARE WAITS FOR ITS OWN DATA TYPE'S CUTOVER (ADR-0032 §5; workplan 0128
 * T5, slice 6, the owner's D8).
 *
 * The rule on its own: which data type a share belongs to, and whether that
 * data type is at or past its cutover, read from its own phase and never from
 * the migration's alone. And the defect found on the way: the gate allowed
 * `done` only, where ADR-0032 §5 says done or cutover.
 */

import { describe, it, expect } from 'vitest';
import { dataTypeOfShare, PHASES_PAST_A_CUTOVER, shareMayBeApplied } from './share-gate.ts';
import { phasesOfTheMigration, type PathPhaseOf } from './path-phase.ts';

/** Calendars cut over on their own while the files keep running. */
const calendarsCutOver: PathPhaseOf = (domain) => ({
  phase: domain === 'calendar' ? 'cutover' : 'active',
  stillCopies: domain === 'calendar',
});

describe('which data type a share belongs to', () => {
  it('by its subject: a mailbox right is mail, a calendar share calendars, a drive item files', () => {
    expect(dataTypeOfShare('mailbox')).toBe('email');
    expect(dataTypeOfShare('calendar')).toBe('calendar');
    expect(dataTypeOfShare('drive_item')).toBe('file');
    expect(dataTypeOfShare('something_new')).toBeUndefined();
  });
});

describe('whether a share may be applied', () => {
  it('asks its own data type, not the migration: a calendar share now, a file share at the files’ cutover', () => {
    expect(shareMayBeApplied('calendar', 'active', calendarsCutOver)).toBe(true);
    expect(shareMayBeApplied('drive_item', 'active', calendarsCutOver)).toBe(false);
  });

  it('at or past its cutover: cutover (ADR-0032 §5, where the gate said done only), done and continuous', () => {
    expect([...PHASES_PAST_A_CUTOVER]).toEqual(['cutover', 'done', 'continuous']);
    for (const phase of ['cutover', 'done', 'continuous']) {
      expect(shareMayBeApplied('drive_item', phase, phasesOfTheMigration(phase)), phase).toBe(true);
    }
    for (const phase of ['ready', 'active', 'paused']) {
      expect(shareMayBeApplied('drive_item', phase, phasesOfTheMigration(phase)), phase).toBe(false);
    }
  });

  it('one it cannot place waits for the whole migration, by its status', () => {
    expect(shareMayBeApplied('something_new', 'active', calendarsCutOver)).toBe(false);
    expect(shareMayBeApplied('something_new', 'cutover', calendarsCutOver)).toBe(true);
  });
});
