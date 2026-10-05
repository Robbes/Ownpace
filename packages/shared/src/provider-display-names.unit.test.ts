// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every provider this product connects to has a NAME (workplan 0074).
 *
 * The setup checklist rendered the wizard type itself as its heading, so an
 * operator was told to configure `oauth2` — and the owner asked the question
 * that makes the defect obvious: *how should a user guess that is for Entra
 * ID?* A type is a key the code agrees on. A name is what the person arrived
 * knowing, and the two are not the same string.
 *
 * The lock is coverage, not wording: a provider added to `credentialFieldsFor`
 * without a display name fails HERE, rather than shipping its key to a screen.
 * Which name it gets stays a judgment call for whoever adds it.
 */

import { describe, it, expect } from 'vitest';
import {
  providerDisplayName,
  providerDisplayNamesCoverEveryType,
  providerTypesWithDutchNames,
  typesNeedingDisplayNames,
} from './credential-fields.ts';

describe('provider display names', () => {
  it('cover every type the product can connect to', () => {
    expect(
      providerDisplayNamesCoverEveryType(),
      'these types would render their own key on the setup checklist',
    ).toEqual([]);
  });

  it('never render as the bare type', () => {
    for (const type of typesNeedingDisplayNames()) {
      // `imap` names itself, legitimately — the protocol IS what it is called.
      if (type === 'imap') continue;
      expect(providerDisplayName(type), `${type} has no name of its own`).not.toBe(type);
    }
  });

  it('say Microsoft 365 for the two types nobody would recognise', () => {
    // The pair the owner actually tripped over: they differ by transport, and
    // nobody arrives thinking "I need the OAuth2 one".
    expect(providerDisplayName('oauth2')).toContain('Microsoft 365');
    expect(providerDisplayName('graph')).toContain('Microsoft 365');
  });

  it('show an unknown type as itself rather than blank', () => {
    // A gap you can see is a bug report; a gap you cannot see is a mystery.
    expect(providerDisplayName('something-new')).toBe('something-new');
  });
});

/**
 * THE NAMES DUTCH WRITES ITS OWN WAY (the owner, 2026-10-05: *"Write provider
 * names the Dutch way in the Dutch app"*). The Dutch app said *Google
 * account* beside its own sentences' *Google-account*.
 */
describe('provider display names in Dutch', () => {
  it.each([
    ['google', 'Google-account'],
    ['microsoft', 'Microsoft 365-account'],
    ['apple', 'Apple-account (iCloud)'],
    ['google-calendar', 'Google Agenda'],
    ['google-contacts', 'Google Contacten'],
    ['archive', 'Exportarchief'],
  ])('name %s "%s"', (type, name) => {
    expect(providerDisplayName(type, 'nl')).toBe(name);
  });

  it('are written only for a type the English table names, and differ from its English', () => {
    expect(providerTypesWithDutchNames().length).toBeGreaterThan(0);
    for (const type of providerTypesWithDutchNames()) {
      expect(typesNeedingDisplayNames(), `${type} is not a type the product connects to`).toContain(type);
      expect(providerDisplayName(type, 'nl'), `${type} says the same in Dutch`).not.toBe(providerDisplayName(type, 'en'));
    }
  });

  it('leave a brand and a protocol as they are in both languages', () => {
    const own = new Set(providerTypesWithDutchNames());
    for (const type of typesNeedingDisplayNames().filter((t) => !own.has(t))) {
      expect(providerDisplayName(type, 'nl'), type).toBe(providerDisplayName(type, 'en'));
    }
  });

  it('stay English unless a screen asks, so a server line and a log are as they were', () => {
    expect(providerDisplayName('google')).toBe('Google account');
    expect(providerDisplayName('something-new', 'nl')).toBe('something-new');
  });
});
