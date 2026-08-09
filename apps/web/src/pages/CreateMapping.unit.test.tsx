// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The CreateMapping wizard's completability and its failure honesty
 * (0033 T3 + 0037 T1 pulled forward).
 *
 * Two defects pinned here, both found by the 2026-08-09 review fleet:
 *
 * 1. The wizard could not be completed AT ALL: canProceed('source') required
 *    `sourceUsername`, an input that renders two steps later — Next was
 *    disabled forever on the first screen. The walk-through test below fills
 *    ONLY the fields each step renders and must reach submit.
 * 2. A failed submit rendered NOTHING (`createMutation.isError` was never
 *    read): the operator clicked "Create Migration" and the button returned
 *    to rest. The failure now renders the server's words and keeps the form.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import CreateMapping from './CreateMapping';
import { mappingApi } from '../services/mapping-service';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { create: vi.fn() },
}));

// The post-create confirm screen has its own tests; here it is only the
// success marker — reaching it proves onSuccess ran.
vi.mock('../components/ConfirmMigration', () => ({
  ConfirmMigration: ({ mappingId }: { mappingId: string }) => (
    <div>confirm-screen-for:{mappingId}</div>
  ),
}));

const createMock = vi.mocked(mappingApi.create);

const renderWizard = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreateMapping />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const nextButton = () =>
  screen.getByRole('button', { name: /Next|Create Migration/ });

/** Fill only what each step RENDERS and advance — the whole point of the
 *  0037 T1 pin. Fails on the old gates at the very first click. */
const walkToReview = () => {
  // Step 1 — Source: host (port is prefilled).
  fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
    target: { value: 'mail.old-provider.example' },
  });
  expect(nextButton()).toBeEnabled();
  fireEvent.click(nextButton());

  // Step 2 — Target: host (port prefilled, jmap preselected).
  fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
    target: { value: 'stalwart.acme.example' },
  });
  fireEvent.click(nextButton());

  // Step 3 — Name & credentials (the usernames gate HERE now, where the
  // inputs are, not on steps 1-2).
  fireEvent.change(screen.getByPlaceholderText('My Migration'), {
    target: { value: 'Acme mail' },
  });
  const usernames = screen.getAllByPlaceholderText('user@example.com');
  fireEvent.change(usernames[0]!, { target: { value: 'source@acme.example' } });
  fireEvent.change(usernames[1]!, { target: { value: 'target@acme.example' } });
  fireEvent.click(nextButton());

  // Step 4 — Data types: email is preselected.
  fireEvent.click(nextButton());

  // Step 5 — Schedule: optional.
  fireEvent.click(nextButton());
};

/** An axios-shaped 400, the way the real apiClient delivers the server's
 *  refusal — the sentence lives in response.data, not err.message. */
const axios400 = (message: string): AxiosError => {
  const err = new AxiosError('Request failed with status code 400');
  err.response = {
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'Validation error', message },
  };
  return err;
};

describe('CreateMapping — the wizard reaches submit and says what failed', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('walks all six steps filling only the visible fields and reaches submit (0037 T1)', async () => {
    createMock.mockResolvedValue({
      id: 'mapping-new',
      tenantId: 't1',
      name: 'Acme mail',
      sourceType: 'imap',
      targetType: 'jmap',
      status: 'paused',
      mode: 'mirror',
      syncConfig: { domains: ['email'] },
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z',
    });

    renderWizard();
    walkToReview();

    // Step 6 — Review: submit.
    fireEvent.click(screen.getByRole('button', { name: /Create Migration/ }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // onSuccess ran: the confirm/green-light screen replaced the wizard.
    expect(await screen.findByText('confirm-screen-for:mapping-new')).toBeInTheDocument();
  });

  it('the wizard cannot advance past a step whose own fields are empty', () => {
    renderWizard();
    // Source host empty → Next disabled. (What must NOT gate here is the
    // username, which has no input on this step.)
    expect(nextButton()).toBeDisabled();
  });

  it('a rejected create renders the SERVER message and keeps the form (0033 T3)', async () => {
    createMock.mockRejectedValue(
      axios400("sync mode must be 'mirror', which is the only mode this engine implements."),
    );

    renderWizard();
    walkToReview();
    fireEvent.click(screen.getByRole('button', { name: /Create Migration/ }));

    // The dictionary frame + the server's sentence verbatim.
    expect(
      await screen.findByText(/The migration was not created/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sync mode must be 'mirror'/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 400')).not.toBeInTheDocument();

    // No data loss: still on the review step, resubmittable.
    expect(screen.getByRole('button', { name: /Create Migration/ })).toBeInTheDocument();
  });
});
