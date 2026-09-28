// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    discover: vi.fn().mockResolvedValue({}),
    getDiscovery: vi.fn().mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [
        // Counted after the migration's last change (its `updatedAt` below):
        // an older row is not the answer to the count this screen starts.
        { domain: 'email', collections: 2, items: 10, bytes: 1024, discoveredAt: '2026-09-17T00:05:00Z' },
      ],
    }),
    start: vi.fn().mockResolvedValue({ id: 'm1', status: 'active' }),
    // The component reads the mapping to know WHICH domains to wait for.
    // Shaped in the test body where the shape matters; a bare object here
    // keeps the module mock free of a forward reference to `mapping()`.
    get: vi.fn().mockResolvedValue({
      id: 'm1',
      status: 'paused',
      syncConfig: { domains: ['email'] },
      sourceConfig: {},
      targetConfig: {},
      domainStatus: [],
      tenantId: 't1',
      name: 'Acme',
      sourceType: 'google',
      targetType: 'nextcloud',
      mode: 'mirror',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-17T00:00:00Z',
    }),
  },
  scopeManifestApi: {
    get: vi.fn().mockResolvedValue({
      version: 'v1',
      migrates: [{ item: 'Files', detail: 'document libraries' }],
      partial: [{ item: 'Permissions', detail: 'guided' }],
      doesNotMigrate: [{ item: 'Teams chat', detail: 'not migrated' }],
    }),
  },
}));

// The hold the banner reads. Asked only while a count stands refused; open
// here unless a case says otherwise.
vi.mock('../services/platform-service', () => ({
  fetchPlatformPause: vi.fn().mockResolvedValue({ held: true, since: '2026-09-27T09:00:00Z' }),
}));

import { AxiosError, AxiosHeaders } from 'axios';
import { ConfirmMigration } from './ConfirmMigration.tsx';
import { mappingApi, type Mapping } from '../services/mapping-service.ts';
import { fetchPlatformPause } from '../services/platform-service.ts';
import { STRINGS } from '../i18n/strings.ts';

/** A detail payload of the real shape — the component reads `syncConfig`. */
const mapping = (status: Mapping['status']): Mapping => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Acme',
  sourceType: 'google',
  targetType: 'nextcloud',
  sourceConfig: {},
  targetConfig: {},
  syncConfig: { domains: ['email'] },
  status,
  mode: 'mirror',
  domainStatus: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-17T00:00:00Z',
});

/**
 * What every door answers while the operator holds the platform (0132 T6 (b),
 * `enqueueUnlessHeld`): 409, with the operator's own sentence as both
 * `message` and `reason`.
 */
const SENTENCE =
  'We werken het platform bij en kopiëren rond 15:00 weer. Tot die tijd start er niets. Probeer het daarna opnieuw.';

function heldRefusal(): AxiosError {
  const refused = new AxiosError('Request failed with status code 409');
  refused.response = {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'platform_held', message: SENTENCE, reason: SENTENCE, since: '2026-09-27T09:00:00Z' },
  };
  return refused;
}

function renderWithClient(ui: React.ReactElement, qc = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

describe('ConfirmMigration (0013 T6)', () => {
  it('kicks off discovery, shows counts + scope manifest, and starts on the green light', async () => {
    const onStarted = vi.fn();
    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={onStarted} />);

    // Discovery is kicked off on mount (read-only).
    expect(mappingApi.discover).toHaveBeenCalledWith('m1');

    // Counts render once discovery resolves.
    expect(await screen.findByText('Email')).toBeInTheDocument();
    expect(await screen.findByText('10')).toBeInTheDocument();

    // Scope manifest (§11.2) renders, incl. the explicit "does not migrate" list.
    expect(await screen.findByText(/Teams chat/)).toBeInTheDocument();

    // The green light starts the migration and calls back.
    fireEvent.click(screen.getByRole('button', { name: /start migration/i }));
    await waitFor(() => expect(mappingApi.start).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
  });
  it('starts with no extra click when nothing will be refused', async () => {
    // The quiet case, pinned FIRST so the gate below cannot be mistaken for a
    // new hoop in front of every migration. The default discovery mock carries
    // no refusals, which is what almost every migration looks like.
    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);
    expect(await screen.findByText('Email')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /start migration/i })).not.toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('holds Start until the refusals have been acknowledged', async () => {
    // What the owner met on 2026-09-22: twenty Google files that would not be
    // copied, a screen that said so, and a Start button that did not wait to
    // find out whether anybody had read it.
    vi.mocked(mappingApi.getDiscovery).mockResolvedValueOnce({
      mappingId: 'm1',
      discovered: true,
      domains: [
        {
          domain: 'file',
          collections: 2,
          items: 229,
          discoveredAt: '2026-09-22T10:00:00Z',
          refusedNative: { document: 12, spreadsheet: 5 },
        },
      ],
    } as never);

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);

    const box = await screen.findByRole('checkbox');
    const start = screen.getByRole('button', { name: /start migration/i });
    expect(start).toBeDisabled();

    fireEvent.click(box);

    expect(start).not.toBeDisabled();
    fireEvent.click(start);
    await waitFor(() => expect(mappingApi.start).toHaveBeenCalledWith('m1'));
  });
});

describe('the start tells both screens (owner, 2026-09-17)', () => {
  /**
   * *"in the Migrations view it shows Status 'Active' in green. But when i
   * click on it ... i read 'Paused' in yellow and next to that a button
   * 'Review and start'."*
   *
   * `App.tsx` gives every query a five-minute `staleTime`, which is right for
   * a list somebody browses and wrong the moment its subject changes. This
   * press makes the migration `active`; the migration's own page kept
   * answering `paused` from the copy it had fetched before the press, and
   * offered to start a migration that was already running.
   */
  it('invalidates the migration and the list before it navigates', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // What the owner's browser was holding: the page as it was BEFORE the
    // press, fetched when he read the review screen.
    qc.setQueryData(['mapping', 'm1'], mapping('paused'));
    qc.setQueryData(['mappings'], [{ id: 'm1', status: 'paused' }]);
    /**
     * WHAT THE CACHE SAYS AT THE MOMENT OF NAVIGATION, recorded here and
     * asserted in the test body.
     *
     * Two earlier versions of this test were weaker, and both are worth
     * naming. Asserting inside `onStarted` proved nothing: a throw there is
     * swallowed by the mutation, so it passed against code that invalidated
     * nothing at all. Asserting `isInvalidated` on the detail query was wrong
     * in the other direction: this component HOLDS that query, so invalidating
     * it refetches immediately and the flag is clear again by the time the
     * callback runs — false, with the fix in place.
     *
     * What the owner needed is neither flag: it is that the migration's own
     * page stops saying `paused`. So the server answers `paused` once and
     * `active` after, and this reads which one the cache holds.
     */
    vi.mocked(mappingApi.get)
      .mockResolvedValueOnce(mapping('paused'))
      .mockResolvedValue(mapping('active'));
    let atNavigation: Record<string, unknown> = {};
    const onStarted = vi.fn(() => {
      atNavigation = {
        status: (qc.getQueryData(['mapping', 'm1']) as { status?: string } | undefined)?.status,
        listForgotten: qc.getQueryState(['mappings'])?.isInvalidated,
      };
    });

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={onStarted} />, qc);
    await screen.findByText('Email');
    await waitFor(() =>
      expect((qc.getQueryData(['mapping', 'm1']) as { status?: string }).status).toBe('paused'),
    );
    fireEvent.click(screen.getByRole('button', { name: /start migration/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    // The page the navigation lands on reads `active`, and the list — which
    // nothing on this screen is watching — is marked for its next read.
    expect(atNavigation).toEqual({ status: 'active', listForgotten: true });
  });
});

describe('a refused Start says the server’s sentence (0132 T6 (b))', () => {
  /**
   * While the operator holds the platform, *Start* answers 409 with the
   * operator's own sentence, and so do `awaiting_grant` and `grant_withdrawn`
   * with theirs. This screen showed axios's transport text instead, *Request
   * failed with status code 409*, which says neither that nothing started nor
   * why. Every other screen that presses these doors shows the body
   * (`serverMessage`).
   */
  it('shows the operator’s sentence, not the transport’s', async () => {
    vi.mocked(mappingApi.start).mockRejectedValueOnce(heldRefusal());
    const onStarted = vi.fn();

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={onStarted} />);
    await screen.findByText('Email');
    fireEvent.click(screen.getByRole('button', { name: /start migration/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SENTENCE);
    expect(alert).not.toHaveTextContent(/status code 409/);
    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe('a refused count says the server’s sentence too (0132 T6 (b))', () => {
  /**
   * This screen starts the count by itself, on mount, and threw the answer
   * away (`void mappingApi.discover(…)`). While the operator holds the
   * platform, `discover` answers 409 with the operator's sentence like every
   * other door, so the screen went on saying *Scanning your source* over a
   * count that had not started and said nothing else. A refused press is not
   * remembered, so the person has to learn here that nothing is counting.
   */
  it('shows the operator’s sentence when the count it started is refused', async () => {
    vi.mocked(mappingApi.discover).mockRejectedValueOnce(heldRefusal());

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SENTENCE);
    expect(alert).not.toHaveTextContent(/status code 409/);
  });

  it('does not say it is scanning when nothing is counting', async () => {
    vi.mocked(mappingApi.discover).mockRejectedValueOnce(heldRefusal());
    vi.mocked(mappingApi.getDiscovery).mockResolvedValueOnce({
      mappingId: 'm1',
      discovered: false,
      domains: [],
    });

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);

    await screen.findByRole('alert');
    expect(screen.queryByText(STRINGS.en['discovery.scanning'])).toBeNull();
  });

  it('still shows a count that lands anyway', async () => {
    // The door refuses even a press that would only have joined a count begun
    // a moment earlier (`DISCOVERY_JOIN_WINDOW`); that count still lands, and
    // its rows are not hidden behind the refusal.
    vi.mocked(mappingApi.discover).mockRejectedValueOnce(heldRefusal());

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);

    await screen.findByRole('alert');
    expect(await screen.findByText('Email')).toBeInTheDocument();
  });

  it('counts again by itself when the hold that refused it lifts, and says it will', async () => {
    // The operator's sentence says to try again after, and the count has no
    // button: the only thing left to press was *Start*, which with no rows
    // landed skips the refused-files tick. So the screen asks again itself.
    vi.mocked(mappingApi.discover).mockClear();
    vi.mocked(mappingApi.discover).mockRejectedValueOnce(heldRefusal());
    vi.mocked(mappingApi.getDiscovery).mockResolvedValueOnce({ mappingId: 'm1', discovered: false, domains: [] });

    const { qc } = renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SENTENCE);
    await waitFor(() => expect(alert).toHaveTextContent(STRINGS.en['confirm.countAgain']));
    expect(mappingApi.discover).toHaveBeenCalledTimes(1);

    // The banner's next read finds the hold lifted.
    act(() => {
      qc.setQueryData(['platform-pause'], { held: false });
    });

    await waitFor(() => expect(mappingApi.discover).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('Email')).toBeInTheDocument();
  });

  it('does not promise to count again, or ask again, when no hold is open', async () => {
    // Any other refusal (a server fault here) says its own words and stays:
    // with no hold to wait for, asking again would be a loop.
    vi.mocked(mappingApi.discover).mockClear();
    vi.mocked(fetchPlatformPause).mockResolvedValueOnce({ held: false });
    const fault = new AxiosError('Request failed with status code 500');
    fault.response = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'server_fault', message: 'Something went wrong on our side.' },
    };
    vi.mocked(mappingApi.discover).mockRejectedValueOnce(fault);

    renderWithClient(<ConfirmMigration mappingId="m1" onStarted={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(fetchPlatformPause).toHaveBeenCalled());
    expect(alert).not.toHaveTextContent(STRINGS.en['confirm.countAgain']);
    expect(mappingApi.discover).toHaveBeenCalledTimes(1);
  });
});
