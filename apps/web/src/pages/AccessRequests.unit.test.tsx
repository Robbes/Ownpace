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
  grantMock.mockResolvedValue({ tenantId: 't-1', name: 'De Vries', email: REQUEST.email });
  declineMock.mockResolvedValue(undefined);
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

  it('declines when confirmed, carrying the note', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    renderQueue();

    await user.type(await screen.findByLabelText(/note/i), 'out of scope for now');
    await user.click(screen.getByRole('button', { name: /^decline$/i }));

    await waitFor(() => expect(declineMock).toHaveBeenCalledWith('req-1', 'out of scope for now'));
  });
});
