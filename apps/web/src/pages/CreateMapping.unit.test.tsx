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
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import CreateMapping from './CreateMapping.tsx';
import {
  mappingApi,
  providerAccountsApi,
  providerClientsApi,
  connectionsApi,
} from '../services/mapping-service.ts';
import type { ProviderAccountFacts } from '../services/mapping-service.ts';

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    create: vi.fn(),
    googleAuthorize: vi.fn(),
    dropboxAuthorize: vi.fn(),
    listSharedDrives: vi.fn(),
    listSharedFolders: vi.fn(),
    listDropboxSharedFolders: vi.fn(),
  },
  // The wizard offers reusable connections (workplan 0064); an empty list is
  // the "nothing to reuse yet" case these walks exercise.
  connectionsApi: {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    rotate: vi.fn(),
    test: vi.fn(),
  },
  // The deployment's own ceiling for a Google ACCOUNT (ADR-0041). Mocked
  // empty: the wizard falls back to the narrow default, which is what an
  // appliance and an undeclared managed deployment both get.
  providerAccountsApi: { get: vi.fn().mockResolvedValue({}) },
  // Which OAuth applications the deployment carries (ADR-0041), one fact
  // per provider since Connect with Dropbox (2026-09-02). Neither by
  // default: every pair in plain view, as on an appliance.
  providerClientsApi: {
    get: vi.fn().mockResolvedValue({ google: 'connection', dropbox: 'connection' }),
  },
}));

const createMock = vi.mocked(mappingApi.create);
const addMock = vi.mocked(connectionsApi.add);
const authorizeMock = vi.mocked(mappingApi.googleAuthorize);

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

  it('a CardDAV target drops the preselected email tick by itself — nothing to deselect, the card says why (owner 2026-09-03)', () => {
    renderWizard();
    walkToDataTypes('CardDAV');

    // email was preselected for the IMAP source and CardDAV cannot receive
    // it: the tick is gone before the person sees the step, so the shared
    // refusal never shows — what shows is the missing-selection line, the
    // Email card unticked and locked, and the note on it.
    expect(nextButton()).toBeDisabled();
    expect(screen.getByRole('status').textContent).not.toContain('cannot receive');
    expect(screen.getByRole('status').textContent).toContain('To continue, fill in:');
    const email = screen.getByRole('button', { name: /Email/ });
    expect(email).toBeDisabled();
    expect(email.textContent).toContain('Not available over the selected target protocol.');

    // What fits is one tick away.
    fireEvent.click(screen.getByRole('button', { name: /Contacts?/ }));
    expect(nextButton()).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('changing the target after ticking drops only what the new target cannot carry, and keeps the rest', () => {
    renderWizard();
    walkToDataTypes('JMAP');
    // JMAP carries email, contacts and files: tick contacts beside the
    // preselected email.
    fireEvent.click(screen.getByRole('button', { name: /Contacts?/ }));
    expect(nextButton()).toBeEnabled();

    // Back to the target step, switch to CardDAV: email falls away on its
    // own, contacts stays ticked, Next stays enabled — no refusal to read,
    // nothing to untick.
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    fireEvent.click(screen.getByRole('button', { name: /^CardDAV/ }));
    fireEvent.change(screen.getAllByPlaceholderText('user@example.com')[0]!, {
      target: { value: 'target@acme.example' },
    });
    fireEvent.change(document.querySelectorAll('input[type="password"]')[0]!, {
      target: { value: 'target-password' },
    });
    fireEvent.click(nextButton());
    expect(screen.getByRole('button', { name: /Email/ })).toBeDisabled();
    expect(nextButton()).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Tasks is a tick of its own, offered over CalDAV and refused over CardDAV (0113 T5)', () => {
    renderWizard();
    walkToDataTypes('CalDAV');
    // The fifth tick, beside Calendar rather than inside it. The owner
    // settled the consequence — *"yes, correct that tasks move with task
    // tick"* — so somebody who wants their to-do lists ticks for them, and
    // somebody who ticks only Calendar gets calendars.
    const tasks = screen.getByRole('button', { name: /Tasks/ });
    expect(tasks).toBeEnabled();
    // And it is genuinely separate state: ticking Tasks leaves Calendar alone.
    // Selection is the blue border the reader sees — these ticks are buttons,
    // not checkboxes, so that class IS the state on screen.
    fireEvent.click(tasks);
    expect(tasks.className).toContain('border-blue-500');
    expect(screen.getByRole('button', { name: /Calendar/ }).className).not.toContain(
      'border-blue-500',
    );
  });

  it('Tasks is not offered over a CardDAV target — a task list is a CALENDAR collection', () => {
    renderWizard();
    walkToDataTypes('CardDAV');
    // CalDAV carries tasks because a task list IS a calendar collection, one
    // that declares VTODO (RFC 4791 §5.2.3). CardDAV is a different protocol
    // and carries neither.
    expect(screen.getByRole('button', { name: /Tasks/ })).toBeDisabled();
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

    fireEvent.click(screen.getByRole('button', { name: /Via the Graph API/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /Via the Graph API/ }));
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
    // Anchored (workplan 0106 T3b): the Google ACCOUNT card's hint names Gmail
    // — deliberately, because "why is Gmail a separate card" is the first
    // question that card raises — so a bare /Gmail/ now matches two buttons.
    // The accessible name starts with the card's own title, so anchoring picks
    // the right one without weakening what is asserted.
    fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
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


describe('CreateMapping — one Google ACCOUNT, several faces (workplan 0106 T3b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeMock.mockResolvedValue({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=x',
      redirectUri: 'https://app.example.test/api/migrations/google/callback',
      scope: 'x',
    } as never);
  });

  const pickAccount = () =>
    fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));

  it('pins the faces the account serves — not email, which needs a scope we have not bought', async () => {
    createMock.mockResolvedValue({ id: 'map-google' } as never);
    renderWizard();
    pickAccount();

    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid.apps.googleusercontent.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'client-secret' },
    });
    fireEvent.change(screen.getByPlaceholderText('1//…'), {
      target: { value: '1//granted' },
    });
    fireEvent.click(nextButton());

    // A target that carries both faces, so the domain step polices nothing
    // away and what is posted is what the account was ticked for.
    fireEvent.click(screen.getByRole('button', { name: /Soverin/ }));
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'dav.soverin.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());

    fireEvent.change(screen.getByPlaceholderText('My Migration'), {
      target: { value: 'Acme Google' },
    });
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const posted = createMock.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(posted.sourceType).toBe('google');
    // THE TRIO TRAVELS, AND NOTHING SERVER-SHAPED DOES. Until 2026-09-02 the
    // account kind fell through to the host/port/password default, so the
    // owner's first consented account was stored without its token and the
    // first test said "missing refreshToken" about a token the consent had
    // just handed over.
    expect(posted.sourceConfig).toMatchObject({
      username: 'owner@example.invalid',
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      refreshToken: '1//granted',
    });
    expect(posted.sourceConfig).not.toHaveProperty('host');
    expect(posted.sourceConfig).not.toHaveProperty('password');
    const domains = (posted.syncConfig as { domains: string[] }).domains;
    expect(domains).toEqual(['calendar', 'contact']);
    // The two Google prices differently, and the refusal for them lives on
    // the server. The wizard must not even offer them here.
    expect(domains).not.toContain('email');
    expect(domains).not.toContain('file');
  });

  it('consents for exactly the faces ticked — a domain SET, never a source type', async () => {
    // The whole of T3b in one assertion. `domainsToScopes` has refused to
    // substitute anything for an empty tick set since T1b and said callers
    // must refuse rather than default; this is the caller reaching it, and a
    // `sourceType` here would silently ask for one fixed scope instead.
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      renderWizard();
      pickAccount();
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@example.invalid' },
      });
      fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
        target: { value: 'cid.apps.googleusercontent.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('••••••••'), {
        target: { value: 'client-secret' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Connect with Google/i }));
      await waitFor(() => expect(authorizeMock).toHaveBeenCalled());
      const sent = authorizeMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(sent.domains).toEqual(['calendar', 'contact']);
      expect(sent).not.toHaveProperty('sourceType');
      expect(sent.clientId).toBe('cid.apps.googleusercontent.com');
      // The secret goes in the BODY and never into a URL — the popup is
      // opened with the server's answer, which carries no secret.
      expect(String(open.mock.calls[0]?.[0] ?? '')).not.toContain('client-secret');
    } finally {
      open.mockRestore();
    }
  });

  it('refuses to consent for nothing, and says what to do instead', async () => {
    renderWizard();
    pickAccount();
    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid.apps.googleusercontent.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'client-secret' },
    });
    // Untick both on the migration step, then come back: an empty tick set is
    // reachable, and the server refuses it with a sentence. The button says
    // the same thing sooner, rather than spending a round trip to be told.
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: '1//granted' } });
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: /Soverin/ }));
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'dav.soverin.example' },
    });
    satisfyTargetStep();
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: /Calendar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Contacts/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    const connect = screen.getByRole('button', { name: /Connect with Google/i });
    expect(connect).toBeDisabled();
    expect(connect).toHaveAttribute(
      'title',
      expect.stringContaining('Tick what to migrate first'),
    );
    expect(authorizeMock).not.toHaveBeenCalled();
  });
});

describe('CreateMapping — the deployment carries its own Google client (ADR-0041)', () => {
  // The fact the screen could not see: #703 made the server accept a consent
  // and a create without a client id and secret when GOOGLE_OAUTH_CLIENT_* is
  // set, and left the wizard demanding both. It reads the answer from the
  // same route as the domains, and the same default applies until it
  // arrives: ask for the pair, the direction that cannot under-ask.
  const consentAnswer = {
    url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=x',
    redirectUri: 'https://app.example.test/api/migrations/google/callback',
    scope: 'x',
  };
  const facts: ProviderAccountFacts = { google: { domains: ['calendar', 'contact'] } };
  // The client fact has a route of its own since Connect with Dropbox
  // (2026-09-02): one answer per provider, and Google's is not Dropbox's.
  const clients = (google: 'deployment' | 'connection') =>
    ({ google, dropbox: 'connection' }) as const;

  beforeEach(() => {
    vi.clearAllMocks();
    authorizeMock.mockResolvedValue(consentAnswer as never);
    vi.mocked(providerAccountsApi.get).mockResolvedValue(facts);
    vi.mocked(providerClientsApi.get).mockResolvedValue(clients('deployment'));
  });
  afterEach(() => {
    // `clearAllMocks` keeps implementations; put the module defaults back so
    // the describes after this one see a deployment that answers nothing.
    vi.mocked(providerAccountsApi.get).mockResolvedValue({});
    vi.mocked(providerClientsApi.get).mockResolvedValue(clients('connection'));
  });

  const pickGmail = () => fireEvent.click(screen.getByRole('button', { name: /^Gmail/ }));
  const connectButton = () => screen.getByRole('button', { name: /Connect with Google/i });

  it('stops asking for the pair: the consent works with both fields empty, and Next needs only the account and its token', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      renderWizard();
      pickGmail();
      // The address first (2026-09-02): the consent saves and tests in one go.
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@gmail.com' },
      });
      // The answer comes over the wire; until it does the pair is demanded.
      await waitFor(() => expect(connectButton()).toBeEnabled());
      // The pair is FOLDED AWAY, not merely optional (owner remark
      // 2026-09-02): both boxes live inside one collapsed disclosure that
      // says what it is for, and the sentence about the deployment's client
      // is in there with them. The default screen is the address, the token
      // and the button.
      const fold = screen.getByText('Use your own Google application instead').closest('details');
      expect(fold).not.toBeNull();
      expect(fold).toContainElement(screen.getByPlaceholderText('…apps.googleusercontent.com'));
      expect(fold).toContainElement(screen.getByPlaceholderText('••••••••'));
      expect(fold).toHaveTextContent(/has its own Google client/);
      // …and the token box with them (owner's second remark, after the first
      // round trip): on this path the token comes from the button, so a box
      // with an asterisk above the fold asked for what the button supplies.
      expect(fold).toContainElement(screen.getByPlaceholderText('1//…'));
      // The address stays in plain view — it is what the fold is not about.
      expect(screen.getByPlaceholderText('user@example.com').closest('details')).toBeNull();

      fireEvent.click(connectButton());
      await waitFor(() => expect(authorizeMock).toHaveBeenCalled());
      const sent = authorizeMock.mock.calls[0]![0] as Record<string, unknown>;
      // ABSENT, not empty strings — the route's schema refuses an empty one.
      expect(sent).not.toHaveProperty('clientId');
      expect(sent).not.toHaveProperty('clientSecret');
      expect(sent.sourceType).toBe('gmail');

      // The token is still this account's to give — it says whose mail.
      expect(nextButton()).toBeDisabled();
      fireEvent.change(screen.getByPlaceholderText('1//…'), {
        target: { value: '1//mail-refresh' },
      });
      expect(nextButton()).toBeEnabled();
    } finally {
      open.mockRestore();
    }
  });

  it('the account kind ticks its faces on this step, and a consent that lands saves and tests in one go', async () => {
    // 2026-09-02, the owner's walk: the account kind's consent waited for
    // ticks that lived two steps on, behind the gate this button is the way
    // through — a dead end. And a consent that landed left the person on the
    // same screen with the same button, which read as nothing happening.
    addMock.mockResolvedValue({ ok: true, id: 'conn-google', detail: 'reachable' } as never);
    // The wizard remembers its draft across mounts (0069); an earlier walk's
    // ticks would enable the button before this one ticked anything.
    window.localStorage.clear();
    window.sessionStorage.clear();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      renderWizard();
      fireEvent.click(screen.getByRole('button', { name: /^Google account/ }));
      await waitFor(() => expect(screen.getByText('What this account will serve')).toBeTruthy());
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@gmail.com' },
      });
      // The deployment's ceiling arrives pre-ticked (calendar and contacts
      // here), and the ticks are the same state the migration step shows —
      // so they can be read and changed HERE, before the consent asks.
      expect(screen.getByLabelText('Calendar')).toBeChecked();
      expect(screen.getByLabelText('Contacts')).toBeChecked();
      fireEvent.click(screen.getByLabelText('Calendar'));
      fireEvent.click(screen.getByLabelText('Contacts'));
      // Nothing ticked: nothing to ask Google for.
      await waitFor(() => expect(connectButton()).toBeDisabled());
      fireEvent.click(screen.getByLabelText('Calendar'));
      await waitFor(() => expect(connectButton()).toBeEnabled());
      fireEvent.click(connectButton());
      await waitFor(() => expect(authorizeMock).toHaveBeenCalled());
      expect(authorizeMock.mock.calls[authorizeMock.mock.calls.length - 1]![0]).toEqual({ domains: ['calendar'] });

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ownpace-google-consent', refreshToken: '1//landed' },
          origin: window.location.origin,
        }),
      );
      // Saved and tested without another press: the probe that Test runs.
      await waitFor(() => expect(addMock).toHaveBeenCalled());
      const saved = addMock.mock.calls[addMock.mock.calls.length - 1]![0];
      expect(saved.type).toBe('google');
      expect(saved.values).toMatchObject({ username: 'owner@gmail.com', refreshToken: '1//landed' });
      expect(saved.values).not.toHaveProperty('host');
    } finally {
      open.mockRestore();
    }
  });

  it('takes the pair only as a whole: one half typed asks for the other, never for the deployment to complete it', async () => {
    renderWizard();
    pickGmail();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@gmail.com' },
    });
    await waitFor(() => expect(connectButton()).toBeEnabled());

    fireEvent.change(screen.getByPlaceholderText('…apps.googleusercontent.com'), {
      target: { value: 'cid.apps.googleusercontent.com' },
    });
    expect(connectButton()).toBeDisabled();
    expect(connectButton()).toHaveAttribute('title', expect.stringContaining('or neither'));
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@gmail.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('1//…'), {
      target: { value: '1//mail-refresh' },
    });
    // Half a pair gates Next too: the secret completes it, or the id goes.
    expect(nextButton()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'client-secret' },
    });
    expect(connectButton()).toBeEnabled();
    expect(nextButton()).toBeEnabled();
  });

  it('keeps demanding the pair where the deployment says each connection brings its own', async () => {
    vi.mocked(providerClientsApi.get).mockResolvedValue(clients('connection'));
    renderWizard();
    pickGmail();
    await waitFor(() => expect(providerClientsApi.get).toHaveBeenCalled());
    // Let the resolved answer land before asserting on what it did not change.
    await act(async () => {});

    expect(connectButton()).toBeDisabled();
    expect(connectButton()).toHaveAttribute(
      'title',
      expect.stringContaining('Enter the Client ID and client secret first'),
    );
    expect(screen.queryByText(/has its own Google client/)).not.toBeInTheDocument();
    // And no fold: the pair is required here, so it is in plain view.
    expect(screen.queryByText('Use your own Google application instead')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('…apps.googleusercontent.com').closest('details')).toBeNull();
  });

  it('the Drive browse works on the token alone, and sends no empty pair', async () => {
    // The browse behind rootFolderId used to gate on the pair too, and its
    // routes demanded all three. Same rule as the consent now: the pair as
    // a whole or not at all, and the deployment's when absent.
    vi.mocked(mappingApi.listSharedDrives).mockResolvedValue({ ok: true, drives: [] });
    vi.mocked(mappingApi.listSharedFolders).mockResolvedValue({ ok: true, folders: [] });
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));
    const browse = screen.getByRole('button', { name: /Browse shared drives/ });
    expect(browse).toBeDisabled(); // no token yet, whatever the deployment has
    fireEvent.change(screen.getByPlaceholderText('1//…'), {
      target: { value: '1//drive-refresh' },
    });
    await waitFor(() => expect(browse).toBeEnabled());

    fireEvent.click(browse);
    await waitFor(() => expect(mappingApi.listSharedDrives).toHaveBeenCalled());
    const sent = vi.mocked(mappingApi.listSharedDrives).mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.refreshToken).toBe('1//drive-refresh');
    expect(sent).not.toHaveProperty('clientId');
    expect(sent).not.toHaveProperty('clientSecret');
  });
});

describe('CreateMapping — the deployment carries its own Dropbox app (Connect with Dropbox, 2026-09-02)', () => {
  // The owner's ask: "add the grant button for Dropbox, similar to how we now
  // have Google". The same fold, the same one-go save-and-test, Dropbox's
  // words — and which sources have a button is the descriptor's answer
  // (`consent` on the token field), so no list in the wizard grew by one.
  const dropboxAuthorize = vi.mocked(mappingApi.dropboxAuthorize);
  const clients = (dropbox: 'deployment' | 'connection') =>
    ({ google: 'connection', dropbox }) as const;

  beforeEach(() => {
    vi.clearAllMocks();
    dropboxAuthorize.mockResolvedValue({
      url: 'https://www.dropbox.com/oauth2/authorize?client_id=x&token_access_type=offline',
      redirectUri: 'https://app.example.test/api/migrations/dropbox/callback',
    });
    vi.mocked(providerClientsApi.get).mockResolvedValue(clients('deployment'));
  });
  afterEach(() => {
    vi.mocked(providerClientsApi.get).mockResolvedValue(clients('connection'));
  });

  const pickDropbox = () => fireEvent.click(screen.getByRole('button', { name: /^Dropbox/ }));
  const connectButton = () => screen.getByRole('button', { name: /Connect with Dropbox/i });

  it('folds the App key pair away, consents without it, and a consent that lands saves and tests in one go', async () => {
    addMock.mockResolvedValue({ ok: true, id: 'conn-dropbox', detail: 'reachable' } as never);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      renderWizard();
      pickDropbox();
      fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
        target: { value: 'owner@example.invalid' },
      });
      await waitFor(() => expect(connectButton()).toBeEnabled());
      expect(screen.queryByRole('button', { name: /Connect with Google/i })).toBeNull();
      const fold = screen.getByText('Use your own Dropbox app instead').closest('details');
      expect(fold).not.toBeNull();
      expect(fold).toHaveTextContent(/has its own Dropbox app/);
      expect(fold).toContainElement(screen.getByLabelText(/App key/));
      expect(fold).toContainElement(screen.getByPlaceholderText('••••••••'));
      expect(fold).toContainElement(screen.getByPlaceholderText('1//…'));
      // The account stays in plain view — it is what the fold is not about.
      expect(screen.getByPlaceholderText('user@example.com').closest('details')).toBeNull();

      fireEvent.click(connectButton());
      await waitFor(() => expect(dropboxAuthorize).toHaveBeenCalled());
      // ABSENT, not empty strings — the route's schema refuses an empty one —
      // and Dropbox's route, never Google's.
      expect(dropboxAuthorize.mock.calls[0]![0]).toEqual({});
      expect(authorizeMock).not.toHaveBeenCalled();
      expect(open.mock.calls[0]?.[1]).toBe('ownpace-dropbox-consent');

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ownpace-dropbox-consent', refreshToken: 'dbx-landed' },
          origin: window.location.origin,
        }),
      );
      // Saved and tested without another press: the probe that Test runs.
      await waitFor(() => expect(addMock).toHaveBeenCalled());
      const saved = addMock.mock.calls[addMock.mock.calls.length - 1]![0];
      expect(saved.type).toBe('dropbox');
      expect(saved.values).toMatchObject({
        username: 'owner@example.invalid',
        refreshToken: 'dbx-landed',
      });
      expect(saved.values).not.toHaveProperty('host');
    } finally {
      open.mockRestore();
    }
  });

  it('takes the pair only as a whole: one half typed asks for the other, and Next waits with it', async () => {
    renderWizard();
    pickDropbox();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    await waitFor(() => expect(connectButton()).toBeEnabled());

    fireEvent.change(screen.getByLabelText(/App key/), { target: { value: 'dbx-app-key' } });
    expect(connectButton()).toBeDisabled();
    expect(connectButton()).toHaveAttribute('title', expect.stringContaining('or neither'));
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: 'dbx-refresh' } });
    expect(nextButton()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'dbx-app-secret' },
    });
    expect(connectButton()).toBeEnabled();
    expect(nextButton()).toBeEnabled();
    fireEvent.click(connectButton());
    await waitFor(() => expect(dropboxAuthorize).toHaveBeenCalled());
    expect(dropboxAuthorize.mock.calls[0]![0]).toEqual({
      clientId: 'dbx-app-key',
      clientSecret: 'dbx-app-secret',
    });
  });

  it('keeps demanding the pair where the deployment carries a Google client but no Dropbox app', async () => {
    // The fact is per provider: Google's client is not Dropbox's app.
    vi.mocked(providerClientsApi.get).mockResolvedValue({ google: 'deployment', dropbox: 'connection' });
    renderWizard();
    pickDropbox();
    await waitFor(() => expect(providerClientsApi.get).toHaveBeenCalled());
    await act(async () => {});

    expect(connectButton()).toBeDisabled();
    expect(connectButton()).toHaveAttribute(
      'title',
      expect.stringContaining('Enter the App key and App secret first'),
    );
    expect(screen.queryByText('Use your own Dropbox app instead')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/App key/).closest('details')).toBeNull();
  });

  it('waits for the account address before offering the consent (the owner’s walk, 2026-09-02)', async () => {
    renderWizard();
    pickDropbox();
    await waitFor(() => expect(providerClientsApi.get).toHaveBeenCalled());
    await act(async () => {});
    // The sentence changes once the deployment's answer ("it carries the
    // app") has landed; under a loaded full run that is a tick later than
    // the call itself, so the assertion waits for the sentence rather than
    // for the call (2026-09-03: one red in 5768 with nothing else changed).
    await waitFor(() =>
      expect(connectButton()).toHaveAttribute(
        'title',
        expect.stringContaining('Enter the account address first'),
      ),
    );
    expect(connectButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    await waitFor(() => expect(connectButton()).toBeEnabled());
  });

  it('says when the door answered before the measuring finished (2026-09-02)', async () => {
    addMock.mockResolvedValue({
      ok: true,
      id: 'conn-dropbox',
      detail: 'reachable',
      qualificationPending: true,
    } as never);
    renderWizard();
    pickDropbox();
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'owner@example.invalid' },
    });
    fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: 'dbx-refresh' } });
    fireEvent.click(screen.getByRole('button', { name: /Test and save connections/ }));
    await waitFor(() => expect(addMock).toHaveBeenCalled());
    expect(await screen.findByText(/Still measuring what this account can carry/)).toBeTruthy();
  });

  it('the folder browse works on the token alone, and sends no empty pair', async () => {
    // The browse behind rootPath gated on the pair and its route demanded
    // all three, so behind the fold it stayed dead — the Drive browse's
    // lesson, learnt once more for Dropbox.
    vi.mocked(mappingApi.listDropboxSharedFolders).mockResolvedValue({ ok: true, folders: [] });
    renderWizard();
    pickDropbox();
    const browse = screen.getByRole('button', { name: /Browse shared folders/ });
    expect(browse).toBeDisabled(); // no token yet, whatever the deployment has
    fireEvent.change(screen.getByPlaceholderText('1//…'), { target: { value: 'dbx-refresh' } });
    await waitFor(() => expect(browse).toBeEnabled());

    fireEvent.click(browse);
    await waitFor(() => expect(mappingApi.listDropboxSharedFolders).toHaveBeenCalled());
    const sent = vi.mocked(mappingApi.listDropboxSharedFolders).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(sent.refreshToken).toBe('dbx-refresh');
    expect(sent).not.toHaveProperty('clientId');
    expect(sent).not.toHaveProperty('clientSecret');
  });
});

/**
 * THE PROVIDER DIRECTORY (0106 T5; owner 2026-09-03, after finding Soverin's
 * help page by hand: "can we add the default already, like servers and
 * ports?"). Picking a named provider's card fills what its help page
 * publishes; only what is ours ever moves — a blank box, or one still at the
 * previous pick's default — and Test measures the boxes like anything typed.
 */
describe('the provider directory pre-fills a named provider’s boxes', () => {
  const toTargetStep = () => {
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), {
      target: { value: 'mail.old-provider.example' },
    });
    satisfySourceStep();
    fireEvent.click(nextButton());
  };

  it('picking Soverin fills its DAV host, mail host and both ports, and says whose they are', () => {
    toTargetStep();
    fireEvent.click(screen.getByRole('button', { name: /^Soverin/ }));
    expect(screen.getByPlaceholderText('jmap.example.com')).toHaveValue('caldav.soverin.net');
    expect(screen.getByDisplayValue('443')).toBeTruthy();
    expect(screen.getByPlaceholderText('imap.example.com')).toHaveValue('imap.soverin.net');
    expect(screen.getByDisplayValue('993')).toBeTruthy();
    expect(
      screen.getByText(/Pre-filled from Soverin’s published settings, read \d{4}-\d{2}-\d{2}\./),
    ).toBeTruthy();
  });

  it('a typed box is never overwritten — not by the pick, not by a pick after a pick', () => {
    toTargetStep();
    fireEvent.change(screen.getByPlaceholderText('jmap.example.com'), {
      target: { value: 'dav.mine.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Soverin/ }));
    expect(screen.getByPlaceholderText('jmap.example.com')).toHaveValue('dav.mine.example');
    // The blank mail host still takes the default beside the typed DAV host.
    expect(screen.getByPlaceholderText('imap.example.com')).toHaveValue('imap.soverin.net');
    fireEvent.click(screen.getByRole('button', { name: /^JMAP/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Soverin/ }));
    expect(screen.getByPlaceholderText('jmap.example.com')).toHaveValue('dav.mine.example');
  });

  it('leaving Soverin empties the boxes still at its defaults; the port falls back to the wizard’s own 443', () => {
    toTargetStep();
    fireEvent.click(screen.getByRole('button', { name: /^Soverin/ }));
    fireEvent.click(screen.getByRole('button', { name: /^JMAP/ }));
    expect(screen.getByPlaceholderText('jmap.example.com')).toHaveValue('');
    expect(screen.getByDisplayValue('443')).toBeTruthy();
    expect(screen.queryByDisplayValue('imap.soverin.net')).toBeNull();
    expect(screen.queryByText(/Pre-filled from/)).toBeNull();
  });
});
