// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The apply-deletions flag panel (workplan 0019 T3).
 *
 * Gate 1 of the destructive path, as a screen: the current value is a visible
 * fact, ENABLING takes the shared warning plus a two-step switch, disabling is
 * one click, and the appliance's config-file-owned value is read-only with the
 * file named. The server enforces everything; these tests are about what is
 * put in front of a person and in which order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { APPLY_FLAG_WARNING } from '@openmig/shared';

const { fetchApplyDeletionsFlag, setApplyDeletionsFlag, DecisionRefusedError } = vi.hoisted(() => {
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
    fetchApplyDeletionsFlag: vi.fn(),
    setApplyDeletionsFlag: vi.fn(),
    DecisionRefusedError,
  };
});

vi.mock('../../services/operating-service', () => ({
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag,
  DecisionRefusedError,
}));

import { ApplyDeletionsPanel } from './ApplyDeletionsPanel.tsx';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApplyDeletionsPanel mappingId="m1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the managed switch', () => {
  it('shows OFF with the warning IN FRONT of a two-step switch — the first click enables nothing', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    expect(
      await screen.findByText('Applying deletions is OFF for this migration (the default).'),
    ).toBeInTheDocument();
    // The shared warning, verbatim, before any switch is touched.
    expect(screen.getByText(APPLY_FLAG_WARNING)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Turn on applying deletions'));
    // Armed, not enabled.
    expect(setApplyDeletionsFlag).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirm: enable deletions'));
    await waitFor(() => expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { allowApplyDeletions: true }));
  });

  it('turning OFF is one click — reducing capability needs no ceremony', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    expect(
      await screen.findByText('Applying deletions is ON for this migration.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Turn off'));
    await waitFor(() => expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { allowApplyDeletions: false }));
  });

  it("shows the server's refusal in its own words when the change is denied", async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    setApplyDeletionsFlag.mockRejectedValue(
      new DecisionRefusedError(
        { error: 'Forbidden', reason: 'Only an owner can change this.' },
        403,
      ),
    );
    renderPanel();

    fireEvent.click(await screen.findByText('Turn on applying deletions'));
    fireEvent.click(screen.getByText('Confirm: enable deletions'));

    expect(await screen.findByText('Only an owner can change this.')).toBeInTheDocument();
  });
});

describe('the appliance (config-file-owned)', () => {
  it('is read-only and names the file instead of offering a switch', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'config' });
    renderPanel();

    expect(
      await screen.findByText('Applying deletions is OFF for this migration (the default).'),
    ).toBeInTheDocument();
    expect(screen.getByText(/config file/)).toBeInTheDocument();
    expect(screen.getByText('allowApplyDeletions')).toBeInTheDocument();
    expect(screen.queryByText('Turn on applying deletions')).not.toBeInTheDocument();
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument();
  });
});

describe('when the flag cannot be read', () => {
  it('says so — not knowing the state of the destructive gate is worth saying', async () => {
    fetchApplyDeletionsFlag.mockRejectedValue(new Error('connect ECONNREFUSED'));
    renderPanel();

    expect(
      await screen.findByText(/Could not read whether applying deletions is enabled/),
    ).toBeInTheDocument();
  });
});
