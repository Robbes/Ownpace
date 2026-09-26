// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERMISSION DESCRIBED AS IT IS (workplan 0144 T3 (a) and (c)).
 *
 * The readiness review of 2026-09-23 found the grant page opening a green box
 * with *"Read-only."* directly above the scope Google was about to record. For
 * a Gmail link that scope is `https://mail.google.com/`, and Google's own
 * screen, one click later, says the app may read, send and permanently delete
 * all mail. Calendars and contacts are the same: `auth/calendar` and
 * `auth/carddav` allow changes. Only Drive and Tasks are asked for with a scope
 * Google itself holds to reading. And the wizard's *Connect with Google* said
 * nothing about it at all, so the first a tester heard of "delete all your
 * email" was Google's page.
 *
 * What is true on both: Ownpace only reads, whatever the permission allows.
 * The page and the line now say that, and say "read-only" only where Google
 * enforces it.
 *
 * What is pinned, in English and in Dutch:
 *  1. the grant page, for a grant Google does not hold to reading, says Ownpace
 *     only reads and that Google describes the permission more broadly, and its
 *     box does not open with "Read-only" / "Alleen lezen"; for one Google does
 *     hold to reading, it does;
 *  2. one line sits beside *Connect with Google*, in the wizard and in the
 *     consent panel both doors share, when the consent asks for mail,
 *     calendars or contacts, and not for Drive or Tasks alone, nor beside
 *     another provider's button. The deployment's app or the person's own
 *     makes no difference: the scope Google shows is the same. What the
 *     deployment does decide is which faces a consent may ask for at all, and
 *     a tick outside that answer asks Google for nothing, so it brings no line.
 *     The line is §3's two sentences, whole: which three, and that Ownpace
 *     only reads and changes and deletes nothing.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from './i18n/index.tsx';
import { STRINGS } from './i18n/strings.ts';

const { readMock, clients } = vi.hoisted(() => ({ readMock: vi.fn(), clients: vi.fn() }));

vi.mock('./services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: vi.fn() },
}));
vi.mock('./services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn().mockResolvedValue(false), send: vi.fn() },
}));
vi.mock('./services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    microsoftAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  },
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({ ok: false, reason: 'not in this test' }),
    rotate: vi.fn(),
    test: vi.fn(),
  },
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  providerClientsApi: { get: clients },
  setupApi: { get: vi.fn(), setStep: vi.fn() },
}));

import Grant from './pages/Grant.tsx';
import CreateMapping from './pages/CreateMapping.tsx';
import { ProviderConsentPanel, useProviderConsent } from './components/ProviderConsent.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/** How the box opened before this task, in each language. */
const READ_ONLY_OPENING: Readonly<Record<Locale, RegExp>> = { en: /^Read-only\./, nl: /^Alleen lezen\./ };
/** What the broader sentence has to name, in each language: the three whose permission can write. */
const THE_THREE: Readonly<Record<Locale, RegExp>> = {
  en: /mail, calendars and contacts/,
  nl: /e-mail, agenda’s en contacten/,
};
/**
 * What the line beside the button promises, in §3's words: Ownpace only reads,
 * and changes AND deletes nothing. Deletion is the word Google's screen uses
 * ("permanently delete"), so it is the one a tester is most likely to worry
 * about, and a line that dropped it would answer the smaller fear.
 */
const THE_PROMISE: Readonly<Record<Locale, RegExp>> = {
  en: /Ownpace only reads; it changes and deletes nothing/,
  nl: /Ownpace leest alleen; het wijzigt en verwijdert niets/,
};

function wrap(locale: Locale, node: React.ReactNode, path: string, route: string) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={node} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const SUBJECT = {
  organisation: 'Acme Legal',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: null,
  reads: 'your email — messages, folders and labels',
  scope: 'https://mail.google.com/ openid https://www.googleapis.com/auth/userinfo.email',
  from: 'someone@example.invalid',
  to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

/** The green box's sentence: the one `<span>` beside the shield. */
async function boxText(): Promise<string> {
  const button = await screen.findByRole('button', { name: /Continue with Google|Doorgaan met Google/ });
  const box = button.ownerDocument.querySelector('.bg-green-50');
  expect(box, 'the grant page has no box above the scope').not.toBeNull();
  return (box as HTMLElement).textContent ?? '';
}

describe('the grant page says "read-only" only where Google enforces it (0144 T3 (c))', () => {
  for (const locale of LOCALES) {
    it(`${locale}: a grant Google does not hold to reading says Ownpace only reads, and that Google describes more`, async () => {
      readMock.mockResolvedValue({ ...SUBJECT, readOnlyAtProvider: false });
      wrap(locale, <Grant />, '/grant/abc.def', '/grant/:link');
      const text = await boxText();
      expect(text).toBe(words(locale, 'grant.readsOnly'));
      expect(text).not.toMatch(READ_ONLY_OPENING[locale]);
      expect(text).toMatch(THE_THREE[locale]);
      // Everything the old box promised that stays true is still said.
      expect(text).toMatch(locale === 'en' ? /never deletes or changes/ : /verwijdert of wijzigt nooit/);
      expect(text).toMatch(locale === 'en' ? /sees your password/ : /ziet ooit uw wachtwoord/);
    });

    it(`${locale}: a grant Google holds to reading keeps "Read-only", which is then true`, async () => {
      readMock.mockResolvedValue({
        ...SUBJECT,
        reads: 'your tasks',
        scope: 'https://www.googleapis.com/auth/tasks.readonly openid https://www.googleapis.com/auth/userinfo.email',
        readOnlyAtProvider: true,
      });
      wrap(locale, <Grant />, '/grant/abc.def', '/grant/:link');
      const text = await boxText();
      expect(text).toBe(words(locale, 'grant.readOnly'));
      expect(text).toMatch(READ_ONLY_OPENING[locale]);
    });
  }
});

/** The Connections page's consent, without the page around it. */
const Panel: React.FC<{ type: string; values: Record<string, string> }> = ({ type, values }) => {
  const consent = useProviderConsent({
    role: 'source',
    type,
    fields: credentialFieldsFor('source', type),
    values,
    onToken: () => {},
    refusalText: (e) => String(e),
  });
  return <ProviderConsentPanel consent={consent} />;
};

const renderPanel = (locale: Locale, type: string) =>
  wrap(
    locale,
    <Panel type={type} values={{ username: 'owner@example.invalid' }} />,
    '/connections',
    '/connections',
  );

/** Whether the line sits beside this button: inside the block the button is in. */
function lineBeside(locale: Locale, button: HTMLElement): HTMLElement | null {
  const line = screen.queryByText(words(locale, 'wizard.google.readsOnly'));
  if (line) expect(button.parentElement, 'the line is not beside the button').toContainElement(line);
  return line;
}

describe('one line beside Connect with Google, in the consent panel (0144 T3 (a))', () => {
  for (const locale of LOCALES) {
    const connect = () =>
      screen.getByRole('button', { name: words(locale, 'wizard.google.connect') });

    it(`${locale}: a Google account with calendars ticked shows it`, async () => {
      renderPanel(locale, 'google');
      fireEvent.click(await screen.findByLabelText(words(locale, 'domain.calendar')));
      const line = lineBeside(locale, connect());
      expect(line).not.toBeNull();
      // Which three, and the whole promise: reads only, changes and deletes nothing.
      expect(line!.textContent).toMatch(THE_THREE[locale]);
      expect(line!.textContent).toMatch(THE_PROMISE[locale]);
    });

    it(`${locale}: a Google account with tasks alone does not`, async () => {
      renderPanel(locale, 'google');
      fireEvent.click(await screen.findByLabelText(words(locale, 'domain.task')));
      expect(lineBeside(locale, connect())).toBeNull();
    });

    for (const [type, shown] of [
      ['gmail', true],
      ['google-calendar', true],
      ['google-contacts', true],
      ['google-drive', false],
    ] as const) {
      it(`${locale}: the ${type} card ${shown ? 'shows it' : 'does not'}`, async () => {
        renderPanel(locale, type);
        await waitFor(() => expect(connect()).toBeTruthy());
        expect(lineBeside(locale, connect()) !== null).toBe(shown);
      });
    }

    for (const [type, provider] of [
      ['dropbox', 'dropbox'],
      ['microsoft', 'microsoft'],
    ] as const) {
      it(`${locale}: ${type}'s own button carries no Google line`, async () => {
        renderPanel(locale, type);
        expect(
          await screen.findByRole('button', { name: words(locale, `wizard.${provider}.connect`) }),
        ).toBeTruthy();
        expect(screen.queryByText(words(locale, 'wizard.google.readsOnly'))).toBeNull();
      });
    }
  }
});

describe('the same line beside the wizard’s Connect with Google (0144 T3 (a))', () => {
  const renderWizard = (locale: Locale) => wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');

  for (const locale of LOCALES) {
    for (const fact of ['deployment', 'connection'] as const) {
      const connect = () =>
        screen.getByRole('button', { name: words(locale, 'wizard.google.connect') });

      it(`${locale}, ${fact}'s app: Gmail shows it, Google Drive does not`, async () => {
        clients.mockResolvedValue({ google: fact, dropbox: fact, microsoft: fact });
        renderWizard(locale);
        fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
        await waitFor(() => expect(connect()).toBeTruthy());
        expect(lineBeside(locale, connect())).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /^Google Drive/ }));
        await waitFor(() => expect(connect()).toBeTruthy());
        expect(lineBeside(locale, connect())).toBeNull();
      });
    }

    it(`${locale}: a Google account shows it while calendars or contacts are ticked, and not for tasks alone`, async () => {
      renderWizard(locale);
      fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
      const connect = () =>
        screen.getByRole('button', { name: words(locale, 'wizard.google.connect') });
      await waitFor(() => expect(connect()).toBeTruthy());
      const faces = connect().parentElement as HTMLElement;
      // Whatever the card ticks on its own, end with calendars and tasks ticked.
      for (const key of ['domain.calendar', 'domain.contact', 'domain.task']) {
        const box = within(faces).getByLabelText(words(locale, key)) as HTMLInputElement;
        const want = key !== 'domain.contact';
        if (box.checked !== want) fireEvent.click(box);
      }
      expect(lineBeside(locale, connect())).not.toBeNull();

      fireEvent.click(within(faces).getByLabelText(words(locale, 'domain.calendar')));
      expect(lineBeside(locale, connect())).toBeNull();
    });

    it(`${locale}: a tick this deployment does not serve is not what the consent asks, so it brings no line`, async () => {
      // The source step's faces are all five, while `/api/provider-accounts`
      // serves calendars, contacts and tasks here (nothing declared). E-mail
      // ticked on such a deployment is refused before Google is asked, so
      // there is no permission for the line to describe (the ceiling guard's
      // rule: the deployment answers once, and the screen asks).
      renderWizard(locale);
      fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
      const connect = () =>
        screen.getByRole('button', { name: words(locale, 'wizard.google.connect') });
      await waitFor(() => expect(connect()).toBeTruthy());
      const faces = connect().parentElement as HTMLElement;
      for (const key of ['domain.email', 'domain.calendar', 'domain.contact', 'domain.task']) {
        const box = within(faces).getByLabelText(words(locale, key)) as HTMLInputElement;
        const want = key === 'domain.email' || key === 'domain.task';
        if (box.checked !== want) fireEvent.click(box);
      }
      expect(lineBeside(locale, connect())).toBeNull();
    });
  }
});
