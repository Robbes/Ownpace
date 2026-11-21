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
 *  - one confirmation, and it names the count; the list read again before
 *    anything is ordered, and nothing ordered when it changed;
 *  - in turn: each press answered to its end (a managed receipt included)
 *    before the next is ordered, so the breaker stops the rest of its data
 *    type, on the request or on the receipt;
 *  - afterwards, what was deleted and what was not, with each reason, in
 *    English and in Dutch, the server's own words beside it;
 *  - a second press orders only what is still waiting.
 *
 * The gates themselves are the server's; `packages/core/src/
 * a-delete-all-through-every-gate.unit.test.ts` runs the same loop over the
 * real `applyDeletion`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
const refusal = (error: string, reason: string) => new DecisionRefusedError({ error, reason }, 403);

const BREAKER =
  '7 of 30 migrated calendar items (23%) are pending deletion, which is more likely to be a source problem.';

function renderScreen(locale: 'en' | 'nl' = 'en') {
  if (locale === 'nl') window.localStorage.setItem('ownpace.locale', 'nl');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <Deletions receiptPollMs={5} />
        </QueryClientProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

const pressAll = async (count: number, words = en) => {
  fireEvent.click(await screen.findByText(words['deletions.all']));
  fireEvent.click(screen.getByText(words['deletions.all.armed'].replace('{count}', String(count))));
};

const orderedHashes = () => applyDeletion.mock.calls.map((call) => call[1] as string);

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
    expect(await screen.findByText(en['deletions.all'])).toBeInTheDocument();
    expect(screen.getByText(en['deletions.all.lead'].replace('{count}', '2'))).toBeInTheDocument();
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
    // One row still has a button of its own, and one row is not a run.
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
    await screen.findByText(en['deletions.all.done'].replace('{removed}', '2').replace('{count}', '2'));
    expect(orderedHashes()).toEqual(['a', 'b']);
  });
});

describe('one confirmation, and it names the count', () => {
  it('orders nothing on the first press, and says how many on the second', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => removed(hash));
    renderScreen();

    fireEvent.click(await screen.findByText(en['deletions.all']));
    expect(applyDeletion).not.toHaveBeenCalled();
    const armed = screen.getByText('Confirm: delete these 3 here too');
    expect(fetchDeletions).toHaveBeenCalledTimes(1);

    fireEvent.click(armed);
    await screen.findByText('Done: 3 of 3 deleted on the new system.');
    expect(orderedHashes()).toEqual(['a', 'b', 'c']);
    // The list was read again at the press, before the first order.
    expect(fetchDeletions.mock.invocationCallOrder[1]!).toBeLessThan(applyDeletion.mock.invocationCallOrder[0]!);
  });

  it('orders nothing when the list read again differs from the one confirmed', async () => {
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b'), deletion('c')] }));
    renderScreen();
    await pressAll(2);
    expect(
      await screen.findByText(en['deletions.all.changed'].replace('{count}', '3')),
    ).toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });

  it('orders nothing when the list cannot be read again, and says why', async () => {
    fetchDeletions
      .mockResolvedValueOnce(queue({ confirmed: [deletion('a'), deletion('b')] }))
      .mockRejectedValue(new Error('the server did not answer'));
    renderScreen();
    await pressAll(2);
    expect(await screen.findByText(/the server did not answer/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(en['deletions.all.unreadable']))).toBeInTheDocument();
    expect(applyDeletion).not.toHaveBeenCalled();
  });
});

describe('each row decided by itself, and what the page says afterwards', () => {
  const rows = [
    deletion('a'),
    deletion('b'),
    deletion('c', { domain: 'contact' }),
    deletion('d', { domain: 'file', collection: 'Docs', displayName: 'report.pdf' }),
  ];
  const answers = async (_m: string, hash: string) => {
    if (hash === 'b') throw refusal('edited_on_target', 'Somebody has edited this item in the new system since we copied it.');
    if (hash === 'c') throw refusal('not_ours', 'The copy on the target was already there before this migration ran.');
    return removed(hash);
  };

  it('says in English what was deleted and what was not, each with its reason', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: rows }));
    applyDeletion.mockImplementation(answers);
    renderScreen();
    await pressAll(4);

    const report = (await screen.findByText('Done: 2 of 4 deleted on the new system.')).closest('[data-testid="delete-all"]')!;
    const deleted = within(report as HTMLElement).getByText(en['deletions.all.removed']).parentElement!.parentElement!;
    expect(within(deleted).getByText('Event a')).toBeInTheDocument();
    expect(within(deleted).getByText('/Docs/report.pdf')).toBeInTheDocument();

    const notDeleted = within(report as HTMLElement).getByText(en['deletions.all.notRemoved']).parentElement!.parentElement!;
    expect(within(notDeleted).getByText(en['deletions.refused.editedOnTarget'])).toBeInTheDocument();
    expect(within(notDeleted).getByText(en['deletions.refused.notOurs'])).toBeInTheDocument();
    // The server's own words and code, verbatim, beside each.
    expect(
      within(notDeleted).getByText('Somebody has edited this item in the new system since we copied it. (edited_on_target)'),
    ).not.toHaveAttribute('lang');
    expect(orderedHashes()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('says it in Dutch, with the server’s English beside it, marked as English', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: rows }));
    applyDeletion.mockImplementation(answers);
    renderScreen('nl');
    await pressAll(4, nl);

    await screen.findByText('Klaar: 2 van 4 verwijderd op het nieuwe systeem.');
    expect(screen.getByText(nl['deletions.all.removed'])).toBeInTheDocument();
    expect(screen.getByText(nl['deletions.all.notRemoved'])).toBeInTheDocument();
    expect(screen.getByText(nl['deletions.refused.editedOnTarget'])).toBeInTheDocument();
    expect(screen.getByText(nl['deletions.refused.notOurs'])).toBeInTheDocument();
    expect(
      screen.getByText('The copy on the target was already there before this migration ran. (not_ours)'),
    ).toHaveAttribute('lang', 'en');
    // What a removal did, in the server's Dutch half.
    expect(screen.getAllByText(deletionRemovedEffect('deleted').nl).length).toBeGreaterThan(0);
  });

  it('says a refusal it has no words for as refused, with the server’s words', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') throw refusal('platform_held', 'Ownpace is being updated. Try again in a few minutes.');
      return removed(hash);
    });
    renderScreen();
    await pressAll(2);
    await screen.findByText('Done: 1 of 2 deleted on the new system.');
    expect(screen.getByText(en['deletions.refused.other'])).toBeInTheDocument();
    expect(screen.getByText('Ownpace is being updated. Try again in a few minutes. (platform_held)')).toBeInTheDocument();
  });

  it('says a press that failed as failed, not as a refusal, and goes on', async () => {
    fetchDeletions.mockResolvedValue(queue({ confirmed: [deletion('a'), deletion('b')] }));
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'a') throw new Error('Network Error');
      return removed(hash);
    });
    renderScreen();
    await pressAll(2);
    await screen.findByText('Done: 1 of 2 deleted on the new system.');
    expect(screen.getByText(en['deletions.all.failed'])).toBeInTheDocument();
    expect(orderedHashes()).toEqual(['a', 'b']);
  });
});

describe('the breaker, as its rule says', () => {
  it('stops the rest of its data type once it refuses one, and lets another data type go on', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion('c1'), deletion('c2'), deletion('c3'), deletion('k1', { domain: 'contact' })] }),
    );
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      if (hash === 'c2') throw refusal('mass_deletion_suspected', BREAKER);
      return removed(hash);
    });
    renderScreen();
    await pressAll(4);

    await screen.findByText('Done: 2 of 4 deleted on the new system.');
    // c3 was never ordered, whatever the breaker would say about it now.
    expect(orderedHashes()).toEqual(['c1', 'c2', 'k1']);
    expect(screen.getByText(en['deletions.refused.massDeletionSuspected'])).toBeInTheDocument();
    expect(
      screen.getByText(en['deletions.all.notTried.breaker'].replace('{dataType}', en['domain.calendar'])),
    ).toBeInTheDocument();
    expect(screen.getAllByText(`${BREAKER} (mass_deletion_suspected)`)).toHaveLength(2);
    // Nothing happened to c3, so its row has its buttons back.
    const c3 = screen
      .getAllByText('Event c3')
      .map((el) => el.closest('li')!)
      .find((li) => li.querySelector('code[title="c3"]'))!;
    expect(within(c3).getByText(en['deletions.apply'])).toBeInTheDocument();
  });

  it('on managed, waits for each receipt before the next order, and stops on a receipt the breaker refused', async () => {
    fetchDeletions.mockResolvedValue(
      queue({ confirmed: [deletion('c1'), deletion('c2'), deletion('c3'), deletion('k1', { domain: 'contact' })] }),
    );
    const log: string[] = [];
    const queued: ApplyReceipt = { state: 'queued', requestedAt: '2026-11-21T23:00:00Z' };
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      log.push(`order ${hash}`);
      return { mode: 'queued', receipt: queued };
    });
    const polls = new Map<string, number>();
    fetchApplyReceipt.mockImplementation(async (_m: string, hash: string): Promise<ApplyReceipt> => {
      const n = (polls.get(hash) ?? 0) + 1;
      polls.set(hash, n);
      if (n < 2) {
        log.push(`poll ${hash}: queued`);
        return queued;
      }
      log.push(`poll ${hash}: done`);
      return hash === 'c1'
        ? {
            state: 'refused',
            requestedAt: queued.requestedAt,
            finishedAt: '2026-11-21T23:00:05Z',
            code: 'mass_deletion_suspected',
            reason: BREAKER,
          }
        : { state: 'applied', requestedAt: queued.requestedAt, finishedAt: '2026-11-21T23:00:05Z', kind: 'binned' };
    });
    renderScreen();
    await pressAll(4);

    await screen.findByText('Done: 1 of 4 deleted on the new system.');
    expect(log).toEqual([
      'order c1',
      'poll c1: queued',
      'poll c1: done',
      'order k1',
      'poll k1: queued',
      'poll k1: done',
    ]);
    expect(screen.getAllByText(en['deletions.all.notTried.breaker'].replace('{dataType}', en['domain.calendar']))).toHaveLength(2);
    expect(screen.getAllByText(en['receipt.applied.binned']).length).toBeGreaterThan(0);
  });
});

describe('a run that empties the list', () => {
  it('still says what it did once every row has left Waiting on you', async () => {
    // The server's answer as it really moves: a deleted row is decided, and
    // leaves the rows waiting on you.
    const rows = [deletion('a'), deletion('b')];
    const deleted = new Set<string>();
    fetchDeletions.mockImplementation(async () =>
      queue({
        confirmed: rows.filter((d) => !deleted.has(d.naturalKeyHash)),
        acknowledged: rows
          .filter((d) => deleted.has(d.naturalKeyHash))
          .map((d) => ({ ...d, acknowledgedAt: '2026-11-21T23:00:00Z', decided: 'applied' as const })),
      }),
    );
    applyDeletion.mockImplementation(async (_m: string, hash: string) => {
      deleted.add(hash);
      return removed(hash);
    });
    renderScreen();
    await pressAll(2);

    expect(await screen.findByText('Done: 2 of 2 deleted on the new system.')).toBeInTheDocument();
    expect(await screen.findByText(en['deletions.empty.confirmed'])).toBeInTheDocument();
    expect(screen.getByText('Done: 2 of 2 deleted on the new system.')).toBeInTheDocument();
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
    fireEvent.click(await screen.findByText(en['deletions.all.stop']));
    expect(screen.queryByText(en['deletions.all'])).not.toBeInTheDocument();
    expect(await screen.findByText(en['deletions.all.stopping'])).toBeInTheDocument();
    release();

    await screen.findByText('Done: 1 of 3 deleted on the new system.');
    expect(orderedHashes()).toEqual(['a']);
    expect(screen.getAllByText(en['deletions.all.notTried.stop'])).toHaveLength(2);
    // b and c were never ordered: their own buttons are back, and so is the press for both.
    expect(screen.getAllByText(en['deletions.apply'])).toHaveLength(2);
    expect(screen.getByText(en['deletions.all'])).toBeInTheDocument();
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
    await screen.findByText('Done: 2 of 3 deleted on the new system.');
    expect(orderedHashes()).toEqual(['a', 'b', 'c']);
    // Every row this page pressed has its answer, so there is nothing left to press for all.
    expect(screen.queryByText(en['deletions.all'])).not.toBeInTheDocument();
    first.unmount();

    // Coming back: a and c are deleted and decided; b is still waiting, and d is new.
    applyDeletion.mockClear();
    fetchDeletions.mockResolvedValue(
      queue({
        confirmed: [deletion('b'), deletion('d')],
        acknowledged: [
          deletion('a', { acknowledgedAt: '2026-11-21T23:00:00Z', decided: 'applied' }),
          deletion('c', { acknowledgedAt: '2026-11-21T23:00:00Z', decided: 'applied' }),
        ],
      }),
    );
    renderScreen();
    await pressAll(2);
    await screen.findByText('Done: 1 of 2 deleted on the new system.');
    expect(orderedHashes()).toEqual(['b', 'd']);
  });
});
