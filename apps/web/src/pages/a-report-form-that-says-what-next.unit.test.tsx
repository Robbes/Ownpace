// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REPORT FORM THAT SAYS WHAT NEXT (the UX sweep, 2026-10-17).
 *
 * Three small gaps on *Report a problem*, each a question the page left the
 * reader to answer alone:
 *
 *  - **Why the button is pale.** *Send the report* is disabled while the
 *    description is empty, and nothing said so. The wizard's rule (0145 T7
 *    (a), 0153 T7 (a)): a disabled button says why in text under it, tied to
 *    it with `aria-describedby`, and the line goes once the reason has.
 *  - **Where to go once it is sent.** The sent state was the title and one
 *    sentence. Now a link goes back to the page the person came from, the
 *    `?from=` the link beside *Sign out* carries, and to the migrations when
 *    that is not one of this app's own pages: never another site (`//…`, or
 *    anything the browser's URL parser reads as one), and never the report
 *    form again.
 *  - **A chooser in the reader's language.** The bare file input showed the
 *    browser's own words (*Choose File · No file chosen*), unbordered, in a
 *    Dutch form. It is now hidden for the eye and drawn as a button like
 *    *Paste screenshot*, with the page's words; the field keeps its own label,
 *    so `getByLabelText` and a screen reader still reach the input.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../stores/auth-store.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import ReportProblem from './ReportProblem.tsx';

const getMock = vi.fn();
const postMock = vi.fn();
vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return {
    ...actual,
    default: {
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
    },
  };
});

type Locale = 'en' | 'nl';

const renderPage = async (from: string, locale: Locale = 'en') => {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  render(
    <LocaleProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[`/report?from=${encodeURIComponent(from)}`]}>
          <Routes>
            <Route path="/report" element={<ReportProblem />} />
            <Route path="*" element={<div>screen:elsewhere</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  await screen.findByLabelText(STRINGS[locale]['report.description']);
};

async function send(locale: Locale = 'en'): Promise<void> {
  const L = STRINGS[locale];
  await userEvent.type(screen.getByLabelText(L['report.description']), 'The Moves screen is empty');
  await userEvent.click(screen.getByRole('button', { name: L['report.send'] }));
  await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  globalThis.localStorage.clear();
  getMock.mockReset();
  postMock.mockReset();
  getMock.mockResolvedValue({ data: { available: true } });
  postMock.mockResolvedValue({ data: { ticket: '31001' } });
  useAuthStore.setState({
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

describe('a send button that says why it waits', () => {
  it.each([
    ['en', 'First write what happened.'],
    ['nl', 'Schrijf eerst wat er gebeurde.'],
  ] as const)('says what is missing under the button, and tied to it, until it is written (%s)', async (locale, said) => {
    await renderPage('/mappings', locale);
    const button = screen.getByRole('button', { name: STRINGS[locale]['report.send'] });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(said);
    expect(screen.getByText(said)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(STRINGS[locale]['report.description']), 'Something broke');
    expect(button).toBeEnabled();
    expect(button).not.toHaveAccessibleDescription(said);
    expect(screen.queryByText(said)).toBeNull();
  });
});

describe('once it is sent', () => {
  it('links back to the page the person was on', async () => {
    await renderPage('/mappings/x');
    await send();
    const back = await screen.findByRole('link', { name: 'Back to the page you were on' });
    expect(back).toHaveAttribute('href', '/mappings/x');
  });

  it('says it in Dutch for a Dutch reader', async () => {
    await renderPage('/mappings/x', 'nl');
    await send('nl');
    expect(await screen.findByRole('link', { name: 'Terug naar de pagina waar u was' })).toHaveAttribute(
      'href',
      '/mappings/x',
    );
  });

  it('keeps the page’s own query and fragment', async () => {
    await renderPage('/mappings/x?tab=moves#log');
    await send();
    const back = await screen.findByRole('link', { name: 'Back to the page you were on' });
    expect(back).toHaveAttribute('href', '/mappings/x?tab=moves#log');
  });

  // The browser's URL parser has the last word: it drops a tab, line feed or
  // carriage return and reads `\` as `/`, so each of these is another site
  // once it is a link, and `/mappings/../report` is this form again.
  it.each([
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/report',
    '/report?from=%2F',
    '/mappings/../report',
    'https://evil.example/',
    '',
  ])(
    'goes to the migrations, not to %j',
    async (from) => {
      await renderPage(from);
      await send();
      const back = await screen.findByRole('link', { name: 'Back to the page you were on' });
      expect(back).toHaveAttribute('href', '/mappings');
    },
  );
});

describe('a screenshot chooser in the page’s own words', () => {
  it.each([
    ['en', 'Choose a screenshot'],
    ['nl', 'Schermafbeelding kiezen'],
  ] as const)('is a visible label tied to the file input, which keeps the field’s own label (%s)', async (locale, said) => {
    await renderPage('/mappings', locale);
    const chooser = screen.getByText(said);
    expect(chooser.tagName).toBe('LABEL');
    const input = screen.getByLabelText(STRINGS[locale]['report.screenshot']) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(chooser).toHaveAttribute('for', input.id);
    // Hidden for the eye only: still in the tab order and the accessibility tree.
    expect(input).toHaveClass('sr-only');
    expect(input).not.toHaveAttribute('tabindex', '-1');
  });
});
