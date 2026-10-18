// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The deletions screen (ADR-0026), which owns the only destructive button in
 * the product.
 *
 * Most of these assert what does NOT appear. That is the point: the screen's
 * job is to keep `apply` away from anything ADR-0024 says must not be acted on,
 * and a queue that renders correctly while offering one extra button is exactly
 * the failure worth a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeletionsResponse, EarlierExport, ItemDeletion } from '@openmig/shared';
import {
  DELETIONS_MEANING,
  DELETION_CONFIRMATIONS,
  DELETION_GUIDANCE,
  DISCOVERY_DOMAINS,
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
      // Before cutover: no kind is past it (the cases after it set their own).
      afterCutover: [],
      confirmed: [],
      watching: [],
      acknowledged: [],
      whatThisMeans: DELETIONS_MEANING,
      howToResolve: DELETION_GUIDANCE,
      earlierExports: { waiting: [], kept: [] },
      ...over,
    },
  };
}

function earlier(over: Partial<EarlierExport> & { naturalKeyHash: string }): EarlierExport {
  return { domain: 'file', collection: 'Reports', exportedAs: 'h-new', ...over };
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

/** The screen in Dutch, inside the real LocaleProvider. */
function renderDutch() {
  window.localStorage.setItem('ownpace.locale', 'nl');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Deletions receiptPollMs={10} />
        </QueryClientProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

afterEach(() => {
  window.localStorage.removeItem('ownpace.locale');
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * 0154 T6: nobody recognises an item by twelve hex digits. The row says what
 * and where; the digest is folded under *ID*, for a support ticket, and keeps
 * the whole value in its title to copy.
 */
describe('an item’s hash', () => {
  it('is folded under ID, closed, with the whole value to copy', async () => {
    const HASH = '9f2c1b6a4e7d0c3f8a5b2e9d6c1f4a7b0e3d6c9f2a5b8e1d4c7f0a3b6e9d2c5f';
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion({ naturalKeyHash: HASH, evidence: 'reported' })] }));
    renderScreen();
    const digest = await screen.findByText(HASH.slice(0, 12));
    const fold = digest.closest('details');
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute('open');
    expect(fold!.querySelector('summary')?.textContent).toBe('ID');
    expect(digest).toHaveAttribute('title', HASH);
  });

  it('opens from a target a finger can hit, not a 16 px line of text', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion({ naturalKeyHash: 'h-target' })] }));
    renderScreen();
    const summary = (await screen.findByText('h-target')).closest('details')!.querySelector('summary')!;
    expect(summary.className).toMatch(/\bpy-1\b/);
    // Still a list item, the display that draws the fold's triangle.
    expect(summary.className).not.toMatch(/\b(?:inline-block|inline-flex|flex|block|inline)\b/);
  });
});

/**
 * The chips say how we know an item is gone. They said the server's own
 * tokens, *reported*, *trashed* and *inferred*, in English on a Dutch screen,
 * until the owner chose words for them (2026-10-18): the chip says the
 * client's word, and the token stays in its title, where a support thread can
 * still quote it. A line above each list says what they mean, where a phone
 * can read it, and only above a list that has rows: a sentence about rows
 * that are not there explains nothing.
 */
describe('what the chips mean, said above the rows', () => {
  const EVIDENCE = STRINGS.en['deletions.evidence.lead'];
  const ASSUMED = STRINGS.en['deletions.evidence.lead.inferred'];
  const WATCHING = STRINGS.en['deletions.watching.lead'];

  it('explains the chips of the rows waiting on you, by the words on them', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h-reported', evidence: 'reported' })] }),
    );
    renderScreen();

    const lead = await screen.findByText(EVIDENCE);
    expect(EVIDENCE).toMatch(/^Reported by the source: .* In the source's bin: /);
    // Beside the list, not inside it: a <ul> holds list items only.
    expect(lead.closest('ul')).toBeNull();
    expect(screen.queryByText(WATCHING)).not.toBeInTheDocument();
    // No row is assumed, so nothing is said about one.
    expect(screen.queryByText(ASSUMED)).not.toBeInTheDocument();
  });

  it('says why an assumed row waiting on you has no delete button', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion({ naturalKeyHash: 'h-inferred', evidence: 'inferred' })] }),
    );
    renderScreen();

    const lead = await screen.findByText(ASSUMED);
    expect(ASSUMED).toMatch(/^Assumed: /);
    expect(lead.closest('ul')).toBeNull();
    // Only the assumed row is there: the line about the others is not.
    expect(screen.queryByText(EVIDENCE)).not.toBeInTheDocument();
  });

  it('says it in Dutch, with the Dutch words on the chips', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        confirmed: [
          deletion({ naturalKeyHash: 'h-trashed', evidence: 'trashed' }),
          deletion({ naturalKeyHash: 'h-inferred', evidence: 'inferred' }),
        ],
      }),
    );
    renderDutch();

    expect(await screen.findByText(STRINGS.nl['deletions.evidence.lead'])).toBeInTheDocument();
    expect(screen.getByText(STRINGS.nl['deletions.evidence.lead.inferred'])).toBeInTheDocument();
    expect(screen.getByText('In de prullenbak van de bron')).toBeInTheDocument();
    expect(screen.getByText('Vermoeden: ontbreekt in volledige scans')).toBeInTheDocument();
    expect(STRINGS.nl['deletions.evidence.lead']).toMatch(/^Gemeld door de bron: .* In de prullenbak van de bron: /);
    expect(STRINGS.nl['deletions.evidence.lead.inferred']).toMatch(/^Vermoeden: /);
  });

  it('says why a watched row has no button, above the watched rows', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ watching: [deletion({ naturalKeyHash: 'h-watch', confirmed: false, evidence: 'inferred' })] }),
    );
    renderScreen();

    const lead = await screen.findByText(WATCHING);
    expect(lead.closest('ul')).toBeNull();
    expect(screen.queryByText(EVIDENCE)).not.toBeInTheDocument();
    expect(screen.queryByText(ASSUMED)).not.toBeInTheDocument();
  });

  it('says neither when both lists are empty', async () => {
    fetchDeletions.mockResolvedValue(queue({}));
    renderScreen();

    expect(await screen.findByText('Nothing is being watched.')).toBeInTheDocument();
    expect(screen.queryByText(EVIDENCE)).not.toBeInTheDocument();
    expect(screen.queryByText(WATCHING)).not.toBeInTheDocument();
  });

  it('shows the client’s word on the chip, and keeps the server’s token in its title', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        confirmed: [
          deletion({ naturalKeyHash: 'h-reported', evidence: 'reported' }),
          deletion({ naturalKeyHash: 'h-trashed', evidence: 'trashed' }),
          deletion({ naturalKeyHash: 'h-inferred', evidence: 'inferred' }),
        ],
      }),
    );
    renderScreen();

    for (const [word, token] of [
      ['Reported by the source', 'reported'],
      ["In the source's bin", 'trashed'],
      ['Assumed: missing from full scans', 'inferred'],
    ] as const) {
      const chip = await screen.findByText(word);
      expect(chip.getAttribute('title')).toMatch(new RegExp(`\\(${token}\\)$`));
      // The token is in the title only, never the chip's text.
      expect(screen.queryByText(token)).not.toBeInTheDocument();
    }
  });
});

/**
 * *What this means and what you can do* showed the operator's guidance from
 * the API, word for word: `POST /mappings/{mappingId}/deletions/…/apply`,
 * `allowApplyDeletions: true` and *"inferred" evidence*, in English, under a
 * Dutch heading (the UX sweep, 2026-10-17). The owner chose words for the
 * person reading it (2026-10-18), kept beside the operator's in
 * `@openmig/shared`; the API still serves its own.
 */
describe('what this means and what you can do', () => {
  const API_WORDS = /POST |\/mappings\/|naturalKeyHash|allowApplyDeletions|"inferred"/;

  it('tells a Dutch reader what the rows are and what each button does, in Dutch', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion({ naturalKeyHash: 'h-1' })] }));
    renderDutch();

    const fold = (await screen.findByText('Wat dit betekent en wat u kunt doen')).closest('details')!;
    const text = fold.textContent ?? '';
    expect(text).toContain(
      'Deze items zijn op het oude systeem verwijderd. Het nieuwe systeem heeft de kopie nog, en daar wordt niets verwijderd tenzij u daarvoor kiest.',
    );
    expect(text).toContain('Behoud de kopie: de kopie blijft op het nieuwe systeem staan. Meestal is dit het juiste antwoord.');
    expect(text).toContain(
      'Verwijder het hier ook: de kopie op het nieuwe systeem wordt ook verwijderd. Dit kan alleen zolang Handmatig verwijderen aan staat, en nooit voor een item met het label Vermoeden.',
    );
    expect(text).toContain('Niets doen: de regel blijft hier staan en er gebeurt niets.');
    expect(text).not.toMatch(API_WORDS);
  });

  it('tells an English reader the same, and never the API’s paths', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion({ naturalKeyHash: 'h-1' })] }));
    renderScreen();

    const fold = (await screen.findByText('What this means and what you can do')).closest('details')!;
    const text = fold.textContent ?? '';
    expect(text).toContain(
      'These items were deleted on the old system. The new system still has its copy, and nothing is deleted there unless you choose so.',
    );
    expect(text).toContain('Keep our copy: the copy stays on the new system. This is usually the right answer.');
    expect(text).toContain(
      'Delete it here too: the copy on the new system is deleted as well. This works only while deleting by hand is on, and never for an item marked Assumed.',
    );
    expect(text).toContain('Do nothing: the row stays here and nothing happens.');
    expect(text).not.toMatch(API_WORDS);
  });
});

/**
 * The card's heading on a phone (the UX sweep, 2026-10-17): the heading
 * squeezed the state chip into 'In / cutover' over two lines. The heading
 * wraps now, and the chip keeps its words on one line.
 */
describe('the card heading', () => {
  it('lets the name wrap and keeps the state chip on one line', async () => {
    fetchDeletions.mockResolvedValue(queue({ migrationStatus: 'cutover' }));
    renderScreen();

    const link = await screen.findByRole('link', { name: 'acme-mail' });
    const heading = link.closest('h3')!;
    expect(heading.className).toMatch(/\bmin-w-0\b/);
    expect(heading.className).toMatch(/\bbreak-words\b/);
    const chip = heading.parentElement!.lastElementChild as HTMLElement;
    expect(chip).not.toBe(heading);
    expect(chip.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(chip.className).toMatch(/\bflex-shrink-0\b/);
  });
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
    expect(screen.getByText('Assumed: missing from full scans')).toBeInTheDocument();
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
    expect(await screen.findByText(/Removal requested/)).toBeInTheDocument();
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

    expect(await screen.findByText(/The removal failed:/)).toBeInTheDocument();
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

    expect(await screen.findByText('Could not load this list.')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
    // Still a failure and not an empty queue: nothing says nobody is waiting.
    expect(screen.queryByText('Nobody is waiting.')).not.toBeInTheDocument();
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


/**
 * Copies an earlier export policy left (workplan 0042 T8 (b), second half; the
 * owner, 2026-09-23: *"Deletions lists it as 'an earlier export', not as
 * 'deleted in Google'."*).
 */
describe('earlier exports', () => {
  it('are listed under their own heading, never as a deletion, and never with a delete button', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ earlierExports: { waiting: [earlier({ naturalKeyHash: 'h-old-docx' })], kept: [] } }),
    );
    renderScreen();

    expect(await screen.findByText('Earlier exports')).toBeInTheDocument();
    expect(screen.getByText(/The documents were not deleted in Google/)).toBeInTheDocument();
    expect(screen.getByText('earlier export')).toBeInTheDocument();
    // No evidence word: nothing was deleted at the source.
    for (const word of [
      'reported',
      'trashed',
      'inferred',
      'Reported by the source',
      "In the source's bin",
      'Assumed: missing from full scans',
    ]) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
    expect(screen.getByText('Keep our copy')).toBeInTheDocument();
    expect(screen.queryByText('Delete it here too')).not.toBeInTheDocument();
  });

  it('are kept through the same keep call as a deletion', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ earlierExports: { waiting: [earlier({ naturalKeyHash: 'h-old-docx' })], kept: [] } }),
    );
    keepDeletion.mockResolvedValue({ status: 'ok', action: 'keep', naturalKeyHash: 'h-old-docx', effect: 'Kept.' });
    renderScreen();

    fireEvent.click(await screen.findByText('Keep our copy'));

    await waitFor(() => expect(keepDeletion).toHaveBeenCalledWith('acme-mail', 'h-old-docx'));
  });

  it('show no section at all when there are none', async () => {
    fetchDeletions.mockResolvedValue(queue());
    renderScreen();

    expect(await screen.findByText('Nothing is waiting on a decision.')).toBeInTheDocument();
    expect(screen.queryByText('Earlier exports')).not.toBeInTheDocument();
  });

  it('once kept, appear under what was already decided', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        earlierExports: {
          waiting: [],
          kept: [earlier({ naturalKeyHash: 'h-kept-docx', acknowledgedAt: '2026-09-23T12:00:00Z' })],
        },
      }),
    );
    renderScreen();

    expect(await screen.findByText('earlier export')).toBeInTheDocument();
    expect(screen.queryByText('Earlier exports')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing has been decided yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Keep our copy')).not.toBeInTheDocument();
  });
});

/**
 * After cutover (2026-10-05): no delete button for a kind past its cutover.
 *
 * The servers refuse such an apply (`after_cutover`), and a button refused
 * every time is one people try to make work. The owner, 2026-10-05, asked
 * *"should pressing Apply on a deletion or move that was queued before cutover
 * be refused?"*: "Refuse after cutover (Recommended)". The queue names the
 * kinds past their cutover (`afterCutover`), and the screen says why their
 * rows have no delete button.
 */
describe('after cutover', () => {
  it('offers no delete for a kind past its cutover, says why, and still offers keep', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        afterCutover: ['email'],
        confirmed: [
          deletion({ naturalKeyHash: 'h-mail', domain: 'email', evidence: 'trashed' }),
          deletion({ naturalKeyHash: 'h-cal', domain: 'calendar', collection: 'Personal' }),
        ],
      }),
    );
    renderScreen();

    // Names only the data type whose rows lost the button: Email, not Calendar.
    expect(
      await screen.findByText(STRINGS.en['queue.afterCutover'].replace('{dataTypes}', 'Email')),
    ).toBeInTheDocument();
    // The calendar is still before its cutover: its row keeps the button.
    expect(screen.getAllByText('Delete it here too')).toHaveLength(1);
    expect(screen.getAllByText('Keep our copy')).toHaveLength(2);
  });

  it('says nothing about it while every kind still follows the old system', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ afterCutover: [], confirmed: [deletion({ naturalKeyHash: 'h-mail', evidence: 'trashed' })] }),
    );
    renderScreen();

    expect(await screen.findByText('Delete it here too')).toBeInTheDocument();
    expect(screen.queryByText(/Past the cutover of/)).not.toBeInTheDocument();
  });

  it('says nothing when the data types past their cutover have no row that would have offered it', async () => {
    // Past its cutover, but its only waiting row is inferred: it had no button to lose.
    fetchDeletions.mockResolvedValue(
      queue({
        afterCutover: [...DISCOVERY_DOMAINS],
        confirmed: [deletion({ naturalKeyHash: 'h-mail', evidence: 'inferred' })],
      }),
    );
    renderScreen();

    expect(await screen.findByText('Keep our copy')).toBeInTheDocument();
    expect(screen.queryByText(/Past the cutover of/)).not.toBeInTheDocument();
  });
});
