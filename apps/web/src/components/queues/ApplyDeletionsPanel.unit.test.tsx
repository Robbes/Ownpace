// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The apply-deletions flag panel (workplan 0019 T3), since alpha.21 the
 * automatic removal of moved files' old copies only (ADR-0031).
 *
 * Deleting by hand has no switch (ADR-0024, 2026-11-25; workplan 0173): this
 * panel no longer offers one, and the warning that stood in front of it is
 * `WhatADeleteDoes`, shown above the rows that offer a delete. What is left:
 * the automatic switch's value is a visible fact, turning it ON takes two
 * presses, OFF one, and the appliance's config-file-owned value is read-only
 * with the file named.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DELETE_BY_HAND_WARNING, DELETE_BY_HAND_WARNING_NL } from '@openmig/shared';
import { LocaleProvider } from '../../i18n/index.tsx';

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

import { ApplyDeletionsPanel, WhatADeleteDoes } from './ApplyDeletionsPanel.tsx';

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

const OFF = { autoApplyRelocations: false, source: 'mapping' } as const;
const ON = { autoApplyRelocations: true, source: 'mapping' } as const;

describe('no switch for deleting by hand (ADR-0024, 2026-11-25)', () => {
  it('offers no Turn on deleting by hand, says nothing about it, and shows the automatic switch at once', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue(OFF);
    renderPanel();

    expect(
      await screen.findByText("Automatic removal of moved files' old copies is OFF for this migration (the default)."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deleting by hand/i)).not.toBeInTheDocument();
    // The warning is no longer in front of a switch: it is above the rows.
    expect(screen.queryByText(DELETE_BY_HAND_WARNING)).not.toBeInTheDocument();
  });
});

describe('what a delete does, above the rows', () => {
  it('says the shared words verbatim, in English', () => {
    render(<WhatADeleteDoes />);
    expect(screen.getByText(DELETE_BY_HAND_WARNING)).toBeInTheDocument();
  });

  it('and in Dutch for a Dutch reader', () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      render(
        <LocaleProvider>
          <WhatADeleteDoes />
        </LocaleProvider>,
      );
      expect(screen.getByText(DELETE_BY_HAND_WARNING_NL)).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });
});

describe('the automatic switch (managed)', () => {
  it('says automatic, and its button names it without a bin; two presses turn it on', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue(OFF);
    setApplyDeletionsFlag.mockResolvedValue(ON);
    renderPanel();

    const enable = await screen.findByRole('button', { name: 'Turn on automatic removal' });
    // The bin is owed only by what destroys; pressing this removes nothing.
    expect(enable.innerHTML).not.toMatch(/trash/i);

    fireEvent.click(enable);
    expect(setApplyDeletionsFlag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm: remove old copies unattended'));
    await waitFor(() =>
      expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { autoApplyRelocations: true }),
    );
  });

  it('turning it OFF is one click — reducing capability needs no ceremony', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue(ON);
    setApplyDeletionsFlag.mockResolvedValue(OFF);
    renderPanel();

    expect(
      await screen.findByText("Automatic removal of moved files' old copies is ON for this migration."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Turn off automatic removal'));
    await waitFor(() =>
      expect(setApplyDeletionsFlag).toHaveBeenCalledWith('m1', { autoApplyRelocations: false }),
    );
  });

  it("shows the server's refusal in its own words when the change is denied", async () => {
    fetchApplyDeletionsFlag.mockResolvedValue(OFF);
    setApplyDeletionsFlag.mockRejectedValue(
      new DecisionRefusedError({ error: 'Forbidden', reason: 'Only an owner can change this.' }, 403),
    );
    renderPanel();

    fireEvent.click(await screen.findByText('Turn on automatic removal'));
    fireEvent.click(screen.getByText('Confirm: remove old copies unattended'));

    expect(await screen.findByText('Only an owner can change this.')).toBeInTheDocument();
  });
});

describe('the appliance (config-file-owned)', () => {
  it('is read-only and names the file and its key instead of offering a switch', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ autoApplyRelocations: false, source: 'config' });
    renderPanel();

    expect(
      await screen.findByText("Automatic removal of moved files' old copies is OFF for this migration (the default)."),
    ).toBeInTheDocument();
    expect(screen.getByText(/config file/)).toBeInTheDocument();
    expect(screen.getByText('autoApplyRelocations')).toBeInTheDocument();
    expect(screen.queryByText('allowApplyDeletions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('when the flag cannot be read', () => {
  it('says so — not knowing whether something removes copies unattended is worth saying', async () => {
    fetchApplyDeletionsFlag.mockRejectedValue(new Error('connect ECONNREFUSED'));
    renderPanel();

    expect(
      await screen.findByText(/Could not read whether the automatic removal of moved files' old copies is on/),
    ).toBeInTheDocument();
  });
});
