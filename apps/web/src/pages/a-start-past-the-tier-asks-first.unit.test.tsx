// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A START PAST THE TIER ASKS FIRST, ON THE CHECK SCREEN (workplan 0109 T6, the
 * path axis; the owner, 2026-10-04: *"side by side"*, *"enforced by the
 * server"*).
 *
 * When *Start* would run more at the same time than the organisation's tier
 * runs, the server refuses it, so the screen asks before the press: the plain
 * *Start* gives way to the two ways on, and *Start what fits now* starts only
 * those, leaving the rest set up. Within the tier, *Start* is as it was. The
 * question itself is held in `../components/PathsAtStart.unit.test.tsx`.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckStep } from './StartMigration.tsx';
import type { PlannedMigration } from '../services/start-plan.ts';
import { personLinkApi } from '../services/grant-link-service.ts';
import { mappingApi, scopeManifestApi } from '../services/mapping-service.ts';
import { billingApi, type PathsAtStart } from '../services/billing-service.ts';

const { authState } = vi.hoisted(() => ({ authState: { user: { role: 'owner' } as null | { role: string } } }));

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));
vi.mock('../services/grant-link-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/grant-link-service.ts')>()),
  personLinkApi: { list: vi.fn(), issue: vi.fn(), revoke: vi.fn() },
}));
vi.mock('../services/mapping-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/mapping-service.ts')>()),
  mappingApi: { create: vi.fn(), start: vi.fn(), discover: vi.fn(), getDiscovery: vi.fn(), get: vi.fn() },
  scopeManifestApi: { get: vi.fn() },
}));
vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getCeiling: vi.fn(), getPathsAtStart: vi.fn(), sayYesToPaths: vi.fn() },
}));

const plan = (sourceConnectionId: string): PlannedMigration => ({
  provider: 'imap',
  sourceCard: 'imap',
  sourceConnectionId,
  sourceUsername: 'anna@example.org',
  targetCard: 'soverin',
  targetConnectionId: 'c-soverin',
  types: ['calendar'],
});
const OLD = plan('c-old');
const NEW = plan('c-new');
const key = (m: PlannedMigration) => `${m.sourceConnectionId}→${m.targetConnectionId}`;

/** On Free, one running already: m-old's one slot does not fit, nor m-new's. */
const PAST: PathsAtStart = {
  holds: true,
  tier: { id: 'free', name: 'Free', paths: 1, monthlyEur: 0 },
  held: 1,
  after: 3,
  past: true,
  needs: { id: 'small', name: 'Small', paths: 4, monthlyEur: 5 },
  reason: 'Starting this would make 3 migrations at the same time …',
  fits: ['m-old'],
};

function renderCheck(onStarted = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CheckStep
          planned={[OLD, NEW]}
          made={{ personId: undefined, migrations: { [key(OLD)]: { id: 'm-old' }, [key(NEW)]: { id: 'm-new' } } }}
          titles={{ [key(OLD)]: 'Old mail to Soverin', [key(NEW)]: 'New mail to Soverin' }}
          onStarted={onStarted}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onStarted;
}

beforeEach(() => {
  authState.user = { role: 'owner' };
  vi.mocked(mappingApi.start).mockReset().mockResolvedValue({} as never);
  vi.mocked(mappingApi.discover).mockResolvedValue({} as never);
  vi.mocked(mappingApi.get).mockImplementation(
    async (id: string) =>
      ({
        id, tenantId: 't1', name: id, sourceType: 'imap', targetType: 'soverin', status: 'paused',
        mode: 'mirror', syncConfig: { domains: ['calendar'] }, sourceConfig: {}, targetConfig: {},
        domainStatus: [], createdAt: '2026-10-04T08:00:00Z', updatedAt: '2026-10-04T08:00:00Z',
      }) as never,
  );
  vi.mocked(mappingApi.getDiscovery).mockImplementation(
    async (id: string) =>
      ({
        mappingId: id,
        discovered: true,
        domains: [{ domain: 'calendar', collections: 1, items: 40, discoveredAt: '2026-10-04T08:05:00Z' }],
      }) as never,
  );
  vi.mocked(scopeManifestApi.get).mockResolvedValue({ version: 'v1', migrates: [], partial: [], doesNotMigrate: [] });
  vi.mocked(personLinkApi.list).mockResolvedValue([]);
  vi.mocked(billingApi.getCeiling).mockRejectedValue(new Error('not asked here'));
  vi.mocked(billingApi.getPathsAtStart).mockReset().mockResolvedValue(PAST);
  vi.mocked(billingApi.sayYesToPaths).mockReset().mockResolvedValue(undefined);
});

describe('Start, past the tier', () => {
  it('gives way to the two ways on, and starts only what fits when that is chosen', async () => {
    const user = userEvent.setup();
    const onStarted = renderCheck();
    const fits = await screen.findByRole('button', { name: 'Start 1 of 2' }, { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Move up to Small and start' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(vi.mocked(billingApi.getPathsAtStart)).toHaveBeenCalledWith(['m-old', 'm-new']);

    await user.click(fits);
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(vi.mocked(mappingApi.start).mock.calls).toEqual([['m-old']]);
  });

  it('moves up on the yes, then starts everything', async () => {
    const user = userEvent.setup();
    const onStarted = renderCheck();
    await user.click(await screen.findByRole('button', { name: 'Move up to Small and start' }, { timeout: 5000 }));
    await user.click(screen.getByRole('button', { name: 'Yes, I agree' }));
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(vi.mocked(billingApi.sayYesToPaths)).toHaveBeenCalledWith({ tierId: 'small', priceEur: 5 });
    expect(vi.mocked(mappingApi.start).mock.calls).toEqual([['m-old'], ['m-new']]);
  });
});

describe('Start, within the tier', () => {
  it('is as it was', async () => {
    vi.mocked(billingApi.getPathsAtStart).mockResolvedValue({
      ...PAST,
      after: 1,
      held: 0,
      past: false,
      needs: null,
      reason: null,
      fits: ['m-old', 'm-new'],
    });
    const user = userEvent.setup();
    const onStarted = renderCheck();
    const start = await screen.findByRole('button', { name: 'Start' });
    await vi.waitFor(() => expect(start).toBeEnabled());
    await vi.waitFor(() => expect(vi.mocked(billingApi.getPathsAtStart)).toHaveBeenCalled());
    await user.click(start);
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(vi.mocked(mappingApi.start).mock.calls).toEqual([['m-old'], ['m-new']]);
  });
});
