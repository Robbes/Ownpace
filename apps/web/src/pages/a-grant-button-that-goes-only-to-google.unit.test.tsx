// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A GRANT BUTTON THAT GOES ONLY TO GOOGLE (workplan 0163 T4).
 *
 * The grant page's two buttons, *Continue with Google* on a migration's link
 * and one per account on a person's link, ask the API for Google's consent
 * address and send the whole page there (`globalThis.location.assign`). Until
 * 2026-11-21 they followed whatever came back. #1990 found the two lines and
 * left them, with the check ready: `consentToFollow('google', …)`, the one
 * *Pay* and the consent window use (`services/address-to-follow.ts`).
 *
 * Held here, on both buttons: Google's own page is followed, as parsed, and
 * nothing else is. Each refused address is one that check refuses for its own
 * reason, so the check taken out of either button fails these cases:
 *
 * - **`http:`** on Google's host, refused by the scheme alone;
 * - **another host**, `https:`;
 * - **a lookalike**: Google's name inside another host, credentials in front
 *   of another host, another port;
 * - **`javascript:`**, also one naming Google's host;
 * - **no address at all**, and a path of our own.
 *
 * A refusal opens nothing, says in the page's language that the address is
 * not Google's own page, and gives the button back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { readMock, authorizeMock, assignMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock('../services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: authorizeMock },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn(async () => false), send: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: vi.fn(() => 'a server sentence') }));

import Grant from './Grant.tsx';

const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';

const MAPPING = {
  organisation: 'Acme Legal',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: null,
  domains: ['email'],
  scope: 'https://mail.google.com/',
  readOnlyAtProvider: false,
  from: 'someone@example.invalid',
  to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const PERSON = {
  kind: 'person',
  organisation: 'Acme Legal',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: null,
  accounts: [
    {
      account: 'anna@work.example',
      granted: false,
      domains: ['email'],
      scope: 'https://mail.google.com/ openid',
      readOnlyAtProvider: false,
      notReady: null,
      migrations: [{ domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false }],
    },
  ],
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

/** Each address the check refuses, by the reason it refuses it. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['http:, on Google’s own host', 'http://accounts.google.com/o/oauth2/v2/auth?state=y'],
  ['another host', 'https://evil.example/o/oauth2/v2/auth?state=y'],
  ['Google’s name inside another host', 'https://accounts.google.com.evil.example/o/oauth2/v2/auth'],
  ['credentials in front of another host', 'https://accounts.google.com@evil.example/o/oauth2/v2/auth'],
  ['another port', 'https://accounts.google.com:8443/o/oauth2/v2/auth'],
  ['javascript:', 'javascript:alert(document.domain)'],
  ['javascript: naming Google’s host', 'javascript://accounts.google.com/%0aalert(document.domain)'],
  ['no address', ''],
  ['a path of our own', '/grant/abc.def/done'],
];

const sentence = (locale: 'en' | 'nl') =>
  STRINGS[locale]['account.consent.notTheProvider'].replace('{provider}', 'Google');

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={['/grant/abc.def']}>
          <Routes>
            <Route path="/grant/:link" element={<Grant />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('ownpace.locale', 'en');
  vi.stubGlobal('location', { assign: assignMock });
});

describe('a migration’s link: Continue with Google goes to Google’s own page only', () => {
  beforeEach(() => {
    readMock.mockResolvedValue(MAPPING);
  });

  it('follows Google’s consent page, as parsed', async () => {
    authorizeMock.mockResolvedValue({ url: GOOGLE });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(new URL(GOOGLE).href));
    expect(screen.queryByText(sentence('en'))).not.toBeInTheDocument();
  });

  it.each(REFUSED)('opens nothing for %s, says so, and gives the button back', async (_why, url) => {
    authorizeMock.mockResolvedValue({ url });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence('en'));
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeEnabled();
  });

  it('says it in Dutch for a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    authorizeMock.mockResolvedValue({ url: 'https://evil.example/' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Doorgaan met Google/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence('nl'));
    expect(assignMock).not.toHaveBeenCalled();
  });
});

describe('a person’s link: each account’s button goes to Google’s own page only', () => {
  beforeEach(() => {
    readMock.mockResolvedValue(PERSON);
  });

  it('follows Google’s consent page for the account pressed, as parsed', async () => {
    authorizeMock.mockResolvedValue({ url: GOOGLE });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google as anna@work.example' }));
    await waitFor(() => expect(authorizeMock).toHaveBeenCalledWith('abc.def', 'en', 'google', 'anna@work.example'));
    expect(assignMock).toHaveBeenCalledWith(new URL(GOOGLE).href);
  });

  it.each(REFUSED)('opens nothing for %s, says so at the account, and gives the button back', async (_why, url) => {
    authorizeMock.mockResolvedValue({ url });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google as anna@work.example' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence('en'));
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue with Google as anna@work.example' })).toBeEnabled();
  });

  it('says it in Dutch for a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com.evil.example/' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Doorgaan met Google als anna@work.example' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence('nl'));
    expect(assignMock).not.toHaveBeenCalled();
  });
});
