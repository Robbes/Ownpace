// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * YOUR NEW ADDRESS ON THE LINK PAGES (workplan 0168 §4.4, D6).
 *
 * The grant page and the progress page, each opened by a person's link,
 * through their real services: the payload is parsed as the server sends it
 * (`addressChanges`, `LinkAddressChange` in `apps/api/docs/openapi.yaml`), the
 * line is shown with the button its row's state offers, and a press goes to
 * the page's own door, naming the row by its ref, with `{ state, newAddress }`:
 * the answer and the address the line showed. No old address is in the
 * payload, and none is shown. In English and in Dutch. Only the HTTP client
 * is stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

const { getMock, putMock, postMock, reportAvailableMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  putMock: vi.fn(),
  postMock: vi.fn(),
  reportAvailableMock: vi.fn(async () => false),
}));

vi.mock('../services/link-client.ts', () => ({ linkClient: { get: getMock, put: putMock, post: postMock } }));
// Whether *Report this link* can reach anybody: not here.
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));

import Grant from './Grant.tsx';
import View from './View.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

const TOKEN = 'p.kid-link.a-secret-of-sixteen';
const IN_A_WEEK = new Date(Date.now() + 7 * 86_400_000).toISOString();

const KID_ROW = { ref: 'c'.repeat(32), newAddress: 'kid@example.org', state: 'proposed' as const };

/** A person's grant page, as `GET /api/grant/{link}` answers it. */
const grantPage = (addressChanges: unknown) => ({
  kind: 'person',
  organisation: 'Example family',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: null,
  accounts: [
    {
      account: 'kid.name@gmail.com',
      granted: false,
      again: false,
      domains: ['calendar'],
      scope: 'https://www.googleapis.com/auth/calendar',
      readOnlyAtProvider: false,
      notReady: null,
      migrations: [{ domains: ['calendar'], to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'kid' }, granted: false }],
    },
  ],
  expiresAt: IN_A_WEEK,
  ...(addressChanges === undefined ? {} : { addressChanges }),
});

/** A person's progress page, as `GET /api/view/{link}` answers it. */
const viewPage = (addressChanges: unknown) => ({
  kind: 'person',
  organisation: 'Example family',
  expiresAt: IN_A_WEEK,
  migrations: [
    {
      from: 'google',
      to: 'nextcloud',
      state: 'paused',
      started: false,
      domains: [],
      account: 'a'.repeat(32),
    },
  ],
  accounts: [{ ref: 'a'.repeat(32), grant: { state: 'none' } }],
  ...(addressChanges === undefined ? {} : { addressChanges }),
});

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/grant/:link" element={<Grant />} />
            <Route path="/view/:link" element={<View />} />
          </Routes>
        </MemoryRouter>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const DOOR = (door: 'grant' | 'view') => `/${door}/${encodeURIComponent(TOKEN)}/address-changes/${'c'.repeat(32)}`;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('ownpace.locale', 'en');
  reportAvailableMock.mockResolvedValue(false);
  // The server's answer to a press: the row in the state it was sent.
  putMock.mockImplementation(async (_url: string, body: { state: 'proposed' | 'confirmed'; newAddress: string }) => ({
    data: { ...KID_ROW, newAddress: body.newAddress, state: body.state },
  }));
});

afterEach(() => {
  window.localStorage.removeItem('ownpace.locale');
});

describe('the grant page', () => {
  it('shows the line and Yes for a proposed row, and both answers go to the grant door with the address the line showed', async () => {
    getMock.mockResolvedValue({ data: grantPage([KID_ROW]) });
    const user = userEvent.setup();
    renderAt(`/grant/${TOKEN}`);

    expect(await screen.findByText('Your new address: kid@example.org. Is that right?')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(`/grant/${encodeURIComponent(TOKEN)}`);
    expect(screen.queryByRole('button', { name: 'Not right?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yes, that is right' }));
    expect(putMock).toHaveBeenCalledWith(DOOR('grant'), { state: 'confirmed', newAddress: 'kid@example.org' });
    expect(await screen.findByText('Confirmed: kid@example.org.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Not right?' }));
    expect(putMock).toHaveBeenLastCalledWith(DOOR('grant'), { state: 'proposed', newAddress: 'kid@example.org' });
    expect(
      await screen.findByText(
        'Sent back. It changes nothing until it is confirmed again, and whoever set it up sees it waiting on their pages.',
      ),
    ).toBeInTheDocument();
  });

  it('says it in Dutch for a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    getMock.mockResolvedValue({ data: grantPage([KID_ROW]) });
    const user = userEvent.setup();
    renderAt(`/grant/${TOKEN}`);

    expect(await screen.findByText('Uw nieuwe adres: kid@example.org. Klopt dat?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ja, dat klopt' }));
    expect(putMock).toHaveBeenCalledWith(DOOR('grant'), { state: 'confirmed', newAddress: 'kid@example.org' });
    expect(await screen.findByText('Bevestigd: kid@example.org.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Klopt het niet?' })).toBeInTheDocument();
  });

  it('says nothing about an address when the person has no row, or the server sends no field', async () => {
    for (const changes of [[], undefined]) {
      getMock.mockResolvedValue({ data: grantPage(changes) });
      const { unmount } = renderAt(`/grant/${TOKEN}`);
      expect(await screen.findByText('kid.name@gmail.com')).toBeInTheDocument();
      expect(screen.queryByText(/Your new address/)).toBeNull();
      unmount();
    }
  });
});

describe('the progress page', () => {
  it('shows the line and Not right? for a confirmed row, through the progress door, and says what the page shows', async () => {
    getMock.mockResolvedValue({ data: viewPage([{ ...KID_ROW, state: 'confirmed' }]) });
    const user = userEvent.setup();
    renderAt(`/view/${TOKEN}`);

    expect(await screen.findByText('Your new address: kid@example.org. Is that right?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, that is right' })).toBeNull();
    // Not "only numbers" under an address.
    expect(
      screen.getByText('This page shows numbers, and the new address set up for you; it holds nothing from your account.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('This page only shows numbers; it holds nothing from your account.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Not right?' }));
    expect(putMock).toHaveBeenCalledWith(DOOR('view'), { state: 'proposed', newAddress: 'kid@example.org' });
    expect(await screen.findByText(/^Sent back\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, that is right' })).toBeInTheDocument();
  });

  it('says it in Dutch for a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    getMock.mockResolvedValue({ data: viewPage([{ ...KID_ROW, state: 'confirmed' }]) });
    const user = userEvent.setup();
    renderAt(`/view/${TOKEN}`);

    expect(await screen.findByText('Uw nieuwe adres: kid@example.org. Klopt dat?')).toBeInTheDocument();
    expect(
      screen.getByText('Deze pagina toont aantallen, en het nieuwe adres dat voor u is ingesteld; er staat niets uit uw account op.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Klopt het niet?' }));
    expect(putMock).toHaveBeenCalledWith(DOOR('view'), { state: 'proposed', newAddress: 'kid@example.org' });
    expect(await screen.findByText(/^Teruggestuurd\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ja, dat klopt' })).toBeInTheDocument();
  });

  it('keeps its numbers-only line, and no address, when the person has no row', async () => {
    getMock.mockResolvedValue({ data: viewPage([]) });
    renderAt(`/view/${TOKEN}`);
    expect(await screen.findByText('This page only shows numbers; it holds nothing from your account.')).toBeInTheDocument();
    expect(screen.queryByText(/Your new address/)).toBeNull();
  });
});
