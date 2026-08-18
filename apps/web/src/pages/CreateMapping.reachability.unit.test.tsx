// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import CreateMapping from './CreateMapping';
import { connectionsApi, mappingApi } from '../services/mapping-service';

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
    name: 'OAuth2',
    required: [
      CREDS.user,
      [/^Tenant ID/, '11111111-1111-1111-1111-111111111111'],
      [/^Client ID/, '22222222-2222-2222-2222-222222222222'],
      CREDS.secret,
    ],
  },
  {
    name: 'Microsoft Graph',
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
