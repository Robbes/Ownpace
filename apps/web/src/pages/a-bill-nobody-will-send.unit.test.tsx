// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A BILL NOBODY WILL SEND (workplan 0131 T3).
 *
 * The alpha is free (0131 D1: *"Free and invite only"*), and nothing in the
 * code can charge: the invoice route answers 409 to every call, and no job
 * issues an invoice. The Billing page still read like a bill. Its subtitle was
 * *"Manage your subscription, usage, and payments"*, and a paid tier showed
 * its set-up fee and monthly price with nothing beside them to say that none
 * of it would be charged. The request form asked *"Which package looks
 * right?"* and said nothing about money at all.
 *
 * So, while the deployment runs the alpha (T1's one setting, read through
 * `isAlpha()`):
 *
 * - the Billing page's subtitle is replaced by one line, in English and Dutch:
 *   nothing is charged during the alpha, and what the page shows is measured
 *   so a tester can see how it works, not a bill;
 * - the tier block stays under that line, prices included. On a free tier it
 *   says *free*, as 0109 T8 made it, and the two agree: the line says nothing
 *   is charged during the alpha, the block says nothing is invoiced on Tiny;
 * - the request form keeps its package question, and the question's hint
 *   gains the line's first sentence.
 *
 * WITHOUT THE SETTING, THE PAGE AS IT IS TODAY. That half is the control: the
 * subtitle, the four metered cards and the hint, unchanged. An appliance never
 * says it, whatever its bundle was built with.
 *
 * SILENT, ON PURPOSE, ABOUT THE FOUR METERED CARDS WITH THE SETTING ON. Hiding
 * Storage, Data Transfer, Compute Time and API calls during the alpha is
 * **Proposed** in 0131 T3, not decided. This guard neither requires them
 * hidden nor holds them in place; whoever builds that decision adds the case
 * here.
 *
 * The setting is stubbed the way Vite bakes it, as in
 * `components/an-alpha-said-out-loud.unit.test.tsx`; the edition is mocked
 * through `services/edition`, the sanctioned seam.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: {
    isAuthenticated: true,
    user: null as null | { name: string; email: string; role: string },
    logout: () => {},
  },
}));

vi.mock('../services/edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return { ...actual, isSelfHost: () => editionFlag.selfhost };
});

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

vi.mock('../services/billing-service.ts', () => ({
  billingApi: {
    getCurrentUsage: vi.fn(),
    listInvoices: vi.fn(),
    getPaymentMethods: vi.fn(),
    createPayment: vi.fn(),
    getBillingParty: vi.fn(),
    putBillingParty: vi.fn(),
    checkVat: vi.fn(),
  },
}));

import Billing from './Billing.tsx';
import RequestAccess from './RequestAccess.tsx';
import { billingApi } from '../services/billing-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

/** 0131 T3's words. */
const SAID = {
  en: {
    charged: 'Nothing is charged during the alpha.',
    line:
      'Nothing is charged during the alpha. What you see here is measured so you can see how ' +
      'it works; it is not a bill.',
    // Today's words, for the control.
    subtitle: 'Manage your subscription, usage, and payments',
    tierHint: 'A guess is fine. The package follows what actually runs, so this is not binding.',
    metered: ['Storage', 'Data Transfer', 'Compute Time', 'API calls'],
    free: 'Free: nothing is invoiced on this tier',
    package: /which package looks right/i,
  },
  nl: {
    charged: 'Tijdens de alfa wordt niets in rekening gebracht.',
    line:
      'Tijdens de alfa wordt niets in rekening gebracht. Wat u hier ziet, wordt gemeten zodat u ' +
      'kunt zien hoe het werkt; het is geen rekening.',
    subtitle: 'Beheer uw abonnement, verbruik en betalingen',
    tierHint:
      'Een inschatting volstaat; het pakket volgt wat werkelijk draait, dus dit is niet bindend.',
    metered: ['Opslag', 'Dataverkeer', 'Rekentijd', 'API-aanroepen'],
    free: 'Gratis: op dit pakket wordt niets gefactureerd',
    package: /welk pakket lijkt te passen/i,
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

/**
 * A paid tier: Medium, €15 to set up and €8 a month in ADR-0014's table. The
 * line has to stand above real prices, not only above a free tier's "free".
 */
const MEDIUM = { id: 'medium' as const, name: 'Medium', paths: 20, dataGb: 2000, setup: 15, monthly: 8 };
/** Tiny, free since 0109 T8 (2026-09-24). */
const TINY = { id: 'tiny' as const, name: 'Tiny', paths: 1, dataGb: 250, setup: 0, monthly: 0 };

const usage = (tier: typeof MEDIUM | typeof TINY) => ({
  usage: {
    tenantId: 't1',
    period: '2026-09',
    storageUsedGB: 50,
    egressGB: 100,
    computeHours: 20,
    syncCount: 7,
    lastUpdated: '2026-09-20T12:00:00.000Z',
  },
  tier,
  decidedBy: 'data' as const,
  evidence: { peakPaths: 1, peakAt: '2026-09-12', gbMoved: 12 },
  period: '2026-09',
});

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const inLocale = (locale: Locale) => window.localStorage.setItem('ownpace.locale', locale);

/** The Billing page as the app mounts it, inside the real LocaleProvider. */
async function billingPage(locale: Locale): Promise<void> {
  inLocale(locale);
  render(
    <QueryClientProvider client={client()}>
      <LocaleProvider>
        <Billing />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
}

/** The request form, as the app mounts it. */
function requestPage(locale: Locale): void {
  inLocale(locale);
  render(
    <QueryClientProvider client={client()}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/request-access']}>
          <RequestAccess />
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** What stands directly under the page's title: the subtitle's place. */
function underTheTitle(): string {
  const title = screen.getByRole('heading', { level: 1 });
  return squash(title.nextElementSibling?.textContent);
}

/** The package question's hint, the line under its select. */
function packageHint(locale: Locale): string {
  const select = screen.getByLabelText(SAID[locale].package);
  return squash(select.nextElementSibling?.textContent);
}

function noAlphaAnywhere(): void {
  expect(document.body.textContent ?? '').not.toMatch(/\balpha\b|\balfa\b/i);
}

beforeEach(() => {
  editionFlag.selfhost = false;
  window.localStorage.clear();
  authState.user = { name: 'Tester', email: 'tester@example.test', role: 'owner' };
  vi.mocked(billingApi.getCurrentUsage).mockResolvedValue(usage(MEDIUM));
  vi.mocked(billingApi.listInvoices).mockResolvedValue({ invoices: [] });
  vi.mocked(billingApi.getPaymentMethods).mockResolvedValue({ paymentMethods: [] });
  vi.mocked(billingApi.getBillingParty).mockResolvedValue({
    party: null,
    vatConsultation: null,
    vatTreatment: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('with the alpha setting on', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
  });

  it.each(LOCALES)('Billing opens with the line, whole, in place of the subtitle, in %s', async (locale) => {
    await billingPage(locale);
    expect(underTheTitle()).toBe(SAID[locale].line);
    expect(document.body.textContent).not.toContain(SAID[locale].subtitle);
  });

  it.each(LOCALES)('the tier block stays under it, prices included, in %s', async (locale) => {
    await billingPage(locale);
    const tier = await screen.findByText('Medium');
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ADR-0014's Medium: €15 to set up, €8 a month. The measurement is one of
    // the things worth trying (0121 T4), so the prices are not taken away.
    const money = squash(tier.parentElement?.textContent);
    expect(money).toMatch(/15[.,]00/);
    expect(money).toMatch(/8[.,]00/);
  });

  it.each(LOCALES)('on a free tier, the line and 0109\'s "free" say the same thing, in %s', async (locale) => {
    vi.mocked(billingApi.getCurrentUsage).mockResolvedValue(usage(TINY));
    await billingPage(locale);
    expect(await screen.findByText(SAID[locale].free)).toBeInTheDocument();
    expect(underTheTitle()).toBe(SAID[locale].line);
    expect(document.body.textContent ?? '').not.toMatch(/€\s?0[.,]00/);
  });

  it.each(LOCALES)(
    'a member who may not see the figures reads that nothing is charged, and no claim about figures, in %s',
    async (locale) => {
      // Billing's reads are owner and admin only (2026-08-10), so a viewer is
      // shown no measurement: "what you see here is measured" would be false.
      authState.user = { name: 'Viewer', email: 'viewer@example.test', role: 'viewer' };
      await billingPage(locale);
      expect(underTheTitle()).toBe(SAID[locale].charged);
      expect(document.body.textContent).not.toContain(SAID[locale].subtitle);
    },
  );

  it.each(LOCALES)('the request form keeps its package question, and its hint says it too, in %s', (locale) => {
    requestPage(locale);
    const select = screen.getByLabelText(SAID[locale].package);
    // The question stays: it tells the owner roughly how large a request is.
    expect(select.querySelectorAll('option')).toHaveLength(6);
    expect(packageHint(locale)).toBe(`${SAID[locale].tierHint} ${SAID[locale].charged}`);
  });

  it.each(LOCALES)('says "charged", as the alpha note does, and not "invoiced", in %s', (locale) => {
    // One promise in three places: the note at the top of every page (T1),
    // the Billing line and the request hint. A tier says "invoiced" (0109
    // T8); the alpha covers every tier, the paid ones too, and says
    // "charged". If the note's word changes, this line changes with it.
    const verb = { en: 'Nothing is charged', nl: 'niets in rekening gebracht' }[locale];
    expect(STRINGS[locale]['alpha.note.terms']).toContain(verb);
    // Read from the product's dictionary, not from SAID above, so this case
    // fails when the product's words change, not only when the test's do.
    const charged = STRINGS[locale]['alpha.nothingCharged'];
    expect(charged).toContain(verb);
    expect(`${charged} ${STRINGS[locale]['billing.alpha.measured']}`).not.toMatch(/invoiced|gefactureerd/i);
  });
});

describe('without the setting: the page as it is today (the control)', () => {
  it.each(LOCALES)('Billing keeps its subtitle, its four metered cards and its tier, in %s', async (locale) => {
    await billingPage(locale);
    await screen.findByText('Medium');
    expect(underTheTitle()).toBe(SAID[locale].subtitle);
    for (const label of SAID[locale].metered) expect(screen.getByText(label)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SAID[locale].charged);
    noAlphaAnywhere();
  });

  it.each(LOCALES)('the request form keeps its hint as it was, in %s', (locale) => {
    requestPage(locale);
    expect(packageHint(locale)).toBe(SAID[locale].tierHint);
    noAlphaAnywhere();
  });

  it('and a value that is not "alpha" is not the alpha', async () => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'beta');
    await billingPage('en');
    expect(underTheTitle()).toBe(SAID.en.subtitle);
    noAlphaAnywhere();
  });
});

describe('on an appliance, never', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
    editionFlag.selfhost = true;
  });

  it.each(LOCALES)('Billing says nothing about an alpha, in %s, even built with the setting', async (locale) => {
    await billingPage(locale);
    expect(underTheTitle()).toBe(SAID[locale].subtitle);
    noAlphaAnywhere();
  });

  it.each(LOCALES)('nor does the request form, in %s', (locale) => {
    requestPage(locale);
    expect(packageHint(locale)).toBe(SAID[locale].tierHint);
    noAlphaAnywhere();
  });
});
