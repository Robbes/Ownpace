// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The CreateMapping wizard: completability, failure honesty, and the
 * field-level honesty pass (0033 T3, 0037 T1/T3/T4/T5/T6).
 *
 * Pinned here:
 *  1. The wizard walks all four steps — source, target, migration, review
 *     since workplan 0070 — filling ONLY the fields each step renders, and
 *     reaches submit (0037 T1 — it used to be uncompletable).
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
import CreateMapping from './CreateMapping.tsx';
import { mappingApi } from '../services/mapping-service.ts';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { create: vi.fn() },
  // The wizard offers reusable connections (workplan 0064); an empty list is
  // the "nothing to reuse yet" case these walks exercise.
  connectionsApi: { list: vi.fn().mockResolvedValue([]) },
}));

const createMock = vi.mocked(mappingApi.create);

// The wizard now REMEMBERS its non-secret half across mounts (workplan 0069),
// which is the feature — and which means every test in this file has to start
// from an empty draft or it inherits whatever the previous one typed. File
// level rather than per-describe: the draft outlives a describe block too.
beforeEach(() => {
  globalThis.sessionStorage.clear();
});

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
  // Step 1 — Source: each side now carries its OWN credentials (workplan
  // 0070), so the account and the password gate here, beside the host.
  fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
    target: { value: 'mail.old-provider.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
    target: { value: 'source@acme.example' },
  });
  expect(nextButton()).toBeEnabled();
  fireEvent.click(nextButton());

  // Step 2 — Target: host, account, password (port prefilled, jmap preselected).
  fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
    target: { value: 'stalwart.acme.example' },
  });
  fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
    target: { value: 'target@acme.example' },
  });
  fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
    target: { value: 'target-password' },
  });
  fireEvent.click(nextButton());

  // Step 3 — The migration itself: a name, what to move (email preselected)
  // and how often (empty = the default cadence).
  fireEvent.change(screen.getByPlaceholderText('My Migration'), {
    target: { value: 'Acme mail' },
  });
  fireEvent.click(nextButton());
};


/**
 * Fill the source account and any secret the chosen provider now demands
 * (workplan 0070): each side gates on its own credentials, so a test that only
 * set the provider config can no longer leave step one.
 */
const satisfySourceStep = () => {
  const user = screen.queryAllByPlaceholderText('user@example.com')[0];
  if (user) fireEvent.change(user, { target: { value: 'source@acme.example' } });
  document
    .querySelectorAll('input[type="password"]')
    .forEach((el) => fireEvent.change(el, { target: { value: 'secret-value' } }));
  const refresh = screen.queryByPlaceholderText('1//…');
  if (refresh) fireEvent.change(refresh, { target: { value: '1//refresh-token' } });
};


/** As satisfySourceStep, for the target side's own account and password. */
const satisfyTargetStep = () => {
  const user = screen.queryAllByPlaceholderText('user@example.com')[0];
  if (user) fireEvent.change(user, { target: { value: 'target@acme.example' } });
  const pw = document.querySelectorAll('input[type="password"]')[0];
  if (pw) fireEvent.change(pw, { target: { value: 'target-password' } });
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

  it('walks all four steps filling only the visible fields; success navigates to the confirm ROUTE (0037 T1+T2)', async () => {
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

    // Step 4 — Review: submit.
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

  /**
   * The account and the secret a side needs are rendered BY that side now
   * (workplan 0070), so there is no shared credentials step left to walk to:
   * the source pair is on step one and the target pair on step two. This walk
   * asserts the same properties on each, where each actually lives.
   */
  const assertCredentialPair = () => {
    const username = screen.getByPlaceholderText('user@example.com');
    expect(username).toHaveAttribute('autocomplete', 'username');

    const secret = screen.getByPlaceholderText('••••••••');
    expect(secret).toHaveAttribute('autocomplete', 'new-password');
    expect(secret).toHaveAttribute('type', 'password');

    // The toggle makes a masked paste checkable.
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByPlaceholderText('••••••••')).toHaveAttribute('type', 'text');

    // One honest sentence about what happens to the secrets, on the step that
    // collects them rather than one the person may never scroll back to.
    expect(screen.getByText(/encrypted at rest/)).toBeInTheDocument();
    expect(screen.getByText(/never shown again/)).toBeInTheDocument();
  };

  it('the credential inputs carry autocomplete attributes and a show/hide toggle', () => {
    renderWizard();

    // Step 1 — the SOURCE's own account and password.
    assertCredentialPair();

    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    satisfySourceStep();
    fireEvent.click(nextButton());

    // Step 2 — the TARGET's, with the same attributes and its own toggle.
    assertCredentialPair();
  });

  it('the steps are labeled for what they contain', () => {
    renderWizard();
    // Four steps since workplan 0070: each side owns its credentials, and one
    // step finalises the migration between the two.
    for (const label of ['Source', 'Target', 'Migration', 'Review']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Name & credentials')).not.toBeInTheDocument();
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
    // Source: host + account (its credentials live here now).
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
      target: { value: 'source@acme.example' },
    });
    fireEvent.click(nextButton());

    // Target: pick the protocol, then its own host + account + password.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${target}`) }));
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'dav.acme.example' },
    });
    fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
      target: { value: 'target@acme.example' },
    });
    fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
      target: { value: 'target-password' },
    });
    fireEvent.click(nextButton());

    // The migration step carries the name, the data types and the schedule.
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme mail' },
    });
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
    // Source, then target — each finished on its own step (workplan 0070).
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    satisfySourceStep();
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());

    // The migration step carries the name, the data types AND the schedule:
    // the cron is no longer two clicks past the name.
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme mail' },
    });

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

  it('the sovereignty notice renders on the TARGET step, where the destination is chosen (owner decision 2026-08-10)', () => {
    renderWizard();
    // Source step: no destination talk here anymore.
    expect(screen.queryByText(/destination server is yours to run/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    satisfySourceStep();
    fireEvent.click(nextButton());
    expect(screen.getByText(/destination server is yours to run/)).toBeInTheDocument();
  });
});

describe('CreateMapping — oauth2/graph collect the app registration (0037 T6, owner decision 2026-08-10)', () => {
  beforeEach(() => createMock.mockReset());

  it('selecting Graph swaps host/port for tenant + client ID, explains the model, and gates by name', () => {
    renderWizard();
    expect(screen.queryByText(/app registration in your own tenant/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Microsoft Graph/ }));
    // The explainer replaces the retired collects-only-username confession.
    expect(screen.getByText(/app registration in your own tenant/)).toBeInTheDocument();
    expect(screen.queryByText(/collects only a username and password/)).not.toBeInTheDocument();
    // No server address to type; the registration gates instead, by name.
    expect(screen.queryByPlaceholderText('imap.example.com')).not.toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('Tenant ID');
    expect(screen.getByRole('status').textContent).toContain('Client ID');

    fireEvent.change(screen.getByPlaceholderText('contoso.onmicrosoft.com'), {
      target: { value: 'acme.onmicrosoft.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('00000000-0000-0000-0000-000000000000'), {
      target: { value: 'app-client-id' },
    });

    // The registration is not the whole side. This step carries the source's
    // own credentials too (workplan 0070), so it keeps gating — and keeps
    // naming what is left, rather than going quiet two screens early.
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('Source Username');
    expect(screen.getByRole('status').textContent).toContain('Source client secret');

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'mailbox@acme.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'shh-client-secret' },
    });
    expect(nextButton()).toBeEnabled();

    // Back to IMAP: the server fields return, the explainer leaves.
    fireEvent.click(screen.getByRole('button', { name: /^IMAP/ }));
    expect(screen.getByPlaceholderText('imap.example.com')).toBeInTheDocument();
    expect(screen.queryByText(/app registration in your own tenant/)).not.toBeInTheDocument();
  });

  it('a graph mapping gates on the client secret and submits the app registration, not a host', async () => {
    createMock.mockResolvedValue({ id: 'mapping-graph' } as never);
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: /Microsoft Graph/ }));
    fireEvent.change(screen.getByPlaceholderText('contoso.onmicrosoft.com'), {
      target: { value: 'acme.onmicrosoft.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('00000000-0000-0000-0000-000000000000'), {
      target: { value: 'app-client-id' },
    });
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'mailbox@acme.example' },
    });

    // The source's masked field here is the app registration's CLIENT SECRET,
    // not a mailbox password — labelled as what it is, and required: without
    // it the client-credentials flow cannot mint a single token. It gates the
    // SOURCE step now, beside the registration it belongs to.
    expect(screen.getByText('Source client secret')).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).toContain('Source client secret');

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'shh-client-secret' },
    });
    fireEvent.click(nextButton());

    // Target: its own server and its own account.
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());

    // Migration: a name; email is preselected and jmap takes it.
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme O365' },
    });
    fireEvent.click(nextButton());

    // Review echoes the tenant, not a host:port that was never asked.
    expect(screen.getByText(/acme\.onmicrosoft\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create Migration/ }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]![0]).toMatchObject({
      sourceType: 'graph',
      sourceConfig: {
        username: 'mailbox@acme.example',
        tenantId: 'acme.onmicrosoft.com',
        clientId: 'app-client-id',
        clientSecret: 'shh-client-secret',
      },
    });
    // No host/port smuggled along for a source that never asked for them.
    expect(createMock.mock.calls[0]![0].sourceConfig).not.toHaveProperty('host');
  });
});

describe('CreateMapping — a Google Drive source (workplan 0042)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selecting Google Drive pins the file domain, keeps a file-capable target, and walks to submit', async () => {
    createMock.mockResolvedValue({ id: 'map-drive' } as never);
    renderWizard();

    // Step 1 — Source: the fourth card. Choosing it also chooses the file
    // domain and a file-capable target — the same constraint the server
    // refuses by name, spared as a dead end three steps later.
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));
    expect(screen.getByText(/google-workspace-setup\.md/)).toBeInTheDocument();
    // No host/port for a Drive — the OAuth client ID gates instead.
    expect(screen.queryByPlaceholderText('imap.example.com')).not.toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid.apps.googleusercontent.com' },
    });
    // Its credentials gate HERE now (workplan 0070), on the source's own step.
    expect(nextButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@acme.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'client-secret' },
    });
    expect(nextButton()).toBeDisabled(); // the refresh token still gates
    fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: '1//refresh' } });
    // The side is now finishable — which is the whole point of the restructure.
    expect(nextButton()).toBeEnabled();
    fireEvent.click(nextButton());

    // Step 2 — Target: the preselected jmap SURVIVES the source switch, so it
    // needs only its own server, account and password.
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'nextcloud.acme.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'files@acme.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'target-pass' },
    });
    fireEvent.click(nextButton());

    // Step 3 — The migration itself: a name, what to move (file is pinned and
    // the mail-shaped types cannot be picked), how often.
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme files' },
    });
    fireEvent.click(nextButton());

    // Step 4 — Review: submit.
    fireEvent.click(nextButton());

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const posted = createMock.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(posted.sourceType).toBe('google-drive');
    expect(posted.targetType).toBe('jmap');
    expect(posted.sourceConfig).toMatchObject({
      username: 'owner@acme.example',
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      refreshToken: '1//refresh',
    });
    // No host/port fabricated for a source that has neither.
    expect(posted.sourceConfig).not.toHaveProperty('host');
    expect((posted.syncConfig as { domains: string[] }).domains).toEqual(['file']);
  });

  it('domains beyond file are not offerable for a Drive source', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));
    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid' },
    });
    satisfySourceStep();
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'nc.acme.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('My Migration'), { target: { value: 'x' } });

    // The Email card is disabled on the migration step: the SOURCE rules it
    // out even though the jmap target would carry it — a Drive credential
    // reads the Drive API and nothing else. The wizard constrains rather than
    // letting the server refuse after the walk is over.
    const emailCard = screen.getByRole('button', { name: /Email/ });
    expect(emailCard).toBeDisabled();
  });
});

describe('CreateMapping — a Gmail source (workplan 0044)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selecting Gmail pins the email domain, keeps a mail-capable target, and walks to submit', async () => {
    createMock.mockResolvedValue({ id: 'map-gmail' } as never);
    renderWizard();

    // Step 1 — Source: the fifth card. Choosing it pins email and a
    // mail-capable target, and the setup note warns about the ONE mistake
    // waiting to happen: a Drive-consented token does not mint mail tokens.
    fireEvent.click(screen.getByRole('button', { name: /Gmail/ }));
    expect(screen.getByText(/mail\.google\.com/)).toBeInTheDocument();
    // No host/port — Gmail's endpoint is fixed; the OAuth client ID gates.
    expect(screen.queryByPlaceholderText('imap.example.com')).not.toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid.apps.googleusercontent.com' },
    });
    // Gmail's credentials gate HERE now (workplan 0070) — the mailbox this
    // migration moves, the OAuth client's secret, and the mail-scoped token.
    expect(nextButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@gmail.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'client-secret' },
    });
    expect(nextButton()).toBeDisabled(); // the refresh token still gates
    fireEvent.change(screen.getByPlaceholderText('1//…'), {
      target: { value: '1//mail-refresh' },
    });
    expect(nextButton()).toBeEnabled();
    fireEvent.click(nextButton());

    // Step 2 — Target: the preselected jmap survives (it carries email), and
    // asks only for its own server and account.
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());

    // Step 3 — The migration itself: a name, what to move (email is pinned),
    // how often.
    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme mail' },
    });
    fireEvent.click(nextButton());

    // Step 4 — Review: submit.
    fireEvent.click(nextButton());

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const posted = createMock.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(posted.sourceType).toBe('gmail');
    expect(posted.targetType).toBe('jmap');
    expect(posted.sourceConfig).toMatchObject({
      username: 'owner@gmail.com',
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      refreshToken: '1//mail-refresh',
    });
    // No host fabricated, and no Drive-only root folder either.
    expect(posted.sourceConfig).not.toHaveProperty('host');
    expect(posted.sourceConfig).not.toHaveProperty('rootFolderId');
    expect((posted.syncConfig as { domains: string[] }).domains).toEqual(['email']);
  });

  it('domains beyond email are not offerable for a Gmail source', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Gmail/ }));
    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid' },
    });
    satisfySourceStep();
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'stalwart.acme.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());
    fireEvent.change(screen.getByPlaceholderText('My Migration'), { target: { value: 'x' } });

    // Files is ruled out by the SOURCE even though the target (jmap) carries
    // it: the mail-scoped credential cannot read a Drive.
    const fileCard = screen.getByRole('button', { name: /File/ });
    expect(fileCard).toBeDisabled();
  });
});
