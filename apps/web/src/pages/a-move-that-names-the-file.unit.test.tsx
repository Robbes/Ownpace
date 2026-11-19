// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MOVE THAT NAMES THE FILE (the owner, 2026-11-19).
 *
 * Testing a Google to Nextcloud migration, the owner was shown one row on
 * *Moved on the old system*:
 *
 *     Files   / renamed          ID 68524b1d65c5   last month
 *
 * *"I find it a bit weird it just mentions '/'. As I use it I need more info,
 * like a name, to be able to understand what I need to decide on."* The row
 * asks whether to remove the old copy on the new system, and said nothing about
 * which file. The server now sends the names the ledger already held
 * (`displayName`, `toDisplayName`), and the row says them:
 *
 *  - a renamed file reads `/Docs/report.pdf → report-final.pdf`;
 *  - a moved file reads its name in both folders;
 *  - a message or an event leads with its name, before its folders;
 *  - a row from before the names were recorded reads exactly as it did.
 *
 * The ID stays, folded, and is still what every button posts. Every file,
 * folder, event and message here is invented.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUEUE_EFFECTS, decisionEffectFields, type ItemMove, type MovesResponse } from '@openmig/shared';

const { fetchMovesMock, keepMoveMock, applyMoveMock, fetchMoveApplyReceiptMock } = vi.hoisted(() => ({
  fetchMovesMock: vi.fn(),
  keepMoveMock: vi.fn(),
  applyMoveMock: vi.fn(),
  fetchMoveApplyReceiptMock: vi.fn(),
}));

vi.mock('../services/operating-service', () => ({
  fetchMoves: fetchMovesMock,
  keepMove: keepMoveMock,
  applyMove: applyMoveMock,
  fetchMoveApplyReceipt: fetchMoveApplyReceiptMock,
  DecisionRefusedError: class extends Error {},
}));
vi.mock('../services/edition', () => ({ isSelfHost: () => true }));

import Moves from './Moves.tsx';

function queue(open: ItemMove[]): MovesResponse {
  return {
    'acme-files': {
      migrationStatus: 'active',
      afterCutover: [],
      open,
      acknowledged: [],
      whatThisMeans: 'The old system reorganised these after we copied them.',
      howToResolve: { keep: 'Leave it.', byHand: 'Move it yourself.', doNothing: 'It stays listed.' },
    },
  };
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Moves receiptPollMs={10} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The row of one item, found by its ID chip, which every row keeps. */
const rowOf = async (hash: string) => (await screen.findByTitle(hash)).closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a renamed file shows its old name and its new one', () => {
  const RENAMED: ItemMove = {
    domain: 'file',
    naturalKeyHash: 'h-renamed',
    displayName: 'report.pdf',
    from: 'Docs',
    to: 'Docs',
    toNaturalKeyHash: 'h-renamed-new',
    toDisplayName: 'report-final.pdf',
  };

  it('as its path, an arrow and its new name, with the folder said once', async () => {
    fetchMovesMock.mockResolvedValue(queue([RENAMED]));
    renderScreen();

    const row = await rowOf('h-renamed');
    expect(within(row).getByText('/Docs/report.pdf')).toBeInTheDocument();
    expect(within(row).getByText('report-final.pdf')).toHaveAttribute('title', '/Docs/report-final.pdf');
    // Named, so no longer only "renamed".
    expect(within(row).queryByText('renamed')).not.toBeInTheDocument();
  });

  it("at the top of a drive, where the row used to say only '/'", async () => {
    fetchMovesMock.mockResolvedValue(
      queue([{ ...RENAMED, naturalKeyHash: 'h-top', from: '/', to: '/', displayName: 'notes.txt', toDisplayName: 'notes-2026.txt' }]),
    );
    renderScreen();

    const row = await rowOf('h-top');
    expect(within(row).getByText('/notes.txt')).toBeInTheDocument();
    expect(within(row).getByText('notes-2026.txt')).toBeInTheDocument();
    expect(within(row).queryByText('/')).not.toBeInTheDocument();
  });

  it('keeps its ID, which is still what Leave it where it is posts', async () => {
    fetchMovesMock.mockResolvedValue(queue([RENAMED]));
    keepMoveMock.mockResolvedValue({
      status: 'ok',
      action: 'keep',
      naturalKeyHash: 'h-renamed',
      ...decisionEffectFields(QUEUE_EFFECTS.moveKept),
    });
    renderScreen();

    const row = await rowOf('h-renamed');
    expect(within(row).getByText('h-renamed')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Leave it where it is' }));
    await waitFor(() => expect(keepMoveMock).toHaveBeenCalledWith('acme-files', 'h-renamed'));
  });

  it('says renamed after its old name, when the new one was not recorded', async () => {
    const { toDisplayName: _unrecorded, ...oldOnly } = RENAMED;
    fetchMovesMock.mockResolvedValue(queue([oldOnly]));
    renderScreen();

    const row = await rowOf('h-renamed');
    expect(within(row).getByText('/Docs/report.pdf')).toBeInTheDocument();
    expect(within(row).getByText('renamed')).toBeInTheDocument();
  });
});

describe('a moved file shows its name with both folders', () => {
  it('as two paths', async () => {
    fetchMovesMock.mockResolvedValue(
      queue([
        {
          domain: 'file',
          naturalKeyHash: 'h-moved',
          displayName: 'plan.pdf',
          from: 'Docs',
          to: 'Archive/2026',
          toNaturalKeyHash: 'h-moved-new',
          toDisplayName: 'plan.pdf',
        },
      ]),
    );
    renderScreen();

    const row = await rowOf('h-moved');
    expect(within(row).getByText('/Docs/plan.pdf')).toHaveAttribute('title', '/Docs/plan.pdf');
    expect(within(row).getByText('/Archive/2026/plan.pdf')).toHaveAttribute('title', '/Archive/2026/plan.pdf');
    // A relocation still offers removing the old copy.
    expect(within(row).getByRole('button', { name: /Remove the old copy/ })).toBeInTheDocument();
  });
});

describe('a message and an event lead with their names', () => {
  it('before their folders, which stay as they were', async () => {
    fetchMovesMock.mockResolvedValue(
      queue([
        { domain: 'email', naturalKeyHash: 'h-mail', displayName: 'Quarterly figures', from: 'INBOX/Projects', to: 'Archive/2026' },
        { domain: 'calendar', naturalKeyHash: 'h-event', displayName: 'Dentist', from: 'Personal', to: 'Work' },
      ]),
    );
    renderScreen();

    const mail = await rowOf('h-mail');
    expect(within(mail).getByText('Quarterly figures')).toBeInTheDocument();
    expect(within(mail).getByText('INBOX/Projects')).toBeInTheDocument();
    expect(within(mail).getByText('Archive/2026')).toBeInTheDocument();
    const event = await rowOf('h-event');
    expect(within(event).getByText('Dentist')).toBeInTheDocument();
    expect(within(event).getByText('Personal')).toBeInTheDocument();
    // Neither changed its key, so neither may remove anything.
    expect(within(mail).queryByRole('button', { name: /Remove the old copy/ })).not.toBeInTheDocument();
  });
});

describe('a row from before the names were recorded still renders', () => {
  it('a rename as its folder and "renamed", a move as folder to folder, both as before', async () => {
    fetchMovesMock.mockResolvedValue(
      queue([
        { domain: 'file', naturalKeyHash: 'h-old-rename', from: 'Docs', to: 'Docs', toNaturalKeyHash: 'h-old-rename-new' },
        { domain: 'file', naturalKeyHash: 'h-old-move', from: 'Docs', to: 'Archive', toNaturalKeyHash: 'h-old-move-new' },
        { domain: 'email', naturalKeyHash: 'h-old-mail', from: 'INBOX', to: 'Archive' },
      ]),
    );
    renderScreen();

    const rename = await rowOf('h-old-rename');
    expect(within(rename).getByText('Docs')).toHaveAttribute('title', 'Docs');
    expect(within(rename).getByText('renamed')).toBeInTheDocument();
    const move = await rowOf('h-old-move');
    expect(within(move).getByText('Docs')).toBeInTheDocument();
    expect(within(move).getByText('Archive')).toBeInTheDocument();
    const mail = await rowOf('h-old-mail');
    expect(within(mail).getByText('INBOX')).toBeInTheDocument();
    // Nothing invented in a name's place: no slash-led path on any of them.
    for (const row of [rename, move, mail]) {
      expect(row.textContent).not.toMatch(/\/(Docs|Archive|INBOX)\//);
    }
    // And the relocations still offer their button.
    expect(within(rename).getByRole('button', { name: /Remove the old copy/ })).toBeInTheDocument();
  });

  it('a rename whose old row predates names, and whose new copy has one, reads folder to new path', async () => {
    // The old copy was written before 2026-09-12, the new one after: say the
    // half that is known, and leave the other side its folder.
    fetchMovesMock.mockResolvedValue(
      queue([
        {
          domain: 'file',
          naturalKeyHash: 'h-half',
          from: 'Docs',
          to: 'Docs',
          toNaturalKeyHash: 'h-half-new',
          toDisplayName: 'report-final.pdf',
        },
      ]),
    );
    renderScreen();

    const row = await rowOf('h-half');
    expect(within(row).getByText('Docs')).toHaveAttribute('title', 'Docs');
    expect(within(row).getByText('/Docs/report-final.pdf')).toBeInTheDocument();
    expect(within(row).queryByText('renamed')).not.toBeInTheDocument();
  });
});
