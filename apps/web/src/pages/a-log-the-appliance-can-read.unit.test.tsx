// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THE APPLIANCE CAN READ (workplan 0129 T2, the appliance's half; the
 * owner's D5: "same page").
 *
 * The appliance's owner gets the page the managed operator gets, the same
 * rows and filters (`a-log-the-operator-can-read` holds those), with the two
 * differences its reader makes:
 *
 *  - it reads the appliance's own `/log`, never managed's `/support/log`;
 *  - it has no disclosure and no way back to Support. The reader is the
 *    owner, looking at their own appliance, and nothing records the read.
 *
 * A search is still a link, under `/log`.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OperatorLogEntry, OperatorLogPage } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';
import { readSupportLog } from '../services/support.ts';
import { readApplianceLog } from '../services/operating-service.ts';
import { ApplianceLog } from './Support.tsx';

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
vi.mock('../services/operating-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/operating-service.ts')>()),
  readApplianceLog: vi.fn(),
}));

const EN = STRINGS.en;
const logMock = vi.mocked(readApplianceLog);

const TENANT = '0e2c0000-e29b-41d4-a716-446655440001';
const MAPPING = '0e2c0000-e29b-41d4-a716-446655440031';

const FAILED: OperatorLogEntry = {
  id: '0e2c0000-e29b-41d4-a716-446655440101',
  at: '2026-09-23T10:04:00.000000Z',
  source: 'app',
  level: 'error',
  tenant_id: TENANT,
  tenant_name: 'Tenant 0e2c0000',
  mapping_id: MAPPING,
  migration_name: 'Finance mail',
  event: 'sync.calendar.failed',
  category: 'auth_expired',
  reference: '0a1b2c3d',
  actor: null,
};

const page = (entries: OperatorLogEntry[], next: OperatorLogPage['next'] = null): OperatorLogPage => ({
  entries,
  next,
  limit: 100,
});

const mount = (path = '/log') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/log" element={<ApplianceLog />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  logMock.mockReset();
  logMock.mockResolvedValue(page([FAILED]));
  vi.mocked(readSupportLog).mockReset();
});

describe("the appliance's log page", () => {
  it("reads the appliance's own /log, never managed's", async () => {
    mount();

    expect(await screen.findByText('sync.calendar.failed')).toBeVisible();
    expect(logMock).toHaveBeenCalledWith({});
    expect(readSupportLog).not.toHaveBeenCalled();
    expect(screen.getByText('Finance mail')).toBeVisible();
  });

  it('has no disclosure and no way back to Support: the owner reads their own appliance', async () => {
    mount();
    await screen.findByText('sync.calendar.failed');

    expect(screen.queryByText(EN['support.recorded'])).toBeNull();
    expect(screen.queryByRole('link', { name: EN['support.back'] })).toBeNull();
  });

  it("narrows to a row's migration under /log", async () => {
    mount();
    await screen.findByText('sync.calendar.failed');

    const link = screen.getAllByRole('link', { name: 'Finance mail' })[0]!;
    expect(link).toHaveAttribute('href', `/log?mappingId=${MAPPING}`);
    await userEvent.click(link);

    await waitFor(() => expect(logMock).toHaveBeenLastCalledWith({ mappingId: MAPPING }));
  });

  it('continues from the cursor under /log, and goes back to the newest there', async () => {
    const cursor = { before: '2026-09-23T10:04:00.000000Z', beforeId: FAILED.id };
    logMock.mockResolvedValueOnce(page([FAILED], cursor));
    mount();
    await screen.findByText('sync.calendar.failed');

    await userEvent.click(screen.getByRole('link', { name: EN['support.log.older'] }));

    await waitFor(() => expect(logMock).toHaveBeenLastCalledWith(cursor));
    expect(await screen.findByRole('link', { name: EN['support.log.newest'] })).toHaveAttribute('href', '/log');
  });
});
