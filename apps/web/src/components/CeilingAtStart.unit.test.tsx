// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The data ceiling, said at Start (workplan 0109 T6).
 *
 * What the owner meets before the press: when the preflight's measure and the
 * data already moved pass the ceiling, a note with both ways on and their
 * prices, and the way to the Billing page. Never a block: the note has no
 * button, and Start stays where it is. Nothing at all where it does not apply:
 * under the ceiling, for a member, and on the appliance.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CeilingAtStart } from './CeilingAtStart.tsx';
import { measuredBytes } from './CeilingAtStartNote.tsx';
import { billingApi, type Ceiling } from '../services/billing-service.ts';

const { editionFlag, authState } = vi.hoisted(() => ({
  editionFlag: { selfhost: false },
  authState: { user: { role: 'owner' } as null | { role: string } },
}));

vi.mock('../services/edition.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/edition.ts')>()),
  isSelfHost: () => editionFlag.selfhost,
}));

vi.mock('../stores/auth-store.ts', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

vi.mock('../services/billing-service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing-service.ts')>()),
  billingApi: { getCeiling: vi.fn() },
}));

const getCeiling = vi.mocked(billingApi.getCeiling);

/** On Small, 600 GB of 750 GB moved. */
const ON_SMALL: Ceiling = {
  tier: { id: 'small', name: 'Small', paths: 4, monthly: 4 },
  ceilingGb: 750,
  topUps: 0,
  gbMoved: 600,
  share: 0.8,
  state: 'near',
  holds: true,
  moveUp: { tierId: 'medium', name: 'Medium', paths: 20, setupEur: 7, monthlyEur: 8, ceilingGb: 2000 },
  topUp: { tierId: 'small', bandGb: 750, priceEur: 8, ceilingGb: 1500 },
  breakEven: { extraOnceEur: 1, savedMonthlyEur: 4, paysBackInDays: 8 },
};

const GB = 1_000_000_000;

function renderNote(bytes: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CeilingAtStart bytes={bytes} />
        <button type="button">Start migration</button>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  editionFlag.selfhost = false;
  authState.user = { role: 'owner' };
  getCeiling.mockReset();
  getCeiling.mockResolvedValue(ON_SMALL);
});

describe('past the ceiling', () => {
  it('says what the migrations hold against the ceiling, both ways on with their prices, and where to choose', async () => {
    renderNote(200 * GB);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('about 200 GB, and the 600 GB already moved pass your data ceiling of 750 GB');
    expect(note.textContent).toContain('Move up to Medium: €7 once, then €8 a month.');
    expect(note.textContent).toContain('Or buy another 750 GB once, for €8.');
    expect(screen.getByRole('link', { name: 'your data ceiling on the Billing page' }).getAttribute('href')).toBe('/billing');
  });

  it('never blocks: the note has no button, and Start is untouched', async () => {
    renderNote(200 * GB);
    await screen.findByRole('note');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start migration' })).toBeEnabled();
  });

  it('during the alpha, warns all the same and says nothing waits', async () => {
    getCeiling.mockResolvedValue({ ...ON_SMALL, holds: false });
    renderNote(200 * GB);
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('During the alpha nothing waits at the ceiling');
    expect(note.textContent).not.toContain('Move up to');
  });
});

describe('where it does not apply, nothing', () => {
  it('within the ceiling', async () => {
    renderNote(100 * GB);
    await vi.waitFor(() => expect(getCeiling).toHaveBeenCalled());
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('for a member, who is not read the ceiling at all', () => {
    authState.user = { role: 'member' };
    renderNote(200 * GB);
    expect(getCeiling).not.toHaveBeenCalled();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('on the appliance, which has no tiers', () => {
    editionFlag.selfhost = true;
    renderNote(200 * GB);
    expect(getCeiling).not.toHaveBeenCalled();
  });

  it('when the ceiling cannot be read: the hold still says it at the ceiling', async () => {
    getCeiling.mockRejectedValue(new Error('down'));
    renderNote(200 * GB);
    await vi.waitFor(() => expect(getCeiling).toHaveBeenCalled());
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('what the preflight measured', () => {
  it('adds the sizes it has, and counts a data type without one, or with an error, as nothing', () => {
    expect(
      measuredBytes([
        { bytes: 5 },
        { bytes: 7 },
        {},
        { bytes: 100, lastError: 'listing failed' },
        { bytes: 100, lastErrorWithheld: true },
      ]),
    ).toBe(12);
  });
});
