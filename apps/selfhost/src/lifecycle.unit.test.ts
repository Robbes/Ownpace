// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import { startTransition, finishTransition } from './lifecycle';

describe('startTransition', () => {
  it('activates a paused (draft) mapping', () => {
    expect(startTransition('paused')).toEqual({ activate: true });
  });

  it('is idempotent for a mapping already active (no re-activation)', () => {
    expect(startTransition('active')).toEqual({ activate: false });
  });

  it('refuses a mapping already in cutover', () => {
    const result = startTransition('cutover');
    expect(result).toHaveProperty('conflict');
    expect((result as { conflict: string }).conflict).toMatch(/cutover/i);
  });

  it('refuses a mapping already done', () => {
    const result = startTransition('done');
    expect(result).toHaveProperty('conflict');
    expect((result as { conflict: string }).conflict).toMatch(/done/i);
  });
});

describe('finishTransition', () => {
  it('finishes an active mapping with nothing outstanding', () => {
    expect(finishTransition('active', 0)).toEqual({ finish: true });
  });

  it('finishes from cutover too — that is the normal end of the flow', () => {
    expect(finishTransition('cutover', 0)).toEqual({ finish: true });
  });

  it('is idempotent, and says so rather than pretending it did work', () => {
    expect(finishTransition('done', 0)).toEqual({ finish: false, alreadyDone: true });
  });

  it('refuses a mapping that was never started', () => {
    // Nothing to finish, and answering "ok" would imply a migration happened.
    const result = finishTransition('paused', 0);
    expect(result).toHaveProperty('refuse');
    expect((result as { refuse: string }).refuse).toMatch(/never started/i);
  });

  it('refuses while items are still awaiting a decision, and names the count', () => {
    // Finishing over unresolved failures silently turns "still working on it"
    // into "this is what you got" — the quiet data loss §11.2 exists to prevent.
    const result = finishTransition('active', 3);
    expect(result).toHaveProperty('refuse');
    expect((result as { refuse: string }).refuse).toContain('3');
    // Surface-neutral since 0038 T7 (the old hint spoke curl to UI
    // operators); the STABLE part of the contract is the code, which is
    // what a UI keys the force affordance on.
    expect((result as { hint: string }).hint).toMatch(/leaves them unmigrated, knowingly/);
    expect((result as { code: string }).code).toBe('unresolved_failures');
  });

  it('lets the operator force past unresolved failures once told', () => {
    expect(finishTransition('active', 3, true)).toEqual({ finish: true });
  });

  it('still refuses a never-started mapping even with force', () => {
    // `force` is about knowingly leaving items behind, not about skipping the
    // question of whether there is a migration to finish at all.
    expect(finishTransition('paused', 0, true)).toHaveProperty('refuse');
  });
});
