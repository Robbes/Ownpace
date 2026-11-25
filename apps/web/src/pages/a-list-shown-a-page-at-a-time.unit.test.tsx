// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two support lists the API serves a page at a time (an outside,
 * read-only check, PERF-2; workplan 0006 §P; the owner, 2026-11-24: *"page
 * both (Show more) in alpha.20; a plain maximum would hide rows from the
 * operator"*).
 *
 * What a person using these screens could be misled about:
 *
 *  1. **That a list of one page has more.** *Show more* appears only when the
 *     API said there is a next page, so the first page looks as it did.
 *  2. **That rows are hidden.** Pressing it fetches the next page with the
 *     cursor the last one gave, and adds it below what is shown; the button
 *     goes once the last page says there is nothing after it.
 *  3. **That a page is read before anybody asked.** Each page is a read the
 *     log records, so nothing past the first is fetched until the press.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupportTenants, SupportRetainedInvoices } from './Support.tsx';
import {
  listSupportTenants,
  listRetainedInvoices,
  getSupportPlatform,
  type SupportTenant,
  type SupportRetainedInvoice,
  type SupportErasedInvoiceNumbers,
} from '../services/support.ts';
import { OPERATOR_STRINGS } from '../i18n/operator-strings.ts';

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

const MORE = OPERATOR_STRINGS['support.more'];

const tenant = (n: number): SupportTenant => ({
  tenant_id: `a11ce000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  tenant_name: `Organisation ${n}`,
  tenant_status: 'active',
  joined_at: '2026-10-01T09:00:00.000Z',
  migration_count: '1',
  failing_domain_count: '0',
  pending_decision_count: '0',
  connection_count: '1',
  member_count: '1',
  last_pass_at: null,
  closed_at: null,
  purge_after: null,
});

const invoice = (n: number): SupportRetainedInvoice => ({
  tenant_ref: n.toString(16).padStart(64, '0'),
  erasure_requested_at: '2026-06-01T00:00:00.000Z',
  purged_at: '2026-07-01T00:00:00.000Z',
  invoice_id: `b11ce000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  billed_to_name: `Billed ${n}`,
  period_start: '2026-05-01',
  period_end: '2026-05-31',
  status: 'paid',
  total: '10.00',
  currency: 'EUR',
  paid_at: null,
});

const numbers = (n: number): SupportErasedInvoiceNumbers => ({
  tenant_ref: (1000 + n).toString(16).padStart(64, '0'),
  erasure_requested_at: '2026-06-01T00:00:00.000Z',
  purged_at: '2026-07-01T00:00:00.000Z',
  invoice_numbers: [`2026-${String(n).padStart(4, '0')}`],
});

const mount = (ui: React.ReactNode, path: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.mocked(listSupportTenants).mockReset();
  vi.mocked(listRetainedInvoices).mockReset();
  vi.mocked(getSupportPlatform)
    .mockReset()
    .mockResolvedValue({ ready: { status: 'ok', database: 'up', signIn: 'up' }, statusPage: { state: 'off' } });
});

describe('the organisations', () => {
  it('shows no Show more when the one page is all there is', async () => {
    vi.mocked(listSupportTenants).mockResolvedValue({ tenants: [tenant(1), tenant(2)], next: null });
    mount(<SupportTenants />, '/support');
    expect(await screen.findByRole('link', { name: 'Organisation 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: MORE })).not.toBeInTheDocument();
    expect(vi.mocked(listSupportTenants)).toHaveBeenCalledTimes(1);
  });

  it('shows no Show more for an empty list', async () => {
    vi.mocked(listSupportTenants).mockResolvedValue({ tenants: [], next: null });
    mount(<SupportTenants />, '/support');
    expect(await screen.findByText(OPERATOR_STRINGS['support.noOrganisations'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: MORE })).not.toBeInTheDocument();
  });

  it('shows Show more when there is more, adds the next page below, and goes on the last', async () => {
    vi.mocked(listSupportTenants)
      .mockResolvedValueOnce({ tenants: [tenant(1), tenant(2)], next: 'cursor-one' })
      .mockResolvedValueOnce({ tenants: [tenant(3)], next: null });
    mount(<SupportTenants />, '/support');
    const more = await screen.findByRole('button', { name: MORE });
    // Nothing past the first page until somebody asks: each page is a read.
    expect(vi.mocked(listSupportTenants)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listSupportTenants)).toHaveBeenLastCalledWith(undefined);

    fireEvent.click(more);
    expect(await screen.findByRole('link', { name: 'Organisation 3' })).toBeInTheDocument();
    expect(vi.mocked(listSupportTenants)).toHaveBeenLastCalledWith('cursor-one');
    // The first page is still there: added to, not replaced.
    expect(screen.getByRole('link', { name: 'Organisation 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: MORE })).not.toBeInTheDocument();
  });
});

describe('what an erasure kept', () => {
  it('shows no Show more when the one page is all there is', async () => {
    vi.mocked(listRetainedInvoices).mockResolvedValue({
      invoices: [invoice(1)],
      numbers: [numbers(1)],
      next: null,
    });
    mount(<SupportRetainedInvoices />, '/support/retained-invoices');
    expect(await screen.findByText('Billed 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: MORE })).not.toBeInTheDocument();
  });

  it('adds each list’s next rows to that list, and goes on the last page', async () => {
    vi.mocked(listRetainedInvoices)
      .mockResolvedValueOnce({ invoices: [invoice(1)], numbers: [numbers(1)], next: 'cursor-one' })
      // The invoices ended on the first page; only the numbers go on.
      .mockResolvedValueOnce({ invoices: [], numbers: [numbers(2)], next: null });
    mount(<SupportRetainedInvoices />, '/support/retained-invoices');
    fireEvent.click(await screen.findByRole('button', { name: MORE }));
    expect(await screen.findByText('2026-0002')).toBeInTheDocument();
    expect(vi.mocked(listRetainedInvoices)).toHaveBeenLastCalledWith('cursor-one');
    expect(screen.getByText('2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Billed 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: MORE })).not.toBeInTheDocument();
  });
});
