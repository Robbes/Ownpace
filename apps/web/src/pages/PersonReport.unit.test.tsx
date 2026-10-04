// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S REPORT (workplan 0154 T5): each of their migrations in the
 * section a migration's own report draws, each with its own download and its
 * own page. One report that could not be read says so in its section, and the
 * others still stand; a person nobody holds is said as that (hard rule 9).
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lifecycleCounts, type Person } from '@openmig/shared';
import type { ReadReport } from '../services/report-service.ts';

const { fetchReportMock, fetchVerifyReportMock, fetchPeopleMock } = vi.hoisted(() => ({
  fetchReportMock: vi.fn(),
  fetchVerifyReportMock: vi.fn(),
  fetchPeopleMock: vi.fn(),
}));
vi.mock('../services/report-service', () => ({ fetchReport: fetchReportMock }));
vi.mock('../services/operating-service', () => ({
  fetchVerifyReport: fetchVerifyReportMock,
  fetchPeople: fetchPeopleMock,
  fetchCompletionReport: vi.fn(),
}));

import PersonReport from './PersonReport.tsx';

const report = (mappingId: string, name: string): ReadReport => ({
  mappingId,
  name,
  sourceType: 'gmail',
  targetType: 'soverin',
  lifecycle: 'active',
  generatedAt: '2026-10-03T21:00:00.000Z',
  domains: [{ domain: 'email', state: 'completed', itemsSynced: 12, itemsFailed: 0, bytesTransferred: 0, itemsFound: 12 }],
  queues: { movesOpen: 0, movesAcknowledged: 0, relocationsOpen: 0, deletionsOpen: 0, deletionsAcknowledged: 0, failuresNeedingDecision: 0 },
  verdict: 'complete',
});

const ANNA: Person = {
  id: 'p-anna',
  implicit: false,
  displayName: 'Anna Jansen',
  email: null,
  createdAt: '2026-09-28T10:00:00.000Z',
  migrations: [
    { id: 'm-mail', status: 'active' },
    { id: 'm-files', status: 'active' },
  ],
  counts: lifecycleCounts([
    { id: 'm-mail', status: 'active' },
    { id: 'm-files', status: 'active' },
  ]),
};

const renderAt = (path = '/people/p-anna/report') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people/:personId/report" element={<PersonReport />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  fetchPeopleMock.mockResolvedValue({ people: [ANNA], unassigned: [] });
  fetchVerifyReportMock.mockResolvedValue({ state: 'never-run' });
  fetchReportMock.mockImplementation(async (id: string) =>
    id === 'm-mail'
      ? { report: report('m-mail', 'Anna — Gmail to Soverin'), markdown: '' }
      : Promise.reject(new Error('the files report could not be assembled')),
  );
});

describe('a person’s report', () => {
  it('draws each migration in its own section, each linking its own page, and back to the person', async () => {
    renderAt();
    expect(await screen.findByRole('heading', { level: 1, name: 'Report: Anna Jansen' })).toBeInTheDocument();
    const mail = await screen.findByRole('link', { name: 'Anna — Gmail to Soverin' });
    expect(mail).toHaveAttribute('href', '/mappings/m-mail/report');
    expect(screen.getByText('Complete: everything has arrived, and nothing waits on a decision.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Anna Jansen' })).toHaveAttribute('href', '/people/p-anna');
    expect(screen.getAllByRole('button', { name: 'Download the report' })).toHaveLength(2);
  });

  it('says one report could not be read in its own section, and the other still stands', async () => {
    renderAt();
    const failed = await screen.findByText(/the files report could not be assembled/);
    const section = failed.closest('section') as HTMLElement;
    expect(within(section).getByText(/Could not read this report\./)).toBeInTheDocument();
    expect(await screen.findByText('Not run yet')).toBeInTheDocument();
  });

  it('says there is no such person, rather than a report of nothing', async () => {
    renderAt('/people/p-nobody/report');
    expect(await screen.findByText('There is no such person here.')).toBeInTheDocument();
    expect(fetchReportMock).not.toHaveBeenCalled();
  });
});
