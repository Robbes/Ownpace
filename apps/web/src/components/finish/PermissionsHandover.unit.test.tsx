// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The permission handover on Finish (workplan 0029 T4).
 *
 * The two things worth pinning: that the one class of right nobody can read
 * is said ON THE SCREEN and not only inside the downloaded document — a
 * person who never opens the file should still learn it — and that a refusal
 * renders the server's own words, because "this migration does not record
 * which mailbox it reads" is actionable and "the request failed" is not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { fetchPermissionReport } = vi.hoisted(() => ({ fetchPermissionReport: vi.fn() }));
vi.mock('../../services/operating-service', () => ({ fetchPermissionReport }));

import PermissionsHandover from './PermissionsHandover.tsx';

beforeEach(() => {
  vi.clearAllMocks();
  fetchPermissionReport.mockResolvedValue('# Who can see what');
  // jsdom has no object URLs; the component only needs them not to throw.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  });
});

describe('what it says before anybody clicks', () => {
  it('tells the owner to do this BEFORE delivery moves', () => {
    render(<PermissionsHandover mappingId="m1" />);

    // Rights carried across afterwards were missing for however long that
    // took — the whole reason this sits above the numbered steps.
    expect(screen.getByText(/before you move delivery/i)).toBeInTheDocument();
    expect(screen.getByText(/rights added afterwards were missing/i)).toBeInTheDocument();
  });

  it('names the blind spot on screen, not only inside the document', () => {
    render(<PermissionsHandover mappingId="m1" />);

    // Somebody who never opens the file should still learn that FullAccess
    // and Send-As cannot be read at all.
    expect(screen.getByText(/FullAccess or Send-As/)).toBeInTheDocument();
    expect(screen.getByText(/does not expose that to us at all/)).toBeInTheDocument();
  });

  it('does not promise file sharing this installation may not have read', () => {
    render(<PermissionsHandover mappingId="m1" />);

    // `Files.Read.All` is not consented by default (owner decision
    // 2026-08-04), so drive sharing is a stated blind spot in most
    // deployments. The panel used to read as though the list always covered
    // it — a promise the document then quietly did not keep.
    expect(screen.getByText(/OneDrive and SharePoint/)).toBeInTheDocument();
    expect(screen.getByText(/only included when this installation/)).toBeInTheDocument();
    // And it points at the document for the per-run answer, because that is
    // where the truth for THIS report lives.
    expect(screen.getByText(/which of the two it actually read/)).toBeInTheDocument();
  });
});

describe('fetching the list', () => {
  it('asks for the report by mapping, not by a retyped address', async () => {
    render(<PermissionsHandover mappingId="m-42" />);

    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));

    await waitFor(() => expect(fetchPermissionReport).toHaveBeenCalledWith('m-42'));
  });

  it("renders the server's own refusal, which is the actionable one", async () => {
    fetchPermissionReport.mockRejectedValue({
      response: {
        data: {
          message:
            'This migration does not record which mailbox it reads, so its permissions cannot be inventoried.',
        },
      },
    });
    render(<PermissionsHandover mappingId="m1" />);

    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));

    expect(
      await screen.findByText(/does not record which mailbox it reads/),
    ).toBeInTheDocument();
  });

  it('falls back to its own words when the server said nothing useful', async () => {
    fetchPermissionReport.mockRejectedValue(new Error('Network Error'));
    render(<PermissionsHandover mappingId="m1" />);

    await userEvent.click(screen.getByRole('button', { name: /permission list/i }));

    // Never silent: a button that does nothing reads as "there is nothing".
    expect(await screen.findByText(/could not be fetched/)).toBeInTheDocument();
  });
});
