// Copyright 2026 The Ownpace authors (Apache-2.0)

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

  /**
   * ONE PLACE SAYS WHETHER A FIELD IS REQUIRED, AND IT IS THE ASTERISK
   * (2026-09-07, after the owner asked what to type into a Nextcloud form
   * whose only workable field was labelled "(optional)").
   *
   * Eight labels carried the word and the rest carried nothing, so a form
   * read as "these eight are the optional ones" — while the client pair,
   * unmarked, was mandatory on any deployment carrying no OAuth client of its
   * own. A label cannot know that; `credentialFieldRequired` does, and the
   * marker it drives is now the only claim on screen. A label that restates
   * the answer is a second source of truth for it, and it was the wrong one.
   */
  it('never say in words what the required marker says per deployment', () => {
    const WORDS = [/\(optional\)/i, /\(optioneel\)/i, /\(verplicht\)/i, /\(required\)/i];
    const offenders = everyField.flatMap(({ role, type, field }) =>
      (['en', 'nl'] as const)
        .map((locale) => ({ locale, text: STRINGS[locale][field.labelKey as never] as string }))
        .filter(({ text }) => typeof text === 'string' && WORDS.some((w) => w.test(text)))
        .map(({ locale, text }) => `${role}/${type}.${field.key} [${locale}] "${text}"`),
    );

    expect(offenders, 'labels that state requiredness the marker already states').toEqual([]);
  });

  it('resolve their placeholders as well, where one is named', () => {
    const missing = everyField
      .filter(({ field }) => field.placeholderKey && !(field.placeholderKey in STRINGS.en))
      .map(({ field }) => field.placeholderKey!);

    expect(missing).toEqual([]);
  });
});
