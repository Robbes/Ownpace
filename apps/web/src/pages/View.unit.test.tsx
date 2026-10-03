// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The progress page (workplan 0122 T4).
 *
 * The reader has no account, no other screen and nobody to ask but the person
 * who sent them the link, so what is asserted here is what would mislead
 * somebody in that position:
 *
 *  - **zero and nothing-yet are different sentences**, and the page must not
 *    reach for the first when the truth is the second;
 *  - **a completion and a last-touched time are different claims**, and the
 *    weaker one has to be worded as the weaker one;
 *  - **a failure is explained in words this reader can use**, never in the
 *    owner's remedies and never in the provider's prose;
 *  - **a refused link answers with the server's own sentence**, which is the
 *    one written to be forwarded.
 *
 * Assertions are on the English strings, relying on `useLocale`'s documented
 * un-provided fallback, the same way `Grant.unit.test.tsx` does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AxiosError, AxiosHeaders } from 'axios';

const { readMock, withdrawMock, withdrawAccountMock, serverMessageMock, reportAvailableMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  withdrawMock: vi.fn(),
  withdrawAccountMock: vi.fn(),
  serverMessageMock: vi.fn(() => 'a server sentence'),
  reportAvailableMock: vi.fn(async () => false),
}));

// Whether *Report this link* can reach anybody; no helpdesk unless a case says so.
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: reportAvailableMock, send: vi.fn() },
}));

vi.mock('../services/view-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/view-service.ts')>();
  return {
    ...actual,
    viewApi: { read: readMock, withdraw: withdrawMock, withdrawAccount: withdrawAccountMock },
  };
});
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: serverMessageMock }));

import View from './View.tsx';

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();
const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  domain: 'email' as const,
  state: 'in_progress' as const,
  itemsSynced: 4211,
  itemsFailed: 0,
  bytesTransferred: 91_000_000,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  organisation: 'Example family',
  state: 'active' as const,
  started: true,
  domains: [row()],
  expiresAt: IN_A_MONTH,
  grant: { state: 'none' as const },
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/view/abc.def']}>
        <Routes>
          <Route path="/view/:link" element={<View />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serverMessageMock.mockReturnValue('a server sentence');
  readMock.mockResolvedValue(payload());
});

describe('what the page says', () => {
  it('names who is doing this, in a sentence rather than a chip', async () => {
    renderPage();
    expect(await screen.findByText(/Example family is moving your account/)).toBeInTheDocument();
    // `active` reads as "Active" everywhere else in the product. Here it is a
    // whole sentence, because the reader is not scanning twenty migrations —
    // they are reading about their own.
    expect(screen.getByText('Your things are being copied across now.')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('counts what has been copied, and says how much has moved', async () => {
    renderPage();
    expect(await screen.findByText('4211 copied')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText(/86.8 MB moved so far/)).toBeInTheDocument();
  });

  it('says nothing has been copied rather than showing zeroes', async () => {
    // The hour after somebody grants: no status rows exist. Five domains
    // reading `0` would say FINISHED, and moved nothing.
    readMock.mockResolvedValue(payload({ started: false, domains: [] }));
    renderPage();
    expect(await screen.findByText('Nothing has been copied yet.')).toBeInTheDocument();
    expect(screen.queryByText(/copied$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/moved so far/)).not.toBeInTheDocument();
  });

  it('separates "up to date as of" from "last worked on"', async () => {
    // A COMPLETION is the only honest source for the strong claim. A domain
    // that has never completed gets the weaker sentence, worded as weaker.
    readMock.mockResolvedValue(payload({ domains: [row({ lastActiveAt: YESTERDAY })] }));
    renderPage();
    expect(await screen.findByText(/Still copying; last worked on/)).toBeInTheDocument();
    expect(screen.queryByText(/Up to date as of/)).not.toBeInTheDocument();
  });

  it('says not started yet when a domain has neither time', async () => {
    // Never `undefined` beside a label, and never a date we do not have.
    readMock.mockResolvedValue(payload({ domains: [row({ itemsSynced: 0 })] }));
    renderPage();
    expect(await screen.findByText('Not started yet.')).toBeInTheDocument();
  });

  it('states its own expiry, for somebody who bookmarked it', async () => {
    renderPage();
    expect(await screen.findByText(/This page works until/)).toBeInTheDocument();
  });
});

describe('when something is wrong', () => {
  it('counts what needs attention and points at the right person', async () => {
    readMock.mockResolvedValue(
      payload({ domains: [row({ itemsFailed: 3, itemsNeedingDecision: 3 })] }),
    );
    renderPage();
    expect(
      await screen.findByText('3 items need someone to look at them.'),
    ).toBeInTheDocument();
  });

  it('explains a failure in THIS reader’s words, not the owner’s remedy', async () => {
    readMock.mockResolvedValue(
      payload({
        domains: [row({ itemsNeedingDecision: 1, lastErrorCategory: 'auth_expired', failedSide: 'source' })],
      }),
    );
    renderPage();
    // The owner's sentence for this category sends somebody to the Connections
    // page. This reader has no account to reach one with, so they are told the
    // fact and who can act on it.
    expect(await screen.findByText(/needs renewing/)).toBeInTheDocument();
    expect(screen.queryByText(/Connections page/)).not.toBeInTheDocument();
    // Their old account, not "the source side".
    expect(screen.getByText(/your old account/)).toBeInTheDocument();
  });

  it('renders a pause as a reason, not as a failure', async () => {
    readMock.mockResolvedValue(
      payload({
        domains: [
          row({
            pausedReason: {
              kind: 'daily-download-ceiling',
              provider: 'imap.gmail.com',
              windowResetsAt: null,
            },
          }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/imap.gmail.com/)).toBeInTheDocument();
  });

  it('ignores a pause reason it does not recognise rather than rendering it raw', async () => {
    // A jsonb column accepts whatever the writer put there, and a row from an
    // older or newer build must not become a half-sentence on the one page
    // whose reader cannot check anything.
    readMock.mockResolvedValue(payload({ domains: [row({ pausedReason: { kind: 'hibernating' } })] }));
    renderPage();
    await screen.findByText('4211 copied');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it("shows a refused link in the SERVER's words — they are written to be forwarded", async () => {
    // The server's sentence in the body, which is what the page reads
    // (`link-refusal.ts`), not the error's own message.
    const refused = new AxiosError('Request failed with status code 401');
    refused.response = {
      status: 401,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'link_unusable', message: 'This link cannot be used. Ask them for a fresh link.' },
    };
    readMock.mockRejectedValue(refused);
    renderPage();
    expect(await screen.findByText(/Ask them for a fresh link/)).toBeInTheDocument();
    // And no counts of any kind: a refusal is not a migration with nothing in it.
    expect(screen.queryByText(/copied/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been copied yet/)).not.toBeInTheDocument();
  });
});

describe('the access they gave, and taking it back (0108 T8 (c))', () => {
  const WITHDRAWN_AT = '2026-09-24T06:00:00.000Z';

  it('offers to withdraw a grant, and asks once more before it does', async () => {
    readMock.mockResolvedValue(payload({ organisation: 'Example Care', grant: { state: 'granted' } }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw access' }));

    // Said before the second press: what stops, what stays, and that Google
    // takes it back for the whole app.
    expect(screen.getByText(/Example Care reads your Google account/)).toBeInTheDocument();
    expect(screen.getByText(/What was already copied stays/)).toBeInTheDocument();
    expect(screen.getByText(/any other migration you allowed stops too/)).toBeInTheDocument();
    expect(screen.getByText(/Continuing later needs a new link/)).toBeInTheDocument();
    expect(withdrawMock).not.toHaveBeenCalled();
  });

  it('keeps it when the person thinks better of it', async () => {
    readMock.mockResolvedValue(payload({ grant: { state: 'granted' } }));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.getByRole('button', { name: 'Withdraw access' })).toBeInTheDocument();
    expect(withdrawMock).not.toHaveBeenCalled();
  });

  it('says Google confirmed it, when Google did', async () => {
    readMock.mockResolvedValue(payload({ grant: { state: 'granted' } }));
    withdrawMock.mockResolvedValue({ withdrawnAt: WITHDRAWN_AT, atGoogle: 'revoked' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw it' }));

    expect(await screen.findByText(/Google confirmed the access is withdrawn/)).toBeInTheDocument();
    expect(withdrawMock).toHaveBeenCalledWith('abc.def');
    expect(screen.getByText(/Nothing more is read from your account/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /myaccount\.google\.com/ })).not.toBeInTheDocument();
  });

  it('says it was deleted here and where to finish it, when Google did not confirm', async () => {
    readMock.mockResolvedValue(payload({ grant: { state: 'granted' } }));
    withdrawMock.mockResolvedValue({ withdrawnAt: WITHDRAWN_AT, atGoogle: 'not_confirmed' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw it' }));

    expect(await screen.findByText(/Google did not confirm withdrawing it/)).toBeInTheDocument();
    expect(screen.getByText(/remove the app yourself/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'myaccount.google.com/connections' })).toHaveAttribute(
      'href',
      'https://myaccount.google.com/connections',
    );
  });

  it('shows the server’s own sentence when there was nothing to take back', async () => {
    readMock.mockResolvedValue(payload({ grant: { state: 'granted' } }));
    withdrawMock.mockRejectedValue(new Error('409'));
    serverMessageMock.mockReturnValue('You already withdrew your permission, on 2026-09-24.');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw it' }));

    expect(await screen.findByText('You already withdrew your permission, on 2026-09-24.')).toBeInTheDocument();
  });

  it('once withdrawn, says copying stopped and when, instead of that it is copying, and offers nothing more', async () => {
    readMock.mockResolvedValue(payload({ grant: { state: 'withdrawn', withdrawnAt: WITHDRAWN_AT } }));
    renderPage();

    expect(await screen.findByText(/Copying has stopped: on .* you withdrew the access you gave\./)).toBeInTheDocument();
    expect(screen.queryByText('Your things are being copied across now.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw access' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'myaccount.google.com/connections' })).toBeInTheDocument();
  });

  it('offers nothing where there is no grant to take back', async () => {
    renderPage();

    expect(await screen.findByText('Your things are being copied across now.')).toBeInTheDocument();
    expect(screen.queryByText('The access you gave')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw access' })).not.toBeInTheDocument();
  });
});

/**
 * A PERSON'S PAGE (ADR-0035, amended 2026-09-29; 0153 T5 (b), slice 3): every
 * migration of theirs under the Google account it reads, and the access they
 * gave taken back per account, never named by its address.
 */
describe('a person’s progress page', () => {
  const ACCOUNT = 'a'.repeat(32);
  const WORK = 'b'.repeat(32);
  const personPayload = (over: Record<string, unknown> = {}) => ({
    kind: 'person' as const,
    organisation: 'Example family',
    expiresAt: IN_A_MONTH,
    migrations: [
      {
        from: 'google',
        to: 'nextcloud',
        state: 'active' as const,
        started: true,
        domains: [row({ domain: 'calendar', itemsSynced: 12 })],
        account: ACCOUNT,
      },
      { from: 'google', to: 'soverin', state: 'paused' as const, started: false, domains: [], account: ACCOUNT },
      { from: 'imap', to: 'soverin', state: 'active' as const, started: true, domains: [row()], account: null },
    ],
    accounts: [{ ref: ACCOUNT, grant: { state: 'granted' as const } }],
    ...over,
  });

  it('draws each migration under the account it reads, and the others after', async () => {
    readMock.mockResolvedValue(personPayload());
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Your migrations' })).toBeInTheDocument();
    expect(screen.getByText(/Example family is moving your accounts to new providers/)).toBeInTheDocument();

    const account = screen.getByRole('region', { name: 'Your Google account' });
    expect(within(account).getByRole('heading', { name: 'Google to Nextcloud' })).toBeInTheDocument();
    expect(within(account).getByText('12 copied')).toBeInTheDocument();
    expect(within(account).getByText('Your things are being copied across now.')).toBeInTheDocument();
    expect(within(account).getByRole('heading', { name: 'Google to Soverin' })).toBeInTheDocument();
    expect(within(account).getByText('Nothing has been copied yet.')).toBeInTheDocument();
    expect(within(account).getByText(/reads this Google account for the migrations above/)).toBeInTheDocument();

    const others = screen.getByRole('region', { name: 'Your other migrations' });
    expect(within(others).getByText('4211 copied')).toBeInTheDocument();
    expect(within(others).queryByRole('button', { name: 'Withdraw access' })).not.toBeInTheDocument();
  });

  it('offers Report this link, for the person’s own progress link (0108 T8 (d))', async () => {
    readMock.mockResolvedValue(personPayload());
    reportAvailableMock.mockResolvedValue(true);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Report this link' })).toBeInTheDocument();
    expect(reportAvailableMock).toHaveBeenCalledWith('view', 'abc.def');
  });

  it('numbers the accounts when there are two, and names neither by its address', async () => {
    const payload = personPayload({
      accounts: [
        { ref: ACCOUNT, grant: { state: 'granted' } },
        { ref: WORK, grant: { state: 'none' } },
      ],
    });
    payload.migrations[1] = { ...payload.migrations[1]!, account: WORK };
    readMock.mockResolvedValue(payload);
    renderPage();
    expect(await screen.findByRole('region', { name: 'Google account 1' })).toBeInTheDocument();
    const work = screen.getByRole('region', { name: 'Google account 2' });
    expect(within(work).getByRole('heading', { name: 'Google to Soverin' })).toBeInTheDocument();
    expect(within(work).queryByRole('button', { name: 'Withdraw access' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Withdraw access' })).toHaveLength(1);
  });

  it('takes one account’s access back by its ref, and says what Google answered', async () => {
    readMock.mockResolvedValue(personPayload());
    withdrawAccountMock.mockResolvedValue({ withdrawnAt: YESTERDAY, atGoogle: 'not_confirmed' });
    renderPage();
    const account = await screen.findByRole('region', { name: 'Your Google account' });
    fireEvent.click(within(account).getByRole('button', { name: 'Withdraw access' }));
    fireEvent.click(within(account).getByRole('button', { name: 'Yes, withdraw it' }));
    expect(await within(account).findByText(/so these migrations cannot use it/)).toBeInTheDocument();
    expect(withdrawAccountMock).toHaveBeenCalledWith('abc.def', ACCOUNT);
    expect(withdrawMock).not.toHaveBeenCalled();
  });

  it('says on each of an account’s migrations that copying stopped, once its access is withdrawn', async () => {
    readMock.mockResolvedValue(
      personPayload({ accounts: [{ ref: ACCOUNT, grant: { state: 'withdrawn', withdrawnAt: YESTERDAY } }] }),
    );
    renderPage();
    const account = await screen.findByRole('region', { name: 'Your Google account' });
    expect(within(account).getAllByText(/Copying has stopped: on .* you withdrew the access you gave\./)).toHaveLength(2);
    expect(within(account).queryByRole('button', { name: 'Withdraw access' })).not.toBeInTheDocument();
  });

  it('shows a refused withdrawal in the page’s language, from the server’s two halves', async () => {
    readMock.mockResolvedValue(personPayload());
    const refused = new AxiosError('Request failed with status code 409');
    refused.response = {
      status: 409,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'changed', reason: 'It changed since this page was opened.', reasonNl: 'Het is gewijzigd.' },
    };
    withdrawAccountMock.mockRejectedValue(refused);
    renderPage();
    const account = await screen.findByRole('region', { name: 'Your Google account' });
    fireEvent.click(within(account).getByRole('button', { name: 'Withdraw access' }));
    fireEvent.click(within(account).getByRole('button', { name: 'Yes, withdraw it' }));
    expect(await within(account).findByText('It changed since this page was opened.')).toBeInTheDocument();
  });
});
