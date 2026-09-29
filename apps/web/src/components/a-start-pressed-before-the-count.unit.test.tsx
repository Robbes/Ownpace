// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A START PRESSED BEFORE THE COUNT (the owner, 2026-09-28: *"Hold, up to 15
 * min"*).
 *
 * The start screen counts what the source holds, and names what a format
 * would refuse, with a tick-box. Start did not wait for it. The owner pressed
 * it at 17:23 on a Dropbox migration, and the count, with its Paper line and
 * its tick-box, landed at 17:30: the screen had stopped asking at five minutes,
 * and the migration was already copying.
 *
 * What this holds:
 *
 *  1. While a count the screen waits for is still coming, Start is greyed
 *     out and a line beside it says why; once the count lands, Start opens and
 *     the line goes. A data type that answered with an error has answered.
 *  2. After five minutes the screen keeps asking, more slowly, so a count that
 *     lands at seven minutes is shown, and Start opens for it.
 *  3. After fifteen minutes the screen stops asking, and Start opens with a
 *     line saying the count did not finish.
 *  4. Nothing holds Start when nothing is counting: a refused count, or a
 *     migration that cannot be read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';

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
  fetchPlatformPause: vi.fn().mockResolvedValue({ held: true, since: '2026-09-28T17:00:00Z' }),
}));

import { ConfirmMigration } from './ConfirmMigration.tsx';
import { mappingApi, type Mapping } from '../services/mapping-service.ts';
import { STRINGS } from '../i18n/strings.ts';

/** When the owner pressed Start. The screen opens at this moment here. */
const OPENED = Date.parse('2026-09-28T17:23:00Z');
const MINUTE = 60_000;
/** The migration's last change, before the screen opened. */
const CHANGED = '2026-09-28T17:20:00Z';

const migration = (domains: Mapping['syncConfig']['domains']): Mapping => ({
  id: 'm1',
  tenantId: 't1',
  name: 'Dropbox',
  sourceType: 'dropbox',
  targetType: 'nextcloud',
  sourceConfig: {},
  targetConfig: {},
  syncConfig: { domains },
  status: 'paused',
  mode: 'mirror',
  domainStatus: [],
  createdAt: '2026-09-25T00:00:00Z',
  updatedAt: CHANGED,
});

const NOTHING_YET = { mappingId: 'm1', discovered: false, domains: [] };
const row = (domain: string, over: Record<string, unknown> = {}) => ({
  domain,
  collections: 320,
  items: 55245,
  discoveredAt: new Date(Date.now()).toISOString(),
  ...over,
});
const landed = (...rows: ReturnType<typeof row>[]) => ({ mappingId: 'm1', discovered: true, domains: rows });

const WAITS = STRINGS.en['confirm.startWaits'];
const UNFINISHED = STRINGS.en['confirm.countUnfinished'];

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmMigration mappingId="m1" onStarted={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * Lets the screen's own timers run for `ms`, and what they fetched land: an
 * answer reaches the screen a moment after the ask, not in the same instant.
 */
async function after(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

const start = () => screen.getByRole('button', { name: STRINGS.en['confirm.start'] });
const asks = () => vi.mocked(mappingApi.getDiscovery).mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers({ now: OPENED });
  vi.mocked(mappingApi.discover).mockReset().mockResolvedValue({} as never);
  vi.mocked(mappingApi.getDiscovery).mockReset().mockResolvedValue(NOTHING_YET as never);
  vi.mocked(mappingApi.start).mockReset().mockResolvedValue({ id: 'm1', status: 'active' } as never);
  vi.mocked(mappingApi.get).mockReset().mockResolvedValue(migration(['file']));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Start, while the count is still coming', () => {
  it('is greyed out, says why, and opens when the count lands', async () => {
    vi.mocked(mappingApi.getDiscovery)
      .mockResolvedValueOnce(NOTHING_YET as never)
      .mockResolvedValueOnce(NOTHING_YET as never)
      .mockImplementation(async () => landed(row('file')) as never);

    renderScreen();
    await after(0);

    expect(start()).toBeDisabled();
    expect(start()).toHaveAccessibleDescription(WAITS);

    await after(4000);

    expect(screen.getByText('55245')).toBeInTheDocument();
    expect(start()).not.toBeDisabled();
    expect(screen.queryByText(WAITS)).toBeNull();
    expect(screen.queryByText(UNFINISHED)).toBeNull();
  });

  it('waits for every data type the migration carries, and an error is an answer', async () => {
    vi.mocked(mappingApi.get).mockResolvedValue(migration(['email', 'calendar']));
    vi.mocked(mappingApi.getDiscovery)
      .mockResolvedValueOnce(landed(row('email')) as never)
      .mockImplementation(
        async () => landed(row('email'), row('calendar', { lastError: 'Google answered 503' })) as never,
      );

    renderScreen();
    await after(0);

    // Email has landed; the calendar has not.
    expect(start()).toBeDisabled();

    await after(2000);

    expect(screen.getByText('Google answered 503')).toBeInTheDocument();
    expect(start()).not.toBeDisabled();
  });
});

describe('after five minutes', () => {
  it('keeps asking, more slowly, and a count that lands at seven minutes opens Start', async () => {
    vi.mocked(mappingApi.getDiscovery).mockImplementation(
      async () => (Date.now() >= OPENED + 7 * MINUTE ? landed(row('file')) : NOTHING_YET) as never,
    );

    renderScreen();
    await after(5 * MINUTE);
    const atFive = asks();
    // Every two seconds until now.
    expect(atFive).toBeGreaterThan(140);

    await after(MINUTE);

    // Every ten seconds from here, not every two, and still asking.
    expect(asks() - atFive).toBeGreaterThanOrEqual(5);
    expect(asks() - atFive).toBeLessThanOrEqual(7);
    expect(start()).toBeDisabled();

    await after(MINUTE + 10_000);

    expect(screen.getByText('55245')).toBeInTheDocument();
    expect(start()).not.toBeDisabled();
    expect(screen.queryByText(UNFINISHED)).toBeNull();

    // And, with every data type in, it stops asking.
    const done = asks();
    await after(MINUTE);
    expect(asks()).toBe(done);
  });
});

describe('after fifteen minutes', () => {
  it('stops asking, and opens Start with a line saying the count did not finish', async () => {
    renderScreen();

    await after(14 * MINUTE);
    expect(start()).toBeDisabled();
    expect(screen.queryByText(UNFINISHED)).toBeNull();

    await after(MINUTE + 15_000);

    expect(start()).not.toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(UNFINISHED);
    expect(screen.queryByText(WAITS)).toBeNull();

    const stopped = asks();
    await after(5 * MINUTE);
    expect(asks()).toBe(stopped);
  });
});

describe('nothing holds Start when nothing is counting', () => {
  it('a count refused while the operator holds the platform', async () => {
    const refused = new AxiosError('Request failed with status code 409');
    refused.response = {
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error: 'platform_held', message: 'Copying resumes at 15:00.', reason: 'Copying resumes at 15:00.' },
    };
    vi.mocked(mappingApi.discover).mockRejectedValue(refused);

    renderScreen();
    await after(0);

    expect(screen.getByRole('alert')).toHaveTextContent('Copying resumes at 15:00.');
    expect(start()).not.toBeDisabled();
    expect(screen.queryByText(WAITS)).toBeNull();
  });

  it('a migration that cannot be read, so the screen cannot know what to wait for', async () => {
    vi.mocked(mappingApi.get).mockRejectedValue(new Error('the migration could not be read'));

    renderScreen();
    await after(0);

    expect(start()).not.toBeDisabled();
    expect(screen.queryByText(WAITS)).toBeNull();
  });
});
