// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The migrator's page (workplan 0108 T4).
 *
 * What is asserted is what a person consenting is entitled to see BEFORE they
 * press anything: who is asking, what will be read, that it is read-only, the
 * scope in Google's own words, when the link stops working, and where the
 * privacy policy is. Those are not decoration — they are the in-product
 * disclosure ADR-0041 and Google's own verification require, and a page that
 * quietly dropped one would still look finished.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';
import { LocaleProvider } from '../i18n/index.tsx';

const { readMock, authorizeMock, serverMessageMock, assignMock, reportAvailableMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  serverMessageMock: vi.fn(() => 'a server sentence'),
  assignMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
}));

vi.mock('../services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: authorizeMock },
}));
// Whether *Report this link* can reach anybody; no helpdesk unless a case says so.
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: serverMessageMock }));

import Grant from './Grant.tsx';

const SCOPE = 'https://mail.google.com/';
const SUBJECT = {
  organisation: 'Acme Legal',
  checkedCompany: 'ACME LEGAL B.V.',
  askedBy: 'owner@example.org',
  organisationPhone: '+31 20 123 4567',
  domains: ['email'],
  scope: SCOPE,
  // Gmail's scope also sends and deletes, so Google does not hold it to
  // reading (workplan 0144 T3 (c)), and the server says so.
  readOnlyAtProvider: false,
  from: 'someone@example.invalid',
  to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

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
  serverMessageMock.mockReturnValue('a server sentence');
  readMock.mockResolvedValue(SUBJECT);
  vi.stubGlobal('location', { assign: assignMock });
});

/**
 * A refusal as the link client delivers one: the server's sentence in the
 * body, which is what the page reads (`link-refusal.ts`), not the error's own
 * message.
 */
function refused(status: number, data: unknown): AxiosError {
  const err = new AxiosError(`Request failed with status code ${status}`);
  err.response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data };
  return err;
}

describe('what a person sees before consenting', () => {
  it('names who is asking — consenting to an anonymous request is not consenting', async () => {
    renderPage();
    expect(await screen.findByText(/Acme Legal is moving your account/)).toBeInTheDocument();
  });

  it('says what will be read, and that nothing is deleted or changed', async () => {
    renderPage();
    expect(await screen.findByText(/your email — messages, folders and labels/)).toBeInTheDocument();
    // Not "Read-only" above Gmail's scope, which Google describes as sending
    // and deleting too (0144 T3 (c)): what Ownpace does, and what Google says.
    expect(screen.getByText(/Ownpace only reads/)).toBeInTheDocument();
    expect(screen.getByText(/never deletes or changes anything in your account/)).toBeInTheDocument();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    expect(screen.getByText(/sees your password/)).toBeInTheDocument();
    expect(screen.getByText(/sign in to Google yourself/)).toBeInTheDocument();
  });

  it('shows the scope AS a scope, not only as a paraphrase (ADR-0041)', async () => {
    renderPage();
    // The exact string their own Google account will record, so they can check
    // it there afterwards.
    expect(await screen.findByText(SCOPE)).toBeInTheDocument();
  });

  it('states when the link stops working, before the button', async () => {
    renderPage();
    expect(await screen.findByText(/This link works until/)).toBeInTheDocument();
  });

  it('puts the privacy policy and terms beside the button, before any redirect', async () => {
    renderPage();
    const privacy = await screen.findByRole('link', { name: 'Privacy policy' });
    // The files the site build writes (site/copy.mjs `files`). Its nginx has no
    // `.html` fallback, so the extension-less `/privacy` these said was a 404.
    expect(privacy).toHaveAttribute('href', 'https://www.ownpace.eu/privacy.html');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      'https://www.ownpace.eu/terms.html',
    );
  });

  it('links a Dutch reader to the Dutch policy and terms, not the English ones', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    renderPage();
    const privacy = await screen.findByRole('link', { name: 'Privacybeleid' });
    expect(privacy).toHaveAttribute('href', 'https://www.ownpace.eu/nl/privacy.html');
    expect(screen.getByRole('link', { name: 'Voorwaarden' })).toHaveAttribute(
      'href',
      'https://www.ownpace.eu/nl/voorwaarden.html',
    );
  });

  it('says from which account and to which destination, before the button (0108 T8a)', async () => {
    renderPage();
    const from = await screen.findByText('someone@example.invalid');
    expect(screen.getByText('dest@example.org')).toBeInTheDocument();
    // The destination's kind by the name its card carries, and where it is.
    expect(screen.getByText('Nextcloud at cloud.example.org')).toBeInTheDocument();
    // With the question that makes the two facts worth reading.
    const check = screen.getByText(
      'Do you know who asked? Is the destination yours or your organisation’s? Only then continue.',
    );
    // Both before the button: a check read after the redirect is no check.
    const button = screen.getByRole('button', { name: /Continue with Google/ });
    for (const before of [from, check]) {
      expect(before.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('says who asked, by address, before the button (0108 T8a)', async () => {
    renderPage();
    expect(await screen.findByText('Asked by')).toBeInTheDocument();
    const asker = screen.getByText('owner@example.org');
    const button = screen.getByRole('button', { name: /Continue with Google/ });
    expect(asker.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the company as the EU VAT register does, and says where that name comes from', async () => {
    renderPage();
    expect(await screen.findByText('Company')).toBeInTheDocument();
    const company = screen.getByText('ACME LEGAL B.V.');
    expect(screen.getByText('Checked in the EU VAT register (VIES).')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Continue with Google/ });
    expect(company.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no company line when no checked name exists, rather than an unchecked one', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, checkedCompany: null });
    renderPage();
    expect(await screen.findByText('owner@example.org')).toBeInTheDocument();
    expect(screen.queryByText('Company')).not.toBeInTheDocument();
    expect(screen.queryByText(/EU VAT register/)).not.toBeInTheDocument();
  });

  it("gives the organisation's number to call, as a link a phone can dial", async () => {
    renderPage();
    expect(await screen.findByText('Phone')).toBeInTheDocument();
    const number = screen.getByRole('link', { name: '+31 20 123 4567' });
    expect(number).toHaveAttribute('href', 'tel:+31201234567');
  });

  it('leaves the number out when the organisation gave none — it is optional', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, organisationPhone: null });
    renderPage();
    expect(await screen.findByText('owner@example.org')).toBeInTheDocument();
    expect(screen.queryByText('Phone')).not.toBeInTheDocument();
  });

  it('leaves out who asked when the server cannot say, rather than a blank', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, askedBy: null });
    renderPage();
    expect(await screen.findByText('someone@example.invalid')).toBeInTheDocument();
    expect(screen.queryByText('Asked by')).not.toBeInTheDocument();
  });

  it('says which account to sign in with, and that any other is refused, before the button (0108 T8 (b))', async () => {
    // The account is a condition, not a label: the server stores nothing for
    // any other, so the person is told before they go to Google, with why
    // Google will also ask to share their address.
    renderPage();
    const line = await screen.findByText(
      'Sign in as someone@example.invalid. Google shares your address to confirm it; other accounts are refused.',
    );
    const button = screen.getByRole('button', { name: /Continue with Google/ });
    expect(line.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names a destination with no host by its kind alone', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, to: { provider: 'jmap', host: null, account: null } });
    renderPage();
    expect(await screen.findByText('JMAP')).toBeInTheDocument();
    expect(screen.queryByText(/^JMAP at/)).not.toBeInTheDocument();
  });

  it('names a kind no card carries as it is stored, rather than nothing', async () => {
    readMock.mockResolvedValue({
      ...SUBJECT,
      to: { provider: 'selfhosted_mail', host: 'mail.example.org', account: null },
    });
    renderPage();
    expect(await screen.findByText('selfhosted_mail at mail.example.org')).toBeInTheDocument();
  });

  it('tells them how to take the access back afterwards', async () => {
    renderPage();
    expect(await screen.findByText(/withdraw this access at any time/)).toBeInTheDocument();
  });
});

describe('pressing the button', () => {
  it('follows the URL the server built, rather than one the page composed', async () => {
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    // With the page's language, so the ending after Google is in it (0145 T6).
    await waitFor(() => expect(authorizeMock).toHaveBeenCalledWith('abc.def', 'en'));
    expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it("shows a refusal in the server's words rather than a dead button", async () => {
    authorizeMock.mockRejectedValue(
      refused(409, {
        error: 'not_ready',
        reason: 'This migration is not ready to be connected — please tell the person who sent you the link.',
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByText(/^This migration is not ready to be connected/)).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
    // And the button comes back, rather than staying stuck on "Opening…".
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
  });
});

describe('when the link is refused', () => {
  it("shows the server's sentence and offers no button to press", async () => {
    readMock.mockRejectedValue(
      refused(401, { error: 'link_unusable', message: 'This link cannot be used. Ask them for a fresh link.' }),
    );
    renderPage();
    expect(await screen.findByText(/Ask them for a fresh link/)).toBeInTheDocument();
    // Only the language switch (0145 T6): nothing that starts a consent.
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['EN', 'NL']);
  });
});

/**
 * A PERSON'S link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)): one
 * card per Google account, each asked once, with its own button, and a card
 * that is connected already has none.
 */
describe("a person's link", () => {
  const PERSON = {
    kind: 'person',
    organisation: 'Acme Legal',
    checkedCompany: null,
    askedBy: 'owner@example.org',
    organisationPhone: null,
    accounts: [
      {
        account: 'anna@gmail.com',
        granted: true,
        domains: ['calendar', 'contact'],
        scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/carddav',
        readOnlyAtProvider: false,
        notReady: null,
        migrations: [
          { domains: ['calendar'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: true },
          { domains: ['contact'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: true },
        ],
      },
      {
        account: 'anna@work.example',
        granted: false,
        domains: ['email'],
        scope: 'https://mail.google.com/ openid',
        readOnlyAtProvider: false,
        notReady: null,
        migrations: [
          { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.net' }, granted: false },
        ],
      },
      {
        account: 'anna@old.example',
        granted: false,
        domains: [],
        scope: null,
        readOnlyAtProvider: false,
        notReady: { reason: 'Two applications, one sign-in.', reasonNl: 'Twee applicaties, één aanmelding.' },
        migrations: [
          { domains: ['file'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna' }, granted: false },
        ],
      },
    ],
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };

  beforeEach(() => {
    readMock.mockResolvedValue(PERSON);
  });

  it('offers Report this link, for the person’s own link (0108 T8 (d))', async () => {
    reportAvailableMock.mockResolvedValue(true);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Report this link' })).toBeInTheDocument();
    expect(reportAvailableMock).toHaveBeenCalledWith('grant', 'abc.def');
  });

  it('draws a card per account, saying where each of its migrations goes and what it copies', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'anna@gmail.com' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'anna@work.example' })).toBeInTheDocument();
    expect(screen.getByText('To anna, Nextcloud at cloud.example.org: your calendars and their events.')).toBeInTheDocument();
    expect(screen.getByText('To anna@soverin.net, Soverin: your contacts.')).toBeInTheDocument();
    expect(screen.getByText(/is moving your accounts to a new provider/)).toBeInTheDocument();
  });

  it('offers no button for a connected account, and says why an account cannot be asked', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'anna@gmail.com' });
    expect(screen.getByText('Connected. Nothing more is needed for this account.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as anna@gmail\.com/ })).not.toBeInTheDocument();
    expect(screen.getByText('Two applications, one sign-in.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as anna@old\.example/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Continue with Google as/ })).toHaveLength(1);
  });

  it('asks for the account whose button was pressed, and follows the URL the server built', async () => {
    authorizeMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?y=2' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Google as anna@work.example' }));
    await waitFor(() => expect(authorizeMock).toHaveBeenCalledWith('abc.def', 'en', 'anna@work.example'));
    expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?y=2');
  });

  it('is in Dutch for a Dutch reader, the refusal too', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    renderPage();
    expect(await screen.findByRole('button', { name: 'Doorgaan met Google als anna@work.example' })).toBeInTheDocument();
    expect(screen.getByText('Twee applicaties, één aanmelding.')).toBeInTheDocument();
    expect(screen.getByText('Verbonden. Voor dit account is niets meer nodig.')).toBeInTheDocument();
  });
});
