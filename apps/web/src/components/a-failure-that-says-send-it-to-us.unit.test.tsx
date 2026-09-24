// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE THAT SAYS "SEND IT TO US" (workplan 0130 T3; the owner's D2: *"The
 * 'send it to us' failure line would then link to it."*).
 *
 * The `unknown` remedy ends *"send it to us and we will look"*, and until this
 * it did not say how. Now it links to the report form with the page, the
 * category and, where the screen has one, the failure's reference, and the
 * form states all three before anything is sent. This file holds:
 *
 *  - the link, on the progress strip, carrying the strip's reference;
 *  - following it fills the form in;
 *  - a failed item's line (no reference) links with its category only;
 *  - no link for a failure somebody can act on themselves, when the service
 *    takes no reports, or on the appliance, which has no form.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../stores/auth-store.ts';
import { STRINGS } from '../i18n/strings.ts';
import LiveProgress, { type LiveProgressRow } from './LiveProgress.tsx';
import { SendItToUs } from './SendItToUs.tsx';
import ReportProblem from '../pages/ReportProblem.tsx';

const EN = STRINGS.en;
const getMock = vi.fn();
vi.mock('../services/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.ts')>();
  return { ...actual, default: { get: (...args: unknown[]) => getMock(...args), post: vi.fn() } };
});
const edition = vi.hoisted(() => ({ selfhost: false }));
vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => edition.selfhost,
}));

const FAILED: LiveProgressRow = {
  domain: 'contact',
  state: 'failed',
  itemsSynced: 12,
  itemsFailed: 0,
  itemsRetrying: 0,
  lastError: 'PUT failed with status 502',
  lastErrorCategory: 'unknown',
  lastErrorReference: '0a1b2c3d',
};

const at = (path: string, element: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mappings/:id" element={element} />
          <Route path="/report" element={<ReportProblem />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  edition.selfhost = false;
  getMock.mockReset();
  getMock.mockResolvedValue({ data: { available: true } });
  useAuthStore.setState({
    token: 'token',
    user: { id: 'u1', email: 'someone@example.invalid', name: 'Someone', role: 'owner' },
  });
});

describe('the progress strip', () => {
  it('links an unknown failure to the form, with the page, the category and its reference', async () => {
    at('/mappings/acme', <LiveProgress domains={[FAILED]} />);

    const link = await screen.findByRole('link', { name: EN['failure.sendItToUs'] });
    expect(link).toHaveAttribute('href', '/report?from=%2Fmappings%2Facme&category=unknown&reference=0a1b2c3d');
  });

  it('fills the form in when followed', async () => {
    at('/mappings/acme', <LiveProgress domains={[FAILED]} />);

    await userEvent.click(await screen.findByRole('link', { name: EN['failure.sendItToUs'] }));

    expect(
      await screen.findByText(EN['report.reference'].replace('{reference}', '0a1b2c3d')),
    ).toBeInTheDocument();
    expect(screen.getByText(EN['report.category'].replace('{category}', 'unknown'))).toBeInTheDocument();
    expect(screen.getByText(EN['report.page'].replace('{page}', '/mappings/acme'))).toBeInTheDocument();
  });

  it('offers nothing for a failure the person can act on themselves', async () => {
    at('/mappings/acme', <LiveProgress domains={[{ ...FAILED, lastErrorCategory: 'auth_expired' }]} />);

    await screen.findByText(EN['failure.authExpired']);
    expect(screen.queryByRole('link', { name: EN['failure.sendItToUs'] })).toBeNull();
  });
});

describe("a failed item's line", () => {
  it('offers nothing for any category but unknown: each of the others has its own way out', async () => {
    // The item, group and Connections lines pass whatever category they have,
    // so the component is the only thing standing between a customer with an
    // expired connection and a form they do not need.
    // Beside an `unknown` one, so the check below runs once the service has
    // answered, and not before the link could have appeared.
    at(
      '/mappings/acme',
      <>
        <SendItToUs category="auth_expired" />
        <SendItToUs category="unknown" />
      </>,
    );

    const links = await screen.findAllByRole('link', { name: EN['failure.sendItToUs'] });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('category=unknown'));
  });

  it('links with its category, and no reference it does not have', async () => {
    at('/mappings/acme', <SendItToUs category="unknown" />);

    expect(await screen.findByRole('link', { name: EN['failure.sendItToUs'] })).toHaveAttribute(
      'href',
      '/report?from=%2Fmappings%2Facme&category=unknown',
    );
  });
});

describe('where a report could not reach anybody', () => {
  it('offers nothing when the service takes no reports', async () => {
    getMock.mockResolvedValue({ data: { available: false } });
    at('/mappings/acme', <LiveProgress domains={[FAILED]} />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: EN['failure.sendItToUs'] })).toBeNull();
  });

  it('offers nothing on the appliance, which has no form', async () => {
    edition.selfhost = true;
    at('/mappings/acme', <LiveProgress domains={[FAILED]} />);

    await screen.findByText(EN['failure.unknown']);
    expect(screen.queryByRole('link', { name: EN['failure.sendItToUs'] })).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });
});
