// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The move queue's aftermath section, pinned (0036 T2).
 *
 * Moves has rendered its "Already decided" half since #274 — the 0036 first
 * draft claimed otherwise and the fleet corrected it. This test exists so a
 * screen regressing to a silent success would be visible: each queue either
 * shows decided items or states why not, and this is Moves' proof.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { MOVES_MEANING, MOVE_GUIDANCE, type MovesResponse } from '@openmig/shared';

const { fetchMovesMock, applyMoveMock, fetchMoveApplyReceiptMock, isSelfHostMock } = vi.hoisted(
  () => ({
    fetchMovesMock: vi.fn(),
    applyMoveMock: vi.fn(),
    fetchMoveApplyReceiptMock: vi.fn(),
    isSelfHostMock: vi.fn(() => true),
  }),
);

vi.mock('../services/operating-service', () => ({
  fetchMoves: fetchMovesMock,
  keepMove: vi.fn(),
  applyMove: applyMoveMock,
  fetchMoveApplyReceipt: fetchMoveApplyReceiptMock,
  DecisionRefusedError: class extends Error {},
}));
vi.mock('../services/edition', () => ({ isSelfHost: isSelfHostMock }));

import Moves from './Moves.tsx';

const MOVE = {
  naturalKeyHash: 'h-m1',
  domain: 'email' as const,
  from: 'INBOX/Projects',
  to: 'Archive/2026',
};

const GUIDANCE = {
  keep: 'Leave the copy where it is.',
  byHand: 'Move it yourself on the new system.',
  doNothing: 'It stays listed here.',
};

function queue(over: Partial<MovesResponse['x']> = {}): MovesResponse {
  return {
    'acme-mail': {
      migrationStatus: 'active',
      // Before cutover: no kind is past it (the cases after it set their own).
      afterCutover: [],
      open: [],
      acknowledged: [],
      whatThisMeans: 'The old system reorganised these after we copied them.',
      howToResolve: GUIDANCE,
      ...over,
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

beforeEach(() => {
  vi.clearAllMocks();
  isSelfHostMock.mockReturnValue(true);
});

describe('the aftermath section (0036 T2 pin)', () => {
  it('renders "Already decided" with the acknowledged items', async () => {
    fetchMovesMock.mockResolvedValue(
      queue({
        acknowledged: [{ ...MOVE, acknowledgedAt: '2026-08-01T00:00:00Z' }],
      }),
    );
    renderScreen();

    expect(
      await screen.findByRole('heading', { name: /Already decided\s*\(1\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('INBOX/Projects')).toBeInTheDocument();
  });

  it('states the empty aftermath instead of hiding the section', async () => {
    fetchMovesMock.mockResolvedValue(queue());
    renderScreen();

    expect(await screen.findByText('Nothing has been decided yet.')).toBeInTheDocument();
  });
});

/**
 * A row under *Already decided* says what was decided (workplan 0159 §6 item
 * 6): left where it is, or its old copy removed on the new system. The ledger
 * closes a move the same way for *Leave it where it is* and for *Remove the
 * old copy*, so only the server's `decided` can say which, and the heading
 * stays the owner's *Already decided*. With *the automatic removal of moved
 * files' old copies* on, a removal can be one nobody pressed, and the row is
 * the only place that says so.
 */
describe('a row already decided says what was decided', () => {
  const answered = () =>
    queue({
      acknowledged: [
        { ...MOVE, naturalKeyHash: 'h-left', acknowledgedAt: '2026-10-01T00:00:00Z', decided: 'kept' },
        {
          ...MOVE,
          naturalKeyHash: 'h-removed',
          from: 'Docs',
          to: 'Docs',
          toNaturalKeyHash: 'h-removed-new',
          acknowledgedAt: '2026-10-01T00:00:00Z',
          decided: 'applied',
        },
        { ...MOVE, naturalKeyHash: 'h-untold', acknowledgedAt: '2026-10-01T00:00:00Z' },
      ],
    });
  const rowOf = async (hash: string) => (await screen.findByText(hash)).closest('li')!;

  afterEach(() => {
    window.localStorage.removeItem('ownpace.locale');
  });

  it('says left where it is, or the old copy removed, each on its own row', async () => {
    fetchMovesMock.mockResolvedValue(answered());
    renderScreen();

    const LEFT = 'Left where it is on the new system';
    const REMOVED = 'Old copy removed on the new system';
    expect(within(await rowOf('h-left')).getByText(LEFT)).toBeInTheDocument();
    expect(within(await rowOf('h-removed')).getByText(REMOVED)).toBeInTheDocument();
    const untold = (await rowOf('h-untold')).textContent ?? '';
    for (const word of [LEFT, REMOVED]) expect(untold).not.toContain(word);
    expect(screen.getByRole('heading', { name: /Already decided\s*\(3\)/ })).toBeInTheDocument();
  });

  it('says it in Dutch', async () => {
    fetchMovesMock.mockResolvedValue(answered());
    window.localStorage.setItem('ownpace.locale', 'nl');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <LocaleProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <Moves receiptPollMs={10} />
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(within(await rowOf('h-left')).getByText('Blijft staan op het nieuwe systeem')).toBeInTheDocument();
    expect(
      within(await rowOf('h-removed')).getByText('Oude kopie verwijderd op het nieuwe systeem'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Al besloten\s*\(3\)/ })).toBeInTheDocument();
  });
});

/**
 * On a phone the row is narrow, and a path that may only shrink shrank to a
 * letter or two (the UX sweep, 2026-10-17: 'INBOX/Projects → Archive/2026'
 * drew 43 px wide). The path wraps onto its own line now, at its slashes, and
 * keeps its whole value in the title. jsdom draws no layout, so this holds the
 * classes that decide it.
 */
describe('a path on a narrow screen', () => {
  it('wraps instead of being cut off, and still reads as the whole path', async () => {
    fetchMovesMock.mockResolvedValue(queue({ open: [MOVE] }));
    renderScreen();

    // The slashes are break points, and the path is still one text.
    const from = await screen.findByText('INBOX/Projects');
    const to = screen.getByText('Archive/2026');
    for (const path of [from, to]) {
      expect(path.className).not.toMatch(/\btruncate\b/);
      expect(path.className).toMatch(/\bbreak-words\b/);
      expect(path.querySelector('wbr')).not.toBeNull();
    }
    expect(from.getAttribute('title')).toBe('INBOX/Projects');
    // The pair takes a line of its own rather than shrinking beside the chips.
    const pair = from.parentElement!;
    expect(pair.className).toMatch(/min-w-\[12rem\]/);
    expect(pair.className).toMatch(/\bflex-wrap\b/);
    expect(pair.className).not.toMatch(/\bmin-w-0\b/);
  });

  it('prints the age of a report in a grey that can be read', async () => {
    // gray-400 is 2.5:1 on white; the queues' other small print is gray-500.
    fetchMovesMock.mockResolvedValue(
      queue({ open: [{ ...MOVE, recordedAt: '2026-08-01T00:00:00Z' }] }),
    );
    renderScreen();

    const row = (await screen.findByText('INBOX/Projects')).closest('li')!;
    // The one titled span that is not a path: the age, with its date as title.
    const [age, ...more] = [...row.querySelectorAll<HTMLElement>('span[title]')].filter(
      (s) => s.title !== MOVE.from && s.title !== MOVE.to,
    );
    expect(more).toEqual([]);
    expect(age!.className).toMatch(/\btext-gray-500\b/);
    expect(age!.className).not.toMatch(/\btext-gray-400\b/);
  });
});

/**
 * The destructive action, and — mostly — its absence (ADR-0030).
 *
 * `apply` removes the target's OLD copy, and it is admissible only for a
 * RELOCATION: a move that changed the item's natural key, so the same bytes are
 * already on the target under the new one. Every other move must not offer it
 * at all, because for those there is nothing to point at and removing the copy
 * would simply destroy it.
 */
describe('the relocation apply button', () => {
  const RELOCATION = {
    naturalKeyHash: 'Docs/report.pdf',
    domain: 'file' as const,
    from: 'Docs',
    to: 'Docs',
    toNaturalKeyHash: 'Docs/summary.pdf',
  };

  it('is offered for a relocation', async () => {
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    expect(await screen.findByRole('button', { name: /Remove the old copy/ })).toBeInTheDocument();
  });

  it('is NOT offered for a move that kept its key — there is nothing to point at', async () => {
    // Every mail and calendar move. Removing the target copy on the strength of
    // one of these would destroy the only copy under our control.
    fetchMovesMock.mockResolvedValue(queue({ open: [MOVE] }));
    renderScreen();

    expect(await screen.findByRole('button', { name: /Leave it where it is/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the old copy/ })).not.toBeInTheDocument();
  });

  it('is offered in the managed edition too, where the outcome arrives on a RECEIPT', async () => {
    // The queued job (`run-apply-relocation`) exists now, so the button does
    // too — and the row must track the receipt to its terminal state rather
    // than pretend the 202 was an outcome. The removal has not happened when
    // the response arrives; saying "removed" then would be a false report
    // about the one thing this product destroys.
    isSelfHostMock.mockReturnValue(false);
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    applyMoveMock.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-16T08:00:00Z' },
    });
    // DETERMINISTIC, not fast: the poll's answer is held until the queued
    // state has been asserted. A resolved mock raced testing-library's own
    // 50ms polling on a slow runner — the 10ms queued window slipped between
    // its ticks and the assertion found only the terminal state (CI-only
    // flake, first seen on this test's first CI run).
    let releaseReceipt!: (r: unknown) => void;
    fetchMoveApplyReceiptMock.mockImplementation(
      () => new Promise((resolve) => { releaseReceipt = resolve as (r: unknown) => void; }),
    );
    renderScreen();

    const button = await screen.findByRole('button', { name: /Remove the old copy/ });
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button', { name: /Confirm removal/ }));

    // Queued first — the honest state, held visible until asserted. The badge
    // renders from the 202 itself; the first POLL only fires after the seam's
    // 10ms, so wait for it before releasing its answer.
    expect(await screen.findByText(/Removal requested/)).toBeInTheDocument();
    await waitFor(() => expect(fetchMoveApplyReceiptMock).toHaveBeenCalled());
    releaseReceipt({
      state: 'applied',
      kind: 'deleted',
      requestedAt: '2026-08-16T08:00:00Z',
      finishedAt: '2026-08-16T08:00:02Z',
    });
    // The terminal sentence, not the requested one (which says *removed* too).
    expect(await screen.findByText(/^Removed — gone/)).toBeInTheDocument();
    expect(fetchMoveApplyReceiptMock).toHaveBeenCalledWith('acme-mail', 'Docs/report.pdf');
  });

  it('a refused receipt reaches the row in the gate\'s own words', async () => {
    // The refusals only the worker can produce (the target cannot confirm the
    // arrival; the owner edited our copy) land on the receipt — and the row
    // must show the sentence, not a generic failure.
    isSelfHostMock.mockReturnValue(false);
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    applyMoveMock.mockResolvedValue({
      mode: 'queued',
      receipt: { state: 'queued', requestedAt: '2026-08-16T08:00:00Z' },
    });
    fetchMoveApplyReceiptMock.mockResolvedValue({
      state: 'refused',
      code: 'relocation_unconfirmed',
      reason: 'The target does not have the relocated copy, whatever the ledger says.',
      requestedAt: '2026-08-16T08:00:00Z',
      finishedAt: '2026-08-16T08:00:02Z',
    });
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Remove the old copy/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm removal/ }));

    expect(
      await screen.findByText(/does not have the relocated copy/),
    ).toBeInTheDocument();
  });

  it('ARMS before it acts — one click never removes anything', async () => {
    // The server's own words come back on the decision and are shown verbatim,
    // so the mock resolves the real shape rather than `undefined`: a mock that
    // does not answer what the caller awaits proves the wrong thing, and here
    // it threw inside the click handler while the assertions still passed.
    applyMoveMock.mockResolvedValue({
      mode: 'immediate',
      result: {
        status: 'ok',
        action: 'apply',
        naturalKeyHash: 'Docs/report.pdf',
        effect: 'The old copy has been removed from the target.',
      },
    });
    fetchMovesMock.mockResolvedValue(queue({ open: [RELOCATION] }));
    renderScreen();

    const button = await screen.findByRole('button', { name: /Remove the old copy/ });
    fireEvent.click(button);

    expect(applyMoveMock, 'the first click only arms it').not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Confirm removal/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm removal/ }));
    expect(applyMoveMock).toHaveBeenCalledWith('acme-mail', 'Docs/report.pdf');
    // And the outcome reaches the screen — the row stops offering the action
    // and says what happened, in the server's words.
    expect(
      await screen.findByText('The old copy has been removed from the target.'),
    ).toBeInTheDocument();
  });

  it('says a rename is a rename, instead of printing a SHA-256 at the operator', async () => {
    // "Docs → Docs" says nothing about what changed, so this row used to render
    // `toNaturalKeyHash` in the destination's place. That is a sha256 of the new
    // path — `fileNaturalKeyHash` — not the new path, so the row read
    // `Docs → 9f2c…` and named nothing anybody could recognise.
    //
    // The old test could not see it, because its fixture put `Docs/summary.pdf`
    // in that field: a hash-shaped hole filled with a path-shaped string, which
    // made a row that prints a hex digest look like one that prints a filename.
    // This one uses what the field actually carries.
    const HASH = '9f2c1b6a4e7d0c3f8a5b2e9d6c1f4a7b0e3d6c9f2a5b8e1d4c7f0a3b6e9d2c5f';
    fetchMovesMock.mockResolvedValue(
      queue({ open: [{ ...RELOCATION, toNaturalKeyHash: HASH }] }),
    );
    renderScreen();

    expect(await screen.findByText('renamed')).toBeInTheDocument();
    expect(screen.queryByText(HASH), 'never the digest').not.toBeInTheDocument();
    expect(screen.queryByText(HASH.slice(0, 12), { exact: false })).not.toBeInTheDocument();
  });

  it('still shows the destination folder for a move that changed one', async () => {
    // The other half: a real move has somewhere to point at, and hiding it
    // would make the queue unusable for the case it was built for.
    fetchMovesMock.mockResolvedValue(
      queue({ open: [{ ...RELOCATION, to: 'Archive/2026', toNaturalKeyHash: 'h-new' }] }),
    );
    renderScreen();

    expect(await screen.findByText('Archive/2026')).toBeInTheDocument();
    expect(screen.queryByText('renamed')).not.toBeInTheDocument();
  });
});

/**
 * After cutover (2026-10-05): no remove button for a kind past its cutover.
 * See the same section of `Deletions.unit.test.tsx`; the owner chose "Refuse
 * after cutover (Recommended)".
 */
describe('after cutover', () => {
  const RELOCATION = {
    naturalKeyHash: 'Docs/report.pdf',
    domain: 'file' as const,
    from: 'Docs',
    to: 'Docs',
    toNaturalKeyHash: 'Docs/summary.pdf',
  };

  it('offers no remove for a relocation of a kind past its cutover, says why, and still offers leave', async () => {
    fetchMovesMock.mockResolvedValue(queue({ afterCutover: ['file'], open: [RELOCATION] }));
    renderScreen();

    // Names the data type whose rows lost the button, in its screen name.
    expect(
      await screen.findByText(STRINGS.en['queue.afterCutover'].replace('{dataTypes}', 'Files')),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave it where it is/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the old copy/ })).not.toBeInTheDocument();
  });

  it('still offers it for a kind that has not been cut over', async () => {
    fetchMovesMock.mockResolvedValue(queue({ afterCutover: ['email'], open: [RELOCATION] }));
    renderScreen();

    expect(await screen.findByRole('button', { name: /Remove the old copy/ })).toBeInTheDocument();
    // No row lost its button, so there is nothing to explain.
    expect(screen.queryByText(/Past the cutover of/)).not.toBeInTheDocument();
  });
});

/**
 * *What this means and what you can do* showed the operator's guidance from
 * the API, word for word: `POST /mappings/{mappingId}/moves/…/keep` and
 * `toNaturalKeyHash`, in English, under a Dutch heading (the UX sweep,
 * 2026-10-17). The owner chose words for the person reading it (2026-10-18),
 * kept beside the operator's in `@openmig/shared`; the API still serves its
 * own, as the fixture here does.
 */
describe('what this means and what you can do', () => {
  const API_WORDS = /POST |\/mappings\/|naturalKeyHash|toNaturalKeyHash|apply/;
  const served = () => queue({ whatThisMeans: MOVES_MEANING, howToResolve: MOVE_GUIDANCE });

  afterEach(() => {
    window.localStorage.removeItem('ownpace.locale');
  });

  it('tells a Dutch reader what the rows are and what each button does, in Dutch', async () => {
    fetchMovesMock.mockResolvedValue(served());
    window.localStorage.setItem('ownpace.locale', 'nl');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <LocaleProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <Moves receiptPollMs={10} />
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );

    const fold = (await screen.findByText('Wat dit betekent en wat u kunt doen')).closest('details')!;
    const text = fold.textContent ?? '';
    expect(text).toContain(
      'Deze items zijn op het oude systeem naar een andere map verplaatst. Op het nieuwe systeem staan ze nog waar wij ze neerzetten.',
    );
    expect(text).toContain('Laat staan: aan geen van beide kanten verandert iets.');
    expect(text).toContain(
      'Verwijder de oude kopie (alleen bestanden): het bestand staat al in de nieuwe map op het nieuwe systeem; dit verwijdert de kopie in de oude map.',
    );
    expect(text).toContain('Of verplaats het zelf op het nieuwe systeem en druk daarna op Laat staan.');
    expect(text).not.toMatch(API_WORDS);
  });

  it('tells an English reader the same, and never the API’s paths', async () => {
    fetchMovesMock.mockResolvedValue(served());
    renderScreen();

    const fold = (await screen.findByText('What this means and what you can do')).closest('details')!;
    const text = fold.textContent ?? '';
    expect(text).toContain(
      'These items were moved to another folder on the old system. On the new system they are still where we put them.',
    );
    expect(text).toContain('Leave it where it is: nothing changes on either side.');
    expect(text).toContain(
      'Remove the old copy (files only): the file is already in its new folder on the new system; this deletes the copy in the old folder.',
    );
    expect(text).toContain('Or move it yourself on the new system, then press Leave it where it is.');
    expect(text).not.toMatch(API_WORDS);
  });
});
