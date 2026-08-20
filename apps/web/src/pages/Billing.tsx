// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Billing — the screen where numbers become money (workplan 0039).
 *
 * Rebuilt from the fleet's findings: the Base Fee line rendered the entire
 * subtotal (itemized lines summed to double the printed subtotal), the VAT
 * label hardcoded 21% beside a served rate, every amount was hand-formatted
 * EN-style, the invoice period rendered "Period:" followed by nothing (the
 * client typed Stripe vocabulary against a Mollie enum), `overdue` — the one
 * status demanding action — wore neutral gray, the Payment Methods card
 * hardcoded its empty state without ever performing the read, and the two
 * buttons on the screen did nothing at all.
 *
 * Fully bilingual since 0035 T2/T4 (the 0024-T5 fold executed) — every
 * sentence goes through the dictionary.
 */
import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard, TrendingUp, DollarSign, FileText, AlertCircle, Loader2 } from 'lucide-react';
import { billingApi, type Invoice } from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT, useFormatters } from '../i18n/index.tsx';
import StateChip from '../components/StateChip.tsx';

/** A failed read said as such (hard rule 9 / 0033 T2) — before this, a failed
 *  usage read rendered "No usage data available yet" and a failed invoices
 *  read rendered a silent blank, both on the screen where numbers are money. */
const ReadFailed: React.FC<{ heading: string; error: unknown; footnote: string }> = ({
  heading,
  error,
  footnote,
}) => (
  <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
    <div>
      <p className="font-medium">{heading}</p>
      <p className="mt-1">{serverMessage(error)}</p>
      <p className="mt-1">{footnote}</p>
    </div>
  </div>
);

const Billing: React.FC = () => {
  const t = useT();
  const { currency, dateTime } = useFormatters();
  const { user } = useAuthStore();
  // Mirrors the server's requireRole('owner','admin') — which since the
  // 2026-08-10 owner decision guards the billing READS as well as the
  // writes. A lesser role gets a clean sentence instead of three fetches
  // that can only come back 403 as red error cards.
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const { data: usage, isLoading: usageLoading, error: usageError } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => billingApi.getCurrentUsage(),
    enabled: canManage,
  });

  const { data: invoices, isLoading: invoicesLoading, error: invoicesError, refetch: refetchInvoices } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => billingApi.listInvoices(),
    enabled: canManage,
  });

  // The Payment Methods read is PERFORMED now (0039 T4) — the old card
  // hardcoded "no payment methods configured" without asking, so a tenant
  // WITH stored methods was told they had none.
  const { data: methods, isLoading: methodsLoading, error: methodsError } = useQuery({
    queryKey: ['billing-payment-methods'],
    queryFn: () => billingApi.getPaymentMethods(),
    enabled: canManage,
  });

  // The Mollie pay loop, finally reachable (0039 T4): create the payment,
  // follow the checkout URL. Failures render at the row, verbatim.
  const [payError, setPayError] = React.useState<{ invoiceId: string; text: string } | null>(null);
  const payMutation = useMutation({
    mutationFn: (invoiceId: string) => billingApi.createPayment(invoiceId),
    onSuccess: (result) => {
      window.location.href = result.paymentUrl;
    },
    onError: (error, invoiceId) => {
      setPayError({ invoiceId, text: serverMessage(error) });
      void refetchInvoices();
    },
  });

  // Billing is owner/admin territory in both directions (2026-08-10): for a
  // lesser role, say so — the nav entry is hidden too, but a typed URL still
  // lands here and deserves the sentence, not a spinner over three 403s.
  if (!canManage) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('billing.title')}</h1>
          <p className="text-gray-500 mt-1">{t('billing.subtitle')}</p>
        </div>
        <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
          {t('billing.adminOnly')}
        </p>
      </div>
    );
  }

  if (usageLoading || invoicesLoading || methodsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('billing.title')}</h1>
        <p className="text-gray-500 mt-1">{t('billing.subtitle')}</p>
      </div>

      {/* Current Usage */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('billing.currentUsage')}</h2>
          {usage && (
            // WHICH month, and how fresh — the served period and lastUpdated
            // were discarded before (0039 T2; 0036's as-of species).
            <p className="text-sm text-gray-500">
              {t('billing.usagePeriod')} {usage.usage.period} · {t('billing.asOf')}{' '}
              {dateTime(usage.usage.lastUpdated)}
            </p>
          )}
        </div>

        {usageError != null ? (
          <ReadFailed
            heading={t('billing.usageLoadFailed')}
            error={usageError}
            footnote={t('billing.loadFailedNotEmpty')}
          />
        ) : usage ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center">
                  <TrendingUp className="w-5 h-5 text-blue-600 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">{t('billing.storage')}</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {usage.usage.storageUsedGB.toFixed(1)} GB
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center">
                  <DollarSign className="w-5 h-5 text-green-600 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">{t('billing.dataTransfer')}</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {usage.usage.egressGB.toFixed(1)} GB
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center">
                  <CreditCard className="w-5 h-5 text-purple-600 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">{t('billing.computeTime')}</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {usage.usage.computeHours.toFixed(1)} {t('billing.hours')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-yellow-50 rounded-lg">
                <div className="flex items-center">
                  <FileText className="w-5 h-5 text-yellow-600 mr-2" />
                  <div>
                    {/* Labeled what the metering actually writes here
                        (apiCallCount) — "Syncs" promised a count nothing
                        records (0039 T2). */}
                    <p className="text-sm text-gray-600">{t('billing.apiCalls')}</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {usage.usage.syncCount}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cost Breakdown — itemized lines that SUM to the subtotal:
                baseFee is served now (0039 T2); before, this line rendered
                the whole subtotal and the arithmetic on screen was wrong
                by roughly 2x. Amounts via the locale currency formatter. */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium text-gray-900 mb-3">{t('billing.costBreakdown')}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{t('billing.baseFee')}</span>
                  <span className="font-medium">{currency(usage.currentCost.baseFee, 'EUR')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{t('billing.storageCost')}</span>
                  <span className="font-medium">{currency(usage.currentCost.storage, 'EUR')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{t('billing.dataTransfer')}</span>
                  <span className="font-medium">{currency(usage.currentCost.egress, 'EUR')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">{t('billing.compute')}</span>
                  <span className="font-medium">{currency(usage.currentCost.compute, 'EUR')}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t">
                  <span className="font-medium">{t('billing.subtotal')}</span>
                  <span className="font-medium">{currency(usage.currentCost.subtotal, 'EUR')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  {/* The label derives from the served rate — one VAT
                      constant, said once (VAT_RATE server-side). */}
                  <span className="text-gray-600">
                    {t('billing.vat')} ({Math.round(usage.currentCost.taxRate * 100)}%)
                  </span>
                  <span className="font-medium">{currency(usage.currentCost.tax, 'EUR')}</span>
                </div>
                <div className="flex justify-between text-lg font-semibold pt-2 border-t">
                  <span>{t('billing.total')}</span>
                  <span className="text-blue-600">{currency(usage.currentCost.total, 'EUR')}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500">{t('billing.noUsage')}</p>
        )}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{t('billing.invoices')}</h2>
        </div>
        <div className="p-6">
          {invoicesError != null ? (
            <ReadFailed
              heading={t('billing.invoicesLoadFailed')}
              error={invoicesError}
              footnote={t('billing.loadFailedNotEmpty')}
            />
          ) : invoices?.invoices?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('billing.noInvoices')}</p>
          ) : (
            <div className="space-y-4">
              {invoices?.invoices?.map((invoice: Invoice) => (
                <div key={invoice.id} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {t('billing.invoice')} {invoice.id.slice(0, 8)}
                      </p>
                      {/* The period the server actually serves —
                          periodStart/periodEnd. The old field ("period")
                          existed only in the client type, so this line
                          rendered "Period:" followed by nothing. */}
                      <p className="text-sm text-gray-500">
                        {t('billing.period')} {invoice.periodStart} – {invoice.periodEnd}
                      </p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <StateChip entity="invoice" state={invoice.status} />
                      <span className="font-medium text-gray-900">
                        {currency(invoice.total, invoice.currency)}
                      </span>
                      {canManage && (invoice.status === 'draft' || invoice.status === 'sent' || invoice.status === 'overdue') && (
                        <button
                          onClick={() => {
                            setPayError(null);
                            payMutation.mutate(invoice.id);
                          }}
                          disabled={payMutation.isPending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                        >
                          {payMutation.isPending && payMutation.variables === invoice.id && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          {t('billing.pay')}
                        </button>
                      )}
                    </div>
                  </div>
                  {payError?.invoiceId === invoice.id && (
                    <p className="mt-2 text-sm text-red-800">
                      <span className="font-medium">{t('billing.payFailed')}</span> {payError.text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment Methods — served rows or an honest failure; the "Add
          Payment Method" button is GONE rather than dead (0039 T4): adding
          one requires a Mollie flow that is not built, and a button that
          does nothing on a billing screen reads as broken payments. */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{t('billing.paymentMethods')}</h2>
        </div>
        <div className="p-6">
          {methodsError != null ? (
            <ReadFailed
              heading={t('billing.paymentMethodsLoadFailed')}
              error={methodsError}
              footnote={t('billing.loadFailedNotEmpty')}
            />
          ) : methods?.paymentMethods?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('billing.noPaymentMethods')}</p>
          ) : (
            <div className="space-y-3">
              {methods?.paymentMethods?.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="font-medium text-gray-900">
                        {method.brand ?? method.type}
                        {method.lastFour ? ` •••• ${method.lastFour}` : ''}
                      </p>
                      {method.expiryMonth != null && method.expiryYear != null && (
                        <p className="text-sm text-gray-500">
                          {String(method.expiryMonth).padStart(2, '0')}/{method.expiryYear}
                        </p>
                      )}
                    </div>
                  </div>
                  {method.isDefault && (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {t('billing.default')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Billing;
