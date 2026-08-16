// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The sharing checklist screen (ADR-0032, workplan 0052 T5/T6c).
 *
 * The server enforces every gate; these tests are about what is put in front
 * of a person: the progress line says how much is left, apply sends the
 * ADDRESS THE OWNER CONFIRMED (not blindly the source's), and one confirmed
 * correction prefills the same grantee's other rows — confirm once, not ten
 * times (§6).
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

import Sharing from './Sharing';

const row = (over: Partial<ShareGrantRow> & { id: string }): ShareGrantRow => ({
  grantHash: `hash-${over.id}`,
  subject: 'drive_item',
  onLabel: 'Projects/budget.xlsx',
  grantee: 'anna@old.example.nl',
  role: 'writer',
  viaLink: false,
  raw: '{"role":"writer"}',
  verdict: 'clean',
  verdictTarget: 'a person share on the target',
  state: 'open',
  scannedAt: '2026-08-16T12:00:00Z',
  ...over,
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

describe('the checklist', () => {
  it('shows the progress line and the manual-rows note', async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 3, open: 2, applied: 1, doneManual: 0, skipped: 0, openManual: 1 },
      grants: [
        row({ id: 'g1' }),
        row({ id: 'g2', verdict: 'manual', verdictTarget: 'do it by hand' }),
        row({ id: 'g3', state: 'applied', decidedBy: 'owner', decidedAt: '2026-08-16T13:00:00Z' }),
      ],
    });
    renderScreen();

    expect(await screen.findByText(/1 \/ 3 settled/)).toBeInTheDocument();
    expect(screen.getByText(/manual — steps for you/)).toBeInTheDocument();
  });

  it('apply sends the address the owner corrected, not the source address', async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    decideSharing.mockResolvedValue({ status: 'ok', grant: row({ id: 'g1', state: 'applied' }) });
    renderScreen();

    const input = (await screen.findByDisplayValue('anna@old.example.nl')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'anna@new.example.nl' } });
    // Two-step: the first click arms, the second fires.
    const applyButton = screen.getByText('Create share on new system');
    fireEvent.click(applyButton);
    fireEvent.click(screen.getByText('Click again — this shares AND invites'));

    await waitFor(() =>
      expect(decideSharing).toHaveBeenCalledWith('m1', 'g1', {
        action: 'apply',
        grantee: 'anna@new.example.nl',
      }),
    );
  });

  it("a confirmed correction prefills the same grantee's other rows (§6: confirm once)", async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 2, open: 2, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' }), row({ id: 'g2', onLabel: 'Projects/notes.md' })],
    });
    decideSharing.mockResolvedValue({ status: 'ok', grant: row({ id: 'g1', state: 'applied' }) });
    renderScreen();

    const inputs = await screen.findAllByDisplayValue('anna@old.example.nl');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0]!, { target: { value: 'anna@new.example.nl' } });
    const applyButtons = screen.getAllByText('Create share on new system');
    fireEvent.click(applyButtons[0]!);
    fireEvent.click(screen.getByText('Click again — this shares AND invites'));
    await waitFor(() => expect(decideSharing).toHaveBeenCalled());

    // The OTHER row now proposes the confirmed address — the owner still
    // presses apply per row; only the retyping is saved.
    await waitFor(() =>
      expect(screen.getByDisplayValue('anna@new.example.nl')).toBeInTheDocument(),
    );
  });

  it("a refusal renders the server's words verbatim and the row stays actionable", async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'active',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    decideSharing.mockRejectedValue(
      new DecisionRefusedError(
        { error: 'not_cut_over', reason: 'Shares are applied at or after cutover, not before.' },
        409,
      ),
    );
    renderScreen();

    fireEvent.click(await screen.findByText('Create share on new system'));
    fireEvent.click(screen.getByText('Click again — this shares AND invites'));

    expect(
      await screen.findByText(/Shares are applied at or after cutover/),
    ).toBeInTheDocument();
  });
});
