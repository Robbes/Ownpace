// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STATE SAID IN WORDS, NOT ONLY IN A COLOUR OR AN ICON (workplan 0145 T2).
 *
 * The chooser's cards showed which one was picked by a blue border and a
 * blue-tinted background, and by nothing else: no `aria-pressed`, so a screen
 * reader read every card the same, picked or not, and somebody who does not
 * see the difference between two light colours had nothing to go by either.
 * The picked card now says so to assistive technology (`aria-pressed`) and
 * shows a check mark beside its name, which is a shape, not a colour.
 *
 * Pinned here: exactly one card is pressed once one is picked, the rest say
 * they are not, nothing is pressed before a pick, and only the pressed card
 * carries the mark. (The Finish steps' half of 0145 T2 is pinned in its own
 * file, beside Finish.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FrontDoorChooser } from './FrontDoorChooser.tsx';
import { frontDoorCards, type FrontDoorCard } from './front-door-cards.ts';
import { LocaleProvider } from '../i18n/index.tsx';

afterEach(() => {
  cleanup();
});

/** The chooser as a page draws it: the picked id held by its parent. */
const Harness: React.FC<{ role: 'source' | 'target' }> = ({ role }) => {
  const [picked, setPicked] = React.useState('');
  return (
    <FrontDoorChooser
      cards={frontDoorCards(role)}
      role={role}
      selectedId={picked}
      onPick={(card: FrontDoorCard) => setPicked(card.id)}
      gridClass="sm:grid-cols-2"
    />
  );
};

/** Every card's button: the ones that say whether they are pressed. */
const cards = (): HTMLElement[] =>
  screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));

describe('the picked card says it is picked (0145 T2)', () => {
  for (const role of ['source', 'target'] as const) {
    it(`${role}: no card is pressed before a pick, then exactly the picked one is`, () => {
      render(
        <LocaleProvider>
          <Harness role={role} />
        </LocaleProvider>,
      );
      const all = cards();
      expect(all.length, 'no card carries aria-pressed at all').toBe(frontDoorCards(role).length);
      expect(all.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
      expect(document.querySelectorAll('[data-picked-mark]')).toHaveLength(0);

      const chosen = all[all.length - 1]!;
      fireEvent.click(chosen);
      const pressed = cards().filter((b) => b.getAttribute('aria-pressed') === 'true');
      expect(pressed).toEqual([chosen]);
      expect(cards().filter((b) => b.getAttribute('aria-pressed') === 'false')).toHaveLength(all.length - 1);

      // A shape beside the colour, inside the picked card only, and hidden
      // from the name: aria-pressed already says it to a screen reader.
      const marks = document.querySelectorAll('[data-picked-mark]');
      expect(marks).toHaveLength(1);
      expect(chosen.contains(marks[0]!)).toBe(true);
      expect(marks[0]!.getAttribute('aria-hidden')).toBe('true');
    });
  }
});
