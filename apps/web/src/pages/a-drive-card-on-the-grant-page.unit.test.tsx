// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * CIRRUX DRIVE ON THE PERSON'S GRANT PAGE (workplan 0174 §4.4, §4.5).
 *
 * T5 built the server half: a destination's Cirrux Drive card on a person's
 * link, offered once the account's app password is stored, and its door,
 * `POST /api/grant/:link/cirrux/authorize` with `{ ref, locale }`. T4 built
 * the page and left this card to T5, which left it to T4; the page drew it
 * as a sign-in source and threw (`no words for cirrux`). Pinned here:
 *
 * - the card, in English and Dutch, beside the password card it follows;
 * - its button calls the door with the card's `ref` and the page's language,
 *   and follows the answer only to Cirrux's own host (`CONSENT_HOSTS.cirrux`);
 * - an answer at another host is not followed, and says so;
 * - a refusal says the server's sentence (T5's, such as the one for a card
 *   whose app password is not stored), in the page's language.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { CONSENT_HOSTS } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, authorizeMock, driveMock, assignMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  driveMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock('../services/grant-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-service.ts')>()),
  grantApi: { read: readMock, authorize: authorizeMock, authorizeDrive: driveMock, putPassword: vi.fn() },
}));
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: vi.fn().mockResolvedValue(false), send: vi.fn() },
}));

import Grant from './Grant.tsx';

const ACCOUNT = 'anna@cirrux.example';
const migration = {
  domains: ['email', 'file'],
  to: { provider: 'cirrux', host: null, account: ACCOUNT },
  from: { provider: 'imap', account: 'anna@old.example' },
  granted: false,
};
const PASSWORD_CARD = {
  ref: 'ref-password',
  role: 'target',
  way: 'password',
  provider: 'cirrux',
  account: ACCOUNT,
  server: { hosts: ['imap.cirrux.co', 'dav.cirrux.co'], published: true },
  fields: [{ key: 'password', labelKey: 'account.appPassword', who: 'person', secret: true }],
  tries: { left: 5, locked: false },
  granted: true,
  again: false,
  domains: ['email', 'file'],
  scope: null,
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [{ ...migration, granted: true }],
};
const DRIVE_CARD = {
  ref: 'ref-drive',
  role: 'target',
  way: 'sign-in',
  provider: 'cirrux',
  account: ACCOUNT,
  granted: false,
  again: false,
  domains: ['file'],
  scope: null,
  readOnlyAtProvider: false,
  notReady: null,
  migrations: [migration],
};
const SUBJECT = {
  kind: 'person',
  organisation: 'Acme Families',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: '+31 20 000 0000',
  accounts: [PASSWORD_CARD, DRIVE_CARD],
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  addressChanges: [],
};

function refused(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
}

function renderPage(locale: 'en' | 'nl' = 'en') {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/grant/p.abc.def']}>
          <Routes>
            <Route path="/grant/:link" element={<Grant />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  readMock.mockResolvedValue(SUBJECT);
  vi.stubGlobal('location', { assign: assignMock });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.localStorage.removeItem('ownpace.locale');
});

const driveCard = async () => {
  await screen.findAllByRole('heading', { level: 3, name: ACCOUNT });
  const el = document.querySelector('[data-drive-card="cirrux"]');
  expect(el, 'the Drive card is drawn').not.toBeNull();
  return el as HTMLElement;
};

describe('the Cirrux Drive card (0174 §4.4)', () => {
  it('stands beside the connected password card, in the destinations, and says what it is', async () => {
    renderPage();
    const el = await driveCard();
    expect(el.closest('[data-group]')?.getAttribute('data-group')).toBe('target');
    expect(el.closest('section')?.getAttribute('data-card-state')).toBe('waiting');
    expect(el).toHaveTextContent('Your files go to Cirrux Drive, which takes your own Cirrux sign-in rather than the app password.');
    expect(el).toHaveTextContent(`Sign in to Cirrux with the account ${ACCOUNT} belongs to.`);
    expect(screen.getByRole('button', { name: 'Connect Cirrux Drive' })).toBeEnabled();
  });

  it('says it in Dutch, with verbinden', async () => {
    renderPage('nl');
    const el = await driveCard();
    expect(el).toHaveTextContent('Uw bestanden gaan naar Cirrux Drive');
    expect(screen.getByRole('button', { name: 'Cirrux Drive verbinden' })).toBeInTheDocument();
  });

  it('calls the Drive door with the card’s ref and the page’s language, and follows Cirrux’s own page', async () => {
    const url = `https://${CONSENT_HOSTS.cirrux}/oauth/authorize?state=s&code_challenge=c`;
    driveMock.mockResolvedValue({ url });
    renderPage('nl');
    await driveCard();
    await userEvent.click(screen.getByRole('button', { name: 'Cirrux Drive verbinden' }));
    await waitFor(() => expect(driveMock).toHaveBeenCalledWith('p.abc.def', 'ref-drive', 'nl'));
    expect(authorizeMock).not.toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith(url);
  });

  it('follows no address at another host, and says so', async () => {
    driveMock.mockResolvedValue({ url: `https://${CONSENT_HOSTS.cirrux}.example.invalid/oauth/authorize?x=1` });
    renderPage();
    await driveCard();
    await userEvent.click(screen.getByRole('button', { name: 'Connect Cirrux Drive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cirrux/);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it.each(['en', 'nl'] as const)('%s: says the server’s refusal, in the page’s language', async (locale) => {
    driveMock.mockRejectedValue(
      refused(409, {
        error: 'not_ready',
        reason: 'This Cirrux account has no app password yet.',
        reasonNl: 'Dit Cirrux-account heeft nog geen app-wachtwoord.',
      }),
    );
    renderPage(locale);
    await driveCard();
    await userEvent.click(screen.getByRole('button', { name: locale === 'nl' ? 'Cirrux Drive verbinden' : 'Connect Cirrux Drive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      locale === 'nl' ? 'Dit Cirrux-account heeft nog geen app-wachtwoord.' : 'This Cirrux account has no app password yet.',
    );
    expect(assignMock).not.toHaveBeenCalled();
  });
});
