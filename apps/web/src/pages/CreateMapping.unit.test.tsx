// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The CreateMapping wizard: completability, failure honesty, and the
 * field-level honesty pass (0033 T3, 0037 T1/T3/T4/T5/T6).
 *
 * Pinned here:
 *  1. The wizard walks all six steps filling ONLY the fields each step
 *     renders and reaches submit (0037 T1 — it used to be uncompletable).
 *  2. Create success NAVIGATES to /mappings/:id/confirm (0037 T2) instead of
 *     swapping component state no route could reach.
 *  3. A failed submit renders the server's words and keeps the form.
 *  4. A disabled Next says WHY, naming the missing field — including a
 *     cleared port, which used to become NaN with no clue (0037 T3).
 *  5. The credential inputs carry the autocomplete attributes; the review
 *     note tells the 0013 truth: creating starts nothing (0037 T3).
 *  6. Incoherent target/domain choices and garbage cron cannot be submitted;
 *     the reasons render in the shared contract's words (0037 T4).
 *  7. A dirty wizard prompts before unload and before Cancel (0037 T5).
 *  8. oauth2/graph sources say on screen what the fields actually do (T6).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import CreateMapping from './CreateMapping';
import { mappingApi } from '../services/mapping-service';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { create: vi.fn() },
}));

const createMock = vi.mocked(mappingApi.create);

const renderWizard = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/mappings/new']}>
        <Routes>
          <Route path="/mappings/new" element={<CreateMapping />} />
          {/* Success is a NAVIGATION now (0037 T2) — the confirm screen has
              its own page and tests; here the route is only the marker that
              onSuccess sent the browser to the green light's real URL. */}
          <Route path="/mappings/:mappingId/confirm" element={<div>confirm-route</div>} />
          <Route path="/mappings" element={<div>mappings-list-route</div>} />
        </Routes>
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

  it('walks all six steps filling only the visible fields; success navigates to the confirm ROUTE (0037 T1+T2)', async () => {
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
    // onSuccess NAVIGATED: the green light now has a URL that survives a
    // refresh, instead of in-memory component state no route reached.
    expect(await screen.findByText('confirm-route')).toBeInTheDocument();
  });

  it('the wizard cannot advance past a step whose own fields are empty, and SAYS which field', () => {
    renderWizard();
    // Source host empty → Next disabled, and the reason line names Host.
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('To continue, fill in:');
    expect(screen.getByRole('status').textContent).toContain('Host');
  });

  it('a cleared port blocks Next and is NAMED, instead of becoming a silent NaN (0037 T3)', () => {
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('993'), { target: { value: '' } });

    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('Port');
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

describe('CreateMapping — field-level honesty on the credentials and review steps (0037 T3)', () => {
  beforeEach(() => createMock.mockReset());

  const walkToCredentials = () => {
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    fireEvent.click(nextButton());
  };

  it('the credential inputs carry autocomplete attributes and a show/hide toggle', () => {
    renderWizard();
    walkToCredentials();

    const usernames = screen.getAllByPlaceholderText('user@example.com');
    expect(usernames[0]).toHaveAttribute('autocomplete', 'username');
    expect(usernames[1]).toHaveAttribute('autocomplete', 'username');
    const passwords = screen.getAllByPlaceholderText('••••••••');
    expect(passwords[0]).toHaveAttribute('autocomplete', 'new-password');
    expect(passwords[1]).toHaveAttribute('autocomplete', 'new-password');
    expect(passwords[0]).toHaveAttribute('type', 'password');

    // The toggle makes a masked paste checkable.
    fireEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]!);
    expect(screen.getAllByPlaceholderText('••••••••')[0]).toHaveAttribute('type', 'text');

    // One honest sentence about what happens to the secrets.
    expect(screen.getByText(/encrypted at rest/)).toBeInTheDocument();
    expect(screen.getByText(/never shown again/)).toBeInTheDocument();
  });

  it('the step is labeled for what it contains: Name & credentials', () => {
    renderWizard();
    expect(screen.getByText('Name & credentials')).toBeInTheDocument();
  });

  it('the review note no longer claims sync starts on create — it names the paused truth', () => {
    createMock.mockResolvedValue({} as never);
    renderWizard();
    walkToReview();

    expect(screen.getByText(/starts nothing/)).toBeInTheDocument();
    expect(screen.getByText(/created paused/)).toBeInTheDocument();
    expect(screen.getByText(/explicit start/)).toBeInTheDocument();
    expect(screen.queryByText(/may take some time/)).not.toBeInTheDocument();
  });
});

describe('CreateMapping — choices that cannot work are constrained (0037 T4)', () => {
  beforeEach(() => createMock.mockReset());

  const walkToDataTypes = (target: string) => {
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${target}`) }));
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'dav.acme.example' },
    });
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme mail' },
    });
    const usernames = screen.getAllByPlaceholderText('user@example.com');
    fireEvent.change(usernames[0]!, { target: { value: 'source@acme.example' } });
    fireEvent.change(usernames[1]!, { target: { value: 'target@acme.example' } });
    fireEvent.click(nextButton());
  };

  it('a CardDAV target blocks the preselected email domain with the shared refusal, and recovers on deselect', () => {
    renderWizard();
    walkToDataTypes('CardDAV');

    // email is preselected but CardDAV cannot receive it: Next is blocked
    // and the reason is the SAME sentence the server would refuse with.
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('CardDAV target cannot receive');
    expect(screen.getByRole('status').textContent).toContain("'email'");

    // Unreachable types are marked; the selected-but-incompatible one stays
    // clickable so it can be DESELECTED.
    fireEvent.click(screen.getByRole('button', { name: /Email/ }));
    fireEvent.click(screen.getByRole('button', { name: /Contacts?/ }));
    expect(nextButton()).toBeEnabled();
  });

  it('calendar is not offered over a JMAP target (0031 T1 parked by owner decision)', () => {
    renderWizard();
    walkToDataTypes('JMAP');

    const calendarButton = screen.getByRole('button', { name: /Calendar/ });
    expect(calendarButton).toBeDisabled();
    expect(
      screen.getAllByText('Not available over the selected target protocol.').length,
    ).toBeGreaterThan(0);
  });

  it('garbage cron blocks Next with the reason; a valid one echoes its next runs', () => {
    renderWizard();
    // Walk to the schedule step with defaults.
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme mail' },
    });
    const usernames = screen.getAllByPlaceholderText('user@example.com');
    fireEvent.change(usernames[0]!, { target: { value: 'source@acme.example' } });
    fireEvent.change(usernames[1]!, { target: { value: 'target@acme.example' } });
    fireEvent.click(nextButton());
    fireEvent.click(nextButton()); // data types → schedule

    const cronInput = screen.getByPlaceholderText('0 2 * * *');
    fireEvent.change(cronInput, { target: { value: 'every day at noon' } });
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('five fields');
    expect(cronInput).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(cronInput, { target: { value: '0 3 * * *' } });
    expect(nextButton()).toBeEnabled();
    // The echo: next firings computed by the same croner the tick uses.
    expect(screen.getByTestId('cron-next-runs').textContent).toContain(
      'the next syncs would run',
    );
  });
});

describe('CreateMapping — a dirty wizard does not discard silently (0037 T5)', () => {
  beforeEach(() => createMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('arms beforeunload once the form is dirty, not before', () => {
    renderWizard();

    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('Cancel on a dirty wizard asks first and stays when declined', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(confirmSpy).toHaveBeenCalledOnce();
    // Declined: still in the wizard.
    expect(screen.getByPlaceholderText('imap.example.com')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(screen.getByText('mappings-list-route')).toBeInTheDocument();
  });

  it('Cancel on a CLEAN wizard leaves without asking', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText('mappings-list-route')).toBeInTheDocument();
  });
});

describe('CreateMapping — oauth2/graph honesty until the owner decides (0037 T6)', () => {
  beforeEach(() => createMock.mockReset());

  it('selecting OAuth2 or Graph says the wizard collects only username+password', () => {
    renderWizard();
    expect(screen.queryByText(/not fully configurable here yet/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /OAuth2/ }));
    expect(screen.getByText(/collects only a username and password/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Microsoft Graph/ }));
    expect(screen.getByText(/collects only a username and password/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^IMAP/ }));
    expect(screen.queryByText(/collects only a username and password/)).not.toBeInTheDocument();
  });
});
