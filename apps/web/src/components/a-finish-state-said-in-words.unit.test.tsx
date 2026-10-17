// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A FINISH STEP'S STATE, SAID IN WORDS (workplan 0145 T2; the UX sweep).
 *
 * Each step of the Finish checklist showed its state as an icon alone: a
 * green tick, an amber triangle or a grey circle. The icons are hidden from a
 * screen reader, so a tester who listens heard *1. Check the copy is
 * complete* and nothing about whether it was. Each step now carries its state
 * in words beside the icon, 0145 T2's words: *done* / *needs attention* /
 * *not yet*, and *klaar* / *vraagt aandacht* / *nog niet*.
 *
 * And step 2's state is what really blocks (the UX sweep): only items that
 * could not be copied hold up finishing, so open deletions and moves leave it
 * *not yet* rather than *needs attention*.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { PathEndingChoice, StatusReport } from '@openmig/shared';
import { LocaleProvider } from '../i18n/index.tsx';
import { STRINGS } from '../i18n/strings.ts';

const { fetchStatus, fetchMappingDataTypes, fetchFailures, fetchMoves, fetchDeletions, fetchVerifyReport } =
  vi.hoisted(() => ({
    fetchStatus: vi.fn(),
    fetchMappingDataTypes: vi.fn(),
    fetchFailures: vi.fn(),
    fetchMoves: vi.fn(),
    fetchDeletions: vi.fn(),
    fetchVerifyReport: vi.fn(),
  }));

vi.mock('../services/operating-service', () => ({
  fetchStatus,
  fetchMappingDataTypes,
  fetchFailures,
  fetchMoves,
  fetchDeletions,
  fetchVerifyReport,
  endOrKeepDataType: vi.fn(),
  requestFinalPass: vi.fn(),
  PathEndingRefusedError: class extends Error {},
}));

import Finish from '../pages/Finish.tsx';

type Locale = 'en' | 'nl';

const MAIL: PathEndingChoice[] = [{ domain: 'email', phase: 'active', stopped: false, offers: ['end', 'keep'] }];

function statusReport(needingDecision: number): StatusReport {
  return {
    status: 'ok',
    mappings: [
      {
        mappingId: 'acme-mail',
        migrationStatus: 'active',
        endings: MAIL,
        domains: [
          {
            domain: 'email',
            state: 'completed',
            itemsSynced: 100,
            itemsFailed: needingDecision,
            bytesTransferred: 1000,
            itemsRetrying: 0,
            itemsNeedingDecision: needingDecision,
          },
        ],
      },
    ],
  };
}

const queue = (over: { confirmed?: unknown[]; open?: unknown[] } = {}) => ({
  'acme-mail': {
    migrationStatus: 'active' as const,
    confirmed: [],
    watching: [],
    acknowledged: [],
    open: [],
    needsDecision: [],
    retrying: [],
    whatThisMeans: '',
    howToResolve: {},
    ...over,
  },
});

function renderIn(locale: Locale) {
  globalThis.localStorage.setItem('ownpace.locale', locale);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LocaleProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Finish />
        </MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

/** The checklist's steps, in order: the numbered list's own items, not the data types inside step 5. */
async function steps(locale: Locale): Promise<HTMLElement[]> {
  await screen.findByText(`1. ${STRINGS[locale]['finish.step1.title']}`);
  const list = document.querySelector('ol');
  expect(list, 'no numbered checklist').not.toBeNull();
  return Array.from(list!.children) as HTMLElement[];
}

/** The state a step says, as a listener hears it: exactly one of the three words, in the step itself. */
function saysState(step: HTMLElement, locale: Locale, key: 'finish.state.done' | 'finish.state.attention' | 'finish.state.notYet') {
  const word = STRINGS[locale][key];
  expect(word, `${locale} has no '${key}'`).toBeTruthy();
  expect(within(step).getAllByText(word, { exact: true })).toHaveLength(1);
  for (const other of ['finish.state.done', 'finish.state.attention', 'finish.state.notYet'] as const) {
    if (other === key) continue;
    expect(within(step).queryByText(STRINGS[locale][other], { exact: true })).toBeNull();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFailures.mockResolvedValue(queue());
  fetchMoves.mockResolvedValue(queue());
  fetchDeletions.mockResolvedValue(queue());
  fetchMappingDataTypes.mockResolvedValue({ domains: [], endings: MAIL });
});
afterEach(() => {
  globalThis.localStorage.removeItem('ownpace.locale');
});

describe('a Finish step says its state in words, not by its icon alone', () => {
  for (const locale of ['en', 'nl'] as const) {
    it(`done, needs attention and not yet, in ${locale}`, async () => {
      fetchStatus.mockResolvedValue(statusReport(3));
      fetchVerifyReport.mockResolvedValue({
        state: 'done',
        startedAt: '2026-08-09T10:00:00Z',
        finishedAt: '2026-08-09T10:05:00Z',
        report: { 'acme-mail': { overallStatus: 'PASS', canProceedToCutover: true, contentEvidence: 'checked' } },
      });
      renderIn(locale);

      const [check, decide, pass, delivery, end] = await steps(locale);
      expect(end, 'mail before its cutover has five steps').toBeDefined();
      saysState(check!, locale, 'finish.state.done');
      saysState(decide!, locale, 'finish.state.attention');
      saysState(pass!, locale, 'finish.state.notYet');
      saysState(delivery!, locale, 'finish.state.notYet');
      saysState(end!, locale, 'finish.state.notYet');
    });
  }

  it('the words are 0145 T2’s', () => {
    expect([STRINGS.en['finish.state.done'], STRINGS.en['finish.state.attention'], STRINGS.en['finish.state.notYet']]).toEqual([
      'done',
      'needs attention',
      'not yet',
    ]);
    expect([STRINGS.nl['finish.state.done'], STRINGS.nl['finish.state.attention'], STRINGS.nl['finish.state.notYet']]).toEqual([
      'klaar',
      'vraagt aandacht',
      'nog niet',
    ]);
  });
});

describe('step 2 needs attention only for what holds up finishing', () => {
  it('open deletions and moves leave it not yet: they do not hold up finishing', async () => {
    fetchStatus.mockResolvedValue(statusReport(0));
    fetchVerifyReport.mockResolvedValue({ state: 'never-run' });
    fetchDeletions.mockResolvedValue(queue({ confirmed: [{}, {}, {}] }));
    fetchMoves.mockResolvedValue(queue({ open: [{}, {}] }));
    renderIn('en');

    const [, decide] = await steps('en');
    await within(decide!).findByText(/3 deleted on the old system/);
    saysState(decide!, 'en', 'finish.state.notYet');
  });

  it('clear queues are done', async () => {
    fetchStatus.mockResolvedValue(statusReport(0));
    fetchVerifyReport.mockResolvedValue({ state: 'never-run' });
    renderIn('nl');

    const [, decide] = await steps('nl');
    await within(decide!).findByText(STRINGS.nl['finish.step2.clear']);
    saysState(decide!, 'nl', 'finish.state.done');
  });
});
