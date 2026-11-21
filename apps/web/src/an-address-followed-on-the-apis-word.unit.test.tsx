// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ADDRESS FOLLOWED ON THE API'S WORD (workplan 0163 T4, findings 8 and 9).
 *
 * Two flows sent the browser wherever this app's own API said. *Pay* set
 * `window.location.href` to the answer's `paymentUrl` (`pages/Billing.tsx`),
 * and a consent sent its window to the answer's `url`, or drew it as a link
 * when no window opened (`services/consent-window.ts`, `ConsentWindowLink`).
 * An outside check reported both, and Semgrep's `js-open-redirect-from-
 * function` and `react-href-var` found them again: a `javascript:` address
 * would run in the page, and any other host would be followed as if it were
 * Mollie's or the provider's. And *Pay* never reached Mollie at all: the API
 * answered our own `/billing`, the page Mollie sends the customer back to, as
 * the address to pay at (0163's Status, 2026-11-21).
 *
 * Each is now followed or linked only when it is `https:` on its flow's one
 * host (`services/address-to-follow.ts`). Held here, each refusal by the
 * check that makes it, so that the check gone fails its case:
 *
 * - **`http:`**, on the right host: only the scheme refuses it;
 * - **another host**, `https:`;
 * - **a lookalike host**: the right name inside another host
 *   (`www.mollie.com.evil.example`), credentials in front of another host
 *   (`www.mollie.com@evil.example`), another port, no `www.`;
 * - **`javascript:`**, also one whose host is the right one
 *   (`javascript://www.mollie.com/%0a…`, which a browser runs as a comment
 *   and a line of script), so the host check cannot stand in for the scheme;
 * - **no checkout link**: an empty address, a path, and the page Mollie sends
 *   the customer back to, which *Pay* followed before. The API refuses a
 *   payment Mollie gave no checkout before it answers at all
 *   (`apps/api/src/routes/billing/a-draft-is-not-paid.unit.test.ts`).
 *
 * And where each check is used, in English and in Dutch: *Pay* follows
 * Mollie's checkout and nothing else, and says so at the invoice's row; the
 * consent link is drawn for the provider's own page and nothing else; each
 * consent door closes the blank window on any other address, never sends it
 * there, and says so.
 *
 * jsdom has no navigation, so `window.location`'s `href` is caught, and no
 * windows, so `window.open` answers a small blank window, as in
 * `components/a-consent-window-opened-by-the-press.unit.test.tsx`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import {
  CIRRUX_AUTHORIZE_ENDPOINT,
  DROPBOX_AUTH_ENDPOINT,
  GOOGLE_AUTH_ENDPOINT,
  credentialFieldsFor,
  microsoftAuthEndpoint,
} from '@openmig/shared';
import { LocaleProvider } from './i18n/index.tsx';
import { STRINGS } from './i18n/strings.ts';
import { checkoutToFollow, consentToFollow } from './services/address-to-follow.ts';
import { billingApi, type Invoice } from './services/billing-service.ts';
import type { ConnectionSummary } from './services/mapping-service.ts';

const { authState, googleAuthorize, cirruxDriveAuthorize, clients, facts } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: true,
    // An admin may pay (0039 T1); nothing here reads a name or an address.
    user: { role: 'admin' },
    tenantId: 't1',
    logout: () => {},
  },
  googleAuthorize: vi.fn(),
  cirruxDriveAuthorize: vi.fn(),
  clients: vi.fn(),
  facts: vi.fn(),
}));

/** Every read the billing page makes refuses, but for the invoices and their payment. */
vi.mock('./services/billing-service', async (importOriginal) => {
  const notRead = () => vi.fn(() => Promise.reject(new Error('not read in this test')));
  return {
    ...(await importOriginal<typeof import('./services/billing-service.ts')>()),
    billingApi: {
      getCurrentUsage: notRead(),
      listInvoices: vi.fn(),
      getPaymentMethods: vi.fn(),
      createPayment: vi.fn(),
      downloadInvoicePdf: notRead(),
      getBillingParty: notRead(),
      putBillingParty: notRead(),
      checkVat: notRead(),
      getCeiling: notRead(),
      sayYesToCeiling: notRead(),
      getPick: notRead(),
      pickTier: notRead(),
      getYear: notRead(),
      orderYear: notRead(),
      getWithdrawal: notRead(),
      withdraw: notRead(),
    },
  };
});

vi.mock('./services/progress-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/progress-service.ts')>()),
  fetchProgress: vi.fn(() => Promise.reject(new Error('not read in this test'))),
}));

vi.mock('./stores/auth-store', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

vi.mock('./services/mapping-service', () => ({
  mappingApi: {
    googleAuthorize,
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
    cirruxDriveAuthorize,
    cirruxDriveDisconnect: vi.fn(),
  },
  providerAccountsApi: { get: facts },
  providerClientsApi: { get: clients },
}));

import Billing from './pages/Billing.tsx';
import { ConsentWindowLink, ProviderConsentPanel, useProviderConsent } from './components/ProviderConsent.tsx';
import { CirruxDrivePanel } from './components/CirruxDrive.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/** Where *Pay* is to go: Mollie's checkout, as the API now answers it. */
const CHECKOUT = 'https://www.mollie.com/checkout/tr_follow';

/** Each address *Pay* may not follow, by the check that refuses it. */
const NOT_THE_CHECKOUT: ReadonlyArray<readonly [string, string]> = [
  ['http:, on Mollie’s host', 'http://www.mollie.com/checkout/tr_follow'],
  ['another host', 'https://pay.example/checkout/tr_follow'],
  ['a lookalike: Mollie’s host inside another', 'https://www.mollie.com.evil.example/checkout/tr_follow'],
  ['a lookalike: credentials in front of another host', 'https://www.mollie.com@evil.example/checkout/tr_follow'],
  ['a lookalike: Mollie’s host on another port', 'https://www.mollie.com:8443/checkout/tr_follow'],
  ['a lookalike: Mollie’s name without its www.', 'https://mollie.com/checkout/tr_follow'],
  ['javascript:', 'javascript:alert(document.domain)'],
  ['javascript:, its host Mollie’s', 'javascript://www.mollie.com/%0aalert(document.domain)'],
  ['data:', 'data:text/html,<script>alert(document.domain)</script>'],
  ['no checkout link: nothing', ''],
  ['no checkout link: a path', '/billing'],
  ['no checkout link: the page Mollie sends the customer back to, by default', 'http://localhost:3123/billing'],
  ['no checkout link: the page Mollie sends the customer back to, deployed', 'https://app.ownpace.example/billing'],
];

/** Each provider's own consent page, as its door's server builds it. */
const CONSENT_PAGES: ReadonlyArray<readonly [string, string]> = [
  ['google', `${GOOGLE_AUTH_ENDPOINT}?client_id=x&state=s`],
  ['dropbox', `${DROPBOX_AUTH_ENDPOINT}?client_id=x&state=s`],
  ['microsoft', `${microsoftAuthEndpoint('organizations')}?client_id=x&state=s`],
  ['cirrux', `${CIRRUX_AUTHORIZE_ENDPOINT}?client_id=x&state=s`],
];
const GOOGLE_PAGE = `${GOOGLE_AUTH_ENDPOINT}?client_id=x&state=s`;

/** Each address a Google consent may not send its window to, or link. */
const NOT_GOOGLES: ReadonlyArray<readonly [string, string]> = [
  ['http:, on Google’s host', 'http://accounts.google.com/o/oauth2/v2/auth?client_id=x'],
  ['another provider’s host', `${DROPBOX_AUTH_ENDPOINT}?client_id=x`],
  ['a lookalike: Google’s host inside another', 'https://accounts.google.com.evil.example/o/oauth2/v2/auth'],
  ['a lookalike: credentials in front of another host', 'https://accounts.google.com@evil.example/o/oauth2/v2/auth'],
  ['javascript:, its host Google’s', 'javascript://accounts.google.com/%0aalert(document.domain)'],
  ['nothing', ''],
];

function wrap(locale: Locale, node: React.ReactNode) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>{node}</MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('the check (services/address-to-follow.ts)', () => {
  it('passes Mollie’s checkout, as parsed', () => {
    expect(checkoutToFollow(CHECKOUT)).toBe(CHECKOUT);
    expect(checkoutToFollow('https://WWW.MOLLIE.COM/checkout/tr_follow')).toBe(CHECKOUT);
  });

  it.each(NOT_THE_CHECKOUT)('refuses as the checkout %s', (_why, address) => {
    expect(checkoutToFollow(address)).toBeNull();
  });

  it.each(CONSENT_PAGES)('passes %s’s own consent page', (provider, address) => {
    expect(consentToFollow(provider, address)).toBe(address);
  });

  it.each(NOT_GOOGLES)('refuses as Google’s consent page %s', (_why, address) => {
    expect(consentToFollow('google', address)).toBeNull();
  });

  it('refuses one provider’s page for another, and any page for a provider it does not name', () => {
    expect(consentToFollow('dropbox', GOOGLE_PAGE)).toBeNull();
    expect(consentToFollow('cirrux', GOOGLE_PAGE)).toBeNull();
    expect(consentToFollow('box', GOOGLE_PAGE)).toBeNull();
    expect(consentToFollow('constructor', GOOGLE_PAGE)).toBeNull();
  });
});

const invoice: Invoice = {
  id: 'inv-0163-follow',
  tenantId: 't1',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  status: 'sent',
  subtotal: 992,
  taxRate: 0.21,
  taxAmount: 208,
  total: 1200,
  currency: 'EUR',
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('Pay follows Mollie’s checkout and nothing else (finding 8, Billing.tsx)', () => {
  let followed: string[];
  let location: MockInstance;

  beforeEach(() => {
    vi.mocked(billingApi.listInvoices).mockResolvedValue({ invoices: [invoice] });
    vi.mocked(billingApi.getPaymentMethods).mockResolvedValue({ paymentMethods: [] });
    followed = [];
    location = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      set href(to: string) {
        followed.push(to);
      },
    } as unknown as Location);
  });
  afterEach(() => location.mockRestore());

  const pressPay = async (locale: Locale, paymentUrl: string): Promise<void> => {
    vi.mocked(billingApi.createPayment).mockResolvedValue({ paymentUrl, paymentId: 'tr_follow', status: 'open' });
    wrap(locale, <Billing />);
    fireEvent.click(await screen.findByRole('button', { name: words(locale, 'billing.pay') }));
    await waitFor(() => expect(billingApi.createPayment).toHaveBeenCalledWith(invoice.id));
  };

  it('goes to Mollie’s checkout', async () => {
    await pressPay('en', CHECKOUT);
    await waitFor(() => expect(followed).toEqual([CHECKOUT]));
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      it.each(NOT_THE_CHECKOUT)('goes nowhere for %s, and says so at the row', async (_why, address) => {
        await pressPay(locale, address);
        const said = await screen.findByText(words(locale, 'billing.payNotMollie'));
        expect(said.textContent).toBe(`${words(locale, 'billing.payFailed')} ${words(locale, 'billing.payNotMollie')}`);
        expect(followed).toEqual([]);
      });
    });
  }
});

describe('the consent link is drawn for the provider’s own page only (finding 9, ConsentWindowLink)', () => {
  it.each(CONSENT_PAGES)('links %s’s own page', (provider, address) => {
    wrap('en', <ConsentWindowLink provider={provider} unopened={{ url: address, pressedAt: Date.now() }} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe(address);
  });

  it.each(NOT_GOOGLES)('draws nothing for %s', (_why, address) => {
    const { container } = wrap('en', <ConsentWindowLink provider="google" unopened={{ url: address, pressedAt: Date.now() }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

/** A blank window the browser opened: where it was sent, and whether it was closed. */
interface BlankWindow {
  location: { href: string };
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
}
const aBlankWindow = (): BlankWindow => {
  const w: BlankWindow = {
    location: { href: 'about:blank' },
    closed: false,
    close: vi.fn(() => {
      w.closed = true;
    }),
  };
  return w;
};

/** The consent panel as a door draws it, for a Gmail source, on a deployment that carries Google's app. */
const GmailConsent: React.FC = () => {
  const consent = useProviderConsent({
    role: 'source',
    type: 'gmail',
    fields: credentialFieldsFor('source', 'gmail'),
    // Any username will do: the consent asks only that one is typed.
    values: { username: 'the-owner' },
    onToken: () => {},
    refusalText: () => 'refused',
  });
  return <ProviderConsentPanel consent={consent} />;
};

const cirruxAccount = {
  id: '0163cd00-e29b-41d4-a716-446655440011',
  role: 'target',
  kind: 'cirrux',
  displayName: 'Cirrux',
  status: 'connected',
  createdAt: '2026-11-19T10:00:00.000Z',
  usedByMigrations: 0,
  qualification: null,
} as unknown as ConnectionSummary;

/** Each door, brought to its live Connect button. */
const DOORS: ReadonlyArray<{
  readonly name: string;
  readonly provider: string;
  readonly page: string;
  readonly authorize: ReturnType<typeof vi.fn>;
  readonly open: (locale: Locale) => Promise<HTMLElement>;
}> = [
  {
    name: 'the consent panel (Gmail)',
    provider: 'Google',
    page: GOOGLE_PAGE,
    authorize: googleAuthorize,
    open: async (locale) => {
      wrap(locale, <GmailConsent />);
      const connect = await screen.findByRole('button', { name: words(locale, 'account.google.connect') });
      await waitFor(() => expect(connect).toBeEnabled());
      return connect;
    },
  },
  {
    name: 'Cirrux Drive’s panel',
    provider: 'Cirrux',
    page: `${CIRRUX_AUTHORIZE_ENDPOINT}?client_id=x&state=s`,
    authorize: cirruxDriveAuthorize,
    open: async (locale) => {
      wrap(locale, <CirruxDrivePanel connection={cirruxAccount} onChanged={() => {}} />);
      return screen.findByRole('button', { name: words(locale, 'account.cirrux.connect') });
    },
  },
];

describe('each consent door sends its window to the provider’s own page only (consent-window.ts)', () => {
  let open: MockInstance<typeof window.open>;
  let blank: BlankWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
    facts.mockResolvedValue({ cirrux: { domains: ['email', 'calendar', 'contact', 'task'], client: 'deployment' } });
    blank = aBlankWindow();
    open = vi.spyOn(window, 'open').mockImplementation(() => blank as unknown as Window);
  });
  afterEach(() => open.mockRestore());

  for (const locale of LOCALES) {
    for (const door of DOORS) {
      describe(`${locale}, ${door.name}`, () => {
        const refusal = () => words(locale, 'account.consent.notTheProvider').replace('{provider}', door.provider);

        it('sends the window to the provider’s own page', async () => {
          door.authorize.mockResolvedValue({ url: door.page, redirectUri: 'r' });
          fireEvent.click(await door.open(locale));
          await waitFor(() => expect(blank.location.href).toBe(door.page));
          expect(blank.close).not.toHaveBeenCalled();
        });

        it.each([
          ['another host', 'https://consent.evil.example/authorize?client_id=x'],
          ['javascript:', 'javascript:alert(document.domain)'],
        ])('closes the window on %s, sends it nowhere, links nothing, and says so', async (_why, address) => {
          door.authorize.mockResolvedValue({ url: address, redirectUri: 'r' });
          fireEvent.click(await door.open(locale));
          expect(await screen.findByRole('alert')).toHaveProperty('textContent', refusal());
          expect(blank.close).toHaveBeenCalled();
          expect(blank.location.href).toBe('about:blank');
          expect(screen.queryByRole('link', { name: /evil|alert/ })).toBeNull();
        });

        it('links nothing when the browser opened no window, and says so', async () => {
          open.mockImplementation(() => null);
          door.authorize.mockResolvedValue({ url: 'https://consent.evil.example/authorize', redirectUri: 'r' });
          fireEvent.click(await door.open(locale));
          expect(await screen.findByRole('alert')).toHaveProperty('textContent', refusal());
          await act(async () => {});
          expect(
            screen.queryAllByRole('link').filter((a) => a.getAttribute('href')?.includes('evil')),
          ).toEqual([]);
          expect(screen.queryByText(words(locale, 'account.consent.windowBlocked').split('{')[0]!, { exact: false })).toBeNull();
        });
      });
    }
  }
});
