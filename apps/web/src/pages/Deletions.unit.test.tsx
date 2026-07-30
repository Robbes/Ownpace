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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeletionsResponse, ItemDeletion } from '@openmig/shared';
import {
  DELETIONS_MEANING,
  DELETION_CONFIRMATIONS,
  DELETION_GUIDANCE,
} from '@openmig/shared';

const { fetchDeletions, keepDeletion, applyDeletion, DecisionRefusedError } = vi.hoisted(() => {
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
    DecisionRefusedError,
  };
});

vi.mock('../services/operating-service', () => ({
  fetchDeletions,
  keepDeletion,
  applyDeletion,
  DecisionRefusedError,
}));

import Deletions from './Deletions';

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
    <QueryClientProvider client={qc}>
      <Deletions />
    </QueryClientProvider>,
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
    applyDeletion.mockResolvedValue({
      status: 'ok',
      action: 'apply',
      naturalKeyHash: 'h1',
      effect: 'Removed from the target.',
      kind: 'binned',
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
