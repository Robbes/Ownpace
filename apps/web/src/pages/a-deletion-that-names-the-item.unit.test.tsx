// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DELETION THAT NAMES THE ITEM (the owner, 2026-11-19, of the same blind spot
 * on Moves).
 *
 * *Deleted on the old system* offers *Delete it here too*, and its rows named
 * only a folder: a file deleted at the top of a drive read `/` beside a hash.
 * The ledger held the name all along, and the server now sends it
 * (`displayName`), so a row says which item it is about:
 *
 *  - a file by its path, `/Docs/tax-2025.pdf`;
 *  - a contact by its name, with its address book after it in small type;
 *  - an earlier export by the name of the copy it is;
 *  - a row from before names were recorded by its folder, as before.
 *
 * Every file, folder and person here is invented.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeletionsResponse, EarlierExport, ItemDeletion } from '@openmig/shared';
import { DELETIONS_MEANING, DELETION_GUIDANCE } from '@openmig/shared';

const { fetchDeletions, fetchApplyDeletionsFlag } = vi.hoisted(() => ({
  fetchDeletions: vi.fn(),
  fetchApplyDeletionsFlag: vi.fn(),
}));

vi.mock('../services/operating-service', () => ({
  fetchDeletions,
  keepDeletion: vi.fn(),
  applyDeletion: vi.fn(),
  fetchApplyReceipt: vi.fn(),
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag: vi.fn(),
  DecisionRefusedError: class extends Error {},
}));

import Deletions from './Deletions.tsx';

function deletion(over: Partial<ItemDeletion> & { naturalKeyHash: string }): ItemDeletion {
  return { domain: 'file', collection: 'Docs', absentPasses: 0, confirmed: true, evidence: 'reported', ...over };
}

function queue(confirmed: ItemDeletion[], waiting: EarlierExport[] = []): DeletionsResponse {
  return {
    'acme-files': {
      migrationStatus: 'active',
      afterCutover: [],
      confirmed,
      watching: [],
      acknowledged: [],
      whatThisMeans: DELETIONS_MEANING,
      howToResolve: DELETION_GUIDANCE,
      earlierExports: { waiting, kept: [] },
    },
  };
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Deletions receiptPollMs={10} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The row of one item, found by its ID chip, which every row keeps. */
const rowOf = async (hash: string) => (await screen.findByTitle(hash)).closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
  fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, source: 'mapping' });
});

describe('a deleted item is named by what the ledger holds for it', () => {
  it('a file by its path, also at the top of a drive', async () => {
    fetchDeletions.mockResolvedValue(
      queue([
        deletion({ naturalKeyHash: 'h-tax', displayName: 'tax-2025.pdf' }),
        deletion({ naturalKeyHash: 'h-top', collection: '/', displayName: 'notes.txt' }),
      ]),
    );
    renderScreen();

    expect(within(await rowOf('h-tax')).getByText('/Docs/tax-2025.pdf')).toHaveAttribute('title', '/Docs/tax-2025.pdf');
    const top = await rowOf('h-top');
    expect(within(top).getByText('/notes.txt')).toBeInTheDocument();
    expect(within(top).queryByText('/')).not.toBeInTheDocument();
  });

  it('a contact by its name, with its address book after it', async () => {
    fetchDeletions.mockResolvedValue(
      queue([deletion({ domain: 'contact', naturalKeyHash: 'h-jan', collection: 'Family', displayName: 'Jan Jansen' })]),
    );
    renderScreen();

    const row = await rowOf('h-jan');
    const named = within(row).getByTitle('Jan Jansen — Family');
    expect(named).toHaveTextContent(/^Jan JansenFamily$/);
    expect(within(named).getByText('Family')).toHaveClass('text-gray-500');
  });

  it('an earlier export by the name of the copy it is', async () => {
    fetchDeletions.mockResolvedValue(
      queue([], [{ domain: 'file', naturalKeyHash: 'h-odt', collection: 'Docs', exportedAs: 'h-docx', displayName: 'Plan.odt' }]),
    );
    renderScreen();

    expect(within(await rowOf('h-odt')).getByText('/Docs/Plan.odt')).toBeInTheDocument();
  });

  it('a row from before names were recorded, by its folder, as before', async () => {
    fetchDeletions.mockResolvedValue(queue([deletion({ naturalKeyHash: 'h-unnamed', collection: 'Docs' })]));
    renderScreen();

    const row = await rowOf('h-unnamed');
    expect(within(row).getByText('Docs')).toHaveAttribute('title', 'Docs');
    expect(row.textContent).not.toContain('/Docs/');
  });
});
