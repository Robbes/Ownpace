// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KNOCK NO PERSON MADE: the form's half (workplan 0093 T2d; the owner,
 * 2026-10-04, *"Honeypot now (Recommended)"*).
 *
 * The request form carries one field a person never sees or reaches, named
 * `website`. A bot that fills every input fills it too, and the API answers
 * that request as received and keeps nothing
 * (`apps/api/src/routes/a-knock-no-person-made.unit.test.ts`).
 *
 * What this holds:
 *
 *  - the field is inside the form, off-screen rather than `display: none`
 *    (some bots skip fields that are not displayed), under a wrapper with
 *    `aria-hidden="true"`, with `tabIndex={-1}` and `autoComplete="off"`;
 *  - it is not in the accessible tree: no textbox a screen reader can find
 *    is the trap, and the visible textboxes are the four they were;
 *  - the keyboard never lands on it;
 *  - a person who fills the visible form sends no trap value at all, so
 *    their request is the one it was before;
 *  - whatever a script puts in the field is sent, even when it sets the
 *    value without the events a person's typing makes.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RequestAccess from './RequestAccess.tsx';

const TRAP = 'website';
const BAIT = 'https://cheap-pills.example.test/buy-now';

const postMock = vi.fn();
vi.mock('../services/api.ts', () => ({
  default: { post: (...args: unknown[]) => postMock(...args) },
}));

const renderPage = (path = '/request-access') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <RequestAccess />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The trap input, found by its name, as a bot finds it. */
const trap = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(`form input[name="${TRAP}"]`);
  expect(input, `the form has no input named "${TRAP}"`).not.toBeNull();
  return input!;
};

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { received: true } });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('the trap a person never reaches', () => {
  it('is inside the form, off-screen, hidden from assistive technology, and out of the tab order', () => {
    renderPage();
    const input = trap();
    expect(input.closest('form')).not.toBeNull();
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute('autocomplete')).toBe('off');

    const wrapper = input.closest('[aria-hidden="true"]');
    expect(wrapper, 'no aria-hidden wrapper around the trap').not.toBeNull();
    expect(input.closest('form')).toContainElement(wrapper as HTMLElement);

    // Off-screen, not undisplayed: some bots skip a field that is not shown.
    for (const el of [wrapper as HTMLElement, input]) {
      expect(el.hidden).toBe(false);
      expect(el.style.display).not.toBe('none');
      expect(el.style.visibility).not.toBe('hidden');
      expect(el.classList.contains('hidden')).toBe(false);
      expect(el.classList.contains('invisible')).toBe(false);
    }
    expect((wrapper as HTMLElement).className).toMatch(/\babsolute\b/);
    expect((wrapper as HTMLElement).className).toMatch(/left-\[-\d+px\]/);
    // No variant-prefixed class (`sm:static`, `focus:left-0`): a breakpoint or
    // state variant could bring the trap on screen at some width, and jsdom
    // draws no width to notice it.
    expect([...(wrapper as HTMLElement).classList, ...input.classList].filter((c) => c.includes(':'))).toEqual([]);
  });

  it('is labelled for the rare reader who meets it, and only aria-hidden keeps it out', () => {
    renderPage();
    // Found only when hidden elements are included: the label is wired, so
    // the absence below is aria-hidden's doing and nothing else.
    expect(screen.getByRole('textbox', { name: /leave this field empty/i, hidden: true })).toBe(trap());
    expect(screen.queryByRole('textbox', { name: /leave this field empty/i })).toBeNull();
  });

  it('is not one of the textboxes a screen reader finds, which are the four they were', () => {
    renderPage();
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).not.toContain(trap());
    expect(boxes.map((b) => b.getAttribute('name'))).toEqual(['email', 'name', 'organisation', 'note']);
  });

  it('is never reached by the keyboard', async () => {
    const user = userEvent.setup();
    renderPage('/request-access?email=someone%40example.test');
    const reached = new Set<Element>();
    for (let i = 0; i < 40; i++) {
      await user.tab();
      if (document.activeElement) reached.add(document.activeElement);
    }
    // The walk went through the form, so missing the trap means something.
    expect(reached).toContain(screen.getByLabelText(/email address/i));
    expect(reached).toContain(screen.getByRole('button', { name: /send request/i }));
    expect(reached).not.toContain(trap());
  });

  it('is not sent when a person fills the visible form', async () => {
    const user = userEvent.setup();
    renderPage();
    trap();
    await user.type(screen.getByLabelText(/email address/i), 'someone@example.test');
    await user.type(screen.getByLabelText(/your name/i), 'Ana');
    await user.type(screen.getByLabelText(/what are you moving/i), 'two mailboxes');
    await user.selectOptions(screen.getByLabelText(/which package/i), 'Medium');
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    // The request a person made before the trap existed, byte for byte.
    expect(postMock.mock.calls[0]![1]).toEqual({
      email: 'someone@example.test',
      name: 'Ana',
      note: 'two mailboxes',
      tier: 'Medium',
      locale: 'en',
    });
  });

  it('is sent as filled when a script sets it, even without the events typing makes', async () => {
    const user = userEvent.setup();
    renderPage('/request-access?email=bot%40example.test');
    // What a bot does: write the value straight into the DOM.
    trap().value = BAIT;
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).toMatchObject({ email: 'bot@example.test', [TRAP]: BAIT });
  });

  it('is sent as typed when a bot types into it', async () => {
    const user = userEvent.setup();
    renderPage('/request-access?email=bot%40example.test');
    await user.type(trap(), BAIT);
    await user.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock.mock.calls[0]![1]).toMatchObject({ [TRAP]: BAIT });
  });
});
