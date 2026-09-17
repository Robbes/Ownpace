// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    discover: vi.fn().mockResolvedValue({}),
    getDiscovery: vi.fn().mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [
        { domain: 'email', collections: 2, items: 10, bytes: 1024, discoveredAt: '2026-01-01T00:00:00Z' },
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

import { ConfirmMigration } from './ConfirmMigration.tsx';
import { mappingApi, type Mapping } from '../services/mapping-service.ts';

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
