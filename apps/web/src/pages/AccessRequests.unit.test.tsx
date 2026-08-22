// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The access queue screen (workplan 0093 T7).
 *
 * What is worth asserting on a screen whose authorisation lives entirely in the
 * database is not "does it hide things from the wrong people" — it cannot, and
 * should not try. It is the three things a person acting on this screen could
 * be misled about:
 *
 *  1. **What granting actually sends.** The organisation name the operator sees
 *     prefilled is the one that gets created, and an edited one must reach the
 *     server rather than being decoration.
 *  2. **That a refusal is shown verbatim.** A 409 says the request was already
 *     decided — a sentence somebody can act on. "Something went wrong" is not.
 *  3. **That declining asks first.** It cannot be undone from this screen.
 *  4. **That what became of the email reaches them** (workplan 0095 T5). The
 *     card that knows the outcome unmounts the moment the row leaves the tab,
 *     so `notified` has to be lifted out or it is answered to nobody — and
 *     `off` means the operator is now the only person who can tell the asker.
 *  5. **That "do not email them" is obeyed and asked about.** A public form
 *     means junk in the queue, and a refusal mailed to a forged address is a
 *     mail to a stranger.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AccessRequests from './AccessRequests.tsx';
import {
  declineAccessRequest,
  grantAccessRequest,
  listAccessRequests,
  type AccessRequest,
} from '../services/access-requests.ts';

vi.mock('../services/access-requests.ts', () => ({
  listAccessRequests: vi.fn(),
  grantAccessRequest: vi.fn(),
  declineAccessRequest: vi.fn(),
}));

const listMock = vi.mocked(listAccessRequests);
const grantMock = vi.mocked(grantAccessRequest);
const declineMock = vi.mocked(declineAccessRequest);

const REQUEST: AccessRequest = {
  id: 'req-1',
  email: 'stranger@example.test',
  name: 'Jo de Vries',
  organisation: 'De Vries',
  note: 'two mailboxes off Google',
  tier: null,
  locale: 'nl',
  state: 'open',
  tenantId: null,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdAt: '2026-08-20T10:00:00.000Z',
};

const renderQueue = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccessRequests />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  listMock.mockReset();
  grantMock.mockReset();
  declineMock.mockReset();
  listMock.mockResolvedValue([REQUEST]);
  grantMock.mockResolvedValue({
    tenantId: 't-1',
    name: 'De Vries',
    email: REQUEST.email,
    notified: 'sent',
  });
  declineMock.mockResolvedValue({ declined: true, id: REQUEST.id, notified: 'sent' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the queue', () => {
  it('shows what somebody asked for, in their own words', async () => {
    renderQueue();
    expect(await screen.findByText('stranger@example.test')).toBeInTheDocument();
    expect(screen.getByText('two mailboxes off Google')).toBeInTheDocument();
  });

  it('says plainly when nobody is waiting', async () => {
    listMock.mockResolvedValue([]);
    renderQueue();
    expect(await screen.findByText(/nobody is waiting/i)).toBeInTheDocument();
  });
});

describe('granting', () => {
  it('sends the organisation name the operator can see, edits included', async () => {
    const user = userEvent.setup();
    renderQueue();

    const nameField = await screen.findByLabelText(/organisation name/i);
    // Prefilled with what they told us — an operator deciding should not have
    // to retype it, and should not be surprised by what gets created.
    expect(nameField).toHaveValue('De Vries');

    await user.clear(nameField);
    await user.type(nameField, 'Familie de Vries');
    await user.click(screen.getByRole('button', { name: /grant access/i }));

    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith('req-1', { organisationName: 'Familie de Vries' }),
    );
  });

  it("shows the server's own sentence when it refuses", async () => {
    const user = userEvent.setup();
    grantMock.mockRejectedValue({
      response: { data: { message: 'That request was already granted.' } },
    });
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /grant access/i }));

    // Verbatim: a 409 naming what happened is the whole of what an operator
    // can act on, and paraphrasing it loses that.
    expect(await screen.findByRole('alert')).toHaveTextContent(/already granted/i);
  });
});

describe('declining', () => {
  it('ASKS first — it cannot be undone from this screen', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /^decline$/i }));

    expect(confirm).toHaveBeenCalled();
    expect(declineMock).not.toHaveBeenCalled();
  });

  it('declines when confirmed, carrying the note and telling them by default', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderQueue();

    await user.type(await screen.findByLabelText(/note/i), 'out of scope for now');
    await user.click(screen.getByRole('button', { name: /^decline$/i }));

    // `notify: true` WITHOUT anybody ticking anything: silence is the choice
    // that has to be made, never the one that happens by not making one.
    await waitFor(() =>
      expect(declineMock).toHaveBeenCalledWith('req-1', {
        note: 'out of scope for now',
        notify: true,
      }),
    );
  });

  it('sends nothing when the operator unticks, and asks the matching question', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderQueue();

    await user.click(await screen.findByLabelText(/email them if you decline/i));
    await user.click(screen.getByRole('button', { name: /^decline$/i }));

    // The confirmation is the last chance to notice, so it says which of the
    // two things is about to happen rather than one wording for both.
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/without emailing them/i));
    await waitFor(() => expect(declineMock).toHaveBeenCalledWith('req-1', { notify: false }));
  });

  it('says so when it could not email them, without hiding that it was declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    declineMock.mockResolvedValue({ declined: true, id: REQUEST.id, notified: 'failed' });
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /^decline$/i }));

    // BOTH halves. The decision stuck — hiding that behind a mail failure would
    // invite somebody to decline the same request twice — and the mail did not,
    // which hands the manual step to the only person who can take it.
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent(/stays on the record/i);
    expect(said).toHaveTextContent(/could not be sent/i);
    expect(said).toHaveTextContent(REQUEST.email);
  });

  it('reports a quiet decline as a choice, not as a failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    declineMock.mockResolvedValue({ declined: true, id: REQUEST.id, notified: 'skipped' });
    renderQueue();

    await user.click(await screen.findByLabelText(/email them if you decline/i));
    await user.click(screen.getByRole('button', { name: /^decline$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/as you asked/i);
  });
});

describe('what became of the email', () => {
  it('tells the operator when a GRANT emailed nobody', async () => {
    const user = userEvent.setup();
    grantMock.mockResolvedValue({
      tenantId: 't-1',
      name: 'De Vries',
      email: REQUEST.email,
      notified: 'off',
    });
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /grant access/i }));

    // The organisation exists and the person does not know. This is the one
    // outcome where doing nothing next is actively wrong, so it names them.
    const said = await screen.findByRole('status');
    expect(said).toHaveTextContent(/nobody was emailed/i);
    expect(said).toHaveTextContent(REQUEST.email);
  });
});
