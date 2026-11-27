// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * EVERYTHING A LINK SAYS, ON ONE PAGE (workplan 0176 D15 (a); the owner,
 * 2026-11-26: *"D15: a"*).
 *
 * A person's link asks one thing per screen. The desk review settled a
 * disagreement about length with a second way to read: the short screens, and
 * from them the same sentences on one page, which prints. The steps are gone
 * once the person is at the provider; paper is still on the table.
 *
 * So *Everything on one page* (`/grant/<link>/all`) says every sentence the
 * steps of that link say, in their order, written once: the steps' own
 * dictionary keys. Held here by walking every step a link has, reading what
 * each says, and finding all of it on the one page. A sentence added to a
 * step and not to this page fails here, which is the point. What this page
 * leaves out, each for its reason:
 *
 * - **every button.** The one page reads, and leads back to the steps to act:
 *   no provider's button, no answer to the question, no *Next*;
 * - **the password card** (`data-password-card`), where a password is typed:
 *   the one page types nothing;
 * - ***Step n of total***: there are no steps on it;
 * - ***The next step is on {provider}'s own page.***, which says where the
 *   provider's button goes, and there is none;
 * - ***The next screen shows from where and to where.***: there is no next
 *   screen, so it says *further down this page* (`grant.onePage.whatMany`);
 * - ***Read everything on one page***, the steps' link to this page.
 *
 * And it asks the API for what the link page asks, and nothing more.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { readMock, authorizeMock, reportAvailableMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
}));

vi.mock('../services/grant-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-service.ts')>()),
  grantApi: { read: readMock, authorize: authorizeMock, authorizeDrive: vi.fn(), password: vi.fn(), putPassword: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: () => 'a server sentence' }));

import Grant from './Grant.tsx';
import PersonGrantOnePage, { ONE_PAGE_ROUTE, onePagePath } from './PersonGrantOnePage.tsx';

/** A person's link: `p.<id>.<secret>`. */
const ID = 'b2c3d4';
const LINK = `p.${ID}.not-a-secret`;
const STEPS = `/grant/${LINK}`;
const ONE_PAGE = `${STEPS}/all`;
const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

const GMAIL = {
  ref: 'ref-gmail',
  role: 'source',
  way: 'sign-in',
  provider: 'google',
  account: 'anna@work.example',
  granted: false,
  again: false,
  domains: ['email', 'calendar'],
  scope: 'https://mail.google.com/ https://www.googleapis.com/auth/calendar openid',
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [
    { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false, theOrganisationOpensIt: true },
    { domains: ['calendar'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: false, theOrganisationOpensIt: false },
  ],
};
const MICROSOFT = {
  ...GMAIL,
  ref: 'ref-ms',
  provider: 'microsoft',
  account: 'anna@outlook.example',
  domains: ['file'],
  scope: 'offline_access openid email profile User.Read Files.Read',
  readOnlyAtProvider: true,
  migrations: [
    { domains: ['file'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: false, theOrganisationOpensIt: false },
  ],
};
const PASSWORD = {
  ref: 'ref-imap',
  role: 'source',
  way: 'password',
  provider: 'imap',
  account: 'anna@mail.example',
  server: { hosts: ['imap.mail.example'], published: false },
  fields: [{ key: 'password', who: 'person', labelKey: 'connections.field.password', secret: true, autoComplete: 'new-password' }],
  tries: { left: 5, locked: false },
  granted: false,
  again: false,
  domains: ['email'],
  scope: null,
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [
    { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false, theOrganisationOpensIt: false },
  ],
};

const subject = (accounts: readonly unknown[], over: Record<string, unknown> = {}) => ({
  kind: 'person',
  organisation: 'Acme Families',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: '+31 20 123 4567',
  accounts,
  expiresAt: IN_A_WEEK,
  ...over,
});

/** The links a test reads: each the steps and the one page are read for. */
const LINKS: ReadonlyArray<readonly [string, ReturnType<typeof subject>, { alpha: boolean }]> = [
  ['a Google, a Microsoft and a password account, all waiting, during the Alpha', subject([GMAIL, MICROSOFT, PASSWORD]), { alpha: true }],
  ['one Google account to one place, outside the Alpha, with no number to call', subject([{ ...GMAIL, migrations: [GMAIL.migrations[0]] }], { organisationPhone: null }), { alpha: false }],
  [
    'one account connected, one asked again, one that cannot be asked yet, and a new address',
    subject(
      [
        { ...GMAIL, granted: true },
        { ...MICROSOFT, granted: true, again: true },
        { ...PASSWORD, notReady: { reason: 'its server is not set yet', reasonNl: 'de server ervan is nog niet ingesteld' } },
      ],
      { addressChanges: [{ ref: 'addr-1', newAddress: 'anna@soverin.net', state: 'proposed' }] },
    ),
    { alpha: true },
  ],
  [
    'a password account with its tries spent, and a Cirrux Drive to connect',
    subject([
      { ...PASSWORD, tries: { left: 0, locked: true } },
      {
        ...GMAIL,
        ref: 'ref-cirrux',
        role: 'target',
        provider: 'cirrux',
        account: 'anna@cirrux.example',
        domains: ['file'],
        scope: null,
        readOnlyAtProvider: false,
        migrations: [{ domains: ['file'], from: { provider: 'google', account: 'anna@work.example' }, to: { provider: 'cirrux', host: null, account: 'anna@cirrux.example' }, granted: false }],
      },
    ]),
    { alpha: false },
  ],
];

function renderAt(entry: string | { pathname: string; state: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/grant/:link', element: <Grant /> },
      { path: ONE_PAGE_ROUTE, element: <PersonGrantOnePage /> },
    ],
    { initialEntries: [entry] },
  );
  const view = render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}

const BLOCKS = 'p, li, h1, h2, h3, h4, dt, dd, summary';
const flat = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * What a screen says, a sentence at a time: each block that holds no block,
 * and each line drawn outside one (a card's state), but nothing a button says
 * and nothing inside the password card.
 */
function saidOn(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`${BLOCKS}, span`)) {
    if (el.closest('button, [data-password-card]')) continue;
    if (el.tagName === 'SPAN' ? el.parentElement?.closest(BLOCKS) : el.querySelector(BLOCKS)) continue;
    if (el.tagName === 'SPAN' && el.querySelector('span')) continue;
    const text = flat(el.textContent);
    if (text !== '') out.push(text);
  }
  return out;
}

/** Each step a link has, as the browser's history names it (`PersonGrant.tsx`'s `StepState`). */
function stepsOf(s: ReturnType<typeof subject>): Array<{ grantStep: string; account?: string }> {
  const accounts = s.accounts as Array<typeof GMAIL & { tries?: { locked: boolean } | null }>;
  const connected = (a: (typeof accounts)[number]) => a.granted && !a.again;
  const pressable = (a: (typeof accounts)[number]) => !connected(a) && a.tries?.locked !== true && a.notReady === null;
  const waiting = accounts.filter(pressable);
  const askApplies = accounts.every((a) => !connected(a));
  const addresses = ((s as { addressChanges?: unknown[] }).addressChanges ?? []).length > 0;
  const steps: Array<{ grantStep: string; account?: string }> = [];
  if (askApplies) steps.push({ grantStep: 'ask' }, { grantStep: 'notYet' });
  // As the steps decide it (§5.3): one waiting account and nothing else goes straight on.
  if (accounts.length > 1 || !askApplies || addresses || !pressable(accounts[0]!)) steps.push({ grantStep: 'accounts' });
  for (const a of waiting) {
    steps.push({ grantStep: 'ready', account: a.ref });
    if (a.way === 'sign-in') steps.push({ grantStep: 'provider', account: a.ref }, { grantStep: 'ratherNot', account: a.ref });
  }
  return steps;
}

/** What the steps say that the one page does not, by its reason (above). */
function leftOut(locale: 'en' | 'nl'): RegExp[] {
  const words = STRINGS[locale];
  const shape = (key: keyof typeof words) =>
    new RegExp(`^${words[key].replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{[a-z]+\\\}|\{[a-z]+\}/g, '.+')}$`);
  return [shape('grant.step'), shape('grant.person.see.next'), shape('grant.person.whatMany'), shape('grant.onePage.link')];
}

beforeEach(() => {
  readMock.mockReset();
  authorizeMock.mockReset();
  // A report can reach somebody, so *Report this link* is drawn as a tester meets it.
  reportAvailableMock.mockResolvedValue(true);
  window.sessionStorage.setItem(`ownpace.grant.told.${ID}`, 'yes');
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.sessionStorage.clear();
  window.localStorage.removeItem('ownpace.locale');
});

describe('everything a person’s link says, on one page (D15 (a))', () => {
  for (const [what, s, { alpha }] of LINKS) {
    for (const locale of ['en', 'nl'] as const) {
      it(`says every sentence its steps say: ${what}, in ${locale === 'en' ? 'English' : 'Dutch'}`, async () => {
        window.localStorage.setItem('ownpace.locale', locale);
        if (alpha) vi.stubEnv('VITE_OWNPACE_STAGE', 'alpha');
        readMock.mockResolvedValue(s);

        const said = new Map<string, string>();
        for (const state of stepsOf(s)) {
          const view = renderAt({ pathname: STEPS, state });
          await screen.findByRole('heading', { level: 1 });
          const step = view.container.querySelector('[data-step]')?.getAttribute('data-step');
          expect(step, `the steps did not open ${JSON.stringify(state)}`).toBe(state.grantStep);
          for (const sentence of saidOn(view.container)) said.set(sentence, state.grantStep);
          view.unmount();
        }
        expect(said.size, 'the steps said nothing, so nothing was compared').toBeGreaterThan(10);

        const page = renderAt(ONE_PAGE);
        await screen.findByRole('heading', { level: 1, name: STRINGS[locale]['grant.onePage.title'] });
        await screen.findByText(STRINGS[locale]['grant.person.ownpace']);
        const all = flat(page.container.textContent);
        const skip = leftOut(locale);
        const missing = [...said]
          .filter(([sentence]) => !skip.some((r) => r.test(sentence)))
          .filter(([sentence]) => !all.includes(sentence))
          .map(([sentence, step]) => `${step}: ${sentence}`);
        expect(missing).toEqual([]);
        // What it leaves out is left out, and nothing promises a next screen.
        for (const r of skip) expect(saidOn(page.container).filter((x) => r.test(x)), String(r)).toEqual([]);
      });
    }
  }
});

describe('the one page reads, and leads back to the steps to act', () => {
  it('has one heading of its own, names the tab after it, and asks the API for its link and nothing else', async () => {
    readMock.mockResolvedValue(subject([GMAIL, MICROSOFT]));
    renderAt(ONE_PAGE);
    await screen.findByText(STRINGS.en['grant.person.ownpace']);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Everything on one page']);
    expect(document.title).toBe('Everything on one page — Ownpace');
    expect(readMock.mock.calls).toEqual([[LINK]]);
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it('holds no button that leaves for a provider or answers for the person, and no box to type in', async () => {
    readMock.mockResolvedValue(subject([GMAIL, MICROSOFT, PASSWORD]));
    const { container } = renderAt(ONE_PAGE);
    await screen.findByRole('button', { name: 'Report this link' });
    const buttons = screen.getAllByRole('button').map((b) => flat(b.textContent));
    expect(buttons).toEqual(['English', 'Nederlands', 'Print this page', 'Report this link']);
    expect(container.querySelectorAll('input, textarea, select, form')).toHaveLength(0);
  });

  it('prints: its button asks the browser to, and the controls stay off the paper', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    readMock.mockResolvedValue(subject([GMAIL]));
    const { container } = renderAt(ONE_PAGE);
    await screen.findByRole('button', { name: 'Report this link' });
    await userEvent.click(await screen.findByRole('button', { name: 'Print this page' }));
    expect(print).toHaveBeenCalledTimes(1);
    for (const control of container.querySelectorAll('button, [data-foot] [data-look], a[data-back]')) {
      expect(control.closest('.print\\:hidden'), `${flat(control.textContent)} prints`).not.toBeNull();
    }
    print.mockRestore();
  });

  it('leads back to the steps of the same link', async () => {
    readMock.mockResolvedValue(subject([GMAIL]));
    renderAt(ONE_PAGE);
    const back = await screen.findAllByRole('link', { name: 'Back to the steps' });
    expect(back.length).toBeGreaterThan(0);
    for (const a of back) expect(a.getAttribute('href')).toBe(STEPS);
    expect(onePagePath(LINK)).toBe(ONE_PAGE);
  });

  it('says where the service runs under its first line, where the deployment says so', async () => {
    vi.stubEnv('VITE_OWNPACE_COUNTRY', 'BE');
    readMock.mockResolvedValue(subject([GMAIL]));
    renderAt(ONE_PAGE);
    const first = await screen.findByText(STRINGS.en['grant.person.ownpace']);
    expect(first.nextElementSibling?.textContent).toBe('Ownpace runs in Belgium.');
  });

  it('and nothing about it where the deployment sets nothing', async () => {
    vi.stubEnv('VITE_OWNPACE_COUNTRY', '');
    readMock.mockResolvedValue(subject([GMAIL]));
    const { container } = renderAt(ONE_PAGE);
    await screen.findByText(STRINGS.en['grant.person.ownpace']);
    expect(container.querySelector('[data-where-it-runs]')).toBeNull();
    expect(container.textContent).not.toMatch(/runs in/);
  });

  it('in Dutch, in its own words, which say kopiëren and never a form of migreren', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    readMock.mockResolvedValue(subject([GMAIL, MICROSOFT]));
    renderAt(ONE_PAGE);
    expect(await screen.findByRole('heading', { level: 1, name: 'Alles op één pagina' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Deze pagina afdrukken' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Terug naar de stappen' }).length).toBeGreaterThan(0);
    expect(document.title).toBe('Alles op één pagina — Ownpace');
    const own = Object.entries(STRINGS.nl).filter(([key]) => key.startsWith('grant.onePage.') || key === 'grant.person.runsIn');
    expect(own.length).toBeGreaterThan(4);
    expect(own.filter(([, nl]) => /migr/i.test(nl))).toEqual([]);
  });

  it('a migration’s own link is one page already: it goes there', async () => {
    readMock.mockResolvedValue({
      organisation: 'Acme Families',
      checkedCompany: null,
      askedBy: 'owner@example.org',
      organisationPhone: null,
      domains: ['email'],
      scope: 'https://mail.google.com/ openid',
      readOnlyAtProvider: false,
      from: 'anna@work.example',
      to: { provider: 'soverin', host: null, account: 'anna@soverin.net' },
      expiresAt: IN_A_WEEK,
    });
    const { router } = renderAt('/grant/m1.not-a-secret/all');
    await waitFor(() => expect(router.state.location.pathname).toBe('/grant/m1.not-a-secret'));
  });

  it('says a refused link’s refusal, as an alert', async () => {
    readMock.mockRejectedValue(new Error('gone'));
    renderAt(ONE_PAGE);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/./)).toBeInTheDocument();
  });
});
