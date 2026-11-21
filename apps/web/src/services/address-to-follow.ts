// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ADDRESS FOLLOWED ON THE API'S WORD (workplan 0163 T4, findings 8 and 9).
 *
 * Two flows send the browser to an address this app's own API answered.
 * *Pay* sends it to Mollie's checkout (`pages/Billing.tsx`), and a consent
 * sends its window to the provider's page, or links that page when no window
 * opened (`services/consent-window.ts`, `ConsentWindowLink` in
 * `components/ProviderConsent.tsx`). Both followed whatever came back. An
 * outside check, and then Semgrep's `js-open-redirect-from-function` and
 * `react-href-var`, reported the two places: a `javascript:` address would
 * run in this page, and an address on any other host would be followed as if
 * it were Mollie's or the provider's.
 *
 * And *Pay* never once reached Mollie. The API answered the page Mollie sends
 * the customer back to after paying, our own `/billing`, as the address to
 * pay at, so the button reloaded the billing page (0163's Status,
 * 2026-11-21). Nothing looked at where the address went, so nothing saw it.
 *
 * So an address is followed or linked only when it is `https:` on the one
 * host its flow goes to, the host compared whole: `www.mollie.com.example`
 * is not `www.mollie.com`, and `accounts.google.com:8443` is not
 * `accounts.google.com`. The address followed is the one parsed here, so what
 * was checked is what the browser gets. Anything else is refused, and each
 * screen says so rather than going nowhere in silence.
 *
 * `../an-address-followed-on-the-apis-word.unit.test.tsx` holds each refusal.
 */

import { CONSENT_HOSTS } from '@openmig/shared';

/**
 * `address` as the browser may follow it, `https:` on `host` exactly, or null.
 * Null too for an address that does not parse, a relative one included: no
 * page of our own is where either flow goes.
 */
export function addressToFollow(address: string, host: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.host !== host) return null;
  return url.href;
}

/**
 * The host of Mollie's hosted checkout. The checkout's address itself comes
 * from Mollie, as the payment's `_links.checkout` (the client library's
 * `getCheckoutUrl()`), and the API hands it on. `www.mollie.com` is the one
 * host `@mollie/api-client` 4.6.0 names for a page a person opens, Mollie
 * Checkout's and the dashboard's among them; its API is at `api.mollie.com`.
 * A checkout on any other host is refused, and the invoice's row says so.
 */
export const MOLLIE_CHECKOUT_HOST = 'www.mollie.com';

/** The checkout address the API answered for *Pay*, to follow, or null. */
export function checkoutToFollow(address: string): string | null {
  return addressToFollow(address, MOLLIE_CHECKOUT_HOST);
}

/**
 * A consent address the API answered for `provider`, to send its window to or
 * link, or null: on any other host, and for a provider `CONSENT_HOSTS` does
 * not name.
 */
export function consentToFollow(provider: string, address: string): string | null {
  const host = (CONSENT_HOSTS as Readonly<Record<string, string | undefined>>)[provider];
  return host === undefined ? null : addressToFollow(address, host);
}
