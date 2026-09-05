// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * One line on screen, the rest behind a fold (workplan 0118 T1).
 *
 * Two things worth pinning: the fold is CLOSED until asked for — a hint
 * that renders its why open has simply moved the wall down a line — and
 * the descriptor convention (`x.hint` folds `x.why` when the dictionary has
 * it) answers nothing for a hint with nothing to fold, so no empty fold
 * appears under a one-line hint.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Hint, whyKeyOf } from './Hint.tsx';

describe('Hint', () => {
  it('shows the line, and the why only once the fold is opened', () => {
    render(<Hint text="Only needed if this account will also receive mail." why="Calendars need no mail server." />);
    expect(screen.getByText(/Only needed if/)).toBeVisible();
    expect(screen.getByText(/Calendars need no mail server/)).not.toBeVisible();

    fireEvent.click(screen.getByText('Why?'));
    expect(screen.getByText(/Calendars need no mail server/)).toBeVisible();
  });

  it('renders no fold at all when there is nothing to fold', () => {
    const { container } = render(<Hint text="Empty = daily at 2 AM" />);
    expect(container.querySelector('details')).toBeNull();
  });

  it('says How? or More on the fold when asked, in the reader’s language', () => {
    render(<Hint text="Create a Box platform app" why="Developer Console → …" label="how" />);
    expect(screen.getByText('How?')).toBeTruthy();
  });
});

describe('whyKeyOf — the folded twin, by convention', () => {
  it('finds x.why beside x.hint, and beside the one x.width', () => {
    expect(whyKeyOf('wizard.gmailAppPassword.hint')).toBe('wizard.gmailAppPassword.why');
    expect(whyKeyOf('wizard.serviceAccountKey.width')).toBe('wizard.serviceAccountKey.why');
  });

  it('answers nothing for a hint with nothing to fold', () => {
    expect(whyKeyOf('wizard.refreshToken.hint')).toBeUndefined();
    expect(whyKeyOf('wizard.domain.email.hint')).toBeUndefined();
  });
});
