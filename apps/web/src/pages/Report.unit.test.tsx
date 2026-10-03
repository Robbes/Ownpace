// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE REPORT OF WHAT ARRIVED, AS A PAGE (workplan 0154 T5): what was found,
 * what arrived, what could not come and why, what waits on a decision, what was
 * removed, what the check compared, and the access only the reader can
 * withdraw. In the reader's language around the server's findings, which stay
 * verbatim; a count nobody took, or a check nobody could read, said as that
 * (hard rule 9). The download beside it, and the confirmed list one link away.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import type { ReadReport } from '../services/report-service.ts';

const { fetchReportMock, fetchVerifyReportMock } = vi.hoisted(() => ({
  fetchReportMock: vi.fn(),
  fetchVerifyReportMock: vi.fn(),
}));
vi.mock('../services/report-service', () => ({ fetchReport: fetchReportMock }));
vi.mock('../services/operating-service', () => ({
  fetchVerifyReport: fetchVerifyReportMock,
  fetchCompletionReport: vi.fn(),
}));

import Report from './Report.tsx';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const REPORT: ReadReport = {
  mappingId: 'm1',
  name: 'Anna — Gmail to Soverin',
  sourceType: 'gmail',
  targetType: 'soverin',
  lifecycle: 'active',
  generatedAt: '2026-10-03T21:00:00.000Z',
  domains: [
    { domain: 'email', state: 'completed', itemsSynced: 18_234, itemsFailed: 3, bytesTransferred: 0, itemsFound: 18_300, lastError: 'IMAP FETCH failed: message too large' },
    { domain: 'contact', state: 'completed', itemsSynced: 210, itemsFailed: 0, bytesTransferred: 0, itemsAdopted: 402 },
    { domain: 'task', state: 'skipped', itemsSynced: 0, itemsFailed: 0, bytesTransferred: 0 },
  ],
  queues: { movesOpen: 0, movesAcknowledged: 0, relocationsOpen: 0, deletionsOpen: 2, deletionsAcknowledged: 1, failuresNeedingDecision: 3 },
  applied: { deletionsApplied: 4, relocationsApplied: 1, refused: 0 },
  sharing: { applied: 2, doneManual: 1, skipped: 0, open: 3, openManual: 1 },
  verdict: 'complete_with_decisions_pending',
};

const check = (canProceedToCutover: boolean) => ({
  state: 'done',
  startedAt: daysAgo(2),
  finishedAt: daysAgo(2),
  report: {
    m1: {
      canProceedToCutover,
      mail: { status: 'PASS', sourceCount: 18_300, targetCount: 18_297, checksumMatches: 50, checksumSampleSize: 50 },
      calendar: { status: 'SKIPPED', sourceCount: 0, targetCount: 0, checksumMatches: 0, checksumSampleSize: 0 },
      contacts: { status: 'PASS', sourceCount: 612, targetCount: 612, checksumMatches: 20, checksumSampleSize: 20 },
      files: { status: 'SKIPPED', sourceCount: 0, targetCount: 0, checksumMatches: 0, checksumSampleSize: 0 },
      tasks: { status: 'SKIPPED', sourceCount: 0, targetCount: 0, checksumMatches: 0, checksumSampleSize: 0 },
    },
  },
});

const renderAt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/mappings/m1/report']}>
          <Routes>
            <Route path="/mappings/:mappingId/report" element={<Report />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );

const line = (domain: string) => document.querySelector(`[data-domain="${domain}"]`) as HTMLElement;

beforeEach(() => {
  vi.resetAllMocks();
  fetchReportMock.mockResolvedValue({ report: REPORT, markdown: '# report' });
  fetchVerifyReportMock.mockResolvedValue(check(true));
});
afterEach(() => window.localStorage.removeItem('ownpace.locale'));

describe('a migration’s report, as a page', () => {
  it('says the verdict, and per data type what was found, arrived, left as it was and could not come', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Anna — Gmail to Soverin' })).toBeInTheDocument();
    expect(screen.getByText('Everything has arrived, but some items still wait on a decision.')).toBeInTheDocument();
    const mail = within(line('email'));
    // The state rides with the type's name, so a phone keeps it without a column of its own.
    expect(within(mail.getByText('Email').closest('td')!).getByText('Completed')).toBeInTheDocument();
    expect(mail.getByText('18,300')).toBeInTheDocument();
    expect(mail.getByText('18,234')).toBeInTheDocument();
    expect(mail.getByText('3')).toBeInTheDocument();
    // A count nobody took is said as that, never 0.
    expect(within(line('contact')).getByText('not counted')).toBeInTheDocument();
    expect(within(line('contact')).getByText('402')).toBeInTheDocument();
    expect(screen.getByText('Not part of this migration: tasks.')).toBeInTheDocument();
  });

  it('says why something could not come in the provider’s own words, and where to see which', async () => {
    renderAt();
    expect(await screen.findByText('IMAP FETCH failed: message too large')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See which, and why' })).toHaveAttribute('href', '/mappings/m1/failures');
  });

  it('lists what waits on a decision, each opening its own queue', async () => {
    renderAt();
    expect(await screen.findByRole('link', { name: 'Deletions' })).toHaveAttribute('href', '/mappings/m1/deletions');
    expect(screen.getByText(/2 to decide/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Failures' })).toHaveAttribute('href', '/mappings/m1/failures');
    expect(screen.getByText(/3 could not be copied/)).toBeInTheDocument();
  });

  it('says what was removed and on whose decision, and the access carried over', async () => {
    renderAt();
    expect(
      await screen.findByText(
        '4 removed on a decision, 1 old copies of moved items removed, 0 refused by a safeguard.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2 re-created, 1 done by hand, 0 not carried over, 3 still open.')).toBeInTheDocument();
  });

  it('says what the check compared, with when, per data type', async () => {
    renderAt();
    expect(await screen.findByText('Passed 2 days ago')).toBeInTheDocument();
    const mail = document.querySelector('[data-checked="email"]') as HTMLElement;
    expect(within(mail).getByText('18,297')).toBeInTheDocument();
    expect(within(mail).getByText('50 of 50 the same')).toBeInTheDocument();
  });

  /** Hard rule 9: a check nobody could ask about is not one that never ran. */
  it('says the check could not be read, or was not run, as that', async () => {
    fetchVerifyReportMock.mockRejectedValue(new Error('the database is unreachable'));
    const { unmount } = renderAt();
    await screen.findByRole('heading', { level: 1, name: 'Anna — Gmail to Soverin' });
    expect(await screen.findByText('Could not be read')).toBeInTheDocument();
    unmount();

    fetchVerifyReportMock.mockResolvedValue({ state: 'never-run' });
    renderAt();
    expect(await screen.findByText('Not run yet')).toBeInTheDocument();
  });

  it('names the access only the reader can withdraw, for the kinds this migration used', async () => {
    renderAt();
    expect(await screen.findByText('Access you granted, which only you can withdraw')).toBeInTheDocument();
    // Soverin's password by what to look for, standing as a heading; Google's consent by its own label.
    expect(screen.getByText('Your mail provider’s account or security settings')).toBeInTheDocument();
    expect(screen.getByText('Third-party apps with account access')).toBeInTheDocument();
  });

  it('says that access in Dutch where the words are ours, and keeps the provider’s label as it is', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    renderAt();
    expect(await screen.findByText('Toegang die u gaf en die alleen u kunt intrekken')).toBeInTheDocument();
    expect(screen.getByText('De account- of beveiligingsinstellingen van uw mailaanbieder')).toBeInTheDocument();
    expect(screen.getByText(/zoek naar “app-wachtwoord”/)).toBeInTheDocument();
    expect(screen.getByText('Third-party apps with account access')).toBeInTheDocument();
  });

  it('offers the download as the report, and the confirmed list one link away', async () => {
    renderAt();
    expect(await screen.findByRole('button', { name: 'Download the report' })).toBeInTheDocument();
    expect(screen.queryByText(/Markdown/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'What is confirmed, item by item →' })).toHaveAttribute(
      'href',
      '/mappings/m1/confirmed',
    );
  });

  it('says on an appliance that each removal is in the log, rather than zeros nobody counted', async () => {
    const { applied: _none, ...appliance } = REPORT;
    fetchReportMock.mockResolvedValue({ report: appliance, markdown: '' });
    renderAt();
    expect(await screen.findByText('Each removal is in the log, and was made only on a decision.')).toBeInTheDocument();
  });

  it('says the report could not be read, with the server’s words, and draws nothing that reads as empty', async () => {
    fetchReportMock.mockRejectedValue(new Error('assembling the completion report failed'));
    renderAt();
    expect(await screen.findByText('Could not read this report.')).toBeInTheDocument();
    expect(screen.queryByText('What arrived')).not.toBeInTheDocument();
  });

  it('in Dutch, with Dutch digits', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    renderAt();
    expect(
      await screen.findByText('Alles is aangekomen, maar sommige items wachten nog op een beslissing.'),
    ).toBeInTheDocument();
    expect(within(line('email')).getByText('18.300')).toBeInTheDocument();
    expect(within(line('contact')).getByText('niet geteld')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download het rapport' })).toBeInTheDocument();
  });
});
