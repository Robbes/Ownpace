// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The deletions screen (ADR-0026), which owns the only destructive button in
 * the product.
 *
 * Most of these assert what does NOT appear. That is the point: the screen's
 * job is to keep `apply` away from anything ADR-0024 says must not be acted on,
 * and a queue that renders correctly while offering one extra button is exactly
 * the failure worth a test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeletionsResponse, ItemDeletion } from '@openmig/shared';
import {
  DELETIONS_MEANING,
  DELETION_CONFIRMATIONS,
  DELETION_GUIDANCE,
} from '@openmig/shared';

const {
  fetchDeletions,
  keepDeletion,
  applyDeletion,
  fetchApplyReceipt,
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag,
  DecisionRefusedError,
} = vi.hoisted(() => {
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
      fetchDeletions: vi.fn(),
      keepDeletion: vi.fn(),
      applyDeletion: vi.fn(),
      fetchApplyReceipt: vi.fn(),
      fetchApplyDeletionsFlag: vi.fn(),
      setApplyDeletionsFlag: vi.fn(),
      DecisionRefusedError,
    };
  });

vi.mock('../services/operating-service', () => ({
  fetchDeletions,
  keepDeletion,
  applyDeletion,
  fetchApplyReceipt,
  fetchApplyDeletionsFlag,
  setApplyDeletionsFlag,
  DecisionRefusedError,
}));

// The flag panel reads this on every render of the screen; a stable default
// keeps the queue tests focused on the queue (the panel has its own suite).
fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, source: 'mapping' });

import Deletions from './Deletions.tsx';

function deletion(over: Partial<ItemDeletion> & { naturalKeyHash: string }): ItemDeletion {
  return {
    domain: 'email',
    collection: 'INBOX',
    absentPasses: 0,
    confirmed: true,
    evidence: 'reported',
    ...over,
  };
}

function queue(over: Partial<DeletionsResponse['x']> = {}): DeletionsResponse {
  return {
    'acme-mail': {
      migrationStatus: 'active',
      confirmed: [],
      watching: [],
      acknowledged: [],
      whatThisMeans: DELETIONS_MEANING,
      howToResolve: DELETION_GUIDANCE,
      ...over,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the apply gate', () => {
  it('offers apply for a reported deletion', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h-reported', evidence: 'reported' })] }),
    );
    renderScreen();

    expect(await screen.findByText('Delete it here too')).toBeInTheDocument();
    expect(screen.getByText('Keep our copy')).toBeInTheDocument();
  });

  it('offers apply for a trashed deletion', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h-trashed', evidence: 'trashed' })] }),
    );
    renderScreen();

    expect(await screen.findByText('Delete it here too')).toBeInTheDocument();
  });

  it('NEVER offers apply for an inferred deletion, however long it has been missing', async () => {
    // Confirmed — so it IS shown and IS decidable — but inferred, so the only
    // decision on offer is to keep. ADR-0024: an absence is never enough,
    // however many passes it repeats.
    fetchDeletions.mockResolvedValue(
      queue({
        confirmed: [
          deletion({
            naturalKeyHash: 'h-inferred',
            evidence: 'inferred',
            absentPasses: DELETION_CONFIRMATIONS * 50,
          }),
        ],
      }),
    );
    renderScreen();

    // It is listed, and it is actionable...
    expect(await screen.findByText('Keep our copy')).toBeInTheDocument();
    expect(screen.getByText('inferred')).toBeInTheDocument();
    // ...but there is no destructive option at all — not a disabled one.
    expect(screen.queryByText('Delete it here too')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument();
  });

  it('offers no actions at all for an item that is only being watched', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        watching: [deletion({ naturalKeyHash: 'h-watch', confirmed: false, evidence: 'inferred' })],
      }),
    );
    renderScreen();

    expect(
      await screen.findByRole('heading', { name: /Watching\s*\(1\)/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Keep our copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete it here too')).not.toBeInTheDocument();
  });
});

describe('the apply button itself', () => {
  it('takes two clicks, and the first one does not delete anything', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h1' })] }),
    );
    // The appliance's synchronous shape (workplan 0019 T1: the client now
    // carries the ONE permitted success-shape split).
    applyDeletion.mockResolvedValue({
      mode: 'immediate',
      result: {
        status: 'ok',
        action: 'apply',
        naturalKeyHash: 'h1',
        effect: 'Removed from the target.',
        kind: 'binned',
      },
    });
    renderScreen();

    fireEvent.click(await screen.findByText('Delete it here too'));
    // Armed, not fired.
    expect(applyDeletion).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm delete')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(applyDeletion).toHaveBeenCalledWith('acme-mail', 'h1'));
    expect(await screen.findByText('Removed from the target.')).toBeInTheDocument();
  });

  it("shows the server's refusal in its own words rather than an error", async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h2' })] }),
    );
    // The gates the UI cannot see live on the server, so a refusal is a normal
    // outcome here. What must survive is the reason: "not enabled" and "the
    // target copy was edited" call for completely different responses from an
    // operator, and a generic failure message tells them neither.
    applyDeletion.mockRejectedValue(
      new DecisionRefusedError(
        {
          error: 'not_enabled',
          reason: 'This mapping does not have allowApplyDeletions set.',
        },
        403,
      ),
    );
    renderScreen();

    fireEvent.click(await screen.findByText('Delete it here too'));
    fireEvent.click(screen.getByText('Confirm delete'));

    expect(
      await screen.findByText('This mapping does not have allowApplyDeletions set.'),
    ).toBeInTheDocument();
  });
});

describe('the managed receipt lifecycle (workplan 0019 T2)', () => {
  // On managed, "apply" is queued → terminal: the ledger gates answered on the
  // request, the target's half lands on a receipt the screen polls. Stop on
  // EVERY terminal state; render each in its own character.

  it('polls a queued receipt to `applied` and reports how final the removal was', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'hq1' })] }),
    );
    applyDeletion.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-01T12:00:00Z' },
    });
    fetchApplyReceipt
      .mockResolvedValueOnce({ state: 'queued', requestedAt: '2026-08-01T12:00:00Z' })
      .mockResolvedValue({
        state: 'applied',
        requestedAt: '2026-08-01T12:00:00Z',
        finishedAt: '2026-08-01T12:00:06Z',
        kind: 'binned',
      });
    renderScreen();

    fireEvent.click(await screen.findByText('Delete it here too'));
    fireEvent.click(screen.getByText('Confirm delete'));

    // The queued state is shown while the job runs...
    expect(await screen.findByText(/Removal queued/)).toBeInTheDocument();
    // ...and the poll lands on the terminal state, kind included.
    expect(
      await screen.findByText(/moved to the target's own bin/),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchApplyReceipt).toHaveBeenCalledWith('acme-mail', 'hq1'));
  });

  it("renders a `refused` receipt as the gates' own words with the code — never as an error", async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'hq2' })] }),
    );
    applyDeletion.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-01T12:00:00Z' },
    });
    fetchApplyReceipt.mockResolvedValue({
      state: 'refused',
      requestedAt: '2026-08-01T12:00:00Z',
      finishedAt: '2026-08-01T12:00:03Z',
      code: 'edited_on_target',
      reason: 'Somebody has edited the target copy since it was written; it is theirs now.',
    });
    renderScreen();

    fireEvent.click(await screen.findByText('Delete it here too'));
    fireEvent.click(screen.getByText('Confirm delete'));

    expect(
      await screen.findByText(/Somebody has edited the target copy.*\(edited_on_target\)/),
    ).toBeInTheDocument();
  });

  it('renders a `failed` receipt as a FAILURE with its reason — never as silence or a refusal', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'hq3' })] }),
    );
    applyDeletion.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-01T12:00:00Z' },
    });
    fetchApplyReceipt.mockResolvedValue({
      state: 'failed',
      requestedAt: '2026-08-01T12:00:00Z',
      finishedAt: '2026-08-01T12:00:03Z',
      error: 'buildDepsFromMapping currently only supports imap-oauth2, got: undefined',
    });
    renderScreen();

    fireEvent.click(await screen.findByText('Delete it here too'));
    fireEvent.click(screen.getByText('Confirm delete'));

    expect(await screen.findByText(/The removal job failed:/)).toBeInTheDocument();
    expect(screen.getByText(/imap-oauth2/)).toBeInTheDocument();
  });

  it('a missed poll keeps polling instead of stranding the outcome as forever-queued', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'hq4' })] }),
    );
    applyDeletion.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-01T12:00:00Z' },
    });
    fetchApplyReceipt
      .mockRejectedValueOnce(new Error('transient read failure'))
      .mockResolvedValue({
        state: 'applied',
        requestedAt: '2026-08-01T12:00:00Z',
        finishedAt: '2026-08-01T12:00:06Z',
        kind: 'deleted',
      });
    renderScreen();

    fireEvent.click(await screen.findByText('Delete it here too'));
    fireEvent.click(screen.getByText('Confirm delete'));

    expect(
      await screen.findByText(/gone, with no recovery path from here/),
    ).toBeInTheDocument();
  });
});

describe('keep', () => {
  it('posts keep and reports what it did', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h3' })] }),
    );
    keepDeletion.mockResolvedValue({
      status: 'ok',
      action: 'keep',
      naturalKeyHash: 'h3',
      effect: 'Acknowledged. The target keeps its copy.',
    });
    renderScreen();

    fireEvent.click(await screen.findByText('Keep our copy'));
    await waitFor(() => expect(keepDeletion).toHaveBeenCalledWith('acme-mail', 'h3'));
    expect(await screen.findByText('Acknowledged. The target keeps its copy.')).toBeInTheDocument();
  });
});

describe('when the queue cannot be read', () => {
  it('says so instead of rendering an empty queue', async () => {
    // An empty decision queue means "nothing needs you". Showing that when we
    // could not ask is the failure hard rule 9 exists to prevent.
    fetchDeletions.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8081'));
    renderScreen();

    expect(await screen.findByText('Could not load this queue.')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
    expect(screen.getByText(/not the same as an empty queue/)).toBeInTheDocument();
  });
});

describe('a finished migration', () => {
  it('keeps its items but stops presenting them as work to do', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        migrationStatus: 'done',
        reportingClosed: 'This migration is finished, so nothing here is still being watched.',
        acknowledged: [deletion({ naturalKeyHash: 'h4', acknowledgedAt: '2026-07-01T00:00:00Z' })],
      }),
    );
    renderScreen();

    expect(
      await screen.findByText(/This migration is finished, so nothing here is still being watched./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Already decided\s*\(1\)/ }),
    ).toBeInTheDocument();
  });
});

describe('the mapping id goes somewhere (0034 T1)', () => {
  it('links the section heading to the mapping hub', async () => {
    fetchDeletions.mockResolvedValue(queue({}));
    renderScreen();

    const link = await screen.findByRole('link', { name: 'acme-mail' });
    expect(link.getAttribute('href')).toBe('/mappings/acme-mail');
  });
});

describe('the as-of label (0036 T1)', () => {
  it('says when the queue was read and offers a manual refresh', async () => {
    fetchDeletions.mockResolvedValue(queue({}));
    renderScreen();

    expect(await screen.findByText(/^Updated/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });
});

