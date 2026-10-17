// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The sharing checklist screen (ADR-0032, workplan 0052 T5/T6c).
 *
 * The server enforces every gate; these tests are about what is put in front
 * of a person: the progress line says how much is left, apply sends the
 * ADDRESS THE OWNER CONFIRMED (not blindly the source's), and one confirmed
 * correction prefills the same grantee's other rows — confirm once, not ten
 * times (§6).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ShareGrantRow } from '@openmig/shared';

const { fetchSharing, decideSharing, rescanSharing, DecisionRefusedError } = vi.hoisted(() => {
  class DecisionRefusedError extends Error {
    constructor(
      readonly refusal: { error: string; reason?: string; reasonNl?: string; hint?: string },
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
import { LocaleProvider } from '../i18n/index.tsx';

const row = (over: Partial<ShareGrantRow> & { id: string }): ShareGrantRow => ({
  grantHash: `hash-${over.id}`,
  subject: 'drive_item',
  onLabel: 'Projects/budget.xlsx',
  grantee: 'anna@old.example.nl',
  role: 'writer',
  viaLink: false,
  raw: '{"role":"writer"}',
  verdict: 'clean',
  verdictTarget: 'a person share on the target',
  state: 'open',
  scannedAt: '2026-08-16T12:00:00Z',
  ...over,
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

describe('the checklist', () => {
  it('shows the progress line and the manual-rows note', async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 3, open: 2, applied: 1, doneManual: 0, skipped: 0, openManual: 1 },
      grants: [
        row({ id: 'g1' }),
        row({ id: 'g2', verdict: 'manual', verdictTarget: 'do it by hand' }),
        row({ id: 'g3', state: 'applied', decidedBy: 'owner', decidedAt: '2026-08-16T13:00:00Z' }),
      ],
    });
    renderScreen();

    expect(await screen.findByText(/1 \/ 3 settled/)).toBeInTheDocument();
    expect(
      screen.getByText('1 row needs a step from you on the new system; mark it done here afterwards.'),
    ).toBeInTheDocument();
  });

  it('apply sends the address the owner corrected, not the source address', async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    decideSharing.mockResolvedValue({ status: 'ok', grant: row({ id: 'g1', state: 'applied' }) });
    renderScreen();

    const input = (await screen.findByDisplayValue('anna@old.example.nl')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'anna@new.example.nl' } });
    // Two-step: the first click arms, the second fires.
    const applyButton = screen.getByText('Share on the new system');
    fireEvent.click(applyButton);
    fireEvent.click(screen.getByText('Press again: this shares and sends an invitation'));

    await waitFor(() =>
      expect(decideSharing).toHaveBeenCalledWith('m1', 'g1', {
        action: 'apply',
        grantee: 'anna@new.example.nl',
      }),
    );
  });

  it("a confirmed correction prefills the same grantee's other rows (§6: confirm once)", async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 2, open: 2, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' }), row({ id: 'g2', onLabel: 'Projects/notes.md' })],
    });
    decideSharing.mockResolvedValue({ status: 'ok', grant: row({ id: 'g1', state: 'applied' }) });
    renderScreen();

    const inputs = await screen.findAllByDisplayValue('anna@old.example.nl');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0]!, { target: { value: 'anna@new.example.nl' } });
    const applyButtons = screen.getAllByText('Share on the new system');
    fireEvent.click(applyButtons[0]!);
    fireEvent.click(screen.getByText('Press again: this shares and sends an invitation'));
    await waitFor(() => expect(decideSharing).toHaveBeenCalled());

    // The OTHER row now proposes the confirmed address — the owner still
    // presses apply per row; only the retyping is saved.
    await waitFor(() =>
      expect(screen.getByDisplayValue('anna@new.example.nl')).toBeInTheDocument(),
    );
  });

  it('the apply press is armed, but not dressed as a delete', async () => {
    // THE OWNER, ON SIGHT: "why is it red and has a trashcan icon on it?"
    // It was reaching for `DestructiveButton`, which hardcodes red styling
    // and a Trash2 glyph. The ceremony is owed — this shares AND emails a
    // real person, and that cannot be unsent — but the signifier said the
    // opposite of what the press does.
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    renderScreen();

    const press = (await screen.findByText('Share on the new system')).closest('button')!;
    expect(press.className).not.toMatch(/red/);
    // No bin, in either state. `lucide-react` renders its name into the
    // class, so this catches the icon coming back by any route.
    expect(press.querySelector('svg')?.getAttribute('class') ?? '').not.toMatch(/trash/i);

    // And the two presses survive: still armed, still not fired on one click.
    fireEvent.click(press);
    expect(screen.getByText('Press again: this shares and sends an invitation')).toBeInTheDocument();
    expect(decideSharing).not.toHaveBeenCalled();
  });

  it('Done and Skip say which is which, because the labels cannot', async () => {
    // They settle a row the same way and record DIFFERENT things. After a
    // cutover, "we rebuilt it by hand" and "we decided to drop it" are
    // different answers to why somebody can no longer open something — and
    // nothing on the screen said so.
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    renderScreen();

    const done = (await screen.findByText('Mark done')).closest('button')!;
    const skip = screen.getByText('Skip').closest('button')!;
    expect(done.getAttribute('title')).toContain('re-established by hand');
    expect(skip.getAttribute('title')).toContain('not carried across');
    expect(done.getAttribute('title')).not.toBe(skip.getAttribute('title'));
  });

  it("a refusal renders the server's words verbatim and the row stays actionable", async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'active',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    decideSharing.mockRejectedValue(
      new DecisionRefusedError(
        { error: 'not_cut_over', reason: 'Shares are applied at or after cutover, not before.' },
        409,
      ),
    );
    renderScreen();

    fireEvent.click(await screen.findByText('Share on the new system'));
    fireEvent.click(screen.getByText('Press again: this shares and sends an invitation'));

    expect(
      await screen.findByText(/Shares are applied at or after cutover/),
    ).toBeInTheDocument();
  });
});

/**
 * THE BLIND SPOTS IN THE READER'S LANGUAGE (the owner, 2026-10-16). A Dutch
 * tester read them in English, under a heading that said *"Kon niet worden
 * geïnventariseerd"*. The server now sends each one's Dutch beside it, in the
 * same order, and the English where a sentence has no Dutch.
 */
describe('the blind spots after a rescan', () => {
  const answer = {
    open: 0,
    blindSpots: ['Who has access here was not read: x.'],
    blindSpotsNl: ['Wie hier toegang heeft, is niet gelezen: x.'],
  };
  const empty = {
    migrationStatus: 'done',
    summary: { total: 0, open: 0, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
    grants: [],
  };

  it('are said in English, under a plain heading', async () => {
    fetchSharing.mockResolvedValue(empty);
    rescanSharing.mockResolvedValue(answer);
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: /Refresh from the source/ }));
    expect(await screen.findByText('Who has access here was not read: x.')).toBeInTheDocument();
    expect(screen.queryByText(/inventor/i)).not.toBeInTheDocument();
  });

  it('are said in Dutch to a Dutch reader', async () => {
    window.localStorage.setItem('ownpace.locale', 'nl');
    try {
      fetchSharing.mockResolvedValue(empty);
      rescanSharing.mockResolvedValue(answer);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
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
      fireEvent.click(await screen.findByRole('button', { name: /opnieuw/i }));
      expect(await screen.findByText('Wie hier toegang heeft, is niet gelezen: x.')).toBeInTheDocument();
      expect(screen.queryByText(/geïnventariseerd/)).not.toBeInTheDocument();
    } finally {
      window.localStorage.removeItem('ownpace.locale');
    }
  });
});

/**
 * A share the new system refused, in the reader's language (workplan 0136 T3,
 * a share's refusal on apply). On managed the API writes that refusal itself,
 * in both languages (`reason` and `reasonNl`), and never in the server's
 * words; the page shows the half in its language, and the English as served
 * when no Dutch half came.
 */
describe('a refused share in the reader’s language', () => {
  const EN = 'The new system refused this share (status 403). Reference 0136f5aa.';
  const NL = 'Het nieuwe systeem weigerde dit delen (status 403). Referentie 0136f5aa.';

  async function refusedIn(locale: 'en' | 'nl', refusal: { error: string; reason?: string; reasonNl?: string }) {
    window.localStorage.setItem('ownpace.locale', locale);
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1' })],
    });
    decideSharing.mockRejectedValue(new DecisionRefusedError(refusal, 409));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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
    const apply = locale === 'nl' ? 'Delen op het nieuwe systeem' : 'Share on the new system';
    const armed =
      locale === 'nl'
        ? 'Klik nogmaals — dit stelt delen in én nodigt betreffende persoon uit'
        : 'Press again: this shares and sends an invitation';
    fireEvent.click(await screen.findByText(apply));
    fireEvent.click(screen.getByText(armed));
  }

  afterEach(() => window.localStorage.removeItem('ownpace.locale'));

  it('a Dutch reader reads the Dutch half', async () => {
    await refusedIn('nl', { error: 'target_refused', reason: EN, reasonNl: NL });
    expect(await screen.findByText(NL)).toBeInTheDocument();
    expect(screen.queryByText(EN)).toBeNull();
  });

  it('an English reader reads the English half', async () => {
    await refusedIn('en', { error: 'target_refused', reason: EN, reasonNl: NL });
    expect(await screen.findByText(EN)).toBeInTheDocument();
    expect(screen.queryByText(NL)).toBeNull();
  });

  it('a refusal with no Dutch half is shown as served, to a Dutch reader too', async () => {
    await refusedIn('nl', { error: 'not_cut_over', reason: 'Shares are applied at or after cutover.' });
    expect(await screen.findByText('Shares are applied at or after cutover.')).toBeInTheDocument();
  });
});

/**
 * THE ROWS IN THE READER'S LANGUAGE (UX sweep, 2026-10-17). A Dutch tester
 * read an English line under every row, a raw JSON tooltip on every name, and
 * "2 regel(s) op handmatig". The server now sends each row's line in Dutch
 * beside the English (`verdictTargetNl`); the page shows the half in its
 * language, and the English as served when no Dutch came.
 */
describe('the rows in the reader\u2019s language', () => {
  const NL_LINE = 'een Nextcloud-deling met bewerkrechten';

  function inDutch(grants: ShareGrantRow[], openManual = 0) {
    window.localStorage.setItem('ownpace.locale', 'nl');
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: {
        total: grants.length,
        open: grants.length,
        applied: 0,
        doneManual: 0,
        skipped: 0,
        openManual,
      },
      grants,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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

  afterEach(() => window.localStorage.removeItem('ownpace.locale'));

  it('a Dutch reader reads the Dutch line the server sent', async () => {
    inDutch([row({ id: 'g1', verdictTargetNl: NL_LINE })]);
    expect(await screen.findByText(NL_LINE)).toBeInTheDocument();
    expect(screen.queryByText('a person share on the target')).toBeNull();
  });

  it('a Dutch reader reads the English as served when no Dutch came, marked as English', async () => {
    inDutch([row({ id: 'g1' })]);
    const line = await screen.findByText('a person share on the target');
    expect(line.closest('[lang="en"]')).not.toBeNull();
  });

  it('an English reader reads the English line, never the Dutch', async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 1, open: 1, applied: 0, doneManual: 0, skipped: 0, openManual: 0 },
      grants: [row({ id: 'g1', verdictTargetNl: NL_LINE })],
    });
    renderScreen();
    expect(await screen.findByText('a person share on the target')).toBeInTheDocument();
    expect(screen.queryByText(NL_LINE)).toBeNull();
  });

  it('the item name carries no raw JSON tooltip', async () => {
    inDutch([row({ id: 'g1', verdictTargetNl: NL_LINE })]);
    const name = await screen.findByText('Projects/budget.xlsx');
    expect(name).not.toHaveAttribute('title');
  });

  it('one open manual row is one row, in Dutch', async () => {
    inDutch([row({ id: 'g1', verdict: 'manual', verdictTargetNl: NL_LINE })], 1);
    expect(
      await screen.findByText('1 regel vraagt een stap van u op het nieuwe systeem; vink die hier daarna af.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/regel\(s\)/)).toBeNull();
  });

  it('two open manual rows are two rows, in English', async () => {
    fetchSharing.mockResolvedValue({
      migrationStatus: 'done',
      summary: { total: 2, open: 2, applied: 0, doneManual: 0, skipped: 0, openManual: 2 },
      grants: [row({ id: 'g1', verdict: 'manual' }), row({ id: 'g2', verdict: 'manual', onLabel: 'b.txt' })],
    });
    renderScreen();
    expect(
      await screen.findByText('2 rows need a step from you on the new system; mark them done here afterwards.'),
    ).toBeInTheDocument();
  });

  it('a link share is a deellink in Dutch', async () => {
    inDutch([row({ id: 'g1', viaLink: true, grantee: undefined, verdict: 'manual' })]);
    expect(await screen.findByText('deellink')).toBeInTheDocument();
  });
});
