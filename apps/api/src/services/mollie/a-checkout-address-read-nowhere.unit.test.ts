// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CHECKOUT ADDRESS READ NOWHERE (workplan 0163 T4, finding 8).
 *
 * Mollie answers a new payment with two addresses. `redirectUrl` is the page
 * it sends the customer back to once they have paid, the one the pay route
 * names: our own `/billing`. `_links.checkout` is where they pay, which the
 * client library reads with `getCheckoutUrl()`. `MollieService` kept only the
 * first, and the pay route answered it as the address to pay at, so *Pay*
 * reloaded the billing page and never reached Mollie.
 *
 * The client is stood in for by the shape `@mollie/api-client` 4.6.0 gives a
 * payment: Mollie's answer as its fields, and `getCheckoutUrl()`, which reads
 * `_links.checkout.href` or answers null (its `PaymentHelper`). It cannot be
 * run against a stand-in for Mollie's API instead: it sends over an HTTPS
 * agent that trusts only its own bundled certificate authorities. Held here:
 *
 * - the service's payment carries the checkout to pay at, with the return
 *   page apart from it;
 * - a payment Mollie gives no checkout carries none (`null`), which the pay
 *   route refuses (`routes/billing/a-draft-is-not-paid.unit.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const stand = vi.hoisted(() => ({
  checkout: null as string | null,
  asked: [] as Array<Record<string, unknown>>,
}));

vi.mock('@mollie/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mollie/api-client')>()),
  createMollieClient: () => ({
    payments: {
      create: async (asked: Record<string, unknown>) => {
        stand.asked.push(asked);
        const answer = answerFor(asked);
        return { ...answer, getCheckoutUrl: () => answer._links.checkout?.href ?? null };
      },
    },
  }),
}));

import { MollieService } from './index.ts';

const CHECKOUT = 'https://www.mollie.com/checkout/tr_standin';
const BACK = 'https://app.ownpace.example/billing';

/** A new payment as Mollie answers it, made from what it was asked. */
function answerFor(asked: Record<string, unknown>) {
  return {
    resource: 'payment',
    id: 'tr_standin',
    mode: 'test',
    status: 'open',
    amount: asked.amount as { value: string; currency: string },
    description: asked.description as string,
    redirectUrl: asked.redirectUrl as string,
    webhookUrl: asked.webhookUrl as string,
    metadata: asked.metadata,
    createdAt: '2026-11-21T10:00:00+00:00',
    _links: {
      self: { href: 'https://api.mollie.com/v2/payments/tr_standin', type: 'application/hal+json' },
      ...(stand.checkout === null ? {} : { checkout: { href: stand.checkout, type: 'text/html' } }),
    } as { self: { href: string }; checkout?: { href: string } },
  };
}

beforeEach(() => {
  stand.asked.length = 0;
  stand.checkout = CHECKOUT;
});

const pay = () =>
  new MollieService('test_stand-in').createPayment({
    tenantId: 't1',
    amount: 1200,
    description: 'Invoice 1',
    redirectUrl: BACK,
    webhookUrl: 'https://api.ownpace.example/api/billing/webhooks/mollie',
    metadata: { invoiceId: 'i1' },
  });

describe('the payment the service reads from Mollie', () => {
  it('carries the checkout to pay at, with the page Mollie sends the customer back to apart from it', async () => {
    const payment = await pay();

    expect(stand.asked).toHaveLength(1);
    expect(stand.asked[0]).toMatchObject({ redirectUrl: BACK, amount: { value: '12.00', currency: 'EUR' } });
    expect(payment.checkoutUrl).toBe(CHECKOUT);
    expect(payment.redirectUrl).toBe(BACK);
  });

  it('carries no checkout when Mollie gave none', async () => {
    stand.checkout = null;

    const payment = await pay();

    expect(payment.checkoutUrl).toBeNull();
    expect(payment.redirectUrl).toBe(BACK);
  });
});
