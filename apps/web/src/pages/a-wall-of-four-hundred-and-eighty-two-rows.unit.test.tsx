// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SHARING PAGE FOLDS A FOLDER INTO ONE ROW, AND FOLDS NOTHING ELSE
 * (workplan 0123 T4).
 *
 * The owner's page showed 482 rows for a handful of shared folders, because
 * Drive populates `permissions` on every child of a shared folder as well as
 * on the folder. Every row was true; the wall was unreadable, and an
 * unreadable list is where a forgotten "anyone with the link" survives a
 * cutover.
 *
 * What is guarded here is the four ways folding could make it WORSE:
 *
 *  1. **Hiding a deviation.** A file shared differently from its folder must
 *     stay visible without opening anything. It is the row somebody actually
 *     has to look at.
 *  2. **Hiding the rows themselves.** The fold is a lid: opening the folder
 *     shows the very same rows with the very same presses.
 *  3. **One press that emails eleven people.** `done` and `skip` record a
 *     decision and reach nobody; `apply` re-creates the share and invites a
 *     real person. Only the first two are offered over a whole folder.
 *  4. **A sentence repeated 482 times.** A mapping scanned before migration
 *     0053 has no placement on ANY row, and "the old system did not say where
 *     this sits" is worth printing when the absence is selective and is noise
 *     when it is universal — the very wall this task removes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ShareGrantRow } from '@openmig/shared';

const { fetchSharing, decideSharing, rescanSharing, DecisionRefusedError } = vi.hoisted(() => {
  class DecisionRefusedError extends Error {
    constructor(
      readonly refusal: { error: string; reason?: string; hint?: string },
      readonly httpStatus: number,
    ) {
      super(refusal.reason ?? refusal.error);
      this.name = 'DecisionRefusedError';
    }
  }
  return {
    fetchSharing: vi.fn(),
    decideSharing: vi.fn(),
    rescanSharing: vi.fn(),
    DecisionRefusedError,
  };
});

vi.mock('../services/operating-service', () => ({
  fetchSharing,
  decideSharing,
  rescanSharing,
  DecisionRefusedError,
}));

import Sharing from './Sharing.tsx';

const row = (over: Partial<ShareGrantRow> & { id: string }): ShareGrantRow => ({
  grantHash: `hash-${over.id}`,
  subject: 'drive_item',
  onLabel: `item-${over.id}`,
  grantee: 'anna@example.test',
  role: 'writer',
  viaLink: false,
  raw: '{"role":"writer"}',
  verdict: 'clean',
  verdictTarget: 'a person share on the target',
  state: 'open',
  scannedAt: '2026-09-18T12:00:00Z',
  ...over,
});

/** A shared folder and `n` children carrying exactly its grants. */
const folderWithChildren = (n: number): ShareGrantRow[] => [
  row({
    id: 'folder',
    itemKey: 'F',
    parentKey: 'root',
    isContainer: true,
    onLabel: 'Foto shoot Emma',
  }),
  ...Array.from({ length: n }, (_, i) =>
    row({
      id: `c${i}`,
      itemKey: `c${i}`,
      parentKey: 'F',
      isContainer: false,
      onLabel: `IMG_${i}.jpg`,
    }),
  ),
];

const answerWith = (grants: ShareGrantRow[]) =>
  fetchSharing.mockResolvedValue({
    migrationStatus: 'done',
    summary: {
      total: grants.length,
      open: grants.filter((g) => g.state === 'open').length,
      applied: 0,
      doneManual: 0,
      skipped: 0,
      openManual: 0,
    },
    grants,
  });

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mappings/m1/sharing']}>
        <Routes>
          <Route path="/mappings/:mappingId/sharing" element={<Sharing />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a folder is one row', () => {
  it('folds a folder and its children, and says how much it covers', async () => {
    answerWith(folderWithChildren(4));
    renderScreen();

    expect(await screen.findByText('Foto shoot Emma')).toBeInTheDocument();
    expect(screen.getByText(/5 items/)).toBeInTheDocument();
    // Under the lid until somebody opens it.
    expect(screen.queryByText('IMG_0.jpg')).not.toBeInTheDocument();
  });

  it('opening the folder shows the very same rows, with their own presses', async () => {
    answerWith(folderWithChildren(4));
    renderScreen();

    fireEvent.click(await screen.findByText('Foto shoot Emma'));
    expect(screen.getByText('IMG_0.jpg')).toBeInTheDocument();
    expect(screen.getByText('IMG_3.jpg')).toBeInTheDocument();
    // The per-row outward-facing press is still exactly where it was.
    expect(screen.getAllByText('Apply Share on the new system').length).toBeGreaterThan(0);
  });
});

describe('what the lid never covers', () => {
  it('a file shared differently from its folder stays visible, and says how', async () => {
    answerWith([
      ...folderWithChildren(3),
      row({
        id: 'odd',
        itemKey: 'c9',
        parentKey: 'F',
        isContainer: false,
        onLabel: 'Contract.pdf',
        grantee: 'stranger@example.test',
      }),
    ]);
    renderScreen();

    // No press needed: it is the row somebody has to look at.
    expect(await screen.findByText('Contract.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Shared differently from its folder/)).toBeInTheDocument();
    // The grantee appears on the row too, so assert the DEVIATION line's own
    // wording: what this file carries that its folder does not.
    expect(
      screen.getByText(/extra: stranger@example\.test:writer/),
    ).toBeInTheDocument();
  });

  it('a row the source could not place is listed on its own', async () => {
    answerWith([
      ...folderWithChildren(2),
      row({ id: 'loose', onLabel: 'Somewhere.pdf' }),
    ]);
    renderScreen();

    expect(await screen.findByText('Somewhere.pdf')).toBeInTheDocument();
    expect(screen.getByText(/did not say where this sits/)).toBeInTheDocument();
  });
});

describe('one press over a folder', () => {
  it('settles every open row in the folder, and never offers apply', async () => {
    answerWith(folderWithChildren(4));
    decideSharing.mockResolvedValue({ status: 'ok' });
    renderScreen();

    // Apply is per-row, inside the folder — never over the whole group, because
    // it emails a real person per row.
    expect(await screen.findByText('Foto shoot Emma')).toBeInTheDocument();
    expect(screen.queryByText('Apply Share on the new system')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Mark all done \(5\)/));
    await waitFor(() => expect(decideSharing).toHaveBeenCalledTimes(5));
    for (const call of decideSharing.mock.calls) {
      expect(call[2]).toEqual({ action: 'done' });
    }
  });

  it('counts only the rows still open', async () => {
    const rows = folderWithChildren(4);
    rows[1] = { ...rows[1]!, state: 'skipped', decidedBy: 'rob', decidedAt: '2026-09-18T13:00:00Z' };
    answerWith(rows);
    renderScreen();

    expect(await screen.findByText(/Mark all done \(4\)/)).toBeInTheDocument();
  });
});

describe('a mapping scanned before folders could be grouped', () => {
  /**
   * THE 482 CASE, one release earlier. Nothing is placed, so every row is
   * correctly "on its own" — and printing that sentence against each of them
   * would rebuild the wall in a new font. One line at the top, naming the
   * remedy, and the list renders exactly as it did before this existed.
   */
  it('says it once at the top, not once per row', async () => {
    answerWith([
      row({ id: 'a', onLabel: 'One.pdf' }),
      row({ id: 'b', onLabel: 'Two.pdf' }),
      row({ id: 'c', onLabel: 'Three.pdf' }),
    ]);
    renderScreen();

    expect(await screen.findByText(/Refresh from the source to fold them/)).toBeInTheDocument();
    expect(screen.queryByText(/did not say where this sits/)).not.toBeInTheDocument();
    for (const label of ['One.pdf', 'Two.pdf', 'Three.pdf']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
