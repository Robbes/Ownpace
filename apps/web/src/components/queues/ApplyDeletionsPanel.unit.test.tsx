// Copyright 2026 The Ownpace authors (Apache-2.0)

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
      await screen.findByText('Deleting by hand is OFF for this migration (the default).'),
    ).toBeInTheDocument();
    // The shared warning, verbatim, before any switch is touched.
    expect(screen.getByText(APPLY_FLAG_WARNING)).toBeInTheDocument();

    // The gate to the destructive path keeps its bin, which is also what
    // makes the no-bin check on the automatic switch below mean something.
    expect(screen.getByRole('button', { name: 'Turn on deleting by hand' }).innerHTML).toMatch(/trash/i);
    fireEvent.click(screen.getByText('Turn on deleting by hand'));
    // Armed, not enabled.
    expect(setApplyDeletionsFlag).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirm: turn on deleting by hand'));
    await waitFor(() => expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { allowApplyDeletions: true }));
  });

  it('turning OFF is one click — reducing capability needs no ceremony', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    expect(
      await screen.findByText('Deleting by hand is ON for this migration.'),
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

    fireEvent.click(await screen.findByText('Turn on deleting by hand'));
    fireEvent.click(screen.getByText('Confirm: turn on deleting by hand'));

    expect(await screen.findByText('Only an owner can change this.')).toBeInTheDocument();
  });
});

describe('the two switches read as two (workplan 0156 T6)', () => {
  // The owner, on Goog2NC: "auto deletions is ON, but the button below
  // suggests I need to enable it first". The first switch said "Applying
  // deletions is ON" and the second "Enable auto-apply", with a bin.

  it('the first says what ON allows: deleting by hand, nothing by itself', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    expect(await screen.findByText('Deleting by hand is ON for this migration.')).toBeInTheDocument();
    expect(
      screen.getByText('Nothing is removed until you press a delete button on an item.'),
    ).toBeInTheDocument();
  });

  it('the second says automatic, and its button names it without a bin', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: true, source: 'mapping' });
    renderPanel();

    expect(
      await screen.findByText("Automatic removal of moved files' old copies is OFF for this migration (the default)."),
    ).toBeInTheDocument();
    const enable = screen.getByRole('button', { name: 'Turn on automatic removal' });
    // The bin is owed only by what destroys; pressing this removes nothing.
    expect(enable.innerHTML).not.toMatch(/trash/i);

    fireEvent.click(enable);
    expect(setApplyDeletionsFlag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm: remove old copies unattended'));
    await waitFor(() =>
      expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { autoApplyRelocations: true }),
    );
  });

  it('with both on, each has its own Turn off, and they are not the same words', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: true, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    expect(await screen.findByText('Turn off')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Turn off automatic removal'));
    await waitFor(() =>
      expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { autoApplyRelocations: false }),
    );
  });

  it('turning the first off turns the second off too, so it cannot wait out of sight', async () => {
    // Before: only the first went off, the second's section vanished with it,
    // and turning the first on again re-armed unattended removal unsaid.
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: true, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    fireEvent.click(await screen.findByText('Turn off'));
    await waitFor(() =>
      expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', {
        allowApplyDeletions: false,
        autoApplyRelocations: false,
      }),
    );
  });

  it('a second switch stored ON under a first that is off is said, and can be turned off', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: true, source: 'mapping' });
    setApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    renderPanel();

    expect(
      await screen.findByText(
        "Automatic removal of moved files' old copies is set ON, and does nothing while deleting by hand is off.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Turn off automatic removal'));
    await waitFor(() =>
      expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { autoApplyRelocations: false }),
    );
  });
});

describe('the appliance (config-file-owned)', () => {
  it('is read-only and names the file instead of offering a switch', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'config' });
    renderPanel();

    expect(
      await screen.findByText('Deleting by hand is OFF for this migration (the default).'),
    ).toBeInTheDocument();
    expect(screen.getByText(/config file/)).toBeInTheDocument();
    expect(screen.getByText('allowApplyDeletions')).toBeInTheDocument();
    expect(screen.queryByText('Turn on deleting by hand')).not.toBeInTheDocument();
    expect(screen.queryByText('Turn off')).not.toBeInTheDocument();
  });
});

describe('when the flag cannot be read', () => {
  it('says so — not knowing the state of the destructive gate is worth saying', async () => {
    fetchApplyDeletionsFlag.mockRejectedValue(new Error('connect ECONNREFUSED'));
    renderPanel();

    expect(
      await screen.findByText(/Could not read whether deleting by hand is on/),
    ).toBeInTheDocument();
  });
});
