// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Can you actually GET through the wizard? (workplan 0067)
 *
 * `CreateMapping.unit.test.tsx` walks the IMAP path and pins that the walk
 * completes. That is one route through a six-step form whose gates are written
 * by hand, per step, in a switch — and it says nothing about the other seven
 * source types. Two dead ends shipped underneath it:
 *
 *  1. **Box could not be selected at all.** Its source step renders a client
 *     id, a subject user id and a root folder id, and no host — but the step's
 *     gate fell through to the IMAP branch and demanded `sourceHost`, which
 *     nothing on that screen sets. Next was disabled forever, and the line
 *     explaining why named *Host*: a field that is not there.
 *  2. **Reusing a stored connection was unreachable** for every provider whose
 *     identity fields live on step 1. The reuse picker sat on step 3, two steps
 *     after the client id it exists to make unnecessary — and step 3's gate
 *     still demanded the secrets whose inputs the picker had just hidden, so
 *     even reaching it left Next disabled naming invisible fields.
 *
 * Both are the defect the wizard was already fixed for once (0037 T1): *a
 * step's gate must check only the fields that step renders.* The comment
 * saying so is still in the file, a few lines above the switch that stopped
 * obeying it. Rules in comments do not hold; tests do.
 *
 * So: every source type is walked as far as its own first step, and two
 * properties are asserted — Next becomes enabled once what is on screen is
 * filled, and the blocked-reason line never names a field the person cannot
 * see. Adding a source type without adding its row to SOURCE_TYPES is the
 * omission this table exists to make loud.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CreateMapping from './CreateMapping.tsx';
import { connectionsApi, mappingApi } from '../services/mapping-service.ts';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { create: vi.fn(), testConnection: vi.fn() },
  connectionsApi: { list: vi.fn().mockResolvedValue([]), test: vi.fn(), add: vi.fn(), rotate: vi.fn() },
}));

const listMock = vi.mocked(connectionsApi.list);

const renderWizard = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/mappings/new']}>
        <Routes>
          <Route path="/mappings/new" element={<CreateMapping />} />
          <Route path="/mappings/:mappingId/confirm" element={<div>confirm-route</div>} />
          <Route path="/mappings" element={<div>mappings-list-route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const nextButton = () => screen.getByRole('button', { name: /Next|Create Migration/ });

/** The amber line beside a disabled Next, or null when nothing blocks it. */
const blockedReason = () => screen.queryByRole('status')?.textContent ?? null;

/**
 * The wizard's inputs are not associated with their labels (no `htmlFor`/`id`
 * pair — worth fixing, and a bigger change than this one), so a field is found
 * the way a sighted person finds it: the control next to that label. The
 * `<div><label/><input/></div>` shape is consistent across the file, and if it
 * ever is not, this throws by name rather than silently matching nothing.
 */
const fieldFor = (label: RegExp): HTMLElement => {
  const el = screen.getByText(label, { selector: 'label' });
  const control = el.parentElement?.querySelector('input, select, textarea');
  if (!control) throw new Error(`no control beside the label matching ${label}`);
  return control as HTMLElement;
};

const queryFieldFor = (label: RegExp): HTMLElement | null => {
  const els = screen.queryAllByText(label, { selector: 'label' });
  if (els.length === 0) return null;
  return (els[0].parentElement?.querySelector('input, select, textarea') as HTMLElement) ?? null;
};

const fill = (label: RegExp, value: string) =>
  fireEvent.change(fieldFor(label), { target: { value } });

beforeEach(() => {
  // The wizard REMEMBERS its non-secret half across mounts (workplan 0069),
  // which is the feature — and which means every test here starts from
  // whatever the previous one typed unless the draft is cleared. File level,
  // not per-describe: a draft outlives a describe block too. This file was
  // written before that feature existed and went without; the first test to
  // type a provider and a name is what surfaced it (0069 T6, again).
  globalThis.sessionStorage.clear();
  listMock.mockResolvedValue([]);
});

/** Every source card, and the fields ITS first step marks required. */
const CREDS = {
  user: [/^Source Username/, 'anna@acme.example'] as [RegExp, string],
  secret: [/^Source client secret/, 'shh-secret'] as [RegExp, string],
  refresh: [/^Refresh token/, '1//refresh-token'] as [RegExp, string],
};

/**
 * Each side now carries its own credentials (workplan 0070), so a source
 * type's FIRST step demands everything that side needs — not just its
 * provider config. That is the whole point of the restructure and this table
 * is the place it is pinned.
 */
const google = (id: string): [RegExp, string][] => [
  CREDS.user,
  [/^Client ID/, id],
  CREDS.secret,
  CREDS.refresh,
];

const SOURCE_TYPES: { name: string; required: [RegExp, string][] }[] = [
  { name: 'IMAP', required: [CREDS.user, [/^Host$/, 'mail.example.com']] },
  {
    name: 'Via IMAP',
    required: [
      CREDS.user,
      [/^Tenant ID/, '11111111-1111-1111-1111-111111111111'],
      [/^Client ID/, '22222222-2222-2222-2222-222222222222'],
      CREDS.secret,
    ],
  },
  {
    name: 'Via the Graph API',
    required: [
      CREDS.user,
      [/^Tenant ID/, '11111111-1111-1111-1111-111111111111'],
      [/^Client ID/, '22222222-2222-2222-2222-222222222222'],
      CREDS.secret,
    ],
  },
  { name: 'Google Drive', required: google('drive.apps.googleusercontent.com') },
  { name: 'Gmail', required: google('gmail.apps.googleusercontent.com') },
  { name: 'Google Calendar', required: google('gcal.apps.googleusercontent.com') },
  { name: 'Google Contacts', required: google('gcon.apps.googleusercontent.com') },
  // Dropbox calls it an App key on screen, which is what the App Console calls
  // it. The blocked-reason line must call it that too.
  {
    name: 'Dropbox',
    required: [CREDS.user, [/^App key/, 'dropbox-app-key'], CREDS.secret, CREDS.refresh],
  },
  {
    name: 'Box',
    required: [
      CREDS.user,
      [/^Client ID/, 'box-client-id'],
      [/^Box user id/, '12345678'],
      CREDS.secret,
    ],
  },
];

/** Field labels a blocked-reason line is allowed to name, per the strings. */
const GATE_LABELS = [
  'Host',
  'Port',
  'Client ID',
  'Tenant ID',
  'Box user id',
  'App key',
  'Source Username',
  'Source client secret',
  'Refresh token',
];

describe('every source type gets past its own first step', () => {
  it.each(SOURCE_TYPES)('$name', async ({ name, required }) => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

    for (const [label, value] of required) fill(label, value);

    await waitFor(() => expect(nextButton()).toBeEnabled());
  });
});

describe('a disabled Next never names a field that is not on screen', () => {
  it.each(SOURCE_TYPES)('$name', ({ name }) => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

    const reason = blockedReason();
    if (reason === null) return; // nothing blocks it — a real answer

    for (const label of GATE_LABELS) {
      if (!reason.includes(label)) continue;
      expect(
        queryFieldFor(new RegExp(`^${label}`)),
        `the blocked-reason line names "${label}", which this step does not render`,
      ).not.toBeNull();
    }
  });
});

describe('reusing a stored connection', () => {
  const boxConnection = {
    id: 'c0000000-0000-4000-8000-00000000000b',
    role: 'source' as const,
    kind: 'box',
    displayName: 'Acme Box',
    status: 'connected' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
    usedByMailboxes: 1,
  };

  const pickBoxConnection = async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
    // The picker must be HERE, on the step that gates the client id it makes
    // unnecessary. Offering it two steps later is offering it never.
    await waitFor(() => expect(queryFieldFor(/^Use a source connection/)).not.toBeNull());
    fireEvent.change(fieldFor(/^Use a source connection/), {
      target: { value: boxConnection.id },
    });
  };

  beforeEach(() => {
    listMock.mockResolvedValue([boxConnection]);
  });

  it('is offered on the step whose fields it replaces', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /^Box/ }));

    const picker = await waitFor(() => {
      const el = queryFieldFor(/^Use a source connection/);
      expect(el).not.toBeNull();
      return el as HTMLSelectElement;
    });
    expect(picker.textContent).toContain('Acme Box');
  });

  it('lets the step proceed with no credential typed', async () => {
    await pickBoxConnection();
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  it('keeps the per-mapping "where" fields visible (0066 T4a)', async () => {
    await pickBoxConnection();

    // A connection answers "as whom do we sign in". It cannot answer "whose
    // files, and from which folder" — that is this mapping's question, and
    // `source_config_override` exists to hold the answer. Hiding these along
    // with the credentials makes that column unreachable from the UI.
    await waitFor(() => expect(queryFieldFor(/^Box user id/)).not.toBeNull());
    expect(queryFieldFor(/^Root folder id/)).not.toBeNull();

    // ...and the credential is gone, because a field that would be ignored is
    // worse than one that is absent.
    expect(queryFieldFor(/^Client ID/)).toBeNull();
  });

  /**
   * Testing a REUSED connection must probe what is STORED (workplan 0072).
   *
   * It used to post `builtSourceConfig()` — values read out of the form. But
   * choosing a stored connection is precisely what HIDES those inputs, so the
   * form holds empty strings and the probe refused every single time with
   * *clientId, clientSecret, refreshToken are not set*: a complaint about
   * fields the person had deliberately not been asked for. Testing a reused
   * connection could therefore never pass, which makes the reuse path
   * unproveable at exactly the moment somebody wants to prove it.
   *
   * The assertion is about WHICH route is called, because that is the bug:
   * `/connections/:id/test` decrypts and probes the stored credential, and
   * `/migrations/test-connection` can only ever see the empty form.
   */
  it('probes the STORED credential, not the emptied form (0072)', async () => {
    vi.mocked(connectionsApi.test).mockResolvedValue({ ok: true, detail: 'Listed 12 folders.' });
    await pickBoxConnection();

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));

    await waitFor(() => expect(connectionsApi.test).toHaveBeenCalledWith(boxConnection.id));
    // The form-values probe must not be reached at all: with the credential
    // inputs hidden it would post empty strings and refuse by name.
    expect(mappingApi.testConnection).not.toHaveBeenCalled();
    expect(await screen.findByText(/Listed 12 folders/)).toBeTruthy();
  });

  /**
   * A verdict is about ONE credential, and must not outlive it (workplan 0073).
   *
   * Nothing retired a probe result: the green "the credentials still work"
   * from the connection you tested stayed on screen after you picked a
   * different connection, and even after you switched provider entirely. The
   * owner watched a Dropbox verdict sit above a different source type. That is
   * worse than no verdict — it is a verdict about something else, on the one
   * button whose entire job is to be trustworthy.
   */
  it('forgets the probe result when the provider changes (0073)', async () => {
    vi.mocked(connectionsApi.test).mockResolvedValue({ ok: true, detail: 'Listed 12 folders.' });
    await pickBoxConnection();

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));
    expect(await screen.findByText(/Listed 12 folders/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Dropbox/ }));

    expect(
      screen.queryByText(/Listed 12 folders/),
      'a verdict about the Box connection is still on screen under Dropbox',
    ).toBeNull();
  });

  it('forgets it when a DIFFERENT stored connection is picked (0073)', async () => {
    vi.mocked(connectionsApi.test).mockResolvedValue({ ok: true, detail: 'Listed 12 folders.' });
    await pickBoxConnection();

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));
    expect(await screen.findByText(/Listed 12 folders/)).toBeTruthy();

    // Back to "enter new credentials": the verdict belonged to the connection
    // that is no longer selected.
    fireEvent.change(fieldFor(/^Use a source connection/), { target: { value: '' } });

    expect(screen.queryByText(/Listed 12 folders/)).toBeNull();
  });

  it('does not demand, a step later, the secrets it just hid', async () => {
    await pickBoxConnection();
    fireEvent.click(nextButton()); // -> target

    // The target side is untouched by the source's reuse and asks for its own.
    fill(/^Host$/, 'stalwart.acme.example');
    fill(/^Target Username/i, 'anna@acme.net');
    fill(/^Target Password/i, 'target-pw');
    await waitFor(() => expect(nextButton()).toBeEnabled());
    fireEvent.click(nextButton()); // -> migration

    // And the finalise step never mentions a credential at all.
    fill(/^Migration Name/i, 'Acme files');
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });
});


/**
 * The source step asks in ONE order, the descriptor's (workplan 0075).
 *
 * It used to ask in two groups: a hand-written block per provider holding its
 * config, then a shared blue "Credentials" panel holding the account, the
 * secret and the refresh token. On a Drive source that put Client ID, root
 * folder and service-account key BEFORE the account, client secret and
 * refresh token — so the three values that come from one page of the Google
 * console were separated by two fields belonging to neither. The owner
 * reported it three rounds running.
 *
 * Order is the assertion because order is the defect. `credential-fields.ts`
 * has declared the right one since 0063; this pins that the screen obeys it.
 */
describe('the source step asks in the descriptor order', () => {
  /** Every field label on screen, top to bottom. */
  const labelsInOrder = (): string[] =>
    Array.from(document.querySelectorAll('label'))
      .map((l) => (l.textContent ?? '').replace(/\s*\*\s*$/, '').trim())
      .filter(Boolean);

  const orderFor = (card: RegExp): string[] => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: card }));
    return labelsInOrder();
  };

  it('Google Drive: the OAuth trio is contiguous, and the account comes first', () => {
    const labels = orderFor(/^Google Drive/);
    const at = (needle: string) => labels.findIndex((l) => l.startsWith(needle));

    expect(at('Source Username')).toBeGreaterThanOrEqual(0);
    // The account names WHOSE drive this is — it belongs at the top, not
    // below two fields about where the files live.
    expect(at('Source Username')).toBeLessThan(at('Client ID'));
    // Client id → secret → refresh token, with nothing wedged between them:
    // one page of the Google console, one run of fields.
    expect(at('Client ID') + 1).toBe(at('Source client secret'));
    expect(at('Source client secret') + 1).toBe(at('Refresh token'));
    // ...and the per-mapping "where" comes after the credentials, not inside.
    expect(at('Root folder ID')).toBeGreaterThan(at('Refresh token'));
  });

  it('Dropbox: App key sits between the account and the secret', () => {
    const labels = orderFor(/^Dropbox/);
    const at = (needle: string) => labels.findIndex((l) => l.startsWith(needle));

    expect(at('Source Username')).toBeLessThan(at('App key'));
    expect(at('App key') + 1).toBe(at('Source client secret'));
    expect(at('Source client secret') + 1).toBe(at('Refresh token'));
    expect(at('Root folder path')).toBeGreaterThan(at('Refresh token'));
  });

  it('Microsoft 365 via Graph: mailbox, then the registration it signs in with', () => {
    const labels = orderFor(/^Via the Graph API/);
    const at = (needle: string) => labels.findIndex((l) => l.startsWith(needle));

    expect(at('Source Username')).toBeLessThan(at('Tenant ID'));
    expect(at('Tenant ID') + 1).toBe(at('Client ID'));
    expect(at('Client ID') + 1).toBe(at('Source client secret'));
  });
});

/**
 * A red asterisk is a claim about the GATE, and it used to lie (0075 T2).
 *
 * On the Google sources, Client ID and Refresh token were marked required
 * unconditionally, while `sideStepMissing` stops requiring them the moment a
 * service-account key is pasted (ADR-0033's either-flow). So the screen went
 * on demanding two fields that Next no longer wanted — the mirror image of
 * 0067's "Next names a field that is not there", and just as confusing.
 */
describe('the required markers agree with the gate', () => {
  const markedRequired = (): string[] =>
    Array.from(document.querySelectorAll('label'))
      .filter((l) => (l.textContent ?? '').trim().endsWith('*'))
      .map((l) => (l.textContent ?? '').replace(/\s*\*\s*$/, '').trim());

  it('drops the OAuth trio the moment a service-account key is pasted', async () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /^Google Drive/ }));

    expect(markedRequired().some((l) => l.startsWith('Client ID'))).toBe(true);
    expect(markedRequired().some((l) => l.startsWith('Refresh token'))).toBe(true);

    fill(/^Service account key/, '{"type":"service_account"}');

    // The gate stopped wanting them, so the markers must stop claiming them.
    expect(markedRequired().some((l) => l.startsWith('Client ID'))).toBe(false);
    expect(markedRequired().some((l) => l.startsWith('Refresh token'))).toBe(false);
    // The account is still required either way — no connection can know it.
    expect(markedRequired().some((l) => l.startsWith('Source Username'))).toBe(true);

    // And the gate agrees: the account alone now lets the step finish.
    fill(/^Source Username/, 'anna@acme.example');
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });
});


/**
 * Naming the connection you just proved (workplan 0076).
 *
 * Testing is what SAVES a credential (0069 T2), and until now it saved under
 * an auto-name — `dropbox · anna@acme.example` — with no chance to say what it
 * was for and no rename afterwards (0069 T7b). The owner asked for the name at
 * the moment of testing, which is also the moment they know the answer; and
 * separately met two connections carrying the identical auto-name and said it
 * plainly: *that is asking for issues*.
 */
describe('naming the connection that testing saves', () => {
  const filledImapSource = () => {
    renderWizard();
    fill(/^Host$/, 'mail.acme.example');
    fill(/^Source Username/, 'anna@acme.example');
  };

  beforeEach(() => {
    listMock.mockResolvedValue([]);
    vi.mocked(connectionsApi.add).mockResolvedValue({ id: 'new-1', ok: true, detail: 'Reached it.' });
  });

  it('saves under the name that was typed', async () => {
    filledImapSource();
    fill(/^Name this connection/, 'Acme old mail server');

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));

    await waitFor(() =>
      expect(connectionsApi.add).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Acme old mail server' }),
      ),
    );
  });

  it('falls back to what it connects to when left empty', async () => {
    // The behaviour that always existed — a name is an improvement on it, not
    // a new obligation at the end of a long form.
    filledImapSource();

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));

    await waitFor(() =>
      expect(connectionsApi.add).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'imap · anna@acme.example' }),
      ),
    );
  });

  it('warns when the name is already taken, and saves anyway', async () => {
    listMock.mockResolvedValue([
      {
        id: 'c-old',
        role: 'source' as const,
        kind: 'imap',
        displayName: 'Acme old mail server',
        status: 'connected' as const,
        createdAt: '2026-08-01T00:00:00.000Z',
        usedByMailboxes: 1,
      },
    ]);
    filledImapSource();
    fill(/^Name this connection/, 'Acme old mail server');

    // A warning, not a refusal: nothing keys off the name, and blocking here
    // would be friction at the worst moment — you have just proved a credential.
    expect(await screen.findByText(/already have a connection with this name/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Test/i }));
    await waitFor(() => expect(connectionsApi.add).toHaveBeenCalled());
  });

  it('does not ask for a name when a stored connection is being reused', async () => {
    // There is nothing of ours to save, so there is nothing to name.
    listMock.mockResolvedValue([
      {
        id: 'c0000000-0000-4000-8000-00000000000b',
        role: 'source' as const,
        kind: 'imap',
        displayName: 'Acme old mail server',
        status: 'connected' as const,
        createdAt: '2026-08-01T00:00:00.000Z',
        usedByMailboxes: 1,
      },
    ]);
    renderWizard();
    await waitFor(() => expect(queryFieldFor(/^Use a source connection/)).not.toBeNull());
    fireEvent.change(fieldFor(/^Use a source connection/), {
      target: { value: 'c0000000-0000-4000-8000-00000000000b' },
    });

    expect(queryFieldFor(/^Name this connection/)).toBeNull();
  });
});


/**
 * The TARGET step reads the same descriptor (workplan 0075 T4).
 *
 * It had the identical split the source step did — host and port up top, then
 * a separate blue Credentials panel holding the account and the password. The
 * owner never reported it only because they tested sources; the defect is the
 * same one, and leaving one side hand-written is how the two drift.
 */
describe('the target step asks in the descriptor order too', () => {
  it('server, then the account that signs in to it, in one run', () => {
    renderWizard();
    fill(/^Host$/, 'mail.acme.example');
    fill(/^Source Username/, 'anna@acme.example');
    fireEvent.click(nextButton());

    const labels = Array.from(document.querySelectorAll('label'))
      .map((l) => (l.textContent ?? '').replace(/\s*\*\s*$/, '').trim())
      .filter(Boolean);
    const at = (needle: string) => labels.findIndex((l) => l.startsWith(needle));

    expect(at('Host')).toBeGreaterThanOrEqual(0);
    expect(at('Host') + 1).toBe(at('Port'));
    // The account and its password follow the server they sign in to, rather
    // than sitting in a panel of their own below an unrelated field.
    expect(at('Target Username')).toBeGreaterThan(at('Port'));
    expect(at('Target Username') + 1).toBe(at('Target Password'));
  });
});


/**
 * Every field a screen reader can name (workplan 0068 T10).
 *
 * The wizard's inputs had no `htmlFor`/`id` pair, so a screen reader read
 * roughly thirty unlabelled boxes — the owner asked for it after testing on a
 * phone, and it was logged as "~30 mechanical edits, deserves its own change".
 * After 0075 there is ONE input in that file instead of thirty, so it cost
 * four lines. This asserts it by ASKING THE WAY ASSISTIVE TECH DOES —
 * `getByLabelText` resolves through the association, so it cannot be satisfied
 * by a label that merely sits next to a box.
 */
describe('every wizard field is reachable by its label', () => {
  it.each(SOURCE_TYPES)('$name', ({ name, required }) => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));

    for (const [label] of required) {
      // The `$`-anchored patterns above match the LABEL TEXT; the accessible
      // name additionally carries the required marker's " *" (the span is
      // aria-hidden, so a screen reader still says just "Host"). Anchor the
      // start only, or this asserts about punctuation rather than labelling.
      const byName = new RegExp(label.source.replace(/\$$/, ''));
      expect(
        screen.getByLabelText(byName),
        `a screen reader cannot name the ${label} box on a ${name} source`,
      ).toBeTruthy();
    }
  });

  it('the target step too', () => {
    renderWizard();
    fill(/^Host$/, 'mail.acme.example');
    fill(/^Source Username/, 'anna@acme.example');
    fireEvent.click(nextButton());

    expect(screen.getByLabelText(/^Host/)).toBeTruthy();
    expect(screen.getByLabelText(/^Port/)).toBeTruthy();
    expect(screen.getByLabelText(/^Target Username/)).toBeTruthy();
    expect(screen.getByLabelText(/^Target Password/)).toBeTruthy();
  });
});


/**
 * A failing credential is KEPT, and the wizard now says so (0069 T7c).
 *
 * `POST /connections` stores a credential that does not work yet on purpose —
 * somebody mid-setup waiting on an administrator should not lose it (0063 T4).
 * The wizard showed only the provider's refusal, so the storing was invisible,
 * and the reasonable inference from a red panel is that nothing was saved and
 * the whole form has to be retyped. That is the opposite of what happened.
 */
describe('a credential that fails is still kept, and says so', () => {
  const fillImap = () => {
    renderWizard();
    fill(/^Host$/, 'mail.acme.example');
    fill(/^Source Username/, 'anna@acme.example');
  };

  it('says the details were kept when the check fails', async () => {
    vi.mocked(connectionsApi.add).mockResolvedValue({
      id: 'kept-1',
      ok: false,
      reason: 'IMAP said: AUTHENTICATIONFAILED.',
    });
    fillImap();

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));

    // The provider's words, verbatim — and then ours, saying it is not lost.
    expect(await screen.findByText(/AUTHENTICATIONFAILED/)).toBeTruthy();
    expect(screen.getByText(/kept even though the check failed/)).toBeTruthy();
  });

  it('does not claim to have kept anything when the check passes', async () => {
    vi.mocked(connectionsApi.add).mockResolvedValue({
      id: 'kept-2',
      ok: true,
      detail: 'Listed 12 folders.',
    });
    fillImap();

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));

    expect(await screen.findByText(/Listed 12 folders/)).toBeTruthy();
    expect(screen.queryByText(/kept even though the check failed/)).toBeNull();
  });

  it('does not say it about a connection that was only READ', async () => {
    // Reusing a stored connection probes it read-only: there is nothing of
    // ours to have saved, so claiming to have kept something would be a lie.
    vi.mocked(connectionsApi.test).mockResolvedValue({
      ok: false,
      reason: 'Box refused the token request (400): invalid_client.',
    });
    const stored = {
      id: 'c0000000-0000-4000-8000-00000000000b',
      role: 'source' as const,
      kind: 'box',
      displayName: 'Acme Box',
      status: 'connected' as const,
      createdAt: '2026-08-01T00:00:00.000Z',
      usedByMailboxes: 1,
    };
    listMock.mockResolvedValue([stored]);
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: /^Box/ }));
    await waitFor(() => expect(queryFieldFor(/^Use a source connection/)).not.toBeNull());
    fireEvent.change(fieldFor(/^Use a source connection/), { target: { value: stored.id } });

    fireEvent.click(screen.getByRole('button', { name: /Test/i }));

    expect(await screen.findByText(/invalid_client/)).toBeTruthy();
    expect(screen.queryByText(/kept even though the check failed/)).toBeNull();
  });
});
