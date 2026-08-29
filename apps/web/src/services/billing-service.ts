// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Billing Service — API client, reconciled against the ROUTES' literal
 * responses (0039 T3), the same discipline as mapping-service.ts (whose
 * header documents exactly this drift failure mode).
 *
 * What the old file got wrong, all fixed here by parsing the real shapes:
 * the invoice type spoke Stripe vocabulary (`period`, `open`/`uncollectible`)
 * against a Mollie DB enum (`periodStart`/`periodEnd`,
 * `sent`/`overdue`) — every row rendered "Period:" followed by nothing and
 * the one status demanding action wore neutral gray; the money columns are
 * NUMERIC in Postgres and arrive as STRINGS, which the old `number` types
 * hid behind implicit coercion (z.coerce makes it explicit); and two
 * phantom methods — `recordUsage` (POSTs an endpoint that does not exist)
 * and `estimateCost` (types a shape the server does not send) — are deleted
 * per the 0026 T2 dead-surface precedent.
 */

import { z } from 'zod';
import apiClient from './api.ts';

/** calculateCost's breakdown — baseFee and taxRate included (0039 T2), so
 *  the Base Fee line and the VAT label render served numbers, not guesses. */
export const CurrentCostSchema = z.object({
  baseFee: z.number(),
  storage: z.number(),
  egress: z.number(),
  compute: z.number(),
  subtotal: z.number(),
  taxRate: z.number(),
  tax: z.number(),
  total: z.number(),
});

export const UsageResponseSchema = z.object({
  usage: z.object({
    tenantId: z.string(),
    period: z.string(), // YYYY-MM
    storageUsedGB: z.number(),
    egressGB: z.number(),
    computeHours: z.number(),
    /** NAMED what it is upstream: the metering writes apiCallCount here. */
    syncCount: z.number(),
    lastUpdated: z.string(),
  }),
  currentCost: CurrentCostSchema,
  period: z.string(),
});

/** GET /billing/invoices rows — the DB enum's words (`mollie`, not Stripe),
 *  money coerced explicitly (numeric columns arrive as strings). */
export const InvoiceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']),
  subtotal: z.coerce.number(),
  taxRate: z.coerce.number(),
  taxAmount: z.coerce.number(),
  total: z.coerce.number(),
  currency: z.string(),
  paymentMethod: z.string().nullish(),
  paymentId: z.string().nullish(),
  paidAt: z.string().nullish(),
  dueDate: z.string().nullish(),
  sentAt: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  createdAt: z.string(),
  updatedAt: z.string().nullish(),
});

export const PaymentMethodSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  mollieId: z.string().nullish(),
  type: z.string(),
  brand: z.string().nullish(),
  lastFour: z.string().nullish(),
  expiryMonth: z.coerce.number().nullish(),
  expiryYear: z.coerce.number().nullish(),
  isDefault: z.boolean(),
  status: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string().nullish(),
});

export const PayResponseSchema = z.object({
  paymentUrl: z.string(),
  paymentId: z.string(),
  status: z.string(),
});

/** GET/PUT /billing/party (workplan 0111 T1). `party` is null until the
 *  customer provides it — a state the page renders as an ask, not an error. */
export const BillingPartySchema = z.object({
  tenantId: z.string(),
  kind: z.enum(['consumer', 'business']),
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullish(),
  postalCode: z.string(),
  city: z.string(),
  countryCode: z.string(),
  vatNumber: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string().nullish(),
});

export type UsageResponse = z.infer<typeof UsageResponseSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;
export type BillingParty = z.infer<typeof BillingPartySchema>;

/** What PUT /billing/party accepts. `kind` may be omitted — the server
 *  defaults it to `consumer`, which is T1's whole point — but the form always
 *  says it, because a form has to show the choice it is making. */
export interface BillingPartyInput {
  kind: 'consumer' | 'business';
  name: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  countryCode: string;
  vatNumber?: string;
}

export const billingApi = {
  // Get current usage
  getCurrentUsage: async (): Promise<UsageResponse> => {
    const response = await apiClient.get('/billing/usage');
    return UsageResponseSchema.parse(response.data);
  },

  // Get usage history
  getUsageHistory: async () => {
    const response = await apiClient.get('/billing/usage/history');
    return response.data;
  },

  // List invoices
  listInvoices: async (): Promise<{ invoices: Invoice[] }> => {
    const response = await apiClient.get('/billing/invoices');
    return { invoices: z.array(InvoiceSchema).parse(response.data.invoices) };
  },

  // Get invoice details
  getInvoice: async (invoiceId: string): Promise<{ invoice: Invoice }> => {
    const response = await apiClient.get(`/billing/invoices/${invoiceId}`);
    return { invoice: InvoiceSchema.parse(response.data.invoice) };
  },

  /** Create a Mollie payment for an invoice; the caller follows `paymentUrl`.
   *  Owner/admin only server-side (0039 T1). */
  createPayment: async (invoiceId: string) => {
    const response = await apiClient.post(`/billing/invoices/${invoiceId}/pay`);
    return PayResponseSchema.parse(response.data);
  },

  /** Who invoices are addressed to; null while nobody has said (0111 T1). */
  getBillingParty: async (): Promise<BillingParty | null> => {
    const response = await apiClient.get('/billing/party');
    const party: unknown = response.data.party;
    return party == null ? null : BillingPartySchema.parse(party);
  },

  /** Upsert — the server converges repeated sends onto one row. Owner/admin. */
  putBillingParty: async (input: BillingPartyInput): Promise<BillingParty> => {
    const response = await apiClient.put('/billing/party', input);
    return BillingPartySchema.parse(response.data.party);
  },

  // List payment methods
  getPaymentMethods: async (): Promise<{ paymentMethods: PaymentMethod[] }> => {
    const response = await apiClient.get('/billing/payment-methods');
    return { paymentMethods: z.array(PaymentMethodSchema).parse(response.data.paymentMethods) };
  },

  // Add payment method (owner/admin only server-side)
  addPaymentMethod: async (data: {
    type: 'card' | 'banktransfer' | 'other';
    last4?: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
  }): Promise<{ paymentMethod: PaymentMethod }> => {
    const response = await apiClient.post('/billing/payment-methods', data);
    return { paymentMethod: PaymentMethodSchema.parse(response.data.paymentMethod) };
  },

  // Set default payment method (owner/admin only server-side)
  setDefaultPaymentMethod: async (paymentMethodId: string): Promise<{ paymentMethod: PaymentMethod }> => {
    const response = await apiClient.patch(`/billing/payment-methods/${paymentMethodId}/default`);
    return { paymentMethod: PaymentMethodSchema.parse(response.data.paymentMethod) };
  },
};
