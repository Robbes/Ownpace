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

const { readMock, authorizeMock, serverMessageMock, assignMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  authorizeMock: vi.fn(),
  serverMessageMock: vi.fn(() => 'a server sentence'),
  assignMock: vi.fn(),
}));

vi.mock('../services/grant-service.ts', () => ({
  grantApi: { read: readMock, authorize: authorizeMock },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: serverMessageMock }));

import Grant from './Grant.tsx';

const SCOPE = 'https://mail.google.com/';
const SUBJECT = {
  organisation: 'Acme Legal',
  askedBy: 'owner@example.org',
  organisationPhone: '+31 20 123 4567',
  reads: 'your email — messages, folders and labels',
  scope: SCOPE,
  from: 'someone@example.invalid',
  to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/grant/abc.def']}>
        <Routes>
          <Route path="/grant/:link" element={<Grant />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMessageMock.mockReturnValue('a server sentence');
  readMock.mockResolvedValue(SUBJECT);
  vi.stubGlobal('location', { assign: assignMock });
});

describe('what a person sees before consenting', () => {
  it('names who is asking — consenting to an anonymous request is not consenting', async () => {
    renderPage();
    expect(await screen.findByText(/Acme Legal is moving your account/)).toBeInTheDocument();
  });

  it('says what will be read, and that nothing is deleted or changed', async () => {
    renderPage();
    expect(await screen.findByText(/your email — messages, folders and labels/)).toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
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
    expect(privacy).toHaveAttribute('href', expect.stringContaining('privacy'));
    expect(screen.getByRole('link', { name: 'Terms' })).toBeInTheDocument();
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

  it('says it reads the account they sign in with, where the migration names none', async () => {
    readMock.mockResolvedValue({ ...SUBJECT, from: null });
    renderPage();
    expect(await screen.findByText('The Google account you sign in with')).toBeInTheDocument();
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
    await waitFor(() => expect(authorizeMock).toHaveBeenCalledWith('abc.def'));
    expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it("shows a refusal in the server's words rather than a dead button", async () => {
    serverMessageMock.mockReturnValue(
      'This migration is not ready to be connected — please tell the person who sent you the link.',
    );
    authorizeMock.mockRejectedValue(new Error('409'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Continue with Google/ }));
    expect(await screen.findByText(/tell the person who sent you the link/)).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
    // And the button comes back, rather than staying stuck on "Opening…".
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
  });
});

describe('when the link is refused', () => {
  it("shows the server's sentence and offers no button to press", async () => {
    serverMessageMock.mockReturnValue('This link cannot be used. Ask them for a fresh link.');
    readMock.mockRejectedValue(new Error('401'));
    renderPage();
    expect(await screen.findByText(/Ask them for a fresh link/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
