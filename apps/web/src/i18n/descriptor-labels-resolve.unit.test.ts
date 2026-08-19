// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every field the descriptor names must have real copy, in both locales
 * (workplan 0064).
 *
 * `Connections.tsx` renders its form straight from `credentialFieldsFor`, so a
 * label key with no string behind it does not throw — it renders the KEY, and
 * somebody is asked for `wizard.dropboxAppKey` instead of an App key. Nothing
 * else catches that: the descriptor lives in `@openmig/shared`, which has no
 * access to the web app's strings, so the two can only be checked from here.
 *
 * This is also why the descriptor reuses the wizard's existing keys rather
 * than introducing its own — fewer strings, and every one of them already
 * carries a translation.
 */

import { describe, it, expect } from 'vitest';
import { connectableTypes, credentialFieldsFor } from '@openmig/shared';
import { STRINGS } from './strings.ts';

const everyField = (['source', 'target'] as const).flatMap((role) =>
  connectableTypes(role).flatMap((type) =>
    credentialFieldsFor(role, type).map((field) => ({ role, type, field })),
  ),
);

describe('descriptor labels', () => {
  it('resolve to English copy, never to a bare key', () => {
    const missing = everyField
      .filter(({ field }) => !(field.labelKey in STRINGS.en))
      .map(({ role, type, field }) => `${role}/${type}.${field.key} → ${field.labelKey}`);

    expect(missing, 'field labels with no English string').toEqual([]);
  });

  it('resolve to Dutch copy too — a half-translated form is a bug, not a fallback', () => {
    const missing = everyField
      .filter(({ field }) => !(field.labelKey in STRINGS.nl))
      .map(({ role, type, field }) => `${role}/${type}.${field.key} → ${field.labelKey}`);

    expect(missing, 'field labels with no Dutch string').toEqual([]);
  });

  it('resolve their placeholders as well, where one is named', () => {
    const missing = everyField
      .filter(({ field }) => field.placeholderKey && !(field.placeholderKey in STRINGS.en))
      .map(({ field }) => field.placeholderKey!);

    expect(missing).toEqual([]);
  });
});
