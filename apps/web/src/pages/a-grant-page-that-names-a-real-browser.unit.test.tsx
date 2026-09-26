// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A GRANT PAGE THAT NAMES A REAL BROWSER (workplan 0140 T3 (a)).
 *
 * A grant link travels by chat or mail, and it opens where it was tapped:
 * inside that app's own browser. Google is reported to refuse its consent in
 * an embedded web view (*"Error 403: disallowed_useragent"*; outside knowledge,
 * 0140 §1, not verified here), and nothing on the page said what to do. The
 * way out was always there, because opening a grant link spends nothing
 * (`grant.ts`: *"Opening is repeatable right up until somebody actually
 * grants"*), but nobody was told to take it.
 *
 * So one plain line, always shown, with no sniffing for in-app browsers: above
 * *Continue with Google* on the grant page, and under *Connect with Google* in
 * the lines both doors share (`ConsentLines`). The grant page's ends *"The link
 * still works"*; the wizard's and the Connections page's end *"then sign in to
 * Ownpace there"*, because there is no grant link to reopen there.
 *
 * What is pinned, in English and in Dutch: the grant page carries its line
 * before the button; the consent panel and the wizard carry theirs beside the
 * button, which points at it (`aria-describedby`), because there it comes
 * after the button and a screen reader would otherwise reach the button first
 * (the review of 2026-09-26); each names Safari and Chrome and the other
 * app's own "Open in browser"; and Dropbox's and Microsoft's buttons carry
 * none, because how they behave in an embedded browser is not known (0140 §1).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { readMock, clients } = vi.hoisted(() => ({ readMock: vi.fn(), clients: vi.fn() }));

vi.mock('../services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn().mockResolvedValue(false), send: vi.fn() },
}));
vi.mock('../services/mapping-service', () => ({
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

import Grant from './Grant.tsx';
import CreateMapping from './CreateMapping.tsx';
import { ProviderConsentPanel, useProviderConsent } from '../components/ProviderConsent.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/** What every version of the line has to name, in each language. */
const A_REAL_BROWSER: Readonly<Record<Locale, RegExp>> = {
  en: /Safari or Chrome/,
  nl: /Safari of Chrome/,
};
const THE_OTHER_APPS_OPTION: Readonly<Record<Locale, RegExp>> = {
  en: /'Open in browser'/,
  nl: /'Openen in browser'/,
};
/** How each version ends: the grant link is reopened, the app is signed in to again. */
const GRANT_ENDING: Readonly<Record<Locale, RegExp>> = {
  en: /The link still works\.$/,
  nl: /De link blijft werken\.$/,
};
const APP_ENDING: Readonly<Record<Locale, RegExp>> = {
  en: /sign in to Ownpace there\.$/,
  nl: /meld u in die browser aan bij Ownpace\.$/,
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
  reads: 'your calendars',
  scope: 'https://www.googleapis.com/auth/calendar.readonly openid https://www.googleapis.com/auth/userinfo.email',
  readOnlyAtProvider: false,
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

/** What a screen reader hears for the button beyond its name: the text of every element it points at. */
const describedBy = (button: HTMLElement): string =>
  (button.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

/** True when `a` comes before `b` in the document. */
const before = (a: Node, b: Node): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('the grant page says to open the link in Safari or Chrome, before the button (0140 T3 (a))', () => {
  for (const locale of LOCALES) {
    it(`${locale}: the line is there, above Continue with Google, and says the link still works`, async () => {
      readMock.mockResolvedValue(SUBJECT);
      wrap(locale, <Grant />, '/grant/abc.def', '/grant/:link');
      const button = await screen.findByRole('button', { name: words(locale, 'grant.connect') });
      const line = screen.getByText(words(locale, 'grant.inAppBrowser'));
      expect(before(line, button), 'the line must be read before the button is pressed').toBe(true);
      expect(line.textContent).toMatch(A_REAL_BROWSER[locale]);
      expect(line.textContent).toMatch(THE_OTHER_APPS_OPTION[locale]);
      expect(line.textContent).toMatch(GRANT_ENDING[locale]);
    });
  }
});

/** The Connections page's consent, without the page around it. */
const Panel: React.FC<{ type: string }> = ({ type }) => {
  const consent = useProviderConsent({
    role: 'source',
    type,
    fields: credentialFieldsFor('source', type),
    values: { username: 'owner@example.invalid' },
    onToken: () => {},
    refusalText: (e) => String(e),
  });
  return <ProviderConsentPanel consent={consent} />;
};

describe('the consent panel and the wizard say it beside Connect with Google (0140 T3 (a))', () => {
  for (const locale of LOCALES) {
    const lineFor = (button: HTMLElement): HTMLElement => {
      const line = screen.getByText(words(locale, 'wizard.google.inAppBrowser'));
      expect(button.parentElement, 'the line is not beside the button').toContainElement(line);
      expect(
        describedBy(button),
        'the line comes after the button, so the button must point at it or a screen reader presses first',
      ).toContain(words(locale, 'wizard.google.inAppBrowser'));
      return line;
    };

    it(`${locale}: a Google account's panel carries it, ending with signing in again`, async () => {
      wrap(locale, <Panel type="google" />, '/connections', '/connections');
      const button = await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') });
      const line = lineFor(button);
      expect(line.textContent).toMatch(A_REAL_BROWSER[locale]);
      expect(line.textContent).toMatch(THE_OTHER_APPS_OPTION[locale]);
      expect(line.textContent).toMatch(APP_ENDING[locale]);
      expect(line.textContent, 'there is no grant link to reopen here').not.toMatch(GRANT_ENDING[locale]);
    });

    for (const type of ['gmail', 'google-drive'] as const) {
      it(`${locale}: the ${type} card's panel carries it too, whatever it asks for`, async () => {
        wrap(locale, <Panel type={type} />, '/connections', '/connections');
        lineFor(await screen.findByRole('button', { name: words(locale, 'wizard.google.connect') }));
      });
    }

    for (const provider of ['dropbox', 'microsoft'] as const) {
      it(`${locale}: ${provider}'s button carries no Google line`, async () => {
        wrap(locale, <Panel type={provider} />, '/connections', '/connections');
        expect(
          await screen.findByRole('button', { name: words(locale, `wizard.${provider}.connect`) }),
        ).toBeTruthy();
        expect(screen.queryByText(words(locale, 'wizard.google.inAppBrowser'))).toBeNull();
      });
    }

    it(`${locale}: the wizard's Connect with Google carries the same line`, async () => {
      wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
      fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: words(locale, 'wizard.google.connect') })).toBeTruthy(),
      );
      lineFor(screen.getByRole('button', { name: words(locale, 'wizard.google.connect') }));
    });
  }
});
