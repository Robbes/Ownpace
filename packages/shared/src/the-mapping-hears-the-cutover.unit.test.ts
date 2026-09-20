// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The mapping half of a cutover, decided once (ADR-0048).
 *
 * Until 2026-09-19 the CLI's `execute` moved the cutover ledger and left
 * `mailbox_mapping.status` where it was, so a CLI-driven cutover ran with the
 * mapping `active`: passes scheduled, deletion detectors present, a source
 * that had just stopped being the authority (0117 D4) still being mirrored.
 * The decision lives in `shared` beside `rollbackTransition`, because the two
 * are halves of one thing — what a cutover stops, a rollback resumes — and
 * this file pins that they agree, row by row, against the lifecycle list.
 */

import { describe, it, expect } from 'vitest';
import { MAPPING_LIFECYCLES } from './operating-contract.ts';
import { cutoverTransition, isAfterCutover, rollbackTransition, runsPasses } from './lifecycle.ts';

describe('cutoverTransition', () => {
  it('answers every lifecycle the database can hold, and refuses only what it does not know', () => {
    for (const status of MAPPING_LIFECYCLES) {
      expect('refuse' in cutoverTransition(status), status).toBe(false);
    }
    expect(cutoverTransition('ready')).toMatchObject({ refuse: expect.stringContaining("'ready'") });
  });

  it("stops an 'active' mapping: the shadow sync ends and the source stops being the authority", () => {
    const t = cutoverTransition('active');
    expect(t).toEqual({ stop: true, from: 'active', to: 'cutover' });
    if ('stop' in t && t.stop) {
      expect(runsPasses(t.to)).toBe(false);
      expect(isAfterCutover(t.to)).toBe(true);
    }
  });

  it("stops a 'paused' mapping too: after the cutover, Start must not be able to resume it", () => {
    // `paused` is a before-cutover state that Start turns back into `active`
    // — a pass with the detectors present. Once the MX record has moved that
    // pass reads a source that is no longer the authority, so the phase, not
    // the pause, has to be what the row says.
    expect(cutoverTransition('paused')).toEqual({ stop: true, from: 'paused', to: 'cutover' });
  });

  it("leaves 'cutover' alone: a second run, or the Finish page's own declaration, converges", () => {
    const t = cutoverTransition('cutover');
    expect(t).toMatchObject({ stop: false, from: 'cutover' });
    if ('reason' in t) expect(t.reason).toContain('already stopped');
  });

  it("leaves 'continuous' alone: the lane keeps copying after cutover by design", () => {
    const t = cutoverTransition('continuous');
    expect(t).toMatchObject({ stop: false, from: 'continuous' });
    if ('reason' in t) expect(t.reason).toContain('by design');
    // And it is already after cutover — nothing about D4 is left to establish.
    expect(isAfterCutover('continuous')).toBe(true);
  });

  it("leaves 'done' alone but WARNS that a rollback will be refused later", () => {
    const t = cutoverTransition('done');
    expect(t).toMatchObject({ stop: false, from: 'done' });
    if ('warning' in t) {
      expect(t.warning).toContain('rollback');
      expect(t.warning).toContain('MX');
    } else {
      throw new Error("'done' must carry the rollback warning");
    }
    // The warning is TRUE: the rollback decision refuses it.
    expect('refuse' in rollbackTransition('done')).toBe(true);
  });

  it('only ever stops INTO an after-cutover state that runs no passes', () => {
    for (const status of MAPPING_LIFECYCLES) {
      const t = cutoverTransition(status);
      if ('stop' in t && t.stop) {
        expect(isAfterCutover(t.to), status).toBe(true);
        expect(runsPasses(t.to), status).toBe(false);
      }
    }
  });

  it('is the other half of the rollback: whatever a cutover stops, a rollback resumes', () => {
    // The round trip that never existed on the CLI: execute stopped nothing,
    // so rollback resumed nothing. Now every state a cutover moves lands
    // where the rollback takes it back to `active`.
    for (const status of MAPPING_LIFECYCLES) {
      const stopped = cutoverTransition(status);
      if ('stop' in stopped && stopped.stop) {
        const back = rollbackTransition(stopped.to);
        expect(back, `${status} -> ${stopped.to} -> ?`).toEqual({
          reactivate: true,
          from: stopped.to,
          to: 'active',
        });
      }
    }
  });

  it('never leaves a state alone that a rollback would then try to resume from before-cutover', () => {
    // A state left alone by a cutover is either after cutover already, or
    // one the rollback also leaves alone. Otherwise a cutover-then-rollback
    // would "resume" a sync the cutover never stopped.
    for (const status of MAPPING_LIFECYCLES) {
      const t = cutoverTransition(status);
      if ('stop' in t && !t.stop) {
        const back = rollbackTransition(status);
        const rollbackResumes = 'reactivate' in back && back.reactivate;
        expect(isAfterCutover(status) || !rollbackResumes, status).toBe(true);
      }
    }
  });
});
