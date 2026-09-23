// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KIND ADDED TO A RUNNING MIGRATION (workplan 0125 T6, 2026-09-23).
 *
 * The owner reconnected his Google account with Tasks ticked and his running
 * migration had no way to take them: its kinds were fixed at creation. These
 * pin the one rule both the migration page and the route read, so the page
 * never offers what the route refuses.
 */

import { describe, it, expect } from 'vitest';
import {
  KIND_AFTER_CUTOVER_REFUSAL,
  kindAdditionRefusal,
  kindChoices,
  type KindChoiceInput,
} from './kind-addition.ts';

/** A Google account migrating calendars and contacts into a Nextcloud. */
const GOOGLE_TO_NEXTCLOUD: KindChoiceInput = {
  status: 'active',
  current: ['calendar', 'contact'],
  sourceKind: 'google',
  targetKind: 'nextcloud',
};

const RESTRICTED = { GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' };

/** A stored measurement that answered `answer` for tasks. */
const measuredTasks = (answer: 'yes' | 'no' | 'unknown', detail = '') => ({
  domains: { task: { answer, detail } },
});

describe('what the migration page offers', () => {
  it('offers Tasks to a Google account migration once the account serves them', () => {
    expect(kindChoices(GOOGLE_TO_NEXTCLOUD)).toEqual([
      { domain: 'calendar', state: 'on' },
      { domain: 'contact', state: 'on' },
      { domain: 'task', state: 'addable' },
    ]);
  });

  it("follows the deployment's ceiling: files join where the restricted scopes are declared", () => {
    // Mail stays out either way: a Nextcloud target receives no mail.
    expect(kindChoices(GOOGLE_TO_NEXTCLOUD, RESTRICTED).map((c) => [c.domain, c.state])).toEqual([
      ['calendar', 'on'],
      ['contact', 'on'],
      ['file', 'addable'],
      ['task', 'addable'],
    ]);
  });

  it('lists a kind the migration already has even when the ceiling has since dropped it', () => {
    // Created on a restricted deployment, read on a default one: what it
    // copies is a fact about the migration, not about today's settings.
    const choices = kindChoices({ ...GOOGLE_TO_NEXTCLOUD, current: ['file', 'calendar'] });
    expect(choices.find((c) => c.domain === 'file')).toEqual({ domain: 'file', state: 'on' });
  });

  it('offers nothing new from a single-purpose source, which serves its one kind', () => {
    const choices = kindChoices({
      ...GOOGLE_TO_NEXTCLOUD,
      sourceKind: 'google_calendar',
      current: ['calendar'],
    });
    expect(choices).toEqual([{ domain: 'calendar', state: 'on' }]);
  });

  it('offers nothing new from a source whose ceiling nothing declares', () => {
    const choices = kindChoices({ ...GOOGLE_TO_NEXTCLOUD, sourceKind: 'imap', current: ['email'] });
    expect(choices).toEqual([{ domain: 'email', state: 'on' }]);
  });

  it('offers nothing the target cannot receive', () => {
    const choices = kindChoices({ ...GOOGLE_TO_NEXTCLOUD, targetKind: 'carddav', current: ['contact'] });
    expect(choices).toEqual([{ domain: 'contact', state: 'on' }]);
  });
});

describe('when a kind that both sides carry is still not addable', () => {
  it.each(['cutover', 'done', 'continuous'])('refuses once the migration is %s', (status) => {
    const task = kindChoices({ ...GOOGLE_TO_NEXTCLOUD, status }).find((c) => c.domain === 'task');
    expect(task).toEqual({ domain: 'task', state: 'refused', reason: KIND_AFTER_CUTOVER_REFUSAL });
  });

  it('allows a paused migration: the next start takes the kind with the rest', () => {
    const task = kindChoices({ ...GOOGLE_TO_NEXTCLOUD, status: 'paused' }).find((c) => c.domain === 'task');
    expect(task?.state).toBe('addable');
  });

  it('refuses a kind the account MEASURED it cannot carry, in the measurement’s own words', () => {
    const task = kindChoices({
      ...GOOGLE_TO_NEXTCLOUD,
      sourceQualification: measuredTasks('no', 'The grant does not include tasks.readonly.'),
    }).find((c) => c.domain === 'task');
    expect(task?.state).toBe('refused');
    expect(task && 'reason' in task ? task.reason : '').toContain(
      'The grant does not include tasks.readonly.',
    );
  });

  it('never refuses on an unknown or an absent measurement', () => {
    for (const sourceQualification of [measuredTasks('unknown'), undefined, null, 'garbage']) {
      const task = kindChoices({ ...GOOGLE_TO_NEXTCLOUD, sourceQualification }).find(
        (c) => c.domain === 'task',
      );
      expect(task?.state).toBe('addable');
    }
  });

  it("reads the target's measurement too, as the create route does", () => {
    const task = kindChoices({
      ...GOOGLE_TO_NEXTCLOUD,
      targetQualification: measuredTasks('no', 'This Nextcloud has no Tasks app.'),
    }).find((c) => c.domain === 'task');
    expect(task?.state).toBe('refused');
  });
});

describe('what the route answers', () => {
  it('nothing, for a kind the page offers', () => {
    expect(kindAdditionRefusal('task', GOOGLE_TO_NEXTCLOUD)).toBeNull();
  });

  it('that the kind is already there', () => {
    expect(kindAdditionRefusal('calendar', GOOGLE_TO_NEXTCLOUD)).toBe(
      "'calendar' is already part of this migration.",
    );
  });

  it('the refusal the page shows, word for word', () => {
    expect(kindAdditionRefusal('task', { ...GOOGLE_TO_NEXTCLOUD, status: 'done' })).toBe(
      KIND_AFTER_CUTOVER_REFUSAL,
    );
  });

  it('which side cannot carry a kind the page never offered', () => {
    expect(kindAdditionRefusal('email', GOOGLE_TO_NEXTCLOUD)).toMatch(/source cannot provide 'email'/);
    expect(kindAdditionRefusal('email', GOOGLE_TO_NEXTCLOUD, RESTRICTED)).toMatch(
      /destination cannot receive 'email'/,
    );
    expect(kindAdditionRefusal('calendar', { ...GOOGLE_TO_NEXTCLOUD, sourceKind: 'imap', current: ['email'] })).toMatch(
      /Nothing says what else this migration's source can carry/,
    );
  });
});
