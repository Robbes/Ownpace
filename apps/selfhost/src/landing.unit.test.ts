// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE THE APPLIANCE LANDS (workplan 0153 T8; the owner, 2026-10-03: started
 * means *"was ever started"*). Review & confirm until every configured
 * migration has been started, and its one person's page from then on. The
 * wiring, on a real appliance, is `pglite-startup.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { everStarted, landingPath, type LandingFacts } from './landing.ts';

const neverStarted: LandingFacts = { status: 'paused', hasPaths: false };
const running: LandingFacts = { status: 'active', hasPaths: true };
const pausedSince: LandingFacts = { status: 'paused', hasPaths: true };

describe('where the appliance lands', () => {
  it('is Review & confirm with nothing configured, or while a migration was never started', () => {
    expect(landingPath([])).toBe('/confirm');
    expect(landingPath([neverStarted])).toBe('/confirm');
    expect(landingPath([running, neverStarted])).toBe('/confirm');
  });

  it("is its one person's page once every migration has been started", () => {
    expect(landingPath([running])).toBe('/people/implicit');
    expect(
      landingPath([
        running,
        { status: 'continuous', hasPaths: true },
        { status: 'cutover', hasPaths: true },
        { status: 'done', hasPaths: true },
      ]),
    ).toBe('/people/implicit');
  });

  it("stays the person's page when a migration started before is paused now: it was ever started", () => {
    expect(everStarted(pausedSince)).toBe(true);
    expect(landingPath([running, pausedSince])).toBe('/people/implicit');
    expect(landingPath([pausedSince])).toBe('/people/implicit');
  });

  it('goes back to Review & confirm when a migration is added and not started yet', () => {
    expect(landingPath([running, pausedSince, neverStarted])).toBe('/confirm');
  });

  it('counts a migration that is not paused as started, paths or not', () => {
    // A row from before paths were written: its status says it ran.
    expect(everStarted({ status: 'active', hasPaths: false })).toBe(true);
    expect(everStarted(neverStarted)).toBe(false);
  });
});
