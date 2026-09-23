// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130 T1): the form says what it will send
 * before it sends it, and sends exactly that.
 *
 * What arrives in the URL (the page, a reference, a category) is anybody's to
 * edit, so the form shows and sends the page as a report records it, without a
 * link secret or a query, and drops a reference or a category that is not one.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../stores/auth-store.ts';
import { STRINGS } from '../i18n/strings.ts';
import { reportablePage } from '../services/problem-report-service.ts';
import ReportProblem from './ReportProblem.tsx';

const EN = STRINGS.en;
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

const renderPage = (path: string) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <ReportProblem />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  getMock.mockResolvedValue({ data: { available: true } });
  postMock.mockResolvedValue({ data: { ticket: '31001' } });
  useAuthStore.setState({
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

describe('the page a report records', () => {
  it('keeps no link secret and no query', () => {
    expect(reportablePage('/grant/abc.secret/google')).toBe('/grant/:link/google');
    expect(reportablePage('/view/abc.secret')).toBe('/view/:link');
    expect(reportablePage('/mappings/1/failures?code=x')).toBe('/mappings/1/failures?...');
    expect(reportablePage('/mappings/1/failures')).toBe('/mappings/1/failures');
  });
});

describe('Report a problem', () => {
  it('says what goes with the report, and where the reply goes, before it is sent', async () => {
    renderPage('/report?from=%2Fgrant%2Fabc.secret%2Fgoogle&reference=0a1b2c3d&category=unknown');

    expect(await screen.findByText(EN['report.sentWith'])).toBeVisible();
    expect(screen.getByText(EN['report.page'].replace('{page}', '/grant/:link/google'))).toBeVisible();
    expect(screen.getByText(EN['report.reference'].replace('{reference}', '0a1b2c3d'))).toBeVisible();
    expect(screen.getByText(EN['report.category'].replace('{category}', 'unknown'))).toBeVisible();
    expect(screen.getByText(EN['report.replyTo'].replace('{email}', 'someone@example.invalid'))).toBeVisible();
    expect(document.body.textContent).not.toContain('abc.secret');
  });

  it('drops a reference or a category that is not one', async () => {
    renderPage('/report?from=%2F&reference=not-a-ref&category=it%20broke');

    await screen.findByText(EN['report.sentWith']);
    expect(document.body.textContent).not.toContain('not-a-ref');
    expect(document.body.textContent).not.toContain('it broke');
  });

  it('sends what it said, and answers with the ticket number', async () => {
    renderPage('/report?from=%2Fgrant%2Fabc.secret%2Fgoogle&reference=0a1b2c3d');
    await userEvent.type(await screen.findByLabelText(EN['report.description']), 'The Moves screen is empty');
    await userEvent.click(screen.getByRole('button', { name: EN['report.send'] }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/problem-reports', {
      description: 'The Moves screen is empty',
      page: '/grant/:link/google',
      reference: '0a1b2c3d',
    });
    expect(
      await screen.findByText(
        EN['report.sent'].replace('{ticket}', '31001').replace('{email}', 'someone@example.invalid'),
      ),
    ).toBeVisible();
  });

  it('refuses a screenshot that is not a PNG or a JPEG, before anything is sent', async () => {
    renderPage('/report?from=%2F');
    const input = (await screen.findByLabelText(EN['report.screenshot'])) as HTMLInputElement;
    await userEvent.upload(input, new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }), {
      applyAccept: false,
    });

    expect(await screen.findByText(EN['report.screenshotType'])).toBeVisible();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('says so when the service takes no reports', async () => {
    getMock.mockResolvedValue({ data: { available: false } });
    renderPage('/report?from=%2F');

    expect(await screen.findByText(EN['report.unavailable'])).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['report.send'] })).toBeNull();
  });
});
