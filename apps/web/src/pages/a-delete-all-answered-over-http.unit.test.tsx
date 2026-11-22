// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DELETE ALL OF THESE HERE TOO, OVER THE REAL OPERATING SERVICE (workplan
 * 0164 T3).
 *
 * The page's other tests mock the operating service, `DecisionRefusedError`
 * included, so they cannot see how an HTTP answer becomes a refusal or a
 * fault. Here nothing of the service is mocked: only axios's transport is
 * replaced, by answers in the shapes each edition sends, and the edition
 * itself is chosen per test (the managed API, or the appliance).
 *
 *  - managed: a 403 with a gate's code is a refusal, and the run goes on; a
 *    500 from `serverFault` carries an `error` field too, and it is not
 *    known, and it stops the run;
 *  - managed: a 202 receipt read to its end, a 404 with a gate's code, and a
 *    receipt refused `removed_not_recorded`, which is deleted and stops the
 *    run;
 *  - managed: the operator's hold (409) started nothing: not deleted, and the
 *    run stops;
 *  - a transport error, with no answer at all, is not known and stops the run;
 *  - a gate's code on a status no gate answers with, a receipt that failed,
 *    and a receipt refused with a code no gate refuses with: not known, and
 *    the run stops;
 *  - the appliance: its synchronous answer, and its 500
 *    `removed_not_recorded`, which is deleted and stops the run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import type { DeletionsQueue, ItemDeletion } from '@openmig/shared';
import { DELETIONS_MEANING, DELETION_GUIDANCE, decisionEffectFields, deletionRemovedEffect } from '@openmig/shared';
import { STRINGS } from '../i18n/strings.ts';
import { LocaleProvider } from '../i18n/index.tsx';

/**
 * What the fake server answers, by method and path, and what it was asked.
 * An answer may be a list, read one per request, the last one repeated; a
 * status of 0 is a request that got no answer at all.
 */
const http = vi.hoisted(() => {
  type Answer = { status: number; data?: unknown };
  const answers = new Map<string, Answer | Answer[]>();
  const asked: string[] = [];
  return {
    answers,
    asked,
    adapter: async (config: { method?: string; url?: string }) => {
      const key = `${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`;
      asked.push(key);
      const set = answers.get(key);
      const answer = Array.isArray(set) ? (set.length > 1 ? set.shift()! : set[0]!) : set;
      const said = answer ?? { status: 404, data: { error: 'no fake answer for ' + key } };
      if (said.status === 0) {
        throw Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK', config });
      }
      const response = { data: said.data, status: said.status, statusText: '', headers: {}, config };
      if (said.status >= 200 && said.status < 300) return response;
      throw Object.assign(new Error(`Request failed with status code ${said.status}`), {
        isAxiosError: true,
        response,
        config,
      });
    },
  };
});

/** Which edition the page believes it is, per test; the paths follow from it as in the build. */
const editionFlag = vi.hoisted(() => ({ ed: 'managed' as 'managed' | 'selfhost' }));

// Every axios instance the app makes talks to the fake server; nothing else of axios changes.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const real = actual.default;
  const create = (config?: AxiosRequestConfig) =>
    real.create({ ...config, adapter: http.adapter as unknown as AxiosRequestConfig['adapter'] });
  return { ...actual, default: Object.assign(Object.create(real) as typeof real, real, { create }) };
});

vi.mock('../services/edition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/edition.ts')>();
  return {
    ...actual,
    edition: () => editionFlag.ed,
    isSelfHost: () => editionFlag.ed === 'selfhost',
    queuePath: (queue: Parameters<typeof actual.queuePathFor>[1], mappingId?: string) =>
      actual.queuePathFor(editionFlag.ed, queue, mappingId),
    mappingPath: (mappingId: string) => actual.mappingPathFor(editionFlag.ed, mappingId),
    queueScreenPath: (queue: Parameters<typeof actual.queueScreenPathFor>[1], mappingId: string) =>
      actual.queueScreenPathFor(editionFlag.ed, queue, mappingId),
    verifyPath: (action: 'start' | 'report', mappingId?: string) =>
      actual.verifyPathFor(editionFlag.ed, action, mappingId),
  };
});

import Deletions from './Deletions.tsx';

const en = STRINGS.en;
const MAPPING = 'm-0164';
const M = `/migrations/${MAPPING}`;
const A = `/mappings/${MAPPING}`;
const done = (deleted: number, notDeleted: number, unknown: number) =>
  en['deletions.all.done']
    .replace('{deleted}', String(deleted))
    .replace('{notDeleted}', String(notDeleted))
    .replace('{unknown}', String(unknown));

function deletion(naturalKeyHash: string): ItemDeletion {
  return {
    domain: 'calendar',
    collection: 'Personal',
    displayName: `Event ${naturalKeyHash}`,
    absentPasses: 0,
    confirmed: true,
    evidence: 'reported',
    naturalKeyHash,
  };
}

const queue: DeletionsQueue = {
  migrationStatus: 'active',
  afterCutover: [],
  confirmed: ['a', 'b', 'c', 'd'].map(deletion),
  watching: [],
  acknowledged: [],
  whatThisMeans: DELETIONS_MEANING,
  howToResolve: DELETION_GUIDANCE,
  earlierExports: { waiting: [], kept: [] },
};

const FLAG = { allowApplyDeletions: true, autoApplyRelocations: false, source: 'mapping' };
const QUEUED = { queued: true, receipt: { state: 'queued', requestedAt: '2026-11-22T00:00:00Z' } };
const landed = (rest: Record<string, unknown>) => ({
  status: 200,
  data: { requestedAt: '2026-11-22T00:00:00Z', finishedAt: '2026-11-22T00:00:05Z', ...rest },
});

/** The managed page, at its route, over the fake server. */
function managed() {
  editionFlag.ed = 'managed';
  http.answers.set(`GET ${M}/deletions`, { status: 200, data: { [MAPPING]: queue } });
  http.answers.set(`GET ${M}/apply-deletions`, { status: 200, data: FLAG });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[`/migrations/${MAPPING}/deletions`]}>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/migrations/:mappingId/deletions" element={<Deletions receiptPollMs={5} confirmGuardMs={0} />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

/** The appliance's page, which answers for every migration at its own root. */
function appliance() {
  editionFlag.ed = 'selfhost';
  http.answers.set('GET /deletions', { status: 200, data: { [MAPPING]: queue } });
  http.answers.set(`GET ${A}/apply-deletions`, { status: 200, data: FLAG });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={['/deletions']}>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/deletions" element={<Deletions receiptPollMs={5} confirmGuardMs={0} />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </LocaleProvider>,
  );
}

async function pressAllFour() {
  (await screen.findByRole('button', { name: en['deletions.all'] })).click();
  (await screen.findByRole('button', { name: 'Delete 4' })).click();
}

const group = (title: string) =>
  screen.getByRole('heading', { level: 4, name: new RegExp(`^${title}`) }).parentElement!;
const presses = () => http.asked.filter((key) => key.startsWith('POST '));

beforeEach(() => {
  http.answers.clear();
  http.asked.length = 0;
});

describe('Delete all of these here too, answered over HTTP', () => {
  it('reads a 403 with a gate’s code as a refusal, and a 500 with an error field as not known, which stops the run', async () => {
    // a: a gate's refusal, as the route sends it.
    http.answers.set(`POST ${M}/deletions/a/apply`, {
      status: 403,
      data: { error: 'not_ours', reason: 'The copy on the target was already there before this migration ran.' },
    });
    // b: a fault, as `serverFault` sends it: an `error` field, and a 500.
    http.answers.set(`POST ${M}/deletions/b/apply`, {
      status: 500,
      data: {
        error: 'deletion_apply_failed',
        reason: "Something went wrong queuing this deletion's removal — this is a fault on our side. Reference QX7.",
      },
    });
    managed();
    await pressAllFour();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.failure']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(0, 3, 1));
    expect(within(group(en['deletions.all.notRemoved'])).getByText(en['deletions.refused.notOurs'])).toBeInTheDocument();
    const unknown = group(en['deletions.all.unknown']);
    expect(within(unknown).getByText(en['deletions.all.failed'])).toBeInTheDocument();
    expect(within(unknown).getByText(/Reference QX7.*\(deletion_apply_failed, HTTP 500\)/)).toBeInTheDocument();
    // a and b were pressed; c and d never were.
    expect(presses()).toEqual([`POST ${M}/deletions/a/apply`, `POST ${M}/deletions/b/apply`]);
  });

  it('reads a 202 receipt to its end, a 404 with a gate’s code as a refusal, and stops on a receipt the ledger could not record', async () => {
    http.answers.set(`POST ${M}/deletions/a/apply`, { status: 202, data: QUEUED });
    http.answers.set(`GET ${M}/deletions/a/receipt`, [
      { status: 200, data: QUEUED.receipt },
      landed({ state: 'applied', kind: 'binned' }),
    ]);
    http.answers.set(`POST ${M}/deletions/b/apply`, {
      status: 404,
      data: { error: 'not_confirmed', reason: 'This item has no deletion evidence any more.' },
    });
    http.answers.set(`POST ${M}/deletions/c/apply`, { status: 202, data: QUEUED });
    http.answers.set(
      `GET ${M}/deletions/c/receipt`,
      landed({ state: 'refused', code: 'removed_not_recorded', reason: 'The copy WAS removed from the target.' }),
    );
    managed();
    await pressAllFour();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.notRecorded']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(2, 2, 0));
    const deleted = group(en['deletions.all.removed']);
    expect(within(deleted).getByText(en['receipt.applied.binned'])).toBeInTheDocument();
    expect(within(deleted).getByText(en['deletions.refused.removedNotRecorded'])).toBeInTheDocument();
    expect(within(group(en['deletions.all.notRemoved'])).getByText(en['deletions.refused.notConfirmed'])).toBeInTheDocument();
    // a's receipt was read to its end before b was pressed, and d never was.
    const order = http.asked.filter((key) => key.includes('/deletions/'));
    const lastReadOfA = order.lastIndexOf(`GET ${M}/deletions/a/receipt`);
    expect(lastReadOfA).toBeGreaterThan(order.indexOf(`POST ${M}/deletions/a/apply`));
    expect(order.indexOf(`POST ${M}/deletions/b/apply`)).toBeGreaterThan(lastReadOfA);
    expect(presses()).toEqual([
      `POST ${M}/deletions/a/apply`,
      `POST ${M}/deletions/b/apply`,
      `POST ${M}/deletions/c/apply`,
    ]);
  });

  it('says a hold started nothing: not deleted, with the server’s words, and nothing after it is pressed', async () => {
    http.answers.set(`POST ${M}/deletions/a/apply`, {
      status: 409,
      data: {
        error: 'platform_held',
        message: 'We have paused copying while we update the platform. Nothing was started.',
        reason: 'We have paused copying while we update the platform. Nothing was started.',
      },
    });
    managed();
    await pressAllFour();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.notStarted']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(0, 4, 0));
    const notDeleted = group(en['deletions.all.notRemoved']);
    expect(within(notDeleted).getByText(en['deletions.refused.held'])).toBeInTheDocument();
    expect(within(notDeleted).getByText(/Nothing was started\. \(platform_held, HTTP 409\)/)).toBeInTheDocument();
    expect(presses()).toEqual([`POST ${M}/deletions/a/apply`]);
  });

  it('says a request that got no answer at all is not known, and presses nothing after it', async () => {
    http.answers.set(`POST ${M}/deletions/a/apply`, { status: 0 });
    managed();
    await pressAllFour();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.failure']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(0, 3, 1));
    expect(within(group(en['deletions.all.unknown'])).getByText(en['deletions.all.failed'])).toBeInTheDocument();
    expect(presses()).toEqual([`POST ${M}/deletions/a/apply`]);
  });

  it.each([
    [
      'a gate’s code on a status no gate answers with',
      () =>
        http.answers.set(`POST ${M}/deletions/a/apply`, {
          status: 500,
          data: { error: 'not_ours', reason: 'The copy on the target was already there.' },
        }),
    ],
    [
      'a receipt that failed',
      () => {
        http.answers.set(`POST ${M}/deletions/a/apply`, { status: 202, data: QUEUED });
        http.answers.set(`GET ${M}/deletions/a/receipt`, landed({ state: 'failed', error: 'The worker stopped mid-removal.' }));
      },
    ],
    [
      'a receipt refused with a code no gate refuses with',
      () => {
        http.answers.set(`POST ${M}/deletions/a/apply`, { status: 202, data: QUEUED });
        http.answers.set(
          `GET ${M}/deletions/a/receipt`,
          landed({ state: 'refused', code: 'something_new', reason: 'A reason nobody has seen.' }),
        );
      },
    ],
  ])('says %s is not known, and presses nothing after it', async (_what, answer) => {
    answer();
    managed();
    await pressAllFour();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.failure']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(0, 3, 1));
    expect(within(group(en['deletions.all.unknown'])).getByText(en['deletions.all.failed'])).toBeInTheDocument();
    expect(presses()).toEqual([`POST ${M}/deletions/a/apply`]);
  });

  it('on the appliance: takes its own answer as said, and stops on a 500 the ledger could not record', async () => {
    const removedAnswer = (hash: string) => ({
      status: 200,
      data: {
        status: 'ok',
        action: 'apply',
        naturalKeyHash: hash,
        kind: 'deleted',
        ...decisionEffectFields(deletionRemovedEffect('deleted')),
      },
    });
    http.answers.set(`POST ${A}/deletions/a/apply`, removedAnswer('a'));
    http.answers.set(`POST ${A}/deletions/b/apply`, {
      status: 500,
      data: { error: 'removed_not_recorded', reason: 'The copy WAS removed from the target.' },
    });
    appliance();
    await pressAllFour();

    expect(await screen.findByText(new RegExp(en['deletions.all.stoppedBy.notRecorded']))).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(done(2, 2, 0));
    const deleted = group(en['deletions.all.removed']);
    expect(within(deleted).getAllByText(deletionRemovedEffect('deleted').en).length).toBeGreaterThan(0);
    expect(within(deleted).getByText(en['deletions.refused.removedNotRecorded'])).toBeInTheDocument();
    expect(presses()).toEqual([`POST ${A}/deletions/a/apply`, `POST ${A}/deletions/b/apply`]);
  });
});
