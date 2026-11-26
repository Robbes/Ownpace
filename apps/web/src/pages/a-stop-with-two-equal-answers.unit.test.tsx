// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A STOP WITH TWO EQUAL ANSWERS (workplan 0176 T5, first half; §9.1; R9:
 * *stopping is never a trap*).
 *
 * The stop was a small red-edged button, *Withdraw access*, and its question
 * opened in place under it, with a red filled *Yes, withdraw it* beside a grey
 * *Keep it*. A reader with a tremor lands on the larger, louder target. Now:
 *
 * - the button says what it stops (D2): *Stop copying*, as wide as the
 *   column, outlined with an edge that can be seen, and not red;
 * - a press opens the question as a screen of its own, with one `h1`, never a
 *   row under the button;
 * - its two answers are one size, *No, do not stop* first, neither filled and
 *   neither red;
 * - the question says what is true in step A: a stop is final at once, and
 *   continuing later needs a new link. Nothing says ten minutes, which step C
 *   builds;
 * - afterwards the page says what the provider answered. *You do not have to
 *   do anything* is said only where it confirmed; where it did not, the page
 *   says where to finish it by hand, on a line of its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, withdrawMock, withdrawAccountMock, reportAvailableMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  withdrawMock: vi.fn(),
  withdrawAccountMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
}));

vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));
vi.mock('../services/view-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/view-service.ts')>()),
  viewApi: { read: readMock, withdraw: withdrawMock, withdrawAccount: withdrawAccountMock, withdrawDestination: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import View from './View.tsx';

const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();

const row = {
  domain: 'email' as const,
  state: 'in_progress' as const,
  itemsSynced: 4211,
  itemsFailed: 0,
  bytesTransferred: 91_000_000,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  itemsFound: 5000,
  stage: 'copying',
};

const PERSON = {
  kind: 'person' as const,
  organisation: 'Example family',
  expiresAt: IN_A_MONTH,
  accounts: [{ ref: 'acct-1', grant: { state: 'granted' as const } }],
  migrations: [
    { from: 'gmail', to: 'soverin', state: 'active' as const, started: true, domains: [row], account: 'acct-1' },
    { from: 'google', to: 'nextcloud', state: 'active' as const, started: true, domains: [{ ...row, domain: 'calendar' }], account: 'acct-1' },
  ],
  destinations: [],
};

function renderPage(locale: 'en' | 'nl' = 'en') {
  window.localStorage.setItem('ownpace.locale', locale);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/view/p.abc.def']}>
          <Routes>
            <Route path="/view/:link" element={<View />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

/** A class list that fills a button with a colour, or paints it red. */
const FILLED = /(^|\s)bg-(?!white\b|transparent\b)/;
const RED = /red/;

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue(PERSON);
});

describe('the stop button', () => {
  it('says Stop copying, is as wide as the column and 60 pixels high, outlined, and not red', async () => {
    renderPage();
    const stop = await screen.findByRole('button', { name: 'Stop copying' });
    expect(stop.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect(stop.className).toMatch(/min-h-\[60px\]/);
    // An edge that can be seen: 3 to 1 against the paper, gray-500 or darker (§13).
    expect(stop.className).toMatch(/(^|\s)border-gray-(500|600|700|800|900)(\s|$)/);
    expect(stop.className).not.toMatch(RED);
    expect(stop.className).not.toMatch(FILLED);
  });

  it('in Dutch: Kopiëren stoppen, and nothing says Toegang intrekken', async () => {
    renderPage('nl');
    expect(await screen.findByRole('button', { name: 'Kopiëren stoppen' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/toegang intrekken/i);
  });
});

describe('the question, a screen of its own', () => {
  it('has its own heading, and is not drawn under the button', async () => {
    renderPage();
    const stop = await screen.findByRole('button', { name: 'Stop copying' });
    await userEvent.click(stop);
    const question = await screen.findByRole('heading', { level: 1, name: 'Stop copying from your Google account?' });
    // One h1 on the screen, with the focus on it, and the page's own progress gone.
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([question]);
    expect(document.activeElement).toBe(question);
    expect(stop).not.toBeInTheDocument();
    expect(screen.queryByText('4,211 of ~5,000')).not.toBeInTheDocument();
    expect(document.title).toBe('Stop copying from your Google account? — Ownpace');
  });

  it('says what stops, for that account, with what stays where, and that it is final in step A', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    await screen.findByRole('heading', { level: 1 });
    expect(
      screen.getByText(
        'Ownpace then stops reading this account. What is already copied stays at Soverin and Nextcloud. Nothing is deleted at Google.',
      ),
    ).toBeInTheDocument();
    // Google ends the whole app's permission: said before the press.
    expect(screen.getByText('Google ends everything you allowed Ownpace. All copying from this account then stops.')).toBeInTheDocument();
    expect(screen.getByText('Continuing later needs a new link from Example family.')).toBeInTheDocument();
  });

  it('offers two answers of one size, No first, neither filled and neither red', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    await screen.findByRole('heading', { level: 1 });
    const answers = screen.getAllByRole('button').filter((b) => /^(No, do not stop|Yes, stop)$/.test(b.textContent ?? ''));
    expect(answers.map((b) => b.textContent)).toEqual(['No, do not stop', 'Yes, stop']);
    const [no, yes] = answers as [HTMLElement, HTMLElement];
    expect(yes.className).toBe(no.className);
    for (const b of answers) {
      expect(b.className).not.toMatch(FILLED);
      expect(b.className).not.toMatch(RED);
      expect(b.className).toMatch(/min-h-\[60px\]/);
    }
  });

  it('No, do not stop goes back to the page, and nothing is sent', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    await userEvent.click(await screen.findByRole('button', { name: 'No, do not stop' }));
    expect(await screen.findByRole('button', { name: 'Stop copying' })).toBeInTheDocument();
    expect(withdrawAccountMock).not.toHaveBeenCalled();
  });

  it('says nothing of ten minutes: a stop in step A is final at once', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    await screen.findByRole('heading', { level: 1 });
    expect(document.body.textContent).not.toMatch(/10 minutes|ten minutes|take it back/i);
  });
});

describe('after Yes, stop', () => {
  it('where the provider confirmed: that it stopped, what Google said, what stays, and that nothing is left to do', async () => {
    withdrawAccountMock.mockResolvedValue({ withdrawnAt: new Date().toISOString(), atGoogle: 'revoked' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, stop' }));
    expect(withdrawAccountMock).toHaveBeenCalledWith('p.abc.def', 'acct-1');
    expect(await screen.findByRole('heading', { name: 'Copying has stopped' })).toBeInTheDocument();
    expect(screen.getByText('Google confirmed it. Ownpace can no longer reach this account.')).toBeInTheDocument();
    expect(screen.getByText('Nothing was deleted at Google. What was copied is still at Soverin and Nextcloud.')).toBeInTheDocument();
    expect(screen.getByText('You do not have to do anything.')).toBeInTheDocument();
    expect(screen.getByText('Stopping is allowed.')).toBeInTheDocument();
    expect(screen.getByText('Want to continue later? Ask Example family.')).toBeInTheDocument();
  });

  it('where it did not: where to finish it by hand, on a line of its own, and no “nothing to do”', async () => {
    withdrawAccountMock.mockResolvedValue({ withdrawnAt: new Date().toISOString(), atGoogle: 'not_confirmed' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop copying' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, stop' }));
    expect(
      await screen.findByText(
        'The permission is deleted here, so Ownpace cannot use it. Google did not confirm. To be sure, remove Ownpace yourself from the list of apps at Google:',
      ),
    ).toBeInTheDocument();
    const where = screen.getByRole('link', { name: 'myaccount.google.com/connections' });
    expect(where).toHaveAttribute('href', 'https://myaccount.google.com/connections');
    // On a line of its own, not at the end of the sentence.
    expect(where.parentElement?.textContent).toBe('myaccount.google.com/connections');
    expect(screen.queryByText('You do not have to do anything.')).not.toBeInTheDocument();
    expect(screen.getByText('Stopping is allowed.')).toBeInTheDocument();
  });
});

describe('a destination’s Remove my password', () => {
  it('keeps its words, and has the same two equal answers', async () => {
    readMock.mockResolvedValue({ ...PERSON, destinations: [{ ref: 'dest-1', provider: 'soverin', drive: false }] });
    renderPage();
    const remove = await screen.findByRole('button', { name: 'Remove my password' });
    expect(remove.className).not.toMatch(RED);
    await userEvent.click(remove);
    const answers = screen.getAllByRole('button').filter((b) => /^(Keep it|Yes, remove it)$/.test(b.textContent ?? ''));
    expect(answers.map((b) => b.textContent)).toEqual(['Keep it', 'Yes, remove it']);
    const [keep, yes] = answers as [HTMLElement, HTMLElement];
    expect(yes.className).toBe(keep.className);
    for (const b of answers) {
      expect(b.className).not.toMatch(FILLED);
      expect(b.className).not.toMatch(RED);
    }
  });
});
