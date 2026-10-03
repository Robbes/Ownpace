// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, BEFORE THE GREEN LIGHT (workplan 0154 T3 (a)), under the count on
 * Review & confirm, and so under each migration's count on *Start a
 * migration*'s last screen, which draws the same section. A range with its
 * reason from Gmail's one published ceiling, *"we will know after the first
 * hour"* for anything else, and nothing while the count is still out: a Gmail
 * mailbox whose size is not in yet would read as the other sentence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiscoveryDomain } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';

vi.mock('../services/mapping-service', () => ({
  mappingApi: { discover: vi.fn(), getDiscovery: vi.fn(), start: vi.fn(), get: vi.fn() },
  scopeManifestApi: {
    get: vi.fn().mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] }),
  },
}));
vi.mock('../services/platform-service', () => ({
  fetchPlatformPause: vi.fn().mockResolvedValue({ held: false }),
}));

import { ConfirmMigration } from './ConfirmMigration.tsx';
import { mappingApi, type Mapping } from '../services/mapping-service.ts';

const mapping = (sourceType: string, domains: Mapping['syncConfig']['domains']): Mapping => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Anna — Gmail to Soverin',
  sourceType,
  targetType: 'soverin',
  sourceConfig: {},
  targetConfig: {},
  syncConfig: { domains },
  status: 'paused',
  mode: 'mirror',
  domainStatus: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
});

const row = (domain: DiscoveryDomain, over: Record<string, unknown> = {}) => ({
  domain,
  collections: 3,
  items: 18_000,
  discoveredAt: '2026-10-03T09:00:00Z',
  ...over,
});

function renderScreen() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ConfirmMigration mappingId="m1" onStarted={vi.fn()} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(mappingApi.discover).mockResolvedValue({});
});
afterEach(() => window.localStorage.removeItem('ownpace.locale'));

describe('how long, under the count', () => {
  it('says the days Gmail’s ceiling takes, and why', async () => {
    vi.mocked(mappingApi.get).mockResolvedValue(mapping('gmail', ['email']));
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [row('email', { bytes: 10.4e9 })],
    });
    renderScreen();
    expect(
      await screen.findByText('About 4 to 5 days, because Google lets a mailbox download 2.5 GB a day.'),
    ).toBeInTheDocument();
  });

  it('in Dutch, with Dutch decimals', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    vi.mocked(mappingApi.get).mockResolvedValue(mapping('gmail', ['email']));
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [row('email', { bytes: 10.4e9 })],
    });
    renderScreen();
    expect(
      await screen.findByText('Ongeveer 4 tot 5 dagen, omdat Google een mailbox 2,5 GB per dag laat downloaden.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Hoe lang:')).toBeInTheDocument();
  });

  it('says the files apart, for a Google account that carries both', async () => {
    vi.mocked(mappingApi.get).mockResolvedValue(mapping('google', ['email', 'file']));
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [row('email', { bytes: 1e9 }), row('file', { bytes: 40e9 })],
    });
    renderScreen();
    const line = await screen.findByText(/Within a day/);
    expect(line.closest('p')?.textContent).toBe(
      'How long: Within a day, because this mailbox holds less than the 2.5 GB a day Google lets one download. The files: we will know after the first hour.',
    );
  });

  /** Hard rule 9: no rate is invented for a provider that publishes none. */
  it('says it will know after the first hour, for a provider with no published ceiling', async () => {
    vi.mocked(mappingApi.get).mockResolvedValue(mapping('dropbox', ['file']));
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [row('file', { bytes: 40e9 })],
    });
    renderScreen();
    expect(await screen.findByText('Depends on the provider; we will know after the first hour.')).toBeInTheDocument();
  });

  it('says nothing while the count is still out', async () => {
    vi.mocked(mappingApi.get).mockResolvedValue(mapping('gmail', ['email', 'calendar']));
    // The calendar has answered; the mail, whose size the line needs, has not.
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue({
      mappingId: 'm1',
      discovered: true,
      domains: [row('calendar')],
    });
    renderScreen();
    await waitFor(() => expect(mappingApi.getDiscovery).toHaveBeenCalled());
    await screen.findByText('18000');
    expect(screen.queryByText('How long:')).not.toBeInTheDocument();
  });
});
