// Copyright 2026 The Ownpace authors (Apache-2.0)
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
} from './provider-setup.ts';
import type { ProviderClientFacts } from './provider-clients.ts';

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

/**
 * NO STEP THAT CREATES AN APP WHERE THE DEPLOYMENT CARRIES ONE (workplan 0148
 * T2 (b), owner decision D2: "Stop the false hints on managed").
 *
 * The facts are `providerClientFacts()`'s, passed by the managed route; the
 * appliance's route passes none and keeps every step. What is asserted is the
 * filter, not the edition: the same call with Google's fact `connection`
 * keeps Google's steps.
 */
describe('the own-app steps, against what the deployment carries (0148 T2 (b))', () => {
  const facts = (over: Partial<ProviderClientFacts>): ProviderClientFacts => ({
    google: 'connection',
    dropbox: 'connection',
    microsoft: 'connection',
    ...over,
  });

  it("leaves out every Google step where the deployment carries Google's app", () => {
    for (const type of ['google-drive', 'gmail', 'google-calendar', 'google-contacts', 'google']) {
      expect(setupStepsFor('source', type, facts({ google: 'deployment' })), type).toEqual([]);
    }
  });

  it('without facts the list is unchanged — the appliance keeps every step', () => {
    const drive = setupStepsFor('source', 'google-drive');
    expect(drive.map((s) => s.key)).toEqual(['create_oauth_client', 'enable_api', 'consent_scope']);
    expect(setupStepsFor('source', 'google-drive', facts({}))).toEqual(drive);
    // Another provider's app changes nothing about Google's steps.
    expect(setupStepsFor('source', 'google-drive', facts({ dropbox: 'deployment' }))).toEqual(drive);
  });

  it('gives the Google account card the same profile as the four products', () => {
    expect(setupStepsFor('source', 'google')).toBe(setupStepsFor('source', 'google-drive'));
  });

  it("pins Dropbox's keys: the consent and exchange are the button's now, the address is the person's", () => {
    // `consent` and `exchange_code` left the file: Connect with Dropbox does
    // both. Their ledger rows are left behind harmlessly (see the header).
    expect(setupStepsFor('source', 'dropbox').map((s) => s.key)).toEqual([
      'create_app',
      'scopes',
      'redirect_uri',
    ]);
    expect(setupStepsFor('source', 'dropbox', facts({ dropbox: 'deployment' }))).toEqual([]);
  });

  it('marks exactly the own-app steps, and no step of a provider without an app', () => {
    for (const step of setupStepsFor('source', 'google-drive')) {
      expect(step.ownAppOnly, step.key).toBe('google');
    }
    for (const step of setupStepsFor('source', 'dropbox')) {
      expect(step.ownAppOnly, step.key).toBe('dropbox');
    }
    for (const step of setupStepsFor('source', 'box')) {
      expect(step.ownAppOnly, `box has no deployment app: ${step.key}`).toBeUndefined();
    }
    expect(setupStepsFor('source', 'box', facts({ google: 'deployment', dropbox: 'deployment' })))
      .toHaveLength(4);
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
