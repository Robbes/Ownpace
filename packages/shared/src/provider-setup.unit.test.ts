// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The provider setup checklist's definitions (workplan 0061). What these hold:
 *
 *  1. Step KEYS are identities stored in the ledger — a rename silently
 *     orphans every tick a customer has made, so they are pinned here.
 *  2. "Nothing to set up" is a real answer, distinct from a missing provider.
 *  3. `complete` counts a SKIPPED step as settled, or a checklist whose every
 *     row is answered would read as unfinished forever.
 *  4. `blockedOnOthers` counts only OPEN admin steps — that is the number that
 *     answers "why is this stuck?", and a done one does not block anything.
 */

import { describe, it, expect } from 'vitest';
import {
  providersWithSetup,
  setupStepsFor,
  summariseSetup,
  type SetupStepStatus,
} from './provider-setup';

const status = (
  key: string,
  state: 'open' | 'done' | 'skipped',
  needsAnotherPerson = false,
): SetupStepStatus => ({
  step: { key, titleKey: `t.${key}`, detailKey: `d.${key}`, needsAnotherPerson },
  state,
});

describe('the step definitions', () => {
  it('pins the stored KEYS for Box — renaming one orphans a customer\'s ticks', () => {
    expect(setupStepsFor('source', 'box').map((s) => s.key)).toEqual([
      'create_app',
      'configure_access',
      'admin_authorize',
      'subject_user_id',
    ]);
  });

  it('marks the steps that need somebody else, which is why a setup stalls', () => {
    const box = setupStepsFor('source', 'box');
    expect(box.find((s) => s.key === 'admin_authorize')?.needsAnotherPerson).toBe(true);
    expect(box.find((s) => s.key === 'create_app')?.needsAnotherPerson).toBeUndefined();
  });

  it('gives the four Google sources ONE flow — they share an OAuth client', () => {
    const drive = setupStepsFor('source', 'google-drive');
    for (const type of ['gmail', 'google-calendar', 'google-contacts']) {
      expect(setupStepsFor('source', type)).toBe(drive);
    }
  });

  it('answers an empty list for a provider with no prerequisites — a real answer', () => {
    expect(setupStepsFor('source', 'not-a-provider')).toEqual([]);
    // ...and the side matters: a target webdav has steps, a source webdav does not.
    expect(setupStepsFor('target', 'webdav').length).toBeGreaterThan(0);
    expect(setupStepsFor('source', 'webdav')).toEqual([]);
  });

  it('lists the providers each side can offer', () => {
    expect(providersWithSetup('source')).toContain('box');
    expect(providersWithSetup('target')).toContain('jmap');
    expect(providersWithSetup('target')).not.toContain('box');
  });
});

describe('progress', () => {
  it('counts a SKIPPED step as settled — else an answered list never completes', () => {
    const progress = summariseSetup([status('a', 'done'), status('b', 'skipped')]);

    expect(progress).toMatchObject({ total: 2, done: 1, skipped: 1, open: 0, complete: true });
  });

  it('is not complete while anything is open', () => {
    expect(summariseSetup([status('a', 'done'), status('b', 'open')]).complete).toBe(false);
  });

  it('an empty checklist is not "complete" — there was nothing to complete', () => {
    expect(summariseSetup([]).complete).toBe(false);
  });

  it('counts only OPEN admin steps as blocked on somebody else', () => {
    const progress = summariseSetup([
      status('waiting', 'open', true),
      status('alreadyDone', 'done', true),
      status('mine', 'open'),
    ]);

    expect(progress.open).toBe(2);
    expect(progress.blockedOnOthers, 'a done admin step blocks nothing').toBe(1);
  });
});
