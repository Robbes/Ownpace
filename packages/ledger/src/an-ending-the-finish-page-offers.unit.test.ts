// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ENDING THE FINISH PAGE OFFERS IS THE ENDING THE DOOR ACCEPTS (workplan
 * 0128 T3, T5 slice 7b).
 *
 * The Finish page shows an End and a Keep copying beside each data type, and
 * the door decides whether a press is accepted. Both ask one rule,
 * `decidePathEnding`, over the same facts (`readPathStopFacts`): the page is
 * offered what `pathEndingChoices` makes of them, with each data type's phase
 * as the reader believes it. The door itself is pinned on PGlite in
 * `an-ending-per-data-type.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { PathStopFacts } from './a-stop-per-data-type.ts';
import { pathEndingChoices } from './an-ending-per-data-type.ts';

const facts = (status: string, carried: PathStopFacts['carried']): PathStopFacts => ({ status, carried });

describe('each data type, as the Finish page offers it', () => {
  it('before its cutover and in it: End and Keep copying', () => {
    expect(
      pathEndingChoices(
        facts('active', [
          { domain: 'email', phase: 'active', stopped: false },
          { domain: 'calendar', phase: 'cutover', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', phase: 'active', stopped: false, offers: ['end', 'keep'] },
      { domain: 'calendar', phase: 'cutover', stopped: false, offers: ['end', 'keep'] },
    ]);
  });

  it('ended, it can be kept copying again; kept, it can be ended', () => {
    expect(
      pathEndingChoices(
        facts('continuous', [
          { domain: 'email', phase: 'done', stopped: false },
          { domain: 'file', phase: 'continuous', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', phase: 'done', stopped: false, offers: ['keep'] },
      { domain: 'file', phase: 'continuous', stopped: false, offers: ['end'] },
    ]);
  });

  it('stopped by its owner, it can be ended, and kept only once resumed', () => {
    expect(
      pathEndingChoices(
        facts('active', [
          { domain: 'email', phase: 'active', stopped: true },
          { domain: 'calendar', phase: 'active', stopped: false },
        ]),
      )[0],
    ).toEqual({ domain: 'email', phase: 'active', stopped: true, offers: ['end'] });
  });

  it('offers nothing while the migration is paused or never started', () => {
    expect(pathEndingChoices(facts('paused', [{ domain: 'email', phase: 'paused', stopped: false }]))).toEqual([]);
  });

  it('reads a data type with no row, and rows that do not add up to the status, as the status', () => {
    expect(pathEndingChoices(facts('cutover', [{ domain: 'email', stopped: false }]))).toEqual([
      { domain: 'email', phase: 'cutover', stopped: false, offers: ['end', 'keep'] },
    ]);
    // Resumed by hand after its finish: the status says `active`, the rows still `done`.
    expect(
      pathEndingChoices(
        facts('active', [
          { domain: 'email', phase: 'done', stopped: false },
          { domain: 'file', phase: 'done', stopped: false },
        ]),
      ),
    ).toEqual([
      { domain: 'email', phase: 'active', stopped: false, offers: ['end', 'keep'] },
      { domain: 'file', phase: 'active', stopped: false, offers: ['end', 'keep'] },
    ]);
  });

  it('offers nothing for one that never ran: it starts with its migration', () => {
    expect(
      pathEndingChoices(
        facts('active', [
          { domain: 'email', phase: 'active', stopped: false },
          { domain: 'file', phase: 'ready', stopped: false },
        ]),
      )[1],
    ).toEqual({ domain: 'file', phase: 'ready', stopped: false, offers: [] });
  });
});
