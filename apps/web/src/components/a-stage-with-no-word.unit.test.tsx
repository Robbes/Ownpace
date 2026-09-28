// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STAGE WITH NO WORD (workplan 0154 T1 (a)).
 *
 * `stageOf` in `@openmig/shared` decides the stage; `STATE_TABLE.stage` is
 * where it gets its word and its colour. A stage added to one and not the
 * other is a chip that renders its raw key on a person's page. So the two
 * lists are held equal here, and each stage renders the glossary's word in
 * both languages.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { STAGES } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import StateChip, { STATE_TABLE } from './StateChip.tsx';

const WORDS = {
  en: ['Not started', 'Paused', 'Copying', 'Kept in step', 'Ready to switch', 'Switching', 'Done'],
  nl: [
    'Nog niet gestart',
    'Gepauzeerd',
    'Wordt gekopieerd',
    'Wordt bijgehouden',
    'Klaar om over te stappen',
    'Bezig met overstappen',
    'Afgerond',
  ],
} as const;

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('a stage with no word', () => {
  it('has a word and a colour for every stage, and no word for a stage there is not', () => {
    expect(Object.keys(STATE_TABLE.stage)).toEqual([...STAGES]);
  });

  it.each(['en', 'nl'] as const)('says every stage in the glossary\'s words, in %s', (locale) => {
    globalThis.localStorage.setItem('ownpace.locale', locale);
    render(
      <LocaleProvider>
        {STAGES.map((stage) => (
          <StateChip key={stage} entity="stage" state={stage} />
        ))}
      </LocaleProvider>,
    );
    for (const word of WORDS[locale]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
  });
});
