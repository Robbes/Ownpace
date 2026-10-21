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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ShareGrantRow } from '@openmig/shared';

const { fetchSharing, decideSharing, rescanSharing, applyShareFolder, DecisionRefusedError } =
  vi.hoisted(() => {
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
      applyShareFolder: vi.fn(),
      DecisionRefusedError,
    };
  });

vi.mock('../services/operating-service', () => ({
  fetchSharing,
  decideSharing,
  rescanSharing,
  applyShareFolder,
  DecisionRefusedError,
}));

import Sharing from './Sharing.tsx';
import { LocaleProvider } from '../i18n/index.tsx';

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
    expect(screen.getAllByText('Share on the new system').length).toBeGreaterThan(0);
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
    expect(screen.queryByText('Share on the new system')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Mark all done \(5\)/));
    await waitFor(() => expect(decideSharing).toHaveBeenCalledTimes(5));
    for (const call of decideSharing.mock.calls) {
      expect(call[2]).toEqual({ action: 'done' });
    }
  });

  it('counts only the rows still open', async () => {
    const rows = folderWithChildren(4);
    rows[1] = { ...rows[1]!, state: 'skipped', decidedBy: 'pat', decidedAt: '2026-09-18T13:00:00Z' };
    answerWith(rows);
    renderScreen();

    expect(await screen.findByText(/Mark all done \(4\)/)).toBeInTheDocument();
  });
});

describe('a mapping scanned before folders could be grouped', () => {
  /**
   * THE 482 CASE, one release earlier. Nothing is placed, so every row is
   * correctly "on its own" — and printing that sentence against each of them
   * would rebuild the wall in a new font. One line at the top, saying why,
   * and the list renders exactly as it did before this existed. A Microsoft
   * checklist is the same case for good: Microsoft never says where an item
   * sits.
   */
  it('says it once at the top, not once per row', async () => {
    answerWith([
      row({ id: 'a', onLabel: 'One.pdf' }),
      row({ id: 'b', onLabel: 'Two.pdf' }),
      row({ id: 'c', onLabel: 'Three.pdf' }),
    ]);
    renderScreen();

    // Why, in plain words: Microsoft never says which folder an item is in,
    // so "refresh to fold them" was a remedy that changed nothing (the owner,
    // 2026-10-18).
    expect(
      await screen.findByText('Not grouped by folder: your old system did not say which folder each item is in.'),
    ).toBeInTheDocument();
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
    // The owner read `2017 Q2  k.devries@example.com:writer` as one string and
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

/**
 * ONE PRESS OVER ONE FOLDER, and not one address further (owner's call,
 * 2026-09-19: "folder-level with a confirm-first gate").
 *
 * `done` and `skip` record a decision and reach nobody, which is why they have
 * always been offered over a whole folder. This one INVITES every person in
 * the folder the moment it lands, and cannot be unsent — so ADR-0032 §6's
 * confirm-per-grantee is what stands in front of it, at folder scale.
 *
 * The server holds the same gate (`applyShareGrantsInFolder`), so what is
 * guarded here is the screen's half: that nobody reaches the press without
 * having seen every address it will use, and that the addresses it sends are
 * the ones a person confirmed.
 */
describe('one press over one folder', () => {
  const openPanel = async () => {
    fireEvent.click(await screen.findByText('Share this folder on the new system'));
  };

  it('offers the press as a panel to open, never as a button that acts', async () => {
    answerWith(folderWithChildren(3));
    renderScreen();

    expect(await screen.findByText('Share this folder on the new system')).toBeInTheDocument();
    // Nothing about addresses until somebody asks for it: twenty folders each
    // showing their grantees would be the wall again.
    expect(screen.queryByLabelText('send to')).toBeNull();
    expect(applyShareFolder).not.toHaveBeenCalled();
  });

  it('will not offer the press until every address in the folder is confirmed', async () => {
    answerWith(folderWithChildren(3));
    renderScreen();
    await openPanel();

    expect(screen.getByLabelText('send to')).toBeInTheDocument();
    expect(screen.getByText('1 address still to check.')).toBeInTheDocument();
    // The outward-facing press is not on screen at all yet.
    expect(screen.queryByText(/Share this folder on the new system \(1\)/)).toBeNull();

    fireEvent.click(screen.getByText('Confirm'));
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.queryByText(/still to check/)).toBeNull();
    expect(
      screen.getByText('Share this folder on the new system (1)'),
    ).toBeInTheDocument();
  });

  it('sends where the person said, not where the source pointed', async () => {
    answerWith(folderWithChildren(3));
    applyShareFolder.mockResolvedValue({ status: 'ok', applied: [], refused: [] });
    renderScreen();
    await openPanel();

    fireEvent.change(screen.getByLabelText('send to'), {
      target: { value: 'anna@new-domain.test' },
    });
    fireEvent.click(screen.getByText('Confirm'));

    const press = screen.getByText('Share this folder on the new system (1)');
    // TWO PRESSES, because the invitations cannot be unsent. The first arms.
    fireEvent.click(press);
    expect(applyShareFolder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Press again to invite them all'));

    await waitFor(() =>
      expect(applyShareFolder).toHaveBeenCalledWith('m1', 'F', {
        'anna@example.test': 'anna@new-domain.test',
      }),
    );
  });

  it('never offers the press on a folder with nobody to confirm', async () => {
    // A link has no addressable audience, so there is no address to check and
    // nothing for this press to do. Offering it would be offering to do
    // nothing; the rows stay the checklist's, one at a time.
    answerWith([
      row({
        id: 'link-folder',
        itemKey: 'F',
        parentKey: 'root',
        isContainer: true,
        onLabel: 'Public',
        grantee: undefined,
        viaLink: true,
        verdict: 'manual',
        role: 'reader',
      }),
      row({
        id: 'link-child',
        itemKey: 'c0',
        parentKey: 'F',
        onLabel: 'Poster.pdf',
        grantee: undefined,
        viaLink: true,
        verdict: 'manual',
        role: 'reader',
      }),
    ]);
    renderScreen();

    expect(await screen.findByText('Public')).toBeInTheDocument();
    expect(screen.queryByText('Share this folder on the new system')).toBeNull();
    expect(
      screen.getByText('Open the folder to share items on the new system.'),
    ).toBeInTheDocument();
  });

  it('shows a refusal against the FOLDER, in the server\u2019s own words', async () => {
    answerWith(folderWithChildren(3));
    applyShareFolder.mockRejectedValue(
      new DecisionRefusedError(
        {
          error: 'not_cut_over',
          reason: 'Shares are applied at or after cutover, not before.',
        },
        409,
      ),
    );
    renderScreen();
    await openPanel();
    fireEvent.click(screen.getByText('Confirm'));
    fireEvent.click(screen.getByText('Share this folder on the new system (1)'));
    fireEvent.click(screen.getByText('Press again to invite them all'));

    expect(
      await screen.findByText(/Shares are applied at or after cutover/),
    ).toBeInTheDocument();
  });
});

/**
 * WHAT A FOLDER PRESS COULD NOT SHARE, AND WHY (workplan 0136 T3's row-level
 * half). The press answers 200 with the rows the new system refused, each
 * with our sentence in English and Dutch (`reason`, `reasonNl`), and they stay
 * open. The page used to drop that answer and refresh, so a tester whose new
 * Nextcloud refused (no such account, a 403, a sign-in it did not accept) saw
 * the same open rows and nothing else: it read as nothing happening.
 *
 * Said under the folder, because the rows are under its lid, and once per
 * person and reason: two hundred files refused for one person for one reason
 * are one line, or the answer is the wall this file exists to remove.
 */
describe('what a folder press could not share, and why', () => {
  const ANNA_EN = 'The new system refused this share (status 403). Reference 0136aa01.';
  const ANNA_NL = 'Het nieuwe systeem weigerde dit delen (status 403). Referentie 0136aa01.';
  const BOB_EN = 'The new system has no account with that address (status 404). Reference 0136aa01.';
  const BOB_NL = 'Het nieuwe systeem heeft geen account met dat adres (status 404). Referentie 0136aa01.';
  const OURS_EN = 'This target has no share API this tool speaks. Create the share by hand.';

  /** A shared folder and one file in it, each shared with anna and bob. */
  const folderForTwo = (): ShareGrantRow[] => [
    row({ id: 'fa', itemKey: 'F', parentKey: 'root', isContainer: true, onLabel: 'Foto shoot Emma' }),
    row({
      id: 'fb',
      itemKey: 'F',
      parentKey: 'root',
      isContainer: true,
      onLabel: 'Foto shoot Emma',
      grantee: 'bob@example.test',
    }),
    row({ id: 'ca', itemKey: 'c0', parentKey: 'F', onLabel: 'IMG_0.jpg' }),
    row({ id: 'cb', itemKey: 'c0', parentKey: 'F', onLabel: 'IMG_0.jpg', grantee: 'bob@example.test' }),
  ];

  /** Anna's folder refused (403), and both of bob's rows (no such account). */
  const twoRefusedFor = (nl: boolean) => ({
    status: 'ok',
    applied: [folderForTwo()[2]],
    refused: [
      {
        id: 'fa',
        on: 'Foto shoot Emma',
        grantee: 'anna@example.test',
        code: 'target_refused',
        reason: ANNA_EN,
        ...(nl ? { reasonNl: ANNA_NL } : {}),
      },
      ...(['fb', 'cb'] as const).map((id) => ({
        id,
        on: id === 'fb' ? 'Foto shoot Emma' : 'IMG_0.jpg',
        grantee: 'bob@example.test',
        code: 'target_refused',
        reason: BOB_EN,
        reasonNl: BOB_NL,
      })),
    ],
    leftForChecklist: { links: 0, manual: 0 },
    waitingForCutover: 0,
  });

  const allApplied = {
    status: 'ok',
    applied: folderForTwo(),
    refused: [],
    leftForChecklist: { links: 0, manual: 0 },
    waitingForCutover: 0,
  };

  const WORDS = {
    en: {
      press: 'Share this folder on the new system',
      confirm: 'Confirm',
      armed: 'Press again to invite them all',
    },
    nl: {
      press: 'Deze map delen op het nieuwe systeem',
      confirm: 'Bevestigen',
      armed: 'Bevestig nogmaals om iedereen uit te nodigen',
    },
  } as const;

  function renderIn(locale: 'en' | 'nl') {
    window.localStorage.setItem('ownpace.locale', locale);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <LocaleProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/mappings/m1/sharing']}>
            <Routes>
              <Route path="/mappings/:mappingId/sharing" element={<Sharing />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  /** Confirm both addresses, then the two presses. */
  async function pressFolder(locale: 'en' | 'nl') {
    const w = WORDS[locale];
    fireEvent.click(await screen.findByText(w.press));
    while (screen.queryAllByText(w.confirm).length > 0) {
      fireEvent.click(screen.getAllByText(w.confirm)[0]!);
    }
    fireEvent.click(screen.getByText(`${w.press} (2)`));
    fireEvent.click(screen.getByText(w.armed));
    await waitFor(() => expect(applyShareFolder).toHaveBeenCalled());
  }

  afterEach(() => window.localStorage.removeItem('ownpace.locale'));

  it('says under the folder which shares were refused, and why, once per person and reason', async () => {
    answerWith(folderForTwo());
    applyShareFolder.mockResolvedValue(twoRefusedFor(true));
    renderIn('en');
    await pressFolder('en');

    const heading = await screen.findByText(
      'Sharing on the new system did not work for 3 shares in this folder. Their rows stay open.',
    );
    const region = heading.closest('[role="status"]');
    expect(region).not.toBeNull();
    // Bob's two rows say one thing; they are one line, with how many.
    expect(screen.getAllByText(ANNA_EN)).toHaveLength(1);
    expect(screen.getAllByText(BOB_EN)).toHaveLength(1);
    expect(region!.textContent).toContain('anna@example.test · Foto shoot Emma');
    expect(region!.textContent).toContain('bob@example.test · 2 items');
    expect(region!.contains(screen.getByText(ANNA_EN))).toBe(true);
    expect(region!.contains(screen.getByText(BOB_EN))).toBe(true);
    // The folder is still shut, and the Dutch is not shown to an English reader.
    expect(screen.queryByText('IMG_0.jpg')).toBeNull();
    expect(screen.queryByText(ANNA_NL)).toBeNull();
    expect(screen.queryByText(BOB_NL)).toBeNull();
  });

  it('counts the shares, not the lines', async () => {
    answerWith(folderForTwo());
    applyShareFolder.mockResolvedValue({
      ...twoRefusedFor(true),
      refused: twoRefusedFor(true).refused.slice(1),
    });
    renderIn('en');
    await pressFolder('en');

    // Bob's two rows, one line.
    expect(
      await screen.findByText(
        'Sharing on the new system did not work for 2 shares in this folder. Their rows stay open.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(BOB_EN)).toHaveLength(1);
  });

  it('a Dutch reader reads the Dutch, and the English where no Dutch came, marked as English', async () => {
    answerWith(folderForTwo());
    applyShareFolder.mockResolvedValue({
      ...twoRefusedFor(false),
      refused: [
        ...twoRefusedFor(false).refused.slice(1),
        // A refusal of our own gates has no Dutch twin.
        { id: 'fa', on: 'Foto shoot Emma', grantee: 'anna@example.test', code: 'no_share_api', reason: OURS_EN },
      ],
    });
    renderIn('nl');
    await pressFolder('nl');

    expect(
      await screen.findByText(
        'Delen op het nieuwe systeem lukte niet voor 3 deelrechten in deze map. De regels blijven open.',
      ),
    ).toBeInTheDocument();
    const dutch = screen.getByText(BOB_NL);
    expect(dutch.closest('[lang="en"]')).toBeNull();
    expect(screen.queryByText(BOB_EN)).toBeNull();
    const english = screen.getByText(OURS_EN);
    expect(english.closest('[lang="en"]')).not.toBeNull();
  });

  it('says nothing when every share in the folder went through', async () => {
    answerWith(folderForTwo());
    applyShareFolder.mockResolvedValue(allApplied);
    renderIn('en');
    await pressFolder('en');

    await waitFor(() => expect(fetchSharing).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/did not work for/)).toBeNull();
    expect(screen.queryByText(ANNA_EN)).toBeNull();
    expect(screen.queryByText(BOB_EN)).toBeNull();
  });

  it('the next press clears what the last one said, even when it is refused as a whole', async () => {
    answerWith(folderForTwo());
    applyShareFolder.mockResolvedValueOnce(twoRefusedFor(true)).mockRejectedValueOnce(
      new DecisionRefusedError(
        { error: 'not_cut_over', reason: 'Shares are applied at or after cutover, not before.' },
        409,
      ),
    );
    renderIn('en');
    await pressFolder('en');
    expect(await screen.findByText(ANNA_EN)).toBeInTheDocument();

    // The confirmations stand, so the press is offered again at once.
    fireEvent.click(await screen.findByText(`${WORDS.en.press} (2)`));
    fireEvent.click(screen.getByText(WORDS.en.armed));
    expect(await screen.findByText(/Shares are applied at or after cutover/)).toBeInTheDocument();
    expect(screen.queryByText(ANNA_EN)).toBeNull();
    expect(screen.queryByText(BOB_EN)).toBeNull();
    expect(screen.queryByText(/did not work for/)).toBeNull();
  });

  it('a row settled since is no longer said to stay open', async () => {
    const after = folderForTwo().map((r) =>
      r.grantee === 'bob@example.test'
        ? { ...r, state: 'done_manual' as const, decidedBy: 'pat', decidedAt: '2026-09-18T13:00:00Z' }
        : r,
    );
    fetchSharing
      .mockResolvedValueOnce({
        migrationStatus: 'done',
        summary: { total: 4, open: 4, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
        grants: folderForTwo(),
      })
      .mockResolvedValue({
        migrationStatus: 'done',
        summary: { total: 4, open: 2, applied: 0, doneManual: 2, skipped: 0, openManual: 0 },
        grants: after,
      });
    applyShareFolder.mockResolvedValue(twoRefusedFor(true));
    renderIn('en');
    await pressFolder('en');

    expect(
      await screen.findByText(
        'Sharing on the new system did not work for 1 share in this folder. Its row stays open.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(ANNA_EN)).toBeInTheDocument();
    expect(screen.queryByText(BOB_EN)).toBeNull();
    // Nor in bob's own rows, once the folder is opened: they are settled.
    fireEvent.click(screen.getByRole('button', { name: /Foto shoot Emma/, expanded: false }));
    expect(screen.getAllByText(ANNA_EN)).toHaveLength(2);
    expect(screen.queryByText(BOB_EN)).toBeNull();
  });

  it('opening the folder shows each refused row its own reason', async () => {
    answerWith(folderForTwo());
    applyShareFolder.mockResolvedValue(twoRefusedFor(true));
    renderIn('en');
    await pressFolder('en');
    await screen.findByText(BOB_EN);

    fireEvent.click(screen.getByRole('button', { name: /Foto shoot Emma/, expanded: false }));
    // The folder's line, and the line in each of bob's two rows.
    expect(screen.getAllByText(BOB_EN)).toHaveLength(3);
    expect(screen.getAllByText(ANNA_EN)).toHaveLength(2);
    const rowCards = screen.getAllByText(BOB_EN).map((n) => n.closest('li'));
    expect(rowCards.filter((li) => li?.textContent?.includes('Mark done'))).toHaveLength(2);
  });
});
