// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THE OPERATOR CAN READ (workplan 0129 T2): the page.
 *
 * It shows what the view serves and nothing it could make up: time, level,
 * organisation, migration, event, category, reference, and who acted. Its
 * filters live in the address, so a search is a link: the form writes them
 * there, a row's organisation or migration narrows the page to it, and
 * "Older" is the same page with the cursor the API handed back.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STRINGS } from '../i18n/strings.ts';
import { readSupportLog, type SupportLogEntry, type SupportLogPage } from '../services/support.ts';
import { SupportLog } from './Support.tsx';

vi.mock('../services/support.ts', () => ({
  listSupportTenants: vi.fn(),
  getSupportTenant: vi.fn(),
  getSupportMigration: vi.fn(),
  searchSupportPeople: vi.fn(),
  recordPersonOpened: vi.fn(),
  getSupportPlatform: vi.fn(),
  listRetainedInvoices: vi.fn(),
  readSupportLog: vi.fn(),
}));

const EN = STRINGS.en;
const logMock = vi.mocked(readSupportLog);

const TENANT = '0e2b0000-e29b-41d4-a716-446655440001';
const MAPPING = '0e2b0000-e29b-41d4-a716-446655440031';

const FAILED: SupportLogEntry = {
  id: '0e2b0000-e29b-41d4-a716-446655440101',
  at: '2026-09-23T10:04:00.000000Z',
  source: 'app',
  level: 'error',
  tenant_id: TENANT,
  tenant_name: 'Alpha BV',
  mapping_id: MAPPING,
  migration_name: 'Alpha migration',
  event: 'sync.calendar.failed',
  category: 'auth_expired',
  reference: '0a1b2c3d',
  actor: null,
};

const PAUSED: SupportLogEntry = {
  id: '0e2b0000-e29b-41d4-a716-446655440102',
  at: '2026-09-23T10:00:00.000000Z',
  source: 'audit',
  level: 'info',
  tenant_id: TENANT,
  tenant_name: 'Alpha BV',
  mapping_id: MAPPING,
  migration_name: 'Alpha migration',
  event: 'mapping.status',
  category: null,
  reference: null,
  actor: 'jan@alpha.invalid',
};

const page = (entries: SupportLogEntry[], next: SupportLogPage['next'] = null): SupportLogPage => ({
  entries,
  next,
  limit: 100,
});

const mount = (path = '/support/log') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/support/log" element={<SupportLog />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  logMock.mockReset();
  logMock.mockResolvedValue(page([FAILED, PAUSED]));
});

describe('the log page', () => {
  it('shows what the log serves: the level, the organisation, the event, and who acted', async () => {
    mount();

    expect(await screen.findByText('sync.calendar.failed')).toBeVisible();
    expect(logMock).toHaveBeenCalledWith({});
    expect(screen.getByText(EN['support.recorded'])).toBeVisible();
    const [failed, paused] = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    for (const text of [EN['support.log.level.error'], 'Alpha BV', 'Alpha migration', 'auth_expired', '0a1b2c3d']) {
      expect(within(failed!).getByText(text)).toBeVisible();
    }
    // An application event was acted on by the service, not by a person.
    expect(within(failed!).getByText(EN['support.log.byTheService'])).toBeVisible();
    for (const text of [EN['support.log.level.info'], 'mapping.status', 'jan@alpha.invalid']) {
      expect(within(paused!).getByText(text)).toBeVisible();
    }
  });

  it('reads its filters from the address, and names the organisation it is narrowed to', async () => {
    mount(`/support/log?tenantId=${TENANT}&level=error`);

    await screen.findByText('sync.calendar.failed');
    expect(logMock).toHaveBeenCalledWith({ tenantId: TENANT, level: 'error' });
    expect(screen.getByText(EN['support.log.organisation'].replace('{name}', 'Alpha BV'))).toBeVisible();
  });

  it('searches with what the form holds, and keeps the organisation it was narrowed to', async () => {
    mount(`/support/log?tenantId=${TENANT}`);
    await screen.findByText('sync.calendar.failed');

    await userEvent.selectOptions(screen.getByLabelText(EN['support.log.level']), 'error');
    await userEvent.type(screen.getByLabelText(EN['support.log.event']), 'sync.');
    await userEvent.selectOptions(screen.getByLabelText(EN['support.log.category']), 'auth_expired');
    await userEvent.type(screen.getByLabelText(EN['support.log.reference']), '0A1B2C3D');
    await userEvent.type(screen.getByLabelText(EN['support.log.from']), '2026-09-20');
    await userEvent.type(screen.getByLabelText(EN['support.log.to']), '2026-09-23');
    await userEvent.click(screen.getByRole('button', { name: EN['support.log.search'] }));

    await waitFor(() =>
      expect(logMock).toHaveBeenLastCalledWith({
        tenantId: TENANT,
        level: 'error',
        event: 'sync.',
        category: 'auth_expired',
        reference: '0A1B2C3D',
        since: '2026-09-20T00:00:00Z',
        // The whole of the last day: the API's `before` is exclusive.
        before: '2026-09-24T00:00:00.000Z',
      }),
    );
  });

  it("narrows to a row's migration when its name is followed", async () => {
    mount();
    await screen.findByText('sync.calendar.failed');

    await userEvent.click(screen.getAllByRole('link', { name: 'Alpha migration' })[0]!);

    await waitFor(() => expect(logMock).toHaveBeenLastCalledWith({ mappingId: MAPPING }));
  });

  it('continues from the cursor the API handed back, and can go back to the newest', async () => {
    const cursor = { before: '2026-09-23T10:00:00.000000Z', beforeId: PAUSED.id };
    logMock.mockResolvedValueOnce(page([FAILED, PAUSED], cursor));
    mount();
    await screen.findByText('sync.calendar.failed');

    await userEvent.click(screen.getByRole('link', { name: EN['support.log.older'] }));

    await waitFor(() => expect(logMock).toHaveBeenLastCalledWith(cursor));
    expect(await screen.findByRole('link', { name: EN['support.log.newest'] })).toHaveAttribute(
      'href',
      '/support/log',
    );
  });

  it("says the server's own sentence when a filter in the address is refused", async () => {
    const refusal = new AxiosError('Request failed with status code 400');
    refusal.response = {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'Bad request', field: 'reference', message: 'A reference is eight characters, 0-9 and a-f.' },
    };
    logMock.mockRejectedValue(refusal);
    mount('/support/log?reference=xyz');

    expect(await screen.findByText('A reference is eight characters, 0-9 and a-f.')).toBeVisible();
  });
});
