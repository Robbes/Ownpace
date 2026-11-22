// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DELETE ALL OF THESE HERE TOO (workplan 0164 T3; ADR-0024, amended
 * 2026-11-21): one press on *Deleted on the old system* for the rows that
 * have a delete button of their own, each pressed in turn through the same
 * call, each decided by itself.
 *
 * What the page owes, and what this holds:
 *  - the button only where a single delete is offered: deleting by hand on,
 *    and only rows `mayOfferApply` offers, so never an assumed row and never
 *    one past its data type's cutover;
 *  - one confirmation, a control of its own that names the count over the
 *    rows as they were when it opened, which a double click cannot pass; the
 *    page's rows at the press and the list read again must both be that set;
 *  - in turn: each press answered to its end (a managed receipt included)
 *    before the next; a refusal of one row is that row's answer, while the
 *    breaker's refusal, deleting by hand turned off, and a press that did not
 *    answer each stop the run;
 *  - a row kept in another tab during a run is refused as already kept when
 *    its turn comes, on the request or on its receipt, and the run goes on;
 *  - a fault is never shown as a refusal: it is not known;
 *  - afterwards, what was deleted, not deleted and not known, with each
 *    reason, in English and in Dutch, the server's own words beside it;
 *  - a closed page orders and polls nothing more; a second press orders only
 *    what is still waiting.
 *
 * The gates themselves are the server's; `packages/core/src/
 * a-delete-all-through-every-gate.unit.test.ts` runs the same loop over the
 * real `applyDeletion`, and `a-delete-all-answered-over-http.unit.test.tsx`
 * runs this page over the real operating service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApplyReceipt, DeletionsResponse, ItemDeletion } from '@openmig/shared';
import { DELETIONS_MEANING, DELETION_GUIDANCE, decisionEffectFields, deletionRemovedEffect } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';

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

import Deletions from './Deletions.tsx';

const en = STRINGS.en;
const nl = STRINGS.nl;
const fill = (text: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), text);

function deletion(naturalKeyHash: string, over: Partial<ItemDeletion> = {}): ItemDeletion {
  return {
    domain: 'calendar',
    collection: 'Personal',
    displayName: `Event ${naturalKeyHash}`,
    absentPasses: 0,
    confirmed: true,
    evidence: 'reported',
    naturalKeyHash,
    ...over,
  };
}

function queue(over: Partial<DeletionsResponse['x']> = {}): DeletionsResponse {
  return {
    'acme-mail': {
      migrationStatus: 'active',
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

/** The appliance's own answer to one press: removed, with its line in both languages. */
const removed = (hash: string) => ({
  mode: 'immediate' as const,
  result: {
    status: 'ok' as const,
    action: 'apply' as const,
    naturalKeyHash: hash,
    kind: 'deleted' as const,
    ...decisionEffectFields(deletionRemovedEffect('deleted')),
  },
});
/** A gate's refusal, as both editions answer one: 403 (or 404) with its code. */
const refusal = (error: string, reason: string, status = 403) => new DecisionRefusedError({ error, reason }, status);

const BREAKER =
  '7 of 30 migrated calendar items (23%) are pending deletion, which is more likely to be a source problem.';
const QUEUED: ApplyReceipt = { state: 'queued', requestedAt: '2026-11-22T00:00:00Z' };

function renderScreen(
  opts: { locale?: 'en' | 'nl'; confirmGuardMs?: number; receiptDeadlineMs?: number } = {},
) {
  if (opts.locale === 'nl') window.localStorage.setItem('ownpace.locale', 'nl');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Deletions
            receiptPollMs={5}
            confirmGuardMs={opts.confirmGuardMs ?? 0}
            {...(opts.receiptDeadlineMs !== undefined ? { receiptDeadlineMs: opts.receiptDeadlineMs } : {})}
          />
        </QueryClientProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const confirmButton = (count: number, words = en) =>
  screen.findByRole('button', { name: fill(words['deletions.all.confirm.yes'], { count }) });

/** Open the confirmation and confirm it. */
const pressAll = async (count: number, words = en) => {
  fireEvent.click(await screen.findByRole('button', { name: words['deletions.all'] }));
  fireEvent.click(await confirmButton(count, words));
};

const done = (deleted: number, notDeleted: number, unknown: number, words = en) =>
  fill(words['deletions.all.done'], { deleted, notDeleted, unknown });

const orderedHashes = () => applyDeletion.mock.calls.map((call) => call[1] as string);

/** The list a group of the report holds, by its heading. */
const group = (title: string) => {
  const heading = screen.getByRole('heading', { level: 4, name: new RegExp(`^${title}`) });
  return heading.parentElement!;
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' });
});

afterEach(() => {
  window.localStorage.removeItem('ownpace.locale');
});

describe('where it is offered', () => {
  it('is offered for two or more rows with their own delete button, while deleting by hand is on', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    renderScreen();
    expect(await screen.findByRole('button', { name: en['deletions.all'] })).toBeInTheDocument();
    expect(screen.getByText(fill(en['deletions.all.lead'], { count: 2 }))).toBeInTheDocument();
  });

  it('is not offered while deleting by hand is off', async () => {
    fetchApplyDeletionsFlag.mockResolvedValue({ allowApplyDeletions: false, autoApplyRelocations: false, source: 'mapping' });
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    renderScreen();
    // The rows and the switch are there; the press for all of them is not.
    expect(await screen.findByText(en['applyFlag.off'])).toBeInTheDocument();
    expect(screen.getAllByText(en['deletions.apply'])).toHaveLength(2);
    expect(screen.queryByText(en['deletions.all'])).not.toBeInTheDocument();
  });

  it('is not offered while it cannot be read whether deleting by hand is on', async () => {
    fetchApplyDeletionsFlag.mockRejectedValue(new Error('network down'));
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    renderScreen();
    expect(await screen.findByText(/network down/)).toBeInTheDocument();
    expect(screen.queryByText(en['deletions.all'])).not.toBeInTheDocument();
  });

  it('is not offered after cutover, and the rows past it are not counted', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ afterCutover: ['calendar'], confirmed: [deletion('a'), deletion('b'), deletion('m', { domain: 'email' })] }),
    );
    renderScreen();
    expect(await screen.findByText(/Past the cutover of Calendar/)).toBeInTheDocument();
    // Asked once deleting by hand is known to be on, or this would pass on a
    // flag still being read.
    expect(await screen.findByText(en['applyFlag.on'])).toBeInTheDocument();
    expect(screen.getAllByText(en['deletions.apply'])).toHaveLength(1);
    expect(screen.queryByText(en['deletions.all'])).not.toBeInTheDocument();
  });

  it('counts only rows with their own delete button: never an assumed one, never one past its cutover', async () => {
    fetchDeletions.mockResolvedValue(
      queue({
        afterCutover: ['email'],
        confirmed: [
          deletion('a'),
          deletion('assumed', { evidence: 'inferred', absentPasses: 3 }),
          deletion('b', { evidence: 'trashed' }),
          deletion('mail', { domain: 'email' }),
        ],
      }),
    );
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    renderScreen();
    await pressAll(2);
    await screen.findByText(done(2, 0, 0));
    expect(orderedHashes()).toEqual(['a', 'b']);
  });
});

describe('one confirmation, a control of its own', () => {
  it('names the count, takes the focus to Cancel, and orders nothing until it is confirmed', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: en['deletions.all'] }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete these 3 on the new system?' });
    expect(within(dialog).getByRole('button', { name: en['deletions.all.confirm.no'] })).toHaveFocus();
    expect(applyDeletion).not.toHaveBeenCalled();
    expect(fetchDeletions).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 3' }));
    await screen.findByText(done(3, 0, 0));
    expect(orderedHashes()).toEqual(['a', 'b', 'c']);
    // The list was read again at the press, before the first order.
    expect(fetchDeletions.mock.invocationCallOrder[1]!).toBeLessThan(applyDeletion.mock.invocationCallOrder[0]!);
  });

  it('is closed by Cancel and by Escape, and orders nothing', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: en['deletions.all'] }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en['deletions.all'] }));
    fireEvent.keyDown(await screen.findByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('cannot be passed by a double click', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    const user = userEvent.setup();
    renderScreen({ confirmGuardMs: 800 });

    // A double click on the button opens the confirmation and goes no further.
    await user.dblClick(await screen.findByRole('button', { name: en['deletions.all'] }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // Nor does a double click on Delete 2 as it opens.
    await user.dblClick(screen.getByRole('button', { name: 'Delete 2' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('takes the second click of a double click for what it is, whatever the guard', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    renderScreen({ confirmGuardMs: 0 });
    fireEvent.click(await screen.findByRole('button', { name: en['deletions.all'] }), { detail: 1 });
    // The end of that double click, landing where Delete 2 is.
    fireEvent.click(await confirmButton(2), { detail: 2 });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('orders once the guard has passed', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    renderScreen({ confirmGuardMs: 60 });
    fireEvent.click(await screen.findByRole('button', { name: en['deletions.all'] }));
    const yes = await confirmButton(2);
    fireEvent.click(yes);
    expect(applyDeletion).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 80));
    fireEvent.click(yes);
    await screen.findByText(done(2, 0, 0));
    expect(orderedHashes()).toEqual(['a', 'b']);
  });

  it('freezes the rows when it opens: if the page’s rows change before the press, it orders nothing and says so', async () => {
    // The page grows a row under the open confirmation; by the press the
    // server's list is back to the two it named. Only the press's own check
    // can see that what the person was looking at is not what they confirmed.
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }))
      .mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: en['deletions.all'] }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete these 2 on the new system?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en['asof.refresh'] }));
    await screen.findByText('Event c');
    fireEvent.click(await confirmButton(2));
    expect(await screen.findByText(fill(en['deletions.all.changed'], { count: 3 }))).toBeInTheDocument();
    // Nothing was read again, and nothing ordered.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchDeletions).toHaveBeenCalledTimes(2);
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('orders nothing when the list read again holds other rows, even as many', async () => {
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('z')] }));
    renderScreen();
    await pressAll(2);
    expect(await screen.findByText(fill(en['deletions.all.changed'], { count: 2 }))).toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('says it without "confirm once more" when one row or none is left to delete', async () => {
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockResolvedValue(queue({ confirmed: [deletion('a')] }));
    renderScreen();
    await pressAll(2);
    expect(await screen.findByText(en['deletions.all.changed.few'])).toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('orders nothing when the list cannot be read again, and says why', async () => {
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockRejectedValue(new Error('the server did not answer'));
    renderScreen();
    await pressAll(2);
    expect(await screen.findByText(/the server did not answer/)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(en['deletions.all.unreadable'])).length).toBeGreaterThan(0);
    expect(applyDeletion).not.toHaveBeenCalled();
  });
});

describe('each row decided by itself, and what the page says afterwards', () => {
  const rows = [
    deletion('a'),
    deletion('b'),
    deletion('c', { domain: 'contact' }),
    deletion('d', { domain: 'file', collection: 'Docs', displayName: 'report.pdf' }),
    deletion('e'),
  ];
  const answers = async (_m: string, hash: string) => {
    if (hash === 'b') throw refusal('edited_on_target', 'Somebody has edited this item in the new system since we copied it.');
    if (hash === 'c') throw refusal('not_ours', 'The copy on the target was already there before this migration ran.');
    if (hash === 'e') throw refusal('already_applied', 'The target copy of this item has already been removed.', 404);
    return removed(hash);
  };

  it('says in English what was deleted and what was not, each with its reason', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: rows }));
    applyDeletion.mockImplementation(answers);
    renderScreen();
    await pressAll(5);

    expect(await screen.findByText(done(3, 2, 0))).toBeInTheDocument();
    const deleted = group(en['deletions.all.removed']);
    expect(within(deleted).getByText('Event a')).toBeInTheDocument();
    expect(within(deleted).getByText('/Docs/report.pdf')).toBeInTheDocument();
    // Removed by somebody else is gone all the same: deleted, not "not deleted".
    expect(within(deleted).getByText(en['deletions.refused.alreadyApplied'])).toBeInTheDocument();

    const notDeleted = group(en['deletions.all.notRemoved']);
    expect(within(notDeleted).getByText(en['deletions.refused.editedOnTarget'])).toBeInTheDocument();
    expect(within(notDeleted).getByText(en['deletions.refused.notOurs'])).toBeInTheDocument();
    // The server's own words and code, verbatim, beside each.
    expect(
      within(notDeleted).getByText('Somebody has edited this item in the new system since we copied it. (edited_on_target)'),
    ).not.toHaveAttribute('lang');
    expect(screen.queryByRole('heading', { name: new RegExp(`^${en['deletions.all.unknown']}`) })).not.toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('says it in Dutch, with the server’s English beside it, marked as English', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: rows }));
    applyDeletion.mockImplementation(answers);
    renderScreen({ locale: 'nl' });
    await pressAll(5, nl);

    expect(await screen.findByText(done(3, 2, 0, nl))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: new RegExp(`^${nl['deletions.all.removed']}`) })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: new RegExp(`^${nl['deletions.all.notRemoved']}`) })).toBeInTheDocument();
    expect(screen.getByText(nl['deletions.refused.editedOnTarget'])).toBeInTheDocument();
    expect(screen.getByText(nl['deletions.refused.notOurs'])).toBeInTheDocument();
    expect(
      screen.getByText('The copy on the target was already there before this migration ran. (not_ours)'),
    ).toHaveAttribute('lang', 'en');
    expect(screen.getAllByText(deletionRemovedEffect('deleted').nl).length).toBeGreaterThan(0);
  });

  it('counts a removal the ledger could not record as deleted, and goes on', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') throw refusal('removed_not_recorded', 'The copy WAS removed from the target.', 500);
      return removed(hash);
    });
    renderScreen();
    await pressAll(2);
    expect(await screen.findByText(done(2, 0, 0))).toBeInTheDocument();
    expect(within(group(en['deletions.all.removed'])).getByText(en['deletions.refused.removedNotRecorded'])).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b']);
  });

  it('keeps the summary in one status line, with the lists outside it, under headings of their own', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: rows }));
    applyDeletion.mockImplementation(answers);
    renderScreen();
    await pressAll(5);
    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(done(3, 2, 0)));
    expect(within(status).queryByText('Event a')).not.toBeInTheDocument();
    // The summary takes the focus when the run ends.
    expect(status).toHaveFocus();
  });
});

/**
 * A keep pressed in another tab while a run is under way (ADR-0024, amended
 * 2026-11-22). The run read the list before its first press, so the row is in
 * it; the server refuses it when its turn comes, as it refuses a single press
 * on a page read before the keep. That refusal is the row's own: the run goes
 * on.
 */
describe('a keep in another tab during a run', () => {
  /** What the server says for a deletion somebody kept (core's `keptCheck`). */
  const KEPT =
    "Somebody already looked at this deletion and chose to keep the target's copy, so it will not be removed now. If that was the wrong call, delete it in the target system yourself — this decision is not re-opened here.";

  it('refuses the row kept after the run began as already kept, says so, and goes on to the next', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    // The server's side: b is kept in another tab while a is being deleted.
    const kept = new Set<string>();
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (kept.has(hash)) throw refusal('already_kept', KEPT);
      if (hash === 'a') kept.add('b');
      return removed(hash);
    });
    renderScreen();
    await pressAll(3);

    expect(await screen.findByText(done(2, 1, 0))).toBeInTheDocument();
    // Nothing stopped the run: the summary is the count alone, and c was ordered after b.
    expect(screen.getByRole('status').textContent?.trim()).toBe(done(2, 1, 0));
    expect(orderedHashes()).toEqual(['a', 'b', 'c']);
    const notDeleted = group(en['deletions.all.notRemoved']);
    expect(within(notDeleted).getByText('Event b')).toBeInTheDocument();
    expect(within(notDeleted).getByText(en['deletions.refused.alreadyKept'])).toBeInTheDocument();
    // The server's own words and code, verbatim, under Technical details.
    expect(within(notDeleted).getByText(`${KEPT} (already_kept)`)).not.toHaveAttribute('lang');
    expect(within(group(en['deletions.all.removed'])).getByText('Event c')).toBeInTheDocument();
  });

  it('on managed, is refused on its receipt when the keep landed while its removal waited, said in Dutch', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    applyDeletion.mockResolvedValue({ mode: 'queued', receipt: QUEUED });
    // The route queued b; the job, which asks every gate again, found the keep.
    fetchApplyReceipt.mockImplementation(
      async (_m: string, hash: string): Promise<ApplyReceipt> =>
        hash === 'b'
          ? { state: 'refused', requestedAt: QUEUED.requestedAt, finishedAt: '2026-11-22T00:00:05Z', code: 'already_kept', reason: KEPT }
          : { state: 'applied', requestedAt: QUEUED.requestedAt, finishedAt: '2026-11-22T00:00:05Z', kind: 'deleted' },
    );
    renderScreen({ locale: 'nl' });
    await pressAll(3, nl);

    expect(await screen.findByText(done(2, 1, 0, nl))).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b', 'c']);
    const notDeleted = group(nl['deletions.all.notRemoved']);
    expect(within(notDeleted).getByText(nl['deletions.refused.alreadyKept'])).toBeInTheDocument();
    expect(within(notDeleted).getByText(`${KEPT} (already_kept)`)).toHaveAttribute('lang', 'en');
  });
});

describe('a fault is not a refusal', () => {
  it.each([
    ['a fault on the server', new DecisionRefusedError({ error: 'deletion_apply_failed', reason: 'Something went wrong — Reference AB12.' }, 500)],
    ['the appliance’s catch-all', new DecisionRefusedError({ error: 'connect ECONNREFUSED' }, 500)],
    ['a removal that could not be queued', new DecisionRefusedError({ error: 'Could not queue the removal' }, 502)],
    ['an operator’s hold', new DecisionRefusedError({ error: 'platform_held', reason: 'Ownpace is being updated.' }, 409)],
    ['a 403 with a code no gate refuses with', new DecisionRefusedError({ error: 'forbidden', reason: 'No.' }, 403)],
    ['a time-out', new Error('timeout of 30000ms exceeded')],
  ])('%s is not known, and nothing after it is ordered', async (_what, error) => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion('a'), deletion('b'), deletion('k', { domain: 'contact' })] }),
    );
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') throw error;
      return removed(hash);
    });
    renderScreen();
    await pressAll(3);

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.failure']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(0, 2, 1));
    const unknown = group(en['deletions.all.unknown']);
    expect(within(unknown).getByText(en['deletions.all.failed'])).toBeInTheDocument();
    expect(within(group(en['deletions.all.notRemoved'])).getAllByText(en['deletions.all.notTried.failure'])).toHaveLength(2);
    // The row says it is not known, never a refusal's amber.
    expect(screen.getByText(new RegExp(`^${en['deletions.all.unknownRow']}`))).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a']);
  });
});

describe('the breaker, and deleting by hand turned off, stop the run', () => {
  it('the breaker on the request stops every row after it, of every data type', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion('c1'), deletion('c2'), deletion('c3'), deletion('k1', { domain: 'contact' })] }),
    );
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'c2') throw refusal('mass_deletion_suspected', BREAKER);
      return removed(hash);
    });
    renderScreen();
    await pressAll(4);

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.breaker']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(1, 3, 0));
    // c3 and the contact were never ordered, whatever the breaker would say now.
    expect(orderedHashes()).toEqual(['c1', 'c2']);
    expect(screen.getByText(en['deletions.refused.massDeletionSuspected'])).toBeInTheDocument();
    expect(screen.getAllByText(en['deletions.all.notTried.breaker'])).toHaveLength(2);
    expect(screen.getAllByText(`${BREAKER} (mass_deletion_suspected)`)).toHaveLength(3);
    // Nothing happened to c3, so its row has its buttons back.
    const c3 = screen
      .getAllByText('Event c3')
      .map((el) => el.closest('li')!)
      .find((li) => li.querySelector('code[title="c3"]'))!;
    expect(within(c3).getByText(en['deletions.apply'])).toBeInTheDocument();
  });

  it('on managed, waits for each receipt before the next order, and stops on a receipt the breaker refused', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion('k1', { domain: 'contact' }), deletion('c1'), deletion('c2')] }),
    );
    const log: string[] = [];
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      log.push(`order ${hash}`);
      return { mode: 'queued', receipt: QUEUED };
    });
    const polls = new Map<string, number>();
    fetchApplyReceipt.mockImplementation(async (_m: string, hash: string): Promise<ApplyReceipt> => {
      const n = (polls.get(hash) ?? 0) + 1;
      polls.set(hash, n);
      if (n < 2) {
        log.push(`poll ${hash}: queued`);
        return QUEUED;
      }
      log.push(`poll ${hash}: done`);
      return hash === 'c1'
        ? { state: 'refused', requestedAt: QUEUED.requestedAt, finishedAt: '2026-11-22T00:00:05Z', code: 'mass_deletion_suspected', reason: BREAKER }
        : { state: 'applied', requestedAt: QUEUED.requestedAt, finishedAt: '2026-11-22T00:00:05Z', kind: 'binned' };
    });
    renderScreen();
    await pressAll(3);

    await screen.findByText(new RegExp(en['deletions.all.stoppedBy.breaker']));
    expect(log).toEqual([
      'order k1',
      'poll k1: queued',
      'poll k1: done',
      'order c1',
      'poll c1: queued',
      'poll c1: done',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(done(1, 2, 0));
    expect(screen.getAllByText(en['receipt.applied.binned']).length).toBeGreaterThan(0);
  });

  it('deleting by hand turned off during the run refuses the next row and stops the rest', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'b') throw refusal('not_enabled', 'Removing items from the target is switched off for this mapping.');
      return removed(hash);
    });
    renderScreen();
    await pressAll(3);
    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.notEnabled']))).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b']);
    expect(screen.getByText(en['deletions.all.notTried.notEnabled'])).toBeInTheDocument();
  });
});

describe('a receipt that does not land', () => {
  it('is not known after the deadline, and the run stops', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockResolvedValue({ mode: 'queued', receipt: QUEUED });
    fetchApplyReceipt.mockResolvedValue(QUEUED);
    renderScreen({ receiptDeadlineMs: 40 });
    await pressAll(2);
    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.failure']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(0, 1, 1));
    expect(orderedHashes()).toEqual(['a']);
  });

  it('says so when its answer cannot be read, again and again, and goes on asking', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockResolvedValue({ mode: 'queued', receipt: QUEUED });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let failures = 0;
    fetchApplyReceipt.mockImplementation(async (): Promise<ApplyReceipt> => {
      if (failures < 3) {
        failures += 1;
        throw new Error('the receipt could not be read');
      }
      await held;
      return { state: 'applied', requestedAt: QUEUED.requestedAt, finishedAt: '2026-11-22T00:00:05Z', kind: 'deleted' };
    });
    renderScreen();
    await pressAll(2);
    expect(
      await screen.findByText(fill(en['deletions.all.pollTrouble'], { count: 3, error: 'the receipt could not be read' })),
    ).toBeInTheDocument();
    release();
    expect(await screen.findByText(done(2, 0, 0))).toBeInTheDocument();
  });
});

describe('while a run is under way', () => {
  it('marks the rows it will reach, with no button to press, and gives Stop the focus', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') await held;
      return removed(hash);
    });
    renderScreen();
    await pressAll(3);

    expect(await screen.findByRole('button', { name: en['deletions.all.stop'] })).toHaveFocus();
    expect(screen.getAllByText(en['deletions.all.waiting'])).toHaveLength(2);
    const b = screen
      .getAllByText('Event b')
      .map((el) => el.closest('li')!)
      .find((li) => li.querySelector('code[title="b"]'))!;
    expect(within(b).queryByText(en['deletions.apply'])).not.toBeInTheDocument();
    expect(within(b).queryByText(en['deletions.keep'])).not.toBeInTheDocument();
    release();
    await screen.findByText(done(3, 0, 0));
  });

  it('keeps the run and its report on screen when reading the list again fails', async () => {
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockRejectedValue(new Error('the list could not be read'));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    renderScreen();
    await pressAll(2);
    expect(await screen.findByText(done(2, 0, 0))).toBeInTheDocument();
    expect(await screen.findByText(en['queue.loadFailed'])).toBeInTheDocument();
    expect(screen.getByText(done(2, 0, 0))).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b']);
  });

  it('stops ordering when the page closes', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') await held;
      return removed(hash);
    });
    const page = renderScreen();
    await pressAll(3);
    await screen.findByRole('button', { name: en['deletions.all.stop'] });
    page.unmount();
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(orderedHashes()).toEqual(['a']);
  });

  it('stops reading a receipt when the page closes', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockResolvedValue({ mode: 'queued', receipt: QUEUED });
    fetchApplyReceipt.mockResolvedValue(QUEUED);
    const page = renderScreen();
    await pressAll(2);
    await waitFor(() => expect(fetchApplyReceipt.mock.calls.length).toBeGreaterThan(1));
    page.unmount();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const polled = fetchApplyReceipt.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetchApplyReceipt.mock.calls.length).toBe(polled);
    expect(orderedHashes()).toEqual(['a']);
  });
});

describe('a run that empties the list', () => {
  it('still says what it did once every row has left Waiting on you', async () => {
    const rows = [deletion('a'), deletion('b')];
    const deleted = new Set<string>();
    fetchDeletions.mockImplementation(async () =>
      queue({
        confirmed: rows.filter((d) => !deleted.has(d.naturalKeyHash)),
        acknowledged: rows
          .filter((d) => deleted.has(d.naturalKeyHash))
          .map((d) => ({ ...d, acknowledgedAt: '2026-11-22T00:00:00Z', decided: 'applied' as const })),
      }),
    );
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      deleted.add(hash);
      return removed(hash);
    });
    renderScreen();
    await pressAll(2);

    expect(await screen.findByText(done(2, 0, 0))).toBeInTheDocument();
    expect(await screen.findByText(en['deletions.empty.confirmed'])).toBeInTheDocument();
    expect(screen.getByText(done(2, 0, 0))).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b']);
  });
});

describe('a stop', () => {
  it('orders nothing after the one under way, and gives the rest their buttons back', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') await held;
      return removed(hash);
    });
    renderScreen();
    await pressAll(3);

    // While a run is under way there is no second press to make.
    fireEvent.click(await screen.findByRole('button', { name: en['deletions.all.stop'] }));
    expect(screen.queryByRole('button', { name: en['deletions.all'] })).not.toBeInTheDocument();
    expect(await screen.findByText(en['deletions.all.stopping'])).toBeInTheDocument();
    release();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.stop']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(1, 2, 0));
    expect(orderedHashes()).toEqual(['a']);
    expect(screen.getAllByText(en['deletions.all.notTried.stop'])).toHaveLength(2);
    // b and c were never ordered: their own buttons are back, and so is the press for both.
    expect(screen.getAllByText(en['deletions.apply'])).toHaveLength(2);
    expect(screen.getByRole('button', { name: en['deletions.all'] })).toBeInTheDocument();
  });
});

describe('a second press', () => {
  it('orders only what is still waiting: nothing deleted is ordered again', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'b') throw refusal('edited_on_target', 'Somebody has edited this item in the new system.');
      return removed(hash);
    });
    const first = renderScreen();
    await pressAll(3);
    await screen.findByText(done(2, 1, 0));
    expect(orderedHashes()).toEqual(['a', 'b', 'c']);
    // Every row this page pressed has its answer, so there is nothing left to press for all.
    expect(screen.queryByRole('button', { name: en['deletions.all'] })).not.toBeInTheDocument();
    first.unmount();

    // Coming back: a and c are deleted and decided; b is still waiting, and d is new.
    applyDeletion.mockClear();
    fetchDeletions.mockResolvedValue(
      queue({
        confirmed: [deletion('b'), deletion('d')],
        acknowledged: [
          deletion('a', { acknowledgedAt: '2026-11-22T00:00:00Z', decided: 'applied' }),
          deletion('c', { acknowledgedAt: '2026-11-22T00:00:00Z', decided: 'applied' }),
        ],
      }),
    );
    renderScreen();
    await pressAll(2);
    await screen.findByText(done(1, 1, 0));
    expect(orderedHashes()).toEqual(['b', 'd']);
  });
});
