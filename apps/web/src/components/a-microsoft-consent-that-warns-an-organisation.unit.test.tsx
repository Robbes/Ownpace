// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MICROSOFT CONSENT THAT WARNS AN ORGANISATION (workplan 0140 T6 (b)).
 *
 * The deployment's Microsoft app is registered for every organisation and for
 * personal accounts, and its authority defaults to `common` (0140 §4.1). An
 * organisation decides who in it may consent to an app like that: most follow
 * Microsoft's recommended setting, under which an app from an unverified
 * publisher, and a mailbox read from any app, need an administrator's approval
 * (§4.3, Microsoft's documentation as understood there, not yet measured: T6's
 * two consents do that). A tester from an organisation met this only AFTER
 * pressing *Connect with Microsoft*, as `microsoftConsentRefusal`'s sentence
 * for `AADSTS65001` and `AADSTS90094`. §4.4 advises that they read it before.
 *
 * So one line beside the button, in both doors (`ConsentLines`), true whether
 * or not publisher verification (T5) is done: a work or school account may
 * need its organisation's administrator to approve Ownpace first, and a
 * personal Microsoft account does not.
 *
 * What is pinned, in English and in Dutch: the line sits beside *Connect with
 * Microsoft* in the consent panel with the deployment's app, and in the
 * wizard; the button points at it (`aria-describedby`), because it comes after
 * the button in the page and T6's point is that it is heard BEFORE the button
 * is pressed (the review of 2026-09-26, after 0148's precedent); it names the
 * administrator, the work or school account and the personal one; and
 * Google's and Dropbox's buttons carry none.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { credentialFieldsFor } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { clients } = vi.hoisted(() => ({ clients: vi.fn() }));

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

import CreateMapping from '../pages/CreateMapping.tsx';
import { ProviderConsentPanel, useProviderConsent } from './ProviderConsent.tsx';

type Locale = 'en' | 'nl';
const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

/** A key read without the compiler's help, so a missing string fails here, not in tsc. */
const words = (locale: Locale, key: string): string => {
  const s = (STRINGS[locale] as Record<string, string>)[key];
  expect(s, `${locale} has no '${key}'`).toBeTruthy();
  return s as string;
};

/** What the line has to say, in §3's words: who may be asked, for which account, and which not. */
const SAYS: Readonly<Record<Locale, ReadonlyArray<RegExp>>> = {
  en: [/work or school account/, /organisation['’]s administrator/, /approve Ownpace first/, /personal Microsoft account does not/],
  nl: [/werk- of schoolaccount/, /beheerder van uw organisatie/, /persoonlijk Microsoft-account niet/],
};

/** What a screen reader hears for the button beyond its name: the text of every element it points at. */
const describedBy = (button: HTMLElement): string =>
  (button.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

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

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
  // The deployment's own Microsoft app: the registration a tester consents to.
  clients.mockResolvedValue({ google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' });
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('the sentence a tester reads before Connect with Microsoft (0140 T6 (b))', () => {
  for (const locale of LOCALES) {
    const lineBeside = (button: HTMLElement): HTMLElement => {
      const line = screen.getByText(words(locale, 'wizard.microsoft.orgApproval'));
      expect(button.parentElement, 'the line is not beside the button').toContainElement(line);
      expect(
        describedBy(button),
        'the line comes after the button, so the button must point at it or a screen reader presses first',
      ).toContain(words(locale, 'wizard.microsoft.orgApproval'));
      return line;
    };

    it(`${locale}: the consent panel, with the deployment's app, says what an organisation may ask`, async () => {
      wrap(locale, <Panel type="microsoft" />, '/connections', '/connections');
      const button = await screen.findByRole('button', { name: words(locale, 'wizard.microsoft.connect') });
      const line = lineBeside(button);
      for (const says of SAYS[locale]) expect(line.textContent).toMatch(says);
    });

    it(`${locale}: the wizard's Microsoft 365 account says the same beside its button`, async () => {
      wrap(locale, <CreateMapping />, '/mappings/new', '/mappings/new');
      fireEvent.click(screen.getByRole('button', { name: /^Microsoft 365 account/ }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: words(locale, 'wizard.microsoft.connect') })).toBeTruthy(),
      );
      lineBeside(screen.getByRole('button', { name: words(locale, 'wizard.microsoft.connect') }));
    });

    for (const provider of ['google', 'dropbox'] as const) {
      it(`${locale}: ${provider}'s button carries no Microsoft line`, async () => {
        wrap(locale, <Panel type={provider} />, '/connections', '/connections');
        expect(
          await screen.findByRole('button', { name: words(locale, `wizard.${provider}.connect`) }),
        ).toBeTruthy();
        expect(screen.queryByText(words(locale, 'wizard.microsoft.orgApproval'))).toBeNull();
      });
    }
  }
});
