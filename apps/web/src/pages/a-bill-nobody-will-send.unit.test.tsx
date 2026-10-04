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
 *   nothing is charged during the alpha, and then the free tier's own
 *   sentence, word for word (owner, 2026-09-24): *"Not needed while your tier
 *   is free: nothing is invoiced."*;
 * - the invoice details card says that same sentence on every tier, where a
 *   paid tier asked for the details in amber;
 * - the tier block stays under that line, prices included. On a free tier it
 *   says *free*, as 0109 T8 made it, and the two agree: the line says nothing
 *   is charged during the alpha, the block says nothing is invoiced on Free;
 * - the request form keeps its package question, and the question's hint
 *   gains the line's first sentence.
 *
 * WITHOUT THE SETTING, THE PAGE AS IT IS TODAY. That half is the control: the
 * subtitle, the four metered cards and the hint, unchanged. An appliance never
 * says it, whatever its bundle was built with.
 *
 * THE FOUR MEASUREMENT CARDS STAY, AND NOTHING ON THEM LOOKS LIKE MONEY. 0131
 * T3 proposed hiding Storage, Data Transfer, Compute Time and API calls during
 * the alpha. The owner chose otherwise (2026-10-04): *"Keep, no money icons"*.
 * They are the insight the owner wants customers to have (0121 T4, 2026-09-09:
 * *"i want to offer customers the insight"*). But their icons were a dollar
 * sign, a credit card and a rising trend, so on a page that says nothing is
 * charged they read as a meter. So during the Alpha and outside it, the four
 * cards show their figures, each card carries the one neutral icon named for
 * it, and no icon in the Current usage section has a name on the money or
 * meter list below. The Payment Methods card keeps its credit card: it is
 * about payment methods. Its icon is also how this guard shows it can see an
 * icon by its name at all.
 *
 * The setting is stubbed the way Vite bakes it, as in
 * `components/an-alpha-said-out-loud.unit.test.tsx`; the edition is mocked
 * through `services/edition`, the sanctioned seam.
 */
import { render, screen, within } from '@testing-library/react';
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

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: {
    getCurrentUsage: vi.fn(),
    listInvoices: vi.fn(),
    getPaymentMethods: vi.fn(),
    createPayment: vi.fn(),
    getBillingParty: vi.fn(),
    putBillingParty: vi.fn(),
    checkVat: vi.fn(),
    getCeiling: vi.fn(),
    sayYesToCeiling: vi.fn(),
  },
}));

import Billing from './Billing.tsx';
import RequestAccess from './RequestAccess.tsx';
import { billingApi } from '../services/billing-service.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';
import { renderEvent } from '@openmig/shared';

/** 0131 T3's words. */
const SAID = {
  en: {
    charged: 'Nothing is charged during the Alpha.',
    line: 'Nothing is charged during the Alpha. Not needed while your tier is free: nothing is invoiced.',
    notNeeded: 'Not needed while your tier is free: nothing is invoiced.',
    missing: 'Not provided yet. Invoices cannot be issued until this is filled in.',
    // Today's words, for the control.
    subtitle: 'Manage your subscription, usage, and payments',
    tierHint: 'A guess is fine. The package follows what actually runs, so this is not binding.',
    metered: ['Storage', 'Data Transfer', 'Compute Time', 'API calls'],
    // The figures `usage()` below serves, as the four cards print them.
    figures: ['50.0 GB', '100.0 GB', '20.0 hours', '7'],
    currentUsage: 'Current Usage',
    paymentMethods: 'Payment Methods',
    free: 'Free: nothing is invoiced on this tier',
    package: /which package looks right/i,
  },
  nl: {
    charged: 'Tijdens de Alpha wordt niets in rekening gebracht.',
    line:
      'Tijdens de Alpha wordt niets in rekening gebracht. Niet nodig zolang uw pakket gratis is: ' +
      'er wordt niets gefactureerd.',
    notNeeded: 'Niet nodig zolang uw pakket gratis is: er wordt niets gefactureerd.',
    missing: 'Nog niet ingevuld. Er kunnen geen facturen worden uitgereikt totdat dit is ingevuld.',
    subtitle: 'Beheer uw abonnement, verbruik en betalingen',
    tierHint:
      'Een inschatting volstaat; het pakket volgt wat werkelijk draait, dus dit is niet bindend.',
    metered: ['Opslag', 'Dataverkeer', 'Rekentijd', 'API-aanroepen'],
    figures: ['50.0 GB', '100.0 GB', '20.0 uur', '7'],
    currentUsage: 'Huidig verbruik',
    paymentMethods: 'Betaalmethoden',
    free: 'Gratis: op dit pakket wordt niets gefactureerd',
    package: /welk pakket lijkt te passen/i,
  },
} as const;

type Locale = keyof typeof SAID;
const LOCALES = Object.keys(SAID) as Locale[];

/** The two mails whose Alpha paragraph says nothing is charged (0131 T1, 0156 T3). */
const ALPHA_MAILS = [
  { kind: 'access_granted', organisation: 'De Vries', appUrl: 'https://app.example.test', email: 'a@example.test', alpha: true },
  {
    kind: 'member_invited',
    organisation: 'De Vries',
    appUrl: 'https://app.example.test',
    email: 'b@example.test',
    privacyPolicy: 'https://site.example.test/privacy.html',
    alpha: true,
  },
] as const;

/**
 * A paid tier: Medium, €15 to set up and €8 a month in ADR-0014's table. The
 * line has to stand above real prices, not only above a free tier's "free".
 */
const MEDIUM = { id: 'medium' as const, name: 'Medium', paths: 20, dataGb: 2000, monthlyCents: 1200, annualCents: 7200 };
/** Free since 0109 T8 (2026-09-24); called Tiny until 0152 T6 (d). */
const FREE = { id: 'free' as const, name: 'Free', paths: 1, dataGb: 250, monthlyCents: 0, annualCents: 0 };

const usage = (tier: typeof MEDIUM | typeof FREE) => ({
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
  billed: { tier, beyond: [] as Array<'bands' | 'paths' | 'data'> },
  ceilingGb: tier.dataGb,
  topUps: 0,
  gbMovedInTheAlpha: 0,
  holds: true,
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
  vi.mocked(billingApi.getCeiling).mockResolvedValue({
    tier: { id: 'free', name: 'Free', paths: 1, monthly: 0 },
    ceilingGb: 250,
    topUps: 0,
    gbMoved: 10,
    gbMovedInTheAlpha: 0,
    share: 0.04,
    state: 'under',
    holds: true,
    moveUp: { tierId: 'small', name: 'Small', paths: 4, monthlyEur: 5, ceilingGb: 750 },
    topUp: null,
    breakEven: null,
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
    // ADR-0014's Medium: €12 a month, €72 a year. The measurement is one of
    // the things worth trying (0121 T4), so the prices are not taken away.
    const money = squash(tier.parentElement?.textContent);
    expect(money).toMatch(/12[.,]00/);
    expect(money).toMatch(/72[.,]00/);
  });

  it.each(LOCALES)('on a free tier, the line and 0109\'s "free" say the same thing, in %s', async (locale) => {
    vi.mocked(billingApi.getCurrentUsage).mockResolvedValue(usage(FREE));
    await billingPage(locale);
    expect(await screen.findByText(SAID[locale].free)).toBeInTheDocument();
    expect(underTheTitle()).toBe(SAID[locale].line);
    expect(document.body.textContent ?? '').not.toMatch(/€\s?0[.,]00/);
  });

  it.each(LOCALES)(
    'a member who may not see the figures reads that nothing is charged, and no claim about figures, in %s',
    async (locale) => {
      // Billing's reads are owner and admin only (2026-08-10), so a viewer is
      // shown no invoice details: the free tier's sentence is about that form.
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

  it.each(LOCALES)('says "charged", as the Alpha mails do, then the free tier\'s own sentence, in %s', (locale) => {
    // One promise in three places: the Alpha paragraph of both mails (T1),
    // the Billing line and the request hint. The alpha covers every tier and
    // says "charged". If the mails' word changes, this line changes with it.
    // The note said it too until 2026-10-04; it is now the owner's welcome
    // (0131 D4's amendment).
    const verb = { en: 'Nothing is charged', nl: 'niets in rekening gebracht' }[locale];
    for (const mail of ALPHA_MAILS) expect(renderEvent(mail, locale).body).toContain(verb);
    // Read from the product's dictionary, not from SAID above, so this case
    // fails when the product's words change, not only when the test's do.
    const charged = STRINGS[locale]['alpha.nothingCharged'];
    expect(charged).toContain(verb);
    // The second sentence IS the free tier's key (owner, 2026-09-24): one
    // sentence, so the line and the card cannot drift apart.
    expect(STRINGS[locale]['billing.party.notNeeded']).toBe(SAID[locale].notNeeded);
    expect(SAID[locale].line).toBe(`${charged} ${STRINGS[locale]['billing.party.notNeeded']}`);
  });

  it.each(LOCALES)('on a paid tier, the invoice details card says "not needed", not the amber ask, in %s', async (locale) => {
    await billingPage(locale);
    await screen.findByText('Medium');
    // The card's own paragraph; the line under the title holds it as its
    // second sentence, which the first case checks.
    expect(await screen.findByText(SAID[locale].notNeeded)).toBeInTheDocument();
    expect(underTheTitle()).toBe(SAID[locale].line);
    expect(document.body.textContent).not.toContain(SAID[locale].missing);
  });
});

describe('without the setting: the page as it is today (the control)', () => {
  it.each(LOCALES)('Billing keeps its subtitle, its four metered cards and its tier, in %s', async (locale) => {
    await billingPage(locale);
    await screen.findByText('Medium');
    // A paid tier still asks for the invoice details, in amber.
    expect(await screen.findByText(SAID[locale].missing)).toBeInTheDocument();
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

/**
 * The icon each card carries, by its lucide name. Each says what is measured:
 * a disk, data moving both ways, a stopwatch, a pulse of calls. This is the
 * check that holds the owner's answer. A word list alone cannot: lucide-react
 * has rising bar charts, a stock chart and price tags whose names say none of
 * the words below.
 */
const NEUTRAL_ICONS = ['hard-drive', 'arrow-left-right', 'timer', 'activity'];

/**
 * Words that make a glyph read as money or as a running meter. `lucide-react`
 * writes each icon's name into its class (`lucide-dollar-sign`), and each
 * alias's too, and a name is matched word by word, so `cent` catches
 * `badge-cent` and not `align-center`. The list names currencies, cards,
 * coins, notes, wallets, receipts, banks, gauges, price tags, trends, and
 * rising, candlestick and combined charts. It is a second check beside the
 * pinned icons above, and it does not cover every glyph that could read as
 * money.
 */
const MONEY_OR_METER = new Set([
  'dollar', 'euro', 'cent', 'pound', 'sterling', 'yen', 'rupee', 'ruble', 'franc', 'lira',
  'peso', 'riyal', 'bitcoin', 'currency', 'credit', 'banknote', 'coins', 'wallet', 'piggy',
  'receipt', 'landmark', 'vault', 'calculator', 'percent', 'shopping', 'tag', 'tags', 'gauge',
  'meter', 'trending', 'increasing', 'candlestick', 'combined',
]);

/** The lucide names an icon carries in its class: `lucide-hard-drive` gives `hard-drive`. */
const iconNames = (svg: Element): string[] =>
  (svg.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((c) => c.startsWith('lucide-'))
    .map((c) => c.slice('lucide-'.length));

const readsAsMoney = (name: string): boolean => name.split('-').some((w) => MONEY_OR_METER.has(w));

/** The Current usage section: the smallest block around its heading that holds all four cards. */
function usageSection(locale: Locale): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: SAID[locale].currentUsage });
  let section: HTMLElement = heading;
  while (!SAID[locale].metered.every((label) => (section.textContent ?? '').includes(label))) {
    expect(section.parentElement, 'the four cards are not under the Current usage heading').not.toBeNull();
    section = section.parentElement!;
  }
  return section;
}

/** One card: the largest block around its label that holds no other card's label. */
function cardOf(section: HTMLElement, label: string, locale: Locale): HTMLElement {
  const others = SAID[locale].metered.filter((l) => l !== label);
  let card = within(section).getByText(label);
  while (
    card.parentElement &&
    card.parentElement !== section &&
    !others.some((other) => (card.parentElement!.textContent ?? '').includes(other))
  ) {
    card = card.parentElement;
  }
  return card;
}

/** A stored card, so the Payment Methods card draws its own credit-card icon. */
const VISA = {
  id: 'pm-1',
  tenantId: 't1',
  type: 'card',
  brand: 'Visa',
  lastFour: '4242',
  expiryMonth: 12,
  expiryYear: 2028,
  isDefault: true,
  createdAt: '2026-09-01T00:00:00.000Z',
};

/**
 * During the Alpha and outside it. The owner's answer is the same for both:
 * the cards stay, without money icons, and nothing is hidden. The third case
 * sets the edition flag to the appliance, with the setting on. The appliance
 * itself never routes to this page (`AppRoutes.tsx`: no Billing chunk, and
 * `ManagedOnly` sends it to /confirm). The case only shows that the cards do
 * not depend on the edition flag.
 */
const DEPLOYMENTS = [
  { name: 'during the Alpha', stage: 'alpha', selfhost: false },
  { name: 'outside the Alpha', stage: undefined, selfhost: false },
  { name: 'with the edition flag set to the appliance, and the setting on', stage: 'alpha', selfhost: true },
] as const;

describe.each(DEPLOYMENTS)(
  'the four measurement cards: kept, and nothing on them looks like money (owner, 2026-10-04), $name',
  ({ stage, selfhost }) => {
    beforeEach(() => {
      if (stage) vi.stubEnv('VITE_OWNPACE_STAGE', stage);
      editionFlag.selfhost = selfhost;
      vi.mocked(billingApi.getPaymentMethods).mockResolvedValue({ paymentMethods: [VISA] });
    });

    it.each(LOCALES)('each card is shown with its figure, in %s', async (locale) => {
      await billingPage(locale);
      await screen.findByText('Medium');
      const section = usageSection(locale);
      SAID[locale].metered.forEach((label, i) => {
        const card = cardOf(section, label, locale);
        expect(within(card).getByText(SAID[locale].figures[i]!)).toBeInTheDocument();
        // A measurement, not a price: no currency sign on the card.
        expect(card.textContent ?? '').not.toMatch(/[€$£¥]/);
      });
    });

    it.each(LOCALES)(
      'each card has its own neutral icon, none on the money list; Payment Methods keeps its card, in %s',
      async (locale) => {
        await billingPage(locale);
        await screen.findByText('Visa •••• 4242');
        const section = usageSection(locale);

        // Each card still carries one icon, so the cards keep their layout.
        for (const label of SAID[locale].metered) {
          const icons = cardOf(section, label, locale).querySelectorAll('svg');
          expect(icons, `the ${label} card should carry one icon`).toHaveLength(1);
          expect(iconNames(icons[0]!), `the ${label} card's icon has no lucide name`).not.toHaveLength(0);
        }

        const money = [...section.querySelectorAll('svg')]
          .flatMap(iconNames)
          .filter(readsAsMoney);
        expect(money, 'these icons in Current usage read as money or a running meter').toEqual([]);

        // Each card's icon is the neutral one named for it, and no other.
        SAID[locale].metered.forEach((label, i) => {
          const icon = cardOf(section, label, locale).querySelector('svg')!;
          expect(iconNames(icon), `the ${label} card's icon`).toEqual([NEUTRAL_ICONS[i]]);
        });

        // The Payment Methods card is about payment methods: its credit card
        // stays. And it shows this guard can see an icon's name at all.
        const methods = screen.getByRole('heading', { level: 2, name: SAID[locale].paymentMethods });
        expect(section.contains(methods)).toBe(false);
        const visa = screen.getByText('Visa •••• 4242').closest('div.flex')!;
        expect([...visa.querySelectorAll('svg')].flatMap(iconNames)).toContain('credit-card');
      },
    );
  },
);
