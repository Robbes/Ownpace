// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, DURING THE COPY, IN DUTCH (workplan 0154 T3 (b)): the sentence is
 * chosen by its parts (a range, *up to*, hours or days, slowed), so each has to
 * come out of the dictionary in the reader's own word order. The rule is held
 * in `packages/shared`; the migration page's tests hold the English.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import { TimeWhileCopyingLine } from './TimeWhileCopyingLine.tsx';
import type { TimeWhileCopying } from '@openmig/shared';

const inDutch = (time: TimeWhileCopying) => {
  window.localStorage.setItem('ownpace.locale', 'nl');
  render(
    <LocaleProvider>
      <TimeWhileCopyingLine time={time} provider="Microsoft 365" />
    </LocaleProvider>,
  );
};

afterEach(() => window.localStorage.removeItem('ownpace.locale'));

describe('how long, during the copy, in Dutch', () => {
  it('a range of days, from the passes', () => {
    inDutch({ kind: 'range', unit: 'days', low: 4, high: 8, passes: 3, slowed: false });
    expect(screen.getByText('Ongeveer nog 4 tot 8 dagen, volgens de laatste 3 rondes.')).toBeInTheDocument();
  });

  it('up to some hours, never from zero', () => {
    inDutch({ kind: 'range', unit: 'hours', low: 0, high: 3, passes: 5, slowed: false });
    expect(screen.getByText('Hoogstens nog 3 uur, volgens de laatste 5 rondes.')).toBeInTheDocument();
  });

  it('who slowed it, first', () => {
    inDutch({ kind: 'range', unit: 'days', low: 1, high: 2, passes: 4, slowed: true });
    expect(
      screen.getByText('Vertraagd door Microsoft 365. Ongeveer nog 1 tot 2 dagen, volgens de laatste 4 rondes.'),
    ).toBeInTheDocument();
  });

  it('how many passes it has, before three', () => {
    inDutch({ kind: 'afterThreePasses', passesSoFar: 2 });
    expect(screen.getByText('Na drie rondes weten we het; 2 tot nu toe.')).toBeInTheDocument();
    expect(screen.getByText('Hoe lang:')).toBeInTheDocument();
  });
});
