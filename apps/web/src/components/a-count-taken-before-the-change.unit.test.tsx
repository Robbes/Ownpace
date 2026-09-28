// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT TAKEN BEFORE THE CHANGE (workplan 0150 T3 (d), D5).
 *
 * The start screen names what a migration will not copy while its format can
 * still be chosen. The preflight keeps one row per data type and overwrites
 * it, so a paused migration opened with *Review and start* still holds the
 * rows of its last count. The screen took them as the answer to the count it
 * had just started, stopped asking, and never showed the new one: a Dropbox
 * migration whose owner had just chosen Markdown for its Paper docs was told
 * they would not be copied, with a tick-box for it, under a count taken
 * before the choice.
 *
 * What this holds:
 *
 *  1. A row counted before the migration's last change is waited for, not
 *     shown, and the screen asks again until the new count lands.
 *  2. A refusal in the new count is shown, and Start waits for its tick.
 *  3. An error is shown whatever its age: it is a final answer, and its row
 *     keeps the time of the counts beside it.
 *  4. The migration's time is read afresh, not from the five-minute cache
 *     every other query keeps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../services/mapping-service', () => ({
  mappingApi: {
    discover: vi.fn(),
    getDiscovery: vi.fn(),
    start: vi.fn(),
    get: vi.fn(),
  },
  scopeManifestApi: {
    get: vi.fn().mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] }),
  },
}));

vi.mock('../services/platform-service', () => ({
  fetchPlatformPause: vi.fn().mockResolvedValue({ held: false }),
}));

import { ConfirmMigration, countedSinceChange } from './ConfirmMigration.tsx';
import { mappingApi, type Mapping } from '../services/mapping-service.ts';

/** The migration's last change: the moment its owner chose a format. */
const CHANGED = '2026-09-28T16:00:00Z';
const BEFORE = '2026-09-28T15:50:00Z';
const AFTER = '2026-09-28T16:01:00Z';

const dropbox = (updatedAt: string): Mapping => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Dropbox',
  sourceType: 'dropbox',
  targetType: 'nextcloud',
  sourceConfig: {},
  targetConfig: {},
  syncConfig: { domains: ['file'] },
  status: 'paused',
  mode: 'mirror',
  domainStatus: [],
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt,
});

const files = (discoveredAt: string, over: Record<string, unknown> = {}) => ({
  mappingId: 'm1',
  discovered: true,
  domains: [{ domain: 'file', collections: 3, items: 51, discoveredAt, ...over }],
});

function renderScreen(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmMigration mappingId="m1" onStarted={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** Long enough for the screen's next ask, which comes every two seconds. */
const NEXT_ASK = { timeout: 4000 };

beforeEach(() => {
  vi.mocked(mappingApi.discover).mockReset().mockResolvedValue({} as never);
  vi.mocked(mappingApi.getDiscovery).mockReset();
  vi.mocked(mappingApi.start).mockReset().mockResolvedValue({ id: 'm1', status: 'active' } as never);
  vi.mocked(mappingApi.get).mockReset().mockResolvedValue(dropbox(CHANGED));
});

describe('the rows that answer the count the screen asked for', () => {
  const row = (discoveredAt: string, lastError?: string) => ({
    domain: 'file',
    discoveredAt,
    ...(lastError !== undefined ? { lastError } : {}),
  });

  it('keeps a row counted at or after the change, and drops one counted before it', () => {
    expect(countedSinceChange([row(BEFORE), row(CHANGED), row(AFTER)], CHANGED)).toEqual([
      row(CHANGED),
      row(AFTER),
    ]);
  });

  it('keeps a row with an error whatever its age', () => {
    expect(countedSinceChange([row(BEFORE, 'Dropbox answered 503')], CHANGED)).toEqual([
      row(BEFORE, 'Dropbox answered 503'),
    ]);
  });

  it('keeps every row while the migration’s time is unknown or unreadable', () => {
    for (const changedAt of [undefined, 'not a time']) {
      expect(countedSinceChange([row(BEFORE)], changedAt), String(changedAt)).toEqual([row(BEFORE)]);
    }
  });
});

describe('the start screen after a change', () => {
  it('waits for the new count instead of showing a Paper refusal counted before the format was chosen', async () => {
    vi.mocked(mappingApi.getDiscovery)
      .mockResolvedValueOnce(files(BEFORE, { items: 50, refusedNative: { paper: 2 } }) as never)
      .mockResolvedValue(files(AFTER) as never);

    renderScreen();

    // The new count lands on a screen that is still asking.
    expect(await screen.findByText('51', {}, NEXT_ASK)).toBeInTheDocument();
    expect(mappingApi.getDiscovery).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('50')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: /start migration/i })).not.toBeDisabled();
  });

  it('shows a refusal the new count holds, and Start waits for its tick', async () => {
    vi.mocked(mappingApi.getDiscovery)
      .mockResolvedValueOnce(files(BEFORE, { items: 50 }) as never)
      .mockResolvedValue(files(AFTER, { refusedNative: { paper: 1 } }) as never);

    renderScreen();

    const box = await screen.findByRole('checkbox', {}, NEXT_ASK);
    const start = screen.getByRole('button', { name: /start migration/i });
    expect(start).toBeDisabled();
    fireEvent.click(box);
    expect(start).not.toBeDisabled();
  });

  it('shows an error at once, whatever its age', async () => {
    vi.mocked(mappingApi.getDiscovery).mockResolvedValue(
      files(BEFORE, { lastError: 'Dropbox answered 503 while listing' }) as never,
    );

    renderScreen();

    expect(await screen.findByText('Dropbox answered 503 while listing')).toBeInTheDocument();
  });

  it('reads the migration’s time afresh, not from the five-minute copy', async () => {
    // What `App.tsx` gives every query, and what the migration's own page
    // left in the cache before its owner saved the new format elsewhere.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    qc.setQueryData(['mapping', 'm1'], dropbox(BEFORE));
    vi.mocked(mappingApi.getDiscovery)
      .mockResolvedValueOnce(files('2026-09-28T15:55:00Z', { refusedNative: { paper: 2 } }) as never)
      .mockResolvedValue(files(AFTER) as never);

    renderScreen(qc);

    await waitFor(() => expect(mappingApi.get).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('51', {}, NEXT_ASK)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
