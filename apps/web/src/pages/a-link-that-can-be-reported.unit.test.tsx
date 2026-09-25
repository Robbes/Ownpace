// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * REPORT THIS LINK, on the two pages a link opens (workplan 0108 T8 (d); the
 * owner, 2026-09-24: a report goes to *"the problem report forms"*).
 *
 * What is asserted is what the person reads before anything is sent (where it
 * goes, and that it is not to the organisation that asked; what goes with it;
 * what the address is for), what is sent, and what they are told afterwards:
 * on the grant page that they need not continue, on the progress page that
 * withdrawing stops the copying, while there is access to withdraw. And that
 * neither page offers a report that can reach nobody.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LocaleProvider } from '../i18n/index.tsx';

const { grantReadMock, viewReadMock, availableMock, sendMock, serverMessageMock, getMock, postMock } = vi.hoisted(
  () => ({
    grantReadMock: vi.fn(),
    viewReadMock: vi.fn(),
    availableMock: vi.fn(),
    sendMock: vi.fn(),
    serverMessageMock: vi.fn(() => 'a server sentence'),
    getMock: vi.fn(),
    postMock: vi.fn(),
  }),
);

vi.mock('../services/grant-service.ts', () => ({ grantApi: { read: grantReadMock, authorize: vi.fn() } }));
vi.mock('../services/view-service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/view-service.ts')>();
  return { ...actual, viewApi: { read: viewReadMock, withdraw: vi.fn() } };
});
vi.mock('../services/link-report-service.ts', () => ({
  linkReportApi: { available: availableMock, send: sendMock },
}));
vi.mock('../services/api.ts', () => ({ default: {}, serverMessage: serverMessageMock }));
// Under the service itself, for the tests of what it asks and how it reads the answer.
vi.mock('../services/link-client.ts', () => ({ linkClient: { get: getMock, post: postMock } }));

import Grant from './Grant.tsx';
import View from './View.tsx';

const SUBJECT = {
  organisation: 'Acme Legal',
  checkedCompany: null,
  askedBy: 'owner@example.org',
  organisationPhone: null,
  reads: 'your email — messages, folders and labels',
  scope: 'https://mail.google.com/',
  from: 'someone@example.invalid',
  to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'dest@example.org' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const VIEW = (grant: { state: 'granted' } | { state: 'none' }) => ({
  organisation: 'Example family',
  state: 'active' as const,
  started: false,
  domains: [],
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  grant,
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

/** Open the form and fill it in. */
async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Report this link' }));
  await user.type(screen.getByLabelText('What makes you doubt this link?'), '  I do not know them.  ');
  await user.type(screen.getByLabelText('Your email address (optional)'), 'reporter@example.invalid');
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('ownpace.locale', 'en');
  serverMessageMock.mockReturnValue('a server sentence');
  grantReadMock.mockResolvedValue(SUBJECT);
  viewReadMock.mockResolvedValue(VIEW({ state: 'granted' }));
  availableMock.mockResolvedValue(true);
  sendMock.mockResolvedValue('41001');
});

describe('on the grant page', () => {
  it('is not offered when a report could reach nobody', async () => {
    availableMock.mockResolvedValue(false);
    renderAt('/grant/abc.def');
    expect(await screen.findByText(/Acme Legal is moving your account/)).toBeInTheDocument();
    await waitFor(() => expect(availableMock).toHaveBeenCalledWith('grant', 'abc.def'));
    expect(screen.queryByRole('button', { name: 'Report this link' })).not.toBeInTheDocument();
  });

  it('says where the report goes, what goes with it and what the address is for, before sending', async () => {
    const user = userEvent.setup();
    renderAt('/grant/abc.def');
    await user.click(await screen.findByRole('button', { name: 'Report this link' }));

    expect(screen.getByText('Your report goes to the Ownpace team, not to Acme Legal.')).toBeInTheDocument();
    expect(screen.getByText('Sent with it: which link this is, so we can find who sent it.')).toBeInTheDocument();
    expect(screen.getByText('Only if you want an answer; we use it for nothing else.')).toBeInTheDocument();
    // Nothing to send until they say what makes them doubt it; the address may stay empty.
    expect(screen.getByRole('button', { name: 'Send the report' })).toBeDisabled();
    await user.type(screen.getByLabelText('What makes you doubt this link?'), '   ');
    expect(screen.getByRole('button', { name: 'Send the report' })).toBeDisabled();
    expect(screen.getByLabelText('Your email address (optional)')).not.toBeRequired();
    await user.type(screen.getByLabelText('What makes you doubt this link?'), 'x');
    expect(screen.getByRole('button', { name: 'Send the report' })).toBeEnabled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('opens and closes where it is, and the keyboard stays on the line that was pressed', async () => {
    const user = userEvent.setup();
    renderAt('/grant/abc.def');
    const line = await screen.findByRole('button', { name: 'Report this link' });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('What makes you doubt this link?')).not.toBeInTheDocument();

    await user.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(line).toHaveFocus();
    // The form it controls follows it in the tab order.
    const form = document.getElementById(line.getAttribute('aria-controls')!);
    expect(form).toContainElement(screen.getByLabelText('What makes you doubt this link?'));
    await user.tab();
    expect(screen.getByLabelText('What makes you doubt this link?')).toHaveFocus();

    await user.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('What makes you doubt this link?')).not.toBeInTheDocument();
  });

  it('sends what they wrote from this link, and tells them they need not continue', async () => {
    const user = userEvent.setup();
    renderAt('/grant/abc.def');
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Send the report' }));

    expect(sendMock).toHaveBeenCalledWith('grant', 'abc.def', {
      description: 'I do not know them.',
      replyTo: 'reporter@example.invalid',
    });
    expect(
      await screen.findByText('Sent. Your report is number 41001, and we will reply to reporter@example.invalid.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You need not continue: nothing is read unless you allow it at Google.'),
    ).toBeInTheDocument();
    // The button that was pressed is gone, so the answer has the focus, and is read out.
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('sends without an address when none is given, and says nobody can answer them', async () => {
    const user = userEvent.setup();
    renderAt('/grant/abc.def');
    await user.click(await screen.findByRole('button', { name: 'Report this link' }));
    await user.type(screen.getByLabelText('What makes you doubt this link?'), 'I do not know them.');
    await user.type(screen.getByLabelText('Your email address (optional)'), '   ');
    await user.click(screen.getByRole('button', { name: 'Send the report' }));

    expect(sendMock).toHaveBeenCalledWith('grant', 'abc.def', { description: 'I do not know them.' });
    expect(
      await screen.findByText('Sent. Your report is number 41001. Without an address, we cannot answer you.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('keeps what they wrote when the report is refused, with the reason', async () => {
    sendMock.mockRejectedValue(new Error('refused'));
    serverMessageMock.mockReturnValue('Your report could not be delivered just now. Reference 0a1b2c3d.');
    const user = userEvent.setup();
    renderAt('/grant/abc.def');
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Send the report' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Reference 0a1b2c3d');
    expect(screen.getByLabelText('What makes you doubt this link?')).toHaveValue('  I do not know them.  ');
  });

  it('speaks Dutch to a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    const user = userEvent.setup();
    renderAt('/grant/abc.def');
    await user.click(await screen.findByRole('button', { name: 'Deze link melden' }));
    expect(screen.getByText('Uw melding gaat naar het team van Ownpace, niet naar Acme Legal.')).toBeInTheDocument();
    expect(screen.getByLabelText('Uw e-mailadres (niet verplicht)')).toBeInTheDocument();
  });
});

describe('on the progress page', () => {
  it('reports from the progress link, and points at withdrawing while there is access to withdraw', async () => {
    const user = userEvent.setup();
    renderAt('/view/abc.def');
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Send the report' }));

    expect(sendMock).toHaveBeenCalledWith('view', 'abc.def', expect.anything());
    expect(await screen.findByText(/Your report is number 41001/)).toBeInTheDocument();
    expect(screen.getByText('To stop the copying now, withdraw the access above.')).toBeInTheDocument();
  });

  it('does not point at withdrawing when there is nothing to withdraw', async () => {
    viewReadMock.mockResolvedValue(VIEW({ state: 'none' }));
    const user = userEvent.setup();
    renderAt('/view/abc.def');
    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Send the report' }));

    expect(await screen.findByText(/Your report is number 41001/)).toBeInTheDocument();
    expect(screen.queryByText(/withdraw the access above/)).not.toBeInTheDocument();
  });
});

describe('the service', () => {
  /** The real service, over the mocked client. */
  const service = async () =>
    (await vi.importActual<typeof import('../services/link-report-service.ts')>('../services/link-report-service.ts'))
      .linkReportApi;

  it('asks at the door of its own kind of link, with the link as one path segment', async () => {
    const linkReportApi = await service();
    getMock.mockResolvedValue({ data: { available: true } });
    postMock.mockResolvedValue({ data: { ticket: '41001' } });
    expect(await linkReportApi.available('view', 'abc.def/x')).toBe(true);
    expect(getMock).toHaveBeenCalledWith('/view/abc.def%2Fx/report');
    const body = { description: 'x', replyTo: 'reporter@example.invalid' };
    expect(await linkReportApi.send('grant', 'abc.def', body)).toBe('41001');
    expect(postMock).toHaveBeenCalledWith('/grant/abc.def/report', body);
    // And without an address, as the form sends it when none was given.
    expect(await linkReportApi.send('view', 'abc.def', { description: 'x' })).toBe('41001');
    expect(postMock).toHaveBeenLastCalledWith('/view/abc.def/report', { description: 'x' });
  });

  it('offers nothing on any answer but true, or on no answer at all', async () => {
    const linkReportApi = await service();
    getMock.mockResolvedValue({ data: { available: 'yes' } });
    expect(await linkReportApi.available('grant', 'abc.def')).toBe(false);
    getMock.mockResolvedValue({ data: {} });
    expect(await linkReportApi.available('grant', 'abc.def')).toBe(false);
    getMock.mockRejectedValue(new Error('404'));
    expect(await linkReportApi.available('grant', 'abc.def')).toBe(false);
  });
});
