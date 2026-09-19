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
 *
 * And the three the owner found on the live page once the fold worked
 * (2026-09-19) — a fold that is READ wrongly has not finished the job:
 *
 *  5. **The comparison key on screen.** `grantee:role` is machinery. Printed
 *     beside a folder called `2017 Q2` it reads as an email address with a
 *     month stuck on the end, which is exactly how the owner read it.
 *  6. **Five folders with one name.** A container we never listed gets no name
 *     invented for it — and five rows of `One folder (not itself shared)`
 *     identify none of them. A sample of what is inside does.
 *  7. **A sentence between the tiles.** The reason a row stands apart sat
 *     ABOVE the card it was about, so it pointed at nothing. It belongs in the
 *     card, on the row it explains, once.
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
      screen.getByText(/extra: stranger@example\.test \(writer\)/),
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

describe('words, not the key the fold compares on', () => {
  it('names who the folder is shared with, and never shows the key', async () => {
    answerWith(folderWithChildren(3));
    renderScreen();

    expect(await screen.findByText('Foto shoot Emma')).toBeInTheDocument();
    expect(screen.getByText(/anna@example\.test \(writer\)/)).toBeInTheDocument();
    // `grantee:role` is what two items are COMPARED on. It is not language.
    expect(screen.queryByText(/anna@example\.test:writer/)).not.toBeInTheDocument();
  });

  it('keeps the folder name and who it is shared with apart', async () => {
    // The owner read `2017 Q2  b.berentsen@gmail.com:writer` as one string and
    // asked why an email address had grown a month on the end of it. They are
    // two facts and they get two lines, each labelled.
    answerWith(folderWithChildren(3));
    renderScreen();

    const label = await screen.findByText('Shared with');
    expect(label).toBeInTheDocument();
    expect(screen.getByText('Foto shoot Emma').closest('p')).not.toBe(label.closest('p'));
  });

  it('says a link grant in words too', async () => {
    answerWith([
      row({
        id: 'link-folder',
        itemKey: 'F',
        parentKey: 'root',
        isContainer: true,
        onLabel: 'Public',
        grantee: undefined,
        viaLink: true,
        role: 'reader',
      }),
      row({
        id: 'link-child',
        itemKey: 'c0',
        parentKey: 'F',
        onLabel: 'Poster.pdf',
        grantee: undefined,
        viaLink: true,
        role: 'reader',
      }),
    ]);
    renderScreen();

    expect(await screen.findByText(/anyone with the link \(reader\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(link\):reader/)).not.toBeInTheDocument();
  });
});

describe('two folders we could not name are not the same line', () => {
  /**
   * A container is named only when it is ITSELF shared — a folder can hold
   * shared files without being shared, and naming one we never listed would be
   * a claim about a folder nobody read. So five of the owner's groups read
   * `One folder (not itself shared)`, identically, and one of them was the
   * Drive root. A SAMPLE of what is inside tells them apart without claiming
   * anything at all about the container.
   */
  it('identifies each by something demonstrably inside it', async () => {
    answerWith([
      row({ id: 'a1', itemKey: 'i1', parentKey: 'FA', onLabel: '2017 Q2' }),
      row({ id: 'a2', itemKey: 'i2', parentKey: 'FA', onLabel: '2017 Q3' }),
      row({ id: 'b1', itemKey: 'i3', parentKey: 'FB', onLabel: 'Taxes.pdf' }),
      row({ id: 'b2', itemKey: 'i4', parentKey: 'FB', onLabel: 'Ute.pdf' }),
    ]);
    renderScreen();

    expect(await screen.findAllByText('One folder (not itself shared)')).toHaveLength(2);
    expect(screen.getByText(/holds 2017 Q2/)).toBeInTheDocument();
    expect(screen.getByText(/holds Taxes\.pdf/)).toBeInTheDocument();
  });

  it('never points at the folder itself when the folder has a name', async () => {
    answerWith(folderWithChildren(3));
    renderScreen();

    expect(await screen.findByText('Foto shoot Emma')).toBeInTheDocument();
    expect(screen.queryByText(/holds/)).not.toBeInTheDocument();
  });
});

describe('the reason a row stands apart is in the row', () => {
  /** One item, three people, three rows — and ONE reason it is not folded. */
  const onePlaceless = (): ShareGrantRow[] => [
    ...folderWithChildren(2),
    row({ id: 'l1', itemKey: 'loose', onLabel: 'Somewhere.pdf', grantee: 'anna@example.test' }),
    row({ id: 'l2', itemKey: 'loose', onLabel: 'Somewhere.pdf', grantee: 'bob@example.test' }),
    row({ id: 'l3', itemKey: 'loose', onLabel: 'Somewhere.pdf', grantee: 'cara@example.test' }),
  ];

  it('sits inside the card it is about, not between the cards', async () => {
    answerWith(onePlaceless());
    renderScreen();

    const note = await screen.findByText(/did not say where this sits/);
    // The folder is shut, so every `Mark done` on screen belongs to one of the
    // three loose rows. The sentence must live in the same tile as the presses
    // it explains — it used to sit above the tile, pointing at nothing.
    const cards = screen.getAllByText('Mark done').map((b) => b.closest('li'));
    expect(cards).toHaveLength(3);
    expect(note.closest('li')).toBe(cards[0]);
  });

  it('is said once over the item, not once per grant', async () => {
    answerWith(onePlaceless());
    renderScreen();

    await screen.findByText(/did not say where this sits/);
    expect(screen.getAllByText(/did not say where this sits/)).toHaveLength(1);
    // Every row is still there — one explanation, three rows to act on.
    expect(screen.getAllByText('Somewhere.pdf')).toHaveLength(3);
  });
});
