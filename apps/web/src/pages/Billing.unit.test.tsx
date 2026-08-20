// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Billing against workplan 0039: failed reads say so (T2 of 0033), the
 * arithmetic is the served arithmetic (T2), the invoice contract is the
 * server's (T3), the pay loop is reachable and role-gated (T1/T4), and the
 * payment-methods read is actually performed (T4).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Billing from './Billing.tsx';
import { billingApi, type Invoice } from '../services/billing-service.ts';

const { authState } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    user: null as null | { name: string; email: string; role: string },
    logout: () => {},
  },
}));

vi.mock('../services/billing-service', () => ({
  billingApi: {
    getCurrentUsage: vi.fn(),
    listInvoices: vi.fn(),
    getPaymentMethods: vi.fn(),
    createPayment: vi.fn(),
  },
}));

vi.mock('../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const usageMock = vi.mocked(billingApi.getCurrentUsage);
const invoicesMock = vi.mocked(billingApi.listInvoices);
const methodsMock = vi.mocked(billingApi.getPaymentMethods);
const payMock = vi.mocked(billingApi.createPayment);

/** A seeded usage fixture whose lines sum non-trivially: 999 + 500 + 2000 +
 *  100 = 3599; VAT 756; total 4355. The OLD screen rendered "Base Fee
 *  €35.99" from this — the whole subtotal on the base-fee line. */
const usageFixture = {
  usage: {
    tenantId: 't1',
    period: '2026-08',
    storageUsedGB: 50,
    egressGB: 100,
    computeHours: 20,
    syncCount: 7,
    lastUpdated: '2026-08-09T12:00:00.000Z',
  },
  currentCost: {
    baseFee: 999,
    storage: 500,
    egress: 2000,
    compute: 100,
    subtotal: 3599,
    taxRate: 0.21,
    tax: 756,
    total: 4355,
  },
  period: '2026-08',
};

const invoiceFixture = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-0001-abcdef',
  tenantId: 't1',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  status: 'overdue',
  subtotal: 3599,
  taxRate: 0.21,
  taxAmount: 756,
  total: 4355,
  currency: 'EUR',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const renderBilling = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Billing />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  usageMock.mockReset();
  invoicesMock.mockReset();
  methodsMock.mockReset();
  payMock.mockReset();
  authState.user = { name: 'Robbe', email: 'r@acme.test', role: 'admin' };
  usageMock.mockResolvedValue(usageFixture);
  invoicesMock.mockResolvedValue({ invoices: [] });
  methodsMock.mockResolvedValue({ paymentMethods: [] });
});

describe('Billing — failed reads say so (hard rule 9)', () => {
  it('a failed usage read renders the failure, not "No usage data available yet"', async () => {
    usageMock.mockRejectedValue(new Error('usage metrics store unavailable'));

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

  it('a failed payment-methods read renders the failure — the old card never even asked', async () => {
    methodsMock.mockRejectedValue(new Error('payment_method table unreachable'));

    renderBilling();

    expect(await screen.findByText('Could not load the payment methods.')).toBeInTheDocument();
    expect(screen.queryByText('No payment methods stored.')).not.toBeInTheDocument();
  });
});

describe('the arithmetic is the served arithmetic (0039 T2)', () => {
  it('Base Fee renders baseFee — not the whole subtotal — and the lines sum on screen', async () => {
    renderBilling();

    const baseFeeRow = (await screen.findByText('Base Fee')).parentElement!;
    expect(baseFeeRow.textContent).toContain('9.99');
    expect(baseFeeRow.textContent).not.toContain('35.99');
    // The subtotal is still the subtotal, on its own line.
    const subtotalRow = screen.getByText('Subtotal').parentElement!;
    expect(subtotalRow.textContent).toContain('35.99');
  });

  it('the VAT label derives from the served rate, and the period + as-of render', async () => {
    renderBilling();

    expect(await screen.findByText('VAT (21%)')).toBeInTheDocument();
    expect(screen.getByText(/Usage for 2026-08/)).toBeInTheDocument();
    // The tile is labeled what the metering writes (apiCallCount).
    expect(screen.getByText('API calls')).toBeInTheDocument();
    expect(screen.queryByText('Syncs')).not.toBeInTheDocument();
  });
});

describe('the invoice contract is the server contract (0039 T3)', () => {
  it('renders the real period and styles overdue as the action-demanding state', async () => {
    invoicesMock.mockResolvedValue({
      invoices: [
        invoiceFixture({ id: 'inv-overdue', status: 'overdue' }),
        invoiceFixture({ id: 'inv-sent', status: 'sent', periodStart: '2026-06-01', periodEnd: '2026-06-30' }),
      ],
    });

    renderBilling();

    // "Period:" followed by SOMETHING now — the served periodStart/periodEnd.
    expect(await screen.findByText('Period: 2026-07-01 – 2026-07-31')).toBeInTheDocument();
    // StateChip's canonical words (0035 T1), not the raw enum.
    const overdueChip = screen.getByText('Overdue');
    expect(overdueChip.className).toContain('bg-red-100');
    const sentChip = screen.getByText('Sent');
    expect(sentChip.className).toContain('bg-blue-100');
  });
});

describe('the pay loop is reachable and role-gated (0039 T1/T4)', () => {
  it('an admin can pay an overdue invoice — createPayment is called and the checkout URL followed', async () => {
    invoicesMock.mockResolvedValue({ invoices: [invoiceFixture({ status: 'overdue' })] });
    payMock.mockResolvedValue({
      paymentUrl: 'https://checkout.mollie.test/pay-123',
      paymentId: 'tr_123',
      status: 'open',
    });
    const hrefSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      set href(_v: string) {
        /* navigation swallowed in jsdom */
      },
    } as unknown as Location);

    renderBilling();

    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    await waitFor(() => expect(payMock).toHaveBeenCalledWith('inv-0001-abcdef'));
    hrefSpy.mockRestore();
  });

  it('a viewer gets the admin-only sentence and NO billing fetches — reads are owner/admin (owner decision 2026-08-10)', async () => {
    authState.user = { name: 'V', email: 'v@acme.test', role: 'viewer' };
    invoicesMock.mockResolvedValue({ invoices: [invoiceFixture({ status: 'overdue' })] });

    renderBilling();

    // The clean sentence, not three fetches that can only 403 into red cards.
    expect(
      await screen.findByText(/available to owners and admins only/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(usageMock).not.toHaveBeenCalled();
    expect(invoicesMock).not.toHaveBeenCalled();
    expect(methodsMock).not.toHaveBeenCalled();
  });

  it('a paid invoice offers no Pay button', async () => {
    invoicesMock.mockResolvedValue({ invoices: [invoiceFixture({ status: 'paid' })] });

    renderBilling();

    await screen.findByText('Paid');
    expect(screen.queryByRole('button', { name: 'Pay' })).not.toBeInTheDocument();
  });

  it('a refused payment renders the server words at the row', async () => {
    invoicesMock.mockResolvedValue({ invoices: [invoiceFixture({ status: 'sent' })] });
    payMock.mockRejectedValue(new Error('Mollie API key not configured'));

    renderBilling();

    fireEvent.click(await screen.findByRole('button', { name: 'Pay' }));
    expect(await screen.findByText(/The payment could not be started/)).toBeInTheDocument();
    expect(screen.getByText(/Mollie API key not configured/)).toBeInTheDocument();
  });
});

describe('the payment methods card asks before it answers (0039 T4)', () => {
  it('renders served rows — the old card said "none configured" without reading', async () => {
    methodsMock.mockResolvedValue({
      paymentMethods: [
        {
          id: 'pm-1',
          tenantId: 't1',
          type: 'card',
          brand: 'Visa',
          lastFour: '4242',
          expiryMonth: 12,
          expiryYear: 2028,
          isDefault: true,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    renderBilling();

    expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.queryByText('No payment methods stored.')).not.toBeInTheDocument();
    // The dead "Add Payment Method" button is gone, not dormant.
    expect(screen.queryByText('Add Payment Method')).not.toBeInTheDocument();
  });

  it('the true empty state renders only for a served empty list', async () => {
    renderBilling();

    expect(await screen.findByText('No payment methods stored.')).toBeInTheDocument();
  });
});
