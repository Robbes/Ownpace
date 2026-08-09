// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Billing against hard rule 9 (0033 T2's audit clause).
 *
 * Before this: a failed usage read rendered "No usage data available yet" and
 * a failed invoices read fell into the map branch and rendered a silent blank
 * — failures dressed as absence, on the screen where the numbers are money.
 * (Billing's deeper problems — dead buttons, the Base Fee arithmetic, the
 * invoice enum drift — are workplan 0039's; this pins only the read-error
 * discipline.)
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Billing from '../pages/Billing';
import { billingApi } from '../services/billing-service';

vi.mock('../services/billing-service', () => ({
  billingApi: { getCurrentUsage: vi.fn(), listInvoices: vi.fn() },
}));

const usageMock = vi.mocked(billingApi.getCurrentUsage);
const invoicesMock = vi.mocked(billingApi.listInvoices);

const renderBilling = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Billing />
    </QueryClientProvider>
  );
};

describe('Billing — failed reads say so (hard rule 9)', () => {
  beforeEach(() => {
    usageMock.mockReset();
    invoicesMock.mockReset();
  });

  it('a failed usage read renders the failure, not "No usage data available yet"', async () => {
    usageMock.mockRejectedValue(new Error('usage metrics store unavailable'));
    invoicesMock.mockResolvedValue({ invoices: [] });

    renderBilling();

    expect(await screen.findByText('Could not load the usage numbers.')).toBeInTheDocument();
    expect(screen.getByText('usage metrics store unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No usage data available yet')).not.toBeInTheDocument();
  });

  it('a failed invoices read renders the failure, not a silent blank or "No invoices yet"', async () => {
    usageMock.mockRejectedValue(new Error('usage metrics store unavailable'));
    invoicesMock.mockRejectedValue(new Error('invoice table unreachable'));

    renderBilling();

    expect(await screen.findByText('Could not load the invoices.')).toBeInTheDocument();
    expect(screen.getByText('invoice table unreachable')).toBeInTheDocument();
    expect(screen.queryByText('No invoices yet')).not.toBeInTheDocument();
  });
});
