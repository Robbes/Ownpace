// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Stepping through the CreateMapping wizard, for the tests that need to.
 *
 * Test code only; nothing the app imports. It lived inside
 * `CreateMapping.unit.test.tsx`, unexported, until a second file needed the
 * same walk: `a-step-that-starts-at-the-top` presses Next and Back and asks
 * where the page and the focus went (workplan 0145 T3 (a)). Moved rather than
 * copied, so that a change to what a step demands is made in one place.
 *
 * The Next button is found by its words in the dictionary, so the walk works
 * in Dutch too. The boxes are found by placeholders and labels that are the
 * same in both languages.
 *
 * `.tsx` with no JSX in it, on purpose: a `.ts` in an app's `src` is also in
 * the root program, which has no DOM lib, and this file reads `document`.
 */
import { screen, fireEvent } from '@testing-library/react';
import { expect } from 'vitest';
import { STRINGS, type Locale } from '../i18n/strings.ts';

const escaped = (words: string): string => words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The target's host box, found by its LABEL rather than the example inside it.
 *
 * These lookups used to ask for the placeholder `jmap.example.com`, which
 * every target door showed — including the five it was wrong for. Pinning the
 * tests to the example is why nobody noticed an IMAP target suggesting a JMAP
 * host on port 443 (2026-09-07). A label is what the field IS; a placeholder
 * is a worked example, and the two must be free to differ per protocol.
 */
export const targetHostBox = (): HTMLElement => screen.getByLabelText(/^Host/);

/**
 * The wizard's own Next button, or Create on the last step.
 *
 * AN EXACT MATCH, because a CARD is a button too (2026-09-07). `/Next|.../`
 * unanchored matched the "Nextcloud" target card as well as the wizard's own
 * Next button the moment that card existed, and every step-through test began
 * failing with "found multiple elements" — a selector fault reading as a
 * product fault. Anchored, the query means the button it always meant.
 */
export const nextButton = (locale: Locale = 'en'): HTMLElement =>
  screen.getByRole('button', {
    name: new RegExp(
      `^(${escaped(STRINGS[locale]['wizard.next'])}|${escaped(STRINGS[locale]['wizard.create'])})$`,
    ),
  });

/** Step 1 — Source: host, account and password, then Next. */
export const passSourceStep = (locale: Locale = 'en'): void => {
  // Each side carries its OWN credentials (workplan 0070), so the account and
  // the password gate here, beside the host.
  fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
    target: { value: 'mail.old-provider.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
    target: { value: 'source@acme.example' },
  });
  // The password too, which the walk's comment claimed since 0070 and the
  // walk did not type: the gate read a hand-written branch that asked for a
  // host and a port only, and now it reads the descriptor, which has always
  // marked an IMAP source's password required (2026-09-07).
  fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
    target: { value: 'source-password' },
  });
  expect(nextButton(locale)).toBeEnabled();
  fireEvent.click(nextButton(locale));
};

/** Fill only what each step RENDERS and advance — the whole point of the
 *  0037 T1 pin. Fails on the old gates at the very first click. */
export const walkToReview = (locale: Locale = 'en'): void => {
  passSourceStep(locale);

  // Step 2 — Target: host, account, password (port prefilled, jmap preselected).
  fireEvent.change(targetHostBox(), {
    target: { value: 'stalwart.acme.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
    target: { value: 'target@acme.example' },
  });
  fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
    target: { value: 'target-password' },
  });
  fireEvent.click(nextButton(locale));

  // Step 3 — The migration itself: a name, what to move (email preselected)
  // and how often (empty = the default cadence).
  fireEvent.change(screen.getByPlaceholderText('My Migration'), {
    target: { value: 'Acme mail' },
  });
  fireEvent.click(nextButton(locale));
};
