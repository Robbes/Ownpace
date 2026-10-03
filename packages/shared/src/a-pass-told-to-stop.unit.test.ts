// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHY A PASS STOPS, DECIDED ONCE FOR BOTH EDITIONS (2026-09-29).
 *
 * A pause pressed during a pass waited for that pass's own deadline, up to
 * fifty minutes, because the loop that copies had no way to hear it: the
 * managed pass asked "should I stop?" only between data types, and the
 * appliance never asked at all once a firing had begun. The loop is now handed
 * that question and asks it from inside a data type (`PassClock.whyItStops`).
 *
 * Both dispatchers answer it, and they must answer it alike, so the decision
 * moved here from the managed worker, where the appliance could not import it:
 * `haltFrom`, `stepFrom`, and `stopReasonOf`, which turns a step into the one
 * answer the loop needs. These hold the decision, the words each answer is
 * said in, and the interval the question is asked at.
 */

import { describe, it, expect } from 'vitest';
import { runsPassesNow } from './lifecycle.ts';
import { haltFrom, stepFrom, stopReasonOf, type PassPhases, type PathPhase, type PassStopReason } from './path-phase.ts';
import {
  HALT_IN_WORDS,
  PASS_HARD_LIMIT_MS,
  PASS_REREAD_EVERY_MS,
  PASS_SOFT_DEADLINE_MS,
} from './pass-deadline.ts';

/** A migration in `status`, whose data types are in the phases given, and in its own otherwise. */
function migration(
  status: string,
  paths: Partial<Record<string, PathPhase>> = {},
  grantWithdrawnAt: Date | null = null,
): NonNullable<PassPhases> {
  const own: PathPhase = { phase: status, stillCopies: false };
  return {
    grantWithdrawnAt,
    phaseOf: (d) => paths[d] ?? own,
    anyRuns: runsPassesNow(status, false),
  };
}

/** Every answer the question can give, written out so a sixth is a decision. */
const EVERY_REASON: readonly PassStopReason[] = [
  'no_longer_runs',
  'grant_withdrawn',
  'organisation_closed',
  'stopped_by_its_owner',
  'data_type_no_longer_runs',
];

describe('the decision, where both editions can reach it', () => {
  it('stops for a migration that is gone, no longer runs, or whose grant was taken back', () => {
    expect(haltFrom(null)).toBe('no_longer_runs');
    expect(haltFrom(migration('paused'))).toBe('no_longer_runs');
    expect(haltFrom(migration('active', {}, new Date()))).toBe('grant_withdrawn');
    expect(haltFrom(migration('active'))).toBeNull();
  });

  it('moves past one data type while the migration runs, and says whether its owner stopped it', () => {
    const mailStopped = migration('active', { email: { phase: 'active', stillCopies: false, stopped: true } });
    expect(stepFrom(mailStopped, 'email')).toEqual({ skip: 'stopped_by_its_owner' });
    expect(stepFrom(mailStopped, 'file')).toEqual({ run: true });
    const mailEnded = migration('active', { email: { phase: 'cutover', stillCopies: false } });
    expect(stepFrom(mailEnded, 'email')).toEqual({ skip: 'data_type_no_longer_runs' });
  });

  it('turns a step into the one answer the loop needs: why it stops, or null', () => {
    expect(stopReasonOf({ run: true })).toBeNull();
    expect(stopReasonOf({ skip: 'stopped_by_its_owner' })).toBe('stopped_by_its_owner');
    expect(stopReasonOf({ halt: 'organisation_closed' })).toBe('organisation_closed');
    // Through the decision, for every answer it can give.
    expect(stopReasonOf(stepFrom(migration('active'), 'file'))).toBeNull();
    expect(stopReasonOf(stepFrom(migration('paused'), 'file'))).toBe('no_longer_runs');
    expect(stopReasonOf(stepFrom(migration('active', {}, new Date()), 'file'))).toBe('grant_withdrawn');
  });
});

describe('the words each answer is said in', () => {
  it('has a sentence for every reason, and no sentence for anything else', () => {
    expect(Object.keys(HALT_IN_WORDS).sort()).toEqual([...EVERY_REASON].sort());
    for (const reason of EVERY_REASON) expect(HALT_IN_WORDS[reason].length, reason).toBeGreaterThan(10);
    expect(new Set(Object.values(HALT_IN_WORDS)).size).toBe(EVERY_REASON.length);
  });

  it('never words a stop as a clock or a meter running out', () => {
    // The pass's log has a sentence for its deadline and one for the day's
    // download budget; a reader must be able to tell "you paused it" from both.
    for (const reason of EVERY_REASON) {
      expect(HALT_IN_WORDS[reason], reason).not.toMatch(/deadline|budget/i);
    }
  });
});

describe('how often a running pass asks', () => {
  it('often enough that a pause is heard in seconds, not minutes', () => {
    expect(PASS_REREAD_EVERY_MS).toBeGreaterThanOrEqual(5_000);
    expect(PASS_REREAD_EVERY_MS).toBeLessThanOrEqual(15_000);
  });

  it('far inside the margin the deadline keeps before the runner kills the pass', () => {
    // A question asked less often than that margin would be no better than
    // the deadline it is meant to beat.
    expect(PASS_REREAD_EVERY_MS * 20).toBeLessThan(PASS_HARD_LIMIT_MS - PASS_SOFT_DEADLINE_MS);
  });
});
