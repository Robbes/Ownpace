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
 *  6. **How many people the owner has let in, out of their number** (workplan
 *     0177 T16, §20.4): *People you let in: n of max* above the requests, read
 *     from the operator's gifts answer, and at the number and past it a line
 *     that stands out in words too. And a request a recommendation let in at
 *     the door says so, and names nobody as having decided it (§21.2, 18).
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
import { listAllGifts, type OperatorGifts } from '../services/gifts.ts';

// The three network calls are stubbed; `alreadyOwnsRefusal` is NOT. It is a
// pure reading of a response body and it is half of what these tests are about
// — stubbing it would let the screen pass while the recogniser was wrong, which
// is the only way this feature can fail silently.
vi.mock('../services/access-requests.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/access-requests.ts')>()),
  listAccessRequests: vi.fn(),
  grantAccessRequest: vi.fn(),
  declineAccessRequest: vi.fn(),
}));

// The owner's line above the requests reads the operator's gifts answer (§19).
vi.mock('../services/gifts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/gifts.ts')>()),
  listAllGifts: vi.fn(),
}));

/** The operator's gifts answer, with the Alpha's two counts and ceilings (§19's contract). */
const GIFTS = (alpha: Partial<OperatorGifts['alpha']>): OperatorGifts => ({
  gifts: [],
  giftsPerPerson: 1,
  allowances: [],
  alpha: { byOwner: 12, ownerCeiling: 50, byRecommendation: 3, recommendationCeiling: 50, unusedGifts: 2, ...alpha },
});

const listMock = vi.mocked(listAccessRequests);
const giftsMock = vi.mocked(listAllGifts);
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
  gift: null,
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
  giftsMock.mockReset();
  // Not answered unless a case asks: the queue works without the line.
  giftsMock.mockReturnValue(new Promise<never>(() => {}));
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

  // Workplan 0172: a request that came with a code says whose; 0177 names it a recommendation.
  it('marks a request that came with a recommendation, with the giver', async () => {
    listMock.mockResolvedValue([REQUEST, { ...REQUEST, id: 'req-2', email: 'cato@example.test', gift: { from: 'anna@example.test' } }]);
    renderQueue();
    expect(await screen.findByText('Recommended by anna@example.test')).toBeInTheDocument();
    expect(screen.getAllByText(/^Recommended by/)).toHaveLength(1);
  });

  it('says plainly when nobody is waiting', async () => {
    listMock.mockResolvedValue([]);
    renderQueue();
    expect(await screen.findByText(/nobody is waiting/i)).toBeInTheDocument();
  });
});

describe('the people the owner lets in (workplan 0177 T16, §20.4)', () => {
  it('shows People you let in: n of max above the requests', async () => {
    giftsMock.mockResolvedValue(GIFTS({ byOwner: 12, ownerCeiling: 50 }));
    renderQueue();
    const line = await screen.findByText('People you let in: 12 of 50');
    const first = await screen.findByText('stranger@example.test');
    expect(line.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('The number is reached.')).toBeNull();
  });

  it.each([
    [50, 50],
    [52, 50],
  ])('at the number and past it the line stands out, and not by colour alone (%i of %i)', async (n, max) => {
    giftsMock.mockResolvedValue(GIFTS({ byOwner: n, ownerCeiling: max }));
    renderQueue();
    const line = await screen.findByText(`People you let in: ${n} of ${max}`);
    expect(line.closest('[data-at-ceiling]')).toHaveTextContent('The number is reached.');
  });

  it('past the number, a grant is not refused: the owner keeps count (D17)', async () => {
    giftsMock.mockResolvedValue(GIFTS({ byOwner: 52, ownerCeiling: 50 }));
    renderQueue();
    await screen.findByText('People you let in: 52 of 50');
    const grant = await screen.findByRole('button', { name: 'Grant access' });
    expect(grant).toBeEnabled();
    await userEvent.click(grant);
    await waitFor(() => expect(grantMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/People you let in: 52 of 50/).closest('[data-at-ceiling]')).not.toBeNull();
  });

  it('a request a recommendation let in at the door says so, and names nobody as having decided it; one the owner granted still names who did', async () => {
    listMock.mockResolvedValue([
      {
        ...REQUEST,
        id: 'req-3',
        email: 'cato@example.test',
        state: 'granted',
        tenantId: 't-3',
        decidedAt: '2026-12-02T10:00:00.000Z',
        gift: { from: 'anna@example.test' },
        letInByRecommendation: true,
      },
      { ...REQUEST, id: 'req-4', state: 'granted', tenantId: 't-4', decidedBy: 'owner-subject', decidedAt: '2026-12-02T10:00:00.000Z', letInByRecommendation: false },
    ]);
    renderQueue();
    expect(await screen.findByText(/^Let in with a recommendation, at the door\. Nobody decided it\./)).toBeInTheDocument();
    expect(screen.getAllByText(/Decided by/)).toHaveLength(1);
    expect(screen.getByText(/Decided by owner-subject/)).toBeInTheDocument();
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

describe('granting somebody who already owns an organisation', () => {
  /** What the route answers: 409, the names, and the field that means it anyway. */
  const REFUSAL = {
    response: {
      status: 409,
      data: {
        error: 'Conflict',
        message:
          'That address already owns organisations: De Vries, Bakerloo SMB. Granting again ' +
          'creates another one, with them as owner of both.',
        organisations: ['De Vries', 'Bakerloo SMB'],
        confirmWith: 'alsoCreateSecondOrganisation',
      },
    },
  };

  it('names what they already own, rather than describing it', async () => {
    const user = userEvent.setup();
    grantMock.mockRejectedValue(REFUSAL);
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /grant access/i }));

    // The organisations themselves. "They already own one" sends an operator
    // off to go and look; the answer is usually visible on reading which.
    expect(await screen.findByText('De Vries')).toBeInTheDocument();
    expect(screen.getByText('Bakerloo SMB')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/already owns an organisation/i);
  });

  it('sends the confirmation the server asked for, and only on the second press', async () => {
    const user = userEvent.setup();
    grantMock.mockRejectedValueOnce(REFUSAL).mockResolvedValueOnce({
      tenantId: 't-2',
      name: 'De Vries',
      email: REQUEST.email,
      notified: 'sent',
    });
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /grant access/i }));
    // THE PROPERTY: the first press carries no override. A screen that sent it
    // pre-emptively would make the server's refusal unreachable and quietly
    // create the second organisation the refusal exists to prevent.
    expect(grantMock).toHaveBeenLastCalledWith('req-1', { organisationName: 'De Vries' });

    await user.click(await screen.findByRole('button', { name: /create a second organisation/i }));

    await waitFor(() =>
      expect(grantMock).toHaveBeenLastCalledWith('req-1', {
        organisationName: 'De Vries',
        alsoCreateSecondOrganisation: true,
      }),
    );
  });

  it('takes the operator at their word when they back out', async () => {
    const user = userEvent.setup();
    grantMock.mockRejectedValue(REFUSAL);
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /grant access/i }));
    await user.click(await screen.findByRole('button', { name: /leave it as it is/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Backing out is not a decision: nothing more was sent.
    expect(grantMock).toHaveBeenCalledTimes(1);
  });

  it('offers NO override for a refusal that has none', async () => {
    // "Already decided" is also a 409 and cannot be overridden by anything.
    // Keying the block on the status rather than on `confirmWith` would put a
    // button here that could only ever fail.
    const user = userEvent.setup();
    grantMock.mockRejectedValue({
      response: { status: 409, data: { message: 'That request was already granted.' } },
    });
    renderQueue();

    await user.click(await screen.findByRole('button', { name: /grant access/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already granted/i);
    expect(
      screen.queryByRole('button', { name: /create a second organisation/i }),
    ).not.toBeInTheDocument();
  });
});
